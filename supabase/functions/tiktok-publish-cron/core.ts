// supabase/functions/tiktok-publish-cron/core.ts
//
// TikTok Phase B, Task B5: every-minute init/status/retry publish engine — the TikTok
// counterpart to instagram-publish-cron/index.ts (that file keeps its phase logic inline;
// this one is split into core.ts/handler.ts/index.ts per tiktok-refresh-cron's convention
// (Task A6), since it needs the same DI seams for its own network/crypto-touching calls).
//
// Three phases via claim_tiktok_targets_for_publishing (init/status/retry; P4: the claim is per
// TikTok DESTINATION, post_targets). Every claimed destination's processing_at lock is cleared on
// every normal exit path: init success (processando + publish_ref), deferral (clearLock), failure
// (mark_target_failed), status (mark_target_published or a lock release) and retry
// (requeue_target, or clearLock when it declines). Every transition that moves the post's status
// runs inside one of those SECURITY DEFINER RPCs, never as a direct workflow_posts write.
//
// getFreshTikTokToken (_shared/tiktok.ts) is called ONCE PER ACCOUNT PER RUN — posts are
// grouped by tiktok_account_id in the init and status phases before any token fetch — never
// per post; that file's module comment explains why concurrent refreshes race the rotating
// refresh token. TikTok media proxy URLs (buildTikTokMediaUrl, _shared/tiktok-media-url.ts —
// NOT a raw R2 presign; TikTok's PULL_FROM_URL requires a TikTok-verifiable URL prefix, which
// tiktok-media's own function host provides) are regenerated on every attempt, never
// cached/reused across retries — an expired token would otherwise permanently fail an
// otherwise-retryable post.
//
// `svc` is created and hoisted by the caller (index.ts) BEFORE the outer try in
// runTikTokPublishCron, so a failure before any phase even runs still reaches
// reportCronFailure — the retention initiative's cron-failure silent-death lesson (see
// tiktok-refresh-cron/core.ts's identical comment, and instagram-publish-cron/index.ts).
//
// Task B6: the status phase's per-post "confirm via status fetch, then apply" body now lives in
// _shared/tiktok-publish-utils.ts::confirmAndApplyPublishStatus, shared with tiktok-webhook's
// post.publish.complete/failed handling — see that function's module comment for why it takes
// an already-fetched accessToken instead of an accountId (preserving the once-per-account-per-run
// invariant above). markTikTokPublishFailed/clearLock/errorMessage moved there too since both
// this file and the webhook need them; this file only keeps its own claim/phase-orchestration
// logic and the token-failure fan-out (tokenErrorMessage) below.

import type { CronFailureDetail } from "../_shared/notify.ts";
import { fetchPostMedia as realFetchPostMedia } from "../_shared/instagram-publish-utils.ts";
import {
  buildPhotoInitPayload,
  buildVideoInitPayload,
  clearLock,
  confirmAndApplyPublishStatus,
  errorMessage,
  markTikTokPublishFailed,
  type ClaimedTikTokPost,
  type TikTokSettings,
} from "../_shared/tiktok-publish-utils.ts";
import {
  type CreatorCheck,
  evaluateTikTokPrecheck,
  fetchCreatorCheck as realFetchCreatorCheck,
  fetchPrecheckMedia as realFetchPrecheckMedia,
} from "../_shared/tiktok-precheck.ts";
import { TikTokApiError } from "../_shared/tiktok.ts";
import { tiktokErrorMessage } from "../_shared/tiktok-messages.ts";

// deno-lint-ignore no-explicit-any
type DbClient = any;

const INIT_LIMIT = 25;
const STATUS_LIMIT = 25;
const RETRY_LIMIT = 10;

// TikTok's own posting-init cap is 6/minute per user access token (design doc "Rate limits").
// Capping the cron's own per-account batch at 5 leaves headroom for a stray publish-now call
// (tiktok-publish/handler.ts) landing on the same account in the same minute.
const MAX_INIT_PER_ACCOUNT = 5;

const CRON_NAME = "tiktok-publish-cron";

/** Row of claim_tiktok_targets_for_publishing (20261014000003). */
interface ClaimedTikTokCronPost {
  post_id: number;
  conta_id: string;
  cliente_id: number;
  tipo: string;
  scheduled_at: string | null;
  caption: string;
  tiktok_title: string | null;
  tiktok_settings: TikTokSettings | null;
  tiktok_username: string | null;
  tiktok_account_id: string;
  target_id: number;
  publish_ref: string | null;
  retry_count: number;
}

interface FetchedMediaFile {
  id: number;
  kind: string;
  r2_key: string;
  sort_order: number;
}

export interface TikTokPublishCronDeps {
  /** Created and hoisted by the caller (index.ts) BEFORE the outer try. */
  svc: DbClient;
  /** The ONLY code path allowed to read/refresh TikTok tokens — see _shared/tiktok.ts. */
  getFreshTikTokToken: (svc: DbClient, accountId: string) => Promise<{ accessToken: string; openId: string }>;
  tiktokFetch: (path: string, init: RequestInit & { accessToken: string }) => Promise<unknown>;
  /** Mints a TikTok-verifiable proxy URL for an r2Key (_shared/tiktok-media-url.ts) — NOT a raw
   * R2 presign. See the module comment above for why. */
  buildTikTokMediaUrl: (r2Key: string, ttlSeconds: number) => Promise<string>;
  reportCronFailure: (svc: DbClient, cronName: string, detail: CronFailureDetail) => Promise<void>;
  /** Optional DI seam — defaults to the real shared implementation. Tests may override, but
   * normally just queue `post_file_links` responses on the mock db and let the real
   * (platform-agnostic, already-exported) helper run. */
  fetchPostMedia?: (db: DbClient, postId: number) => Promise<FetchedMediaFile[]>;
  /** Optional DI seams for the pre-init creator/media precheck (spec A10) — default to the
   * real _shared/tiktok-precheck.ts implementations. */
  fetchCreatorCheck?: typeof realFetchCreatorCheck;
  fetchPrecheckMedia?: typeof realFetchPrecheckMedia;
  now?: () => Date;
}

interface PhaseResult {
  succeeded: number;
  failed: number;
}

function errorCode(err: unknown): string | undefined {
  if (err && typeof err === "object" && "code" in err && typeof (err as { code?: unknown }).code === "string") {
    return (err as { code: string }).code;
  }
  return undefined;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function groupByAccount(posts: ClaimedTikTokCronPost[]): Map<string, ClaimedTikTokCronPost[]> {
  const map = new Map<string, ClaimedTikTokCronPost[]>();
  for (const post of posts) {
    const arr = map.get(post.tiktok_account_id) ?? [];
    arr.push(post);
    map.set(post.tiktok_account_id, arr);
  }
  return map;
}

/** All three phases share the ONE claim RPC — unlike instagram-publish-cron's claimPosts
 * (which swallows a claim error and returns [] so one broken phase doesn't block the others),
 * a claim failure here THROWS: the RPC being broken is a single shared failure mode for the
 * whole run (not a per-phase concern), and surfacing it immediately via the outer catch below
 * (-> reportCronFailure) is more useful than three silent empty-claim log lines in a row. */
async function claimPosts(
  svc: DbClient,
  phase: "init" | "status" | "retry",
  limit: number,
): Promise<ClaimedTikTokCronPost[]> {
  const { data, error } = await svc.rpc("claim_tiktok_targets_for_publishing", {
    p_phase: phase,
    p_limit: limit,
  });
  if (error) {
    throw new Error(`claim_tiktok_targets_for_publishing(${phase}) failed: ${error.message}`);
  }
  return (data ?? []) as ClaimedTikTokCronPost[];
}

function tokenErrorMessage(err: unknown): string {
  return errorCode(err) === "TOKEN_EXPIRED"
    ? "Token do TikTok expirado. Reconecte a conta do TikTok."
    : `Erro ao obter token do TikTok: ${errorMessage(err)}`;
}

// --- Phase 1: init ---

async function processInitPhase(
  deps: TikTokPublishCronDeps,
  posts: ClaimedTikTokCronPost[],
): Promise<PhaseResult> {
  const { svc, getFreshTikTokToken, tiktokFetch, buildTikTokMediaUrl } = deps;
  const now = deps.now ?? (() => new Date());
  const fetchPostMedia = deps.fetchPostMedia ?? realFetchPostMedia;
  const fetchCreatorCheck = deps.fetchCreatorCheck ?? realFetchCreatorCheck;
  const fetchPrecheckMedia = deps.fetchPrecheckMedia ?? realFetchPrecheckMedia;

  let succeeded = 0;
  let failed = 0;

  for (const [accountId, accountPosts] of groupByAccount(posts)) {
    const toProcess = accountPosts.slice(0, MAX_INIT_PER_ACCOUNT);
    const overflow = accountPosts.slice(MAX_INIT_PER_ACCOUNT);

    // Overflow beyond the per-account cap: release the destination lock untouched so the next
    // run's init claim picks it straight back up — not a failure.
    for (const post of overflow) {
      await clearLock(svc, post.target_id, now);
    }

    let accessToken: string;
    try {
      const token = await getFreshTikTokToken(svc, accountId);
      accessToken = token.accessToken;
    } catch (err) {
      const message = tokenErrorMessage(err);
      for (const post of toProcess) {
        await markTikTokPublishFailed(svc, post.post_id, message);
        failed++;
      }
      continue;
    }

    // One creator_info call per account per run (same invariant as the token fetch above).
    let creator: CreatorCheck;
    try {
      creator = await fetchCreatorCheck(tiktokFetch, accessToken);
    } catch (err) {
      // TOKEN_INVALID / REVOKED rethrown by fetchCreatorCheck: same treatment as the
      // getFreshTikTokToken catch above (spec A10): tokenErrorMessage, retryable (+1).
      const message = tokenErrorMessage(err);
      for (const post of toProcess) {
        await markTikTokPublishFailed(svc, post.post_id, message);
        failed++;
      }
      continue;
    }

    for (const post of toProcess) {
      try {
        const precheckMedia = await fetchPrecheckMedia(svc, post.post_id);
        const precheckFailure = evaluateTikTokPrecheck({
          tipo: post.tipo,
          settings: post.tiktok_settings,
          media: precheckMedia,
          creator,
        });
        if (precheckFailure) {
          await markTikTokPublishFailed(svc, post.post_id, precheckFailure, { nonRetryable: true });
          failed++;
          continue;
        }

        const media = await fetchPostMedia(svc, post.post_id);
        const claimedForBuilder: ClaimedTikTokPost = {
          tipo: post.tipo,
          caption: post.caption,
          tiktok_title: post.tiktok_title,
          tiktok_settings: post.tiktok_settings ?? {},
        };

        let initPath: string;
        let initPayload: object;
        if (post.tipo === "reels") {
          const videoFile = media.find((f) => f.kind === "video");
          if (!videoFile) throw new Error("Post de vídeo sem arquivo de vídeo vinculado.");
          const videoUrl = await buildTikTokMediaUrl(videoFile.r2_key, 7200);
          initPath = "/post/publish/video/init/";
          initPayload = buildVideoInitPayload(claimedForBuilder, videoUrl);
        } else {
          if (media.length === 0) throw new Error("Post sem arquivos de mídia vinculados.");
          const imageUrls = await Promise.all(media.map((f) => buildTikTokMediaUrl(f.r2_key, 7200)));
          initPath = "/post/publish/content/init/";
          initPayload = buildPhotoInitPayload(claimedForBuilder, imageUrls);
        }

        const initResult = (await tiktokFetch(initPath, {
          method: "POST",
          accessToken,
          body: JSON.stringify(initPayload),
        })) as { publish_id?: string };
        const publishId = initResult?.publish_id;
        if (!publishId) throw new Error("TikTok não retornou publish_id na inicialização.");

        // Single-statement destination write (spec §2d): the post's status does not change here.
        const { error: updErr } = await svc
          .from("post_targets")
          .update({
            status: "processando",
            publish_ref: publishId,
            processing_at: null,
            updated_at: now().toISOString(),
          })
          .eq("id", post.target_id);
        if (updErr) throw new Error(`Falha ao salvar publish_id do TikTok: ${updErr.message}`);

        succeeded++;
        console.log(`[${CRON_NAME}] Init: post ${post.post_id} -> publish_id ${publishId}`);
      } catch (err) {
        const code = err instanceof TikTokApiError ? err.code : undefined;
        const mapped = tiktokErrorMessage(code);
        await markTikTokPublishFailed(
          svc,
          post.post_id,
          mapped ?? errorMessage(err),
          mapped ? { nonRetryable: true } : undefined,
        );
        failed++;
      }
    }
  }

  return { succeeded, failed };
}

// --- Phase 2: status ---
//
// Per-destination "confirm via status fetch, then apply" is confirmAndApplyPublishStatus
// (_shared/tiktok-publish-utils.ts), shared with tiktok-webhook. This phase still owns getting
// one fresh access token per account and passes it into the shared function. The claim does not
// filter on the post's status: a publish in flight finishes even after the post was moved.

async function processStatusPhase(
  deps: TikTokPublishCronDeps,
  posts: ClaimedTikTokCronPost[],
): Promise<PhaseResult> {
  const { svc, getFreshTikTokToken, tiktokFetch } = deps;
  const now = deps.now ?? (() => new Date());

  let succeeded = 0;
  let failed = 0;

  for (const [accountId, accountPosts] of groupByAccount(posts)) {
    let accessToken: string;
    try {
      const token = await getFreshTikTokToken(svc, accountId);
      accessToken = token.accessToken;
    } catch (err) {
      const message = tokenErrorMessage(err);
      for (const post of accountPosts) {
        await markTikTokPublishFailed(svc, post.post_id, message);
        failed++;
      }
      continue;
    }

    for (const post of accountPosts) {
      const outcome = await confirmAndApplyPublishStatus(
        { svc, tiktokFetch, accessToken, now },
        {
          post_id: post.post_id,
          target_id: post.target_id,
          publish_ref: post.publish_ref,
          tiktok_username: post.tiktok_username,
          tipo: post.tipo,
        },
      );
      if (outcome === "failed") {
        failed++;
      } else {
        succeeded++;
        console.log(`[${CRON_NAME}] status ${outcome} for post ${post.post_id}`);
      }
    }
  }

  return { succeeded, failed };
}

// --- Phase 3: retry ---
//
// Purely a state reset — no TikTok API calls here. requeue_target moves the destination from
// `falha` to `agendado` (clearing error and publish_ref, keeping retry_count) and recomputes the
// post's status in the same transaction; the NEXT run's init phase publishes it with a fresh
// media URL. It declines (false) when the post left publication meanwhile — the destination lock
// is then released so it doesn't sit locked for the stale window.

async function processRetryPhase(
  deps: TikTokPublishCronDeps,
  posts: ClaimedTikTokCronPost[],
): Promise<PhaseResult> {
  const { svc } = deps;
  const now = deps.now ?? (() => new Date());
  let succeeded = 0;
  let failed = 0;

  for (const post of posts) {
    try {
      const { data: acted, error: rpcErr } = await svc.rpc("requeue_target", {
        p_post_id: post.post_id,
        p_platform: "tiktok",
        p_source: "system",
        p_actor: null,
      });
      if (rpcErr) throw new Error(`requeue_target falhou: ${rpcErr.message}`);
      if (acted === true) {
        succeeded++;
      } else {
        console.log(`[${CRON_NAME}] retry: post ${post.post_id} left publication, lock released`);
        await clearLock(svc, post.target_id, now);
      }
    } catch (err) {
      console.error(`[${CRON_NAME}] retry failed for post ${post.post_id}:`, errorMessage(err));
      await clearLock(svc, post.target_id, now);
      failed++;
    }
  }

  return { succeeded, failed };
}

// --- Entrypoint ---

export async function runTikTokPublishCron(deps: TikTokPublishCronDeps): Promise<Response> {
  const { svc, reportCronFailure } = deps;
  const summary = {
    init: { succeeded: 0, failed: 0 },
    status: { succeeded: 0, failed: 0 },
    retry: { succeeded: 0, failed: 0 },
  };

  try {
    const initPosts = await claimPosts(svc, "init", INIT_LIMIT);
    if (initPosts.length > 0) {
      console.log(`[${CRON_NAME}] Init: ${initPosts.length} posts claimed`);
      summary.init = await processInitPhase(deps, initPosts);
    }

    const statusPosts = await claimPosts(svc, "status", STATUS_LIMIT);
    if (statusPosts.length > 0) {
      console.log(`[${CRON_NAME}] Status: ${statusPosts.length} posts claimed`);
      summary.status = await processStatusPhase(deps, statusPosts);
    }

    const retryPosts = await claimPosts(svc, "retry", RETRY_LIMIT);
    if (retryPosts.length > 0) {
      console.log(`[${CRON_NAME}] Retry: ${retryPosts.length} posts claimed`);
      summary.retry = await processRetryPhase(deps, retryPosts);
    }

    console.log(`[${CRON_NAME}] Cron complete:`, JSON.stringify(summary));

    const totalFailed = summary.init.failed + summary.status.failed + summary.retry.failed;
    if (totalFailed > 0) {
      const total = summary.init.succeeded + summary.init.failed +
        summary.status.succeeded + summary.status.failed +
        summary.retry.succeeded + summary.retry.failed;
      await reportCronFailure(svc, CRON_NAME, {
        total,
        failed: totalFailed,
        errors: [{
          error: `Init: ${summary.init.failed}, Status: ${summary.status.failed}, Retry: ${summary.retry.failed}`,
        }],
      });
    }

    return json({ success: true, ...summary }, 200);
  } catch (err) {
    console.error(`[${CRON_NAME}] failed:`, errorMessage(err));
    await reportCronFailure(svc, CRON_NAME, {
      total: 0,
      failed: 1,
      errors: [{ error: errorMessage(err) }],
      stack: err instanceof Error ? err.stack : undefined,
    });
    return json({ error: "Internal server error" }, 500);
  }
}

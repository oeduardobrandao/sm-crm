// supabase/functions/tiktok-publish-cron/core.ts
//
// TikTok Phase B, Task B5: every-minute init/status/retry publish engine — the TikTok
// counterpart to instagram-publish-cron/index.ts (that file keeps its phase logic inline;
// this one is split into core.ts/handler.ts/index.ts per tiktok-refresh-cron's convention
// (Task A6), since it needs the same DI seams for its own network/crypto-touching calls).
//
// Three phases via claim_posts_for_tiktok_publishing (init/status/retry). Every claimed post's
// tiktok_publish_processing_at lock is cleared on EVERY exit path — success, deferred
// (per-account overflow), or failure — so nothing outlives the RPC's 10-minute
// stale-reclaim window by leaning on it. markTikTokPublishFailed and the plain workflow_posts
// updates used elsewhere in this file all clear the lock explicitly as part of their write.
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

interface ClaimedTikTokCronPost {
  post_id: number;
  workflow_id: number;
  tipo: string;
  scheduled_at: string;
  caption: string;
  tiktok_title: string | null;
  tiktok_settings: TikTokSettings | null;
  tiktok_publish_id: string | null;
  tiktok_publish_retry_count: number;
  encrypted_access_token: string;
  encrypted_refresh_token: string;
  access_token_expires_at: string | null;
  tiktok_account_id: string;
  tiktok_open_id: string;
  tiktok_username: string | null;
  client_id: number;
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
  const { data, error } = await svc.rpc("claim_posts_for_tiktok_publishing", {
    p_phase: phase,
    p_limit: limit,
  });
  if (error) {
    throw new Error(`claim_posts_for_tiktok_publishing(${phase}) failed: ${error.message}`);
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
  const fetchPostMedia = deps.fetchPostMedia ?? realFetchPostMedia;

  let succeeded = 0;
  let failed = 0;

  for (const [accountId, accountPosts] of groupByAccount(posts)) {
    const toProcess = accountPosts.slice(0, MAX_INIT_PER_ACCOUNT);
    const overflow = accountPosts.slice(MAX_INIT_PER_ACCOUNT);

    // Overflow beyond the per-account cap: release the lock untouched (tiktok_publish_status
    // stays NULL) so the next run's init claim picks them straight back up — not a failure.
    for (const post of overflow) {
      await clearLock(svc, post.post_id);
    }

    let accessToken: string;
    try {
      const token = await getFreshTikTokToken(svc, accountId);
      accessToken = token.accessToken;
    } catch (err) {
      const message = tokenErrorMessage(err);
      for (const post of toProcess) {
        await markTikTokPublishFailed(svc, post.post_id, post.tiktok_publish_retry_count, message);
        failed++;
      }
      continue;
    }

    for (const post of toProcess) {
      try {
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

        const { error: updErr } = await svc
          .from("workflow_posts")
          .update({
            tiktok_publish_id: publishId,
            tiktok_publish_status: "initiated",
            tiktok_publish_processing_at: null,
          })
          .eq("id", post.post_id);
        if (updErr) throw new Error(`Falha ao salvar publish_id do TikTok: ${updErr.message}`);

        succeeded++;
        console.log(`[${CRON_NAME}] Init: post ${post.post_id} -> publish_id ${publishId}`);
      } catch (err) {
        await markTikTokPublishFailed(svc, post.post_id, post.tiktok_publish_retry_count, errorMessage(err));
        failed++;
      }
    }
  }

  return { succeeded, failed };
}

// --- Phase 2: status ---
//
// Per-post "confirm via status fetch, then apply" is confirmAndApplyPublishStatus
// (_shared/tiktok-publish-utils.ts, Task B6) — shared with tiktok-webhook's
// post.publish.complete/failed handling. This phase still owns getting one fresh access token
// per account (see the module comment at the top of this file) and passes it into the shared
// function for every post in that account's batch.

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
        await markTikTokPublishFailed(svc, post.post_id, post.tiktok_publish_retry_count, message);
        failed++;
      }
      continue;
    }

    for (const post of accountPosts) {
      const outcome = await confirmAndApplyPublishStatus(
        { svc, tiktokFetch, accessToken, now },
        {
          post_id: post.post_id,
          tiktok_publish_id: post.tiktok_publish_id,
          tiktok_publish_retry_count: post.tiktok_publish_retry_count,
          tiktok_username: post.tiktok_username,
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
// Purely a state reset — no TikTok API calls here. tiktok_publish_status/error are cleared and
// the card goes back to `agendado`; the NEXT run's init phase (tiktok_publish_status IS NULL)
// picks it up fresh, with a newly-signed presign. The retry count itself was already
// incremented by markTikTokPublishFailed at failure time — this phase
// never touches it.

async function processRetryPhase(
  deps: TikTokPublishCronDeps,
  posts: ClaimedTikTokCronPost[],
): Promise<PhaseResult> {
  const { svc } = deps;
  let succeeded = 0;
  let failed = 0;

  for (const post of posts) {
    try {
      const { error: resetErr } = await svc
        .from("workflow_posts")
        .update({
          tiktok_publish_status: null,
          tiktok_publish_error: null,
          tiktok_publish_processing_at: null,
        })
        .eq("id", post.post_id);
      if (resetErr) throw new Error(`Falha ao resetar post para nova tentativa: ${resetErr.message}`);

      const { error: rpcErr } = await svc.rpc("record_post_status_change", {
        p_post_id: post.post_id,
        p_new_status: "agendado",
        p_source: "system",
        p_actor: null,
        p_fields: {},
      });
      if (rpcErr) throw new Error(`record_post_status_change falhou: ${rpcErr.message}`);

      succeeded++;
    } catch (err) {
      console.error(`[${CRON_NAME}] retry reset failed for post ${post.post_id}:`, errorMessage(err));
      // Best-effort: the reset update above already clears the lock when it succeeds; if THAT
      // write itself failed, clear it explicitly so the post doesn't sit locked for the full
      // 10-minute stale-reclaim window on top of the retry it already lost.
      await clearLock(svc, post.post_id);
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

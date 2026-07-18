// supabase/functions/tiktok-publish-cron/core.ts
//
// TikTok Phase B, Task B5: every-minute init/status/retry publish engine — the TikTok
// counterpart to instagram-publish-cron/index.ts (that file keeps its phase logic inline;
// this one is split into core.ts/handler.ts/index.ts per tiktok-refresh-cron's convention
// (Task A6), since it needs the same DI seams for its own network/crypto-touching calls).
//
// Three phases via claim_posts_for_tiktok_publishing (init/status/retry). Every claimed post's
// tiktok_publish_processing_at lock is cleared on EVERY exit path — success, deferred (design
// not ready, per-account overflow), or failure — so nothing outlives the RPC's 10-minute
// stale-reclaim window by leaning on it. markTikTokFailed and the plain workflow_posts updates
// used elsewhere in this file all clear the lock explicitly as part of their write.
//
// getFreshTikTokToken (_shared/tiktok.ts) is called ONCE PER ACCOUNT PER RUN — posts are
// grouped by tiktok_account_id in the init and status phases before any token fetch — never
// per post; that file's module comment explains why concurrent refreshes race the rotating
// refresh token. Media presigned URLs (signGetUrl) are regenerated on every attempt, never
// cached/reused across retries — an expired presign would otherwise permanently fail an
// otherwise-retryable post.
//
// `svc` is created and hoisted by the caller (index.ts) BEFORE the outer try in
// runTikTokPublishCron, so a failure before any phase even runs still reaches
// reportCronFailure — the retention initiative's cron-failure silent-death lesson (see
// tiktok-refresh-cron/core.ts's identical comment, and instagram-publish-cron/index.ts).

import type { CronFailureDetail } from "../_shared/notify.ts";
import {
  checkDesignReadiness as realCheckDesignReadiness,
  fetchPostMedia as realFetchPostMedia,
  type DesignReadiness,
} from "../_shared/instagram-publish-utils.ts";
import {
  buildPhotoInitPayload,
  buildVideoInitPayload,
  mapStatusFetch,
  type ClaimedTikTokPost,
  type TikTokSettings,
} from "../_shared/tiktok-publish-utils.ts";
import { RETRYABLE_FAIL_REASONS } from "../_shared/tiktok.ts";

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
  signGetUrl: (key: string, expiresSeconds?: number) => Promise<string>;
  reportCronFailure: (svc: DbClient, cronName: string, detail: CronFailureDetail) => Promise<void>;
  /** Optional DI seams — default to the real shared implementations. Tests may override, but
   * normally just queue `post_file_links`/`designs` responses on the mock db and let the real
   * (platform-agnostic, already-exported) helpers run. */
  fetchPostMedia?: (db: DbClient, postId: number) => Promise<FetchedMediaFile[]>;
  checkDesignReadiness?: (db: DbClient, postId: number) => Promise<DesignReadiness>;
  now?: () => Date;
}

interface PhaseResult {
  succeeded: number;
  failed: number;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (
    err && typeof err === "object" && "message" in err &&
    typeof (err as { message?: unknown }).message === "string"
  ) {
    return (err as { message: string }).message;
  }
  return "unknown";
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

/** Releases the tiktok_publish_processing_at lock WITHOUT touching tiktok_publish_status —
 * used when a post is deferred (design not ready yet, per-account overflow) rather than
 * failed, so the next run's claim can pick it straight back up. */
async function clearLock(svc: DbClient, postId: number): Promise<void> {
  const { error } = await svc
    .from("workflow_posts")
    .update({ tiktok_publish_processing_at: null })
    .eq("id", postId);
  if (error) {
    console.error(`[${CRON_NAME}] failed to clear lock for post ${postId}:`, error.message);
  }
}

/**
 * Marks a claimed post failed: `tiktok_publish_status='failed'`, a PT-BR-or-neutral error
 * message (≤500 chars), lock cleared, and the card moved to `falha_publicacao` via
 * record_post_status_change. `retryCount` is bumped by one UNLESS `failReason` is a TikTok
 * wire fail_reason string that is NOT in RETRYABLE_FAIL_REASONS (e.g.
 * `spam_risk_too_many_posts`) — those exhaust immediately (retry_count=3) since a retry can
 * never succeed. Generic infra failures (design render, network, TikTok init/status errors
 * with no documented fail_reason) are always retryable and simply increment, relying on the
 * claim RPC's `retry_count < 3` cutoff to eventually stop them.
 *
 * TOKEN_EXPIRED: the caller passes a clear PT-BR message (no `failReason`) — _shared/tiktok.ts's
 * getFreshTikTokToken has ALREADY flipped the account to authorization_status='expired' before
 * throwing, so no account write happens here. That status also drops the account out of the
 * claim RPC's join, so this post won't be reclaimed again until a fresh OAuth reconnect.
 *
 * Self-healing on partial failure: this function does TWO writes (the direct
 * tiktok_publish_status='failed' update, then the record_post_status_change RPC), and every
 * claim phase's WHERE clause only recognizes specific status+tiktok_publish_status PAIRS (see
 * claim_posts_for_tiktok_publishing). If either write fails outright, this function never lets
 * the two columns drift into an unrecognized pair — see the inline comments at each failure
 * branch below for exactly how each case converges back to a claimable state.
 */
async function markTikTokFailed(
  svc: DbClient,
  postId: number,
  retryCount: number,
  message: string,
  opts?: { failReason?: string },
): Promise<void> {
  const nonRetryable = opts?.failReason !== undefined && !RETRYABLE_FAIL_REASONS.includes(opts.failReason);
  const newRetryCount = nonRetryable ? 3 : retryCount + 1;

  const { error: updateErr } = await svc
    .from("workflow_posts")
    .update({
      tiktok_publish_status: "failed",
      tiktok_publish_error: message.slice(0, 500),
      tiktok_publish_retry_count: newRetryCount,
      tiktok_publish_processing_at: null,
    })
    .eq("id", postId);
  if (updateErr) {
    console.error(`[${CRON_NAME}] failed to persist failure state for post ${postId}:`, updateErr.message);
    // Write (1) itself failed: tiktok_publish_status was never set to 'failed', so the post is
    // left exactly as the claiming phase found it — status='agendado' paired with whatever
    // tiktok_publish_status that phase's own WHERE clause required (NULL for init, 'initiated'/
    // 'processing' for status; see claim_posts_for_tiktok_publishing). That pair is one the SAME
    // phase re-claims on its own once the lock's 10-minute stale window elapses — clearLock below
    // releases it immediately instead of making it wait — so this self-heals with no RPC needed.
    // Firing record_post_status_change anyway would flip status to 'falha_publicacao' while
    // tiktok_publish_status never became 'failed', producing a pair NO claim phase's WHERE clause
    // recognizes — permanently orphaning the post. So: log, best-effort clear the lock, and stop.
    await clearLock(svc, postId);
    return;
  }

  const { error: statusErr } = await svc.rpc("record_post_status_change", {
    p_post_id: postId,
    p_new_status: "falha_publicacao",
    p_source: "system",
    p_actor: null,
    p_fields: {},
  });
  if (statusErr) {
    console.error(`[${CRON_NAME}] record_post_status_change failed for post ${postId}:`, statusErr.message);
    // Write (1) already committed tiktok_publish_status='failed', but status is still 'agendado'
    // — a pair no claim phase's WHERE clause recognizes either (retry needs status=
    // 'falha_publicacao' AND tiktok_publish_status='failed' together). Compensate with a direct
    // status write so the retry phase can pick it back up next run. The status-capture trigger
    // (workflow_posts_status_event, migration 20260606000001) still records the transition off
    // this direct UPDATE; losing actor/source context on this backstop path is acceptable.
    const { error: compensateErr } = await svc
      .from("workflow_posts")
      .update({ status: "falha_publicacao" })
      .eq("id", postId);
    if (compensateErr) {
      // Both writes failed: the post is stuck as status='agendado' + tiktok_publish_status=
      // 'failed', a pair no claim phase recognizes — it will NOT self-heal on its own. The run's
      // reportCronFailure alert (fired from the totalFailed>0 branch in runTikTokPublishCron) is
      // the human signal that something needs attention; this loud marker is for whoever is
      // reading logs off that alert to find the specific orphaned post.
      console.error(
        `[TIKTOK-CRON] ORPHAN RISK post ${postId}: failed+agendado state, manual fix needed`,
      );
    }
  }
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
  const { svc, getFreshTikTokToken, tiktokFetch, signGetUrl } = deps;
  const fetchPostMedia = deps.fetchPostMedia ?? realFetchPostMedia;
  const checkDesignReadiness = deps.checkDesignReadiness ?? realCheckDesignReadiness;

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
        await markTikTokFailed(svc, post.post_id, post.tiktok_publish_retry_count, message);
        failed++;
      }
      continue;
    }

    for (const post of toProcess) {
      try {
        // Re-check (design doc §5.3 / T4.2 parity with instagram-publish-cron): the scheduling
        // gate already enforced this, but the design can go stale/fail between scheduling and
        // this cron cycle (an edit in the editor, an MCP write, a failed re-render).
        const readiness = await checkDesignReadiness(svc, post.post_id);
        if (!readiness.ready && readiness.design) {
          if (readiness.design.render_status === "failed") {
            throw new Error("Arte do Estúdio falhou ao renderizar — publicação bloqueada.");
          }
          await clearLock(svc, post.post_id);
          console.log(`[${CRON_NAME}] Post ${post.post_id} deferred: design not rendered yet.`);
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
          const videoUrl = await signGetUrl(videoFile.r2_key, 7200);
          initPath = "/post/publish/video/init/";
          initPayload = buildVideoInitPayload(claimedForBuilder, videoUrl);
        } else {
          if (media.length === 0) throw new Error("Post sem arquivos de mídia vinculados.");
          const imageUrls = await Promise.all(media.map((f) => signGetUrl(f.r2_key, 7200)));
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
        await markTikTokFailed(svc, post.post_id, post.tiktok_publish_retry_count, errorMessage(err));
        failed++;
      }
    }
  }

  return { succeeded, failed };
}

// --- Phase 2: status ---

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
        await markTikTokFailed(svc, post.post_id, post.tiktok_publish_retry_count, message);
        failed++;
      }
      continue;
    }

    for (const post of accountPosts) {
      try {
        if (!post.tiktok_publish_id) {
          throw new Error("Post sem publish_id do TikTok para consultar status.");
        }

        const statusData = await tiktokFetch("/post/publish/status/fetch/", {
          method: "POST",
          accessToken,
          body: JSON.stringify({ publish_id: post.tiktok_publish_id }),
        });
        const result = mapStatusFetch(statusData);

        if (result.state === "published") {
          const tiktokPostUrl = result.publicPostId && post.tiktok_username
            ? `https://www.tiktok.com/@${post.tiktok_username}/video/${result.publicPostId}`
            : undefined;

          const { error: markErr } = await svc.rpc("mark_platform_published", {
            p_post_id: post.post_id,
            p_platform: "tiktok",
            p_source: "system",
            p_actor: null,
            p_fields: {
              ...(result.publicPostId ? { tiktok_post_id: result.publicPostId } : {}),
              ...(tiktokPostUrl ? { tiktok_post_url: tiktokPostUrl } : {}),
              published_at: now().toISOString(),
            },
          });
          if (markErr) throw new Error(`mark_platform_published falhou: ${markErr.message}`);

          succeeded++;
          console.log(`[${CRON_NAME}] Published post ${post.post_id} on TikTok.`);
        } else if (result.state === "processing") {
          const { error: updErr } = await svc
            .from("workflow_posts")
            .update({ tiktok_publish_status: "processing", tiktok_publish_processing_at: null })
            .eq("id", post.post_id);
          if (updErr) throw new Error(`Falha ao atualizar status de processamento: ${updErr.message}`);

          succeeded++;
        } else {
          const failReason = result.failReason;
          const message = failReason
            ? `Falha ao publicar no TikTok: ${failReason}`
            : "Falha ao publicar no TikTok.";
          await markTikTokFailed(svc, post.post_id, post.tiktok_publish_retry_count, message, { failReason });
          failed++;
        }
      } catch (err) {
        await markTikTokFailed(svc, post.post_id, post.tiktok_publish_retry_count, errorMessage(err));
        failed++;
      }
    }
  }

  return { succeeded, failed };
}

// --- Phase 3: retry ---
//
// Purely a state reset — no TikTok API calls here. tiktok_publish_status/error are cleared and
// the card goes back to `agendado`; the NEXT run's init phase (tiktok_publish_status IS NULL)
// picks it up fresh, with a newly-signed presign and a re-checked design readiness. The retry
// count itself was already incremented by markTikTokFailed at failure time — this phase never
// touches it.

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

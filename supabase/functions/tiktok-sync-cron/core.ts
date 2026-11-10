// supabase/functions/tiktok-sync-cron/core.ts
//
// TikTok Phase C, Task C4: hourly sync — profile stats, video import/metric refresh, daily
// snapshot + follower-history rows, and webhook-event purge. Clone of instagram-sync-cron's
// shape (select -> workspace feature gate -> concurrency pool -> per-account try/catch),
// reusing this integration's OWN already-built pieces instead of re-deriving them:
//   - getFreshTikTokToken (_shared/tiktok.ts) — the only token read/refresh path.
//   - importTikTokVideos / refreshStoredPostMetrics (tiktok-integration/import.ts) — the SAME
//     video-list-page + video-query-metric-refresh + thumbnail-cache logic the OAuth callback
//     and manual /sync route already use (design doc: "Import — same code path as sync").
//   - runPool (instagram-sync-cron/pool.ts) — a plain generic concurrency helper with no
//     Instagram-specific code inside it; imported directly rather than re-implemented.
//   - errorMessage (_shared/tiktok-publish-utils.ts) — shared Error/PostgrestError message
//     extraction, already used by tiktok-publish-cron/core.ts and tiktok-webhook.
//
// `svc` is created and hoisted by the caller (index.ts) BEFORE the outer try, so a broken
// account query still reaches reportCronFailure (see tiktok-refresh-cron/core.ts's identical
// comment — the retention initiative's cron-failure silent-death lesson).
//
// Scheduling (same model as instagram-sync-cron, reusing its select.ts unchanged): the cron runs
// hourly (`30 * * * *`). An account is eligible when BOTH its last success and its last attempt
// are older than 6h; candidates are paged least-recently-attempted first, filtered by workspace
// (feature_auto_sync_cron AND feature_tiktok, not internal), then cut to `batchLimit`
// (SYNC_BATCH_LIMIT, default 25, shared with the Instagram cron). The selected batch is CLAIMED
// before any TikTok call: one conditional UPDATE stamps last_sync_attempt_at and returns the
// rows it actually won, so an overlapping run or a run that dies partway never re-picks the same
// accounts, and only the claimed ids are synced. A failed claim aborts the run (500 + report).
//
// Profile stats come back from tiktokFetch's `user/info` call already unwrapped one level
// (tiktokFetch returns the envelope's `data` field), but TikTok nests the actual fields ONE
// level deeper still, under `user`: `{ user: { follower_count, ... } }`. Reading fields off the
// top-level result directly (skipping `.user`) was Task A6's bug — every stat silently reads
// undefined instead of throwing, so it never surfaces as a failure unless the test's mock shape
// is realistic. Every profile-stat read in this file goes through `profile.user?.X`.
//
// Follower history for "today" is written only when no row exists yet OR the existing row's
// source is 'api' — a `source='manual'` row (an operator manually correcting a stat) is never
// overwritten by the cron, the same rule instagram-sync-cron enforces for
// instagram_follower_history.
//
// Webhook-event purge (tiktok_webhook_events, 30-day retention) runs unconditionally on every
// invocation, independent of whether there were any accounts to sync — it is NOT gated by
// feature_auto_sync_cron (that flag only gates account-level TikTok API calls). Only PROCESSED
// rows are purged (received_at < 30d AND processed_at IS NOT NULL); unprocessed rows are
// evidence of a webhook that crashed before processing and are left for investigation (design
// doc: "Unprocessed rows... are swept by the next tiktok-publish-cron run").

import type { CronFailureDetail } from "../_shared/notify.ts";
import { saoPauloDate } from "../_shared/sao-paulo-date.ts";
import { errorMessage } from "../_shared/tiktok-publish-utils.ts";
import type { CacheThumbnailDeps } from "../_shared/tiktok-thumbnail-cache.ts";
import {
  importTikTokVideos as realImportTikTokVideos,
  refreshStoredPostMetrics as realRefreshStoredPostMetrics,
} from "../tiktok-integration/import.ts";
import { runPool } from "../instagram-sync-cron/pool.ts";
import { collectSyncCandidates, contaIdOf, selectAccountsToSync } from "../instagram-sync-cron/select.ts";
import { fetchInternalWorkspaceIds as realFetchInternalWorkspaceIds } from "../_shared/internal-workspaces.ts";

// deno-lint-ignore no-explicit-any
type DbClient = any;

const CRON_NAME = "tiktok-sync-cron";
const LAST_SYNCED_WINDOW_MS = 6 * 60 * 60 * 1000; // 6 hours
const WEBHOOK_EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
// Design doc / task brief: the daily sync only re-checks "video.list first 2 pages" (vs. up to
// 100 videos / 10 pages on the OAuth-callback initial import) — 2 pages * 20/page.
const SYNC_IMPORT_MAX_VIDEOS = 40;
const DEFAULT_CONCURRENCY = 5;
const DEFAULT_BATCH_LIMIT = 25;
const CANDIDATE_PAGE_SIZE = 200;
const MAX_CANDIDATE_PAGES = 10;
const CLAIM_CHUNK_SIZE = 100;

const PROFILE_FIELDS = "follower_count,following_count,likes_count,video_count";

interface TikTokAccountRow {
  id: string;
  client_id: string | number;
  follower_count: number | null;
  following_count: number | null;
  likes_count: number | null;
  video_count: number | null;
  last_sync_attempt_at?: string | null;
  clientes: { conta_id: string } | { conta_id: string }[];
}

export interface TikTokSyncCronDeps {
  /** Created and hoisted by the caller (index.ts) BEFORE the outer try. */
  svc: DbClient;
  /** The ONLY code path allowed to read/refresh TikTok tokens — see _shared/tiktok.ts. */
  getFreshTikTokToken: (svc: DbClient, accountId: string) => Promise<{ accessToken: string; openId: string }>;
  reportCronFailure: (svc: DbClient, cronName: string, detail: CronFailureDetail) => Promise<void>;
  /** Authenticated TikTok API fetch wrapper (_shared/tiktok.ts's tiktokFetch). */
  tiktokFetch: (path: string, init: RequestInit & { accessToken: string }) => Promise<unknown>;
  effectivePlanFeature: (svc: DbClient, workspaceId: string, featureKey: string) => Promise<boolean>;
  /** Workspaces flagged `is_internal` are skipped entirely. Defaults to the real
   * _shared/internal-workspaces.ts lookup; overridable so tests need no workspaces table. */
  fetchInternalWorkspaceIds?: (svc: DbClient) => Promise<Set<string>>;
  /** Default to the real tiktok-integration/import.ts helpers — overridable so tests never
   * touch real network/storage calls. */
  importTikTokVideos?: (
    deps: CacheThumbnailDeps,
    svc: DbClient,
    accountId: string,
    accessToken: string,
    opts?: { maxVideos?: number },
  ) => Promise<number>;
  refreshStoredPostMetrics?: (deps: { svc: DbClient }, accountId: string, accessToken: string) => Promise<number>;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  /** Defaults to SYNC_CONCURRENCY env var (index.ts) or 5. */
  concurrency?: number;
  /** Max accounts claimed and synced per invocation. Defaults to 25 (SYNC_BATCH_LIMIT in index.ts). */
  batchLimit?: number;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Syncs a single TikTok account: fresh token -> profile stats -> video import -> stored-post
 * metric refresh -> daily snapshot + follower-history rows. Throws on any failure so the
 * caller's per-account try/catch (inside the pool callback) can isolate it from the rest of
 * the batch — this function must never swallow an error itself. */
async function processAccount(deps: TikTokSyncCronDeps, account: TikTokAccountRow): Promise<void> {
  const { svc, getFreshTikTokToken, tiktokFetch } = deps;
  const importVideos = deps.importTikTokVideos ?? realImportTikTokVideos;
  const refreshMetrics = deps.refreshStoredPostMetrics ?? realRefreshStoredPostMetrics;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now?.() ?? new Date();
  // São Paulo calendar day, the same bucket the analytics windows and follower history use.
  const today = saoPauloDate(now);

  const { accessToken } = await getFreshTikTokToken(svc, account.id);

  const profileResult = (await tiktokFetch(`/user/info/?fields=${PROFILE_FIELDS}`, {
    method: "GET",
    accessToken,
  })) as { user?: Record<string, unknown> };
  // See module comment: TikTok nests profile fields under `.user` — never read top-level.
  const profile = profileResult.user ?? {};

  const followerCount = (profile.follower_count as number | undefined) ?? account.follower_count;
  const followingCount = (profile.following_count as number | undefined) ?? account.following_count;
  const likesCount = (profile.likes_count as number | undefined) ?? account.likes_count;
  const videoCount = (profile.video_count as number | undefined) ?? account.video_count;

  // Check for a manual follower-history entry BEFORE writing account stats, mirroring
  // tiktok-integration/handlers.ts::handleSync's ordering exactly (same route, same rule).
  const { data: existingEntry } = await svc
    .from("tiktok_follower_history")
    .select("source")
    .eq("tiktok_account_id", account.id)
    .eq("date", today)
    .maybeSingle();
  const shouldWriteHistory = !existingEntry || (existingEntry as { source?: string }).source !== "manual";

  const { error: accountUpdateErr } = await svc.from("tiktok_accounts").update({
    follower_count: followerCount,
    following_count: followingCount,
    likes_count: likesCount,
    video_count: videoCount,
    last_synced_at: now.toISOString(),
  }).eq("id", account.id);
  if (accountUpdateErr) {
    throw new Error(`Falha ao atualizar estatísticas da conta TikTok: ${errorMessage(accountUpdateErr)}`);
  }

  if (shouldWriteHistory) {
    const { error: historyErr } = await svc.from("tiktok_follower_history").upsert({
      tiktok_account_id: account.id,
      date: today,
      follower_count: followerCount ?? 0,
      source: "api",
    }, { onConflict: "tiktok_account_id,date" });
    if (historyErr) {
      throw new Error(`Falha ao gravar histórico de seguidores do TikTok: ${errorMessage(historyErr)}`);
    }
  }

  const { error: snapshotErr } = await svc.from("tiktok_account_metrics_daily").upsert({
    tiktok_account_id: account.id,
    snapshot_date: today,
    follower_count: followerCount ?? null,
    following_count: followingCount ?? null,
    likes_count: likesCount ?? null,
    video_count: videoCount ?? null,
  }, { onConflict: "tiktok_account_id,snapshot_date" });
  if (snapshotErr) {
    throw new Error(`Falha ao gravar snapshot diário do TikTok: ${errorMessage(snapshotErr)}`);
  }

  // Video import (new videos + thumbnail cache) and stored-post metric refresh — same helpers
  // the OAuth callback and manual /sync route call, so cover-thumbnail caching and upsert
  // behavior stay identical across every entry point (design doc: "same code path as sync").
  await importVideos({ fetch: fetchImpl, storage: svc.storage }, svc, account.id, accessToken, {
    maxVideos: SYNC_IMPORT_MAX_VIDEOS,
  });
  await refreshMetrics({ svc }, account.id, accessToken);
}

/** Deletes tiktok_webhook_events rows older than 30 days that have ALREADY been processed.
 * Runs unconditionally every invocation — see module comment for why unprocessed rows are
 * deliberately left alone. Never throws: a purge failure is reported alongside account
 * failures but must not mask/replace the sync results in the response. */
async function purgeOldWebhookEvents(
  deps: TikTokSyncCronDeps,
  now: Date,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const cutoffIso = new Date(now.getTime() - WEBHOOK_EVENT_RETENTION_MS).toISOString();
  const { error } = await deps.svc
    .from("tiktok_webhook_events")
    .delete()
    .lt("received_at", cutoffIso)
    .not("processed_at", "is", null);
  if (error) {
    const message = errorMessage(error);
    console.error(`[${CRON_NAME}] webhook event purge failed:`, message);
    return { ok: false, error: message };
  }
  return { ok: true };
}

export async function runTikTokSyncCron(deps: TikTokSyncCronDeps): Promise<Response> {
  const { svc, reportCronFailure } = deps;
  const now = deps.now?.() ?? new Date();

  try {
    const sixHoursAgoIso = new Date(now.getTime() - LAST_SYNCED_WINDOW_MS).toISOString();

    const batchLimit = Math.max(1, deps.batchLimit ?? DEFAULT_BATCH_LIMIT);
    const staleClause = (column: string) => `${column}.is.null,${column}.lt.${sixHoursAgoIso}`;
    const internalWorkspaces = await (deps.fetchInternalWorkspaceIds ?? realFetchInternalWorkspaceIds)(svc);

    const { candidates, allowedWorkspaces } = await collectSyncCandidates<TikTokAccountRow>(
      {
        internalWorkspaces,
        fetchPage: async (from, size) => {
          const { data, error } = await svc
            .from("tiktok_accounts")
            .select(
              "id, client_id, follower_count, following_count, likes_count, video_count, last_sync_attempt_at, clientes!inner(conta_id)",
            )
            .eq("authorization_status", "active")
            .eq("auto_sync_enabled", true)
            // Eligibility needs a stale success AND a stale attempt: a failing account is
            // retried at most every 6h instead of on every hourly run.
            .or(staleClause("last_synced_at"))
            .or(staleClause("last_sync_attempt_at"))
            .order("last_sync_attempt_at", { ascending: true, nullsFirst: true })
            // Tie-break on id so .range() has a total order across pages.
            .order("id", { ascending: true })
            .range(from, from + size - 1);
          if (error) throw error;
          return (data ?? []) as TikTokAccountRow[];
        },
        // One RPC pair per distinct workspace: it needs the cron flag AND the TikTok flag.
        resolveAllowedWorkspaces: async (wsIds) => {
          const results = await Promise.all(wsIds.map(async (wsId) => {
            const [autoSync, tiktok] = await Promise.all([
              deps.effectivePlanFeature(svc, wsId, "feature_auto_sync_cron"),
              deps.effectivePlanFeature(svc, wsId, "feature_tiktok"),
            ]);
            return autoSync && tiktok ? wsId : null;
          }));
          return results.filter((ws): ws is string => ws !== null);
        },
      },
      { pageSize: CANDIDATE_PAGE_SIZE, maxPages: MAX_CANDIDATE_PAGES, targetEligible: batchLimit },
    );

    const { selected, deferred, skippedInternal } = selectAccountsToSync(candidates, {
      allowedWorkspaces,
      internalWorkspaces,
      limit: batchLimit,
    });
    if (skippedInternal > 0) {
      console.log(`[${CRON_NAME}] Skipped ${skippedInternal} account(s) in internal workspaces`);
    }

    let syncedCount = 0;
    let failedCount = 0;
    const errors: Array<{ accountId: string; error: string }> = [];
    let claimedCount = 0;

    if (selected.length > 0) {
      // Claim the batch before any TikTok call. The conditional `or` makes the update win only
      // rows still stale, so a concurrent run cannot claim the same account twice.
      // `last_sync_attempt_at` MUST stay in the projection below: prod's PostgREST resolves
      // columns named inside an or-filter of an UPDATE against the ?select= projection and
      // raises `42703 column tiktok_accounts.last_sync_attempt_at does not exist` when it is
      // absent (staging and the mock do not reproduce it; same rule as the refresh-lock claim
      // in _shared/tiktok.ts, reproduced against prod 2026-08-20). Ids go in chunks so the
      // `in.(...)` URL stays short; a failure in any chunk aborts the run.
      const claimedIds = new Set<string>();
      const selectedIds = selected.map((a) => a.id);
      for (let i = 0; i < selectedIds.length; i += CLAIM_CHUNK_SIZE) {
        const { data: claimed, error: claimErr } = await svc
          .from("tiktok_accounts")
          .update({ last_sync_attempt_at: now.toISOString() })
          .in("id", selectedIds.slice(i, i + CLAIM_CHUNK_SIZE))
          .or(staleClause("last_sync_attempt_at"))
          .select("id, last_sync_attempt_at");
        if (claimErr) throw claimErr;
        for (const r of (claimed ?? []) as Array<{ id: string }>) claimedIds.add(r.id);
      }

      const toSync = selected.filter((a) => claimedIds.has(a.id));
      claimedCount = toSync.length;

      const concurrency = Math.max(1, deps.concurrency ?? DEFAULT_CONCURRENCY);
      await runPool(toSync, concurrency, async (account) => {
        try {
          await processAccount(deps, account);
          syncedCount++;
          console.log(`[${CRON_NAME}] Synced account ${account.id}`);
        } catch (err) {
          failedCount++;
          const message = errorMessage(err);
          errors.push({ accountId: account.id, error: message });
          console.error(`[${CRON_NAME}] account ${account.id} failed:`, message);
        }
      });
    }

    const purgeResult = await purgeOldWebhookEvents(deps, now);
    if (!purgeResult.ok) {
      failedCount++;
      errors.push({ accountId: "webhook-purge", error: purgeResult.error });
    }

    console.log(`[${CRON_NAME}] Done. Synced: ${syncedCount}, Failed: ${failedCount}`);

    if (failedCount > 0) {
      await reportCronFailure(svc, CRON_NAME, { total: claimedCount, failed: failedCount, errors });
    }

    return json({ success: true, synced: syncedCount, failed: failedCount, total: claimedCount, deferred }, 200);
  } catch (err) {
    const message = errorMessage(err);
    console.error(`[${CRON_NAME}] failed:`, message);
    await reportCronFailure(svc, CRON_NAME, {
      stack: err instanceof Error ? err.stack ?? message : message,
    });
    return json({ error: "Internal server error" }, 500);
  }
}

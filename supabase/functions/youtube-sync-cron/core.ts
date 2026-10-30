// supabase/functions/youtube-sync-cron/core.ts
//
// Hourly YouTube channel sync (Phase 2 plan Task 7, ruling P1; spec §5.1). Same shape as
// tiktok-sync-cron: candidates -> workspace gate -> batch stamp -> runPool -> per-unit outcome ->
// failure report, plus the youtube_pdf_purges drain (§4.6).
//
// Candidates (P1): active channels whose last successful sync is NULL or older than 20 h, or whose
// data_through is NULL (google_mark_revoked's purge resets watermarks but keeps last_synced_at, so
// a reconnected channel re-backfills on the next hour instead of ~20 h later). Ordered by
// last_sync_attempt_at NULLS FIRST, id, and paged (200 per page, at most 10 pages) until the batch
// limit of eligible units is found: ineligible units (flags off, internal workspace) cluster at the
// head of that order, so one fixed window would starve the eligible ones (instagram-sync-cron
// select.ts). Every candidate examined, eligible or not, is stamped before any work, so units
// that can never sync rotate to the back.
//
// Eligibility: feature_youtube AND feature_auto_sync_cron, one lookup pair per workspace; internal
// workspaces are skipped without a lookup.
//
// The pool runs over CONNECTIONS, channels of one connection in sequence: when the token path says
// REVOKED (google_mark_revoked already purged every channel on it), the remaining channels of that
// connection are counted `skipped` without a token call (Review Focus 2: one dead connection, no
// failure storm). Only unexpected errors count as `failed` and reach reportCronFailure; quota,
// mismatch, re-auth and revocation are outcomes (Global Constraints, "Outcomes, not failures").
//
// `svc` is created by index.ts before the outer try, so a broken candidate query still reaches
// reportCronFailure.

import type { DbClient } from "../_shared/google.ts";
import type { CronFailureDetail } from "../_shared/notify.ts";
import { errorMessage } from "../_shared/tiktok-publish-utils.ts";
import { fetchInternalWorkspaceIds as realFetchInternalWorkspaceIds } from "../_shared/internal-workspaces.ts";
import {
  drainYoutubePdfPurges as realDrainYoutubePdfPurges,
  type StorageLike,
} from "../_shared/youtube-pdf-purges.ts";
import {
  MAX_VIDEO_REPORTS_PER_RUN,
  syncYouTubeChannel,
  YOUTUBE_CHANNEL_SYNC_COLUMNS,
  type YoutubeApi,
  type YoutubeChannelRow,
} from "../_shared/youtube-sync.ts";
import { runPool } from "../instagram-sync-cron/pool.ts";

const CRON_NAME = "youtube-sync-cron";
const SYNC_WINDOW_MS = 20 * 60 * 60 * 1000;
const PAGE_SIZE = 200;
const MAX_PAGES = 10;
const DEFAULT_BATCH_LIMIT = 25;
const DEFAULT_CONCURRENCY = 4;
const PDF_PURGE_LIMIT = 50;
const PDF_PURGE_MAX_ATTEMPTS = 10;

export interface YouTubeSyncCronDeps {
  /** Created and hoisted by index.ts before the outer try. */
  svc: DbClient;
  api: YoutubeApi;
  getFreshGoogleToken: (svc: DbClient, connectionId: string) => Promise<string>;
  reportCronFailure: (svc: DbClient, cronName: string, detail: CronFailureDetail) => Promise<void>;
  effectivePlanFeature: (svc: DbClient, workspaceId: string, featureKey: string) => Promise<boolean>;
  fetchInternalWorkspaceIds?: (svc: DbClient) => Promise<Set<string>>;
  drainYoutubePdfPurges?: typeof realDrainYoutubePdfPurges;
  /** Storage client for the PDF drain; defaults to svc.storage. */
  storage?: StorageLike;
  now?: () => Date;
  /** GOOGLE_SYNC_BATCH_LIMIT (default 25). */
  batchLimit?: number;
  /** GOOGLE_SYNC_CONCURRENCY (default 4), in connections. */
  concurrency?: number;
  maxVideoReports?: number;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function collectCandidates(
  deps: YouTubeSyncCronDeps,
  now: Date,
  batchLimit: number,
): Promise<{ examined: YoutubeChannelRow[]; eligible: YoutubeChannelRow[] }> {
  const { svc } = deps;
  const cutoff = new Date(now.getTime() - SYNC_WINDOW_MS).toISOString();
  const internal = await (deps.fetchInternalWorkspaceIds ?? realFetchInternalWorkspaceIds)(svc);
  const allowed = new Map<string, boolean>();
  const examined: YoutubeChannelRow[] = [];
  const eligible: YoutubeChannelRow[] = [];

  for (let page = 0; page < MAX_PAGES && eligible.length < batchLimit; page++) {
    const from = page * PAGE_SIZE;
    const { data, error } = await svc
      .from("youtube_channels")
      .select(YOUTUBE_CHANNEL_SYNC_COLUMNS)
      .eq("authorization_status", "active")
      .or(`last_synced_at.is.null,last_synced_at.lt.${cutoff},data_through.is.null`)
      .order("last_sync_attempt_at", { ascending: true, nullsFirst: true })
      // Total order: without the id tie-break .range() can skip or repeat rows across pages.
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as YoutubeChannelRow[];

    const unchecked = [...new Set(rows.map((r) => r.conta_id))].filter((ws) => !allowed.has(ws));
    await Promise.all(unchecked.map(async (ws) => {
      if (internal.has(ws)) {
        allowed.set(ws, false);
        return;
      }
      const [youtube, autoSync] = await Promise.all([
        deps.effectivePlanFeature(svc, ws, "feature_youtube"),
        deps.effectivePlanFeature(svc, ws, "feature_auto_sync_cron"),
      ]);
      allowed.set(ws, youtube && autoSync);
    }));

    for (const row of rows) {
      examined.push(row);
      if (allowed.get(row.conta_id)) eligible.push(row);
    }
    if (rows.length < PAGE_SIZE) break;
  }

  if (eligible.length < batchLimit && examined.length >= MAX_PAGES * PAGE_SIZE) {
    console.warn(`[${CRON_NAME}] stopped after ${MAX_PAGES} pages without filling the batch`);
  }
  return { examined, eligible };
}

/** Stamps last_sync_attempt_at on every examined candidate, one update per page-sized chunk.
 * A failed stamp is logged, not fatal: the next run re-reads the real ordering. */
async function stampAttempts(svc: DbClient, rows: YoutubeChannelRow[], now: Date): Promise<void> {
  const stampedAt = now.toISOString();
  for (let i = 0; i < rows.length; i += PAGE_SIZE) {
    const ids = rows.slice(i, i + PAGE_SIZE).map((r) => r.id);
    const { error } = await svc.from("youtube_channels").update({ last_sync_attempt_at: stampedAt }).in("id", ids);
    if (error) console.error(`[${CRON_NAME}] failed to stamp last_sync_attempt_at: ${error.message}`);
  }
}

export async function runYouTubeSyncCron(deps: YouTubeSyncCronDeps): Promise<Response> {
  const { svc } = deps;
  const now = deps.now?.() ?? new Date();
  const batchLimit = Math.max(1, deps.batchLimit ?? DEFAULT_BATCH_LIMIT);
  const concurrency = Math.max(1, deps.concurrency ?? DEFAULT_CONCURRENCY);
  const maxVideoReports = deps.maxVideoReports ?? MAX_VIDEO_REPORTS_PER_RUN;

  try {
    const { examined, eligible } = await collectCandidates(deps, now, batchLimit);
    const selected = eligible.slice(0, batchLimit);
    if (examined.length > 0) await stampAttempts(svc, examined, now);

    const counts = { synced: 0, revoked: 0, quotaSkipped: 0, skipped: 0, failed: 0 };
    const errors: Array<{ channelId: string; error: string }> = [];

    const byConnection = new Map<string, YoutubeChannelRow[]>();
    for (const ch of selected) {
      const group = byConnection.get(ch.connection_id) ?? [];
      group.push(ch);
      byConnection.set(ch.connection_id, group);
    }
    const revokedConnections = new Set<string>();

    await runPool([...byConnection.values()], concurrency, async (group) => {
      for (const channel of group) {
        if (revokedConnections.has(channel.connection_id)) {
          counts.skipped++;
          continue;
        }
        try {
          const outcome = await syncYouTubeChannel(
            { svc, api: deps.api, getFreshGoogleToken: deps.getFreshGoogleToken, now: deps.now ?? (() => new Date()) },
            channel,
            { now, maxVideoReports },
          );
          if (outcome.connectionRevoked) revokedConnections.add(channel.connection_id);
          switch (outcome.status) {
            case "synced":
              counts.synced++;
              break;
            case "revoked":
              counts.revoked++;
              break;
            case "quota_skipped":
              counts.quotaSkipped++;
              break;
            case "skipped":
            case "mismatch":
              counts.skipped++;
              break;
          }
        } catch (err) {
          counts.failed++;
          const message = errorMessage(err);
          errors.push({ channelId: channel.id, error: message });
          console.error(`[${CRON_NAME}] channel row ${channel.id} failed:`, message);
        }
      }
    });

    const drain = deps.drainYoutubePdfPurges ?? realDrainYoutubePdfPurges;
    try {
      const storage = deps.storage ?? (svc.storage as unknown as StorageLike);
      const purge = await drain(svc, { storage, limit: PDF_PURGE_LIMIT, maxAttempts: PDF_PURGE_MAX_ATTEMPTS });
      const purgeFailures = purge.failed + purge.gaveUp;
      if (purgeFailures > 0) {
        counts.failed += purgeFailures;
        errors.push({ channelId: "pdf-purges", error: `${purgeFailures} PDF purge(s) failed or gave up` });
      }
    } catch (err) {
      counts.failed++;
      errors.push({ channelId: "pdf-purges", error: errorMessage(err) });
      console.error(`[${CRON_NAME}] PDF purge drain failed:`, errorMessage(err));
    }

    console.log(
      `[${CRON_NAME}] Done. examined=${examined.length} selected=${selected.length} synced=${counts.synced} ` +
        `revoked=${counts.revoked} quotaSkipped=${counts.quotaSkipped} skipped=${counts.skipped} failed=${counts.failed}`,
    );

    if (counts.failed > 0) {
      await deps.reportCronFailure(svc, CRON_NAME, { total: selected.length, failed: counts.failed, errors });
    }

    return json({ success: true, ...counts, total: selected.length }, 200);
  } catch (err) {
    const message = errorMessage(err);
    console.error(`[${CRON_NAME}] failed:`, message);
    await deps.reportCronFailure(svc, CRON_NAME, {
      stack: err instanceof Error ? err.stack ?? message : message,
    });
    return json({ error: "Internal server error" }, 500);
  }
}

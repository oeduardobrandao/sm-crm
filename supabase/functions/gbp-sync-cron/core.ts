// supabase/functions/gbp-sync-cron/core.ts
//
// Hourly Google Meu Negócio sync (plan Task 8, spec §5.2; schedule `40 * * * *`, ruling P1), in
// two parts that never block each other:
//
// 1. Sync batch. Candidates are `gbp_locations` with status 'active', a connection, and
//    last_synced_at null or older than 20 h, read least-recently-ATTEMPTED first and paged until
//    GOOGLE_SYNC_BATCH_LIMIT eligible units are found (collectSyncCandidates from
//    instagram-sync-cron/select.ts: ineligible units cluster at the head of that order, so one
//    fixed window would starve the eligible ones). Eligible = the workspace has
//    feature_google_business AND feature_auto_sync_cron (one lookup pair per workspace) and is
//    not internal. The selected batch and every INELIGIBLE candidate examined are stamped with
//    last_sync_attempt_at BEFORE any work, so a unit that kills the run, or one that can never
//    sync, rotates to the back. Eligible candidates deferred by the batch cap keep their place:
//    stamping them too would send them behind the batch again every run and, once eligible
//    units outnumber the scan, starve the same ones forever. Units run through runPool with at
//    most 4 in flight (4 locations x ~4 calls stays far under the 300 QPM per API). The pool
//    callback swallows its own errors (runPool stops taking work after the first throw). Once a
//    connection's token comes back REVOKED, its other units are skipped without another call.
//    Only units whose sync throws count as failures (see _shared/gbp-sync.ts for the outcomes).
//
// 2. Deletion duties, each in its own try/catch, run after the batch on EVERY invocation:
//    regardless of plan flags, of an empty batch and of a failed candidate query, because they
//    are privacy duties (spec §4.2, §4.6):
//      - google_expire_units(): history and rows of units disconnected or revoked 30+ days ago,
//        then history left behind by a client or workspace delete (orphaned history rows);
//      - retryPendingRevocations: tokens still to be revoked at Google (P5);
//      - google_orphan_subs(25), then google_release_sub(sub) one sub per call, so no
//        transaction ever holds two sub locks (P4), each followed by processUnlinkDecisionData.
//    A sub is a Google account id: it is never logged or put in a failure report.
//
// `svc` is created by index.ts before this runs, so a broken query still reaches
// reportCronFailure (the cron-failure silent-death lesson, tiktok-sync-cron/core.ts).

import * as realGbpApi from "../_shared/gbp-api.ts";
import { type GbpLocationRow, GBP_LOCATION_COLUMNS, type GbpSyncDeps, type GbpSyncOutcome, syncGbpLocation } from "../_shared/gbp-sync.ts";
import { type DbClient, GoogleApiError } from "../_shared/google.ts";
import {
  processUnlinkDecisionData as realProcessUnlinkDecisionData,
  retryPendingRevocations as realRetryPendingRevocations,
} from "../_shared/google-revocations.ts";
import { fetchInternalWorkspaceIds as realFetchInternalWorkspaceIds } from "../_shared/internal-workspaces.ts";
import type { CronFailureDetail, CronFailureError } from "../_shared/notify.ts";
import { runPool } from "../instagram-sync-cron/pool.ts";
import { collectSyncCandidates, isEligible } from "../instagram-sync-cron/select.ts";

const CRON_NAME = "gbp-sync-cron";
const SYNC_WINDOW_MS = 20 * 60 * 60 * 1000;
const DEFAULT_BATCH_LIMIT = 25;
const MAX_CONCURRENCY = 4;
const CANDIDATE_PAGE_SIZE = 200;
const MAX_CANDIDATE_PAGES = 10;
/** Ids per stamp UPDATE: keeps the `id=in.(…)` query string well under URL limits. */
const STAMP_CHUNK = 200;
const REVOCATION_RETRY = { limit: 50, maxAttempts: 10 };
const ORPHAN_SUBS_PER_RUN = 25;

type RevocationCounts = { revoked: number; failed: number; gaveUp: number };

export interface GbpSyncCronDeps {
  /** Created by index.ts BEFORE the run, so a failing query still reaches reportCronFailure. */
  svc: DbClient;
  getFreshGoogleToken: (svc: DbClient, connectionId: string) => Promise<string>;
  reportCronFailure: (svc: DbClient, cronName: string, detail: CronFailureDetail) => Promise<void>;
  effectivePlanFeature: (svc: DbClient, workspaceId: string, featureKey: string) => Promise<boolean>;
  /** Defaults to the real is_internal lookup (fails open). */
  fetchInternalWorkspaceIds?: (svc: DbClient) => Promise<Set<string>>;
  /** Defaults to _shared/gbp-api.ts. */
  api?: typeof realGbpApi;
  /** Defaults to syncGbpLocation. */
  syncLocation?: (deps: GbpSyncDeps, location: GbpLocationRow, opts: { now: Date }) => Promise<GbpSyncOutcome>;
  retryPendingRevocations?: (svc: DbClient, opts: { limit: number; maxAttempts: number }) => Promise<RevocationCounts>;
  processUnlinkDecisionData?: (svc: DbClient, data: unknown) => Promise<void>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** GOOGLE_SYNC_BATCH_LIMIT, default 25. */
  batchLimit?: number;
  /** GOOGLE_SYNC_CONCURRENCY, default and maximum 4. */
  concurrency?: number;
  candidatePageSize?: number;
  maxCandidatePages?: number;
}

type Candidate = GbpLocationRow & { clientes: { conta_id: string } };

interface Counts {
  synced: number;
  revoked: number;
  notApproved: number;
  quotaSkipped: number;
  skipped: number;
  failed: number;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  const message = (err as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : String(err);
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function runBatch(deps: GbpSyncCronDeps, now: Date, counts: Counts, errors: CronFailureError[]): Promise<number> {
  const { svc } = deps;
  const batchLimit = Math.max(1, deps.batchLimit ?? DEFAULT_BATCH_LIMIT);
  const concurrency = Math.min(MAX_CONCURRENCY, Math.max(1, deps.concurrency ?? MAX_CONCURRENCY));
  const cutoff = new Date(now.getTime() - SYNC_WINDOW_MS).toISOString();
  const internal = await (deps.fetchInternalWorkspaceIds ?? realFetchInternalWorkspaceIds)(svc);

  const { candidates, allowedWorkspaces, scanned, pages, cappedByPages } = await collectSyncCandidates<Candidate>(
    {
      internalWorkspaces: internal,
      fetchPage: async (from, size) => {
        const { data, error } = await svc
          .from("gbp_locations")
          .select(GBP_LOCATION_COLUMNS)
          .eq("status", "active")
          .not("connection_id", "is", null)
          // Eligibility keys off the last SUCCESSFUL sync; the order off the last attempt.
          .or(`last_synced_at.is.null,last_synced_at.lt.${cutoff}`)
          .order("last_sync_attempt_at", { ascending: true, nullsFirst: true })
          // Tie-break on id: without a total order .range() can skip or repeat rows.
          .order("id", { ascending: true })
          .range(from, from + size - 1);
        if (error) throw new Error(`gbp_locations candidate query failed: ${messageOf(error)}`);
        return ((data ?? []) as unknown as GbpLocationRow[]).map((row) => ({ ...row, clientes: { conta_id: row.conta_id } }));
      },
      resolveAllowedWorkspaces: async (wsIds) => {
        const allowed = await Promise.all(wsIds.map(async (ws) => {
          try {
            const [autoSync, gbp] = await Promise.all([
              deps.effectivePlanFeature(svc, ws, "feature_auto_sync_cron"),
              deps.effectivePlanFeature(svc, ws, "feature_google_business"),
            ]);
            return autoSync && gbp ? ws : null;
          } catch (err) {
            // Fail closed for that workspace only; the rest of the batch still runs.
            console.error(`[${CRON_NAME}] plan lookup failed for workspace ${ws}: ${messageOf(err)}`);
            errors.push({ accountId: `workspace:${ws}`, error: `plan lookup failed: ${messageOf(err)}` });
            return null;
          }
        }));
        return allowed.filter((ws): ws is string => ws !== null);
      },
    },
    {
      pageSize: Math.max(1, deps.candidatePageSize ?? CANDIDATE_PAGE_SIZE),
      maxPages: Math.max(1, deps.maxCandidatePages ?? MAX_CANDIDATE_PAGES),
      targetEligible: batchLimit,
    },
  );

  if (cappedByPages) {
    console.warn(`[${CRON_NAME}] Stopped after ${pages} page(s) / ${scanned} candidate(s) without filling the batch.`);
  }
  if (candidates.length === 0) return 0;

  const batch = candidates.filter((c) => isEligible(c, allowedWorkspaces, internal)).slice(0, batchLimit);
  const batchIds = new Set(batch.map((c) => c.id));

  // Stamp the batch and the ineligible candidates before any work (deferred eligible ones keep
  // their queue position; see the header).
  const stampIds = candidates
    .filter((c) => batchIds.has(c.id) || !isEligible(c, allowedWorkspaces, internal))
    .map((c) => c.id);
  for (let i = 0; i < stampIds.length; i += STAMP_CHUNK) {
    const ids = stampIds.slice(i, i + STAMP_CHUNK);
    const { error } = await svc.from("gbp_locations").update({ last_sync_attempt_at: now.toISOString() }).in("id", ids);
    if (error) console.error(`[${CRON_NAME}] failed to stamp last_sync_attempt_at: ${messageOf(error)}`);
  }
  console.log(`[${CRON_NAME}] syncing ${batch.length} of ${candidates.length} candidate(s) over ${pages} page(s)`);

  const revokedConnections = new Set<string>();
  const syncDeps: GbpSyncDeps = {
    svc,
    api: deps.api ?? realGbpApi,
    // Remember connections whose token came back REVOKED (google_mark_revoked already flipped
    // all their units), so their other units in this run skip without another token call.
    getFreshGoogleToken: async (client, connectionId) => {
      try {
        return await deps.getFreshGoogleToken(client, connectionId);
      } catch (err) {
        if (err instanceof GoogleApiError && err.code === "REVOKED") revokedConnections.add(connectionId);
        throw err;
      }
    },
    now: () => now,
    sleep: deps.sleep ?? defaultSleep,
  };
  const sync = deps.syncLocation ?? syncGbpLocation;

  await runPool(batch, concurrency, async (location) => {
    try {
      if (location.connection_id && revokedConnections.has(location.connection_id)) {
        counts.skipped++;
        return;
      }
      const { status } = await sync(syncDeps, location, { now });
      if (status === "synced") counts.synced++;
      else if (status === "revoked") counts.revoked++;
      else if (status === "not_approved") counts.notApproved++;
      else if (status === "quota_skipped") counts.quotaSkipped++;
      else counts.skipped++;
    } catch (err) {
      counts.failed++;
      const message = messageOf(err);
      errors.push({ accountId: location.id, error: message });
      console.error(`[${CRON_NAME}] location ${location.id} failed: ${message}`);
    }
  });

  return batch.length;
}

async function expireUnits(deps: GbpSyncCronDeps, errors: CronFailureError[]) {
  const expired = { gbpLocations: 0, youtubeChannels: 0, orphanYoutubeRows: 0, orphanGbpRows: 0 };
  try {
    const { data, error } = await deps.svc.rpc("google_expire_units");
    if (error) throw new Error(`google_expire_units failed: ${messageOf(error)}`);
    const row = (Array.isArray(data) ? data[0] : data) as
      | {
        gbp_locations_deleted?: number;
        youtube_channels_deleted?: number;
        orphan_youtube_rows_deleted?: number;
        orphan_gbp_rows_deleted?: number;
      }
      | null;
    expired.gbpLocations = Number(row?.gbp_locations_deleted) || 0;
    expired.youtubeChannels = Number(row?.youtube_channels_deleted) || 0;
    expired.orphanYoutubeRows = Number(row?.orphan_youtube_rows_deleted) || 0;
    expired.orphanGbpRows = Number(row?.orphan_gbp_rows_deleted) || 0;
  } catch (err) {
    console.error(`[${CRON_NAME}] expiry failed: ${messageOf(err)}`);
    errors.push({ accountId: "expire-units", error: messageOf(err) });
  }
  return expired;
}

async function retryRevocations(deps: GbpSyncCronDeps, errors: CronFailureError[]): Promise<RevocationCounts> {
  try {
    const retry = deps.retryPendingRevocations ?? realRetryPendingRevocations;
    const result = await retry(deps.svc, REVOCATION_RETRY);
    if (result.failed + result.gaveUp > 0) {
      errors.push({
        accountId: "revocations",
        error: `${result.failed} revocation(s) failed, ${result.gaveUp} gave up`,
      });
    }
    return result;
  } catch (err) {
    console.error(`[${CRON_NAME}] revocation retry failed: ${messageOf(err)}`);
    errors.push({ accountId: "revocations", error: messageOf(err) });
    return { revoked: 0, failed: 0, gaveUp: 0 };
  }
}

async function releaseOrphanSubs(deps: GbpSyncCronDeps, errors: CronFailureError[]): Promise<number> {
  const processDecision = deps.processUnlinkDecisionData ?? realProcessUnlinkDecisionData;
  let released = 0;
  let subs: string[];
  try {
    const { data, error } = await deps.svc.rpc("google_orphan_subs", { p_limit: ORPHAN_SUBS_PER_RUN });
    if (error) throw new Error(`google_orphan_subs failed: ${messageOf(error)}`);
    subs = ((Array.isArray(data) ? data : []) as unknown[])
      .map((s) => (typeof s === "string" ? s : (s as { google_orphan_subs?: unknown } | null)?.google_orphan_subs))
      .filter((s): s is string => typeof s === "string" && s.length > 0);
  } catch (err) {
    console.error(`[${CRON_NAME}] orphan listing failed: ${messageOf(err)}`);
    errors.push({ accountId: "orphan-subs", error: messageOf(err) });
    return 0;
  }

  // One sub per call: google_release_sub takes that sub's lock in its own transaction. A raw
  // database message may quote its arguments (the sub, a Google account id), so failures are
  // logged and reported as a generic line plus the error code only.
  for (const sub of subs) {
    try {
      const { data, error } = await deps.svc.rpc("google_release_sub", { p_sub: sub });
      if (error) throw error;
      await processDecision(deps.svc, data);
      released++;
    } catch (err) {
      const code = (err as { code?: unknown } | null)?.code;
      const line = `google_release_sub failed${typeof code === "string" && code ? ` (code ${code})` : ""}`;
      console.error(`[${CRON_NAME}] orphan release failed: ${line}`);
      errors.push({ accountId: "orphan-release", error: line });
    }
  }
  return released;
}

export async function runGbpSyncCron(deps: GbpSyncCronDeps): Promise<Response> {
  const now = deps.now?.() ?? new Date();
  const counts: Counts = { synced: 0, revoked: 0, notApproved: 0, quotaSkipped: 0, skipped: 0, failed: 0 };
  const errors: CronFailureError[] = [];
  let total = 0;
  let batchFailed = false;

  try {
    total = await runBatch(deps, now, counts, errors);
  } catch (err) {
    batchFailed = true;
    console.error(`[${CRON_NAME}] batch failed: ${messageOf(err)}`);
    errors.push({ accountId: "batch", error: messageOf(err) });
  }

  // Privacy duties: always, whatever happened above.
  const expired = await expireUnits(deps, errors);
  const revocations = await retryRevocations(deps, errors);
  const orphansReleased = await releaseOrphanSubs(deps, errors);

  console.log(
    `[${CRON_NAME}] Done. Synced ${counts.synced}, revoked ${counts.revoked}, not approved ${counts.notApproved}, ` +
      `quota ${counts.quotaSkipped}, skipped ${counts.skipped}, failed ${counts.failed}; expired ` +
      `${expired.gbpLocations} location(s) + ${expired.youtubeChannels} channel(s), orphaned history rows ` +
      `${expired.orphanYoutubeRows} YouTube + ${expired.orphanGbpRows} GMN; orphans released ${orphansReleased}`,
  );

  if (errors.length > 0) {
    try {
      await deps.reportCronFailure(deps.svc, CRON_NAME, { total, failed: errors.length, errors });
    } catch (err) {
      console.error(`[${CRON_NAME}] reportCronFailure threw: ${messageOf(err)}`);
    }
  }

  return json(
    { success: !batchFailed, ...counts, total, expired, revocations, orphansReleased },
    batchFailed ? 500 : 200,
  );
}

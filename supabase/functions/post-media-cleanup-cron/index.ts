import { createClient } from "npm:@supabase/supabase-js@2";
import { headObject, listOrphanKeyPage, purgeTrash, signGetUrl, trashObject } from "../_shared/r2.ts";
import { reportCronFailure } from "../_shared/triage.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { timingSafeEqual } from "../_shared/crypto.ts";
import {
  copyToStream,
  createStreamRetryBudget,
  deleteStreamVideo,
  getStreamVideoStatus,
  isStreamCleanupEnabled,
  isStreamEnabled,
  listStreamVideos,
} from "../_shared/stream.ts";
import { createPostMediaCleanupCronHandler } from "./handler.ts";
import { runStreamSweeps } from "./stream-steps.ts";
import { runOrphanScan, type OrphanScanDeps } from "./orphan-scan.ts";
import { runIntegrityCanary } from "./canary.ts";
import { withWatchdog } from "./watchdog.ts";

const CRON_NAME = "post-media-cleanup-cron";
const PURGE_SCAN_KEY = "trash-purge:trash/";

// Listing pages the orphan scan may consume per target per run. See
// orphan-scan.ts: the scan is checkpointed, so this bounds ONE run's memory and
// wall clock, not how much of the bucket eventually gets swept. Raise it if
// cron_scan_state.cycle_started_at shows sweeps taking too long.
const ORPHAN_SCAN_PAGES_PER_RUN = Math.max(
  1,
  parseInt(Deno.env.get("ORPHAN_SCAN_PAGES_PER_RUN") || "10", 10) || 10,
);

// Throughput dials for the Stream ingest/settle sweeps -- see stream-steps.ts. Lower these if
// the account's shared Cloudflare Stream rate-limit budget keeps tripping (429s logged as
// "stream-steps:ingest"/"stream-steps:settle"/"stream-steps:reap"); raise them to clear a
// backlog faster once headroom allows it. No redeploy needed -- both are plain edge secrets.
const STREAM_INGEST_BATCH = Math.max(1, parseInt(Deno.env.get("STREAM_INGEST_BATCH") || "20", 10) || 20);
const STREAM_SETTLE_BATCH = Math.max(1, parseInt(Deno.env.get("STREAM_SETTLE_BATCH") || "50", 10) || 50);

// Hours between orphanReap runs (see stream-steps.ts:shouldRunReap). Reap lists the WHOLE
// Stream account every time it runs, so this is the main lever on the account's Stream API
// request volume as the video library grows -- raise it if 429s persist even after the
// retry-with-backoff in _shared/stream.ts, lower it if orphaned videos linger too long
// (cron_scan_state.updated_at for scan_key='stream-reap' shows the last successful run).
const STREAM_REAP_INTERVAL_HOURS = Math.max(
  1,
  parseInt(Deno.env.get("STREAM_REAP_INTERVAL_HOURS") || "6", 10) || 6,
);
const STREAM_REAP_SCAN_KEY = "stream-reap";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? (() => { throw new Error('CRON_SECRET is required'); })();

Deno.serve(createPostMediaCleanupCronHandler({
  buildCorsHeaders,
  cronSecret: CRON_SECRET,
  timingSafeEqual,
  run: async (_req, json) => {
    const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Checkpoint I/O against cron_scan_state (migration 20260913000001),
    // shared by the orphan scan and the trash purge below. A missing row is
    // not an error: it means "start a fresh cycle".
    const readCheckpoint = async (scanKey: string): Promise<string | null> => {
      // Bounded: a hung read stalls the run before the purge watchdog even
      // starts, blocking the canary and alert stages downstream — same hang
      // class the dead-letter counts below are already bound against.
      const { data, error } = await svc
        .from("cron_scan_state")
        .select("continuation_token")
        .eq("scan_key", scanKey)
        .abortSignal(AbortSignal.timeout(10_000))
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data?.continuation_token as string | null) ?? null;
    };
    // One RPC, not an upsert plus a counter write: a completed cycle has to
    // move the position, restart the cycle clock and bump the counter as a
    // unit, or the telemetry starts disagreeing with the cursor.
    const writeCheckpoint = async (
      scanKey: string,
      token: string | null,
      opts: { cycleCompleted: boolean },
    ): Promise<void> => {
      const { error } = await svc.rpc("record_scan_checkpoint", {
        p_scan_key: scanKey,
        p_token: token,
        p_cycle_completed: opts.cycleCompleted,
      }).abortSignal(AbortSignal.timeout(10_000));
      if (error) throw new Error(error.message);
    };

    let deleted = 0;
    let failed = 0;
    // Gates the R2+Stream delete order below and the sweep call further down — computed once so
    // both reflect the same env snapshot for this run.
    const cleanupEnabled = isStreamCleanupEnabled();
    // Shared across EVERY Stream call this invocation makes (the drain loop below, and every
    // call inside runStreamSweeps) — see StreamRetryBudget in _shared/stream.ts for why a
    // per-call retry cap isn't enough on its own: it still multiplies across this loop's up to
    // 500 sequential rows. Must be created fresh per invocation, not at module scope, since a
    // warm isolate can be reused across separate cron runs.
    const streamRetryBudget = createStreamRetryBudget();

    // Drain post_media_deletions (legacy)
    const { data: legacyPending } = await svc
      .from("post_media_deletions")
      .select("id, r2_key, attempts")
      .lt("attempts", 6)
      .order("enqueued_at", { ascending: true })
      .limit(500);

    for (const row of legacyPending ?? []) {
      try {
        await trashObject(row.r2_key);
        await svc.from("post_media_deletions").delete().eq("id", row.id);
        deleted++;
      } catch (e) {
        failed++;
        await svc.from("post_media_deletions")
          .update({ attempts: (row.attempts ?? 0) + 1, last_error: (e as Error).message })
          .eq("id", row.id);
      }
    }

    // Drain file_deletions (new)
    const { data: filePending } = await svc
      .from("file_deletions")
      .select("id, r2_key, thumbnail_r2_key, stream_uid, attempts")
      .lt("attempts", 5)
      .lte("next_retry_at", new Date().toISOString())
      .order("queued_at", { ascending: true })
      .limit(500);

    for (const row of filePending ?? []) {
      try {
        await trashObject(row.r2_key);
        if (row.thumbnail_r2_key) await trashObject(row.thumbnail_r2_key);
        // R2 deletes are idempotent on retry, so the row is only removed once the Stream delete
        // (when applicable) also succeeds — a failure here goes through the same catch/backoff
        // as an R2 failure. When cleanup isn't enabled (no STREAM_* secrets), stream_uid rows
        // still complete their R2 deletes and are removed exactly as before Stream existed.
        if (row.stream_uid && cleanupEnabled) {
          await deleteStreamVideo(row.stream_uid, fetch, undefined, streamRetryBudget);
        }
        await svc.from("file_deletions").delete().eq("id", row.id);
        deleted++;
      } catch (e) {
        failed++;
        const nextAttempts = (row.attempts ?? 0) + 1;
        const backoffSeconds = Math.pow(2, nextAttempts) * 60;
        await svc.from("file_deletions").update({
          attempts: nextAttempts,
          last_error: (e as Error).message,
          next_retry_at: new Date(Date.now() + backoffSeconds * 1000).toISOString(),
        }).eq("id", row.id);
      }
    }

    // Stream reconciliation sweeps: ingest catch-up + settle pending need the full credential
    // set (isStreamEnabled()); orphan reap only needs delete/list, so it still runs in
    // cleanup-only ("kill-switch") mode. Deliberately BEFORE the R2 orphan scan below: that
    // full-bucket listing has hit WORKER_RESOURCE_LIMIT on prod, and dying there must not
    // starve the small, bounded sweep work (prod evidence 2026-08-13: sweeps behind the scan
    // never ran).
    let streamIngested = 0;
    let streamSettled = 0;
    let streamReaped = 0;
    let streamErrors = 0;
    if (cleanupEnabled) {
      const sweep = await runStreamSweeps({
        db: svc,
        deleteStreamVideo: (uid: string) => deleteStreamVideo(uid, fetch, undefined, streamRetryBudget),
        listStreamVideos: () => listStreamVideos(fetch, undefined, streamRetryBudget),
        ingestBatchSize: STREAM_INGEST_BATCH,
        settleBatchSize: STREAM_SETTLE_BATCH,
        reapIntervalMs: STREAM_REAP_INTERVAL_HOURS * 60 * 60 * 1000,
        // Reuses cron_scan_state (migration 20260913000001): its schema is already a generic
        // '<key> -> last write' checkpoint (continuation_token/cycles_completed exist for the R2
        // scan's pagination, but nothing here needs them -- updated_at alone is the "last
        // successful reap" marker this gate needs), so no new migration earns its keep.
        readReapCheckpoint: async () => {
          const { data, error } = await svc
            .from("cron_scan_state")
            .select("updated_at")
            .eq("scan_key", STREAM_REAP_SCAN_KEY)
            .maybeSingle();
          if (error) throw new Error(error.message);
          return (data?.updated_at as string | null) ?? null;
        },
        writeReapCheckpoint: async () => {
          const { error } = await svc.rpc("record_scan_checkpoint", {
            p_scan_key: STREAM_REAP_SCAN_KEY,
            p_token: null,
            p_cycle_completed: true,
          });
          if (error) throw new Error(error.message);
        },
        ...(isStreamEnabled()
          ? {
              copyToStream: (sourceUrl: string, meta: Record<string, string>) =>
                copyToStream(sourceUrl, meta, fetch, undefined, streamRetryBudget),
              signSourceUrl: (r2Key: string) => signGetUrl(r2Key, 600),
              getStreamVideoStatus: (uid: string) =>
                getStreamVideoStatus(uid, fetch, undefined, streamRetryBudget),
            }
          : {}),
      });
      streamIngested = sweep.ingested;
      streamSettled = sweep.settled;
      streamReaped = sweep.reaped;
      streamErrors = sweep.errors;
    }

    // R2 orphan cleanup LAST: the most expensive, least urgent stage. A resource-limit
    // death here costs only this stage; everything above has already committed.
    // Hardened module (see orphan-scan.ts): chunked known-set queries, abort on any
    // query error, and an empty-known-set circuit breaker — the 2026-08 incident
    // (silent .in() failures -> empty known set -> mass deletion) cannot recur.
    // The cast keeps tsc from expanding PostgrestFilterBuilder against the
    // narrow structural `db` contract (TS2589: excessively deep instantiation).
    const scan = await runOrphanScan({
      db: svc as unknown as OrphanScanDeps["db"],
      listOrphanKeyPage,
      trashObject,
      pagesPerRun: ORPHAN_SCAN_PAGES_PER_RUN,
      readCheckpoint,
      writeCheckpoint,
    });

    // Purge trash/ entries past their 30-day undo window (bounded per run,
    // checkpointed in cron_scan_state like the orphan scan above). The 55s
    // internal deadline (purgeTrash's default) is the primary bound; this 90s
    // watchdog is a true last resort for a wedged SDK call, which is why it no
    // longer needs to match the OLD 60s "whole thing might hang" budget. On a
    // watchdog timeout the checkpoint is deliberately NOT written, so the next
    // run resumes from the previous token instead of losing position.
    let trashPurged = 0;
    try {
      const startToken = await readCheckpoint(PURGE_SCAN_KEY);
      const result = await withWatchdog(90_000, () => purgeTrash(30, { startToken }));
      if (result) {
        trashPurged = result.purged;
        await writeCheckpoint(PURGE_SCAN_KEY, result.nextToken, { cycleCompleted: result.cycleCompleted });
      } else {
        console.error("post-media-cleanup:purge-trash timed out");
      }
    } catch (e) {
      console.error("post-media-cleanup:purge-trash", e);
    }

    // Integrity canary: recent DB rows whose objects vanished mean something is
    // destroying storage — the exact silent failure of the 2026-08 incident.
    let canaryChecked = 0;
    let canaryMissing: Array<{ id: number; r2_key: string }> = [];
    try {
      const canary = await runIntegrityCanary({ db: svc, headObject });
      canaryChecked = canary.checked;
      canaryMissing = canary.missing;
    } catch (e) {
      console.error("post-media-cleanup:canary", e);
    }

    // Alerting: anything anomalous goes to cron triage (best-effort, never 500s the run).
    const alerts: Array<{ error: string }> = [];
    if (canaryMissing.length > 0) {
      alerts.push({ error: `integrity canary: ${canaryMissing.length}/${canaryChecked} sampled objects MISSING (ids ${canaryMissing.map((m) => m.id).join(",")})` });
    }
    // scan.aborted já vem como "prefixo: motivo" de CADA alvo abortado — um
    // abort em briefing-audio/ não some atrás de um em contas/.
    if (scan.aborted) alerts.push({ error: `orphan scan aborted: ${scan.aborted}` });
    if (scan.capped > 0) {
      const perTarget = scan.targets
        .filter((t) => t.capped > 0)
        .map((t) => `${t.prefix} ${t.capped} deferred/${t.trashed} trashed`)
        .join("; ");
      alerts.push({ error: `orphan scan capped: ${perTarget}` });
    }
    if (failed > 0) alerts.push({ error: `deletion drain: ${failed} rows failed this run` });
    if (streamErrors > 0) alerts.push({ error: `stream sweeps: ${streamErrors} step errors` });

    // Dead-letter visibility: rows past their attempt cap are silently excluded
    // from the drains above forever (post_media_deletions: attempts < 6;
    // file_deletions: attempts < 5). The alert TEXT is deliberately stable (no
    // counts) — but cron-health-cron's alreadyReported dedups on signature_hash
    // AND an exact error_detail->context->>run_start_time match
    // (cron-health-cron/index.ts:29-42), so it only suppresses a double-report
    // of the SAME run, never collapses this alert across runs. This will page
    // every run while dead-lettered rows exist; that's intentional — weekly
    // noise beats silent, permanent data loss.
    const { count: deadLegacyRows, error: deadLegacyError } = await svc
      .from("post_media_deletions")
      .select("id", { count: "exact", head: true })
      .gte("attempts", 6)
      .abortSignal(AbortSignal.timeout(10_000));
    if (deadLegacyError) {
      console.error(`post-media-cleanup: dead-letter count query failed: ${deadLegacyError.message}`);
    }
    if ((deadLegacyRows ?? 0) > 0) {
      console.error(`post-media-cleanup: ${deadLegacyRows} post_media_deletions rows past attempt cap`);
      alerts.push({ error: "post_media_deletions has dead-lettered rows past the attempt cap" });
    }
    const { count: deadFileRows, error: deadFileError } = await svc
      .from("file_deletions")
      .select("id", { count: "exact", head: true })
      .gte("attempts", 5)
      .abortSignal(AbortSignal.timeout(10_000));
    if (deadFileError) {
      console.error(`post-media-cleanup: dead-letter count query failed: ${deadFileError.message}`);
    }
    if ((deadFileRows ?? 0) > 0) {
      console.error(`post-media-cleanup: ${deadFileRows} file_deletions rows past attempt cap`);
      alerts.push({ error: "file_deletions has dead-lettered rows past the attempt cap" });
    }

    if (alerts.length > 0) {
      await reportCronFailure(svc, CRON_NAME, { failed: alerts.length, errors: alerts });
    }

    return json({
      deleted, failed, orphansTrashed: scan.trashed, orphansCapped: scan.capped,
      orphanScanAborted: scan.aborted, orphanScanPages: scan.pages,
      orphanScanCyclesCompleted: scan.cyclesCompleted, trashPurged, canaryChecked,
      canaryMissing: canaryMissing.length,
      streamIngested, streamSettled, streamReaped, streamErrors,
    });
  },
}));

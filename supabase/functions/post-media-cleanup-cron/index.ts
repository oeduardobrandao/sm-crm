import { createClient } from "npm:@supabase/supabase-js@2";
import { headObject, listOrphanKeys, purgeTrash, signGetUrl, trashObject } from "../_shared/r2.ts";
import { reportCronFailure } from "../_shared/triage.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { timingSafeEqual } from "../_shared/crypto.ts";
import {
  copyToStream,
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

const CRON_NAME = "post-media-cleanup-cron";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? (() => { throw new Error('CRON_SECRET is required'); })();

Deno.serve(createPostMediaCleanupCronHandler({
  buildCorsHeaders,
  cronSecret: CRON_SECRET,
  timingSafeEqual,
  run: async (_req, json) => {
    const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let deleted = 0;
    let failed = 0;
    // Gates the R2+Stream delete order below and the sweep call further down — computed once so
    // both reflect the same env snapshot for this run.
    const cleanupEnabled = isStreamCleanupEnabled();

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
        if (row.stream_uid && cleanupEnabled) await deleteStreamVideo(row.stream_uid);
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
        deleteStreamVideo,
        listStreamVideos,
        ...(isStreamEnabled()
          ? {
              copyToStream,
              signSourceUrl: (r2Key: string) => signGetUrl(r2Key, 600),
              getStreamVideoStatus,
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
      listOrphanKeys,
      trashObject,
    });

    // Purge trash/ entries past their 30-day undo window (bounded per run).
    let trashPurged = 0;
    try {
      // SDK-independent watchdog: listings have worked reliably on this runtime,
      // but a wedged purge must never block the canary/alert stages behind it.
      trashPurged = await new Promise<number>((resolve) => {
        const watchdog = setTimeout(() => {
          console.error("post-media-cleanup:purge-trash timed out");
          resolve(0);
        }, 60_000);
        purgeTrash(30).then(
          (n) => { clearTimeout(watchdog); resolve(n); },
          (e) => { clearTimeout(watchdog); console.error("post-media-cleanup:purge-trash", e); resolve(0); },
        );
      });
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
    if (alerts.length > 0) {
      await reportCronFailure(svc, CRON_NAME, { failed: alerts.length, errors: alerts });
    }

    return json({
      deleted, failed, orphansTrashed: scan.trashed, orphansCapped: scan.capped,
      orphanScanAborted: scan.aborted, trashPurged, canaryChecked,
      canaryMissing: canaryMissing.length,
      streamIngested, streamSettled, streamReaped, streamErrors,
    });
  },
}));

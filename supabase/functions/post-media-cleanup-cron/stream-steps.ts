// Cloudflare Stream reconciliation sweeps, run by post-media-cleanup-cron after the R2
// orphan-key section (spec 2026-08-13, Task 8). Three independent steps — ingest catch-up,
// settle pending, orphan reap — each wrapped so one step's failure can never block the next;
// a caught step failure increments `errors` and is logged, never rethrown. A per-row failure
// inside a step (one bad copy, one bad delete) is likewise caught and logged so it can't stall
// the rest of that step's batch — mirrors the existing R2 orphan-cleanup loop in index.ts.
//
// Ingest + settle need the full Stream credential set (isStreamEnabled()): index.ts passes
// copyToStream/signSourceUrl/getStreamVideoStatus only when that's true, and both steps
// short-circuit to a 0 count when their deps are missing. Orphan reap only needs
// delete/list — both required (non-optional) deps — so it still runs in "kill-switch" mode
// (cleanup vars only, isStreamCleanupEnabled() without isStreamEnabled()).
//
// getStreamVideoStatus collapses API/network failures to "inprogress" (Task 2 decision) — the
// settle step treats that as "skip, retry next run", never a terminal state.
//
// The DB-side WHERE clauses (kind/stream_uid/stream_status/age) are the real filter in
// production Postgres; the JS-side `created_at` re-check below is a defensive belt-and-suspenders
// pass, not a substitute — it's what makes the age-gate behavior independently testable against
// the shared supabase mock, which doesn't evaluate query modifiers.

// deno-lint-ignore no-explicit-any
type DbClient = any;

export interface StreamStepsDeps {
  db: DbClient;
  // Optional trio: present only when isStreamEnabled(); ingest + settle steps skip when absent
  // (kill-switch mode keeps only the reap running).
  copyToStream?(sourceUrl: string, meta: Record<string, string>): Promise<string>;
  signSourceUrl?(r2Key: string): Promise<string>; // presigned R2 GET, 600s
  getStreamVideoStatus?(uid: string): Promise<"ready" | "error" | "inprogress">;
  deleteStreamVideo(uid: string): Promise<void>;
  listStreamVideos(): Promise<Array<{ uid: string; created: string }>>;
  nowMs?: () => number;
}

export interface StreamSweepResult {
  ingested: number;
  settled: number;
  reaped: number;
  errors: number;
}

const TEN_MINUTES_MS = 10 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const INGEST_BATCH = 20;
const SETTLE_BATCH = 50;

interface IngestRow {
  id: number | string;
  r2_key: string;
  conta_id: string;
  created_at: string;
}

interface SettleRow {
  id: number | string;
  stream_uid: string;
  created_at: string;
}

export async function runStreamSweeps(deps: StreamStepsDeps): Promise<StreamSweepResult> {
  const nowMs = deps.nowMs ?? (() => Date.now());
  const result: StreamSweepResult = { ingested: 0, settled: 0, reaped: 0, errors: 0 };

  try {
    result.ingested = await ingestCatchUp(deps, nowMs);
  } catch (e) {
    console.error("stream-steps:ingest", e);
    result.errors++;
  }

  try {
    result.settled = await settlePending(deps, nowMs);
  } catch (e) {
    console.error("stream-steps:settle", e);
    result.errors++;
  }

  try {
    result.reaped = await orphanReap(deps, nowMs);
  } catch (e) {
    console.error("stream-steps:reap", e);
    result.errors++;
  }

  return result;
}

/** Selects videoless `files` rows past the 10-minute grace window and re-drives the copy — this
 * is what repairs both a failed enqueue and a file-manage upload (which never calls copyToStream
 * itself; it just leaves stream_uid null for this sweep to pick up). */
async function ingestCatchUp(deps: StreamStepsDeps, nowMs: () => number): Promise<number> {
  if (!deps.copyToStream || !deps.signSourceUrl) return 0;
  const copyToStream = deps.copyToStream;
  const signSourceUrl = deps.signSourceUrl;

  const cutoffIso = new Date(nowMs() - TEN_MINUTES_MS).toISOString();
  const { data, error } = await deps.db
    .from("files")
    .select("id, r2_key, conta_id, created_at")
    .eq("kind", "video")
    .is("stream_uid", null)
    .or("stream_status.is.null,stream_status.eq.pending")
    .lt("created_at", cutoffIso)
    .order("created_at", { ascending: true })
    .limit(INGEST_BATCH);
  if (error) throw error;

  const rows = ((data ?? []) as IngestRow[]).filter((row) => row.created_at < cutoffIso);

  let ingested = 0;
  for (const row of rows) {
    try {
      // Durable intent BEFORE the external call (mirrors file-upload-finalize): a pending row
      // with a null uid is exactly what this sweep exists to repair on the next run.
      await deps.db.from("files").update({ stream_status: "pending" }).eq("id", row.id);
      const sourceUrl = await signSourceUrl(row.r2_key);
      const uid = await copyToStream(sourceUrl, { file_id: String(row.id), conta_id: row.conta_id });
      await deps.db.from("files").update({ stream_uid: uid }).eq("id", row.id);
      ingested++;
    } catch (e) {
      console.error("stream-steps:ingest-row", row.id, e);
    }
  }
  return ingested;
}

/** Settles `files` rows the webhook never heard back on (missed delivery, or Stream took
 * over an hour). getStreamVideoStatus's "inprogress" collapse (network/API failure OR a
 * genuinely still-processing video) is treated identically: skip, retry next run. */
async function settlePending(deps: StreamStepsDeps, nowMs: () => number): Promise<number> {
  if (!deps.getStreamVideoStatus) return 0;
  const getStreamVideoStatus = deps.getStreamVideoStatus;

  const cutoffIso = new Date(nowMs() - ONE_HOUR_MS).toISOString();
  const { data, error } = await deps.db
    .from("files")
    .select("id, stream_uid, created_at")
    .eq("stream_status", "pending")
    .not("stream_uid", "is", null)
    .lt("created_at", cutoffIso)
    .order("created_at", { ascending: true })
    .limit(SETTLE_BATCH);
  if (error) throw error;

  const rows = ((data ?? []) as SettleRow[]).filter((row) => row.created_at < cutoffIso);

  let settled = 0;
  for (const row of rows) {
    try {
      const status = await getStreamVideoStatus(row.stream_uid);
      if (status === "inprogress") continue; // not terminal yet — retry next run
      await deps.db.from("files").update({ stream_status: status }).eq("id", row.id);
      settled++;
    } catch (e) {
      console.error("stream-steps:settle-row", row.id, e);
    }
  }
  return settled;
}

/** Deletes Stream videos that neither `files.stream_uid` nor the `file_deletions` delete queue
 * knows about — a copy whose uid was never persisted (e.g. index update failed after the Stream
 * API call succeeded). The 1h age gate spares an in-flight ingest that just hasn't been saved
 * yet. Rows already queued in `file_deletions` are deliberately excluded from "orphan": they're
 * on their way to deletion via the drain loop, not double-deleted here. */
async function orphanReap(deps: StreamStepsDeps, nowMs: () => number): Promise<number> {
  const known = new Set<string>();

  const { data: fileRows, error: fileErr } = await deps.db
    .from("files")
    .select("stream_uid")
    .not("stream_uid", "is", null);
  if (fileErr) throw fileErr;
  for (const row of (fileRows ?? []) as Array<{ stream_uid: string | null }>) {
    if (row.stream_uid) known.add(row.stream_uid);
  }

  const { data: queuedRows, error: queuedErr } = await deps.db
    .from("file_deletions")
    .select("stream_uid")
    .not("stream_uid", "is", null);
  if (queuedErr) throw queuedErr;
  for (const row of (queuedRows ?? []) as Array<{ stream_uid: string | null }>) {
    if (row.stream_uid) known.add(row.stream_uid);
  }

  const videos = await deps.listStreamVideos();
  const cutoffMs = nowMs() - ONE_HOUR_MS;

  let reaped = 0;
  for (const video of videos) {
    if (known.has(video.uid)) continue;
    const createdMs = new Date(video.created).getTime();
    if (Number.isNaN(createdMs) || createdMs >= cutoffMs) continue; // too young — spare, retry next run
    try {
      await deps.deleteStreamVideo(video.uid);
      reaped++;
    } catch (e) {
      console.error("stream-steps:reap-uid", video.uid, e);
    }
  }
  return reaped;
}

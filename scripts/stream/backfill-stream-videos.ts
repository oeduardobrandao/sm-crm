/**
 * One-time backfill: ingests every existing video `files` row into Cloudflare
 * Stream. Pages through `files` where `mime_type like 'video%'` and
 * `stream_uid is null` (50/page, ordered by `id`), marks each row `pending`,
 * kicks off a Stream "copy from URL" against a short-lived signed media-proxy
 * URL, then saves the returned `uid`. Idempotent: a row that already has a
 * `stream_uid` never matches the query again, so rerunning only retries rows
 * that failed (or were never attempted).
 *
 * A per-row failure is logged and does not stop the run — the same recovery
 * contract as the ingest-catch-up sweep in
 * supabase/functions/post-media-cleanup-cron/stream-steps.ts, which will also
 * pick up any row left `pending` with a null `stream_uid` on its own next run.
 *
 * Usage (Node 18+, run via tsx; NEVER pass secrets as CLI args):
 *   set -a; source <(cat .env.stream.local); set +a
 *   npx tsx scripts/stream/backfill-stream-videos.ts
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STREAM_ACCOUNT_ID,
 * STREAM_API_TOKEN, MEDIA_WORKER_URL, MEDIA_SIGNING_KEY.
 */

import { createClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} required`);
  return value;
}

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const STREAM_ACCOUNT_ID = requireEnv("STREAM_ACCOUNT_ID");
const STREAM_API_TOKEN = requireEnv("STREAM_API_TOKEN");
const MEDIA_WORKER_URL = requireEnv("MEDIA_WORKER_URL");
const MEDIA_SIGNING_KEY = requireEnv("MEDIA_SIGNING_KEY");

const PAGE_SIZE = 50;
const THROTTLE_MS = 1000;
const SIGNED_URL_TTL_SECONDS = 900;

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface FileRow {
  id: number;
  r2_key: string;
  conta_id: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Mirrors supabase/functions/_shared/media-url.ts's HMAC scheme exactly:
 * sig = hex(hmacSHA256(MEDIA_SIGNING_KEY, `${r2Key}:${exp}`)). */
function signMediaProxyUrl(r2Key: string): string {
  const exp = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS;
  const sig = createHmac("sha256", MEDIA_SIGNING_KEY).update(`${r2Key}:${exp}`).digest("hex");
  return `${MEDIA_WORKER_URL}/${encodeURIComponent(r2Key)}?exp=${exp}&sig=${sig}`;
}

/** Mirrors supabase/functions/_shared/stream.ts's copyToStream(). */
async function copyToStream(sourceUrl: string, meta: Record<string, string>): Promise<string> {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${STREAM_ACCOUNT_ID}/stream/copy`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STREAM_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url: sourceUrl, meta, requireSignedURLs: true }),
  });
  const json = (await res.json().catch(() => null)) as
    | { success?: boolean; result?: { uid?: string } }
    | null;
  const uid = json?.result?.uid;
  if (!res.ok || json?.success === false || !uid) {
    throw new Error(`stream copy failed: ${res.status}`);
  }
  return uid;
}

async function fetchNextPage(cursor: number): Promise<FileRow[]> {
  const { data, error } = await db
    .from("files")
    .select("id, r2_key, conta_id")
    .like("mime_type", "video%")
    .is("stream_uid", null)
    .gt("id", cursor)
    .order("id", { ascending: true })
    .limit(PAGE_SIZE);
  if (error) throw new Error(`fetch page failed: ${error.message}`);
  return (data ?? []) as FileRow[];
}

async function processRow(row: FileRow): Promise<void> {
  const { error: pendingError } = await db
    .from("files")
    .update({ stream_status: "pending" })
    .eq("id", row.id);
  if (pendingError) throw new Error(`mark pending failed: ${pendingError.message}`);

  const sourceUrl = signMediaProxyUrl(row.r2_key);
  const uid = await copyToStream(sourceUrl, { file_id: String(row.id), conta_id: row.conta_id });

  const { error: uidError } = await db.from("files").update({ stream_uid: uid }).eq("id", row.id);
  if (uidError) throw new Error(`save uid failed: ${uidError.message}`);

  console.log(`[OK] file ${row.id} -> stream uid ${uid}`);
}

async function main(): Promise<void> {
  console.log("Backfilling Cloudflare Stream from files...");

  let cursor = 0;
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let first = true;

  for (;;) {
    const page = await fetchNextPage(cursor);
    if (page.length === 0) break;

    for (const row of page) {
      cursor = row.id; // advance regardless of outcome — never re-fetch the same page
      if (!first) await sleep(THROTTLE_MS);
      first = false;

      processed++;
      try {
        await processRow(row);
        succeeded++;
      } catch (e) {
        failed++;
        console.error(`[FAIL] file ${row.id}: ${(e as Error).message}`);
      }
    }
  }

  console.log(`\nDone. processed=${processed} succeeded=${succeeded} failed=${failed}`);
  if (failed > 0) process.exitCode = 1;
}

await main();

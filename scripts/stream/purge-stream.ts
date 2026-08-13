/**
 * Full teardown of Cloudflare Stream (spec 2026-08-13, plan section 5.2).
 * Lists every video in the Stream account, deletes each one, then clears
 * `stream_uid`/`stream_status` on every `files` row that still references a
 * (now-deleted) video. Destructive and irreversible — prompts for
 * confirmation on stdin before doing anything.
 *
 * Only needs the cleanup half of the Stream credentials (same split as
 * isStreamCleanupEnabled() in supabase/functions/_shared/stream.ts): this is
 * the "kill switch" / full-teardown script, not the ingest path.
 *
 * Usage (Node 18+, run via tsx; NEVER pass secrets as CLI args):
 *   set -a; source <(cat .env.stream.local); set +a
 *   npx tsx scripts/stream/purge-stream.ts
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STREAM_ACCOUNT_ID,
 * STREAM_API_TOKEN.
 */

import { createClient } from "@supabase/supabase-js";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} required`);
  return value;
}

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const STREAM_ACCOUNT_ID = requireEnv("STREAM_ACCOUNT_ID");
const STREAM_API_TOKEN = requireEnv("STREAM_API_TOKEN");

const STREAM_BASE = `https://api.cloudflare.com/client/v4/accounts/${STREAM_ACCOUNT_ID}/stream`;
const AUTH_HEADERS = { Authorization: `Bearer ${STREAM_API_TOKEN}` };

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface StreamVideo {
  uid: string;
  created: string;
}

/** Mirrors supabase/functions/_shared/stream.ts's listStreamVideos(). */
async function listAllVideos(): Promise<StreamVideo[]> {
  const items: StreamVideo[] = [];
  let after: string | undefined;
  for (;;) {
    const url = after
      ? `${STREAM_BASE}?asc=true&after=${encodeURIComponent(after)}`
      : `${STREAM_BASE}?asc=true`;
    const res = await fetch(url, { headers: AUTH_HEADERS });
    if (!res.ok) throw new Error(`stream list failed: ${res.status}`);
    const json = (await res.json()) as { result?: StreamVideo[] };
    const page = json.result ?? [];
    items.push(...page);
    if (page.length < 1000) break;
    const last = page[page.length - 1]?.created;
    if (!last) break;
    after = last;
  }
  return items;
}

/** Mirrors supabase/functions/_shared/stream.ts's deleteStreamVideo() — a 404 (already gone) is success. */
async function deleteVideo(uid: string): Promise<void> {
  const res = await fetch(`${STREAM_BASE}/${uid}`, { method: "DELETE", headers: AUTH_HEADERS });
  if (res.status === 200 || res.status === 404) return;
  throw new Error(`stream delete failed: ${res.status}`);
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(question);
    return answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  console.log("Listando vídeos no Cloudflare Stream...");
  const videos = await listAllVideos();
  console.log(`Encontrados ${videos.length} vídeo(s) no Stream.`);

  const ok = await confirm(
    `Isso vai apagar ${videos.length} vídeo(s) do Cloudflare Stream de forma permanente ` +
      "e limpar as referências em files. continuar? (yes/NO) ",
  );
  if (!ok) {
    console.log("Abortado. Nenhuma alteração foi feita.");
    return;
  }

  let deleted = 0;
  let failed = 0;
  for (const video of videos) {
    try {
      await deleteVideo(video.uid);
      deleted++;
      console.log(`[OK] apagado ${video.uid}`);
    } catch (e) {
      failed++;
      console.error(`[FAIL] ${video.uid}: ${(e as Error).message}`);
    }
  }
  console.log(`Apagados ${deleted}/${videos.length} vídeo(s) (${failed} falha(s)).`);

  const { data: cleared, error } = await db
    .from("files")
    .update({ stream_uid: null, stream_status: null })
    .not("stream_uid", "is", null)
    .select("id");
  if (error) {
    console.error(`Falha ao limpar stream_uid/stream_status em files: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Referências limpas em files: ${cleared?.length ?? 0} linha(s).`);
  if (failed > 0) process.exitCode = 1;
}

await main();

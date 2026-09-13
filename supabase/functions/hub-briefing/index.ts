import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { headObjectSigned, signGetUrl, signPutUrl } from "../_shared/r2.ts";
import { makeBoundedFetch } from "../_shared/bounded-fetch.ts";
import { makeWorkerTranscriber } from "../_shared/briefing-audio.ts";
import { createHubBriefingHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(createHubBriefingHandler({
  buildCorsHeaders,
  createDb: () =>
    createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      // Handler grava estado (quota RPC + R2 HEAD): teto em toda chamada Supabase.
      global: { fetch: makeBoundedFetch() },
    }),
  now: () => new Date().toISOString(),
  // deno-lint-ignore no-explicit-any
  rateLimit: (db, key, max, win) => checkRateLimit(db as any, key, max, win),
  signPutUrl,
  signGetUrl,
  headObject: headObjectSigned,
  // Sem TRANSCRIBE_WORKER_URL/TRANSCRIBE_SECRET o áudio salva e a transcrição fica "failed".
  transcribe: makeWorkerTranscriber({
    url: Deno.env.get("TRANSCRIBE_WORKER_URL"),
    secret: Deno.env.get("TRANSCRIBE_SECRET"),
  }),
}));

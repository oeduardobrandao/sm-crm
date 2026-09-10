import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { signPutUrl, signGetUrl, headObject } from "../_shared/r2.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { makeWorkerTranscriber } from "../_shared/ideia-audio.ts";
import { createHubIdeiasHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(createHubIdeiasHandler({
  buildCorsHeaders,
  createDb: () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY),
  now: () => new Date().toISOString(),
  signPutUrl,
  signGetUrl,
  headObject,
  // deno-lint-ignore no-explicit-any
  rateLimit: (db, key, max, win) => checkRateLimit(db as any, key, max, win),
  // Sem TRANSCRIBE_WORKER_URL/TRANSCRIBE_SECRET o áudio salva e a transcrição fica "failed".
  transcribe: makeWorkerTranscriber({
    url: Deno.env.get("TRANSCRIBE_WORKER_URL"),
    secret: Deno.env.get("TRANSCRIBE_SECRET"),
  }),
}));

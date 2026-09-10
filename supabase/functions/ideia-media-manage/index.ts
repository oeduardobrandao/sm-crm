import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { signPutUrl, signGetUrl, headObject } from "../_shared/r2.ts";
import { makeWorkerTranscriber } from "../_shared/ideia-audio.ts";
import { createIdeiaMediaManageHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(createIdeiaMediaManageHandler({
  buildCorsHeaders,
  // Service-role client; auth.getUser(token) still validates the caller's JWT.
  createDb: () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY),
  signPutUrl,
  signGetUrl,
  headObject,
  transcribe: makeWorkerTranscriber({
    url: Deno.env.get("TRANSCRIBE_WORKER_URL"),
    secret: Deno.env.get("TRANSCRIBE_SECRET"),
  }),
}));

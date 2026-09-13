import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { signGetUrl } from "../_shared/r2.ts";
import { makeBoundedFetch } from "../_shared/bounded-fetch.ts";
import { createBriefingAudioHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(createBriefingAudioHandler({
  buildCorsHeaders,
  createDb: () =>
    createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      // Teto em toda chamada Supabase, igual ao hub-briefing: uma chamada pendurada
      // não pode segurar a function até o kill do runtime.
      global: { fetch: makeBoundedFetch() },
    }),
  signGetUrl,
}));

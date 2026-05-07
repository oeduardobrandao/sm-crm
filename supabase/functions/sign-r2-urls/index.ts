import { createClient } from "npm:@supabase/supabase-js@2";
import { signGetUrl } from "../_shared/r2.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { createSignR2UrlsHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(createSignR2UrlsHandler({
  buildCorsHeaders,
  createDb: () => createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  }),
  signGetUrl,
}));

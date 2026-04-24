import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { createHubInstagramFeedHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(createHubInstagramFeedHandler({
  buildCorsHeaders,
  createDb: () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY),
  now: () => new Date().toISOString(),
}));

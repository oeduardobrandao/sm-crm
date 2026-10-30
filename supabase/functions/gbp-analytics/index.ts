// supabase/functions/gbp-analytics/index.ts
//
// Env wiring + dispatch only. Route logic lives in handlers.ts so it stays testable with injected
// deps. Deployed with --no-verify-jwt: the handler verifies the user JWT itself.

import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { createGbpAnalyticsHandler } from "./handlers.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(createGbpAnalyticsHandler({
  buildCorsHeaders,
  // deno-lint-ignore no-explicit-any
  createServiceDb: () => createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) as any,
}));

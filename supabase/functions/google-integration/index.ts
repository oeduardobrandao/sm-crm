// supabase/functions/google-integration/index.ts
//
// Env wiring + dispatch only. Route logic lives in handlers.ts so it stays testable with
// injected deps (the tiktok-integration/{index,handlers}.ts shape). Deployed with
// --no-verify-jwt: /callback is reached by Google's redirect without a JWT, and every other
// route verifies the user JWT itself (tenant.ts).

import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { createGoogleIntegrationHandler } from "./handlers.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(createGoogleIntegrationHandler({
  buildCorsHeaders,
  createServiceDb: () => createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY),
}));

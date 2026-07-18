// supabase/functions/tiktok-integration/index.ts
//
// Env wiring + dispatch only — route logic lives in handlers.ts (kept out of this file so
// it stays independently testable with injected deps, per instagram-publish/{index,handler}.ts).

import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { createTikTokIntegrationHandler } from "./handlers.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(createTikTokIntegrationHandler({
  buildCorsHeaders,
  // deno-lint-ignore no-explicit-any
  createServiceDb: () => createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) as any,
}));

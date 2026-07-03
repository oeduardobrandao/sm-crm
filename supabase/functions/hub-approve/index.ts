import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { createDesignRenderTrigger } from "../_shared/design-render-trigger.ts";
import { createHubApproveHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Optional on purpose — see instagram-publish/index.ts; without it the accepted silent
// auto-publish skip stands, just without the background render kick.
const CRON_SECRET = Deno.env.get("CRON_SECRET");

Deno.serve(createHubApproveHandler({
  buildCorsHeaders,
  createDb: () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY),
  now: () => new Date().toISOString(),
  triggerDesignRender: CRON_SECRET ? createDesignRenderTrigger(SUPABASE_URL, CRON_SECRET) : undefined,
  // deno-lint-ignore no-undef -- EdgeRuntime is a Supabase Edge Runtime global.
  waitUntil: (promise) => { EdgeRuntime.waitUntil(promise); },
}));

// supabase/functions/instagram-publish/index.ts

import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { createDesignRenderTrigger } from "../_shared/design-render-trigger.ts";
import { createPublishHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Optional on purpose: the design re-trigger (T4.1) is best-effort — an env without the cron
// secret (e.g. bare local serve) still validates/blocks correctly, it just doesn't kick renders.
const CRON_SECRET = Deno.env.get("CRON_SECRET");

Deno.serve(createPublishHandler({
  buildCorsHeaders,
  createDb: (jwt: string) => createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  }),
  createServiceDb: () => createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY),
  triggerDesignRender: CRON_SECRET ? createDesignRenderTrigger(SUPABASE_URL, CRON_SECRET) : undefined,
  // deno-lint-ignore no-undef -- EdgeRuntime is a Supabase Edge Runtime global.
  waitUntil: (promise) => { EdgeRuntime.waitUntil(promise); },
}));

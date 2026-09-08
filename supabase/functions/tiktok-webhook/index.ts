// supabase/functions/tiktok-webhook/index.ts
//
// Env wiring only — business logic lives in handler.ts (per instagram-publish/{index,handler}.ts
// and tiktok-publish-cron/{index,core,handler}.ts's split). Public endpoint (config.toml:
// verify_jwt = false) — the client_key + known-user_openid checks inside handler.ts ARE the auth.

import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { requireTikTokClientCredentials } from "../_shared/tiktok.ts";
import { createTikTokWebhookHandler } from "./handler.ts";

// EdgeRuntime is a Supabase Edge Runtime global (not in Deno's lib types).
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Throws if TIKTOK_CLIENT_KEY/TIKTOK_CLIENT_SECRET are missing (single source of truth for that
// requirement, same helper tiktok-integration's OAuth flow and _shared/tiktok.ts's refresh path
// already use) — this function cannot validate incoming webhooks without it.
const { clientKey: TIKTOK_CLIENT_KEY } = requireTikTokClientCredentials();

Deno.serve(createTikTokWebhookHandler({
  buildCorsHeaders,
  createServiceDb: () => createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY),
  tiktokClientKey: TIKTOK_CLIENT_KEY,
  waitUntil: (promise) => { EdgeRuntime.waitUntil(promise); },
}));

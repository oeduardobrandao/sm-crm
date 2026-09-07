// supabase/functions/instagram-webhook/index.ts
// Env wiring apenas; lógica em handler.ts / process.ts.
import { createClient } from "npm:@supabase/supabase-js@2";
import { createInstagramWebhookHandler } from "./handler.ts";
import { createProcessDelivery } from "./process.ts";

// EdgeRuntime is a Supabase Edge Runtime global (not in Deno's lib types).
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const META_APP_SECRET = Deno.env.get("META_APP_SECRET");
const META_WEBHOOK_VERIFY_TOKEN = Deno.env.get("META_WEBHOOK_VERIFY_TOKEN");
if (!META_APP_SECRET) throw new Error("META_APP_SECRET is required");
if (!META_WEBHOOK_VERIFY_TOKEN) throw new Error("META_WEBHOOK_VERIFY_TOKEN is required");

Deno.serve(createInstagramWebhookHandler({
  createServiceDb: () => createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY),
  metaAppSecret: META_APP_SECRET,
  verifyToken: META_WEBHOOK_VERIFY_TOKEN,
  processDelivery: createProcessDelivery({}),
  waitUntil: (promise) => { EdgeRuntime.waitUntil(promise); },
}));

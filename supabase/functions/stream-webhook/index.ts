// supabase/functions/stream-webhook/index.ts
//
// Env wiring only — business logic lives in handler.ts. Public endpoint (config.toml:
// verify_jwt = false): the Webhook-Signature HMAC check inside handler.ts IS the auth.
import { createClient } from "npm:@supabase/supabase-js@2";
import { verifyStreamWebhookSignature } from "../_shared/stream.ts";
import { createStreamWebhookHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(createStreamWebhookHandler({
  createDb: () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } }),
  verifySignature: (body, header) => verifyStreamWebhookSignature(body, header),
}));

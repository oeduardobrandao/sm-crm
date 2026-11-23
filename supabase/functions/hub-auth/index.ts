import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { createHubAuthHandler } from "./handler.ts";
import { sendLoginCodeEmail } from "./email.ts";
import { base64Url, generateLoginCode } from "./logic.ts";

// EdgeRuntime is a Supabase Edge Runtime global (not in Deno's lib types).
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

Deno.serve(createHubAuthHandler({
  buildCorsHeaders,
  createDb: () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY),
  now: () => new Date().toISOString(),
  // deno-lint-ignore no-explicit-any
  rateLimit: (db, key, max, win) => checkRateLimit(db as any, key, max, win),
  generateCode: () => generateLoginCode(randomBytes),
  generateSessionToken: () => base64Url(randomBytes(32)),
  sendCodeEmail: sendLoginCodeEmail,
  defer: (work) => {
    EdgeRuntime.waitUntil(work);
  },
}));

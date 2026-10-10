import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit, getClientIP } from "../_shared/rate-limit.ts";
import { appBaseUrl } from "../_shared/app-url.ts";
import { sendAffiliateLinkEmail } from "./email.ts";
import { createAffiliatePublicHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(createAffiliatePublicHandler({
  buildCorsHeaders,
  db: svc,
  rateLimit: (key, max, windowSeconds) => checkRateLimit(svc, key, max, windowSeconds),
  getClientIP,
  sendLinkEmail: sendAffiliateLinkEmail,
  appBaseUrl,
  now: () => new Date(),
  randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
}));

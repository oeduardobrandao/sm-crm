import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { createJsonResponder, internalServerError } from "../_shared/http.ts";
import { signEmail } from "./sign.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRISP_IDENTITY_SECRET = Deno.env.get("CRISP_IDENTITY_SECRET") ??
  (() => {
    throw new Error("CRISP_IDENTITY_SECRET is required");
  })();

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = buildCorsHeaders(req);
  const json = createJsonResponder(cors);

  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Unauthorized" }, 401);

    // Service-role client + getUser(token). NOT an anon client: this project's
    // tokens are ES256 and an anon client cannot verify them.
    const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data, error } = await svc.auth.getUser(token);
    // email_confirmed_at is required, not just a present email: GoTrue can
    // resolve a session for an account that registered but never confirmed
    // its address (depends on a dashboard setting this repo can't see or
    // control). Without this check, an attacker could register
    // victim@company.com, get a session pre-confirmation, and receive a
    // genuine signature for an email nobody proved they own -- the exact
    // failure this endpoint exists to prevent. Matches the candidate rule
    // crisp-sync-cron already enforces (email_confirmed_at is not null).
    if (error || !data.user?.email || !data.user.email_confirmed_at) {
      return json({ error: "Unauthorized" }, 401);
    }

    // THE EMAIL COMES FROM THE VERIFIED TOKEN, NEVER FROM THE REQUEST BODY.
    // Signing a caller-supplied address would turn this endpoint into an oracle
    // that mints a valid "verified" badge for any customer on demand -- strictly
    // worse than having no identity verification at all, because the badge would
    // then be actively misleading.
    const signature = await signEmail(data.user.email, CRISP_IDENTITY_SECRET);
    return json({ signature });
  } catch (err) {
    return internalServerError(json, "crisp-identity", err);
  }
});

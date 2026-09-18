import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { createJsonResponder, internalServerError } from "../_shared/http.ts";
import { signEmail } from "./sign.ts";
import { getOrCreateCrispToken } from "./session.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRISP_IDENTITY_SECRET = Deno.env.get("CRISP_IDENTITY_SECRET") ??
  (() => {
    throw new Error("CRISP_IDENTITY_SECRET is required");
  })();

// Per-request bound on every call the client below makes (getUser and the
// crisp_sessions upsert). The CRM gives the whole invoke 5s
// (AuthContext.tsx, `timeout: 5000`) and falls back to an UNSIGNED push when
// that fires, so a stalled PostgREST call on the new, best-effort upsert would
// cost the user the signature too -- exactly what best-effort is meant to
// rule out. Two sequential calls at 2s each stay inside the client's 5s.
// Same shape as crisp-sync-cron's bounded global fetch.
const REQUEST_TIMEOUT_MS = 2_000;

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = buildCorsHeaders(req);
  const json = createJsonResponder(cors);

  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Unauthorized" }, 401);

    // Service-role client + getUser(token). NOT an anon client: this project's
    // tokens are ES256 and an anon client cannot verify them.
    const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: {
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          fetch(input, {
            ...init,
            signal: init?.signal
              ? AbortSignal.any([init.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
              : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          }),
      },
    });
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

    // Session Continuity token, best-effort: null on any failure, in which
    // case the response simply omits crispToken and the CRM leaves whatever
    // binding it already has untouched (spec, Data flow step 3, "absent").
    // Same JWT trust boundary as the signature: user id from the verified
    // token, never from the request.
    const crispToken = await getOrCreateCrispToken(svc, data.user.id);
    return json(crispToken ? { signature, crispToken } : { signature });
  } catch (err) {
    return internalServerError(json, "crisp-identity", err);
  }
});

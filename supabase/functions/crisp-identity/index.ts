import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { createJsonResponder } from "../_shared/http.ts";
import { signEmail } from "./sign.ts";

// Re-exported for callers that only need the pure signing function. Tests
// import it from ./sign.ts directly, not from here: this module also reads
// CRISP_IDENTITY_SECRET at the top level below and throws if it is missing,
// which would abort the whole Deno test run on import (there is no env var
// set for the edge-function-tests CI job). Same split as
// crisp-sync-cron/handler.ts vs. crisp-sync-cron/index.ts.
export { signEmail };

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

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Unauthorized" }, 401);

  // Service-role client + getUser(token). NOT an anon client: this project's
  // tokens are ES256 and an anon client cannot verify them.
  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await svc.auth.getUser(token);
  if (error || !data.user?.email) return json({ error: "Unauthorized" }, 401);

  // THE EMAIL COMES FROM THE VERIFIED TOKEN, NEVER FROM THE REQUEST BODY.
  // Signing a caller-supplied address would turn this endpoint into an oracle
  // that mints a valid "verified" badge for any customer on demand -- strictly
  // worse than having no identity verification at all, because the badge would
  // then be actively misleading.
  const signature = await signEmail(data.user.email, CRISP_IDENTITY_SECRET);
  return json({ signature });
});

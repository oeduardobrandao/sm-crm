// Serve shell for the 12x checkout: CORS, JWT auth, workspace-owner check, rate limit and
// body validation. Everything after that is handler.ts (unit-tested with injected deps).
// Auth is byte-for-byte the billing-checkout pattern: service-role client + getUser(token),
// owner checked against workspace_members for THIS workspace, never profiles.role.

import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { isWorkspaceOwner } from "../_shared/workspace-role.ts";
import { checkRateLimit, getClientIP } from "../_shared/rate-limit.ts";
import { parseCheckoutBody } from "./logic.ts";
import { createPagarmeGateway } from "./gateway.ts";
import { createPagarmeCheckoutHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req: Request) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const headers = { "Content-Type": "application/json", ...corsHeaders };

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, headers);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401, headers);
    const token = authHeader.replace("Bearer ", "");

    const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: { user }, error: authError } = await svc.auth.getUser(token);
    if (authError || !user) return json({ error: "Unauthorized" }, 401, headers);
    if (!user.email) return json({ error: "Unauthorized" }, 401, headers);

    const { data: profile } = await svc
      .from("profiles").select("conta_id, nome").eq("id", user.id).single();
    if (!profile?.conta_id) return json({ error: "No workspace" }, 400, headers);
    const workspaceId = profile.conta_id as string;

    const { data: membership } = await svc
      .from("workspace_members")
      .select("role")
      .eq("user_id", user.id)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!isWorkspaceOwner(membership?.role as string | null | undefined)) {
      return json({ error: "Forbidden" }, 403, headers);
    }

    // This endpoint charges a tokenized card — a card-testing target. Tighter than the
    // usual limits: 5/h per workspace, 10/h per IP. checkRateLimit fails open by design.
    const wsAllowed = await checkRateLimit(svc, `pagarme-checkout:ws:${workspaceId}`, 5, 3600);
    const ipAllowed = await checkRateLimit(svc, `pagarme-checkout:ip:${getClientIP(req)}`, 10, 3600);
    if (!wsAllowed || !ipAllowed) {
      return json({ error: "Muitas tentativas. Aguarde alguns minutos e tente de novo." }, 429, headers);
    }

    // parseCheckoutBody takes `unknown` and 400s any non-object (null / string / array),
    // so a malformed JSON body can never turn into a 500 here.
    const body: unknown = await req.json().catch(() => null);
    const parsed = parseCheckoutBody(body);
    if (!parsed.ok) return json({ error: parsed.error, code: parsed.code }, parsed.status, headers);

    const handle = createPagarmeCheckoutHandler({
      db: svc,
      gateway: createPagarmeGateway(),
      now: () => new Date(),
    });
    const result = await handle(
      {
        workspaceId,
        userEmail: user.email,
        userName: (profile.nome as string | null) ?? null,
      },
      parsed.value,
    );
    return json(result.body, result.status, headers);
  } catch (err) {
    // Message only — the request body carries card_token/document/address and must never
    // reach the logs (PCI/LGPD).
    console.error("[pagarme-checkout] error:", err instanceof Error ? err.message : String(err));
    return json({ error: "Internal server error" }, 500, headers);
  }
});

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers });
}

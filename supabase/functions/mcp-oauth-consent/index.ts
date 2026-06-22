// mcp-oauth-consent — backs the CRM OAuth consent page (/oauth/consent). When a Mesaas user
// approves a claude.ai connection, we persist the consent grant (user + OAuth client → workspace +
// scopes) that the MCP resource server later resolves. The browser drives Supabase's OAuth
// approve/deny (it owns the session + redirect); this function only records OUR grant binding.
//
// JWT-authed (the CRM user); does its own owner/admin + feature check; writes via service role
// (mcp_oauth_grants writes are service-role-only by RLS). Deploy WITHOUT --no-verify-jwt is NOT
// used here — keep gateway JWT verification on, like mcp-keys.
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { insertAuditLog } from "../_shared/audit.ts";
import { assertPlanFeature, FeatureDisabledError } from "../_shared/entitlements.ts";
import { effectivePlanFeature } from "../_shared/entitlements-rpc.ts";
import { validateConsentPayload } from "../_shared/mcp-oauth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function isManager(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const anon = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await anon.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await req.json().catch(() => ({}));
    const action = body.action as string;

    // Workspaces the user may connect: their owner/admin memberships, annotated with whether the
    // workspace's plan enables MCP (the consent UI disables the rest).
    if (action === "eligible-workspaces") {
      const { data: memberships } = await svc
        .from("workspace_members")
        .select("workspace_id, role, workspaces!inner(id, name)")
        .eq("user_id", user.id)
        .in("role", ["owner", "admin"]);
      const rows = (memberships ?? []) as any[];
      const workspaces = [];
      for (const m of rows) {
        const feature_mcp = await effectivePlanFeature(svc, m.workspace_id as string, "feature_mcp");
        workspaces.push({
          id: m.workspace_id as string,
          name: (m.workspaces?.name as string) ?? "Workspace",
          role: m.role as string,
          feature_mcp,
        });
      }
      return json({ workspaces });
    }

    // Record (or re-point) the consent grant for this user + OAuth client → workspace + scopes.
    if (action === "approve") {
      const parsed = validateConsentPayload(body);
      if (!parsed.ok) return json({ error: parsed.error }, 400);
      const { client_id, conta_id, scopes } = parsed.value;

      // Authorize against the CHOSEN workspace (not the active one): must be owner/admin there.
      const { data: membership } = await svc
        .from("workspace_members")
        .select("role")
        .eq("user_id", user.id)
        .eq("workspace_id", conta_id)
        .maybeSingle();
      if (!membership || !isManager(membership.role as string)) {
        return json({ error: "Insufficient permissions" }, 403);
      }

      try {
        await assertPlanFeature(svc, conta_id, "feature_mcp");
      } catch (e) {
        if (e instanceof FeatureDisabledError) {
          return json({ error: "feature_disabled", feature: "feature_mcp" }, 403);
        }
        throw e;
      }

      const now = new Date().toISOString();
      const { error } = await svc
        .from("mcp_oauth_grants")
        .upsert(
          {
            user_id: user.id,
            client_id,
            conta_id,
            scopes,
            revoked_at: null,
            revoked_by: null,
            updated_at: now,
          },
          { onConflict: "user_id,client_id" },
        );
      if (error) throw error;

      await insertAuditLog(svc, {
        conta_id,
        actor_user_id: user.id,
        action: "mcp.oauth.grant",
        resource_type: "mcp_oauth_grant",
        resource_id: client_id,
        metadata: {
          scopes,
          authorization_id: typeof body.authorization_id === "string" ? body.authorization_id : null,
        },
      });
      return json({ ok: true });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error("[mcp-oauth-consent] error:", e);
    return json({ error: "Internal error." }, 500);
  }
});

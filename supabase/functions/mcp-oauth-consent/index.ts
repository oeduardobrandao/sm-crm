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
import {
  boundGrantScopes,
  mcpScopesFromClaim,
  validateConsentPayload,
} from "../_shared/mcp-oauth.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function isManager(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

/**
 * Fetches Supabase's OAuth authorization details for a pending authorization, verified with the
 * USER's bearer token (proves this user is the subject of that request). Returns the registered
 * client_id + the MCP scopes the request named, or null if invalid / not this user's / consumed.
 * This is the server-side source of truth for client_id — the browser's value is never trusted.
 */
async function fetchAuthorizationDetails(
  authorizationId: string,
  authHeader: string,
): Promise<{ clientId: string; requestedMcp: string[] } | null> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/auth/v1/oauth/authorizations/${encodeURIComponent(authorizationId)}`,
      { headers: { Authorization: authHeader, apikey: ANON_KEY } },
    );
    if (!res.ok) return null;
    const det = await res.json();
    const clientId = det?.client?.id;
    if (typeof clientId !== "string" || !clientId) return null;
    return { clientId, requestedMcp: mcpScopesFromClaim(det?.scope) };
  } catch (_e) {
    return null;
  }
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
      const { authorization_id, conta_id, scopes } = parsed.value;

      // Derive the OAuth client + requested scopes from Supabase's verified authorization details —
      // never from the browser. A mismatched/forged client_id can't bind a grant here.
      const auth = await fetchAuthorizationDetails(authorization_id, authHeader);
      if (!auth) return json({ error: "invalid_authorization" }, 400);
      const { clientId, requestedMcp } = auth;

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

      // The grant can't exceed what the request asked for (when it named MCP scopes).
      const grantScopes = boundGrantScopes(scopes, requestedMcp);
      if (grantScopes.length === 0) return json({ error: "no_scopes_granted" }, 400);

      const now = new Date().toISOString();
      const { error } = await svc
        .from("mcp_oauth_grants")
        .upsert(
          {
            user_id: user.id,
            client_id: clientId,
            conta_id,
            scopes: grantScopes,
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
        resource_id: clientId,
        metadata: { scopes: grantScopes, authorization_id },
      });
      return json({ ok: true });
    }

    // List / revoke the workspace's Claude OAuth connections — owner/admin of the ACTIVE workspace.
    if (action === "list-grants" || action === "revoke-grant") {
      const { data: profile } = await svc
        .from("profiles")
        .select("role, conta_id")
        .eq("id", user.id)
        .single();
      if (!profile || !isManager(profile.role as string)) {
        return json({ error: "Insufficient permissions" }, 403);
      }
      const contaId = profile.conta_id as string;

      if (action === "list-grants") {
        const { data: grants } = await svc
          .from("mcp_oauth_grants")
          .select("id, client_id, scopes, created_at, revoked_at, user_id")
          .eq("conta_id", contaId)
          .order("created_at", { ascending: false });
        const rows = (grants ?? []) as any[];
        const userIds = [...new Set(rows.map((g) => g.user_id as string))];
        const { data: profs } = userIds.length
          ? await svc.from("profiles").select("id, nome").in("id", userIds)
          : { data: [] as any[] };
        const nameById = new Map((profs ?? []).map((p: any) => [p.id, p.nome]));
        const out = rows.map((g) => ({
          id: g.id,
          client_id: g.client_id,
          scopes: g.scopes,
          created_at: g.created_at,
          revoked_at: g.revoked_at,
          connected_by: nameById.get(g.user_id) ?? null,
        }));
        return json({ grants: out });
      }

      // revoke-grant
      const grantId = typeof body.grant_id === "string" ? body.grant_id : "";
      if (!grantId) return json({ error: "grant_id required" }, 400);
      const { data, error } = await svc
        .from("mcp_oauth_grants")
        .update({ revoked_at: new Date().toISOString(), revoked_by: user.id })
        .eq("id", grantId)
        .eq("conta_id", contaId)
        .is("revoked_at", null)
        .select("id, client_id")
        .maybeSingle();
      if (error) throw error;
      if (!data) return json({ error: "not found" }, 404);
      await insertAuditLog(svc, {
        conta_id: contaId,
        actor_user_id: user.id,
        action: "mcp.oauth.revoke",
        resource_type: "mcp_oauth_grant",
        resource_id: data.client_id as string,
        metadata: {},
      });
      return json({ ok: true });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error("[mcp-oauth-consent] error:", e);
    return json({ error: "Internal error." }, 500);
  }
});

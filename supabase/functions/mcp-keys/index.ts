// mcp-keys — workspace owner/admin manage their MCP API keys (create / list / revoke).
// JWT-authed (the CRM user); does its own owner/admin + feature check; writes via service role
// (mcp_api_keys writes are service-role-only by RLS). Deploy WITHOUT --no-verify-jwt.
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { insertAuditLog } from "../_shared/audit.ts";
import { assertPlanFeature, FeatureDisabledError } from "../_shared/entitlements.ts";
import { generateApiKey, validateScopes } from "../_shared/mcp-token.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// token_hash is never selected (column-grant hides it from clients; we never expose it here either).
const SAFE_COLS = "id, name, token_suffix, scopes, last_used_at, expires_at, revoked_at, created_at";

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const anon = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authErr } = await anon.auth.getUser();
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: profile } = await svc.from("profiles").select("role, conta_id").eq("id", user.id).single();
    if (!profile) return json({ error: "Profile not found" }, 403);
    if (profile.role !== "owner" && profile.role !== "admin") {
      return json({ error: "Insufficient permissions" }, 403);
    }
    const contaId = profile.conta_id as string;

    const body = await req.json().catch(() => ({}));
    const action = body.action as string;

    if (action === "list") {
      const { data } = await svc.from("mcp_api_keys").select(SAFE_COLS)
        .eq("conta_id", contaId).order("created_at", { ascending: false });
      return json({ keys: data ?? [] });
    }

    if (action === "create") {
      try {
        await assertPlanFeature(svc, contaId, "feature_mcp");
      } catch (e) {
        if (e instanceof FeatureDisabledError) return json({ error: "feature_disabled", feature: "feature_mcp" }, 403);
        throw e;
      }
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) return json({ error: "name required" }, 400);
      if (!validateScopes(body.scopes)) return json({ error: "invalid scopes" }, 400);
      const expires_at = typeof body.expires_at === "string" ? body.expires_at : null;

      const { raw, hash, suffix } = await generateApiKey();
      const { data, error } = await svc.from("mcp_api_keys").insert({
        conta_id: contaId, created_by: user.id, name,
        token_hash: hash, token_suffix: suffix, scopes: body.scopes, expires_at,
      }).select(SAFE_COLS).single();
      if (error) {
        // The trg_limit_mcp_keys trigger raises 'plan_limit_exceeded:max_mcp_keys'.
        if (String(error.message ?? "").includes("plan_limit_exceeded")) {
          return json({ error: "key_limit_reached" }, 409);
        }
        throw error;
      }
      await insertAuditLog(svc, {
        conta_id: contaId, actor_user_id: user.id, action: "mcp.key.create",
        resource_type: "mcp_api_key", resource_id: String(data.id),
        metadata: { name, scopes: body.scopes },
      });
      // raw token returned ONCE — never stored, never logged.
      return json({ token: raw, key: data }, 201);
    }

    if (action === "revoke") {
      const id = body.id;
      if (!id) return json({ error: "id required" }, 400);
      const { data, error } = await svc.from("mcp_api_keys")
        .update({ revoked_at: new Date().toISOString(), revoked_by: user.id })
        .eq("id", id).eq("conta_id", contaId).is("revoked_at", null)
        .select("id").maybeSingle();
      if (error) throw error;
      if (!data) return json({ error: "not found" }, 404);
      await insertAuditLog(svc, {
        conta_id: contaId, actor_user_id: user.id, action: "mcp.key.revoke",
        resource_type: "mcp_api_key", resource_id: String(id), metadata: {},
      });
      return json({ ok: true });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e) {
    console.error("[mcp-keys] error:", e);
    return json({ error: "Internal error." }, 500);
  }
});

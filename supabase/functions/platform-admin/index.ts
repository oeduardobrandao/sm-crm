import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { revertPlanTarget } from "./revert-target.ts";
import { handleCreatePlan, handleUpdatePlan } from "./plan-mutations.ts";
import { handleGetWorkspaceInvites, handleAdminCancelInvite, handleAdminResendInvite, handleAdminCreateInvite } from "./invite-handlers.ts";
import { handleListWorkspaces } from "./list-workspaces.ts";
import { handleListWorkspaceEvents } from "./event-history.ts";
import { handleGetMrr, handleGetTrials } from "./mrr.ts";
import { handleListPopups, handleCreatePopup, handleUpdatePopup, handleDeletePopup } from "./popups.ts";
import { normalizeBanner, pickBannerColumns, validateBanner } from "../_shared/admin-banners.ts";
import {
  collectR2Keys, contentNeedsOwnership, coverNeedsOwnership, isUniqueViolation, normalizeKb, pickKbColumns,
  validateKbArticle,
} from "../_shared/admin-kb.ts";
import { adminContaId } from "../_shared/admin-popups.ts";
import { handleGetWorkspace } from "./workspace-detail.ts";
import { handleListPlans } from "./plans.ts";
import { setStripeLoader } from "../_shared/stripe-loader.ts";
import { listAdminMcpGrants, revokeAdminMcpGrant } from "../_shared/admin-mcp-grants.ts";

// Registra o loader do Stripe só para este function -- ver _shared/stripe-loader.ts. mcp-admin
// não registra nada, e cai no fallback do espelho/catálogo (o comportamento desejado para as
// tools de leitura, e o que desbloqueia o bundling remoto do --use-api).
setStripeLoader(() => import("../_shared/stripe.ts").then((m) => m.stripe));

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req: Request) => {
  const corsHeaders = buildCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const headers = { "Content-Type": "application/json", ...corsHeaders };

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }

    const token = authHeader.replace("Bearer ", "");
    const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: { user }, error: authError } = await svc.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }

    const { data: admin } = await svc
      .from("platform_admins")
      .select("id, email")
      .eq("user_id", user.id)
      .single();

    const body = await req.json();
    const { action } = body;

    if (action === "verify-admin") {
      return new Response(JSON.stringify({ is_admin: !!admin }), { status: 200, headers });
    }

    if (!admin) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers });
    }

    switch (action) {
      case "list-workspaces":
        return await handleListWorkspaces(svc, body, headers);
      case "list-workspace-events":
        return await handleListWorkspaceEvents(svc, body, headers);
      case "get-workspace":
        return await handleGetWorkspace(svc, body, headers);
      case "get-workspace-invites":
        return await handleGetWorkspaceInvites(svc, body, headers);
      case "admin-cancel-invite":
        return await handleAdminCancelInvite(svc, body, user.id, headers);
      case "admin-resend-invite":
        return await handleAdminResendInvite(svc, body, user.id, headers);
      case "admin-create-invite":
        return await handleAdminCreateInvite(svc, body, user.id, headers);
      case "list-plans":
        return await handleListPlans(svc, headers);
      case "get-mrr":
        return await handleGetMrr(svc, headers);
      case "get-trials":
        return await handleGetTrials(svc, headers);
      case "create-plan":
        return await handleCreatePlan(svc, body, headers);
      case "update-plan":
        return await handleUpdatePlan(svc, body, headers);
      case "delete-plan":
        return await handleDeletePlan(svc, body, headers);
      case "set-workspace-plan":
        return await handleSetWorkspacePlan(svc, body, admin.id, headers);
      case "unset-workspace-plan":
        return await handleUnsetWorkspacePlan(svc, body, admin.id, headers);
      case "set-workspace-overrides":
        return await handleSetWorkspaceOverrides(svc, body, admin.id, headers);
      case "clear-workspace-overrides":
        return await handleClearWorkspaceOverrides(svc, body, admin.id, headers);
      case "list-workspace-mcp-keys":
        return await handleListWorkspaceMcpKeys(svc, body, headers);
      case "revoke-mcp-key":
        return await handleRevokeMcpKey(svc, body, user.id, headers);
      case "revoke-all-mcp-keys":
        return await handleRevokeAllMcpKeys(svc, body, user.id, headers);
      case "list-workspace-oauth-grants":
        return await handleListWorkspaceOAuthGrants(svc, body, headers);
      case "revoke-oauth-grant":
        return await handleRevokeOAuthGrant(svc, body, user.id, headers);
      case "revoke-all-oauth-grants":
        return await handleRevokeAllOAuthGrants(svc, body, user.id, headers);
      case "list-admin-mcp-grants":
        return await handleListAdminMcpGrants(svc, headers);
      case "revoke-admin-mcp-grant":
        return await handleRevokeAdminMcpGrant(svc, body, user.id, headers);
      case "list-admins":
        return await handleListAdmins(svc, headers);
      case "invite-admin":
        return await handleInviteAdmin(svc, body, admin.id, headers);
      case "remove-admin":
        return await handleRemoveAdmin(svc, body, admin.id, headers);
      case "list-banners":
        return await handleListBanners(svc, body, headers);
      case "create-banner":
        return await handleCreateBanner(svc, body, admin.id, headers);
      case "update-banner":
        return await handleUpdateBanner(svc, body, headers);
      case "delete-banner":
        return await handleDeleteBanner(svc, body, headers);
      case "list-popups":
        return await handleListPopups(svc, body, headers);
      case "create-popup":
        return await handleCreatePopup(svc, body, { adminId: admin.id, userId: user.id }, headers);
      case "update-popup":
        return await handleUpdatePopup(svc, body, { userId: user.id }, headers);
      case "delete-popup":
        return await handleDeletePopup(svc, body, headers);
      case "list-kb-articles":
        return await handleListKbArticles(svc, body, headers);
      case "get-kb-article":
        return await handleGetKbArticle(svc, body, headers);
      case "create-kb-article":
        return await handleCreateKbArticle(svc, body, { adminId: admin.id, userId: user.id }, headers);
      case "update-kb-article":
        return await handleUpdateKbArticle(svc, body, { userId: user.id }, headers);
      case "delete-kb-article":
        return await handleDeleteKbArticle(svc, body, headers);
      case "list-kb-context-links":
        return await handleListKbContextLinks(svc, body, headers);
      case "upsert-kb-context-link":
        return await handleUpsertKbContextLink(svc, body, headers);
      case "delete-kb-context-link":
        return await handleDeleteKbContextLink(svc, body, headers);
      default:
        return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers });
    }
  } catch (err) {
    console.error("[platform-admin] error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
});

// ─── MCP keys (platform-level observe/revoke; token_hash never selected) ───
const MCP_KEY_COLS =
  "id, name, token_suffix, scopes, last_used_at, expires_at, revoked_at, created_at";

async function handleListWorkspaceMcpKeys(
  svc: SupabaseClient,
  body: { workspace_id?: string },
  headers: Record<string, string>,
) {
  if (!body.workspace_id) {
    return new Response(JSON.stringify({ error: "workspace_id is required" }), { status: 400, headers });
  }
  const { data, error } = await svc
    .from("mcp_api_keys").select(MCP_KEY_COLS)
    .eq("conta_id", body.workspace_id).order("created_at", { ascending: false });
  if (error) throw error;
  return new Response(JSON.stringify({ keys: data ?? [] }), { status: 200, headers });
}

async function handleRevokeMcpKey(
  svc: SupabaseClient,
  body: { workspace_id?: string; key_id?: string },
  revokerUserId: string,
  headers: Record<string, string>,
) {
  if (!body.workspace_id || !body.key_id) {
    return new Response(JSON.stringify({ error: "workspace_id and key_id are required" }), { status: 400, headers });
  }
  const { error } = await svc.from("mcp_api_keys")
    .update({ revoked_at: new Date().toISOString(), revoked_by: revokerUserId })
    .eq("id", body.key_id).eq("conta_id", body.workspace_id).is("revoked_at", null);
  if (error) throw error;
  return new Response(JSON.stringify({ message: "Key revoked" }), { status: 200, headers });
}

async function handleRevokeAllMcpKeys(
  svc: SupabaseClient,
  body: { workspace_id?: string },
  revokerUserId: string,
  headers: Record<string, string>,
) {
  if (!body.workspace_id) {
    return new Response(JSON.stringify({ error: "workspace_id is required" }), { status: 400, headers });
  }
  const { data, error } = await svc.from("mcp_api_keys")
    .update({ revoked_at: new Date().toISOString(), revoked_by: revokerUserId })
    .eq("conta_id", body.workspace_id).is("revoked_at", null).select("id");
  if (error) throw error;
  return new Response(JSON.stringify({ message: "All keys revoked", count: (data ?? []).length }), { status: 200, headers });
}

// ─── MCP OAuth grants (Claude connections; platform-level observe/revoke) ───
async function handleListWorkspaceOAuthGrants(
  svc: SupabaseClient,
  body: { workspace_id?: string },
  headers: Record<string, string>,
) {
  if (!body.workspace_id) {
    return new Response(JSON.stringify({ error: "workspace_id is required" }), { status: 400, headers });
  }
  const { data: grants, error } = await svc
    .from("mcp_oauth_grants")
    .select("id, client_id, scopes, created_at, revoked_at, user_id")
    .eq("conta_id", body.workspace_id).order("created_at", { ascending: false });
  if (error) throw error;
  const rows = (grants ?? []) as Array<{ user_id: string; [k: string]: unknown }>;
  const userIds = [...new Set(rows.map((g) => g.user_id))];
  const { data: profs } = userIds.length
    ? await svc.from("profiles").select("id, nome").in("id", userIds)
    : { data: [] as Array<{ id: string; nome: string }> };
  const nameById = new Map((profs ?? []).map((p: { id: string; nome: string }) => [p.id, p.nome]));
  const out = rows.map((g) => ({
    id: g.id,
    client_id: g.client_id,
    scopes: g.scopes,
    created_at: g.created_at,
    revoked_at: g.revoked_at,
    connected_by: nameById.get(g.user_id) ?? null,
  }));
  return new Response(JSON.stringify({ grants: out }), { status: 200, headers });
}

async function handleRevokeOAuthGrant(
  svc: SupabaseClient,
  body: { workspace_id?: string; grant_id?: string },
  revokerUserId: string,
  headers: Record<string, string>,
) {
  if (!body.workspace_id || !body.grant_id) {
    return new Response(JSON.stringify({ error: "workspace_id and grant_id are required" }), { status: 400, headers });
  }
  const { error } = await svc.from("mcp_oauth_grants")
    .update({ revoked_at: new Date().toISOString(), revoked_by: revokerUserId })
    .eq("id", body.grant_id).eq("conta_id", body.workspace_id).is("revoked_at", null);
  if (error) throw error;
  return new Response(JSON.stringify({ message: "Connection revoked" }), { status: 200, headers });
}

async function handleRevokeAllOAuthGrants(
  svc: SupabaseClient,
  body: { workspace_id?: string },
  revokerUserId: string,
  headers: Record<string, string>,
) {
  if (!body.workspace_id) {
    return new Response(JSON.stringify({ error: "workspace_id is required" }), { status: 400, headers });
  }
  const { data, error } = await svc.from("mcp_oauth_grants")
    .update({ revoked_at: new Date().toISOString(), revoked_by: revokerUserId })
    .eq("conta_id", body.workspace_id).is("revoked_at", null).select("id");
  if (error) throw error;
  return new Response(JSON.stringify({ message: "All connections revoked", count: (data ?? []).length }), { status: 200, headers });
}

async function handleDeletePlan(
  svc: SupabaseClient,
  body: { plan_id: string },
  headers: Record<string, string>,
) {
  const { plan_id } = body;
  if (!plan_id) {
    return new Response(JSON.stringify({ error: "plan_id is required" }), { status: 400, headers });
  }

  const { count } = await svc
    .from("workspace_plan_overrides")
    .select("id", { count: "exact", head: true })
    .eq("plan_id", plan_id);

  const { count: directCount } = await svc
    .from("workspaces")
    .select("id", { count: "exact", head: true })
    .eq("plan_id", plan_id);

  const totalUsage = (count ?? 0) + (directCount ?? 0);

  if (totalUsage > 0) {
    return new Response(JSON.stringify({
      error: `Cannot delete plan: ${totalUsage} workspace(s) are assigned to it`,
    }), { status: 400, headers });
  }

  const { error } = await svc.from("plans").delete().eq("id", plan_id);
  if (error) throw error;

  return new Response(JSON.stringify({ message: "Plan deleted" }), { status: 200, headers });
}

// ─── Workspace Plan Assignment ─────────────────────────────────

async function handleSetWorkspacePlan(
  svc: SupabaseClient,
  body: { workspace_id: string; plan_id: string },
  adminId: string,
  headers: Record<string, string>,
) {
  const { workspace_id, plan_id } = body;
  if (!workspace_id || !plan_id) {
    return new Response(JSON.stringify({ error: "workspace_id and plan_id are required" }), { status: 400, headers });
  }

  const { error: wErr } = await svc
    .from("workspaces")
    .update({ plan_id, plan_source: "manual" })
    .eq("id", workspace_id);
  if (wErr) throw wErr;

  const { data: existing } = await svc
    .from("workspace_plan_overrides")
    .select("id")
    .eq("workspace_id", workspace_id)
    .maybeSingle();

  if (existing) {
    const { error } = await svc
      .from("workspace_plan_overrides")
      .update({
        resource_overrides: null,
        feature_overrides: null,
        notes: null,
        updated_by: adminId,
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", workspace_id);
    if (error) throw error;
  } else {
    const { error } = await svc
      .from("workspace_plan_overrides")
      .insert({ workspace_id, updated_by: adminId });
    if (error) throw error;
  }

  return new Response(JSON.stringify({ message: "Workspace plan updated" }), { status: 200, headers });
}

async function handleUnsetWorkspacePlan(
  svc: SupabaseClient,
  body: { workspace_id: string },
  adminId: string,
  headers: Record<string, string>,
) {
  const { workspace_id } = body;
  if (!workspace_id) {
    return new Response(JSON.stringify({ error: "workspace_id is required" }), { status: 400, headers });
  }

  const { data: sub } = await svc
    .from("workspace_subscriptions")
    .select("status, plan_id, provider, cancel_at_period_end, current_period_end")
    .eq("workspace_id", workspace_id)
    .maybeSingle();

  const { data: def } = await svc
    .from("plans")
    .select("id")
    .eq("is_default", true)
    .maybeSingle();

  const target = revertPlanTarget(
    sub as {
      status?: string;
      plan_id?: string;
      provider?: string;
      cancel_at_period_end?: boolean;
      current_period_end?: string;
    } | null,
    (def?.id as string) ?? "free",
    new Date(),
  );

  const { error: wErr } = await svc
    .from("workspaces")
    .update({ plan_id: target.plan_id, plan_source: target.plan_source })
    .eq("id", workspace_id);
  if (wErr) throw wErr;

  // clear any manual granular overrides left from the comp
  await svc
    .from("workspace_plan_overrides")
    .update({
      resource_overrides: null,
      feature_overrides: null,
      notes: null,
      updated_by: adminId,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspace_id);

  return new Response(
    JSON.stringify({ message: "Comp removed", plan_source: target.plan_source }),
    { status: 200, headers },
  );
}

async function handleSetWorkspaceOverrides(
  svc: SupabaseClient,
  body: { workspace_id: string; resource_overrides?: Record<string, number>; feature_overrides?: Record<string, boolean>; notes?: string },
  adminId: string,
  headers: Record<string, string>,
) {
  const { workspace_id, resource_overrides, feature_overrides, notes } = body;
  if (!workspace_id) {
    return new Response(JSON.stringify({ error: "workspace_id is required" }), { status: 400, headers });
  }

  const { data: existing } = await svc
    .from("workspace_plan_overrides")
    .select("id")
    .eq("workspace_id", workspace_id)
    .maybeSingle();

  if (!existing) {
    return new Response(JSON.stringify({ error: "Workspace has no plan assigned. Assign a plan first." }), { status: 400, headers });
  }

  const updatePayload: Record<string, unknown> = {
    updated_by: adminId,
    updated_at: new Date().toISOString(),
  };
  if (resource_overrides !== undefined) updatePayload.resource_overrides = resource_overrides;
  if (feature_overrides !== undefined) updatePayload.feature_overrides = feature_overrides;
  if (notes !== undefined) updatePayload.notes = notes;

  const { error } = await svc
    .from("workspace_plan_overrides")
    .update(updatePayload)
    .eq("workspace_id", workspace_id);

  if (error) throw error;

  return new Response(JSON.stringify({ message: "Overrides updated" }), { status: 200, headers });
}

async function handleClearWorkspaceOverrides(
  svc: SupabaseClient,
  body: { workspace_id: string },
  adminId: string,
  headers: Record<string, string>,
) {
  const { workspace_id } = body;
  if (!workspace_id) {
    return new Response(JSON.stringify({ error: "workspace_id is required" }), { status: 400, headers });
  }

  const { data: existing } = await svc
    .from("workspace_plan_overrides")
    .select("id")
    .eq("workspace_id", workspace_id)
    .maybeSingle();

  if (!existing) {
    return new Response(JSON.stringify({ error: "Workspace has no plan assigned." }), { status: 400, headers });
  }

  const { error } = await svc
    .from("workspace_plan_overrides")
    .update({
      resource_overrides: null,
      feature_overrides: null,
      updated_by: adminId,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspace_id);

  if (error) throw error;

  return new Response(JSON.stringify({ message: "Overrides cleared" }), { status: 200, headers });
}

// ─── MCP do Admin (conector platform-admin) ────────────────────

async function handleListAdminMcpGrants(
  svc: SupabaseClient,
  headers: Record<string, string>,
) {
  const grants = await listAdminMcpGrants(svc);
  return new Response(JSON.stringify({ grants }), { status: 200, headers });
}

async function handleRevokeAdminMcpGrant(
  svc: SupabaseClient,
  body: { grant_id?: string },
  actorUserId: string,
  headers: Record<string, string>,
) {
  const grantId = typeof body.grant_id === "string" ? body.grant_id : "";
  if (!grantId) {
    return new Response(JSON.stringify({ error: "grant_id is required" }), { status: 400, headers });
  }
  const result = await revokeAdminMcpGrant(svc, grantId, actorUserId);
  if (!result.ok) {
    return new Response(JSON.stringify({ error: "Grant not found" }), { status: 404, headers });
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

// ─── Admins ────────────────────────────────────────────────────

async function handleListAdmins(
  svc: SupabaseClient,
  headers: Record<string, string>,
) {
  const { data: admins, error } = await svc
    .from("platform_admins")
    .select("id, user_id, email, invited_by, created_at")
    .order("created_at", { ascending: true });
  if (error) throw error;

  const enriched = await Promise.all(
    (admins || []).map(async (a) => {
      let invited_by_email = null;
      if (a.invited_by) {
        const { data: inviter } = await svc
          .from("platform_admins")
          .select("email")
          .eq("id", a.invited_by)
          .single();
        invited_by_email = inviter?.email || null;
      }
      return { ...a, invited_by_email };
    })
  );

  return new Response(JSON.stringify({ admins: enriched }), { status: 200, headers });
}

async function handleInviteAdmin(
  svc: SupabaseClient,
  body: { email: string },
  adminId: string,
  headers: Record<string, string>,
) {
  const { email } = body;
  if (!email) {
    return new Response(JSON.stringify({ error: "email is required" }), { status: 400, headers });
  }

  const { data: users } = await svc.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const authUser = users?.users?.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase()
  );

  if (!authUser) {
    return new Response(JSON.stringify({
      error: "Usuário não encontrado. O usuário precisa criar uma conta primeiro.",
    }), { status: 404, headers });
  }

  const { data: existing } = await svc
    .from("platform_admins")
    .select("id")
    .eq("user_id", authUser.id)
    .maybeSingle();

  if (existing) {
    return new Response(JSON.stringify({ error: "Usuário já é administrador." }), { status: 400, headers });
  }

  const { data, error } = await svc
    .from("platform_admins")
    .insert({ user_id: authUser.id, email: authUser.email!, invited_by: adminId })
    .select()
    .single();
  if (error) throw error;

  return new Response(JSON.stringify({ admin: data }), { status: 201, headers });
}

async function handleRemoveAdmin(
  svc: SupabaseClient,
  body: { admin_id: string },
  callerAdminId: string,
  headers: Record<string, string>,
) {
  const { admin_id } = body;
  if (!admin_id) {
    return new Response(JSON.stringify({ error: "admin_id is required" }), { status: 400, headers });
  }

  if (admin_id === callerAdminId) {
    return new Response(JSON.stringify({ error: "Você não pode remover a si mesmo." }), { status: 400, headers });
  }

  const { error } = await svc.from("platform_admins").delete().eq("id", admin_id);
  if (error) throw error;

  return new Response(JSON.stringify({ message: "Admin removed" }), { status: 200, headers });
}

// ─── Banners ──────────────────────────────────────────────────

async function handleListBanners(
  svc: SupabaseClient,
  body: { status?: string },
  headers: Record<string, string>,
) {
  let query = svc
    .from("global_banners")
    .select("*")
    .order("created_at", { ascending: false });

  if (body.status) {
    query = query.eq("status", body.status);
  }

  const { data: banners, error } = await query;
  if (error) throw error;

  const enriched = await Promise.all(
    (banners || []).map(async (b) => {
      const { count } = await svc
        .from("banner_dismissals")
        .select("id", { count: "exact", head: true })
        .eq("banner_id", b.id);
      return { ...b, dismissal_count: count || 0 };
    })
  );

  return new Response(JSON.stringify({ banners: enriched }), { status: 200, headers });
}

async function handleCreateBanner(
  svc: SupabaseClient,
  body: Record<string, unknown>,
  adminId: string,
  headers: Record<string, string>,
) {
  const { action: _, ...rest } = body;

  if (!rest.type || !rest.content || !rest.target_mode) {
    return new Response(
      JSON.stringify({ error: "type, content, and target_mode are required" }),
      { status: 400, headers },
    );
  }

  const insert = normalizeBanner({ created_by: adminId, ...pickBannerColumns(rest) });
  const fieldError = validateBanner(insert);
  if (fieldError) {
    console.error("[banners] create rejected:", fieldError);
    return new Response(JSON.stringify({ error: "Invalid banner" }), { status: 400, headers });
  }

  const { data, error } = await svc
    .from("global_banners")
    .insert(insert)
    .select()
    .single();
  if (error) throw error;

  return new Response(JSON.stringify({ banner: data }), { status: 201, headers });
}

async function handleUpdateBanner(
  svc: SupabaseClient,
  body: Record<string, unknown>,
  headers: Record<string, string>,
) {
  const { action: _, banner_id, ...rest } = body;

  if (!banner_id) {
    return new Response(
      JSON.stringify({ error: "banner_id is required" }),
      { status: 400, headers },
    );
  }

  const update = normalizeBanner(pickBannerColumns(rest));
  if (Object.keys(update).length === 0) {
    return new Response(JSON.stringify({ error: "No fields to update" }), { status: 400, headers });
  }
  const { data: current, error: readErr } = await svc
    .from("global_banners").select("*").eq("id", banner_id).maybeSingle();
  if (readErr) throw readErr;
  if (!current) return new Response(JSON.stringify({ error: "Banner not found" }), { status: 404, headers });
  // Linhas antigas nunca passaram por este validador: normalizar a atual antes de mesclar
  // (link/custom_color "" → null), senão um banner legado fica impossível de editar.
  const merged = { ...normalizeBanner(current as Record<string, unknown>), ...update };
  const fieldError = validateBanner(merged);
  if (fieldError) {
    console.error("[banners] update rejected:", fieldError);
    return new Response(JSON.stringify({ error: "Invalid banner" }), { status: 400, headers });
  }

  const { data, error } = await svc
    .from("global_banners")
    .update(update)
    .eq("id", banner_id)
    .select()
    .single();
  if (error) throw error;

  return new Response(JSON.stringify({ banner: data }), { status: 200, headers });
}

async function handleDeleteBanner(
  svc: SupabaseClient,
  body: { banner_id?: string },
  headers: Record<string, string>,
) {
  const { banner_id } = body;

  if (!banner_id) {
    return new Response(
      JSON.stringify({ error: "banner_id is required" }),
      { status: 400, headers },
    );
  }

  const { data: banner } = await svc
    .from("global_banners")
    .select("status")
    .eq("id", banner_id)
    .single();

  if (banner && banner.status !== "draft") {
    return new Response(
      JSON.stringify({ error: "Only draft banners can be deleted" }),
      { status: 400, headers },
    );
  }

  const { error } = await svc
    .from("global_banners")
    .delete()
    .eq("id", banner_id);
  if (error) throw error;

  return new Response(JSON.stringify({ message: "Banner deleted" }), { status: 200, headers });
}

// ─── Knowledge Base ──────────────────────────────────────────

async function handleListKbArticles(
  svc: SupabaseClient,
  body: { category?: string; status?: string },
  headers: Record<string, string>,
) {
  let query = svc
    .from("kb_articles")
    .select("*")
    .order("display_order", { ascending: true });

  if (body.category) {
    query = query.eq("category", body.category);
  }
  if (body.status) {
    query = query.eq("status", body.status);
  }

  const { data: articles, error } = await query;
  if (error) throw error;

  return new Response(JSON.stringify({ articles: articles || [] }), { status: 200, headers });
}

async function handleGetKbArticle(
  svc: SupabaseClient,
  body: { article_id?: string },
  headers: Record<string, string>,
) {
  if (!body.article_id) {
    return new Response(JSON.stringify({ error: "article_id required" }), { status: 400, headers });
  }
  const { data: article, error } = await svc
    .from("kb_articles")
    .select("*")
    .eq("id", body.article_id)
    .single();
  if (error) throw error;
  return new Response(JSON.stringify({ article }), { status: 200, headers });
}

async function handleCreateKbArticle(
  svc: SupabaseClient,
  body: Record<string, unknown>,
  actor: { adminId: string; userId: string },
  headers: Record<string, string>,
) {
  const { action: _, ...rest } = body;

  if (!rest.title || !rest.slug || !rest.category) {
    return new Response(
      JSON.stringify({ error: "title, slug, and category are required" }),
      { status: 400, headers },
    );
  }

  const insert = normalizeKb({ author_id: actor.adminId, ...pickKbColumns(rest) });

  // Uma chave R2 nova só pode virar capa (ou aparecer num inlineImage do corpo, via bloco
  // opaco) se pertencer ao workspace do admin chamador -- senão qualquer kb:write publicaria
  // (e sign-r2-urls assinaria) um arquivo privado de outro workspace para todo mundo que ler
  // o artigo. Artigo novo: nenhuma chave persistida ainda.
  const persistedR2Keys = new Set<string>();
  let contaId: string | undefined;
  const needsOwnership = coverNeedsOwnership(insert.cover_image_url, null) ||
    (insert.content !== undefined && contentNeedsOwnership(insert.content, persistedR2Keys));
  if (needsOwnership) {
    const found = await adminContaId(svc, actor.userId);
    if (found === null) {
      return new Response(JSON.stringify({ error: "cover_image_url R2 key belongs to another workspace" }), { status: 400, headers });
    }
    contaId = found;
  }

  const fieldError = validateKbArticle(insert, { allowedContaId: contaId, persistedR2Keys });
  if (fieldError) return new Response(JSON.stringify({ error: fieldError }), { status: 400, headers });

  const { data, error } = await svc.from("kb_articles").insert(insert).select().single();
  if (error) {
    if (isUniqueViolation(error)) return new Response(JSON.stringify({ error: "slug already in use" }), { status: 409, headers });
    throw error;
  }

  return new Response(JSON.stringify({ article: data }), { status: 201, headers });
}

async function handleUpdateKbArticle(
  svc: SupabaseClient,
  body: Record<string, unknown>,
  actor: { userId: string },
  headers: Record<string, string>,
) {
  const { action: _, article_id, ...rest } = body;

  if (!article_id) {
    return new Response(
      JSON.stringify({ error: "article_id is required" }),
      { status: 400, headers },
    );
  }

  const update = normalizeKb(pickKbColumns(rest));
  if (Object.keys(update).length === 0) {
    return new Response(JSON.stringify({ error: "No fields to update" }), { status: 400, headers });
  }
  // A regra "content e content_plain juntos" precisa valer no PATCH: na linha mesclada os
  // dois sempre existem (vêm do select *), então lá ela nunca dispara.
  if ((update.content !== undefined) !== (update.content_plain !== undefined)) {
    return new Response(JSON.stringify({ error: "content and content_plain go together" }), { status: 400, headers });
  }
  const { data: current, error: readErr } = await svc
    .from("kb_articles").select("*").eq("id", article_id).maybeSingle();
  if (readErr) throw readErr;
  if (!current) return new Response(JSON.stringify({ error: "Article not found" }), { status: 404, headers });

  const persistedCover = ((current as Record<string, unknown>).cover_image_url as string | null | undefined) ?? null;
  const persistedR2Keys = collectR2Keys((current as Record<string, unknown>).content);
  let contaId: string | undefined;
  const needsOwnership = coverNeedsOwnership(update.cover_image_url, persistedCover) ||
    (update.content !== undefined && contentNeedsOwnership(update.content, persistedR2Keys));
  if (needsOwnership) {
    const found = await adminContaId(svc, actor.userId);
    if (found === null) {
      return new Response(JSON.stringify({ error: "cover_image_url R2 key belongs to another workspace" }), { status: 400, headers });
    }
    contaId = found;
  }

  // Linha atual normalizada antes de mesclar (cover_image_url/excerpt "" legados → null).
  const fieldError = validateKbArticle(
    { ...normalizeKb(current as Record<string, unknown>), ...update },
    { allowedContaId: contaId, persistedCover, persistedR2Keys },
  );
  if (fieldError) return new Response(JSON.stringify({ error: fieldError }), { status: 400, headers });

  const { data, error } = await svc.from("kb_articles").update(update).eq("id", article_id).select().single();
  if (error) {
    if (isUniqueViolation(error)) return new Response(JSON.stringify({ error: "slug already in use" }), { status: 409, headers });
    throw error;
  }

  return new Response(JSON.stringify({ article: data }), { status: 200, headers });
}

async function handleDeleteKbArticle(
  svc: SupabaseClient,
  body: { article_id?: string },
  headers: Record<string, string>,
) {
  const { article_id } = body;

  if (!article_id) {
    return new Response(
      JSON.stringify({ error: "article_id is required" }),
      { status: 400, headers },
    );
  }

  const { error } = await svc
    .from("kb_articles")
    .delete()
    .eq("id", article_id);
  if (error) throw error;

  return new Response(JSON.stringify({ message: "Article deleted" }), { status: 200, headers });
}

async function handleListKbContextLinks(
  svc: SupabaseClient,
  body: { article_id?: string },
  headers: Record<string, string>,
) {
  if (!body.article_id) {
    return new Response(JSON.stringify({ error: "article_id required" }), { status: 400, headers });
  }
  const { data: links, error } = await svc
    .from("kb_context_links")
    .select("*")
    .eq("article_id", body.article_id)
    .order("display_order");
  if (error) throw error;
  return new Response(JSON.stringify({ links: links || [] }), { status: 200, headers });
}

async function handleUpsertKbContextLink(
  svc: SupabaseClient,
  body: Record<string, unknown>,
  headers: Record<string, string>,
) {
  const { action: _, route_pattern, article_id, label, display_order } = body as {
    action: string;
    route_pattern?: string;
    article_id?: string;
    label?: string;
    display_order?: number;
  };

  if (!route_pattern || !article_id) {
    return new Response(
      JSON.stringify({ error: "route_pattern and article_id are required" }),
      { status: 400, headers },
    );
  }

  const { data: existing } = await svc
    .from("kb_context_links")
    .select("id")
    .eq("route_pattern", route_pattern)
    .eq("article_id", article_id)
    .maybeSingle();

  if (existing) {
    const update: Record<string, unknown> = {};
    if (label !== undefined) update.label = label;
    if (display_order !== undefined) update.display_order = display_order;

    if (Object.keys(update).length > 0) {
      await svc.from("kb_context_links").update(update).eq("id", existing.id);
    }

    return new Response(JSON.stringify({ link_id: existing.id }), { status: 200, headers });
  }

  const { data, error } = await svc
    .from("kb_context_links")
    .insert({
      route_pattern,
      article_id,
      label: label ?? null,
      display_order: display_order ?? 0,
    })
    .select("id")
    .single();
  if (error) throw error;

  return new Response(JSON.stringify({ link_id: data.id }), { status: 201, headers });
}

async function handleDeleteKbContextLink(
  svc: SupabaseClient,
  body: { link_id?: string },
  headers: Record<string, string>,
) {
  const { link_id } = body;

  if (!link_id) {
    return new Response(
      JSON.stringify({ error: "link_id is required" }),
      { status: 400, headers },
    );
  }

  const { error } = await svc
    .from("kb_context_links")
    .delete()
    .eq("id", link_id);
  if (error) throw error;

  return new Response(JSON.stringify({ message: "Context link deleted" }), { status: 200, headers });
}

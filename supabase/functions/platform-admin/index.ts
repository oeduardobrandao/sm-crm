import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const RESOURCE_COLUMNS = [
  "max_clients", "max_team_members", "max_workflow_templates",
  "max_active_workflows_per_client", "max_instagram_accounts", "max_leads",
  "max_hub_tokens", "storage_quota_bytes", "max_custom_properties_per_template",
  "max_posts_per_workflow", "max_workspaces_per_user",
] as const;

const FEATURE_COLUMNS = [
  "feature_instagram", "feature_instagram_ai", "feature_analytics_reports",
  "feature_best_times", "feature_audience_demographics", "feature_hub_portal",
  "feature_leads", "feature_financial", "feature_contracts", "feature_ideas",
  "feature_workflow_gantt", "feature_workflow_recurrence", "feature_csv_import",
  "feature_custom_properties", "feature_post_scheduling", "feature_auto_sync_cron",
  "feature_post_tagging", "feature_brand_customization",
] as const;

const RATE_COLUMNS = [
  "rate_instagram_syncs_per_day", "rate_ai_analyses_per_month",
  "rate_report_generations_per_month",
] as const;

type PlanRow = Record<string, unknown>;

function extractLimits(plan: PlanRow): Record<string, number | null> {
  const limits: Record<string, number | null> = {};
  for (const col of [...RESOURCE_COLUMNS, ...RATE_COLUMNS]) {
    limits[col] = (plan[col] as number | null) ?? null;
  }
  return limits;
}

function extractFeatures(plan: PlanRow): Record<string, boolean> {
  const features: Record<string, boolean> = {};
  for (const col of FEATURE_COLUMNS) {
    features[col] = (plan[col] as boolean) ?? false;
  }
  return features;
}

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
      case "get-workspace":
        return await handleGetWorkspace(svc, body, headers);
      case "list-plans":
        return await handleListPlans(svc, headers);
      case "create-plan":
        return await handleCreatePlan(svc, body, headers);
      case "update-plan":
        return await handleUpdatePlan(svc, body, headers);
      case "delete-plan":
        return await handleDeletePlan(svc, body, headers);
      case "set-workspace-plan":
        return await handleSetWorkspacePlan(svc, body, admin.id, headers);
      case "set-workspace-overrides":
        return await handleSetWorkspaceOverrides(svc, body, admin.id, headers);
      case "clear-workspace-overrides":
        return await handleClearWorkspaceOverrides(svc, body, admin.id, headers);
      case "list-admins":
        return await handleListAdmins(svc, headers);
      case "invite-admin":
        return await handleInviteAdmin(svc, body, admin.id, headers);
      case "remove-admin":
        return await handleRemoveAdmin(svc, body, admin.id, headers);
      default:
        return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers });
    }
  } catch (err) {
    console.error("[platform-admin] error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
});

// ─── Workspaces ────────────────────────────────────────────────

async function handleListWorkspaces(
  svc: ReturnType<typeof createClient>,
  body: { search?: string; plan_id?: string; offset?: number; limit?: number },
  headers: Record<string, string>,
) {
  const { search, plan_id, offset = 0, limit = 20 } = body;

  let query = svc
    .from("workspaces")
    .select("id, name, logo_url, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (search) {
    query = query.ilike("name", `%${search}%`);
  }

  const { data: workspaces, count, error } = await query;
  if (error) throw error;

  const enriched = await Promise.all(
    (workspaces || []).map(async (ws) => {
      const { data: ownerMember } = await svc
        .from("workspace_members")
        .select("user_id")
        .eq("workspace_id", ws.id)
        .eq("role", "owner")
        .limit(1)
        .maybeSingle();

      let owner = null;
      if (ownerMember) {
        const { data: ownerProfile } = await svc
          .from("profiles")
          .select("nome, id")
          .eq("id", ownerMember.user_id)
          .single();

        const { data: ownerUser } = await svc.auth.admin.getUserById(ownerMember.user_id);
        owner = {
          name: ownerProfile?.nome || "Unknown",
          email: ownerUser?.user?.email || "Unknown",
        };
      }

      const { count: memberCount } = await svc
        .from("workspace_members")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", ws.id);

      const { count: clientCount } = await svc
        .from("clientes")
        .select("id", { count: "exact", head: true })
        .eq("conta_id", ws.id);

      const { data: planOverride } = await svc
        .from("workspace_plan_overrides")
        .select("plan_id, resource_overrides, feature_overrides")
        .eq("workspace_id", ws.id)
        .maybeSingle();

      let planName = null;
      let hasOverrides = false;
      if (planOverride) {
        const { data: plan } = await svc.from("plans").select("name").eq("id", planOverride.plan_id).single();
        planName = plan?.name || null;
        hasOverrides = !!(planOverride.resource_overrides || planOverride.feature_overrides);
      } else {
        const { data: defaultPlan } = await svc.from("plans").select("name").eq("is_default", true).maybeSingle();
        planName = defaultPlan?.name || null;
      }

      return {
        id: ws.id,
        name: ws.name,
        logo_url: ws.logo_url,
        created_at: ws.created_at,
        owner,
        member_count: memberCount || 0,
        client_count: clientCount || 0,
        plan_name: planName,
        has_overrides: hasOverrides,
      };
    })
  );

  let result = enriched;
  if (plan_id) {
    const { data: plan } = await svc.from("plans").select("name").eq("id", plan_id).single();
    if (plan) {
      result = enriched.filter((ws) => ws.plan_name === plan.name);
    }
  }

  return new Response(JSON.stringify({ workspaces: result, total: count }), { status: 200, headers });
}

async function handleGetWorkspace(
  svc: ReturnType<typeof createClient>,
  body: { workspace_id: string },
  headers: Record<string, string>,
) {
  const { workspace_id } = body;
  if (!workspace_id) {
    return new Response(JSON.stringify({ error: "workspace_id is required" }), { status: 400, headers });
  }

  const { data: ws, error } = await svc
    .from("workspaces")
    .select("id, name, logo_url, created_at")
    .eq("id", workspace_id)
    .single();
  if (error || !ws) {
    return new Response(JSON.stringify({ error: "Workspace not found" }), { status: 404, headers });
  }

  const { data: members } = await svc
    .from("workspace_members")
    .select("user_id, role, joined_at")
    .eq("workspace_id", workspace_id);

  const enrichedMembers = await Promise.all(
    (members || []).map(async (m) => {
      const { data: profile } = await svc.from("profiles").select("nome").eq("id", m.user_id).single();
      const { data: authUser } = await svc.auth.admin.getUserById(m.user_id);
      return {
        user_id: m.user_id,
        name: profile?.nome || "Unknown",
        email: authUser?.user?.email || "Unknown",
        role: m.role,
        joined_at: m.joined_at,
      };
    })
  );

  const owner = enrichedMembers.find((m) => m.role === "owner") || null;

  const { count: clientCount } = await svc
    .from("clientes")
    .select("id", { count: "exact", head: true })
    .eq("conta_id", workspace_id);

  const { count: integrationCount } = await svc
    .from("integracoes_status")
    .select("id", { count: "exact", head: true })
    .eq("conta_id", workspace_id);

  const { data: override } = await svc
    .from("workspace_plan_overrides")
    .select("plan_id, resource_overrides, feature_overrides, notes")
    .eq("workspace_id", workspace_id)
    .maybeSingle();

  let plan = null;
  let resolvedLimits: Record<string, number | null> | null = null;
  let resolvedFeatures: Record<string, boolean> | null = null;

  if (override) {
    const { data: planData } = await svc.from("plans").select("*").eq("id", override.plan_id).single();
    if (planData) {
      plan = planData;
      resolvedLimits = { ...extractLimits(planData), ...(override.resource_overrides || {}) };
      resolvedFeatures = { ...extractFeatures(planData), ...(override.feature_overrides || {}) };
    }
  } else {
    const { data: defaultPlan } = await svc.from("plans").select("*").eq("is_default", true).maybeSingle();
    if (defaultPlan) {
      plan = defaultPlan;
      resolvedLimits = extractLimits(defaultPlan);
      resolvedFeatures = extractFeatures(defaultPlan);
    }
  }

  return new Response(JSON.stringify({
    workspace: ws,
    owner,
    members: enrichedMembers,
    plan: plan ? { id: plan.id, name: plan.name } : null,
    override: override ? {
      resource_overrides: override.resource_overrides,
      feature_overrides: override.feature_overrides,
      notes: override.notes,
    } : null,
    resolved_limits: resolvedLimits,
    resolved_features: resolvedFeatures,
    usage: {
      client_count: clientCount || 0,
      member_count: enrichedMembers.length,
      integration_count: integrationCount || 0,
    },
  }), { status: 200, headers });
}

// ─── Plans ─────────────────────────────────────────────────────

async function handleListPlans(
  svc: ReturnType<typeof createClient>,
  headers: Record<string, string>,
) {
  const { data: plans, error } = await svc
    .from("plans")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) throw error;

  const enriched = await Promise.all(
    (plans || []).map(async (plan) => {
      const { count } = await svc
        .from("workspace_plan_overrides")
        .select("id", { count: "exact", head: true })
        .eq("plan_id", plan.id);
      return { ...plan, workspace_count: count || 0 };
    })
  );

  return new Response(JSON.stringify({ plans: enriched }), { status: 200, headers });
}

async function handleCreatePlan(
  svc: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
  headers: Record<string, string>,
) {
  const { name, is_default, action: _, ...rest } = body;
  if (!name) {
    return new Response(JSON.stringify({ error: "name is required" }), { status: 400, headers });
  }

  if (is_default) {
    await svc.from("plans").update({ is_default: false }).eq("is_default", true);
  }

  const insert: Record<string, unknown> = { name, is_default: is_default || false };
  const allColumns = [...RESOURCE_COLUMNS, ...FEATURE_COLUMNS, ...RATE_COLUMNS];
  for (const col of allColumns) {
    if (rest[col] !== undefined) insert[col] = rest[col];
  }
  if (rest.price_brl !== undefined) insert.price_brl = rest.price_brl;
  if (rest.price_brl_annual !== undefined) insert.price_brl_annual = rest.price_brl_annual;
  if (rest.sort_order !== undefined) insert.sort_order = rest.sort_order;
  if (rest.is_active !== undefined) insert.is_active = rest.is_active;

  const { data, error } = await svc
    .from("plans")
    .insert(insert)
    .select()
    .single();
  if (error) throw error;

  return new Response(JSON.stringify({ plan: data }), { status: 201, headers });
}

async function handleUpdatePlan(
  svc: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
  headers: Record<string, string>,
) {
  const { plan_id, action: _, ...rest } = body;
  if (!plan_id) {
    return new Response(JSON.stringify({ error: "plan_id is required" }), { status: 400, headers });
  }

  if (rest.is_default) {
    await svc.from("plans").update({ is_default: false }).eq("is_default", true);
  }

  const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };

  const allowedScalar = ["name", "is_default", "price_brl", "price_brl_annual", "sort_order", "is_active"];
  for (const key of allowedScalar) {
    if (rest[key] !== undefined) updatePayload[key] = rest[key];
  }

  const allColumns = [...RESOURCE_COLUMNS, ...FEATURE_COLUMNS, ...RATE_COLUMNS];
  for (const col of allColumns) {
    if (rest[col] !== undefined) updatePayload[col] = rest[col];
  }

  const { data, error } = await svc
    .from("plans")
    .update(updatePayload)
    .eq("id", plan_id)
    .select()
    .single();
  if (error) throw error;

  return new Response(JSON.stringify({ plan: data }), { status: 200, headers });
}

async function handleDeletePlan(
  svc: ReturnType<typeof createClient>,
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

  if (count && count > 0) {
    return new Response(JSON.stringify({
      error: `Cannot delete plan: ${count} workspace(s) are assigned to it`,
    }), { status: 400, headers });
  }

  const { error } = await svc.from("plans").delete().eq("id", plan_id);
  if (error) throw error;

  return new Response(JSON.stringify({ message: "Plan deleted" }), { status: 200, headers });
}

// ─── Workspace Plan Assignment ─────────────────────────────────

async function handleSetWorkspacePlan(
  svc: ReturnType<typeof createClient>,
  body: { workspace_id: string; plan_id: string },
  adminId: string,
  headers: Record<string, string>,
) {
  const { workspace_id, plan_id } = body;
  if (!workspace_id || !plan_id) {
    return new Response(JSON.stringify({ error: "workspace_id and plan_id are required" }), { status: 400, headers });
  }

  const { data: existing } = await svc
    .from("workspace_plan_overrides")
    .select("id")
    .eq("workspace_id", workspace_id)
    .maybeSingle();

  if (existing) {
    const { error } = await svc
      .from("workspace_plan_overrides")
      .update({
        plan_id,
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
      .insert({ workspace_id, plan_id, updated_by: adminId });
    if (error) throw error;
  }

  return new Response(JSON.stringify({ message: "Workspace plan updated" }), { status: 200, headers });
}

async function handleSetWorkspaceOverrides(
  svc: ReturnType<typeof createClient>,
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
  svc: ReturnType<typeof createClient>,
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

// ─── Admins ────────────────────────────────────────────────────

async function handleListAdmins(
  svc: ReturnType<typeof createClient>,
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
  svc: ReturnType<typeof createClient>,
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
  svc: ReturnType<typeof createClient>,
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

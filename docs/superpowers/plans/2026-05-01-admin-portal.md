# Admin Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a separate admin app (`apps/admin/`) in the monorepo for platform-level workspace oversight, plan/limit management, and feature gating.

**Architecture:** New Vite+React app mirroring the Hub app pattern (`/admin/*` path, Vercel rewrite). Two new Deno edge functions (`platform-admin` for admin actions, `workspace-limits` for CRM reads). Three new Postgres tables (`platform_admins`, `plans`, `workspace_plan_overrides`) with no RLS — access only via service-role key. CRM enforces limits via a `useWorkspaceLimits()` TanStack Query hook.

**Tech Stack:** React 19, React Router v7, TanStack Query, shadcn/ui, Tailwind CSS 3, Supabase (Postgres + Edge Functions + Auth), Deno runtime for edge functions.

**Design spec:** `docs/superpowers/specs/2026-04-30-admin-portal-design.md`

---

## File Map

### New files — Database

| File | Responsibility |
|------|---------------|
| `supabase/migrations/20260501000001_platform_admin_tables.sql` | Creates `platform_admins`, `plans`, `workspace_plan_overrides` tables |

### New files — Edge Functions

| File | Responsibility |
|------|---------------|
| `supabase/functions/platform-admin/index.ts` | Admin-only edge function with action-based routing (13 actions) |
| `supabase/functions/workspace-limits/index.ts` | CRM-facing read-only edge function returning resolved workspace limits |

### New files — Admin App Scaffold

| File | Responsibility |
|------|---------------|
| `apps/admin/index.html` | HTML entry point |
| `apps/admin/vite.config.ts` | Vite config — base `/admin/`, output to `../../dist/admin` |
| `apps/admin/tsconfig.json` | TypeScript config |
| `apps/admin/src/main.tsx` | React bootstrap |
| `apps/admin/src/globals.css` | Tailwind directives + shadcn CSS variables |
| `apps/admin/src/lib/utils.ts` | shadcn `cn()` utility |

### New files — Admin App Core

| File | Responsibility |
|------|---------------|
| `apps/admin/src/lib/supabase.ts` | Supabase client singleton |
| `apps/admin/src/lib/api.ts` | Typed wrapper for `platform-admin` edge function calls |
| `apps/admin/src/context/AdminAuthContext.tsx` | Auth provider with `platform_admins` verification |
| `apps/admin/src/router.tsx` | `createBrowserRouter` with all admin routes |
| `apps/admin/src/layouts/AdminProtectedRoute.tsx` | Route guard checking auth + admin status |
| `apps/admin/src/layouts/AdminLayout.tsx` | Sidebar + content shell |

### New files — Admin App Pages

| File | Responsibility |
|------|---------------|
| `apps/admin/src/pages/LoginPage.tsx` | Admin login page |
| `apps/admin/src/pages/DashboardPage.tsx` | KPI cards + recent workspaces table |
| `apps/admin/src/pages/WorkspacesPage.tsx` | Searchable/filterable workspace list |
| `apps/admin/src/pages/WorkspaceDetailPage.tsx` | Single workspace deep-dive with limit overrides |
| `apps/admin/src/pages/PlansPage.tsx` | Plan template CRUD (card grid + modal form) |
| `apps/admin/src/pages/AdminsPage.tsx` | Platform admin management |

### New files — CRM Enforcement

| File | Responsibility |
|------|---------------|
| `apps/crm/src/hooks/useWorkspaceLimits.ts` | TanStack Query hook calling `workspace-limits` edge function |

### Modified files

| File | Change |
|------|--------|
| `package.json` | Add `dev:admin` and `build:admin` scripts |
| `vercel.json` | Add `/admin/*` rewrite, update `buildCommand` |
| `tailwind.config.js` | Add `apps/admin/` to content paths |
| `supabase/config.toml` | Add `[functions.platform-admin]` and `[functions.workspace-limits]` with `verify_jwt = false` |
| `apps/crm/src/components/layout/ProtectedRoute.tsx` | Add feature flag gating via `useWorkspaceLimits()` |

### CORS note

The `_shared/cors.ts` defaults to ports 5173, 5174, 5175. During admin app development on port 5177, add `http://localhost:5177` to the `ALLOWED_ORIGINS` env var in your Supabase local dev environment, or the default in `cors.ts`.

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260501000001_platform_admin_tables.sql`

- [ ] **Step 1: Write the migration SQL**

Create the file `supabase/migrations/20260501000001_platform_admin_tables.sql`:

```sql
-- Platform admins: users who can access the admin portal
create table platform_admins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null,
  invited_by uuid references platform_admins(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Plan templates defining default resource limits and feature flags
create table plans (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  resource_limits jsonb not null default '{}'::jsonb,
  feature_flags jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Per-workspace plan assignment and overrides
create table workspace_plan_overrides (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references workspaces(id) on delete cascade,
  plan_id uuid not null references plans(id) on delete restrict,
  resource_overrides jsonb,
  feature_overrides jsonb,
  notes text,
  updated_by uuid references platform_admins(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Ensure only one default plan at a time
create unique index plans_single_default on plans (is_default) where is_default = true;
```

- [ ] **Step 2: Push migration to staging**

Run: `npx supabase db push --linked`

Expected: Migration applies successfully. Tables `platform_admins`, `plans`, and `workspace_plan_overrides` are created.

- [ ] **Step 3: Seed yourself as the first platform admin**

Using the Supabase SQL editor or `psql`, run (replacing the UUID with your actual `auth.users.id`):

```sql
insert into platform_admins (user_id, email)
select id, email from auth.users where email = 'eduardob.fsa@gmail.com';
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260501000001_platform_admin_tables.sql
git commit -m "feat(admin): add platform_admins, plans, workspace_plan_overrides tables"
```

---

## Task 2: Platform-Admin Edge Function — Auth + Core Actions

**Files:**
- Create: `supabase/functions/platform-admin/index.ts`
- Modify: `supabase/config.toml`

- [ ] **Step 1: Create the edge function file**

Create `supabase/functions/platform-admin/index.ts`:

```ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";

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

    // verify-admin does not require admin membership (it's the check itself)
    if (action === "verify-admin") {
      return new Response(JSON.stringify({ is_admin: !!admin }), { status: 200, headers });
    }

    // All other actions require admin membership
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

  // Get all workspaces with owner info
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

  // Enrich each workspace with owner, member count, client count, plan info
  const enriched = await Promise.all(
    (workspaces || []).map(async (ws) => {
      // Owner = workspace_members with role 'owner'
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

      // Member count
      const { count: memberCount } = await svc
        .from("workspace_members")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", ws.id);

      // Client count
      const { count: clientCount } = await svc
        .from("clientes")
        .select("id", { count: "exact", head: true })
        .eq("conta_id", ws.id);

      // Plan info
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

  // Filter by plan_id client-side if requested (simpler than joining)
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

  // Members with profiles
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

  // Owner
  const owner = enrichedMembers.find((m) => m.role === "owner") || null;

  // Usage stats
  const { count: clientCount } = await svc
    .from("clientes")
    .select("id", { count: "exact", head: true })
    .eq("conta_id", workspace_id);

  const { count: integrationCount } = await svc
    .from("integracoes_status")
    .select("id", { count: "exact", head: true })
    .eq("conta_id", workspace_id);

  // Plan + resolved limits
  const { data: override } = await svc
    .from("workspace_plan_overrides")
    .select("plan_id, resource_overrides, feature_overrides, notes")
    .eq("workspace_id", workspace_id)
    .maybeSingle();

  let plan = null;
  let resolvedLimits = null;
  let resolvedFeatures = null;

  if (override) {
    const { data: planData } = await svc.from("plans").select("*").eq("id", override.plan_id).single();
    if (planData) {
      plan = planData;
      resolvedLimits = { ...planData.resource_limits, ...(override.resource_overrides || {}) };
      resolvedFeatures = { ...planData.feature_flags, ...(override.feature_overrides || {}) };
    }
  } else {
    const { data: defaultPlan } = await svc.from("plans").select("*").eq("is_default", true).maybeSingle();
    if (defaultPlan) {
      plan = defaultPlan;
      resolvedLimits = defaultPlan.resource_limits;
      resolvedFeatures = defaultPlan.feature_flags;
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
    .order("created_at", { ascending: true });
  if (error) throw error;

  // Count workspaces per plan
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
  body: { name: string; resource_limits: Record<string, number>; feature_flags: Record<string, boolean>; is_default?: boolean },
  headers: Record<string, string>,
) {
  const { name, resource_limits, feature_flags, is_default } = body;
  if (!name || !resource_limits || !feature_flags) {
    return new Response(JSON.stringify({ error: "name, resource_limits, and feature_flags are required" }), { status: 400, headers });
  }

  // If setting as default, unset the current default first
  if (is_default) {
    await svc.from("plans").update({ is_default: false }).eq("is_default", true);
  }

  const { data, error } = await svc
    .from("plans")
    .insert({ name, resource_limits, feature_flags, is_default: is_default || false })
    .select()
    .single();
  if (error) throw error;

  return new Response(JSON.stringify({ plan: data }), { status: 201, headers });
}

async function handleUpdatePlan(
  svc: ReturnType<typeof createClient>,
  body: { plan_id: string; name?: string; resource_limits?: Record<string, number>; feature_flags?: Record<string, boolean>; is_default?: boolean },
  headers: Record<string, string>,
) {
  const { plan_id, ...updates } = body;
  if (!plan_id) {
    return new Response(JSON.stringify({ error: "plan_id is required" }), { status: 400, headers });
  }

  if (updates.is_default) {
    await svc.from("plans").update({ is_default: false }).eq("is_default", true);
  }

  const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (updates.name !== undefined) updatePayload.name = updates.name;
  if (updates.resource_limits !== undefined) updatePayload.resource_limits = updates.resource_limits;
  if (updates.feature_flags !== undefined) updatePayload.feature_flags = updates.feature_flags;
  if (updates.is_default !== undefined) updatePayload.is_default = updates.is_default;

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

  // Resolve invited_by names
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

  // Check if user exists in auth
  const { data: users } = await svc.auth.admin.listUsers();
  const authUser = users?.users?.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase()
  );

  if (!authUser) {
    return new Response(JSON.stringify({
      error: "Usuário não encontrado. O usuário precisa criar uma conta primeiro.",
    }), { status: 404, headers });
  }

  // Check if already an admin
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
```

- [ ] **Step 2: Add to supabase config**

Append to the end of `supabase/config.toml`:

```toml
[functions.platform-admin]
verify_jwt = false

[functions.workspace-limits]
verify_jwt = false
```

- [ ] **Step 3: Verify the function compiles**

Run: `npx supabase functions serve platform-admin --no-verify-jwt`

Expected: Function starts without compilation errors. Press Ctrl+C to stop.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/platform-admin/index.ts supabase/config.toml
git commit -m "feat(admin): add platform-admin edge function with 13 actions"
```

---

## Task 3: Workspace-Limits Edge Function

**Files:**
- Create: `supabase/functions/workspace-limits/index.ts`

- [ ] **Step 1: Create the edge function**

Create `supabase/functions/workspace-limits/index.ts`:

```ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";

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

    // Get user's active workspace
    const { data: profile } = await svc
      .from("profiles")
      .select("conta_id")
      .eq("id", user.id)
      .single();

    if (!profile?.conta_id) {
      return new Response(JSON.stringify({
        plan_name: null,
        limits: null,
        features: null,
      }), { status: 200, headers });
    }

    const workspaceId = profile.conta_id;

    // Check for workspace-specific plan assignment
    const { data: override } = await svc
      .from("workspace_plan_overrides")
      .select("plan_id, resource_overrides, feature_overrides")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    let plan = null;

    if (override) {
      const { data: planData } = await svc
        .from("plans")
        .select("name, resource_limits, feature_flags")
        .eq("id", override.plan_id)
        .single();
      plan = planData;
    } else {
      // Fallback to default plan
      const { data: defaultPlan } = await svc
        .from("plans")
        .select("name, resource_limits, feature_flags")
        .eq("is_default", true)
        .maybeSingle();
      plan = defaultPlan;
    }

    if (!plan) {
      return new Response(JSON.stringify({
        plan_name: null,
        limits: null,
        features: null,
      }), { status: 200, headers });
    }

    const resolvedLimits = { ...plan.resource_limits, ...(override?.resource_overrides || {}) };
    const resolvedFeatures = { ...plan.feature_flags, ...(override?.feature_overrides || {}) };

    return new Response(JSON.stringify({
      plan_name: plan.name,
      limits: resolvedLimits,
      features: resolvedFeatures,
    }), { status: 200, headers });
  } catch (err) {
    console.error("[workspace-limits] error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
});
```

- [ ] **Step 2: Verify the function compiles**

Run: `npx supabase functions serve workspace-limits --no-verify-jwt`

Expected: Function starts without compilation errors. Press Ctrl+C to stop.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/workspace-limits/index.ts
git commit -m "feat(admin): add workspace-limits edge function for CRM limit resolution"
```

---

## Task 4: Admin App Scaffold — Vite, TypeScript, Tailwind, Build Config

**Files:**
- Create: `apps/admin/index.html`
- Create: `apps/admin/vite.config.ts`
- Create: `apps/admin/tsconfig.json`
- Create: `apps/admin/src/main.tsx`
- Create: `apps/admin/src/globals.css`
- Create: `apps/admin/src/lib/utils.ts`
- Modify: `package.json` (root)
- Modify: `vercel.json`
- Modify: `tailwind.config.js`

- [ ] **Step 1: Create `apps/admin/index.html`**

```html
<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Mesaas Admin</title>
    <link rel="icon" type="image/png" href="/mesaas-icon-192.png" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@300;400;500;600;700&family=Playfair+Display:wght@700;900&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Create `apps/admin/vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ command }) => ({
  root: path.resolve(__dirname, '.'),
  envDir: path.resolve(__dirname, '../..'),
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  base: command === 'serve' ? '/' : '/admin/',
  build: {
    outDir: '../../dist/admin',
  },
}));
```

- [ ] **Step 3: Create `apps/admin/tsconfig.json`**

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    },
    "target": "ES2020",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "jsx": "react-jsx",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "resolveJsonModule": true,
    "strict": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"],
  "exclude": [
    "src/**/__tests__/**",
    "src/**/*.test.ts",
    "src/**/*.test.tsx"
  ]
}
```

- [ ] **Step 4: Create `apps/admin/src/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --background: 220 14% 4%;
  --foreground: 220 14% 92%;
  --card: 220 14% 7%;
  --card-foreground: 220 14% 92%;
  --popover: 220 14% 7%;
  --popover-foreground: 220 14% 92%;
  --primary: 48 96% 53%;
  --primary-foreground: 220 14% 7%;
  --secondary: 220 14% 12%;
  --secondary-foreground: 220 14% 92%;
  --muted: 220 14% 12%;
  --muted-foreground: 220 10% 60%;
  --accent: 220 14% 14%;
  --accent-foreground: 220 14% 92%;
  --destructive: 0 72% 51%;
  --destructive-foreground: 0 0% 100%;
  --border: 220 14% 16%;
  --input: 220 14% 16%;
  --ring: 48 96% 53%;
  --radius: 0.75rem;
}

body {
  font-family: 'DM Sans', sans-serif;
  font-weight: 400;
  background-color: hsl(var(--background));
  color: hsl(var(--foreground));
  -webkit-font-smoothing: antialiased;
}
```

- [ ] **Step 5: Create `apps/admin/src/lib/utils.ts`**

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 6: Create `apps/admin/src/main.tsx`**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from './router';
import './globals.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>
);
```

- [ ] **Step 7: Update root `package.json` — add admin scripts**

Add these two entries to the `"scripts"` object in `package.json`:

```json
"dev:admin": "vite --config apps/admin/vite.config.ts --port 5177",
"build:admin": "tsc -p apps/admin/tsconfig.json && vite build --config apps/admin/vite.config.ts"
```

- [ ] **Step 8: Update `vercel.json` — add admin rewrite and build**

Add this rewrite **before** the CRM catch-all rewrite (the one with `"destination": "/index.html"`):

```json
{
  "source": "/admin/(.*)",
  "destination": "/admin/index.html"
}
```

Update `buildCommand` to:

```json
"buildCommand": "npm run build && npm run build:hub && npm run build:admin"
```

- [ ] **Step 9: Update `tailwind.config.js` — add admin content paths**

Add these two entries to the `content` array:

```js
"./apps/admin/index.html",
"./apps/admin/src/**/*.{ts,tsx}",
```

- [ ] **Step 10: Verify the app builds**

Run: `npm run build:admin`

Expected: TypeScript compilation and Vite build succeed. Output files appear in `dist/admin/`.

- [ ] **Step 11: Commit**

```bash
git add apps/admin/ package.json vercel.json tailwind.config.js
git commit -m "feat(admin): scaffold admin app with Vite, TypeScript, Tailwind"
```

---

## Task 5: Supabase Client + API Layer

**Files:**
- Create: `apps/admin/src/lib/supabase.ts`
- Create: `apps/admin/src/lib/api.ts`

- [ ] **Step 1: Create `apps/admin/src/lib/supabase.ts`**

```ts
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Missing Supabase environment variables. Check your .env file.');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
```

- [ ] **Step 2: Create `apps/admin/src/lib/api.ts`**

```ts
import { supabase } from './supabase';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

// ─── Types ────────────────────────────────────────────────────

export interface WorkspaceSummary {
  id: string;
  name: string;
  logo_url: string | null;
  created_at: string;
  owner: { name: string; email: string } | null;
  member_count: number;
  client_count: number;
  plan_name: string | null;
  has_overrides: boolean;
}

export interface WorkspaceDetail {
  workspace: { id: string; name: string; logo_url: string | null; created_at: string };
  owner: MemberInfo | null;
  members: MemberInfo[];
  plan: { id: string; name: string } | null;
  override: {
    resource_overrides: Record<string, number> | null;
    feature_overrides: Record<string, boolean> | null;
    notes: string | null;
  } | null;
  resolved_limits: Record<string, number> | null;
  resolved_features: Record<string, boolean> | null;
  usage: { client_count: number; member_count: number; integration_count: number };
}

export interface MemberInfo {
  user_id: string;
  name: string;
  email: string;
  role: string;
  joined_at: string;
}

export interface Plan {
  id: string;
  name: string;
  resource_limits: Record<string, number>;
  feature_flags: Record<string, boolean>;
  is_default: boolean;
  created_at: string;
  updated_at: string;
  workspace_count: number;
}

export interface PlatformAdmin {
  id: string;
  user_id: string;
  email: string;
  invited_by: string | null;
  invited_by_email: string | null;
  created_at: string;
}

// ─── API Call ─────────────────────────────────────────────────

async function adminApi<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const res = await fetch(`${SUPABASE_URL}/functions/v1/platform-admin`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...params }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `API error: ${res.status}`);
  }

  return res.json();
}

// ─── Exported Functions ───────────────────────────────────────

export function verifyAdmin() {
  return adminApi<{ is_admin: boolean }>('verify-admin');
}

export function listWorkspaces(params?: { search?: string; plan_id?: string; offset?: number; limit?: number }) {
  return adminApi<{ workspaces: WorkspaceSummary[]; total: number }>('list-workspaces', params || {});
}

export function getWorkspace(workspace_id: string) {
  return adminApi<WorkspaceDetail>('get-workspace', { workspace_id });
}

export function listPlans() {
  return adminApi<{ plans: Plan[] }>('list-plans');
}

export function createPlan(params: { name: string; resource_limits: Record<string, number>; feature_flags: Record<string, boolean>; is_default?: boolean }) {
  return adminApi<{ plan: Plan }>('create-plan', params);
}

export function updatePlan(params: { plan_id: string; name?: string; resource_limits?: Record<string, number>; feature_flags?: Record<string, boolean>; is_default?: boolean }) {
  return adminApi<{ plan: Plan }>('update-plan', params);
}

export function deletePlan(plan_id: string) {
  return adminApi<{ message: string }>('delete-plan', { plan_id });
}

export function setWorkspacePlan(workspace_id: string, plan_id: string) {
  return adminApi<{ message: string }>('set-workspace-plan', { workspace_id, plan_id });
}

export function setWorkspaceOverrides(params: { workspace_id: string; resource_overrides?: Record<string, number>; feature_overrides?: Record<string, boolean>; notes?: string }) {
  return adminApi<{ message: string }>('set-workspace-overrides', params);
}

export function clearWorkspaceOverrides(workspace_id: string) {
  return adminApi<{ message: string }>('clear-workspace-overrides', { workspace_id });
}

export function listAdmins() {
  return adminApi<{ admins: PlatformAdmin[] }>('list-admins');
}

export function inviteAdmin(email: string) {
  return adminApi<{ admin: PlatformAdmin }>('invite-admin', { email });
}

export function removeAdmin(admin_id: string) {
  return adminApi<{ message: string }>('remove-admin', { admin_id });
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run build:admin`

Expected: Build succeeds with no type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/lib/supabase.ts apps/admin/src/lib/api.ts
git commit -m "feat(admin): add supabase client and typed API layer"
```

---

## Task 6: Auth Context + Route Protection

**Files:**
- Create: `apps/admin/src/context/AdminAuthContext.tsx`
- Create: `apps/admin/src/layouts/AdminProtectedRoute.tsx`

- [ ] **Step 1: Create `apps/admin/src/context/AdminAuthContext.tsx`**

```tsx
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { verifyAdmin } from '../lib/api';

interface AdminAuthContextValue {
  user: User | null;
  isAdmin: boolean;
  loading: boolean;
  adminEmail: string | null;
  signOut: () => Promise<void>;
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      const sessionUser = data.session?.user ?? null;
      setUser(sessionUser);
      if (sessionUser) {
        try {
          const result = await verifyAdmin();
          setIsAdmin(result.is_admin);
        } catch {
          setIsAdmin(false);
        }
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const newUser = session?.user ?? null;
      setUser(newUser);
      if (!newUser) {
        setIsAdmin(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (user) {
      verifyAdmin().then((r) => setIsAdmin(r.is_admin)).catch(() => setIsAdmin(false));
    } else {
      setIsAdmin(false);
    }
  }, [user?.id]);

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setIsAdmin(false);
  };

  return (
    <AdminAuthContext.Provider value={{ user, isAdmin, loading, adminEmail: user?.email ?? null, signOut }}>
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth(): AdminAuthContextValue {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error('useAdminAuth must be used within AdminAuthProvider');
  return ctx;
}
```

- [ ] **Step 2: Create `apps/admin/src/layouts/AdminProtectedRoute.tsx`**

```tsx
import { Navigate } from 'react-router-dom';
import { ReactNode } from 'react';
import { useAdminAuth } from '../context/AdminAuthContext';

export default function AdminProtectedRoute({ children }: { children: ReactNode }) {
  const { user, isAdmin, loading } = useAdminAuth();

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'hsl(220 14% 4%)' }}>
        <div style={{ width: 24, height: 24, border: '2px solid #333', borderTopColor: '#eab308', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!user || !isAdmin) {
    return <Navigate to="/admin/login" replace />;
  }

  return <>{children}</>;
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run build:admin`

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/context/AdminAuthContext.tsx apps/admin/src/layouts/AdminProtectedRoute.tsx
git commit -m "feat(admin): add auth context and route protection"
```

---

## Task 7: Admin Layout + Router

**Files:**
- Create: `apps/admin/src/layouts/AdminLayout.tsx`
- Create: `apps/admin/src/router.tsx`
- Modify: `apps/admin/src/main.tsx` (wrap with AdminAuthProvider)

- [ ] **Step 1: Create `apps/admin/src/layouts/AdminLayout.tsx`**

```tsx
import { Outlet, NavLink } from 'react-router-dom';
import { LayoutDashboard, Building2, Package, Users } from 'lucide-react';
import { useAdminAuth } from '../context/AdminAuthContext';

const NAV_ITEMS = [
  { to: '/admin', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/admin/workspaces', icon: Building2, label: 'Workspaces' },
  { to: '/admin/plans', icon: Package, label: 'Plans' },
  { to: '/admin/admins', icon: Users, label: 'Admins' },
];

export default function AdminLayout() {
  const { adminEmail, signOut } = useAdminAuth();

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-[220px] bg-[#12151a] border-r border-[#1e2430] flex flex-col fixed inset-y-0 left-0 z-10">
        <div className="px-5 pt-6 pb-4">
          <span className="font-['Playfair_Display'] text-xl font-black text-[#eab308]">mesaas</span>
          <span className="ml-1.5 text-[0.6rem] font-medium text-[#9ca3af] uppercase tracking-widest">admin</span>
        </div>

        <nav className="flex-1 px-3 flex flex-col gap-1">
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/admin'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-[#1e2430] text-[#e8eaf0]'
                    : 'text-[#9ca3af] hover:bg-[#1e2430]/50 hover:text-[#e8eaf0]'
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="px-4 py-4 border-t border-[#1e2430] mt-auto">
          <p className="text-sm text-[#9ca3af] truncate">{adminEmail}</p>
          <button
            onClick={signOut}
            className="text-xs text-[#4b5563] hover:text-[#eab308] transition-colors mt-1"
          >
            Sair
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="ml-[220px] flex-1 p-8 min-h-screen">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Create placeholder pages**

Create minimal placeholder files so the router compiles. Each page exports a default component with just a heading. These will be replaced in subsequent tasks.

`apps/admin/src/pages/LoginPage.tsx`:
```tsx
export default function LoginPage() {
  return <div className="flex items-center justify-center min-h-screen"><p className="text-[#9ca3af]">Login</p></div>;
}
```

`apps/admin/src/pages/DashboardPage.tsx`:
```tsx
export default function DashboardPage() {
  return <div><h1 className="text-xl font-bold font-['Playfair_Display']">Dashboard</h1></div>;
}
```

`apps/admin/src/pages/WorkspacesPage.tsx`:
```tsx
export default function WorkspacesPage() {
  return <div><h1 className="text-xl font-bold font-['Playfair_Display']">Workspaces</h1></div>;
}
```

`apps/admin/src/pages/WorkspaceDetailPage.tsx`:
```tsx
export default function WorkspaceDetailPage() {
  return <div><h1 className="text-xl font-bold font-['Playfair_Display']">Workspace Detail</h1></div>;
}
```

`apps/admin/src/pages/PlansPage.tsx`:
```tsx
export default function PlansPage() {
  return <div><h1 className="text-xl font-bold font-['Playfair_Display']">Plans</h1></div>;
}
```

`apps/admin/src/pages/AdminsPage.tsx`:
```tsx
export default function AdminsPage() {
  return <div><h1 className="text-xl font-bold font-['Playfair_Display']">Admins</h1></div>;
}
```

- [ ] **Step 3: Create `apps/admin/src/router.tsx`**

```tsx
import { createBrowserRouter } from 'react-router-dom';
import AdminLayout from './layouts/AdminLayout';
import AdminProtectedRoute from './layouts/AdminProtectedRoute';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import WorkspacesPage from './pages/WorkspacesPage';
import WorkspaceDetailPage from './pages/WorkspaceDetailPage';
import PlansPage from './pages/PlansPage';
import AdminsPage from './pages/AdminsPage';

export const router = createBrowserRouter([
  {
    path: '/admin/login',
    element: <LoginPage />,
  },
  {
    path: '/admin',
    element: (
      <AdminProtectedRoute>
        <AdminLayout />
      </AdminProtectedRoute>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'workspaces', element: <WorkspacesPage /> },
      { path: 'workspaces/:id', element: <WorkspaceDetailPage /> },
      { path: 'plans', element: <PlansPage /> },
      { path: 'admins', element: <AdminsPage /> },
    ],
  },
  {
    path: '*',
    element: (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <p style={{ fontFamily: 'sans-serif', color: '#666' }}>Página não encontrada.</p>
      </div>
    ),
  },
]);
```

- [ ] **Step 4: Update `apps/admin/src/main.tsx` to wrap with AdminAuthProvider**

Replace the full content of `apps/admin/src/main.tsx`:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { AdminAuthProvider } from './context/AdminAuthContext';
import { router } from './router';
import './globals.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AdminAuthProvider>
        <Toaster />
        <RouterProvider router={router} />
      </AdminAuthProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
```

- [ ] **Step 5: Verify the app builds and starts**

Run: `npm run build:admin`

Expected: Build succeeds.

Run: `npm run dev:admin`

Expected: Dev server starts on port 5177. Navigate to `http://localhost:5177/admin/login` — you should see the "Login" placeholder text.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/
git commit -m "feat(admin): add layout, router, and placeholder pages"
```

---

## Task 8: Login Page

**Files:**
- Modify: `apps/admin/src/pages/LoginPage.tsx`

- [ ] **Step 1: Implement the login page**

Replace `apps/admin/src/pages/LoginPage.tsx`:

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { verifyAdmin } from '../lib/api';

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) {
        setError('Email ou senha inválidos.');
        setLoading(false);
        return;
      }

      const { is_admin } = await verifyAdmin();
      if (!is_admin) {
        await supabase.auth.signOut();
        setError('Acesso não autorizado.');
        setLoading(false);
        return;
      }

      navigate('/admin');
    } catch {
      setError('Erro ao fazer login. Tente novamente.');
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'linear-gradient(135deg, #eaf0dc 0%, #eab308 100%)' }}
    >
      <div className="w-full max-w-[400px] bg-white rounded-3xl p-10 shadow-xl">
        <div className="text-center mb-8">
          <h1 className="font-['Playfair_Display'] text-2xl font-black text-[#12151a]">mesaas</h1>
          <p className="text-sm text-[#4b5563] mt-1 uppercase tracking-widest font-medium">admin</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-xs font-medium text-[#374151] uppercase tracking-wider mb-1.5">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2.5 rounded-lg border border-[#e5e7eb] text-sm font-['DM_Mono'] text-[#12151a] focus:outline-none focus:border-[#eab308] transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#374151] uppercase tracking-wider mb-1.5">
              Senha
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-3 py-2.5 rounded-lg border border-[#e5e7eb] text-sm font-['DM_Mono'] text-[#12151a] focus:outline-none focus:border-[#eab308] transition-colors"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-[#eab308] text-[#12151a] font-semibold text-sm hover:bg-[#ca8a04] transition-colors disabled:opacity-50"
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify in browser**

Run: `npm run dev:admin`

Navigate to `http://localhost:5177/admin/login`. The login form should render with the branded gradient background. Test login with your credentials — on success it should redirect to `/admin`.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/pages/LoginPage.tsx
git commit -m "feat(admin): implement login page with admin verification"
```

---

## Task 9: Dashboard Page

**Files:**
- Modify: `apps/admin/src/pages/DashboardPage.tsx`

- [ ] **Step 1: Implement the dashboard page**

Replace `apps/admin/src/pages/DashboardPage.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { listWorkspaces, listPlans } from '../lib/api';

export default function DashboardPage() {
  const navigate = useNavigate();

  const { data: workspacesData, isLoading: wsLoading } = useQuery({
    queryKey: ['admin', 'workspaces', { limit: 10 }],
    queryFn: () => listWorkspaces({ limit: 10 }),
  });

  const { data: plansData, isLoading: plansLoading } = useQuery({
    queryKey: ['admin', 'plans'],
    queryFn: listPlans,
  });

  const totalWorkspaces = workspacesData?.total ?? 0;
  const activePlans = plansData?.plans?.length ?? 0;
  const withOverrides = workspacesData?.workspaces?.filter((w) => w.has_overrides).length ?? 0;
  const totalMembers = workspacesData?.workspaces?.reduce((sum, w) => sum + w.member_count, 0) ?? 0;

  const isLoading = wsLoading || plansLoading;

  const kpis = [
    { label: 'Workspaces', value: totalWorkspaces },
    { label: 'Total Users', value: totalMembers },
    { label: 'Active Plans', value: activePlans },
    { label: 'With Overrides', value: withOverrides },
  ];

  return (
    <div>
      <h1 className="font-['Playfair_Display'] text-2xl font-bold mb-1">Dashboard</h1>
      <p className="text-sm text-[#9ca3af] mb-8">Platform overview</p>

      {/* KPI Row */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="bg-[#12151a] border border-[#1e2430] rounded-2xl p-5">
            <p className="text-xs text-[#9ca3af] uppercase tracking-wider mb-2">{kpi.label}</p>
            <p className="text-3xl font-bold font-['DM_Mono']">
              {isLoading ? '—' : kpi.value}
            </p>
          </div>
        ))}
      </div>

      {/* Recent Workspaces */}
      <div className="bg-[#12151a] border border-[#1e2430] rounded-2xl p-5">
        <h2 className="font-semibold mb-4">Recent Workspaces</h2>

        <div className="grid grid-cols-[2fr_1.5fr_1fr_1fr_0.75fr] gap-2 text-xs text-[#9ca3af] uppercase tracking-wider pb-3 border-b border-[#1e2430]">
          <span>Workspace</span>
          <span>Owner</span>
          <span>Plan</span>
          <span>Members</span>
          <span>Created</span>
        </div>

        {isLoading ? (
          <p className="text-sm text-[#4b5563] py-4">Loading...</p>
        ) : (
          (workspacesData?.workspaces || []).map((ws) => (
            <div
              key={ws.id}
              onClick={() => navigate(`/admin/workspaces/${ws.id}`)}
              className="grid grid-cols-[2fr_1.5fr_1fr_1fr_0.75fr] gap-2 py-3 border-b border-[#1e2430]/50 text-sm cursor-pointer hover:bg-[#1e2430]/30 transition-colors -mx-5 px-5"
            >
              <span className="text-[#eab308] font-medium">{ws.name}</span>
              <span className="text-[#9ca3af]">{ws.owner?.name || '—'}</span>
              <span>
                {ws.plan_name ? (
                  <span className="inline-block text-[0.7rem] font-semibold uppercase px-2 py-0.5 rounded-sm bg-[#eab308]/15 text-[#eab308]">
                    {ws.plan_name}
                  </span>
                ) : (
                  <span className="text-[#4b5563]">—</span>
                )}
              </span>
              <span className="font-['DM_Mono']">{ws.member_count}</span>
              <span className="text-[#9ca3af]">
                {new Date(ws.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify in browser**

Navigate to `http://localhost:5177/admin` (logged in). KPI cards and recent workspaces table should render with real data.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/pages/DashboardPage.tsx
git commit -m "feat(admin): implement dashboard page with KPIs and recent workspaces"
```

---

## Task 10: Workspaces Page

**Files:**
- Modify: `apps/admin/src/pages/WorkspacesPage.tsx`

- [ ] **Step 1: Implement the workspaces list page**

Replace `apps/admin/src/pages/WorkspacesPage.tsx`:

```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Search, ArrowRight } from 'lucide-react';
import { listWorkspaces, listPlans } from '../lib/api';

export default function WorkspacesPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [page, setPage] = useState(0);
  const limit = 20;

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'workspaces', { search, plan_id: planFilter, offset: page * limit, limit }],
    queryFn: () => listWorkspaces({ search: search || undefined, plan_id: planFilter || undefined, offset: page * limit, limit }),
  });

  const { data: plansData } = useQuery({
    queryKey: ['admin', 'plans'],
    queryFn: listPlans,
  });

  const workspaces = data?.workspaces || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      <h1 className="font-['Playfair_Display'] text-2xl font-bold mb-1">Workspaces</h1>
      <p className="text-sm text-[#9ca3af] mb-6">All registered workspaces</p>

      {/* Search + Filter */}
      <div className="flex gap-3 mb-6">
        <div className="flex-1 relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9ca3af]" />
          <input
            type="text"
            placeholder="Search workspaces..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-[#12151a] border border-[#1e2430] text-sm font-['DM_Mono'] text-[#e8eaf0] placeholder-[#9ca3af] focus:outline-none focus:border-[#eab308] transition-colors"
          />
        </div>
        <select
          value={planFilter}
          onChange={(e) => { setPlanFilter(e.target.value); setPage(0); }}
          className="px-3 py-2.5 rounded-lg bg-[#12151a] border border-[#1e2430] text-sm text-[#9ca3af] focus:outline-none focus:border-[#eab308]"
        >
          <option value="">All Plans</option>
          {plansData?.plans?.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-[#12151a] border border-[#1e2430] rounded-2xl p-5">
        <div className="grid grid-cols-[2fr_1.5fr_1fr_0.75fr_0.75fr_0.75fr_0.5fr] gap-2 text-[0.7rem] text-[#9ca3af] uppercase tracking-wider pb-3 border-b border-[#1e2430]">
          <span>Workspace</span>
          <span>Owner</span>
          <span>Plan</span>
          <span>Clients</span>
          <span>Members</span>
          <span>Created</span>
          <span></span>
        </div>

        {isLoading ? (
          <p className="text-sm text-[#4b5563] py-4">Loading...</p>
        ) : workspaces.length === 0 ? (
          <p className="text-sm text-[#4b5563] py-4">No workspaces found.</p>
        ) : (
          workspaces.map((ws) => (
            <div
              key={ws.id}
              onClick={() => navigate(`/admin/workspaces/${ws.id}`)}
              className="grid grid-cols-[2fr_1.5fr_1fr_0.75fr_0.75fr_0.75fr_0.5fr] gap-2 py-3 border-b border-[#1e2430]/50 text-sm items-center cursor-pointer hover:bg-[#1e2430]/30 transition-colors -mx-5 px-5"
            >
              <span>
                <span className="text-[#eab308] font-medium">{ws.name}</span>
                {ws.has_overrides && (
                  <span className="ml-2 text-[0.6rem] font-semibold uppercase px-1.5 py-0.5 rounded-sm bg-[#f5a342]/10 text-[#f5a342]">
                    OVERRIDES
                  </span>
                )}
              </span>
              <span className="text-[#9ca3af] truncate">{ws.owner?.email || '—'}</span>
              <span>
                {ws.plan_name ? (
                  <span className="inline-block text-[0.7rem] font-semibold uppercase px-2 py-0.5 rounded-sm bg-[#eab308]/15 text-[#eab308]">
                    {ws.plan_name}
                  </span>
                ) : (
                  <span className="text-[#4b5563]">—</span>
                )}
              </span>
              <span className="font-['DM_Mono']">{ws.client_count}</span>
              <span className="font-['DM_Mono']">{ws.member_count}</span>
              <span className="text-[#9ca3af]">
                {new Date(ws.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
              </span>
              <span className="text-[#eab308]"><ArrowRight size={16} /></span>
            </div>
          ))
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-4">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-3 py-1.5 rounded-lg text-sm bg-[#12151a] border border-[#1e2430] text-[#9ca3af] disabled:opacity-30"
          >
            Previous
          </button>
          <span className="px-3 py-1.5 text-sm text-[#9ca3af]">
            {page + 1} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="px-3 py-1.5 rounded-lg text-sm bg-[#12151a] border border-[#1e2430] text-[#9ca3af] disabled:opacity-30"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify in browser**

Navigate to `http://localhost:5177/admin/workspaces`. Search and plan filter should work. Clicking a row navigates to `/admin/workspaces/:id`.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/pages/WorkspacesPage.tsx
git commit -m "feat(admin): implement workspaces list page with search and plan filter"
```

---

## Task 11: Workspace Detail Page

**Files:**
- Modify: `apps/admin/src/pages/WorkspaceDetailPage.tsx`

- [ ] **Step 1: Implement the workspace detail page**

Replace `apps/admin/src/pages/WorkspaceDetailPage.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import {
  getWorkspace, listPlans, setWorkspacePlan,
  setWorkspaceOverrides, clearWorkspaceOverrides,
} from '../lib/api';

const RESOURCE_LABELS: Record<string, string> = {
  max_clients: 'Max Clients',
  max_members: 'Max Members',
  max_instagram_accounts: 'Max Instagram',
  max_storage_mb: 'Storage (MB)',
};

const FEATURE_LABELS: Record<string, string> = {
  analytics: 'Analytics',
  post_express: 'Post Express',
  briefing: 'Briefing',
  ideias: 'Ideias',
};

export default function WorkspaceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'workspace', id],
    queryFn: () => getWorkspace(id!),
    enabled: !!id,
  });

  const { data: plansData } = useQuery({
    queryKey: ['admin', 'plans'],
    queryFn: listPlans,
  });

  const [resourceEdits, setResourceEdits] = useState<Record<string, string>>({});
  const [featureEdits, setFeatureEdits] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState('');
  const [selectedPlanId, setSelectedPlanId] = useState('');

  useEffect(() => {
    if (data) {
      setSelectedPlanId(data.plan?.id || '');
      setNotes(data.override?.notes || '');
      // Initialize edits from resolved values
      const rEdits: Record<string, string> = {};
      if (data.resolved_limits) {
        for (const [k, v] of Object.entries(data.resolved_limits)) {
          rEdits[k] = String(v);
        }
      }
      setResourceEdits(rEdits);

      const fEdits: Record<string, boolean> = {};
      if (data.resolved_features) {
        for (const [k, v] of Object.entries(data.resolved_features)) {
          fEdits[k] = v;
        }
      }
      setFeatureEdits(fEdits);
    }
  }, [data]);

  const setPlanMutation = useMutation({
    mutationFn: (planId: string) => setWorkspacePlan(id!, planId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'workspace', id] });
      toast.success('Plan updated');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const saveOverridesMutation = useMutation({
    mutationFn: () => {
      const plan = plansData?.plans?.find((p) => p.id === selectedPlanId);
      if (!plan) throw new Error('No plan selected');

      const resOverrides: Record<string, number> = {};
      for (const [k, v] of Object.entries(resourceEdits)) {
        const parsed = parseInt(v, 10);
        if (!isNaN(parsed) && parsed !== plan.resource_limits[k]) {
          resOverrides[k] = parsed;
        }
      }

      const featOverrides: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(featureEdits)) {
        if (v !== plan.feature_flags[k]) {
          featOverrides[k] = v;
        }
      }

      return setWorkspaceOverrides({
        workspace_id: id!,
        resource_overrides: Object.keys(resOverrides).length > 0 ? resOverrides : undefined,
        feature_overrides: Object.keys(featOverrides).length > 0 ? featOverrides : undefined,
        notes: notes || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'workspace', id] });
      toast.success('Overrides saved');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const clearMutation = useMutation({
    mutationFn: () => clearWorkspaceOverrides(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'workspace', id] });
      toast.success('Overrides cleared');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading || !data) {
    return <p className="text-[#4b5563]">Loading...</p>;
  }

  const plan = plansData?.plans?.find((p) => p.id === selectedPlanId);

  const isOverridden = (key: string, type: 'resource' | 'feature') => {
    if (!data.override) return false;
    if (type === 'resource') return data.override.resource_overrides?.[key] !== undefined;
    return data.override.feature_overrides?.[key] !== undefined;
  };

  return (
    <div>
      {/* Header */}
      <button onClick={() => navigate('/admin/workspaces')} className="flex items-center gap-2 text-sm text-[#9ca3af] hover:text-[#eab308] mb-4 transition-colors">
        <ArrowLeft size={16} /> Back
      </button>

      <div className="flex items-center gap-4 mb-8">
        <div className="w-12 h-12 bg-[#1e2430] rounded-xl flex items-center justify-center text-lg font-bold text-[#eab308]">
          {data.workspace.name.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1">
          <h1 className="font-['Playfair_Display'] text-xl font-bold">{data.workspace.name}</h1>
          <p className="text-sm text-[#9ca3af]">
            Owner: {data.owner?.email || '—'} · Created {new Date(data.workspace.created_at).toLocaleDateString('pt-BR')}
          </p>
        </div>

        {/* Plan selector */}
        <select
          value={selectedPlanId}
          onChange={(e) => {
            setSelectedPlanId(e.target.value);
            setPlanMutation.mutate(e.target.value);
          }}
          className="px-3 py-2 rounded-lg bg-[#12151a] border border-[#1e2430] text-sm text-[#e8eaf0] focus:outline-none focus:border-[#eab308]"
        >
          <option value="">No plan</option>
          {plansData?.plans?.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-2 gap-6 mb-6">
        {/* Resource Limits */}
        <div className="bg-[#12151a] border border-[#1e2430] rounded-2xl p-5">
          <h2 className="font-semibold mb-4">Resource Limits</h2>
          <div className="flex flex-col gap-3">
            {Object.entries(RESOURCE_LABELS).map(([key, label]) => (
              <div key={key} className="flex justify-between items-center">
                <span className="text-sm text-[#9ca3af]">{label}</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={resourceEdits[key] ?? ''}
                    onChange={(e) => setResourceEdits((prev) => ({ ...prev, [key]: e.target.value }))}
                    className={`w-20 px-2 py-1 rounded text-right font-['DM_Mono'] text-sm bg-[#1e2430] border focus:outline-none focus:border-[#eab308] ${
                      isOverridden(key, 'resource') ? 'border-[#eab308]/30 text-[#eab308]' : 'border-transparent text-[#e8eaf0]'
                    }`}
                  />
                  <span className={`text-[0.7rem] ${isOverridden(key, 'resource') ? 'text-[#f5a342]' : 'text-[#4b5563]'}`}>
                    {isOverridden(key, 'resource')
                      ? `override (plan: ${plan?.resource_limits[key] ?? '—'})`
                      : `plan: ${plan?.resource_limits[key] ?? '—'}`}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Feature Flags */}
        <div className="bg-[#12151a] border border-[#1e2430] rounded-2xl p-5">
          <h2 className="font-semibold mb-4">Feature Flags</h2>
          <div className="flex flex-col gap-3">
            {Object.entries(FEATURE_LABELS).map(([key, label]) => (
              <div key={key} className="flex justify-between items-center">
                <span className="text-sm text-[#9ca3af]">{label}</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setFeatureEdits((prev) => ({ ...prev, [key]: !prev[key] }))}
                    className={`text-sm font-medium ${featureEdits[key] ? 'text-[#3ecf8e]' : 'text-[#f55a42]'}`}
                  >
                    {featureEdits[key] ? '● ON' : '● OFF'}
                  </button>
                  <span className={`text-[0.7rem] ${isOverridden(key, 'feature') ? 'text-[#f5a342]' : 'text-[#4b5563]'}`}>
                    {isOverridden(key, 'feature')
                      ? `override (plan: ${plan?.feature_flags[key] ? 'ON' : 'OFF'})`
                      : 'plan'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Notes */}
      <div className="bg-[#12151a] border border-[#1e2430] rounded-2xl p-5 mb-6">
        <h2 className="font-semibold mb-3">Notes</h2>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Admin notes..."
          rows={2}
          className="w-full px-3 py-2 rounded-lg bg-[#1e2430] border border-transparent text-sm text-[#e8eaf0] placeholder-[#4b5563] focus:outline-none focus:border-[#eab308] resize-none"
        />
      </div>

      {/* Save / Reset */}
      <div className="flex gap-3 mb-8">
        <button
          onClick={() => saveOverridesMutation.mutate()}
          disabled={saveOverridesMutation.isPending}
          className="px-6 py-2.5 rounded-lg bg-[#eab308] text-[#12151a] font-semibold text-sm hover:bg-[#ca8a04] transition-colors disabled:opacity-50"
        >
          {saveOverridesMutation.isPending ? 'Saving...' : 'Save Overrides'}
        </button>
        <button
          onClick={() => clearMutation.mutate()}
          disabled={clearMutation.isPending}
          className="px-6 py-2.5 rounded-lg border border-[#1e2430] text-sm text-[#9ca3af] hover:border-[#eab308] hover:text-[#eab308] transition-colors disabled:opacity-50"
        >
          Reset to Plan Defaults
        </button>
      </div>

      {/* Members table */}
      <div className="bg-[#12151a] border border-[#1e2430] rounded-2xl p-5">
        <h2 className="font-semibold mb-4">Members ({data.members.length})</h2>

        <div className="grid grid-cols-[2fr_2fr_1fr_1fr] gap-2 text-[0.7rem] text-[#9ca3af] uppercase tracking-wider pb-3 border-b border-[#1e2430]">
          <span>Name</span>
          <span>Email</span>
          <span>Role</span>
          <span>Joined</span>
        </div>

        {data.members.map((m) => (
          <div key={m.user_id} className="grid grid-cols-[2fr_2fr_1fr_1fr] gap-2 py-2.5 border-b border-[#1e2430]/50 text-sm">
            <span>{m.name}</span>
            <span className="text-[#9ca3af]">{m.email}</span>
            <span className={m.role === 'owner' ? 'text-[#eab308]' : 'text-[#9ca3af]'}>{m.role}</span>
            <span className="text-[#9ca3af]">
              {new Date(m.joined_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify in browser**

Navigate to any workspace detail page from the workspaces list. Verify: plan selector, resource limit inputs, feature toggles, override indicators, members table, save/reset buttons.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/pages/WorkspaceDetailPage.tsx
git commit -m "feat(admin): implement workspace detail page with limit overrides"
```

---

## Task 12: Plans Page

**Files:**
- Modify: `apps/admin/src/pages/PlansPage.tsx`

- [ ] **Step 1: Implement the plans page**

Replace `apps/admin/src/pages/PlansPage.tsx`:

```tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { listPlans, createPlan, updatePlan, deletePlan, type Plan } from '../lib/api';

const RESOURCE_LABELS: Record<string, string> = {
  max_clients: 'Clients',
  max_members: 'Members',
  max_instagram_accounts: 'Instagram',
  max_storage_mb: 'Storage (MB)',
};

const FEATURE_LABELS: Record<string, string> = {
  analytics: 'Analytics',
  post_express: 'Post Express',
  briefing: 'Briefing',
  ideias: 'Ideias',
};

const DEFAULT_RESOURCES = { max_clients: 5, max_members: 3, max_instagram_accounts: 1, max_storage_mb: 500 };
const DEFAULT_FEATURES = { analytics: false, post_express: false, briefing: true, ideias: false };

interface FormState {
  name: string;
  resource_limits: Record<string, number>;
  feature_flags: Record<string, boolean>;
  is_default: boolean;
}

export default function PlansPage() {
  const queryClient = useQueryClient();
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>({
    name: '',
    resource_limits: { ...DEFAULT_RESOURCES },
    feature_flags: { ...DEFAULT_FEATURES },
    is_default: false,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'plans'],
    queryFn: listPlans,
  });

  const createMutation = useMutation({
    mutationFn: () => createPlan(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'plans'] });
      toast.success('Plan created');
      closeForm();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: () => updatePlan({ plan_id: editingPlan!.id, ...form }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'plans'] });
      toast.success('Plan updated');
      closeForm();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (planId: string) => deletePlan(planId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'plans'] });
      toast.success('Plan deleted');
      closeForm();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const openCreate = () => {
    setEditingPlan(null);
    setForm({ name: '', resource_limits: { ...DEFAULT_RESOURCES }, feature_flags: { ...DEFAULT_FEATURES }, is_default: false });
    setShowForm(true);
  };

  const openEdit = (plan: Plan) => {
    setEditingPlan(plan);
    setForm({
      name: plan.name,
      resource_limits: { ...plan.resource_limits },
      feature_flags: { ...plan.feature_flags },
      is_default: plan.is_default,
    });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingPlan(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingPlan) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="font-['Playfair_Display'] text-2xl font-bold mb-1">Plans</h1>
          <p className="text-sm text-[#9ca3af]">Manage plan templates</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#eab308] text-[#12151a] font-semibold text-sm hover:bg-[#ca8a04] transition-colors"
        >
          <Plus size={16} /> New Plan
        </button>
      </div>

      {/* Plan Cards */}
      {isLoading ? (
        <p className="text-[#4b5563]">Loading...</p>
      ) : (
        <div className="grid grid-cols-3 gap-6">
          {(data?.plans || []).map((plan) => (
            <div key={plan.id} className="bg-[#12151a] border border-[#1e2430] rounded-2xl p-6 relative">
              <div className="flex justify-between items-center mb-4">
                <span className="text-lg font-bold">{plan.name}</span>
                <div className="flex items-center gap-2">
                  {plan.is_default && (
                    <span className="text-[0.65rem] font-semibold uppercase px-2 py-0.5 rounded-sm bg-[#3ecf8e]/15 text-[#3ecf8e]">
                      DEFAULT
                    </span>
                  )}
                  <button onClick={() => openEdit(plan)} className="text-[#9ca3af] hover:text-[#eab308] transition-colors">
                    <Pencil size={14} />
                  </button>
                </div>
              </div>

              <p className="text-[0.75rem] text-[#9ca3af] uppercase tracking-wider mb-2">Limits</p>
              <div className="flex flex-col gap-1 mb-4 text-sm text-[#9ca3af]">
                {Object.entries(RESOURCE_LABELS).map(([key, label]) => (
                  <div key={key}>
                    {label}: <span className="text-[#e8eaf0] font-['DM_Mono']">{plan.resource_limits[key] ?? '—'}</span>
                  </div>
                ))}
              </div>

              <p className="text-[0.75rem] text-[#9ca3af] uppercase tracking-wider mb-2">Features</p>
              <div className="flex flex-col gap-1 mb-4 text-sm text-[#9ca3af]">
                {Object.entries(FEATURE_LABELS).map(([key, label]) => (
                  <div key={key}>
                    {label}: <span className={plan.feature_flags[key] ? 'text-[#3ecf8e]' : 'text-[#f55a42]'}>
                      {plan.feature_flags[key] ? 'ON' : 'OFF'}
                    </span>
                  </div>
                ))}
              </div>

              <div className="pt-3 border-t border-[#1e2430] text-[#4b5563] text-sm">
                {plan.workspace_count} workspaces
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Form Modal Overlay */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={closeForm}>
          <div className="bg-[#12151a] border border-[#1e2430] rounded-2xl p-8 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-['Playfair_Display'] text-lg font-bold mb-6">
              {editingPlan ? `Edit: ${editingPlan.name}` : 'New Plan'}
            </h2>

            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              <div>
                <label className="block text-xs font-medium text-[#9ca3af] uppercase tracking-wider mb-1.5">Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  required
                  className="w-full px-3 py-2 rounded-lg bg-[#1e2430] border border-transparent text-sm font-['DM_Mono'] text-[#e8eaf0] focus:outline-none focus:border-[#eab308]"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#9ca3af] uppercase tracking-wider mb-2">Resource Limits</label>
                <div className="grid grid-cols-2 gap-3">
                  {Object.entries(RESOURCE_LABELS).map(([key, label]) => (
                    <div key={key}>
                      <label className="block text-xs text-[#4b5563] mb-1">{label}</label>
                      <input
                        type="number"
                        value={form.resource_limits[key] ?? 0}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            resource_limits: { ...f.resource_limits, [key]: parseInt(e.target.value, 10) || 0 },
                          }))
                        }
                        className="w-full px-3 py-2 rounded-lg bg-[#1e2430] border border-transparent text-sm font-['DM_Mono'] text-[#e8eaf0] focus:outline-none focus:border-[#eab308]"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#9ca3af] uppercase tracking-wider mb-2">Feature Flags</label>
                <div className="flex flex-col gap-2">
                  {Object.entries(FEATURE_LABELS).map(([key, label]) => (
                    <div key={key} className="flex justify-between items-center">
                      <span className="text-sm text-[#9ca3af]">{label}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            feature_flags: { ...f.feature_flags, [key]: !f.feature_flags[key] },
                          }))
                        }
                        className={`text-sm font-medium ${form.feature_flags[key] ? 'text-[#3ecf8e]' : 'text-[#f55a42]'}`}
                      >
                        {form.feature_flags[key] ? '● ON' : '● OFF'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_default"
                  checked={form.is_default}
                  onChange={(e) => setForm((f) => ({ ...f, is_default: e.target.checked }))}
                  className="rounded"
                />
                <label htmlFor="is_default" className="text-sm text-[#9ca3af]">Default plan for new workspaces</label>
              </div>

              <div className="flex gap-3 mt-2">
                <button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="flex-1 py-2.5 rounded-lg bg-[#eab308] text-[#12151a] font-semibold text-sm hover:bg-[#ca8a04] transition-colors disabled:opacity-50"
                >
                  {editingPlan ? 'Update' : 'Create'}
                </button>
                <button type="button" onClick={closeForm} className="px-4 py-2.5 rounded-lg border border-[#1e2430] text-sm text-[#9ca3af] hover:border-[#eab308] transition-colors">
                  Cancel
                </button>
                {editingPlan && editingPlan.workspace_count === 0 && (
                  <button
                    type="button"
                    onClick={() => deleteMutation.mutate(editingPlan.id)}
                    disabled={deleteMutation.isPending}
                    className="px-4 py-2.5 rounded-lg border border-[#f55a42]/30 text-sm text-[#f55a42] hover:bg-[#f55a42]/10 transition-colors disabled:opacity-50"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify in browser**

Navigate to `http://localhost:5177/admin/plans`. Create a plan (e.g. "Free" with defaults), edit it, verify the modal works. Check that the DEFAULT badge appears correctly.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/pages/PlansPage.tsx
git commit -m "feat(admin): implement plans page with CRUD modal"
```

---

## Task 13: Admins Page

**Files:**
- Modify: `apps/admin/src/pages/AdminsPage.tsx`

- [ ] **Step 1: Implement the admins page**

Replace `apps/admin/src/pages/AdminsPage.tsx`:

```tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { listAdmins, inviteAdmin, removeAdmin } from '../lib/api';
import { useAdminAuth } from '../context/AdminAuthContext';

export default function AdminsPage() {
  const queryClient = useQueryClient();
  const { user } = useAdminAuth();
  const [email, setEmail] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'admins'],
    queryFn: listAdmins,
  });

  const inviteMutation = useMutation({
    mutationFn: () => inviteAdmin(email),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'admins'] });
      toast.success('Admin adicionado');
      setEmail('');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const removeMutation = useMutation({
    mutationFn: (adminId: string) => removeAdmin(adminId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'admins'] });
      toast.success('Admin removido');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    inviteMutation.mutate();
  };

  return (
    <div>
      <h1 className="font-['Playfair_Display'] text-2xl font-bold mb-1">Admins</h1>
      <p className="text-sm text-[#9ca3af] mb-6">Platform administrators</p>

      {/* Invite form */}
      <form onSubmit={handleInvite} className="flex gap-3 mb-8">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email do novo admin..."
          required
          className="flex-1 px-3 py-2.5 rounded-lg bg-[#12151a] border border-[#1e2430] text-sm font-['DM_Mono'] text-[#e8eaf0] placeholder-[#9ca3af] focus:outline-none focus:border-[#eab308] transition-colors"
        />
        <button
          type="submit"
          disabled={inviteMutation.isPending}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#eab308] text-[#12151a] font-semibold text-sm hover:bg-[#ca8a04] transition-colors disabled:opacity-50"
        >
          <UserPlus size={16} />
          Convidar Admin
        </button>
      </form>

      {/* Admins table */}
      <div className="bg-[#12151a] border border-[#1e2430] rounded-2xl p-5">
        <div className="grid grid-cols-[2fr_2fr_1.5fr_0.5fr] gap-2 text-[0.7rem] text-[#9ca3af] uppercase tracking-wider pb-3 border-b border-[#1e2430]">
          <span>Email</span>
          <span>Invited By</span>
          <span>Added</span>
          <span></span>
        </div>

        {isLoading ? (
          <p className="text-sm text-[#4b5563] py-4">Loading...</p>
        ) : (
          (data?.admins || []).map((admin) => {
            const isSelf = admin.user_id === user?.id;
            return (
              <div key={admin.id} className="grid grid-cols-[2fr_2fr_1.5fr_0.5fr] gap-2 py-3 border-b border-[#1e2430]/50 text-sm items-center">
                <span className="text-[#e8eaf0]">{admin.email}</span>
                <span className="text-[#9ca3af]">{admin.invited_by_email || '—'}</span>
                <span className="text-[#9ca3af]">
                  {new Date(admin.created_at).toLocaleDateString('pt-BR')}
                </span>
                <span>
                  {!isSelf && (
                    <button
                      onClick={() => removeMutation.mutate(admin.id)}
                      disabled={removeMutation.isPending}
                      className="text-[#4b5563] hover:text-[#f55a42] transition-colors disabled:opacity-50"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify in browser**

Navigate to `http://localhost:5177/admin/admins`. Your email should appear in the table. Verify the remove button is disabled for yourself. Test inviting (will error if no other auth account exists — that's expected).

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/pages/AdminsPage.tsx
git commit -m "feat(admin): implement admins page with invite and remove"
```

---

## Task 14: CRM — useWorkspaceLimits Hook

**Files:**
- Create: `apps/crm/src/hooks/useWorkspaceLimits.ts`

- [ ] **Step 1: Create the hook**

Create `apps/crm/src/hooks/useWorkspaceLimits.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface ResourceLimits {
  max_clients: number;
  max_members: number;
  max_instagram_accounts: number;
  max_storage_mb: number;
}

export interface FeatureFlags {
  analytics: boolean;
  post_express: boolean;
  briefing: boolean;
  ideias: boolean;
}

interface WorkspaceLimitsResponse {
  plan_name: string | null;
  limits: ResourceLimits | null;
  features: FeatureFlags | null;
}

async function fetchWorkspaceLimits(): Promise<WorkspaceLimitsResponse> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const url = import.meta.env.VITE_SUPABASE_URL as string;
  const res = await fetch(`${url}/functions/v1/workspace-limits`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  if (!res.ok) throw new Error('Failed to fetch workspace limits');
  return res.json();
}

export function useWorkspaceLimits() {
  const { data, isLoading } = useQuery({
    queryKey: ['workspace-limits'],
    queryFn: fetchWorkspaceLimits,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });

  return {
    limits: data?.limits ?? null,
    features: data?.features ?? null,
    planName: data?.plan_name ?? null,
    isLoading,
    isUnlimited: !isLoading && data?.limits === null,
  };
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`

Expected: CRM build succeeds with no type errors.

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/hooks/useWorkspaceLimits.ts
git commit -m "feat(admin): add useWorkspaceLimits hook for CRM-side limit resolution"
```

---

## Task 15: CRM — Feature Flag Route Gating

**Files:**
- Modify: `apps/crm/src/components/layout/ProtectedRoute.tsx`

- [ ] **Step 1: Add feature flag gating to ProtectedRoute**

Update `apps/crm/src/components/layout/ProtectedRoute.tsx` to add feature flag checking. The modified file:

```tsx
import { Navigate, useLocation } from 'react-router-dom';
import { ReactNode } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useWorkspaceLimits } from '../../hooks/useWorkspaceLimits';
import { Spinner } from '@/components/ui/spinner';

const AGENT_BLOCKED = ['/financeiro', '/contratos', '/leads', '/equipe'];

const FEATURE_GATED: Record<string, string> = {
  '/analytics': 'analytics',
  '/post-express': 'post_express',
  '/ideias': 'ideias',
};

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, profile, role, loading } = useAuth();
  const location = useLocation();
  const { features, isLoading: limitsLoading, isUnlimited } = useWorkspaceLimits();

  if (loading || limitsLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (role === 'agent' && AGENT_BLOCKED.some(p => location.pathname.startsWith(p))) {
    return <Navigate to="/dashboard" replace />;
  }

  // Feature flag gating (skip if unlimited / no plan assigned)
  if (!isUnlimited && features) {
    for (const [path, flag] of Object.entries(FEATURE_GATED)) {
      if (location.pathname.startsWith(path) && features[flag as keyof typeof features] === false) {
        return <Navigate to="/dashboard" replace />;
      }
    }
  }

  const needsSetup = role === 'owner'
    && profile !== null
    && !(profile as any).empresa
    && location.pathname !== '/workspace-setup';

  if (needsSetup) {
    return <Navigate to="/workspace-setup" replace />;
  }

  return <>{children}</>;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run build`

Expected: CRM build succeeds.

- [ ] **Step 3: Verify in browser**

Run: `npm run dev`

Navigate to the CRM app. All existing routes should still work (since no plans are assigned, `isUnlimited` will be `true` and feature gating is skipped).

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/components/layout/ProtectedRoute.tsx
git commit -m "feat(admin): add feature flag route gating to CRM ProtectedRoute"
```

---

## Task 16: Final Build Verification

**Files:** None (verification only)

- [ ] **Step 1: Full build check**

Run: `npm run build && npm run build:hub && npm run build:admin`

Expected: All three apps build successfully with no type errors.

- [ ] **Step 2: Verify dist output**

Run: `ls -la dist/ dist/hub/ dist/admin/`

Expected: All three output directories exist with `index.html` and assets.

- [ ] **Step 3: Run tests**

Run: `npm run test`

Expected: All existing tests pass. No regressions.

- [ ] **Step 4: Final commit (if any uncommitted changes)**

```bash
git status
```

If there are uncommitted changes, stage and commit them.

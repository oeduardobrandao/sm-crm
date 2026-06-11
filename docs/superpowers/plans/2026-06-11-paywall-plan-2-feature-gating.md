# Paywall Plan 2 — Feature Gating

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hard-enforce per-plan *feature* access server-side (DB feature triggers + edge-function guards + cron filter), gate the UI cleanly, and retire the legacy portal.

**Architecture:** A boolean SQL resolver `effective_plan_feature(ws_id, feature_key)` (twin of Plan 1's `effective_plan_limit`) feeds: (a) a generic `enforce_plan_feature()` trigger blocking *new* premium objects, (b) a shared TS `assertPlanFeature()` (from extracted `_shared/entitlements.ts`) guarding feature endpoints, (c) cron filters. The frontend reuses Plan 1's `mapEntitlementError`/global toast (which already handles `feature_disabled`) and adds a `useEntitlements` hook, a `<FeatureGate>` component, a generalized `ProtectedRoute` with an upgrade-unlock screen, and feature-aware nav. The legacy `portal_tokens` path is removed (access surface only; table DROP deferred).

**Tech Stack:** Postgres/PL-pgSQL, Deno, React + TanStack Query + sonner.

**Depends on:** Plan 1 (resolver pattern, `supabase/tests/entitlements/_helpers.sql` with `et_make_workspace`, `mapEntitlementError`, global mutation `onError`). Uses `$LOCAL_DB` from Plan 1's prerequisites.

**Spec:** `docs/superpowers/specs/2026-06-11-paywall-feature-gating-design.md` (§6.2, §8).

**Scope note:** Large plan. Tasks 1–9 are backend (DB + edge functions + retirement); Task 10 is frontend. Execute in two phases if helpful.

---

## File Structure

- Create: `supabase/migrations/20260611140001_effective_plan_feature.sql`
- Create: `supabase/migrations/20260611140002_enforce_plan_feature_fn.sql`
- Create: `supabase/migrations/20260611140003_feature_triggers.sql`
- Create: `supabase/functions/_shared/entitlements.ts` (+ extend `_shared/entitlements-rpc.ts` from Plan 1 with a feature RPC)
- Create: `supabase/functions/_shared/feature-guard.ts` (path→flag matrix helper for instagram-analytics)
- Create: `supabase/functions/_shared/hub-token.ts`
- Modify: `supabase/functions/workspace-limits/index.ts`, `instagram-analytics/index.ts`, `instagram-publish/index.ts`, `instagram-integration/index.ts`, `report-worker/index.ts`, `instagram-report-generator-v2/index.ts`, `instagram-sync-cron/index.ts`, and the `hub-*` handlers
- Delete: `supabase/functions/portal-data/`, `supabase/functions/portal-approve/`, `apps/crm/src/store/portal.ts`, `apps/crm/src/pages/portal/PortalPage.tsx`
- Create: `apps/crm/src/hooks/useEntitlements.ts`, `apps/crm/src/components/paywall/FeatureGate.tsx`, `apps/crm/src/components/paywall/UpgradeLockedScreen.tsx`
- Modify: `apps/crm/src/components/layout/ProtectedRoute.tsx`, `apps/crm/src/App.tsx` (route removal), `apps/crm/src/pages/clientes/ClientesPage.tsx`, `apps/crm/src/pages/leads/LeadsPage.tsx` (+ other create entry points)

---

## Task 1: `effective_plan_feature` SQL resolver

**Files:**
- Create: `supabase/migrations/20260611140001_effective_plan_feature.sql`
- Create: `supabase/tests/entitlements/10_effective_plan_feature.sql`

- [ ] **Step 1: Write the failing assertion**

Create `supabase/tests/entitlements/10_effective_plan_feature.sql`:

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql
begin;
do $$
declare v_ws uuid;
begin
  -- free.feature_leads = false (per seeded catalog)
  v_ws := et_make_workspace('free');
  assert effective_plan_feature(v_ws, 'feature_leads') = false, 'free should not have leads';
  -- pro.feature_leads = true
  v_ws := et_make_workspace('pro');
  assert effective_plan_feature(v_ws, 'feature_leads') = true, 'pro should have leads';
  -- feature_overrides flips it on for a free ws
  insert into workspaces (id, name, plan_id, plan_source) values (gen_random_uuid(), 'x', 'free', 'manual');
  v_ws := (select id from workspaces order by created_at desc limit 1);
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_leads": true}'::jsonb);
  assert effective_plan_feature(v_ws, 'feature_leads') = true, 'override should enable leads';
  -- fail-closed: unknown workspace
  assert effective_plan_feature('00000000-0000-0000-0000-000000000000', 'feature_leads') = false,
    'unknown ws fails closed';
  raise notice 'PASS 10_effective_plan_feature';
end $$;
rollback;
```

- [ ] **Step 2: Run to verify it fails**

Run: `psql "$LOCAL_DB" -f supabase/tests/entitlements/10_effective_plan_feature.sql`
Expected: ERROR — `function effective_plan_feature(uuid, text) does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260611140001_effective_plan_feature.sql`:

```sql
-- Effective per-workspace feature flag: plan boolean, overridden by feature_overrides.
-- Fail-closed (false) on invalid setup.
create or replace function effective_plan_feature(ws_id uuid, feature_key text)
returns boolean
language plpgsql
security definer
stable
as $$
declare
  v_plan_id text;
  v_override jsonb;
  v_val boolean;
begin
  select plan_id into v_plan_id from workspaces where id = ws_id;
  if not found then return false; end if;

  if v_plan_id is null then
    select id into v_plan_id from plans where is_default limit 1;
    if v_plan_id is null then return false; end if;
  end if;

  select feature_overrides into v_override
    from workspace_plan_overrides where workspace_id = ws_id;
  if v_override is not null and v_override ? feature_key then
    return (v_override ->> feature_key)::boolean;
  end if;

  execute format('select %I from plans where id = $1', feature_key)
    into v_val using v_plan_id;
  if not found then return false; end if;

  return coalesce(v_val, false);
end;
$$;
```

- [ ] **Step 4: Reset + verify pass**

Run: `npx supabase db reset && psql "$LOCAL_DB" -f supabase/tests/entitlements/10_effective_plan_feature.sql`
Expected: `NOTICE: PASS 10_effective_plan_feature`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260611140001_effective_plan_feature.sql supabase/tests/entitlements/10_effective_plan_feature.sql
git commit -m "feat(paywall): effective_plan_feature resolver"
```

---

## Task 2: `enforce_plan_feature()` trigger + 7 write-feature triggers

**Files:**
- Create: `supabase/migrations/20260611140002_enforce_plan_feature_fn.sql`
- Create: `supabase/migrations/20260611140003_feature_triggers.sql`
- Create: `supabase/tests/entitlements/11_feature_triggers.sql`

- [ ] **Step 1: Write the failing assertion (ideias blocked on free)**

Create `supabase/tests/entitlements/11_feature_triggers.sql`:

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql
begin;
do $$
declare v_ws uuid; v_uid uuid := gen_random_uuid(); v_blocked boolean := false;
begin
  -- free.feature_ideas = false; ideias uses workspace_id
  v_ws := et_make_workspace('free');
  begin
    insert into ideias (workspace_id, user_id, titulo) values (v_ws, v_uid, 'I1');
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'feature_disabled:feature_ideas%', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'ideias insert must block when feature off';

  -- pro.feature_ideas = true => allowed
  v_ws := et_make_workspace('pro');
  insert into ideias (workspace_id, user_id, titulo) values (v_ws, v_uid, 'OK');
  raise notice 'PASS 11_feature_triggers';
end $$;
rollback;
```

(Adjust column lists to each table's `NOT NULL` set per the baseline/feature migrations.)

- [ ] **Step 2: Run to verify it fails**

Run: `psql "$LOCAL_DB" -f supabase/tests/entitlements/11_feature_triggers.sql`
Expected: assertion failure `ideias insert must block when feature off`.

- [ ] **Step 3: Write the generic feature trigger function**

Create `supabase/migrations/20260611140002_enforce_plan_feature_fn.sql`:

```sql
-- Generic BEFORE INSERT [OR UPDATE] feature gate. TG_ARGV:
--   [0] feature_key   e.g. 'feature_ideas'
--   [1] ws_mode       'direct' | 'via_clientes'
--   [2] ws_column     workspace-id column on NEW (direct) or clientes FK (via_clientes)
create or replace function enforce_plan_feature()
returns trigger
language plpgsql
security definer
as $$
declare
  v_feature_key text := TG_ARGV[0];
  v_ws_mode     text := TG_ARGV[1];
  v_ws_col      text := TG_ARGV[2];
  v_ws_id       uuid;
begin
  if v_ws_mode = 'via_clientes' then
    execute format('select conta_id from clientes where id = ($1).%I', v_ws_col)
      using NEW into v_ws_id;
  else
    execute format('select (($1).%I)::uuid', v_ws_col) using NEW into v_ws_id;
  end if;
  if v_ws_id is null then
    return NEW; -- cannot resolve; defer
  end if;

  if not effective_plan_feature(v_ws_id, v_feature_key) then
    raise exception 'feature_disabled:%', v_feature_key using errcode = 'P0001';
  end if;
  return NEW;
end;
$$;
```

- [ ] **Step 4: Attach the 7 triggers**

Create `supabase/migrations/20260611140003_feature_triggers.sql`:

```sql
drop trigger if exists trg_feature_ideias on ideias;
create trigger trg_feature_ideias before insert on ideias
  for each row execute function enforce_plan_feature('feature_ideas', 'direct', 'workspace_id');

drop trigger if exists trg_feature_financial on transacoes;
create trigger trg_feature_financial before insert on transacoes
  for each row execute function enforce_plan_feature('feature_financial', 'direct', 'conta_id');

drop trigger if exists trg_feature_contracts on contratos;
create trigger trg_feature_contracts before insert on contratos
  for each row execute function enforce_plan_feature('feature_contracts', 'direct', 'conta_id');

drop trigger if exists trg_feature_leads on leads;
create trigger trg_feature_leads before insert on leads
  for each row execute function enforce_plan_feature('feature_leads', 'direct', 'conta_id');

drop trigger if exists trg_feature_hub_tokens on client_hub_tokens;
create trigger trg_feature_hub_tokens before insert on client_hub_tokens
  for each row execute function enforce_plan_feature('feature_hub_portal', 'direct', 'conta_id');

drop trigger if exists trg_feature_custom_props on template_property_definitions;
create trigger trg_feature_custom_props before insert on template_property_definitions
  for each row execute function enforce_plan_feature('feature_custom_properties', 'direct', 'conta_id');

-- brand: block edits too (INSERT OR UPDATE); hub_brand is scoped via clientes
drop trigger if exists trg_feature_brand on hub_brand;
create trigger trg_feature_brand before insert or update on hub_brand
  for each row execute function enforce_plan_feature('feature_brand_customization', 'via_clientes', 'cliente_id');
```

Note: `leads` and `client_hub_tokens` and `template_property_definitions` also have Plan 1 count triggers — both fire; feature first conceptually, but order is unspecified and both raise `P0001` cleanly.

- [ ] **Step 5: Reset + verify pass**

Run: `npx supabase db reset && psql "$LOCAL_DB" -f supabase/tests/entitlements/11_feature_triggers.sql`
Expected: `NOTICE: PASS 11_feature_triggers`.

- [ ] **Step 6: Add brand INSERT-OR-UPDATE + leads regression**

Append to `supabase/tests/entitlements/11_feature_triggers.sql`:

```sql
begin;
do $$
declare v_ws uuid; v_uid uuid := gen_random_uuid(); v_cli bigint; v_blocked boolean := false;
begin
  -- brand update blocked on free (feature_brand_customization=false), scoped via clientes
  v_ws := et_make_workspace('free');
  insert into clientes (user_id, conta_id, nome) values (v_uid, v_ws, 'C') returning id into v_cli;
  begin
    insert into hub_brand (cliente_id) values (v_cli);
  exception when sqlstate 'P0001' then v_blocked := true; end;
  assert v_blocked, 'brand insert must block on free';
  raise notice 'PASS 11 brand';
end $$;
rollback;
```

Run: `psql "$LOCAL_DB" -f supabase/tests/entitlements/11_feature_triggers.sql`
Expected: both `PASS` notices.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260611140002_enforce_plan_feature_fn.sql supabase/migrations/20260611140003_feature_triggers.sql supabase/tests/entitlements/11_feature_triggers.sql
git commit -m "feat(paywall): enforce_plan_feature trigger + 7 write-feature triggers"
```

---

## Task 3: Shared TS entitlements module + `assertPlanFeature`

**Files:**
- Create: `supabase/functions/_shared/entitlements.ts`
- Modify: `supabase/functions/workspace-limits/index.ts`
- Create: `supabase/functions/__tests__/entitlements-shared_test.ts`

- [ ] **Step 1: Write the failing Deno test**

Create `supabase/functions/__tests__/entitlements-shared_test.ts` (mirror the mock-DB pattern in `file-upload-url_test.ts`):

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mergeEntitlements } from "../_shared/entitlements.ts";

Deno.test("mergeEntitlements: overrides win over plan", () => {
  const plan = { name: "Free", max_clients: 2, feature_leads: false };
  const out = mergeEntitlements(plan as never,
    { max_clients: 50 }, { feature_leads: true });
  assertEquals(out.limits.max_clients, 50);
  assertEquals(out.features.feature_leads, true);
  assertEquals(out.planName, "Free");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test --no-check --allow-env --allow-read --allow-net supabase/functions/__tests__/entitlements-shared_test.ts`
Expected: FAIL — cannot find `../_shared/entitlements.ts`.

- [ ] **Step 3: Implement the shared module (extracted from workspace-limits)**

Create `supabase/functions/_shared/entitlements.ts` (move the column lists + extract/merge logic verbatim from `workspace-limits/index.ts:7-44,85-131`):

```ts
import { SupabaseClient } from "npm:@supabase/supabase-js@2";

export const RESOURCE_COLUMNS = [
  "max_clients", "max_team_members", "max_workflow_templates",
  "max_active_workflows_per_client", "max_instagram_accounts", "max_leads",
  "max_hub_tokens", "storage_quota_bytes", "max_custom_properties_per_template",
  "max_posts_per_workflow", "max_workspaces_per_user",
] as const;
export const RATE_COLUMNS = [
  "rate_instagram_syncs_per_day", "rate_ai_analyses_per_month",
  "rate_report_generations_per_month",
] as const;
export const FEATURE_COLUMNS = [
  "feature_instagram", "feature_instagram_ai", "feature_analytics_reports",
  "feature_best_times", "feature_audience_demographics", "feature_hub_portal",
  "feature_leads", "feature_financial", "feature_contracts", "feature_ideas",
  "feature_workflow_gantt", "feature_workflow_recurrence", "feature_csv_import",
  "feature_custom_properties", "feature_post_scheduling", "feature_auto_sync_cron",
  "feature_post_tagging", "feature_brand_customization",
] as const;

type PlanRow = Record<string, unknown>;
export interface Entitlements {
  planName: string | null;
  limits: Record<string, number | null>;
  features: Record<string, boolean>;
}

export function mergeEntitlements(
  plan: PlanRow,
  resourceOverrides: Record<string, number> | null,
  featureOverrides: Record<string, boolean> | null,
): Entitlements {
  const limits: Record<string, number | null> = {};
  for (const col of [...RESOURCE_COLUMNS, ...RATE_COLUMNS]) {
    limits[col] = (plan[col] as number | null) ?? null;
  }
  const features: Record<string, boolean> = {};
  for (const col of FEATURE_COLUMNS) {
    features[col] = (plan[col] as boolean) ?? false;
  }
  return {
    planName: (plan.name as string) ?? null,
    limits: { ...limits, ...(resourceOverrides ?? {}) },
    features: { ...features, ...(featureOverrides ?? {}) },
  };
}

/** Resolves a workspace's effective entitlements (plan + overrides). null plan => all-null. */
export async function resolveEntitlements(
  svc: SupabaseClient, workspaceId: string,
): Promise<Entitlements | null> {
  const { data: ws } = await svc.from("workspaces").select("plan_id").eq("id", workspaceId).single();
  const { data: override } = await svc.from("workspace_plan_overrides")
    .select("resource_overrides, feature_overrides").eq("workspace_id", workspaceId).maybeSingle();
  let plan: PlanRow | null = null;
  if (ws?.plan_id) {
    const { data } = await svc.from("plans").select("*").eq("id", ws.plan_id).single();
    plan = data;
  } else {
    const { data } = await svc.from("plans").select("*").eq("is_default", true).maybeSingle();
    plan = data;
  }
  if (!plan) return null;
  return mergeEntitlements(plan, override?.resource_overrides ?? null, override?.feature_overrides ?? null);
}

export class FeatureDisabledError extends Error {
  constructor(public feature: string) { super(`feature_disabled:${feature}`); }
}

/** Throws FeatureDisabledError if the workspace's effective plan lacks `flag`. */
export async function assertPlanFeature(
  svc: SupabaseClient, workspaceId: string, flag: string,
): Promise<void> {
  const ent = await resolveEntitlements(svc, workspaceId);
  if (!ent || ent.features[flag] !== true) throw new FeatureDisabledError(flag);
}

/** Standard 403 JSON body for a disabled feature. */
export function featureDisabledResponse(flag: string, headers: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: "feature_disabled", feature: flag }),
    { status: 403, headers });
}
```

- [ ] **Step 4: Refactor `workspace-limits` to use the shared module**

In `supabase/functions/workspace-limits/index.ts`, replace the inline column lists + `extractLimits`/`extractFeatures` + the resolution block (lines 7-44, 85-131) with a call to `resolveEntitlements`:

```ts
import { resolveEntitlements } from "../_shared/entitlements.ts";
// ...after resolving workspaceId = profile.conta_id:
const ent = await resolveEntitlements(svc, workspaceId);
if (!ent) {
  return new Response(JSON.stringify({ plan_name: null, limits: null, features: null }),
    { status: 200, headers });
}
return new Response(JSON.stringify({
  plan_name: ent.planName, limits: ent.limits, features: ent.features,
}), { status: 200, headers });
```

- [ ] **Step 5: Run the shared test + existing workspace-limits tests**

Run: `deno test --no-check --allow-env --allow-read --allow-net supabase/functions/__tests__/entitlements-shared_test.ts`
Expected: PASS. Then run any existing `workspace-limits` test if present; behavior unchanged.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/entitlements.ts supabase/functions/workspace-limits/index.ts supabase/functions/__tests__/entitlements-shared_test.ts
git commit -m "feat(paywall): shared entitlements module + assertPlanFeature; refactor workspace-limits"
```

---

## Task 4: instagram-analytics path→flag guards

**Files:**
- Create: `supabase/functions/_shared/feature-guard.ts`
- Modify: `supabase/functions/instagram-analytics/index.ts`
- Create: `supabase/functions/__tests__/ia-feature-matrix_test.ts`

- [ ] **Step 1: Write the failing test for the matrix resolver**

Create `supabase/functions/__tests__/ia-feature-matrix_test.ts`:

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { featureForPath } from "../_shared/feature-guard.ts";

Deno.test("featureForPath maps IA routes to flags", () => {
  assertEquals(featureForPath("GET", "/demographics/12"), "feature_audience_demographics");
  assertEquals(featureForPath("GET", "/best-times/12"), "feature_best_times");
  assertEquals(featureForPath("POST", "/ai-analysis/12"), "feature_instagram_ai");
  assertEquals(featureForPath("POST", "/ai-analysis-portfolio"), "feature_instagram_ai");
  assertEquals(featureForPath("POST", "/generate-report/12"), "feature_analytics_reports");
  assertEquals(featureForPath("GET", "/reports/12"), "feature_analytics_reports");
  assertEquals(featureForPath("GET", "/report-download/9"), "feature_analytics_reports");
  assertEquals(featureForPath("POST", "/send-report-email"), "feature_analytics_reports");
  assertEquals(featureForPath("POST", "/tags"), "feature_post_tagging");
  assertEquals(featureForPath("DELETE", "/tags/5"), "feature_post_tagging");
  assertEquals(featureForPath("POST", "/posts/abc/tags"), "feature_post_tagging");
  assertEquals(featureForPath("GET", "/overview/12"), "feature_instagram");
  assertEquals(featureForPath("GET", "/portfolio"), "feature_instagram");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test --no-check --allow-env --allow-read --allow-net supabase/functions/__tests__/ia-feature-matrix_test.ts`
Expected: FAIL — cannot find `../_shared/feature-guard.ts`.

- [ ] **Step 3: Implement the matrix resolver**

Create `supabase/functions/_shared/feature-guard.ts`:

```ts
/** Returns the feature flag required for an instagram-analytics path+method, or null if always-allowed. */
export function featureForPath(method: string, path: string): string | null {
  if (/^\/demographics\//.test(path)) return "feature_audience_demographics";
  if (/^\/best-times\//.test(path)) return "feature_best_times";
  if (/^\/ai-analysis(\/|-portfolio$)/.test(path)) return "feature_instagram_ai";
  if (
    /^\/generate-report\//.test(path) || /^\/reports\//.test(path) ||
    /^\/report-download\//.test(path) || path === "/send-report-email"
  ) return "feature_analytics_reports";
  if (/^\/tags(\/|$)/.test(path) || /^\/posts\/[^/]+\/tags/.test(path)) {
    // tag *mutations* are gated; reads are free
    return method === "GET" ? null : "feature_post_tagging";
  }
  // overview / posts-analytics / follower-history / portfolio => base
  return "feature_instagram";
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `deno test --no-check --allow-env --allow-read --allow-net supabase/functions/__tests__/ia-feature-matrix_test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the guard into instagram-analytics**

In `supabase/functions/instagram-analytics/index.ts`, after `contaId` is resolved (line ~224) and `path`/`method` are known (line ~187-188), add before the route branches:

```ts
import { featureForPath } from "../_shared/feature-guard.ts";
import { effectivePlanFeature } from "../_shared/entitlements-rpc.ts"; // added in Step 6
// ...after contaId is validated:
const requiredFlag = featureForPath(req.method, path);
if (requiredFlag && !(await effectivePlanFeature(serviceClient, contaId, requiredFlag))) {
  return json({ error: "feature_disabled", feature: requiredFlag }, 403);
}
```

- [ ] **Step 6: Add the feature RPC helper**

Append to `supabase/functions/_shared/entitlements-rpc.ts` (created in Plan 1):

```ts
export async function effectivePlanFeature(
  svc: SupabaseClient, workspaceId: string, featureKey: string,
): Promise<boolean> {
  const { data, error } = await svc.rpc("effective_plan_feature", {
    ws_id: workspaceId, feature_key: featureKey,
  });
  if (error) throw error;
  return data === true;
}
```

- [ ] **Step 7: Verify + commit**

Run: `deno test --no-check --allow-env --allow-read --allow-net supabase/functions/__tests__/ia-feature-matrix_test.ts`
Expected: PASS. (Manually: a free workspace gets 403 on `/demographics/:id`, 200 on `/overview/:id`.)

```bash
git add supabase/functions/_shared/feature-guard.ts supabase/functions/_shared/entitlements-rpc.ts supabase/functions/instagram-analytics/index.ts supabase/functions/__tests__/ia-feature-matrix_test.ts
git commit -m "feat(paywall): instagram-analytics path-to-flag feature guards"
```

---

## Task 5: instagram-publish & instagram-integration guards

**Files:**
- Modify: `supabase/functions/instagram-publish/index.ts`, `supabase/functions/instagram-integration/index.ts`

- [ ] **Step 1: Guard instagram-integration (connect/sync) with `feature_instagram`**

In `supabase/functions/instagram-integration/index.ts`, immediately after the `verifyClientOwnership` check that resolves `authCallerProfile.conta_id` (~line 129), add:

```ts
import { effectivePlanFeature } from "../_shared/entitlements-rpc.ts";
// ...after ownership check passes:
if (!(await effectivePlanFeature(authServiceClient, authCallerProfile.conta_id, "feature_instagram"))) {
  return new Response(JSON.stringify({ error: "feature_disabled", feature: "feature_instagram" }),
    { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } });
}
```

- [ ] **Step 2: Guard instagram-publish (publishing/scheduling) with `feature_post_scheduling`**

In `supabase/functions/instagram-publish/index.ts`, after its workspace/ownership resolution (the `authCallerProfile.conta_id` check, ~line 127-129), add the same guard with `"feature_post_scheduling"`:

```ts
import { effectivePlanFeature } from "../_shared/entitlements-rpc.ts";
if (!(await effectivePlanFeature(svc, authCallerProfile.conta_id, "feature_post_scheduling"))) {
  return new Response(JSON.stringify({ error: "feature_disabled", feature: "feature_post_scheduling" }),
    { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } });
}
```

(Place after the ownership check, before the action dispatch. Confirm the exact post-resolution line; the `conta_id` variable in scope there is `authCallerProfile.conta_id`.)

- [ ] **Step 3: Typecheck the functions**

Run: `deno check supabase/functions/instagram-publish/index.ts supabase/functions/instagram-integration/index.ts`
Expected: no type errors. (Note: per CLAUDE.md, restore `deno.lock`/`node_modules` with `git checkout deno.lock && npm ci` if deno check perturbs them before any `npm run build`.)

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/instagram-publish/index.ts supabase/functions/instagram-integration/index.ts
git commit -m "feat(paywall): guard instagram connect (feature_instagram) and publish (feature_post_scheduling)"
```

---

## Task 6: report-worker selection filter + generator-v2 guard

**Files:**
- Modify: `supabase/functions/report-worker/index.ts`, `supabase/functions/instagram-report-generator-v2/index.ts`

- [ ] **Step 1: Add `conta_id` to the report-worker candidate select and filter by feature**

In `supabase/functions/report-worker/index.ts`, change the candidate select (line ~54) to include `conta_id`:

```ts
.select("id, status, locked_at, retry_count, conta_id")
```

Then, in the claim loop (after a candidate is chosen, before/right after claiming), skip + mark candidates whose workspace lacks the feature:

```ts
import { effectivePlanFeature } from "../_shared/entitlements-rpc.ts";
// for the chosen `claimed` row (conta_id now present):
if (!(await effectivePlanFeature(supabase, claimed.conta_id as string, "feature_analytics_reports"))) {
  await supabase.from("analytics_reports").update({
    status: "skipped", locked_at: null,
  }).eq("id", claimed.id);
  return json({ processed: false, reason: "feature_disabled" });
}
```

(If `analytics_reports.status` has a CHECK constraint without `'skipped'`, use `'failed'` with a `generation_error` of `'feature_disabled'` instead — verify the status enum in the report migrations.)

- [ ] **Step 2: Guard generator-v2 as defense-in-depth**

In `supabase/functions/instagram-report-generator-v2/index.ts`, after the report row is fetched and `contaId` destructured (~line 326), add:

```ts
import { effectivePlanFeature } from "../_shared/entitlements-rpc.ts";
if (!(await effectivePlanFeature(serviceClient, contaId, "feature_analytics_reports"))) {
  throw new Error("feature_disabled:feature_analytics_reports");
}
```

- [ ] **Step 3: Typecheck + commit**

Run: `deno check supabase/functions/report-worker/index.ts supabase/functions/instagram-report-generator-v2/index.ts`
Expected: no type errors.

```bash
git add supabase/functions/report-worker/index.ts supabase/functions/instagram-report-generator-v2/index.ts
git commit -m "feat(paywall): gate analytics report generation by feature_analytics_reports"
```

---

## Task 7: instagram-sync-cron feature filter

**Files:**
- Modify: `supabase/functions/instagram-sync-cron/index.ts`

- [ ] **Step 1: Join clientes for conta_id and filter by `feature_auto_sync_cron`**

In `supabase/functions/instagram-sync-cron/index.ts`, change the accounts query (~line 291) to include the workspace via the `clientes` relationship, then drop accounts whose workspace lacks the feature:

```ts
const { data: accounts, error } = await supabase
  .from('instagram_accounts')
  .select('id, instagram_user_id, encrypted_access_token, token_expires_at, follower_count, following_count, media_count, clientes!inner(conta_id)')
  .eq('authorization_status', 'active')
  .eq('auto_sync_enabled', true)
  .or(`last_synced_at.is.null,last_synced_at.lt.${sixHoursAgo}`);
if (error) throw error;
if (!accounts?.length) return new Response("No accounts to sync", { status: 200 });

// keep only accounts whose workspace has feature_auto_sync_cron
const wsIds = [...new Set(accounts.map((a: any) => a.clientes.conta_id as string))];
const allowed = new Set<string>();
await Promise.all(wsIds.map(async (ws) => {
  const { data } = await supabase.rpc("effective_plan_feature",
    { ws_id: ws, feature_key: "feature_auto_sync_cron" });
  if (data === true) allowed.add(ws);
}));
const eligible = accounts.filter((a: any) => allowed.has(a.clientes.conta_id));
if (!eligible.length) return new Response("No eligible accounts", { status: 200 });
```

Then iterate `eligible` instead of `accounts` in the sync loop.

- [ ] **Step 2: Typecheck + commit**

Run: `deno check supabase/functions/instagram-sync-cron/index.ts`
Expected: no type errors. (Coordinate with `docs/superpowers/plans/2026-05-25-instagram-sync-cron-perf.md` — the filter must remain compatible with any batching changes there.)

```bash
git add supabase/functions/instagram-sync-cron/index.ts
git commit -m "feat(paywall): instagram-sync-cron skips workspaces lacking feature_auto_sync_cron"
```

---

## Task 8: Shared hub-token resolver + `feature_hub_portal` guard

**Files:**
- Create: `supabase/functions/_shared/hub-token.ts`
- Create: `supabase/functions/__tests__/hub-token_test.ts`
- Modify: every `hub-*` handler that resolves a hub token

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/__tests__/hub-token_test.ts`:

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { hubTokenActive } from "../_shared/hub-token.ts";

Deno.test("hubTokenActive gates on is_active + feature", () => {
  assertEquals(hubTokenActive({ is_active: true }, true), true);
  assertEquals(hubTokenActive({ is_active: true }, false), false); // feature off
  assertEquals(hubTokenActive({ is_active: false }, true), false); // inactive token
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test --no-check --allow-env --allow-read --allow-net supabase/functions/__tests__/hub-token_test.ts`
Expected: FAIL — cannot find `../_shared/hub-token.ts`.

- [ ] **Step 3: Implement the shared resolver**

Create `supabase/functions/_shared/hub-token.ts`:

```ts
import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { effectivePlanFeature } from "./entitlements-rpc.ts";

export interface HubToken { cliente_id: number; conta_id: string; is_active: boolean; }

/** Pure gate: active token AND feature enabled. */
export function hubTokenActive(tok: { is_active: boolean }, featureEnabled: boolean): boolean {
  return tok.is_active === true && featureEnabled === true;
}

/**
 * Resolves a hub token to its workspace and enforces feature_hub_portal.
 * Returns the token row, or null if missing/inactive/feature-disabled.
 */
export async function resolveHubToken(
  db: SupabaseClient, token: string, now: string,
): Promise<HubToken | null> {
  const { data } = await db.from("client_hub_tokens")
    .select("cliente_id, conta_id, is_active")
    .eq("token", token).gt("expires_at", now).maybeSingle();
  if (!data) return null;
  const featureOn = await effectivePlanFeature(db, data.conta_id as string, "feature_hub_portal");
  if (!hubTokenActive(data, featureOn)) return null;
  return data as HubToken;
}
```

- [ ] **Step 4: Route each hub-* handler through `resolveHubToken`**

For each handler that inlines `client_hub_tokens` token lookup (`hub-bootstrap` 38-44, `hub-posts` 39-46, `hub-reports` 32-37, `hub-dashboard` 49-54, `hub-brand` 25-30, `hub-briefing` 13-21, `hub-ideias` 13-20, `hub-pages` 27-32, `hub-approve` 29-34, `hub-edit-suggestion` 67-72, `hub-instagram-feed` 27-32), replace the inline `.from("client_hub_tokens")...maybeSingle()` block with `const hubToken = await resolveHubToken(db, token, deps.now());` and the existing `if (!hubToken) return <not found/403>` guard. `hub-bootstrap` keeps its `conta.hub_enabled` check in addition.

- [ ] **Step 5: Run test + verify**

Run: `deno test --no-check --allow-env --allow-read --allow-net supabase/functions/__tests__/hub-token_test.ts`
Expected: PASS. (Manually: a downgraded workspace's hub token returns 403/not-found from `hub-dashboard`; owner internal CRM access to the same data is unaffected.)

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/hub-token.ts supabase/functions/__tests__/hub-token_test.ts supabase/functions/hub-*/
git commit -m "feat(paywall): shared hub-token resolver enforcing feature_hub_portal"
```

---

## Task 9: Retire the legacy portal

**Files:**
- Delete: `supabase/functions/portal-data/`, `supabase/functions/portal-approve/`, `apps/crm/src/store/portal.ts`, `apps/crm/src/pages/portal/PortalPage.tsx`
- Modify: `apps/crm/src/App.tsx` (remove `/portal/:token` route + `PortalPage` import), `supabase/functions/__tests__/config-audit_test.ts` (remove `portal-data`/`portal-approve` from `REQUIRED_FUNCTIONS`), `apps/crm/src/__tests__/store.workflows.test.ts` (remove portal mocks/cases)

- [ ] **Step 1: Remove the frontend route + page**

In `apps/crm/src/App.tsx`, delete the `const PortalPage = lazy(...)` import (line 19) and the `<Route path="/portal/:token" ... />` route. Delete `apps/crm/src/pages/portal/PortalPage.tsx` and `apps/crm/src/store/portal.ts`. Remove any imports of `store/portal` (check `store/index.ts`).

- [ ] **Step 2: Remove the edge functions + audit entries**

```bash
git rm -r supabase/functions/portal-data supabase/functions/portal-approve
```

In `supabase/functions/__tests__/config-audit_test.ts`, remove `"portal-data"` and `"portal-approve"` from the `REQUIRED_FUNCTIONS` list (lines ~56-57).

- [ ] **Step 3: Remove the portal store tests**

In `apps/crm/src/__tests__/store.workflows.test.ts`, delete the test cases and mocks referencing `portal_tokens`/`portal_approvals` (lines ~270-287, 417-451). If a whole describe block is portal-only, remove it.

- [ ] **Step 4: Verify nothing references the removed code**

Run: `grep -rnE "portal-data|portal-approve|store/portal|PortalPage|portal_tokens|portal_approvals" apps/crm/src supabase/functions`
Expected: no matches except possibly the migrations that created the tables (left in place — the table DROP is deferred per spec §12, gated on confirming zero active legacy portals).

- [ ] **Step 5: Typecheck + tests + commit**

Run: `npm run build && npm run test`
Expected: green.

```bash
git add -A
git commit -m "feat(paywall): retire legacy portal_tokens path (functions, route, store, tests)"
```

---

## Task 10: Frontend feature gating (route + section + nav)

**Files:**
- Create: `apps/crm/src/hooks/useEntitlements.ts`, `apps/crm/src/components/paywall/FeatureGate.tsx`, `apps/crm/src/components/paywall/UpgradeLockedScreen.tsx`
- Modify: `apps/crm/src/components/layout/ProtectedRoute.tsx`, `apps/crm/src/components/layout/nav-data.ts`, `apps/crm/src/pages/clientes/ClientesPage.tsx`, `apps/crm/src/pages/leads/LeadsPage.tsx`
- Tests: `apps/crm/src/components/paywall/__tests__/FeatureGate.test.tsx`, `apps/crm/src/components/layout/__tests__/ProtectedRoute.test.tsx` (extend)

- [ ] **Step 1: `useEntitlements` hook (features + at-limit) — failing test**

Create `apps/crm/src/hooks/__tests__/useEntitlements.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { computeAtLimit } from '../useEntitlements';

describe('computeAtLimit', () => {
  it('true when count >= limit', () => {
    expect(computeAtLimit(2, 2)).toBe(true);
    expect(computeAtLimit(1, 2)).toBe(false);
  });
  it('null limit = unlimited => never at limit', () => {
    expect(computeAtLimit(999, null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- useEntitlements`
Expected: FAIL — cannot resolve `../useEntitlements`.

- [ ] **Step 3: Implement the hook**

Create `apps/crm/src/hooks/useEntitlements.ts`:

```ts
import { useWorkspaceLimits } from './useWorkspaceLimits';

export function computeAtLimit(count: number, limit: number | null): boolean {
  if (limit === null) return false; // unlimited
  return count >= limit;
}

/** Thin wrapper over useWorkspaceLimits adding feature + at-limit helpers. */
export function useEntitlements() {
  const { limits, features, planName, isLoading } = useWorkspaceLimits();
  return {
    isLoading,
    planName,
    features,
    limits,
    hasFeature: (flag: string): boolean => features?.[flag as keyof typeof features] !== false,
    isAtLimit: (limitKey: string, count: number): boolean =>
      computeAtLimit(count, (limits?.[limitKey as keyof typeof limits] as number | null) ?? null),
  };
}
```

(Note: `hasFeature` returns `true` while loading / when features is null, to avoid flicker-locking; the server triggers/guards are the real boundary.)

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- useEntitlements`
Expected: PASS.

- [ ] **Step 5: `UpgradeLockedScreen` (role-aware) — implement**

Create `apps/crm/src/components/paywall/UpgradeLockedScreen.tsx`:

```tsx
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Button } from '@/components/ui/button';

export function UpgradeLockedScreen({ featureLabel }: { featureLabel: string }) {
  const navigate = useNavigate();
  const { role } = useAuth();
  const isOwner = role === 'owner';
  return (
    <div className="flex flex-col items-center justify-center h-[60vh] text-center gap-3 p-8">
      <h1 className="text-xl font-bold">{featureLabel} não está no seu plano</h1>
      {isOwner ? (
        <>
          <p className="text-muted">Faça upgrade para desbloquear este recurso.</p>
          <Button onClick={() => navigate('/configuracao/cobranca')}>Fazer upgrade</Button>
        </>
      ) : (
        <p className="text-muted">Fale com o dono do workspace para liberar este recurso.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 6: `<FeatureGate>` component — failing test**

Create `apps/crm/src/components/paywall/__tests__/FeatureGate.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FeatureGate } from '../FeatureGate';

vi.mock('../../../hooks/useEntitlements', () => ({
  useEntitlements: () => ({ hasFeature: (f: string) => f === 'feature_on', isLoading: false }),
}));

describe('FeatureGate', () => {
  it('renders children when feature is on', () => {
    render(<FeatureGate flag="feature_on"><span>inside</span></FeatureGate>);
    expect(screen.getByText('inside')).toBeTruthy();
  });
  it('renders the nudge when feature is off', () => {
    render(<FeatureGate flag="feature_off" label="Leads"><span>inside</span></FeatureGate>);
    expect(screen.queryByText('inside')).toBeNull();
    expect(screen.getByText(/Leads/)).toBeTruthy();
  });
});
```

- [ ] **Step 7: Run to verify it fails, then implement**

Run: `npm run test -- FeatureGate` → FAIL (no module).

Create `apps/crm/src/components/paywall/FeatureGate.tsx`:

```tsx
import { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEntitlements } from '../../hooks/useEntitlements';

/** Renders children only if the feature is enabled; otherwise an inline upgrade nudge. */
export function FeatureGate({ flag, label, children }: { flag: string; label?: string; children: ReactNode }) {
  const { hasFeature, isLoading } = useEntitlements();
  const navigate = useNavigate();
  if (isLoading || hasFeature(flag)) return <>{children}</>;
  return (
    <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
      <p>{label ?? 'Este recurso'} não está disponível no seu plano.</p>
      <button className="mt-2 underline text-primary" onClick={() => navigate('/configuracao/cobranca')}>
        Fazer upgrade
      </button>
    </div>
  );
}
```

Run: `npm run test -- FeatureGate` → PASS.

- [ ] **Step 8: Generalize `ProtectedRoute` (preserve role-gating; show upgrade screen)**

Replace `apps/crm/src/components/layout/ProtectedRoute.tsx`'s `FEATURE_GATED` map and the silent-redirect block (lines 9-13, 38-44) with the full map + an upgrade screen (role-gating at lines 7,34-36 stays unchanged):

```tsx
import { UpgradeLockedScreen } from '@/components/paywall/UpgradeLockedScreen';

const FEATURE_GATED: Record<string, { flag: string; label: string }> = {
  '/analytics': { flag: 'feature_analytics_reports', label: 'Relatórios e Analytics' },
  '/analytics-fluxos': { flag: 'feature_analytics_reports', label: 'Relatórios e Analytics' },
  '/leads': { flag: 'feature_leads', label: 'Leads' },
  '/financeiro': { flag: 'feature_financial', label: 'Financeiro' },
  '/contratos': { flag: 'feature_contracts', label: 'Contratos' },
  '/ideias': { flag: 'feature_ideas', label: 'Ideias' },
  '/post-express': { flag: 'feature_post_scheduling', label: 'Agendamento de Posts' },
};

// ...replace the silent feature-redirect block with:
if (!isUnlimited && features) {
  for (const [path, { flag, label }] of Object.entries(FEATURE_GATED)) {
    if (location.pathname.startsWith(path) && features[flag as keyof typeof features] === false) {
      return <UpgradeLockedScreen featureLabel={label} />;
    }
  }
}
```

(Note: `/leads`, `/financeiro`, `/contratos` are role-gated for agents *before* this block — agents already get redirected, so they never see the upgrade screen for those.)

- [ ] **Step 9: Extend the ProtectedRoute test**

In `apps/crm/src/components/layout/__tests__/ProtectedRoute.test.tsx`, add a case: owner on `/leads` with `feature_leads:false` renders the upgrade screen (text "Leads não está no seu plano"), and is NOT redirected to `/dashboard`.

Run: `npm run test -- ProtectedRoute`
Expected: PASS.

- [ ] **Step 10: Hide unavailable nav items by feature**

In `apps/crm/src/components/layout/nav-data.ts`, extend `getNavGroups(role)` to also accept the features map and filter feature-gated nav items (leads/financeiro/contratos/ideias/analytics/post-express) when the corresponding flag is false. Update the `Sidebar.tsx` call site (line 33) to pass `features` from `useEntitlements()`. Keep the owner-only cobranca filter intact.

```ts
// nav-data.ts — signature change
export function getNavGroups(role: string, features?: Record<string, boolean>): NavGroup[] {
  // ...existing role filtering...
  const NAV_FEATURE: Record<string, string> = {
    leads: 'feature_leads', financeiro: 'feature_financial', contratos: 'feature_contracts',
    ideias: 'feature_ideas', analytics: 'feature_analytics_reports', 'post-express': 'feature_post_scheduling',
  };
  if (features) {
    groups = groups.map((g) => ({
      ...g,
      items: g.items.filter((i) => {
        const flag = NAV_FEATURE[i.id];
        return !flag || features[flag] !== false;
      }),
    }));
  }
  return groups;
}
```

- [ ] **Step 11: Gate CSV import + at-limit disable on create flows**

Apply this pattern at each count-create / CSV entry point. The mutation onError is already handled globally (Plan 1), so this is purely the optimistic disable + CSV `<FeatureGate>`:

**ClientesPage.tsx** — wrap the CSV import button (line ~305) and disable the add button at limit:

```tsx
import { useEntitlements } from '@/hooks/useEntitlements';
import { FeatureGate } from '@/components/paywall/FeatureGate';
// inside the component:
const { isAtLimit } = useEntitlements();
const clientsAtLimit = isAtLimit('max_clients', clientes.length);
// add button (line ~309):
<Button onClick={openAdd} disabled={clientsAtLimit} title={clientsAtLimit ? 'Limite do plano atingido' : undefined}>
  <Plus className="h-4 w-4" style={{ marginRight: '0.5rem' }} /> {t('newClient')}
</Button>
// CSV button (line ~305):
<FeatureGate flag="feature_csv_import" label="Importação CSV">
  <Button variant="outline" onClick={handleCSVImport}>
    <Upload className="h-4 w-4" style={{ marginRight: '0.5rem' }} /> {tc('actions.importCsv')}
  </Button>
</FeatureGate>
```

**LeadsPage.tsx** — identical pattern with `isAtLimit('max_leads', leads.length)` on the add button (line ~413) and `<FeatureGate flag="feature_csv_import">` around the CSV button (line ~409).

Other create entry points get the same `disabled={isAtLimit(<key>, <count>)}` on their add button (the global toast handles the actual error if a race slips through): HubTab "Gerar link" (`max_hub_tokens`, file `pages/cliente-detalhe/HubTab.tsx:137`), workflow templates add (`max_workflow_templates`, `WorkflowModals.tsx:1036`), workflow add (`max_active_workflows_per_client` scoped per client, `WorkflowModals.tsx:443`). For these, count comes from the already-loaded list in each page; if no count is loaded, omit the optimistic disable (the trigger + global toast still enforce).

- [ ] **Step 12: Full suite + commit**

Run: `npm run build && npm run test`
Expected: green.

```bash
git add apps/crm/src
git commit -m "feat(paywall): frontend feature gating (route upgrade screen, FeatureGate, nav, at-limit)"
```

---

## Final verification

- [ ] SQL: `npx supabase db reset && for f in supabase/tests/entitlements/1*.sql; do psql "$LOCAL_DB" -f "$f"; done` → all `PASS`.
- [ ] Deno: `deno test --no-check --allow-env --allow-read --allow-net supabase/functions/__tests__/{entitlements-shared,ia-feature-matrix,hub-token}_test.ts` → green. Restore `git checkout deno.lock && npm ci` afterward if needed.
- [ ] Frontend: `npm run build && npm run test` → green.
- [ ] Manual: free workspace — `/leads` shows the upgrade screen (owner) / is hidden from nav; a free workspace's hub portal stops serving; report generation for a non-entitled workspace is skipped.

## Self-review notes

- **Spec coverage (§6.2, §8):** feature resolver (T1), write-feature triggers incl. leads (T2), shared TS resolver + assertPlanFeature + workspace-limits refactor (T3), IA path matrix (T4), connect/publish guards (T5), report generation gating + worker filter (T6), auto-sync cron filter (T7), hub access guard + shared resolver (T8), legacy-portal retirement (T9), frontend route/section/nav gating + role-vs-plan upgrade screen + CSV + at-limit (T10).
- **Type consistency:** `effective_plan_feature(ws_id, feature_key)` identical across migration (T1), RPC helper `effectivePlanFeature` (T4), and all callers (T5–T8). `assertPlanFeature`/`FeatureDisabledError`/`resolveEntitlements` defined once (T3). `useEntitlements`'s `hasFeature`/`isAtLimit` consumed unchanged by `FeatureGate` (T7) and the pages (T11).
- **Reuses Plan 1:** `mapEntitlementError` already maps `feature_disabled` JSON, and the global mutation `onError` already toasts — so feature-guard 403s surface without new wiring; T10 adds only proactive UI.
- **Pins:** confirm `analytics_reports.status` allows `'skipped'` (else use `'failed'`); confirm the exact post-ownership line in `instagram-publish`/`integration`.

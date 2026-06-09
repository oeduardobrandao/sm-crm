# Stripe Payments — Money-In Loop (Slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a workspace owner pick a paid plan, pay by card via Stripe-hosted Checkout, have their workspace auto-upgraded via webhook, and self-manage the subscription through the Stripe Billing Portal.

**Architecture:** Three Deno edge functions (`billing-checkout`, `billing-portal`, `stripe-webhook`) plus shared Stripe/logic helpers. `workspaces.plan_id` is the single source of truth for the effective plan; the webhook writes it (guarded by `plan_source`), and the existing `workspace-limits` + `resolve_workspace_plan` consumers read it. An owner-only `Plano & Cobrança` page in the CRM drives Checkout/Portal redirects.

**Tech Stack:** Deno edge functions (`npm:stripe@17`, `npm:@supabase/supabase-js@2`), Supabase Postgres + RLS, React 19 + React Router v7 + TanStack Query + sonner (CRM), Vitest + `deno test`.

**Spec:** `docs/superpowers/specs/2026-06-09-stripe-payments-money-in-design.md`

---

## File structure

**Create:**
- `supabase/migrations/20260609120001_billing_workspace_columns.sql` — `workspaces.plan_id`, `workspaces.plan_source`, `workspace_plan_overrides.plan_id` nullable
- `supabase/migrations/20260609120002_resolve_workspace_plan_v2.sql` — rewrite `resolve_workspace_plan`
- `supabase/migrations/20260609120003_workspace_subscriptions.sql` — `workspace_subscriptions` + `stripe_webhook_events` + RLS
- `supabase/functions/_shared/stripe.ts` — Stripe client + crypto provider (env-validated)
- `supabase/functions/_shared/billing-logic.ts` — pure mapping functions (TDD core)
- `supabase/functions/__tests__/billing-logic_test.ts` — unit tests for the above
- `supabase/functions/billing-checkout/index.ts`
- `supabase/functions/billing-portal/index.ts`
- `supabase/functions/stripe-webhook/index.ts`
- `apps/crm/src/services/billing.ts`
- `apps/crm/src/services/__tests__/billing.test.ts`
- `apps/crm/src/pages/configuracao/cobranca/CobrancaPage.tsx`

**Modify:**
- `supabase/functions/platform-admin/index.ts` — stripe fields in create/update; `plan_source='manual'` in set-workspace-plan
- `apps/admin/src/pages/PlansPage.tsx` — stripe fields in form
- `supabase/config.toml` — register the three new functions
- `supabase/functions/__tests__/config-audit_test.ts` — add the three to `REQUIRED_FUNCTIONS`
- `apps/crm/src/App.tsx` — route for `/configuracao/cobranca`
- `apps/crm/src/components/layout/nav-data.ts` — owner-only `cobranca` nav item
- `CLAUDE.md` + `.env.example` — new Stripe env vars

---

## Phase 1 — Database

### Task 1: Migration — workspaces billing columns

**Files:**
- Create: `supabase/migrations/20260609120001_billing_workspace_columns.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Slice 1 billing: consolidate the effective-plan source of truth onto workspaces.plan_id.

-- (A) Ensure workspaces.plan_id exists. It is read/written across the codebase but was
-- created "via dashboard" and never migrated, so fresh/staging DBs lack it.
alter table workspaces
  add column if not exists plan_id text references plans(id) on delete set null;

-- (B) plan_source distinguishes Stripe-owned vs admin-comped plans.
--   system = unmanaged/free (webhook may take ownership on first checkout)
--   stripe = owned by an active Stripe subscription
--   manual = admin comp/enterprise (webhook never overrides plan_id)
alter table workspaces
  add column if not exists plan_source text not null default 'system'
  check (plan_source in ('system', 'stripe', 'manual'));

-- (F) Retire workspace_plan_overrides.plan_id as a source of truth. It is NOT NULL today,
-- which would block override-only rows once plan assignment lives on workspaces.plan_id.
alter table workspace_plan_overrides alter column plan_id drop not null;
comment on column workspace_plan_overrides.plan_id is
  'Deprecated: effective plan now lives in workspaces.plan_id; retained for back-compat, not read.';
```

- [ ] **Step 2: Verify the SQL parses against staging (dry run)**

Run: `npx supabase db push --linked --dry-run`
Expected: the new migration is listed as pending and the diff prints without SQL errors.

> Per project memory, `db push` applies ALL pending migrations — always dry-run first and confirm only this slice's files are pending. Staging ref: `wlyzhyfondykzpsiqsce`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260609120001_billing_workspace_columns.sql
git commit -m "feat(billing): workspaces plan_id + plan_source columns; deprecate overrides.plan_id"
```

---

### Task 2: Migration — rewrite `resolve_workspace_plan`

**Files:**
- Create: `supabase/migrations/20260609120002_resolve_workspace_plan_v2.sql`
- Reference: `supabase/migrations/20260502000001_global_banners.sql:1-13` (original definition)

- [ ] **Step 1: Write the migration**

```sql
-- Make resolve_workspace_plan() read the single source of truth (workspaces.plan_id),
-- so banner targeting and workspace-limits agree. Previously it read
-- workspace_plan_overrides.plan_id, which the Stripe webhook does not write.
create or replace function resolve_workspace_plan(ws_id uuid)
returns text
language sql
security definer
stable
as $$
  select coalesce(
    (select plan_id from workspaces where id = ws_id),
    (select id from plans where is_default = true limit 1)
  );
$$;
```

- [ ] **Step 2: Verify dry run**

Run: `npx supabase db push --linked --dry-run`
Expected: migration listed as pending, no SQL errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260609120002_resolve_workspace_plan_v2.sql
git commit -m "feat(billing): resolve_workspace_plan reads workspaces.plan_id (single source of truth)"
```

---

### Task 3: Migration — `workspace_subscriptions` + `stripe_webhook_events`

**Files:**
- Create: `supabase/migrations/20260609120003_workspace_subscriptions.sql`

- [ ] **Step 1: Write the migration**

```sql
-- (D) Stripe subscription mirror — one row per workspace.
create table workspace_subscriptions (
  workspace_id           uuid primary key references workspaces(id) on delete cascade,
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  status                 text,
  plan_id                text references plans(id),
  billing_interval       text,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  failed_payment_count   int not null default 0,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

alter table workspace_subscriptions enable row level security;

create policy "workspace_subscriptions_service_role" on workspace_subscriptions
  for all to service_role using (true) with check (true);

-- Owner of the workspace may read its subscription row (read-only status display).
create policy "workspace_subscriptions_owner_read" on workspace_subscriptions
  for select to authenticated
  using (
    workspace_id = (select conta_id from profiles where id = auth.uid())
    and (select role from profiles where id = auth.uid()) = 'owner'
  );

-- (E) Webhook idempotency ledger — written only after successful handling.
create table stripe_webhook_events (
  event_id     text primary key,
  type         text,
  processed_at timestamptz not null default now()
);

alter table stripe_webhook_events enable row level security;

create policy "stripe_webhook_events_service_role" on stripe_webhook_events
  for all to service_role using (true) with check (true);
```

- [ ] **Step 2: Verify dry run**

Run: `npx supabase db push --linked --dry-run`
Expected: migration listed as pending, no SQL errors.

- [ ] **Step 3: Apply all three migrations to staging**

Run: `npx supabase db push --linked`
Expected: migrations `20260609120001/2/3` apply successfully. Verify in the Supabase dashboard that `workspaces.plan_source` and the two new tables exist.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260609120003_workspace_subscriptions.sql
git commit -m "feat(billing): workspace_subscriptions + stripe_webhook_events tables with RLS"
```

---

## Phase 2 — Admin: editable Stripe IDs + comp source

### Task 4: platform-admin — accept stripe fields; mark comps `manual`

**Files:**
- Modify: `supabase/functions/platform-admin/index.ts:377-385` (handleCreatePlan), `:413` (handleUpdatePlan), `:482-483` (handleSetWorkspacePlan)

- [ ] **Step 1: Add stripe fields to `handleUpdatePlan`'s allowed scalars**

In `handleUpdatePlan`, change the `allowedScalar` array (currently line 413):

```typescript
  const allowedScalar = [
    "name", "is_default", "price_brl", "price_brl_annual", "sort_order", "is_active",
    "stripe_product_id", "stripe_price_id", "stripe_price_id_annual",
  ];
```

- [ ] **Step 2: Add stripe fields to `handleCreatePlan`'s insert builder**

In `handleCreatePlan`, after the existing `if (rest.is_active !== undefined) insert.is_active = rest.is_active;` line (currently line 385), add:

```typescript
  if (rest.stripe_product_id !== undefined) insert.stripe_product_id = rest.stripe_product_id;
  if (rest.stripe_price_id !== undefined) insert.stripe_price_id = rest.stripe_price_id;
  if (rest.stripe_price_id_annual !== undefined) insert.stripe_price_id_annual = rest.stripe_price_id_annual;
```

- [ ] **Step 3: Mark admin-assigned plans as `manual` in `handleSetWorkspacePlan`**

In `handleSetWorkspacePlan`, the workspaces update (currently lines 482-483) sets only `{ plan_id }`. Change it to also stamp the comp source so the Stripe webhook will not override it:

```typescript
  await svc
    .from("workspaces")
    .update({ plan_id, plan_source: "manual" })
    .eq("id", workspace_id);
```

- [ ] **Step 4: Typecheck the edge function**

Run: `deno check supabase/functions/platform-admin/index.ts`
Expected: no type errors.

> After running any `deno` command, restore the shared lockfile to avoid breaking `npm run build`: `git checkout deno.lock 2>/dev/null || true` then `npm ci` if needed (project memory: Deno/npm node_modules gotcha).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/platform-admin/index.ts
git commit -m "feat(billing): admin can set plan stripe IDs; comps mark plan_source=manual"
```

---

### Task 5: Admin PlansPage — stripe ID form fields

**Files:**
- Modify: `apps/admin/src/pages/PlansPage.tsx:44-51` (FormState), `:53-68` (planToForm), `:70-79` (formToPayload), and the form JSX

- [ ] **Step 1: Add the fields to `FormState`**

Add a `stripe` object to the `FormState` interface (line 44-51):

```typescript
interface FormState {
  name: string;
  resources: Record<string, number | null>;
  features: Record<string, boolean>;
  rates: Record<string, number | null>;
  is_default: boolean;
  is_active: boolean;
  stripe_product_id: string;
  stripe_price_id: string;
  stripe_price_id_annual: string;
}
```

- [ ] **Step 2: Populate them in `planToForm`**

In `planToForm` (line 60-67), add to the returned object:

```typescript
  return {
    name: plan.name,
    resources,
    features,
    rates,
    is_default: plan.is_default,
    is_active: plan.is_active,
    stripe_product_id: plan.stripe_product_id ?? '',
    stripe_price_id: plan.stripe_price_id ?? '',
    stripe_price_id_annual: plan.stripe_price_id_annual ?? '',
  };
```

- [ ] **Step 3: Send them in `formToPayload`**

In `formToPayload` (line 70-79), add the three keys (send `null` when blank so they clear):

```typescript
function formToPayload(form: FormState): Record<string, unknown> {
  return {
    name: form.name,
    is_default: form.is_default,
    is_active: form.is_active,
    stripe_product_id: form.stripe_product_id || null,
    stripe_price_id: form.stripe_price_id || null,
    stripe_price_id_annual: form.stripe_price_id_annual || null,
    ...form.resources,
    ...form.features,
    ...form.rates,
  };
}
```

- [ ] **Step 4: Add the three defaults to the initial `useState` form**

In the `useState<FormState>` initializer (line 85-92), add:

```typescript
    is_default: false,
    is_active: true,
    stripe_product_id: '',
    stripe_price_id: '',
    stripe_price_id_annual: '',
```

- [ ] **Step 5: Add three text inputs to the form JSX**

Find the form's name input in the JSX (search for `value={form.name}`) and add, directly after that input's wrapper:

```tsx
        <label>
          Stripe Product ID
          <input
            type="text"
            value={form.stripe_product_id}
            onChange={(e) => setForm({ ...form, stripe_product_id: e.target.value })}
            placeholder="prod_..."
          />
        </label>
        <label>
          Stripe Price ID (monthly)
          <input
            type="text"
            value={form.stripe_price_id}
            onChange={(e) => setForm({ ...form, stripe_price_id: e.target.value })}
            placeholder="price_..."
          />
        </label>
        <label>
          Stripe Price ID (annual)
          <input
            type="text"
            value={form.stripe_price_id_annual}
            onChange={(e) => setForm({ ...form, stripe_price_id_annual: e.target.value })}
            placeholder="price_..."
          />
        </label>
```

- [ ] **Step 6: Typecheck the admin app**

Run: `npm run build --workspace apps/admin` (or the admin build script in its package.json)
Expected: `tsc` passes with no errors.

> If the admin app has no standalone build script, run `npx tsc --noEmit -p apps/admin/tsconfig.json`.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/pages/PlansPage.tsx
git commit -m "feat(billing): admin PlansPage edits Stripe product/price IDs"
```

---

## Phase 3 — Shared billing logic (TDD core)

### Task 6: Pure mapping functions + tests

**Files:**
- Create: `supabase/functions/_shared/billing-logic.ts`
- Test: `supabase/functions/__tests__/billing-logic_test.ts`
- Reference: `supabase/functions/__tests__/assert.ts` (assert helpers)

- [ ] **Step 1: Write the failing test**

```typescript
import { assert, assertEquals } from "./assert.ts";
import { statusToPlanId, resolvePlanFromPriceId } from "../_shared/billing-logic.ts";

Deno.test("statusToPlanId: active/trialing grant the subscribed plan", () => {
  assertEquals(statusToPlanId("active", "pro", "free"), "pro");
  assertEquals(statusToPlanId("trialing", "starter", "free"), "starter");
});

Deno.test("statusToPlanId: past_due/incomplete leave plan unchanged (null)", () => {
  assertEquals(statusToPlanId("past_due", "pro", "free"), null);
  assertEquals(statusToPlanId("incomplete", "pro", "free"), null);
});

Deno.test("statusToPlanId: terminal statuses downgrade to default", () => {
  for (const s of ["canceled", "unpaid", "incomplete_expired", "paused"]) {
    assertEquals(statusToPlanId(s, "pro", "free"), "free");
  }
});

Deno.test("statusToPlanId: unknown status leaves plan unchanged", () => {
  assertEquals(statusToPlanId("future_status", "pro", "free"), null);
});

Deno.test("resolvePlanFromPriceId: matches monthly and annual prices", () => {
  const plans = [
    { id: "starter", stripe_price_id: "price_s_m", stripe_price_id_annual: "price_s_y" },
    { id: "pro", stripe_price_id: "price_p_m", stripe_price_id_annual: "price_p_y" },
  ];
  assertEquals(resolvePlanFromPriceId("price_p_m", plans), { plan_id: "pro", interval: "month" });
  assertEquals(resolvePlanFromPriceId("price_s_y", plans), { plan_id: "starter", interval: "year" });
  assert(resolvePlanFromPriceId("price_unknown", plans) === null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test supabase/functions/__tests__/billing-logic_test.ts`
Expected: FAIL — `Module not found "../_shared/billing-logic.ts"`.

- [ ] **Step 3: Write the implementation**

```typescript
// Pure helpers for mapping Stripe subscription state to effective plans.
// No Stripe/Supabase/env dependencies — unit-testable in isolation.

/**
 * Maps a Stripe subscription status to the value workspaces.plan_id should take.
 * Returns null to mean "leave plan_id unchanged".
 */
export function statusToPlanId(
  status: string,
  subscribedPlanId: string,
  defaultPlanId: string,
): string | null {
  switch (status) {
    case "active":
    case "trialing":
      return subscribedPlanId;
    case "past_due":
    case "incomplete":
      return null; // grace / not yet paid
    case "canceled":
    case "unpaid":
    case "incomplete_expired":
    case "paused":
      return defaultPlanId;
    default:
      return null;
  }
}

export interface PlanPriceRow {
  id: string;
  stripe_price_id: string | null;
  stripe_price_id_annual: string | null;
}

/** Resolves a Stripe price id to a plan id + billing interval, or null if unknown. */
export function resolvePlanFromPriceId(
  priceId: string,
  plans: PlanPriceRow[],
): { plan_id: string; interval: "month" | "year" } | null {
  for (const p of plans) {
    if (p.stripe_price_id === priceId) return { plan_id: p.id, interval: "month" };
    if (p.stripe_price_id_annual === priceId) return { plan_id: p.id, interval: "year" };
  }
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `deno test supabase/functions/__tests__/billing-logic_test.ts`
Expected: PASS (all 5 tests). Then restore the lockfile: `git checkout deno.lock 2>/dev/null || true`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/billing-logic.ts supabase/functions/__tests__/billing-logic_test.ts
git commit -m "feat(billing): pure status->plan and price->plan mapping helpers (tested)"
```

---

## Phase 4 — Stripe client helper

### Task 7: `_shared/stripe.ts`

**Files:**
- Create: `supabase/functions/_shared/stripe.ts`
- Reference: env-throw pattern `supabase/functions/instagram-analytics/index.ts:6-11`

- [ ] **Step 1: Write the helper**

```typescript
import Stripe from "npm:stripe@17";

const STRIPE_SECRET_KEY =
  Deno.env.get("STRIPE_SECRET_KEY") ??
  (() => {
    throw new Error("STRIPE_SECRET_KEY environment variable is required");
  })();

// Use the fetch-based HTTP client (Deno has no Node http).
export const stripe = new Stripe(STRIPE_SECRET_KEY, {
  httpClient: Stripe.createFetchHttpClient(),
});

// Deno's Web Crypto is async — required by constructEventAsync for webhook verification.
export const cryptoProvider = Stripe.createSubtleCryptoProvider();
```

- [ ] **Step 2: Typecheck**

Run: `deno check supabase/functions/_shared/stripe.ts`
Expected: no type errors (Stripe types resolve via the npm specifier). Restore lockfile afterward: `git checkout deno.lock 2>/dev/null || true`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/stripe.ts
git commit -m "feat(billing): shared Stripe client + crypto provider helper"
```

---

## Phase 5 — Edge functions

### Task 8: `billing-checkout`

**Files:**
- Create: `supabase/functions/billing-checkout/index.ts`
- Reference: auth pattern `supabase/functions/workspace-limits/index.ts:55-89`; CORS `_shared/cors.ts`

- [ ] **Step 1: Write the function**

```typescript
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { stripe } from "../_shared/stripe.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_BASE_URL = Deno.env.get("OAUTH_REDIRECT_BASE") || "http://localhost:5173";

const PAID_PLANS = ["starter", "pro", "scale"];

Deno.serve(async (req: Request) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const headers = { "Content-Type": "application/json", ...corsHeaders };

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401, headers);
    const token = authHeader.replace("Bearer ", "");

    const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: { user }, error: authError } = await svc.auth.getUser(token);
    if (authError || !user) return json({ error: "Unauthorized" }, 401, headers);

    const { data: profile } = await svc
      .from("profiles").select("role, conta_id").eq("id", user.id).single();
    if (!profile?.conta_id) return json({ error: "No workspace" }, 400, headers);
    if (profile.role !== "owner") return json({ error: "Forbidden" }, 403, headers);
    const workspaceId = profile.conta_id as string;

    const body = await req.json().catch(() => ({}));
    const planId = String(body.plan_id || "");
    const interval = body.interval === "year" ? "year" : "month";
    if (!PAID_PLANS.includes(planId)) return json({ error: "Invalid plan" }, 400, headers);

    const { data: plan } = await svc
      .from("plans")
      .select("id, stripe_price_id, stripe_price_id_annual")
      .eq("id", planId).single();
    const priceId = interval === "year" ? plan?.stripe_price_id_annual : plan?.stripe_price_id;
    if (!priceId) return json({ error: "Plan price not configured" }, 400, headers);

    // find-or-create Stripe customer for this workspace
    const { data: subRow } = await svc
      .from("workspace_subscriptions")
      .select("stripe_customer_id").eq("workspace_id", workspaceId).maybeSingle();

    let customerId = subRow?.stripe_customer_id as string | undefined;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { workspace_id: workspaceId },
      });
      customerId = customer.id;
      await svc.from("workspace_subscriptions").upsert(
        { workspace_id: workspaceId, stripe_customer_id: customerId },
        { onConflict: "workspace_id" },
      );
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: workspaceId,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { metadata: { workspace_id: workspaceId, plan_id: planId } },
      success_url: `${APP_BASE_URL}/configuracao/cobranca?status=success`,
      cancel_url: `${APP_BASE_URL}/configuracao/cobranca?status=cancelled`,
    });

    return json({ url: session.url }, 200, headers);
  } catch (err) {
    console.error("[billing-checkout] error:", err);
    return json({ error: "Internal server error" }, 500, headers);
  }
});

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers });
}
```

- [ ] **Step 2: Typecheck**

Run: `deno check supabase/functions/billing-checkout/index.ts`
Expected: no type errors. Restore lockfile afterward.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/billing-checkout/index.ts
git commit -m "feat(billing): billing-checkout edge function (owner-only Stripe Checkout)"
```

---

### Task 9: `billing-portal`

**Files:**
- Create: `supabase/functions/billing-portal/index.ts`

- [ ] **Step 1: Write the function**

```typescript
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { stripe } from "../_shared/stripe.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_BASE_URL = Deno.env.get("OAUTH_REDIRECT_BASE") || "http://localhost:5173";

Deno.serve(async (req: Request) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const headers = { "Content-Type": "application/json", ...corsHeaders };

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401, headers);
    const token = authHeader.replace("Bearer ", "");

    const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: { user }, error: authError } = await svc.auth.getUser(token);
    if (authError || !user) return json({ error: "Unauthorized" }, 401, headers);

    const { data: profile } = await svc
      .from("profiles").select("role, conta_id").eq("id", user.id).single();
    if (!profile?.conta_id) return json({ error: "No workspace" }, 400, headers);
    if (profile.role !== "owner") return json({ error: "Forbidden" }, 403, headers);

    const { data: subRow } = await svc
      .from("workspace_subscriptions")
      .select("stripe_customer_id").eq("workspace_id", profile.conta_id).maybeSingle();
    if (!subRow?.stripe_customer_id) return json({ error: "No subscription" }, 400, headers);

    const portal = await stripe.billingPortal.sessions.create({
      customer: subRow.stripe_customer_id,
      return_url: `${APP_BASE_URL}/configuracao/cobranca`,
    });

    return json({ url: portal.url }, 200, headers);
  } catch (err) {
    console.error("[billing-portal] error:", err);
    return json({ error: "Internal server error" }, 500, headers);
  }
});

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers });
}
```

- [ ] **Step 2: Typecheck**

Run: `deno check supabase/functions/billing-portal/index.ts`
Expected: no type errors. Restore lockfile afterward.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/billing-portal/index.ts
git commit -m "feat(billing): billing-portal edge function (owner-only Stripe Billing Portal)"
```

---

### Task 10: `stripe-webhook`

**Files:**
- Create: `supabase/functions/stripe-webhook/index.ts`
- Reference: `_shared/billing-logic.ts` (Task 6), `_shared/stripe.ts` (Task 7)

- [ ] **Step 1: Write the function**

```typescript
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";
import { stripe, cryptoProvider } from "../_shared/stripe.ts";
import {
  resolvePlanFromPriceId,
  statusToPlanId,
  type PlanPriceRow,
} from "../_shared/billing-logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_WEBHOOK_SECRET =
  Deno.env.get("STRIPE_WEBHOOK_SECRET") ??
  (() => {
    throw new Error("STRIPE_WEBHOOK_SECRET environment variable is required");
  })();

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const sig = req.headers.get("stripe-signature");
  if (!sig) return new Response("Missing signature", { status: 400 });

  const bodyText = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      bodyText, sig, STRIPE_WEBHOOK_SECRET, undefined, cryptoProvider,
    );
  } catch (err) {
    console.error("[stripe-webhook] signature verification failed:", (err as Error).message);
    return new Response("Invalid signature", { status: 400 });
  }

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Dedup: short-circuit known events. Handlers are also idempotent, so this is best-effort.
  const { data: existing } = await svc
    .from("stripe_webhook_events").select("event_id").eq("event_id", event.id).maybeSingle();
  if (existing) return new Response(JSON.stringify({ received: true, duplicate: true }), { status: 200 });

  try {
    await handleEvent(svc, event);
  } catch (err) {
    // Do NOT record the event — return 5xx so Stripe redelivers.
    console.error(`[stripe-webhook] handler error for ${event.type}:`, err);
    return new Response("Handler error", { status: 500 });
  }

  await svc.from("stripe_webhook_events").insert({ event_id: event.id, type: event.type });
  return new Response(JSON.stringify({ received: true }), { status: 200 });
});

async function handleEvent(svc: SupabaseClient, event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (!session.subscription) return;
      const subId = typeof session.subscription === "string"
        ? session.subscription : session.subscription.id;
      const sub = await stripe.subscriptions.retrieve(subId);
      await syncSubscription(svc, sub, session);
      break;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      await syncSubscription(svc, event.data.object as Stripe.Subscription, null);
      break;
    }
    case "invoice.payment_failed": {
      await handlePaymentFailed(svc, event.data.object as Stripe.Invoice);
      break;
    }
    default:
      break;
  }
}

async function syncSubscription(
  svc: SupabaseClient,
  sub: Stripe.Subscription,
  session: Stripe.Checkout.Session | null,
) {
  const workspaceId = await resolveWorkspaceId(svc, sub, session);
  if (!workspaceId) throw new Error(`Could not resolve workspace for subscription ${sub.id}`);

  const priceId = sub.items?.data?.[0]?.price?.id ?? null;
  const plans = await loadPlanPriceRows(svc);
  const resolved = priceId ? resolvePlanFromPriceId(priceId, plans) : null;
  const defaultPlanId = await getDefaultPlanId(svc);
  const subscribedPlanId = resolved?.plan_id ?? defaultPlanId;
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;

  await svc.from("workspace_subscriptions").upsert({
    workspace_id: workspaceId,
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    status: sub.status,
    plan_id: resolved?.plan_id ?? null,
    billing_interval: resolved?.interval ?? null,
    current_period_end: sub.current_period_end
      ? new Date(sub.current_period_end * 1000).toISOString() : null,
    cancel_at_period_end: sub.cancel_at_period_end ?? false,
    updated_at: new Date().toISOString(),
  }, { onConflict: "workspace_id" });

  const targetPlanId = statusToPlanId(sub.status, subscribedPlanId, defaultPlanId);
  if (targetPlanId !== null) {
    await writeWorkspacePlan(svc, workspaceId, targetPlanId);
  }
}

async function handlePaymentFailed(svc: SupabaseClient, invoice: Stripe.Invoice) {
  const customerId = typeof invoice.customer === "string"
    ? invoice.customer : invoice.customer?.id;
  if (!customerId) return;
  const { data: row } = await svc
    .from("workspace_subscriptions").select("workspace_id")
    .eq("stripe_customer_id", customerId).maybeSingle();
  if (!row?.workspace_id) throw new Error(`No workspace for failed-invoice customer ${customerId}`);
  // Idempotent: assign Stripe's authoritative attempt counter, never increment.
  await svc.from("workspace_subscriptions").update({
    status: "past_due",
    failed_payment_count: invoice.attempt_count ?? 0,
    updated_at: new Date().toISOString(),
  }).eq("workspace_id", row.workspace_id);
}

/** Effective-plan write, guarded so admin comps (plan_source='manual') are never overridden. */
async function writeWorkspacePlan(svc: SupabaseClient, workspaceId: string, planId: string) {
  const { data: ws } = await svc
    .from("workspaces").select("plan_source").eq("id", workspaceId).single();
  if (ws?.plan_source === "manual") return;
  await svc.from("workspaces")
    .update({ plan_id: planId, plan_source: "stripe" }).eq("id", workspaceId);
}

async function resolveWorkspaceId(
  svc: SupabaseClient,
  sub: Stripe.Subscription,
  session: Stripe.Checkout.Session | null,
): Promise<string | null> {
  if (sub.metadata?.workspace_id) return sub.metadata.workspace_id;
  if (session?.client_reference_id) return session.client_reference_id;
  if (session?.metadata?.workspace_id) return session.metadata.workspace_id;

  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  if (customerId) {
    const customer = await stripe.customers.retrieve(customerId);
    if (!customer.deleted && customer.metadata?.workspace_id) {
      return customer.metadata.workspace_id;
    }
    const { data } = await svc
      .from("workspace_subscriptions").select("workspace_id")
      .eq("stripe_customer_id", customerId).maybeSingle();
    if (data?.workspace_id) return data.workspace_id;
  }
  return null;
}

async function loadPlanPriceRows(svc: SupabaseClient): Promise<PlanPriceRow[]> {
  const { data } = await svc.from("plans")
    .select("id, stripe_price_id, stripe_price_id_annual");
  return (data ?? []) as PlanPriceRow[];
}

async function getDefaultPlanId(svc: SupabaseClient): Promise<string> {
  const { data } = await svc.from("plans").select("id").eq("is_default", true).maybeSingle();
  return (data?.id as string) ?? "free";
}
```

- [ ] **Step 2: Typecheck**

Run: `deno check supabase/functions/stripe-webhook/index.ts`
Expected: no type errors. Restore lockfile afterward: `git checkout deno.lock 2>/dev/null || true`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/stripe-webhook/index.ts
git commit -m "feat(billing): stripe-webhook edge function (subscription sync + idempotent dedup)"
```

---

### Task 11: Register the three functions in `config.toml` + audit test

**Files:**
- Modify: `supabase/functions/__tests__/config-audit_test.ts:20-59` (REQUIRED_FUNCTIONS)
- Modify: `supabase/config.toml`

- [ ] **Step 1: Add the three names to `REQUIRED_FUNCTIONS` (failing test first)**

In `config-audit_test.ts`, add to the `REQUIRED_FUNCTIONS` array (after `"sign-r2-urls",` on line 58):

```typescript
  // Billing (manual auth: user-JWT or Stripe signature)
  "billing-checkout",
  "billing-portal",
  "stripe-webhook",
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test supabase/functions/__tests__/config-audit_test.ts`
Expected: FAIL — `Functions missing verify_jwt = false: billing-checkout, billing-portal, stripe-webhook`.

- [ ] **Step 3: Add the blocks to `config.toml`**

Append to `supabase/config.toml`:

```toml
[functions.billing-checkout]
verify_jwt = false

[functions.billing-portal]
verify_jwt = false

[functions.stripe-webhook]
verify_jwt = false
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `deno test supabase/functions/__tests__/config-audit_test.ts`
Expected: PASS. Restore lockfile afterward: `git checkout deno.lock 2>/dev/null || true`.

- [ ] **Step 5: Commit**

```bash
git add supabase/config.toml supabase/functions/__tests__/config-audit_test.ts
git commit -m "chore(billing): register billing functions in config.toml (verify_jwt=false)"
```

---

## Phase 6 — CRM frontend

### Task 12: `services/billing.ts` + tests

**Files:**
- Create: `apps/crm/src/services/billing.ts`
- Test: `apps/crm/src/services/__tests__/billing.test.ts`
- Reference: `apps/crm/src/services/instagram.ts:1-30` (auth headers pattern)

- [ ] **Step 1: Write the service**

```typescript
import { supabase } from '../lib/supabase';

export type BillingInterval = 'month' | 'year';

export interface BillingPlan {
  id: string;
  name: string;
  price_brl: number | null;
  price_brl_annual: number | null;
  sort_order: number;
}

export interface WorkspaceSubscription {
  status: string | null;
  plan_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

const FUNCTIONS_BASE = (import.meta.env.VITE_SUPABASE_URL as string) + '/functions/v1';

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Não autenticado');
  return {
    Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  };
}

/** Active plans for the pricing display. plans RLS allows public SELECT. */
export async function listActivePlans(): Promise<BillingPlan[]> {
  const { data, error } = await supabase
    .from('plans')
    .select('id, name, price_brl, price_brl_annual, sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as BillingPlan[];
}

/** Current workspace's subscription row (owner-only via RLS), or null. */
export async function getWorkspaceSubscription(): Promise<WorkspaceSubscription | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles').select('conta_id').eq('id', user.id).single();
  if (!profile?.conta_id) return null;
  const { data, error } = await supabase
    .from('workspace_subscriptions')
    .select('status, plan_id, current_period_end, cancel_at_period_end')
    .eq('workspace_id', profile.conta_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as WorkspaceSubscription) ?? null;
}

/** Starts Stripe Checkout; returns the hosted URL to redirect to. */
export async function startCheckout(planId: string, interval: BillingInterval): Promise<string> {
  const res = await fetch(`${FUNCTIONS_BASE}/billing-checkout`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ plan_id: planId, interval }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data.url as string;
}

/** Opens the Stripe Billing Portal; returns the hosted URL to redirect to. */
export async function openBillingPortal(): Promise<string> {
  const res = await fetch(`${FUNCTIONS_BASE}/billing-portal`, {
    method: 'POST',
    headers: await authHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data.url as string;
}
```

- [ ] **Step 2: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }),
    },
  },
}));

import { startCheckout, openBillingPortal } from '../billing';

describe('billing service', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  });

  it('startCheckout posts plan+interval and returns the url', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://checkout.stripe.com/abc' }),
    });
    const url = await startCheckout('pro', 'year');
    expect(url).toBe('https://checkout.stripe.com/abc');
    const [calledUrl, opts] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(calledUrl).toContain('/functions/v1/billing-checkout');
    expect(JSON.parse(opts.body)).toEqual({ plan_id: 'pro', interval: 'year' });
    expect(opts.headers.Authorization).toBe('Bearer tok');
  });

  it('startCheckout throws the server error message on non-ok', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false, status: 400, json: async () => ({ error: 'Plan price not configured' }),
    });
    await expect(startCheckout('pro', 'month')).rejects.toThrow('Plan price not configured');
  });

  it('openBillingPortal returns the portal url', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, json: async () => ({ url: 'https://billing.stripe.com/xyz' }),
    });
    expect(await openBillingPortal()).toBe('https://billing.stripe.com/xyz');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails, then passes**

Run: `npm test -- billing.test`
Expected: After writing the service (Step 1), the three tests PASS. (If you wrote the test first, it fails on missing module — then Step 1 makes it pass.)

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/services/billing.ts apps/crm/src/services/__tests__/billing.test.ts
git commit -m "feat(billing): CRM billing service (checkout/portal/plans/subscription) + tests"
```

---

### Task 13: `CobrancaPage`

**Files:**
- Create: `apps/crm/src/pages/configuracao/cobranca/CobrancaPage.tsx`
- Reference: role gate `useAuth()` (`context/AuthContext.tsx`); CSS classes `.card`/`.kpi-card`/`.btn-primary`/`.btn-secondary` (style.css)

- [ ] **Step 1: Write the page component**

```tsx
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import {
  listActivePlans,
  getWorkspaceSubscription,
  startCheckout,
  openBillingPortal,
  type BillingInterval,
} from '@/services/billing';

export default function CobrancaPage() {
  const { role } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [interval, setInterval] = useState<BillingInterval>('month');
  const [busy, setBusy] = useState<string | null>(null);

  const { data: plans } = useQuery({
    queryKey: ['billing', 'plans'],
    queryFn: listActivePlans,
    enabled: role === 'owner',
  });
  const { data: subscription, refetch: refetchSub } = useQuery({
    queryKey: ['billing', 'subscription'],
    queryFn: getWorkspaceSubscription,
    enabled: role === 'owner',
  });

  // Handle the Checkout return.
  useEffect(() => {
    const status = searchParams.get('status');
    if (!status) return;
    if (status === 'success') {
      toast.success('Pagamento confirmado! Atualizando seu plano…');
      let tries = 0;
      const id = window.setInterval(() => {
        tries += 1;
        refetchSub();
        if (tries >= 5) window.clearInterval(id);
      }, 2000);
      searchParams.delete('status');
      setSearchParams(searchParams, { replace: true });
      return () => window.clearInterval(id);
    }
    if (status === 'cancelled') {
      toast('Checkout cancelado.');
      searchParams.delete('status');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams, refetchSub]);

  if (role !== 'owner') {
    return (
      <div className="card">
        <h1>Plano &amp; Cobrança</h1>
        <p>Apenas o proprietário da conta pode gerenciar a assinatura.</p>
      </div>
    );
  }

  const hasActiveSub = subscription?.status === 'active' || subscription?.status === 'trialing';

  async function handleUpgrade(planId: string) {
    setBusy(planId);
    try {
      window.location.href = await startCheckout(planId, interval);
    } catch (err) {
      toast.error('Erro ao iniciar checkout: ' + (err as Error).message);
      setBusy(null);
    }
  }

  async function handleManage() {
    setBusy('portal');
    try {
      window.location.href = await openBillingPortal();
    } catch (err) {
      toast.error('Erro ao abrir portal: ' + (err as Error).message);
      setBusy(null);
    }
  }

  return (
    <div>
      <h1>Plano &amp; Cobrança</h1>

      {hasActiveSub && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <p>
            Plano atual: <strong>{subscription?.plan_id ?? '—'}</strong>
            {subscription?.cancel_at_period_end ? ' (cancela no fim do ciclo)' : ''}
          </p>
          <button className="btn-secondary" onClick={handleManage} disabled={busy === 'portal'}>
            {busy === 'portal' ? 'Aguarde…' : 'Gerenciar assinatura'}
          </button>
        </div>
      )}

      <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem' }}>
        <button
          className={interval === 'month' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setInterval('month')}
        >
          Mensal
        </button>
        <button
          className={interval === 'year' ? 'btn-primary' : 'btn-secondary'}
          onClick={() => setInterval('year')}
        >
          Anual
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gap: '1.5rem',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        }}
      >
        {(plans ?? []).map((p) => {
          const price = interval === 'year' ? p.price_brl_annual : p.price_brl;
          const isCurrent = subscription?.plan_id === p.id && hasActiveSub;
          const isFree = p.id === 'free';
          return (
            <div key={p.id} className="kpi-card">
              <h3>{p.name}</h3>
              <p>
                {price != null && price > 0
                  ? `R$ ${price}${interval === 'year' ? '/ano' : '/mês'}`
                  : 'Grátis'}
              </p>
              {isFree ? (
                <span>Plano gratuito</span>
              ) : isCurrent ? (
                <span>Plano atual</span>
              ) : (
                <button
                  className="btn-primary"
                  onClick={() => handleUpgrade(p.id)}
                  disabled={busy === p.id}
                >
                  {busy === p.id ? 'Aguarde…' : 'Fazer upgrade'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck (build)**

Run: `npm run build`
Expected: `tsc` passes. (The route wiring in Task 14 must exist for the lazy import to resolve, but the component itself typechecks standalone.)

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/pages/configuracao/cobranca/CobrancaPage.tsx
git commit -m "feat(billing): owner-only Plano & Cobrança page"
```

---

### Task 14: Route + owner-only nav entry

**Files:**
- Modify: `apps/crm/src/App.tsx:32` (lazy imports), `:110` (routes)
- Modify: `apps/crm/src/components/layout/nav-data.ts:160-176` (config group), `:181-189` (getNavGroups)

- [ ] **Step 1: Add the lazy import in App.tsx**

After line 32 (`const ConfiguracaoPage = lazy(...)`), add:

```typescript
const CobrancaPage = lazy(() => import('./pages/configuracao/cobranca/CobrancaPage'));
```

- [ ] **Step 2: Add the route in App.tsx**

After the `/configuracao` route (line 110), add:

```tsx
                <Route path="/configuracao/cobranca" element={<CobrancaPage />} />
```

- [ ] **Step 3: Add the nav item to the `config` group in nav-data.ts**

In the `config` group's `items` array (after the `configuracao` item, before `politica-de-privacidade`), add:

```typescript
      {
        id: 'cobranca',
        route: '/configuracao/cobranca',
        label: 'Plano & Cobrança',
        labelKey: 'nav.cobranca',
        icon: 'ph-credit-card',
      },
```

(The Sidebar renders `t(item.labelKey, item.label)`, so the literal `label` shows even without a translation entry.)

- [ ] **Step 4: Gate the nav item to owners in getNavGroups**

Replace the body of `getNavGroups` (lines 181-189) with:

```typescript
export function getNavGroups(role: string): NavGroup[] {
  let groups = ALL_NAV_GROUPS;

  // Billing is owner-only.
  if (role !== 'owner') {
    groups = groups.map((g) =>
      g.id === 'config' ? { ...g, items: g.items.filter((i) => i.id !== 'cobranca') } : g,
    );
  }

  if (role !== 'agent') return groups;
  return groups
    .map((g) => {
      if (g.id === 'crm') return { ...g, items: g.items.filter((i) => i.id !== 'leads') };
      if (g.id === 'gestao')
        return { ...g, items: g.items.filter((i) => i.id !== 'financeiro' && i.id !== 'contratos') };
      return g;
    })
    .filter((g) => g.items.length > 0);
}
```

- [ ] **Step 5: Build and verify**

Run: `npm run build`
Expected: `tsc` + vite build pass with no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/App.tsx apps/crm/src/components/layout/nav-data.ts
git commit -m "feat(billing): route + owner-only nav entry for Plano & Cobrança"
```

---

## Phase 7 — Env docs

### Task 15: Document new env vars

**Files:**
- Modify: `CLAUDE.md` (Edge functions env section)
- Modify: `.env.example`

- [ ] **Step 1: Add the vars to CLAUDE.md**

In the "Edge functions (Deno.env)" list in `CLAUDE.md`, add:

```markdown
- `STRIPE_SECRET_KEY` -- Stripe API secret key. REQUIRED by billing functions, no default -- throw if missing
- `STRIPE_WEBHOOK_SECRET` -- Stripe webhook signing secret. REQUIRED by stripe-webhook, no default
```

- [ ] **Step 2: Add placeholders to `.env.example`**

Append to `.env.example`:

```bash
# Stripe billing (edge functions)
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md .env.example
git commit -m "docs(billing): document STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET env vars"
```

---

## Phase 8 — Deploy & manual integration test

### Task 16: Stripe setup, deploy, end-to-end test (Stripe test mode)

**Files:** none (configuration + verification)

- [ ] **Step 1: Create Stripe products & prices (test mode)**

In the Stripe dashboard (test mode), create one Product per paid plan (`starter`, `pro`, `scale`) and one recurring BRL Price per interval (monthly + annual) — 3 products × 2 prices.

- [ ] **Step 2: Set the price IDs via the admin portal**

In the admin app PlansPage, edit each paid plan and paste its `stripe_product_id`, `stripe_price_id` (monthly), and `stripe_price_id_annual` (annual). Leave the Free plan blank.

- [ ] **Step 3: Set env vars and deploy the functions**

```bash
npx supabase secrets set STRIPE_SECRET_KEY=sk_test_xxx STRIPE_WEBHOOK_SECRET=whsec_local_or_real
npx supabase functions deploy billing-checkout --no-verify-jwt
npx supabase functions deploy billing-portal --no-verify-jwt
npx supabase functions deploy stripe-webhook --no-verify-jwt
```

- [ ] **Step 4: Register the webhook + retry policy in Stripe**

Register the deployed `stripe-webhook` URL; subscribe to `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET` (re-run `secrets set` + redeploy `stripe-webhook` if it changed). In Subscriptions → revenue recovery, set retries to a fixed 3 attempts then **cancel** the subscription. Enable the Billing Portal (allow cancel, update card, plan switching).

- [ ] **Step 5: Local webhook forwarding for the happy-path test**

Run: `stripe listen --forward-to <stripe-webhook-url>` (or against a local `supabase functions serve`).
As owner, open `/configuracao/cobranca`, toggle Mensal/Anual, click "Fazer upgrade" on Pro, pay with `4242 4242 4242 4242`.
Expected: redirect back with `?status=success`; within a few seconds `workspace_subscriptions.status = active`, `workspaces.plan_id = 'pro'`, `plan_source = 'stripe'`; the page shows "Gerenciar assinatura".

- [ ] **Step 6: Failure + downgrade test**

Update the test subscription's card to `4000 0000 0000 0341` (payment fails) via the Billing Portal, then trigger renewal (Stripe CLI `stripe trigger invoice.payment_failed` or clock advance).
Expected: `workspace_subscriptions.status = past_due`, `failed_payment_count` reflects `attempt_count`, `workspaces.plan_id` unchanged. After Stripe exhausts retries and cancels, the `subscription.deleted` event sets `workspaces.plan_id` back to `free`.

- [ ] **Step 7: Comp guard test**

Via admin portal, set a workspace to `pro` (this sets `plan_source = 'manual'`). Replay a `customer.subscription.deleted` for that workspace.
Expected: `workspaces.plan_id` stays `pro` (webhook skips manual comps).

- [ ] **Step 8: Final full test suite + push**

```bash
npm test
deno test supabase/functions/
git checkout deno.lock 2>/dev/null || true
npm ci
npm run build
npm run build:hub
git push -u origin feat/stripe-payments-money-in
```

Expected: all suites green, both builds pass.

---

## Notes for the implementer

- **Lockfile hygiene:** any `deno test`/`deno check` can mutate `deno.lock` + shared `node_modules` and break `npm run build`. After deno commands, run `git checkout deno.lock` and `npm ci` if builds misbehave (project memory).
- **Migrations apply cumulatively:** `npx supabase db push --linked` applies ALL pending migrations. Always `--dry-run` first; confirm only this slice's files are pending. Staging ref `wlyzhyfondykzpsiqsce`, prod `skjzpekeqefvlojenfsw`.
- **Deploy flag:** all three functions handle their own auth, so each deploys with `--no-verify-jwt`.
- **No secrets in git:** never commit real Stripe keys; `.env.example` holds placeholders only.
- **CI gates:** run `npm test`, `deno test supabase/functions/`, and `npm run build` before pushing (project memory: CI enforces lint/format/coverage/deno).

## Out of scope (future slices)

Feature-gating/paywall enforcement · Focus NFe issuance · Resend dunning/upgrade emails · usage banners · Pagar.me (PIX/boleto).

# Admin Portal Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the admin portal load fast by (1) persisting Stripe subscription amounts in the `workspace_subscriptions` mirror, (2) collapsing the `list-workspaces` N+1 (~140 queries + live Stripe calls) into one SQL RPC, and (3) rendering dashboard KPI cards independently instead of blocking all on the slowest query.

**Architecture:** Two migrations (mirror amount columns, then an `admin_list_workspaces` security-definer RPC that reads them). `stripe-webhook` keeps the amounts fresh on every subscription event; `get-mrr`/`get-trials` read the mirror and only fall back to live Stripe (with write-back) for rows the webhook hasn't priced yet; `get-workspace` stays live but opportunistically refreshes the mirror. The frontend request/response shapes do not change, except the dashboard splits its single `isLoading` into per-card loading.

**Tech Stack:** Postgres (Supabase migrations), Deno edge functions, Stripe SDK, React 19 + TanStack Query, Vitest + `deno test`.

## Global Constraints

- Migration filename prefixes must be unique across `supabase/migrations/` (CI `migration-version-guard`). Latest used today: `20260730000006`. This plan uses `20260730000007` and `20260730000008`.
- SECURITY DEFINER admin RPCs must `REVOKE ALL ... FROM PUBLIC, anon, authenticated` **and then** `GRANT EXECUTE ... TO service_role` (revoking PUBLIC also strips service_role — see `20260716000001_admin_workspace_last_activity.sql` for the exact pattern).
- Edge functions: Deno runtime, `npm:` imports, never return raw error details to clients.
- No user-facing copy with em-dashes.
- API response shapes consumed by `apps/admin/src/lib/api.ts` (`WorkspaceSummary`, `MrrSummary`, `TrialsSummary`, `SubscriptionInfo`) must not change field names or types.
- Run before pushing: the four tsc project checks, `npm run test`, `deno test` for functions, `npm run lint`, `npm run format:check`. `test:functions` dirties the root `deno.lock`; restore it with `git checkout -- deno.lock`.

---

### Task 1: Mirror amount columns + webhook persistence

**Files:**
- Create: `supabase/migrations/20260730000007_subscription_amount_mirror.sql`
- Modify: `supabase/functions/stripe-webhook/index.ts` (`syncSubscription`, lines ~88-137)
- Test: `supabase/functions/__tests__/stripe-webhook-amounts_test.ts` (new; check first whether an existing stripe-webhook test file exists and extend it instead)

**Interfaces:**
- Produces: columns on `workspace_subscriptions`: `amount_cents int`, `gross_cents int`, `currency text`, `amount_interval text`, `discount_label text`, `amount_refreshed_at timestamptz`. All nullable; null means "webhook has not priced this row yet".
- Produces: `syncSubscription` writes these columns on every upsert (leaving them untouched when the Stripe pricing call fails, so stale amounts beat nulled amounts).

- [ ] **Step 1: Write the migration**

```sql
-- Persist what the customer actually pays (net of coupons) in the Stripe mirror,
-- so admin pages read local columns instead of calling Stripe live on every load.
-- Written by stripe-webhook on every subscription event; platform-admin backfills
-- lazily (live fetch + write-back) for rows created before this migration.
-- All nullable: NULL amount_cents = "not priced yet", callers fall back to the
-- plan's catalog price or a live fetch.
ALTER TABLE workspace_subscriptions
  ADD COLUMN IF NOT EXISTS amount_cents        int,
  ADD COLUMN IF NOT EXISTS gross_cents         int,
  ADD COLUMN IF NOT EXISTS currency            text,
  ADD COLUMN IF NOT EXISTS amount_interval     text,
  ADD COLUMN IF NOT EXISTS discount_label      text,
  ADD COLUMN IF NOT EXISTS amount_refreshed_at timestamptz;
```

`amount_interval` is separate from `billing_interval`: the mirror's `billing_interval` comes from plan resolution, while Stripe's price object may carry its own recurring interval; `fetchStripeAmount` already distinguishes them.

- [ ] **Step 2: Write the failing test**

Follow the recording-fake pattern from `supabase/functions/__tests__/platform-admin-plan-mutations_test.ts` (copy its `makeFakeDb`/`lastPayload` helpers if no shared version exists). Test the new exported helper `buildAmountColumns` (extracted so the test doesn't need the full webhook wiring):

```ts
import { assertEquals } from "./assert.ts";
import { buildAmountColumns } from "../stripe-webhook/index.ts";

Deno.test("buildAmountColumns maps a StripeAmount onto mirror columns", () => {
  const cols = buildAmountColumns({
    amount_cents: 9900,
    gross_cents: 12900,
    currency: "brl",
    interval: "month",
    discount_label: "LAUNCH -23%",
    livemode: true,
  });
  assertEquals(cols.amount_cents, 9900);
  assertEquals(cols.gross_cents, 12900);
  assertEquals(cols.currency, "brl");
  assertEquals(cols.amount_interval, "month");
  assertEquals(cols.discount_label, "LAUNCH -23%");
  assertEquals(typeof cols.amount_refreshed_at, "string");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd supabase/functions && deno test __tests__/stripe-webhook-amounts_test.ts`
Expected: FAIL (buildAmountColumns not exported)

- [ ] **Step 4: Implement**

In `supabase/functions/stripe-webhook/index.ts`:

```ts
import { fetchStripeAmount, type StripeAmount } from "../_shared/stripe-amount.ts";

/** Maps a live Stripe amount onto the workspace_subscriptions mirror columns. */
export function buildAmountColumns(amt: StripeAmount) {
  return {
    amount_cents: amt.amount_cents,
    gross_cents: amt.gross_cents,
    currency: amt.currency,
    amount_interval: amt.interval,
    discount_label: amt.discount_label,
    amount_refreshed_at: new Date().toISOString(),
  };
}
```

In `syncSubscription`, before the upsert:

```ts
// Price the subscription once here so admin reads never have to call Stripe live.
// On failure keep whatever amounts the row already has: stale beats nulled.
let amountCols: Record<string, unknown> = {};
try {
  const amt = await fetchStripeAmount(stripe, sub.id, resolved?.interval ?? null);
  amountCols = buildAmountColumns(amt);
} catch (err) {
  console.error("[stripe-webhook] amount fetch failed:", (err as Error).message);
}
```

and spread `...amountCols` into the existing upsert payload (next to `...recovery`).

- [ ] **Step 5: Run tests**

Run: `cd supabase/functions && deno test __tests__/stripe-webhook-amounts_test.ts` then the full suite `deno test .` (or `npm run test:functions`). Grep `supabase/functions/__tests__` for existing `syncSubscription`/stripe-webhook tests and update any that assert the exact upsert payload. Restore `deno.lock` after: `git checkout -- deno.lock`.
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260730000007_subscription_amount_mirror.sql supabase/functions/stripe-webhook/index.ts supabase/functions/__tests__/stripe-webhook-amounts_test.ts
git commit -m "feat(admin-perf): persist Stripe amounts in workspace_subscriptions mirror"
```

---

### Task 2: `admin_list_workspaces` RPC migration

**Files:**
- Create: `supabase/migrations/20260730000008_admin_list_workspaces_rpc.sql`

**Interfaces:**
- Consumes: mirror amount columns from Task 1; `admin_workspace_last_activity(uuid[])` from `20260716000001`.
- Produces: `admin_list_workspaces(p_search text, p_plan_id text, p_offset int, p_limit int) RETURNS jsonb` shaped `{ total: number, workspaces: WorkspaceSummary[] }` where each element matches the exact JSON `handleListWorkspaces` returns today (`id, name, logo_url, created_at, last_activity_at, owner{name,email,telefone,marketing_opt_in} | null, member_count, client_count, plan_name, has_overrides, subscription{status,plan_name,billing_interval,amount_cents,currency,interval,discount_label} | null`).

Behavior note (deliberate fix): today `plan_id` filtering happens **after** pagination in TypeScript, so filtered pages are short and `total` ignores the filter. The RPC filters before pagination; `total` becomes the filtered count. A workspace with `plan_id IS NULL` matches the default plan's id, mirroring the current name-fallback semantics.

- [ ] **Step 1: Write the migration**

```sql
-- One-round-trip replacement for platform-admin's list-workspaces N+1
-- (7 queries per workspace + an Auth Admin call + live Stripe per paying row).
-- Subscription amounts come from the workspace_subscriptions mirror columns
-- (20260730000007), falling back to the plan's catalog price when unpriced.
CREATE OR REPLACE FUNCTION admin_list_workspaces(
  p_search  text DEFAULT NULL,
  p_plan_id text DEFAULT NULL,
  p_offset  int  DEFAULT 0,
  p_limit   int  DEFAULT 20
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH default_plan AS (
  SELECT id, name FROM plans WHERE is_default = true LIMIT 1
),
filtered AS (
  SELECT w.id, w.name, w.logo_url, w.created_at, w.plan_id
    FROM workspaces w
   WHERE (p_search IS NULL OR w.name ILIKE '%' || p_search || '%')
     AND (p_plan_id IS NULL
          OR COALESCE(w.plan_id, (SELECT id FROM default_plan)) = p_plan_id)
),
page AS (
  SELECT * FROM filtered ORDER BY created_at DESC OFFSET p_offset LIMIT p_limit
),
enriched AS (
  SELECT
    p.id,
    p.name,
    p.logo_url,
    p.created_at,
    la.last_activity_at,
    (SELECT count(*) FROM workspace_members m WHERE m.workspace_id = p.id) AS member_count,
    (SELECT count(*) FROM clientes c WHERE c.conta_id = p.id)              AS client_count,
    COALESCE(pl.name, (SELECT name FROM default_plan))                     AS plan_name,
    EXISTS (
      SELECT 1 FROM workspace_plan_overrides o
       WHERE o.workspace_id = p.id
         AND (o.resource_overrides IS NOT NULL OR o.feature_overrides IS NOT NULL)
    ) AS has_overrides,
    own.owner_json AS owner,
    sub.sub_json   AS subscription
  FROM page p
  LEFT JOIN plans pl ON pl.id = p.plan_id
  LEFT JOIN LATERAL (
    SELECT a.last_activity_at
      FROM admin_workspace_last_activity(ARRAY[p.id]) a
  ) la ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_build_object(
      'name',             COALESCE(pr.nome, 'Unknown'),
      'email',            COALESCE(u.email, 'Unknown'),
      'telefone',         pr.telefone,
      'marketing_opt_in', COALESCE(pr.marketing_opt_in, false)
    ) AS owner_json
      FROM workspace_members m
      LEFT JOIN profiles pr ON pr.id = m.user_id
      LEFT JOIN auth.users u ON u.id = m.user_id
     WHERE m.workspace_id = p.id AND m.role = 'owner'
     LIMIT 1
  ) own ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_build_object(
      'status',           s.status,
      'plan_name',        sp.name,
      'billing_interval', s.billing_interval,
      'amount_cents',     COALESCE(
                            s.amount_cents,
                            CASE WHEN s.billing_interval = 'year'
                                 THEN sp.price_brl_annual ELSE sp.price_brl END),
      'currency',         CASE
                            WHEN s.amount_cents IS NOT NULL THEN s.currency
                            WHEN (CASE WHEN s.billing_interval = 'year'
                                       THEN sp.price_brl_annual ELSE sp.price_brl END) IS NOT NULL
                                 THEN 'brl'
                            ELSE NULL
                          END,
      'interval',         COALESCE(s.amount_interval, s.billing_interval),
      'discount_label',   s.discount_label
    ) AS sub_json
      FROM workspace_subscriptions s
      LEFT JOIN plans sp ON sp.id = s.plan_id
     WHERE s.workspace_id = p.id
  ) sub ON true
)
SELECT jsonb_build_object(
  'total',      (SELECT count(*) FROM filtered),
  'workspaces', COALESCE(
    (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at DESC) FROM enriched e),
    '[]'::jsonb)
);
$$;

-- SECURITY DEFINER reads auth.users and bypasses RLS across every workspace:
-- reachable only through platform-admin's service-role client.
-- NOTE: revoking PUBLIC also strips service_role; the GRANT below restores it.
REVOKE ALL ON FUNCTION admin_list_workspaces(text, text, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_list_workspaces(text, text, int, int) FROM anon;
REVOKE ALL ON FUNCTION admin_list_workspaces(text, text, int, int) FROM authenticated;
GRANT EXECUTE ON FUNCTION admin_list_workspaces(text, text, int, int) TO service_role;
```

- [ ] **Step 2: Sanity-check the SQL locally**

There is no local DB harness in this repo; validation is (a) careful read-through against the current `handleListWorkspaces` output shape, and (b) `npx supabase db push --linked` to STAGING later (deployment section). Before any `--linked` command: `cat supabase/.temp/project-ref` and confirm it is the staging ref `wlyzhyfondykzpsiqsce` (prod is `skjzpekeqefvlojenfsw`).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260730000008_admin_list_workspaces_rpc.sql
git commit -m "feat(admin-perf): admin_list_workspaces RPC collapses the list N+1"
```

---

### Task 3: Rewire `handleListWorkspaces` to the RPC

**Files:**
- Modify: `supabase/functions/platform-admin/index.ts` (`handleListWorkspaces`, lines ~276-490; delete the whole enrichment body)
- Test: `supabase/functions/__tests__/platform-admin-list-workspaces_test.ts` (new)

**Interfaces:**
- Consumes: `admin_list_workspaces` RPC (Task 2).
- Produces: unchanged HTTP contract: `{ workspaces: WorkspaceSummary[], total: number }`.

- [ ] **Step 1: Write the failing test**

Extend the recording fake with an `rpc` method:

```ts
import { assert, assertEquals } from "./assert.ts";
import { handleListWorkspaces } from "../platform-admin/index.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

function makeFakeRpcDb(result: unknown) {
  const rpcCalls: Array<{ fn: string; params: unknown }> = [];
  const db = {
    rpc: (fn: string, params: unknown) => {
      rpcCalls.push({ fn, params });
      return Promise.resolve({ data: result, error: null });
    },
  };
  return { db, rpcCalls };
}

const HEADERS = { "Content-Type": "application/json" };

Deno.test("list-workspaces delegates to admin_list_workspaces and passes filters through", async () => {
  const payload = { total: 42, workspaces: [{ id: "ws-1", name: "Alpha" }] };
  const { db, rpcCalls } = makeFakeRpcDb(payload);

  const res = await handleListWorkspaces(
    db as unknown as SupabaseClient,
    { search: "alp", plan_id: "pro", offset: 20, limit: 20 },
    HEADERS,
  );

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.total, 42);
  assertEquals(body.workspaces.length, 1);
  assertEquals(rpcCalls.length, 1);
  assertEquals(rpcCalls[0].fn, "admin_list_workspaces");
  assertEquals(rpcCalls[0].params, { p_search: "alp", p_plan_id: "pro", p_offset: 20, p_limit: 20 });
});

Deno.test("list-workspaces defaults offset 0 / limit 20 and null filters", async () => {
  const { db, rpcCalls } = makeFakeRpcDb({ total: 0, workspaces: [] });
  const res = await handleListWorkspaces(db as unknown as SupabaseClient, {}, HEADERS);
  assertEquals(res.status, 200);
  assertEquals(rpcCalls[0].params, { p_search: null, p_plan_id: null, p_offset: 0, p_limit: 20 });
});
```

`handleListWorkspaces` must be exported for this (add `export` to the function; it is module-internal today).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd supabase/functions && deno test __tests__/platform-admin-list-workspaces_test.ts`
Expected: FAIL (not exported / still runs the N+1 path against the fake)

- [ ] **Step 3: Replace the handler body**

```ts
export async function handleListWorkspaces(
  svc: ReturnType<typeof createClient>,
  body: { search?: string; plan_id?: string; offset?: number; limit?: number },
  headers: Record<string, string>,
) {
  const { search, plan_id, offset = 0, limit = 20 } = body;
  // One round trip: the RPC does the joins, counts, owner lookup (auth.users)
  // and reads subscription amounts from the mirror. No Stripe calls here.
  const { data, error } = await svc.rpc("admin_list_workspaces", {
    p_search: search ?? null,
    p_plan_id: plan_id ?? null,
    p_offset: offset,
    p_limit: limit,
  });
  if (error) throw error;
  return new Response(
    JSON.stringify({ workspaces: data?.workspaces ?? [], total: data?.total ?? 0 }),
    { status: 200, headers },
  );
}
```

Delete the now-dead code the old body used exclusively (the per-workspace enrichment, its Stripe block, and the `plan_id` post-filter). Keep `fetchStripeAmount`/`withTimeout`/`priceSubscriptionRows` — get-mrr/get-trials/get-workspace still use them.

- [ ] **Step 4: Run tests**

Run: `cd supabase/functions && deno test .` (grep `__tests__` and `apps/**/__tests__` for anything asserting the old list-workspaces internals). Restore `deno.lock`.
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/platform-admin/index.ts supabase/functions/__tests__/platform-admin-list-workspaces_test.ts
git commit -m "feat(admin-perf): list-workspaces reads the RPC, drops N+1 and live Stripe"
```

---

### Task 4: `get-mrr` / `get-trials` read the mirror; live fetch only as backfill

**Files:**
- Modify: `supabase/functions/platform-admin/index.ts` (`priceSubscriptionRows` ~line 766, `handleGetMrr` ~line 839, `handleGetTrials` ~line 909, `buildSubscriptionDetail` ~line 642)
- Test: `supabase/functions/__tests__/platform-admin-pricing_test.ts` (new)

**Interfaces:**
- Consumes: mirror columns (Task 1).
- Produces: unchanged HTTP contracts for `get-mrr`, `get-trials`, `get-workspace`. New internal contract: `priceSubscriptionRows(rows, nameByWs, planById, writeBack)` where rows now also carry `amount_cents/currency/amount_interval/discount_label` from the mirror, and `writeBack(workspace_id, cols)` persists a live-fetched amount.

- [ ] **Step 1: Write the failing test**

Extract the per-row decision into a pure exported helper so it tests without Stripe:

```ts
import { assertEquals } from "./assert.ts";
import { resolveMirrorAmount } from "../platform-admin/index.ts";

Deno.test("mirror-priced row is used directly, no live fetch needed", () => {
  const r = resolveMirrorAmount(
    { amount_cents: 9900, currency: "brl", amount_interval: "month",
      discount_label: null, billing_interval: "month", stripe_subscription_id: "sub_1" },
    { name: "Pro", price_brl: 12900, price_brl_annual: null },
  );
  assertEquals(r, {
    amount_cents: 9900, interval: "month", discount_label: null,
    amount_source: "stripe", needsLiveFetch: false,
  });
});

Deno.test("unpriced row with a subscription id asks for a live fetch", () => {
  const r = resolveMirrorAmount(
    { amount_cents: null, currency: null, amount_interval: null,
      discount_label: null, billing_interval: "year", stripe_subscription_id: "sub_2" },
    { name: "Pro", price_brl: null, price_brl_annual: 99000 },
  );
  assertEquals(r.needsLiveFetch, true);
  // Catalog fallback still fills the amount so a failed live fetch has a value.
  assertEquals(r.amount_cents, 99000);
  assertEquals(r.amount_source, "catalog");
});

Deno.test("no subscription id: catalog only, never a live fetch", () => {
  const r = resolveMirrorAmount(
    { amount_cents: null, currency: null, amount_interval: null,
      discount_label: null, billing_interval: "month", stripe_subscription_id: null },
    { name: "Free", price_brl: 0, price_brl_annual: null },
  );
  assertEquals(r.needsLiveFetch, false);
  assertEquals(r.amount_cents, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd supabase/functions && deno test __tests__/platform-admin-pricing_test.ts`
Expected: FAIL (resolveMirrorAmount not defined)

- [ ] **Step 3: Implement**

In `platform-admin/index.ts`:

```ts
export interface MirrorPricedRow {
  amount_cents: number | null;
  currency: string | null;
  amount_interval: string | null;
  discount_label: string | null;
  billing_interval: string | null;
  stripe_subscription_id: string | null;
}

/**
 * Decides how to price a subscription row: mirror columns when the webhook has
 * priced it, otherwise catalog fallback plus a request for a (bounded) live
 * fetch that will write the result back to the mirror.
 */
export function resolveMirrorAmount(
  s: MirrorPricedRow,
  planMeta: { name: string; price_brl: number | null; price_brl_annual: number | null } | undefined,
): {
  amount_cents: number | null;
  interval: string | null;
  discount_label: string | null;
  amount_source: "stripe" | "catalog" | null;
  needsLiveFetch: boolean;
} {
  if (s.amount_cents != null) {
    return {
      amount_cents: s.amount_cents,
      interval: s.amount_interval ?? s.billing_interval,
      discount_label: s.discount_label,
      amount_source: "stripe",
      needsLiveFetch: false,
    };
  }
  const catalog = planMeta
    ? (s.billing_interval === "year" ? planMeta.price_brl_annual : planMeta.price_brl)
    : null;
  return {
    amount_cents: catalog ?? null,
    interval: s.billing_interval,
    discount_label: null,
    amount_source: catalog != null ? "catalog" : null,
    needsLiveFetch: !!s.stripe_subscription_id,
  };
}
```

Rewire `priceSubscriptionRows`: for each row call `resolveMirrorAmount` first; only rows with `needsLiveFetch` enter the existing batched live-fetch loop (`STRIPE_CONCURRENCY` / `withTimeout` unchanged). After a successful live fetch, overwrite the resolved values and write back:

```ts
await svc.from("workspace_subscriptions").update({
  amount_cents: amt.amount_cents,
  gross_cents: amt.gross_cents,
  currency: amt.currency,
  amount_interval: amt.interval,
  discount_label: amt.discount_label,
  amount_refreshed_at: new Date().toISOString(),
}).eq("workspace_id", s.workspace_id);
```

(`priceSubscriptionRows` gains an `svc` parameter for this; both call sites pass it.) Update the two `.select(...)` calls in `handleGetMrr`/`handleGetTrials` to also select `amount_cents, currency, amount_interval, discount_label`.

In `buildSubscriptionDetail` (get-workspace): keep the live fetch (single row, and it is the admin's "current truth" view) but after a successful fetch run the same mirror write-back, so viewing a workspace refreshes its cached amount.

- [ ] **Step 4: Run tests**

Run: `cd supabase/functions && deno test .` — update any existing tests that assert `priceSubscriptionRows`'s old signature. Restore `deno.lock`.
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/platform-admin/index.ts supabase/functions/__tests__/platform-admin-pricing_test.ts
git commit -m "feat(admin-perf): get-mrr/get-trials price from the mirror, live fetch only backfills"
```

---

### Task 5: Dashboard per-card loading

**Files:**
- Modify: `apps/admin/src/pages/DashboardPage.tsx` (lines ~34-110)
- Test: `apps/admin/src/pages/__tests__/DashboardPage.test.tsx` (new)

**Interfaces:**
- Consumes: unchanged `listWorkspaces/listPlans/getMrr/getTrials` from `../lib/api`.
- Produces: each KPI card shows its value as soon as its own query resolves; only the MRR-dependent cards and the Paying Workspaces table wait on Stripe-backed queries.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DashboardPage from '../DashboardPage';

vi.mock('../../lib/api', () => ({
  listWorkspaces: vi.fn().mockResolvedValue({
    total: 7,
    workspaces: [
      { id: 'a', member_count: 3, has_overrides: false },
      { id: 'b', member_count: 2, has_overrides: true },
    ],
  }),
  listPlans: vi.fn().mockResolvedValue({ plans: [{ id: 'p1' }, { id: 'p2' }] }),
  // Stripe-backed queries never resolve in this test: the point is that the
  // other cards must not wait for them.
  getMrr: vi.fn().mockReturnValue(new Promise(() => {})),
  getTrials: vi.fn().mockReturnValue(new Promise(() => {})),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DashboardPage per-card loading', () => {
  it('shows workspace KPIs while MRR is still loading', async () => {
    renderPage();
    expect(await screen.findByText('7')).toBeInTheDocument(); // Workspaces card
    expect(screen.getByText('5')).toBeInTheDocument(); // Total Users (3+2)
    expect(screen.getByText('2')).toBeInTheDocument(); // Active Plans
    // MRR-dependent cards still pending.
    const mrrCard = screen.getByText('MRR').closest('div')!;
    expect(mrrCard.textContent).toContain('—');
  });
});
```

Check `apps/admin/src/__tests__/admin-login-flow.test.tsx` first and mirror its setup helpers (jsdom config, providers) where they exist.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- DashboardPage`
Expected: FAIL — with the current single `isLoading`, the Workspaces card renders an em dash placeholder, so `findByText('7')` times out.

- [ ] **Step 3: Implement**

In `DashboardPage.tsx`, drop the combined `isLoading` and give each KPI its own flag:

```tsx
const kpis: { label: string; value: string | number; sub?: string; loading: boolean }[] = [
  { label: 'Workspaces', value: totalWorkspaces, loading: wsLoading },
  { label: 'Total Users', value: totalMembers, loading: wsLoading },
  { label: 'Active Plans', value: activePlans, loading: plansLoading },
  { label: 'With Overrides', value: withOverrides, loading: wsLoading },
  {
    label: 'MRR',
    value: formatMoney(mrrData?.mrr_cents ?? null, currency),
    sub: mrrData ? `${mrrData.paying_count} pagantes` : undefined,
    loading: mrrLoading,
  },
  {
    label: 'Trials',
    value: formatMoney(trialMrrCents, currency),
    sub: trialsData ? `${trialsData.trial_count} em teste` : undefined,
    loading: trialsLoading,
  },
  {
    label: 'Total MRR',
    value: formatMoney(totalMrrCents, currency),
    sub: 'MRR + trials',
    loading: mrrLoading || trialsLoading,
  },
];
```

Render with `kpi.loading` in place of `isLoading` (both the value and the `sub` line). The Paying Workspaces section gates on `mrrLoading` only.

- [ ] **Step 4: Run tests**

Run: `npm run test -- DashboardPage` then the full `npm run test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/pages/DashboardPage.tsx apps/admin/src/pages/__tests__/DashboardPage.test.tsx
git commit -m "feat(admin-perf): dashboard KPI cards load independently"
```

---

### Task 6: Full verification sweep

**Files:** none new.

- [ ] **Step 1: Typecheck all four projects**

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
```

- [ ] **Step 2: Full test suites**

```bash
npm run test
npm run test:functions
git checkout -- deno.lock
```

- [ ] **Step 3: Lint + format**

```bash
npm run lint
npm run format:check
```

(`npm run format` to auto-fix, then re-check.)

- [ ] **Step 4: Commit any fixups**

```bash
git add -A && git commit -m "chore(admin-perf): verification fixups"
```

---

## Deployment (after merge; not part of this branch's execution)

1. `cat supabase/.temp/project-ref` — translate against staging `wlyzhyfondykzpsiqsce` / prod `skjzpekeqefvlojenfsw`; never assume the link.
2. Staging: `npx supabase db push --linked` (staging has an orphaned 130000 migration; if push aborts, apply `20260730000007` and `20260730000008` individually via the SQL editor and record versions, per the established workaround).
3. Deploy functions with server-side bundling: `npx supabase functions deploy platform-admin --use-api` and `npx supabase functions deploy stripe-webhook --use-api` (stripe-webhook needs `--no-verify-jwt`).
4. Prod: same migration + deploy pair. Until the migrations run, the new `platform-admin` would 500 on list-workspaces (missing RPC): deploy order is migrations first, functions second.
5. Amounts backfill is lazy: the first `get-mrr` after deploy live-fetches unpriced rows once and writes them back; no manual backfill needed.

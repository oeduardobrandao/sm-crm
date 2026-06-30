# Pricing Migration — Slice 1: Core Seats + Clients Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec (single source of truth):** [`docs/superpowers/specs/2026-06-29-pricing-seats-clients-slice1-design.md`](../specs/2026-06-29-pricing-seats-clients-slice1-design.md). This is **Slice 1 of 5**; Slices 2–5 (smooth-meter UX, trial, grandfather sunset, gate retirement) are out of scope.

**Goal:** Add three "everything included" tiers (Starter / Agency / Scale) priced by client capacity plus a Stripe quantity-based per-seat add-on — wiring checkout, webhook, entitlements, and the billing UI — strictly additively, changing no existing user's entitlements.

**Architecture:** New plan rows + two migrations (a `purchased_seats` column and an additive `effective_plan_limit` rewrite) extend the live paywall without touching `is_default` or existing plans. Seats are a **second Stripe subscription line item** (quantity = *extra* seats beyond the tier base); the webhook classifies items by `price_id` (never index) and persists `purchased_seats` status-aware; `effective_plan_limit('max_team_members')` returns `base + purchased`, so the existing invite gate and `workspace_members` count trigger enforce seats unchanged.

**Tech Stack:** Supabase Postgres + Deno edge functions (`npm:stripe@^17`), React 19 + TanStack Query + Ant Design (CRM admin/billing UI), Vitest + `deno test` + the SQL entitlements suite.

## Global Constraints

*Every task's requirements implicitly include this section.*

- **Plan ids:** new tiers are `starter` / `agency` / `scale` — never reuse `free` / `start` / `pro` / `max` / `lifetime`.
- **Catalog values (centavos):** `price_brl` 11000 / 17900 / 27900; `price_brl_annual` 110000 / 179000 / 279000; seat display price `seat_addon_brl` 2500 and `seat_addon_brl_annual` 25000 (shared across tiers). `max_clients` 10 / 30 / NULL; `max_team_members` 2 / 5 / 10; `rate_ai_analyses_per_month` 30 / 100 / 300; **all other** `max_*` / `rate_*` / `storage_quota_bytes` = NULL; **every** `feature_*` column = TRUE (enumerate the live columns — do not rely on defaults); `is_active` = true; `is_default` = false (stays on `free`).
- **Seat accounting:** the seat line-item quantity is **EXTRA seats beyond the tier base, never total**. `total_seats = plan.max_team_members + purchased_seats`.
- **Plan source of truth:** `workspaces.plan_id`. Never overwrite when `plan_source='manual'`. On an **unresolved** tier price, **leave `plan_id` unchanged** — never silently downgrade to the default plan.
- **Entitlement semantics (unchanged):** `effective_plan_limit` returns NULL = unlimited, 0 = fail-closed; the additive seat term is gated on subscription `status IN ('active','trialing')`.
- **Migrations:** additive + idempotent (`ADD COLUMN IF NOT EXISTS`, `INSERT … ON CONFLICT (id) DO UPDATE`); never edit a historical migration in place — use `CREATE OR REPLACE` in a **new** file. Push to staging first (`npx supabase db push --linked --dry-run`, then apply); apply to prod via the SQL editor, recording the version row.
- **Edge-function registration:** functions handle their own auth → add a `[functions.<name>]` block with `verify_jwt = false` in `supabase/config.toml` **and** add the name to `REQUIRED_FUNCTIONS` in `supabase/functions/__tests__/config-audit_test.ts`; deploy with `--use-api --no-verify-jwt`.
- **Deno/npm lockfile gotcha:** any task that runs `deno test` / `deno check` MUST end with `git checkout deno.lock && npm ci` before the next `npm run build` / `npm run test` in the same tree, or the npm step breaks.
- **CI gates (before every push):** `npm run build` (tsc) · `npm run test` (Vitest) · `deno test supabase/functions/` · the SQL entitlements suite · eslint · prettier `format:check` · the coverage ratchet.
- **Conventions:** PT-BR for all user-facing CRM copy; path alias `@/` → `./src/`; money is centavos and annual = 10× monthly.
- **Stripe:** SDK `npm:stripe@^17` via `createFetchHttpClient`; verify webhooks with `constructEventAsync`; seat changes use `subscriptions.update` with `proration_behavior:'create_prorations'`; **never** `quantity:0` — use `{ deleted: true }` to remove the seat item.
- **Prod-safe deploy order** (full runbook in the Deployment appendix): Stripe prices → DB migrations → `stripe-webhook` → `billing-checkout` → `billing-seats` → `platform-admin` → admin UI → CRM frontend.

---

### Task 1: Pure seat helpers in billing-logic.ts (PlanPriceRow seat columns + resolveSubscriptionSeats + tier-only resolvePlanFromPriceId)

**Files:**
- Modify: `supabase/functions/_shared/billing-logic.ts` (extend `PlanPriceRow` at lines 30-34; add `SubItem` interface + `resolveSubscriptionSeats` after line 46; leave `resolvePlanFromPriceId` lines 37-46 unchanged — it already matches only tier prices)
- Test: `supabase/functions/__tests__/billing-logic_test.ts` (extend existing file; import line 2 already pulls from `../_shared/billing-logic.ts`)

**Interfaces:**
- Consumes: (none — this is the first task; no earlier-task signatures)
- Produces:
  - `interface PlanPriceRow { id: string; stripe_price_id: string | null; stripe_price_id_annual: string | null; stripe_price_id_seat: string | null; stripe_price_id_seat_annual: string | null }`
  - `interface SubItem { price: { id: string | null } | null; quantity?: number | null }`
  - `resolveSubscriptionSeats(subItems: SubItem[], plans: PlanPriceRow[]): { purchased_seats: number }` — sums `quantity` of items whose `price.id` matches any plan's `stripe_price_id_seat` or `stripe_price_id_seat_annual`; returns `{ purchased_seats: 0 }` when no seat item; order-independent.
  - `resolvePlanFromPriceId(priceId: string, plans: PlanPriceRow[]): { plan_id: string; interval: "month" | "year" } | null` — unchanged signature; matches ONLY tier prices (`stripe_price_id` / `stripe_price_id_annual`); a seat price id resolves to `null`.

- [ ] **Step 1: Write the FAILING test for `resolveSubscriptionSeats` (both array orders + tier-only=0) and the tier-only `resolvePlanFromPriceId` regression.**

  Append to `supabase/functions/__tests__/billing-logic_test.ts` (the file currently ends at line 32 with the closing `});` of the existing `resolvePlanFromPriceId` test). Also update the import on line 2 to add `resolveSubscriptionSeats`.

  First change line 2 from:
  ```ts
  import { statusToPlanId, resolvePlanFromPriceId } from "../_shared/billing-logic.ts";
  ```
  to:
  ```ts
  import {
    statusToPlanId,
    resolvePlanFromPriceId,
    resolveSubscriptionSeats,
  } from "../_shared/billing-logic.ts";
  ```

  Then append after the final `});` (line 32):
  ```ts

  const SEAT_PLANS = [
    {
      id: "starter",
      stripe_price_id: "price_s_m",
      stripe_price_id_annual: "price_s_y",
      stripe_price_id_seat: "price_seat_m",
      stripe_price_id_seat_annual: "price_seat_y",
    },
    {
      id: "agency",
      stripe_price_id: "price_a_m",
      stripe_price_id_annual: "price_a_y",
      stripe_price_id_seat: "price_seat_m",
      stripe_price_id_seat_annual: "price_seat_y",
    },
  ];

  Deno.test("resolvePlanFromPriceId: a seat price resolves to null-as-tier", () => {
    assert(resolvePlanFromPriceId("price_seat_m", SEAT_PLANS) === null);
    assert(resolvePlanFromPriceId("price_seat_y", SEAT_PLANS) === null);
  });

  Deno.test("resolveSubscriptionSeats: tier-only subscription has 0 purchased seats", () => {
    const items = [{ price: { id: "price_a_m" }, quantity: 1 }];
    assertEquals(resolveSubscriptionSeats(items, SEAT_PLANS), { purchased_seats: 0 });
  });

  Deno.test("resolveSubscriptionSeats: tier+seat, [tier, seat] order", () => {
    const items = [
      { price: { id: "price_a_m" }, quantity: 1 },
      { price: { id: "price_seat_m" }, quantity: 3 },
    ];
    assertEquals(resolveSubscriptionSeats(items, SEAT_PLANS), { purchased_seats: 3 });
  });

  Deno.test("resolveSubscriptionSeats: tier+seat, [seat, tier] order (order-independent)", () => {
    const items = [
      { price: { id: "price_seat_m" }, quantity: 3 },
      { price: { id: "price_a_m" }, quantity: 1 },
    ];
    assertEquals(resolveSubscriptionSeats(items, SEAT_PLANS), { purchased_seats: 3 });
  });

  Deno.test("resolveSubscriptionSeats: annual seat price id is recognized", () => {
    const items = [
      { price: { id: "price_a_y" }, quantity: 1 },
      { price: { id: "price_seat_y" }, quantity: 2 },
    ];
    assertEquals(resolveSubscriptionSeats(items, SEAT_PLANS), { purchased_seats: 2 });
  });

  Deno.test("resolveSubscriptionSeats: missing/null quantity counts as 0, null price ignored", () => {
    const items = [
      { price: { id: "price_seat_m" }, quantity: null },
      { price: { id: "price_seat_m" } },
      { price: null, quantity: 5 },
    ];
    assertEquals(resolveSubscriptionSeats(items, SEAT_PLANS), { purchased_seats: 0 });
  });
  ```

- [ ] **Step 2: Run the test and confirm it FAILS.**

  Command:
  ```bash
  deno test supabase/functions/__tests__/billing-logic_test.ts
  ```
  Expected FAIL: a `TS2305`/module error because `resolveSubscriptionSeats` is not exported from `../_shared/billing-logic.ts` (the import on line 2 cannot be resolved), so the test file fails to load. (The `resolvePlanFromPriceId` seat-null test would pass on its own, but the missing export fails the whole file.)

- [ ] **Step 3: Extend `PlanPriceRow` with the two seat columns (MINIMAL implementation, part 1).**

  In `supabase/functions/_shared/billing-logic.ts`, the current interface is (lines 30-34):
  ```ts
  export interface PlanPriceRow {
    id: string;
    stripe_price_id: string | null;
    stripe_price_id_annual: string | null;
  }
  ```
  Replace it with:
  ```ts
  export interface PlanPriceRow {
    id: string;
    stripe_price_id: string | null;
    stripe_price_id_annual: string | null;
    stripe_price_id_seat: string | null;
    stripe_price_id_seat_annual: string | null;
  }
  ```

- [ ] **Step 4: Add `SubItem` + `resolveSubscriptionSeats` (MINIMAL implementation, part 2).**

  `resolvePlanFromPriceId` (lines 37-46) is left exactly as-is — it already matches only `stripe_price_id` / `stripe_price_id_annual`, so a seat price id already resolves to `null`. Append the new code at the end of `supabase/functions/_shared/billing-logic.ts` (after the closing `}` of `resolvePlanFromPriceId` on line 46):
  ```ts

  /** Shape of a Stripe subscription item, narrowed to the fields we read. */
  export interface SubItem {
    price: { id: string | null } | null;
    quantity?: number | null;
  }

  /**
   * Sums the quantity of subscription items whose price id matches a known seat
   * price id (monthly or annual, across all plans). Returns 0 when no seat item
   * is present. Order-independent — iterates every item.
   */
  export function resolveSubscriptionSeats(
    subItems: SubItem[],
    plans: PlanPriceRow[],
  ): { purchased_seats: number } {
    const seatPriceIds = new Set<string>();
    for (const p of plans) {
      if (p.stripe_price_id_seat) seatPriceIds.add(p.stripe_price_id_seat);
      if (p.stripe_price_id_seat_annual) seatPriceIds.add(p.stripe_price_id_seat_annual);
    }
    let purchased_seats = 0;
    for (const item of subItems) {
      const priceId = item.price?.id;
      if (priceId && seatPriceIds.has(priceId)) {
        purchased_seats += item.quantity ?? 0;
      }
    }
    return { purchased_seats };
  }
  ```

- [ ] **Step 5: Run the test and confirm it PASSES.**

  Command:
  ```bash
  deno test supabase/functions/__tests__/billing-logic_test.ts
  ```
  Expected PASS: all tests green, including the pre-existing `statusToPlanId` / `resolvePlanFromPriceId` tests and the six new ones (`resolvePlanFromPriceId: a seat price resolves to null-as-tier`, the four `resolveSubscriptionSeats` order/interval cases, and the null-quantity/null-price case). Output ends with `ok | N passed | 0 failed`.

- [ ] **Step 6: Commit.**

  ```bash
  git add supabase/functions/_shared/billing-logic.ts supabase/functions/__tests__/billing-logic_test.ts
  git commit -m "feat(billing-logic): seat price columns + resolveSubscriptionSeats helper

Extend PlanPriceRow with stripe_price_id_seat / stripe_price_id_seat_annual
and add order-independent resolveSubscriptionSeats. resolvePlanFromPriceId
keeps matching tier prices only, so a seat price resolves to null-as-tier.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

### Task 2: Catalog migration — seat-price columns + seat display-price columns + 3 new tier rows + seed + catalog SQL test

**Files:**
- Create: `supabase/migrations/20260630000001_plans_seats_and_new_tiers.sql`
- Modify: `supabase/seed.sql` (append `starter`/`agency`/`scale` rows after the existing `max` row; the `values (...)` list currently ends at the `('max', ...)` tuple terminated by a semicolon)
- Create (test): `supabase/tests/entitlements/07_catalog_slice1.sql`

**Interfaces:**
- Consumes: nothing from earlier tasks (additive migration).
- Produces (later tasks rely on these EXACT names/values):
  - `plans.stripe_price_id_seat text` (nullable), `plans.stripe_price_id_seat_annual text` (nullable) — Task 1's `PlanPriceRow` and Task 5+ (`billing-checkout` select) read these column names verbatim.
  - `plans.seat_addon_brl int` (nullable, centavos, monthly per-seat) and `plans.seat_addon_brl_annual int` (nullable, centavos, annual per-seat) — the cost-breakdown display price. **These back `computeSeatCost`; without them `listActivePlans` 400s at runtime.** Seeded `2500` / `25000` on all three tiers (the seat price is SHARED across tiers, so the same centavos on each).
  - Plan rows `starter` / `agency` / `scale`:
    - `price_brl` = 11000 / 17900 / 27900; `price_brl_annual` = 110000 / 179000 / 279000
    - `seat_addon_brl` = 2500 (all three); `seat_addon_brl_annual` = 25000 (all three)
    - `max_clients` = 10 / 30 / NULL; `max_team_members` = 2 / 5 / 10
    - `rate_ai_analyses_per_month` = 30 / 100 / 300
    - every `feature_*` (all 19 live columns) = TRUE
    - all other `max_*` (incl. `max_mcp_keys`), all other `rate_*`, `storage_quota_bytes` = NULL
    - `is_active` = true; `is_default` = false; `sort_order` = 10 / 20 / 30
    - `stripe_price_id_seat` / `stripe_price_id_seat_annual` = NULL (operator pastes via admin)

**Frontend contract (consumed by Task 7+):** `BillingPlan` adds `seat_addon_brl: number | null` and `seat_addon_brl_annual: number | null`; the `listActivePlans` select string includes both; `computeSeatCost` derives `seatAddonCentavos = interval === 'year' ? plan.seat_addon_brl_annual : plan.seat_addon_brl`.

- [ ] **Step 1: Write the FAILING catalog test.**
  Create `supabase/tests/entitlements/07_catalog_slice1.sql` (mirrors the `\i _helpers.sql` + `do $$ … $$;` pattern of `01_effective_plan_limit.sql`). No rollback needed for read-only asserts, but keep the file shape consistent. Write this exact content:
  ```sql
  \set ON_ERROR_STOP on
  \i supabase/tests/entitlements/_helpers.sql

  do $$
  declare
    r record;
    v_n int;
    v_feature_cols text[];
    v_col text;
    v_all_true boolean;
  begin
    -- The 3 Slice-1 tiers exist and are active.
    select count(*) into v_n
      from plans where id in ('starter','agency','scale') and is_active;
    assert v_n = 3, format('expected 3 active slice-1 tiers, got %s', v_n);

    -- max_clients: 10 / 30 / NULL(unlimited)
    select max_clients into v_n from plans where id = 'starter';
    assert v_n = 10, format('starter max_clients expected 10, got %s', v_n);
    select max_clients into v_n from plans where id = 'agency';
    assert v_n = 30, format('agency max_clients expected 30, got %s', v_n);
    assert (select max_clients from plans where id = 'scale') is null,
      'scale max_clients must be NULL (unlimited)';

    -- max_team_members: 2 / 5 / 10
    assert (select max_team_members from plans where id = 'starter') = 2, 'starter seats=2';
    assert (select max_team_members from plans where id = 'agency')  = 5, 'agency seats=5';
    assert (select max_team_members from plans where id = 'scale')   = 10, 'scale seats=10';

    -- rate_ai_analyses_per_month set/scaled (NOT NULL): 30 / 100 / 300
    assert (select rate_ai_analyses_per_month from plans where id = 'starter') = 30,  'starter ai=30';
    assert (select rate_ai_analyses_per_month from plans where id = 'agency')  = 100, 'agency ai=100';
    assert (select rate_ai_analyses_per_month from plans where id = 'scale')   = 300, 'scale ai=300';

    -- other rate_* + storage are NULL (unlimited / uncapped)
    for r in select id from plans where id in ('starter','agency','scale') loop
      assert (select rate_instagram_syncs_per_day   from plans where id = r.id) is null,
        format('%s rate_instagram_syncs_per_day must be NULL', r.id);
      assert (select rate_report_generations_per_month from plans where id = r.id) is null,
        format('%s rate_report_generations_per_month must be NULL', r.id);
      assert (select storage_quota_bytes from plans where id = r.id) is null,
        format('%s storage_quota_bytes must be NULL', r.id);
    end loop;

    -- Seat DISPLAY price (centavos) is set and SHARED across all three tiers: 2500 / 25000.
    -- These back the cost breakdown / computeSeatCost; a NULL here would 400 listActivePlans.
    for r in select id from plans where id in ('starter','agency','scale') loop
      assert (select seat_addon_brl from plans where id = r.id) = 2500,
        format('%s seat_addon_brl expected 2500', r.id);
      assert (select seat_addon_brl_annual from plans where id = r.id) = 25000,
        format('%s seat_addon_brl_annual expected 25000', r.id);
    end loop;

    -- EVERY live feature_* column is TRUE on all three tiers (everything-included invariant).
    select array_agg(column_name::text order by column_name) into v_feature_cols
      from information_schema.columns
     where table_schema = 'public' and table_name = 'plans'
       and column_name like 'feature\_%';
    assert array_length(v_feature_cols, 1) >= 1, 'no feature_* columns found';
    for r in select id from plans where id in ('starter','agency','scale') loop
      foreach v_col in array v_feature_cols loop
        execute format('select %I from plans where id = $1', v_col)
          into v_all_true using r.id;
        assert v_all_true is true,
          format('feature %s must be TRUE on %s', v_col, r.id);
      end loop;
    end loop;

    -- Seat price-id columns exist on the plans table (may be NULL until operator pastes ids).
    perform 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'plans'
        and column_name = 'stripe_price_id_seat';
    assert found, 'plans.stripe_price_id_seat column must exist';
    perform 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'plans'
        and column_name = 'stripe_price_id_seat_annual';
    assert found, 'plans.stripe_price_id_seat_annual column must exist';

    raise notice 'PASS 07_catalog_slice1';
  end $$;
  ```

- [ ] **Step 2: Run the test & confirm it FAILS.**
  The local DB has the old catalog only (no `starter`/`agency`/`scale`, no seat columns). Run:
  ```bash
  psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/07_catalog_slice1.sql
  ```
  Expected FAIL: `ERROR: expected 3 active slice-1 tiers, got 0` (assertion in the first block), non-zero exit.

- [ ] **Step 3: Write the migration (seat-price-id columns + seat display-price columns + 3 tier rows).**
  Create `supabase/migrations/20260630000001_plans_seats_and_new_tiers.sql`. Column order in the INSERT matches the live `plans` table (verified against `20260430100001_plans_table.sql` + later additive migrations); the 19 `feature_*` columns are enumerated explicitly and every value is `true`. `is_default`/`updated_at` exist (added by `20260501000002`); `feature_mcp`/`max_mcp_keys` exist (added by `20260622120000`). The two `seat_addon_brl*` columns are added by THIS migration. Write this exact content:
  ```sql
  -- Slice 1: clients + seats hybrid. Additive & idempotent.
  -- 1) Two shared seat-PRICE-ID columns (one seat Price object shared across tiers).
  -- 2) Two seat DISPLAY-PRICE columns (centavos) that back the UI cost breakdown
  --    (computeSeatCost / listActivePlans select) — seeded shared across tiers.
  -- 3) Three new self-serve tiers (starter/agency/scale) as additive catalog rows.
  -- Does NOT move is_default (stays on 'free') and does NOT flip old plans inactive (Slice 4).

  alter table plans add column if not exists stripe_price_id_seat        text;
  alter table plans add column if not exists stripe_price_id_seat_annual text;
  -- Seat display price in centavos (monthly / annual). NULL on the legacy tiers; the
  -- three Slice-1 tiers set them so the cost breakdown has centavos to render.
  alter table plans add column if not exists seat_addon_brl        int;
  alter table plans add column if not exists seat_addon_brl_annual  int;

  -- "Everything included": EVERY live feature_* column is set TRUE explicitly.
  -- Future ADD COLUMN feature_* migrations MUST
  --   UPDATE plans SET <col> = true WHERE id IN ('starter','agency','scale');
  -- otherwise the NOT NULL DEFAULT false silently re-gates a paid tier.
  insert into plans (
    id, name, price_brl, price_brl_annual,
    stripe_price_id_seat, stripe_price_id_seat_annual,
    seat_addon_brl, seat_addon_brl_annual,
    max_clients, max_team_members, max_workflow_templates, max_active_workflows_per_client,
    max_instagram_accounts, max_leads, max_hub_tokens, storage_quota_bytes,
    max_custom_properties_per_template, max_posts_per_workflow, max_workspaces_per_user,
    max_mcp_keys,
    feature_instagram, feature_instagram_ai, feature_analytics_reports, feature_best_times,
    feature_audience_demographics, feature_hub_portal, feature_leads, feature_financial,
    feature_contracts, feature_ideas, feature_workflow_gantt, feature_workflow_recurrence,
    feature_csv_import, feature_custom_properties, feature_post_scheduling, feature_auto_sync_cron,
    feature_post_tagging, feature_brand_customization, feature_mcp,
    rate_instagram_syncs_per_day, rate_ai_analyses_per_month, rate_report_generations_per_month,
    sort_order, is_active, is_default
  ) values
    ('starter', 'Starter', 11000, 110000,
     null, null,
     2500, 25000,
     10, 2, null, null,
     null, null, null, null,
     null, null, null,
     null,
     true, true, true, true,
     true, true, true, true,
     true, true, true, true,
     true, true, true, true,
     true, true, true,
     null, 30, null,
     10, true, false),
    ('agency', 'Agency', 17900, 179000,
     null, null,
     2500, 25000,
     30, 5, null, null,
     null, null, null, null,
     null, null, null,
     null,
     true, true, true, true,
     true, true, true, true,
     true, true, true, true,
     true, true, true, true,
     true, true, true,
     null, 100, null,
     20, true, false),
    ('scale', 'Scale', 27900, 279000,
     null, null,
     2500, 25000,
     null, 10, null, null,
     null, null, null, null,
     null, null, null,
     null,
     true, true, true, true,
     true, true, true, true,
     true, true, true, true,
     true, true, true, true,
     true, true, true,
     null, 300, null,
     30, true, false)
  on conflict (id) do update set
    name                        = excluded.name,
    price_brl                   = excluded.price_brl,
    price_brl_annual            = excluded.price_brl_annual,
    seat_addon_brl              = excluded.seat_addon_brl,
    seat_addon_brl_annual       = excluded.seat_addon_brl_annual,
    max_clients                 = excluded.max_clients,
    max_team_members            = excluded.max_team_members,
    max_workflow_templates      = excluded.max_workflow_templates,
    max_active_workflows_per_client = excluded.max_active_workflows_per_client,
    max_instagram_accounts      = excluded.max_instagram_accounts,
    max_leads                   = excluded.max_leads,
    max_hub_tokens              = excluded.max_hub_tokens,
    storage_quota_bytes         = excluded.storage_quota_bytes,
    max_custom_properties_per_template = excluded.max_custom_properties_per_template,
    max_posts_per_workflow      = excluded.max_posts_per_workflow,
    max_workspaces_per_user     = excluded.max_workspaces_per_user,
    max_mcp_keys                = excluded.max_mcp_keys,
    feature_instagram           = excluded.feature_instagram,
    feature_instagram_ai        = excluded.feature_instagram_ai,
    feature_analytics_reports   = excluded.feature_analytics_reports,
    feature_best_times          = excluded.feature_best_times,
    feature_audience_demographics = excluded.feature_audience_demographics,
    feature_hub_portal          = excluded.feature_hub_portal,
    feature_leads               = excluded.feature_leads,
    feature_financial           = excluded.feature_financial,
    feature_contracts           = excluded.feature_contracts,
    feature_ideas               = excluded.feature_ideas,
    feature_workflow_gantt      = excluded.feature_workflow_gantt,
    feature_workflow_recurrence = excluded.feature_workflow_recurrence,
    feature_csv_import          = excluded.feature_csv_import,
    feature_custom_properties   = excluded.feature_custom_properties,
    feature_post_scheduling     = excluded.feature_post_scheduling,
    feature_auto_sync_cron      = excluded.feature_auto_sync_cron,
    feature_post_tagging        = excluded.feature_post_tagging,
    feature_brand_customization = excluded.feature_brand_customization,
    feature_mcp                 = excluded.feature_mcp,
    rate_instagram_syncs_per_day = excluded.rate_instagram_syncs_per_day,
    rate_ai_analyses_per_month  = excluded.rate_ai_analyses_per_month,
    rate_report_generations_per_month = excluded.rate_report_generations_per_month,
    sort_order                  = excluded.sort_order,
    is_active                   = excluded.is_active;
  -- NOTE: ON CONFLICT does NOT touch is_default (keeps the single-default invariant)
  -- nor the stripe_price_id_seat* columns (operator pastes those via admin).
  ```

- [ ] **Step 4: Apply the migration locally & re-run the test (expected PASS).**
  ```bash
  npx supabase db reset
  psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/07_catalog_slice1.sql
  ```
  Expected PASS: `NOTICE:  PASS 07_catalog_slice1`, exit 0. (`db reset` replays migrations; `07_catalog_slice1.sql` reads against the migrated catalog. Seed is updated in Step 5 so `db reset` stays consistent regardless.)

- [ ] **Step 5: Mirror the rows in `supabase/seed.sql`.**
  The current seed INSERT column list (lines 5–16) is `id, name, price_brl, price_brl_annual, max_clients, max_team_members, …` — it does NOT include the seat-price-id columns, `max_mcp_keys`, the seat_addon columns, or `feature_mcp` (the seed predates all of them). The `values` list ends with the `('max', …)` tuple terminated by a semicolon (line 37):
  ```sql
     50, 30, 30, 3, true, false);
  ```
  **Add the two `seat_addon_brl*` columns to the seed's INSERT column list so the seeded Slice-1 rows carry the display price (2500/25000) even without `db reset` replaying the migration's UPDATE.** First change the seed column list — replace this header fragment (lines 5–7):
  ```sql
  insert into plans (
    id, name, price_brl, price_brl_annual,
    max_clients, max_team_members, max_workflow_templates, max_active_workflows_per_client,
  ```
  with:
  ```sql
  insert into plans (
    id, name, price_brl, price_brl_annual,
    seat_addon_brl, seat_addon_brl_annual,
    max_clients, max_team_members, max_workflow_templates, max_active_workflows_per_client,
  ```
  Then update the existing four tuples so each leads its `max_clients` value with two `null, null` seat-addon values (legacy tiers have no seat display price). Concretely, for each existing row insert `null, null,` immediately after the `price_brl_annual` pair — e.g. the `free` row's `2, 1, 1, 1, …` becomes `null, null, 2, 1, 1, 1, …`, and likewise for `start` / `pro` / `max`. (Edit the four legacy tuples' opening lines: `free` `2, 1, …` → `null, null, 2, 1, …`; `start` `5, 1, …` → `null, null, 5, 1, …`; `pro` `15, 3, …` → `null, null, 15, 3, …`; `max` `null, null, null, null, …` → `null, null, null, null, null, null, …`.)
  Finally, replace the closing tuple-terminator on the `max` row (line 37) to append the three new rows, each leading its `max_clients` value with the seat-addon pair `2500, 25000,`. Change:
  ```sql
     50, 30, 30, 3, true, false);
  ```
  to:
  ```sql
     50, 30, 30, 3, true, false),
    ('starter', 'Starter', 11000, 110000,
     2500, 25000,
     10, 2, null, null, null, null, null, null, null, null, null,
     true, true, true, true, true, true, true, true, true, true, true, true,
     true, true, true, true, true, true,
     null, 30, null, 10, true, false),
    ('agency', 'Agency', 17900, 179000,
     2500, 25000,
     30, 5, null, null, null, null, null, null, null, null, null,
     true, true, true, true, true, true, true, true, true, true, true, true,
     true, true, true, true, true, true,
     null, 100, null, 20, true, false),
    ('scale', 'Scale', 27900, 279000,
     2500, 25000,
     null, 10, null, null, null, null, null, null, null, null, null,
     true, true, true, true, true, true, true, true, true, true, true, true,
     true, true, true, true, true, true,
     null, 300, null, 30, true, false);
  ```
  (The seed's 18-`feature_*` column list does NOT include `feature_mcp`; `feature_mcp NOT NULL DEFAULT false` makes seeded `starter`/`agency`/`scale` ship `feature_mcp=false` locally. That is acceptable — `07_catalog_slice1.sql` runs after `db reset`, which replays migration `20260630000001` whose `ON CONFLICT … DO UPDATE` flips `feature_mcp=true`. Migrations run after seed in `db reset`, so the migration's UPDATE wins. The `seat_addon_brl*` are now seeded directly, and the migration's `ON CONFLICT … DO UPDATE` also re-asserts 2500/25000, so both paths agree.)

- [ ] **Step 6: Re-run `db reset` + the full entitlements suite to confirm no regression.**
  ```bash
  npx supabase db reset
  npm run test:db
  ```
  Expected: `PASS supabase/tests/entitlements/07_catalog_slice1.sql` plus all existing files PASS, `failures=0`.

- [ ] **Step 7: Commit.**
  ```bash
  git add supabase/migrations/20260630000001_plans_seats_and_new_tiers.sql supabase/seed.sql supabase/tests/entitlements/07_catalog_slice1.sql
  git commit -m "feat(billing): add starter/agency/scale tiers + seat price columns to plans catalog

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

### Task 3: Migration — add `workspace_subscriptions.purchased_seats`

**Files:**
- Create: `supabase/migrations/20260630000002_workspace_subscriptions_purchased_seats.sql`
- Test path: assertion added inline below (no dedicated entitlements file; verified by Task 4's tests + a direct column-existence check here).

**Interfaces:**
- Consumes: nothing.
- Produces: `workspace_subscriptions.purchased_seats int NOT NULL DEFAULT 0` — Task 4's `effective_plan_limit` rewrite, the `et_seed_subscription` helper, the webhook (`syncSubscription`), `billing-seats`, and `workspace-limits` all read this column. EXTRA seats beyond the tier base; the webhook is the only writer.

- [ ] **Step 1: Write a FAILING column-existence probe.**
  Create a throwaway probe at `supabase/tests/entitlements/_probe_purchased_seats.sql` (deleted in Step 4 — it is NOT a `[0-9]*` file so the runner never picks it up):
  ```sql
  \set ON_ERROR_STOP on
  do $$
  begin
    perform 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'workspace_subscriptions'
        and column_name = 'purchased_seats'
        and is_nullable = 'NO'
        and column_default = '0';
    assert found, 'workspace_subscriptions.purchased_seats must exist, be NOT NULL, default 0';
    raise notice 'PASS purchased_seats column';
  end $$;
  ```

- [ ] **Step 2: Run the probe & confirm it FAILS.**
  ```bash
  psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/_probe_purchased_seats.sql
  ```
  Expected FAIL: `ERROR: workspace_subscriptions.purchased_seats must exist, be NOT NULL, default 0`, non-zero exit (column not yet present on the local DB).

- [ ] **Step 3: Write the migration.**
  Create `supabase/migrations/20260630000002_workspace_subscriptions_purchased_seats.sql`:
  ```sql
  -- Slice 1: EXTRA seats purchased beyond the tier-included base, mirrored from Stripe.
  -- The stripe-webhook is the ONLY writer (status-aware: 0 unless active/trialing).
  -- effective_plan_limit('max_team_members') adds this term, status-gated.
  -- Inherits workspace_subscriptions' existing owner-read + service-role RLS (no new policy).
  alter table workspace_subscriptions
    add column if not exists purchased_seats int not null default 0;
  ```

- [ ] **Step 4: Apply, re-run the probe (expected PASS), then delete the probe.**
  ```bash
  npx supabase db reset
  psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/_probe_purchased_seats.sql
  rm supabase/tests/entitlements/_probe_purchased_seats.sql
  ```
  Expected: `NOTICE:  PASS purchased_seats column`, exit 0; then the probe file is removed (its job is done; the column is exercised for real by Task 4).

- [ ] **Step 5: Commit.**
  ```bash
  git add supabase/migrations/20260630000002_workspace_subscriptions_purchased_seats.sql
  git commit -m "feat(billing): add workspace_subscriptions.purchased_seats column

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

### Task 4: `CREATE OR REPLACE effective_plan_limit` — additive status-gated seats + SQL tests

**Files:**
- Create: `supabase/migrations/20260630000003_effective_plan_limit_seats.sql`
- Modify: `supabase/tests/entitlements/_helpers.sql` (append the `et_seed_subscription` helper after `et_make_workspace`, lines 1–15)
- Modify: `supabase/tests/entitlements/01_effective_plan_limit.sql` (add `max_team_members` seat cases inside the first `begin;/do $$ … $$;/rollback;` block)
- Modify: `supabase/tests/entitlements/03_workspace_scoped.sql` (add a `purchased_seats=1` case in the `do $$ … $$;` block)

**Interfaces:**
- Consumes (EXACT):
  - `workspace_subscriptions.purchased_seats int NOT NULL DEFAULT 0` (Task 3).
  - Plan rows from Task 2 (`starter` base `max_team_members=2`).
  - `et_make_workspace(p_plan_id text, p_overrides jsonb default null) returns uuid` (existing helper).
- Produces (EXACT):
  - `effective_plan_limit(ws_id uuid, limit_key text) returns bigint` — for `limit_key='max_team_members'`: NULL-base short-circuits to NULL; an admin `resource_overrides.max_team_members` returns outright (no seat add); otherwise `base + COALESCE((SELECT purchased_seats FROM workspace_subscriptions WHERE workspace_id=ws_id AND status IN ('active','trialing')),0)`. All OTHER keys byte-identical to `20260611130001`. `invite-user/index.ts:139` and the `trg_limit_seats` trigger consume it unchanged.
  - `et_seed_subscription(p_ws uuid, p_seats int, p_status text default 'active')` — inserts a `workspace_subscriptions` row with `purchased_seats` + `status` for use inside the rolled-back test tx.

- [ ] **Step 1: Add the seeding helper to `_helpers.sql` (test-infrastructure, not yet asserted).**
  Read the current `_helpers.sql` — it ends at line 15 (`$$;` closing `et_make_workspace`). Append after it. `workspace_subscriptions.plan_id` has an FK to `plans(id)` and is nullable, so the helper passes `plan_id => null` to stay tier-agnostic. Add:
  ```sql

  -- Seeds the Stripe mirror row for a workspace inside a rolled-back tx, so
  -- effective_plan_limit's status-gated purchased_seats term can be exercised.
  -- plan_id left NULL (nullable FK) — these tests don't depend on the mirror's plan_id.
  create or replace function et_seed_subscription(p_ws uuid, p_seats int, p_status text default 'active')
  returns void language plpgsql as $$
  begin
    insert into workspace_subscriptions (workspace_id, status, purchased_seats)
      values (p_ws, p_status, p_seats)
    on conflict (workspace_id) do update
      set status = excluded.status, purchased_seats = excluded.purchased_seats;
  end;
  $$;
  ```

- [ ] **Step 2: Write the FAILING seat assertions in `01_effective_plan_limit.sql`.**
  Read the current first block. It ends with:
  ```sql
    -- fail-closed: unknown workspace
    assert effective_plan_limit('00000000-0000-0000-0000-000000000000', 'max_clients') = 0,
      'unknown workspace must fail closed to 0';

    raise notice 'PASS 01_effective_plan_limit';
  end $$;
  rollback;
  ```
  Insert the seat cases immediately before the `raise notice` line, so they share the rolled-back tx. Replace that fragment with:
  ```sql
    -- fail-closed: unknown workspace
    assert effective_plan_limit('00000000-0000-0000-0000-000000000000', 'max_clients') = 0,
      'unknown workspace must fail closed to 0';

    -- SEATS: max_team_members = base + purchased_seats (status-gated).
    -- starter base max_team_members = 2.
    v_ws := et_make_workspace('starter');
    -- no subscription row => +0
    v_lim := effective_plan_limit(v_ws, 'max_team_members');
    assert v_lim = 2, format('starter no-sub seats expected 2, got %s', v_lim);

    -- active sub with 1 purchased seat => 2 + 1 = 3
    v_ws := et_make_workspace('starter');
    perform et_seed_subscription(v_ws, 1, 'active');
    v_lim := effective_plan_limit(v_ws, 'max_team_members');
    assert v_lim = 3, format('starter +1 active seat expected 3, got %s', v_lim);

    -- trialing also adds
    v_ws := et_make_workspace('starter');
    perform et_seed_subscription(v_ws, 2, 'trialing');
    v_lim := effective_plan_limit(v_ws, 'max_team_members');
    assert v_lim = 4, format('starter +2 trialing seats expected 4, got %s', v_lim);

    -- canceled status => seats NOT added (billing-bypass guard)
    v_ws := et_make_workspace('starter');
    perform et_seed_subscription(v_ws, 5, 'canceled');
    v_lim := effective_plan_limit(v_ws, 'max_team_members');
    assert v_lim = 2, format('starter canceled seats must not add (expected 2), got %s', v_lim);

    -- NULL base via explicit null admin override => unlimited, never base+seats.
    v_ws := et_make_workspace('starter', '{"max_team_members": null}'::jsonb);
    perform et_seed_subscription(v_ws, 4, 'active');
    assert effective_plan_limit(v_ws, 'max_team_members') is null,
      'NULL base (override) must stay unlimited, never base+seats';

    -- admin numeric override (comp) returns OUTRIGHT, seats NOT stacked.
    v_ws := et_make_workspace('starter', '{"max_team_members": 8}'::jsonb);
    perform et_seed_subscription(v_ws, 4, 'active');
    v_lim := effective_plan_limit(v_ws, 'max_team_members');
    assert v_lim = 8, format('comp override must win outright (expected 8, no seat add), got %s', v_lim);

    raise notice 'PASS 01_effective_plan_limit';
  end $$;
  rollback;
  ```
  (If the existing `declare` block of this `do $$` does not already declare `v_lim bigint;`, add it alongside the existing `v_ws`/`v_lim` declarations — the existing block already uses `v_ws` and `v_lim`, so no new declaration is expected.)

- [ ] **Step 3: Run `01` & confirm it FAILS (current RPC has no seat logic).**
  ```bash
  npx supabase db reset
  psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/01_effective_plan_limit.sql
  ```
  Expected FAIL: the current `effective_plan_limit` returns the bare plan base (2) ignoring seats, so `ERROR: starter +1 active seat expected 3, got 2`, non-zero exit. (`db reset` already applied Tasks 2 & 3 migrations, so `starter` and `purchased_seats` exist; only the seat-additive RPC is missing.)

- [ ] **Step 4: Write the `CREATE OR REPLACE` migration.**
  Create `supabase/migrations/20260630000003_effective_plan_limit_seats.sql`. This is the full function body from `20260611130001` with the `max_team_members` additive term added in the documented order; all other keys byte-identical. Write this exact content:
  ```sql
  -- Slice 1: effective_plan_limit now adds purchased seats to max_team_members.
  -- Never edit the historical 20260611130001 file in place — ship a new CREATE OR REPLACE.
  -- Contract for max_team_members (all other keys byte-identical to 20260611130001):
  --   1. base = admin resource_overrides.max_team_members if present, else plans.max_team_members.
  --   2. base IS NULL  => return NULL (unlimited; do NOT coalesce(base,0)+seats).
  --   3. admin override present => return it OUTRIGHT (comp is replacement; seats NOT stacked).
  --   4. else => base + COALESCE(purchased_seats WHERE status IN ('active','trialing'), 0).
  --   5. fail-closed 0 for unknown ws / unknown key / malformed override / missing plan.
  create or replace function effective_plan_limit(ws_id uuid, limit_key text)
  returns bigint
  language plpgsql
  security definer
  set search_path = public
  stable
  as $$
  declare
    v_plan_id text;
    v_override jsonb;
    v_raw text;
    v_limit bigint;
    v_rows bigint;
    v_seats bigint;
  begin
    select plan_id into v_plan_id from workspaces where id = ws_id;
    if not found then
      return 0; -- unknown workspace
    end if;

    if v_plan_id is null then
      select id into v_plan_id from plans where is_default limit 1;
      if v_plan_id is null then
        return 0; -- no default plan configured
      end if;
    end if;

    select resource_overrides into v_override
      from workspace_plan_overrides where workspace_id = ws_id;
    if v_override is not null and v_override ? limit_key then
      v_raw := v_override ->> limit_key;
      if v_raw is null then
        return null;                 -- explicit null override => unlimited
      elsif v_raw ~ '^-?[0-9]+$' then
        return v_raw::bigint;        -- admin override wins OUTRIGHT (seats not stacked)
      else
        return 0;                    -- malformed override => fail closed
      end if;
    end if;

    begin
      execute format('select %I from plans where id = $1', limit_key)
        into v_limit using v_plan_id;
      get diagnostics v_rows = row_count;
    exception when undefined_column then
      return 0;                      -- unknown limit_key => fail closed
    end;
    if v_rows = 0 then
      return 0;                      -- plan row missing
    end if;

    -- Additive purchased seats: ONLY for max_team_members, ONLY when base is non-NULL.
    -- NULL base short-circuits to unlimited (never base+seats). Comp overrides already
    -- returned above. Seats are status-gated to (active|trialing); a missing sub row
    -- coalesces to +0 and never errors.
    if limit_key = 'max_team_members' and v_limit is not null then
      select coalesce(
        (select purchased_seats from workspace_subscriptions
           where workspace_id = ws_id and status in ('active','trialing')), 0)
        into v_seats;
      return v_limit + v_seats;
    end if;

    return v_limit; -- may be NULL => unlimited
  end;
  $$;
  ```
  Note: re-read `supabase/migrations/20260611130001_effective_plan_limit.sql` before writing and reconcile the non-`max_team_members` body byte-for-byte (declarations, override parsing, fail-closed branches). If the historical file differs in any line outside the new seat block, prefer the historical text — the only intended diff is the added `v_seats` declaration and the `max_team_members` additive block.

- [ ] **Step 5: Apply & re-run `01` (expected PASS).**
  ```bash
  npx supabase db reset
  psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/01_effective_plan_limit.sql
  ```
  Expected PASS: `NOTICE:  PASS 01_effective_plan_limit` (and any later notices in the file), exit 0.

- [ ] **Step 6: Write the FAILING `03_workspace_scoped.sql` seat case.**
  Read the current SEATS block. The real block uses `free` (`max_team_members=1`) and its tail is the assertion `assert v_blocked, 'second seat must block on free';` (followed by an INSTAGRAM block, then the final `raise notice`). Add a `purchased_seats=1` scenario by appending it immediately after the free-seat assertion — this keeps the existing free-floor case and the instagram case intact. The new block also needs three more uuid locals; since the outer `declare` only has `v_uid2`/`v_uid3`, declare the new users in an inner `declare … begin … end;` block (as shown). Replace this exact fragment (the free-seat block tail):
  ```sql
  insert into workspace_members (user_id, workspace_id, role) values (v_uid2, v_ws, 'owner');
  v_blocked := false;
  begin insert into workspace_members (user_id, workspace_id, role) values (v_uid3, v_ws, 'agent');
  exception when sqlstate 'P0001' then v_blocked := true; end;
  assert v_blocked, 'second seat must block on free';
  ```
  with:
  ```sql
  insert into workspace_members (user_id, workspace_id, role) values (v_uid2, v_ws, 'owner');
  v_blocked := false;
  begin insert into workspace_members (user_id, workspace_id, role) values (v_uid3, v_ws, 'agent');
  exception when sqlstate 'P0001' then v_blocked := true; end;
  assert v_blocked, 'second seat must block on free';

  -- SEATS + purchased_seats: starter base max_team_members = 2; +1 purchased seat => 3 allowed.
  -- 2 members succeed (base 2), the 3rd succeeds (base 2 + 1 purchased), the 4th must block.
  v_ws := et_make_workspace('starter');
  perform et_seed_subscription(v_ws, 1, 'active');
  declare
    v_u1 uuid := gen_random_uuid();
    v_u2 uuid := gen_random_uuid();
    v_u3 uuid := gen_random_uuid();
    v_u4 uuid := gen_random_uuid();
  begin
    insert into auth.users (id) values (v_u1), (v_u2), (v_u3), (v_u4);
    insert into workspace_members (user_id, workspace_id, role) values (v_u1, v_ws, 'owner');
    insert into workspace_members (user_id, workspace_id, role) values (v_u2, v_ws, 'agent');
    -- 3rd seat allowed (base 2 + 1 purchased = 3)
    insert into workspace_members (user_id, workspace_id, role) values (v_u3, v_ws, 'agent');
    -- 4th must block
    v_blocked := false;
    begin insert into workspace_members (user_id, workspace_id, role) values (v_u4, v_ws, 'agent');
    exception when sqlstate 'P0001' then v_blocked := true; end;
    assert v_blocked, 'seat over (base+purchased) must block';
  end;
  ```
  (The existing INSTAGRAM block and the final `raise notice 'PASS 03_workspace_scoped';` are left untouched and still run after this inserted block.)

- [ ] **Step 7: Run `03` (expected PASS) and confirm it would have FAILED without the RPC.**
  ```bash
  psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/03_workspace_scoped.sql
  ```
  Expected PASS: `NOTICE:  PASS 03_workspace_scoped`, exit 0. (The new block relies on the seat-additive RPC from Step 4: with `purchased_seats=1` the trigger's limit is `base 2 + 1 = 3`, so the 3rd member succeeds and the 4th blocks. Without the RPC change the 3rd insert would block and the assert chain would error earlier — confirming the test exercises the new behavior.)

- [ ] **Step 8: Run the full entitlements suite + edge tests for no regression.**
  ```bash
  npm run test:db
  deno test supabase/functions/
  ```
  Expected: every entitlements file PASS, `failures=0`; Deno edge suite green (the RPC change is consumed unchanged by `invite-user`).

- [ ] **Step 9: Commit.**
  ```bash
  git add supabase/migrations/20260630000003_effective_plan_limit_seats.sql supabase/tests/entitlements/_helpers.sql supabase/tests/entitlements/01_effective_plan_limit.sql supabase/tests/entitlements/03_workspace_scoped.sql
  git commit -m "feat(billing): effective_plan_limit adds status-gated purchased seats to max_team_members

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

### Task 5: Webhook — multi-item classification, status-aware seats, no silent downgrade

Refactor `stripe-webhook`'s `syncSubscription` so it classifies **all** subscription items by `price_id` (never by array index), resolves the tier via `resolvePlanFromPriceId`, computes purchased seats via `resolveSubscriptionSeats`, derives `current_period_end` from the **resolved tier item**, persists `purchased_seats` status-aware (0 unless `active`/`trialing`), and **leaves `workspaces.plan_id` unchanged** when no tier resolves (killing the silent default-plan fallback) — throwing 5xx on an active sub that has a seat item but no resolvable tier, and preserving the prior `workspace_subscriptions.plan_id` when unresolved.

The decision logic is extracted into a new **pure, exported** helper `resolveSyncTarget` inside `stripe-webhook/index.ts` so it is Deno-unit-testable without Stripe/Supabase. `loadPlanPriceRows` is extended to select the two seat columns.

**Files:**
- Modify: `supabase/functions/stripe-webhook/index.ts`
  - line 4-8: import block — add `resolveSubscriptionSeats`
  - line 79-122: `syncSubscription` — rewrite to use the new pure helper
  - line 172-176: `loadPlanPriceRows` — extend select
  - new pure helper `resolveSyncTarget` (added near the top, after imports)
- Create: `supabase/functions/__tests__/stripe-webhook-seats_test.ts` (Test path)

**Interfaces:**
- Consumes (Task 1, `supabase/functions/_shared/billing-logic.ts`):
  - `interface PlanPriceRow { id: string; stripe_price_id: string | null; stripe_price_id_annual: string | null; stripe_price_id_seat: string | null; stripe_price_id_seat_annual: string | null; }`
  - `resolveSubscriptionSeats(subItems: Array<{ price?: { id?: string | null } | null; quantity?: number | null }>, plans: PlanPriceRow[]): { purchased_seats: number }`
  - `resolvePlanFromPriceId(priceId: string, plans: PlanPriceRow[]): { plan_id: string; interval: "month" | "year" } | null` (tier-only)
- Produces (relied on by no later task, but exported for testing):
  - `resolveSyncTarget(args: { items: SubItem[]; status: string; plans: PlanPriceRow[]; priorPlanId: string | null }): { planIdToWrite: string | null; mirrorPlanId: string | null; billingInterval: "month" | "year" | null; purchasedSeats: number; periodEndUnix: number | null; mustThrow: boolean }`
  - where `interface SubItem { price?: { id?: string | null } | null; quantity?: number | null; current_period_end?: number | null }`

- [ ] **Step 1: Write the FAILING test for `resolveSyncTarget`.**

Create `supabase/functions/__tests__/stripe-webhook-seats_test.ts`:

```ts
import { assert, assertEquals } from "./assert.ts";
import { resolveSyncTarget } from "../stripe-webhook/index.ts";
import type { PlanPriceRow } from "../_shared/billing-logic.ts";

const PLANS: PlanPriceRow[] = [
  {
    id: "agency",
    stripe_price_id: "price_agency_m",
    stripe_price_id_annual: "price_agency_y",
    stripe_price_id_seat: "price_seat_m",
    stripe_price_id_seat_annual: "price_seat_y",
  },
  {
    id: "scale",
    stripe_price_id: "price_scale_m",
    stripe_price_id_annual: "price_scale_y",
    stripe_price_id_seat: "price_seat_m",
    stripe_price_id_seat_annual: "price_seat_y",
  },
];

Deno.test("resolveSyncTarget: tier+seat resolves plan, seats, period from tier item (seat-first order)", () => {
  const r = resolveSyncTarget({
    items: [
      { price: { id: "price_seat_m" }, quantity: 3, current_period_end: 111 },
      { price: { id: "price_agency_m" }, quantity: 1, current_period_end: 222 },
    ],
    status: "active",
    plans: PLANS,
    priorPlanId: "agency",
  });
  assertEquals(r.planIdToWrite, "agency");
  assertEquals(r.mirrorPlanId, "agency");
  assertEquals(r.billingInterval, "month");
  assertEquals(r.purchasedSeats, 3);
  assertEquals(r.periodEndUnix, 222);
  assertEquals(r.mustThrow, false);
});

Deno.test("resolveSyncTarget: tier+seat order-independent (tier-first)", () => {
  const r = resolveSyncTarget({
    items: [
      { price: { id: "price_agency_m" }, quantity: 1, current_period_end: 222 },
      { price: { id: "price_seat_m" }, quantity: 3, current_period_end: 111 },
    ],
    status: "active",
    plans: PLANS,
    priorPlanId: "agency",
  });
  assertEquals(r.planIdToWrite, "agency");
  assertEquals(r.purchasedSeats, 3);
  assertEquals(r.periodEndUnix, 222);
  assertEquals(r.mustThrow, false);
});

Deno.test("resolveSyncTarget: tier-only sub yields 0 purchased seats", () => {
  const r = resolveSyncTarget({
    items: [{ price: { id: "price_agency_y" }, quantity: 1, current_period_end: 900 }],
    status: "active",
    plans: PLANS,
    priorPlanId: null,
  });
  assertEquals(r.planIdToWrite, "agency");
  assertEquals(r.billingInterval, "year");
  assertEquals(r.purchasedSeats, 0);
  assertEquals(r.periodEndUnix, 900);
  assertEquals(r.mustThrow, false);
});

Deno.test("resolveSyncTarget: canceled status forces purchased seats to 0 and downgrades plan write to null mirror", () => {
  const r = resolveSyncTarget({
    items: [
      { price: { id: "price_agency_m" }, quantity: 1, current_period_end: 222 },
      { price: { id: "price_seat_m" }, quantity: 4, current_period_end: 222 },
    ],
    status: "canceled",
    plans: PLANS,
    priorPlanId: "agency",
  });
  // canceled writes the default plan downgrade upstream; here purchased must be 0
  assertEquals(r.purchasedSeats, 0);
  // tier still resolves so mirror reflects the resolved tier
  assertEquals(r.mirrorPlanId, "agency");
  assertEquals(r.mustThrow, false);
});

Deno.test("resolveSyncTarget: no tier resolves -> leave plan unchanged, preserve prior mirror, no throw on inactive status", () => {
  const r = resolveSyncTarget({
    items: [{ price: { id: "price_grandfathered_unknown" }, quantity: 1, current_period_end: 500 }],
    status: "past_due",
    plans: PLANS,
    priorPlanId: "pro",
  });
  assertEquals(r.planIdToWrite, null);
  assertEquals(r.mirrorPlanId, "pro"); // preserved, never nulled
  assertEquals(r.billingInterval, null);
  assertEquals(r.purchasedSeats, 0);
  assertEquals(r.periodEndUnix, 500);
  assertEquals(r.mustThrow, false);
});

Deno.test("resolveSyncTarget: active sub with seat item but no resolvable tier -> mustThrow", () => {
  const r = resolveSyncTarget({
    items: [
      { price: { id: "price_seat_m" }, quantity: 2, current_period_end: 700 },
      { price: { id: "price_grandfathered_unknown" }, quantity: 1, current_period_end: 700 },
    ],
    status: "active",
    plans: PLANS,
    priorPlanId: "agency",
  });
  assert(r.mustThrow === true);
});
```

- [ ] **Step 2: Run the test & confirm it FAILS.**

```bash
deno test supabase/functions/__tests__/stripe-webhook-seats_test.ts
```

Expected FAIL: `error: TS2305 [ERROR]: Module '"../stripe-webhook/index.ts"' has no exported member 'resolveSyncTarget'.` (the helper does not exist yet; `resolveSubscriptionSeats` and the extended `PlanPriceRow` are provided by Task 1).

- [ ] **Step 3: Add the `resolveSubscriptionSeats` import.**

Current `supabase/functions/stripe-webhook/index.ts` lines 4-8:

```ts
import {
  resolvePlanFromPriceId,
  statusToPlanId,
  type PlanPriceRow,
} from "../_shared/billing-logic.ts";
```

Replace with:

```ts
import {
  resolvePlanFromPriceId,
  resolveSubscriptionSeats,
  statusToPlanId,
  type PlanPriceRow,
} from "../_shared/billing-logic.ts";
```

- [ ] **Step 4: Add the pure `resolveSyncTarget` helper.**

Insert immediately after the import block / env constants (after line 16's closing `})();` for `STRIPE_WEBHOOK_SECRET`, before `Deno.serve`). Add:

```ts
export interface SubItem {
  price?: { id?: string | null } | null;
  quantity?: number | null;
  current_period_end?: number | null;
}

/**
 * Pure decision logic for syncSubscription. Classifies all subscription items
 * by price_id (never by array index), resolves the tier item, computes purchased
 * seats, and derives the period-end from the resolved tier item.
 *
 *  - `planIdToWrite`: value for statusToPlanId's subscribedPlanId path — null means
 *    "no tier resolved, leave workspaces.plan_id unchanged" (kills the silent default fallback).
 *  - `mirrorPlanId`: value for workspace_subscriptions.plan_id — the resolved tier, or the
 *    prior mirror value when nothing resolves (never overwritten with null).
 *  - `purchasedSeats`: Stripe seat quantity, forced to 0 unless status is active/trialing.
 *  - `periodEndUnix`: current_period_end from the resolved tier item (basil fallback), or null.
 *  - `mustThrow`: true when an ACTIVE/TRIALING sub has a seat item but no resolvable tier —
 *    the caller must throw 5xx so Stripe redelivers (a shared seat price cannot identify a tier).
 */
export function resolveSyncTarget(args: {
  items: SubItem[];
  status: string;
  plans: PlanPriceRow[];
  priorPlanId: string | null;
}): {
  planIdToWrite: string | null;
  mirrorPlanId: string | null;
  billingInterval: "month" | "year" | null;
  purchasedSeats: number;
  periodEndUnix: number | null;
  mustThrow: boolean;
} {
  const { items, status, plans, priorPlanId } = args;

  // 1. Resolve the TIER item by scanning every item (order-independent).
  let resolved: { plan_id: string; interval: "month" | "year" } | null = null;
  let tierItem: SubItem | null = null;
  for (const it of items) {
    const pid = it?.price?.id ?? null;
    if (!pid) continue;
    const r = resolvePlanFromPriceId(pid, plans);
    if (r) {
      resolved = r;
      tierItem = it;
      break;
    }
  }

  // 2. Purchased seats from the seat item(s), status-aware.
  const rawSeats = resolveSubscriptionSeats(items, plans).purchased_seats;
  const seatsLive = status === "active" || status === "trialing";
  const purchasedSeats = seatsLive ? rawSeats : 0;

  // 3. Did a seat item exist at all?
  const hasSeatItem = rawSeats > 0;

  // 4. Active/trialing sub with a seat item but no tier -> unrecoverable; force redelivery.
  const mustThrow = seatsLive && tierItem === null && hasSeatItem;

  // 5. period-end: prefer the resolved tier item; else fall back to the first item present.
  const periodEndUnix = (tierItem?.current_period_end ?? items?.[0]?.current_period_end) ?? null;

  return {
    planIdToWrite: resolved?.plan_id ?? null,
    mirrorPlanId: resolved?.plan_id ?? priorPlanId ?? null,
    billingInterval: resolved?.interval ?? null,
    purchasedSeats,
    periodEndUnix,
    mustThrow,
  };
}
```

- [ ] **Step 5: Run the helper test & confirm it PASSES.**

```bash
deno test supabase/functions/__tests__/stripe-webhook-seats_test.ts
```

Expected PASS: `ok | 7 passed | 0 failed`.

- [ ] **Step 6: Commit the pure helper + test.**

```bash
git add supabase/functions/stripe-webhook/index.ts supabase/functions/__tests__/stripe-webhook-seats_test.ts
git commit -m "feat(webhook): pure resolveSyncTarget helper (multi-item, status-aware seats)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 7: Wire `resolveSyncTarget` into `syncSubscription` (rewrite the body).**

Current `supabase/functions/stripe-webhook/index.ts` lines 79-122:

```ts
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

  // current_period_end lives on the subscription root in older API versions (acacia) and
  // on the first subscription item in basil (2025-03-31)+. Webhook payloads use the account's
  // API version regardless of the SDK pin, so read whichever is present.
  const subPeriod = sub as unknown as {
    current_period_end?: number;
    items?: { data?: Array<{ current_period_end?: number }> };
  };
  const periodEndUnix = subPeriod.current_period_end
    ?? subPeriod.items?.data?.[0]?.current_period_end
    ?? null;

  await svc.from("workspace_subscriptions").upsert({
    workspace_id: workspaceId,
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    status: sub.status,
    plan_id: resolved?.plan_id ?? null,
    billing_interval: resolved?.interval ?? null,
    current_period_end: periodEndUnix
      ? new Date(periodEndUnix * 1000).toISOString() : null,
    cancel_at_period_end: sub.cancel_at_period_end ?? false,
    updated_at: new Date().toISOString(),
  }, { onConflict: "workspace_id" });

  const targetPlanId = statusToPlanId(sub.status, subscribedPlanId, defaultPlanId);
  if (targetPlanId !== null) {
    await writeWorkspacePlan(svc, workspaceId, targetPlanId);
  }
}
```

Replace the entire function with:

```ts
async function syncSubscription(
  svc: SupabaseClient,
  sub: Stripe.Subscription,
  session: Stripe.Checkout.Session | null,
) {
  const workspaceId = await resolveWorkspaceId(svc, sub, session);
  if (!workspaceId) throw new Error(`Could not resolve workspace for subscription ${sub.id}`);

  const plans = await loadPlanPriceRows(svc);
  const defaultPlanId = await getDefaultPlanId(svc);
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;

  // Read the prior mirror plan_id so we never overwrite it with null when no tier resolves.
  const { data: priorRow } = await svc
    .from("workspace_subscriptions").select("plan_id")
    .eq("workspace_id", workspaceId).maybeSingle();
  const priorPlanId = (priorRow?.plan_id as string | null) ?? null;

  // Classify ALL items by price_id (never index 0); current_period_end lives on the item
  // in basil (2025-03-31)+. The subscription-root value (acacia) is preferred when present.
  const subPeriod = sub as unknown as { current_period_end?: number };
  const items = (sub.items?.data ?? []) as unknown as SubItem[];

  const target = resolveSyncTarget({
    items,
    status: sub.status,
    plans,
    priorPlanId,
  });

  if (target.mustThrow) {
    // Active sub with a seat item but no resolvable tier: a shared seat price cannot
    // identify a tier, so the default fallback cannot recover it. Throw 5xx for redelivery.
    console.error(
      `[stripe-webhook] active subscription ${sub.id} has a seat item but no resolvable tier price`,
    );
    throw new Error("Unresolvable tier on active subscription with seat item");
  }

  const periodEndUnix = subPeriod.current_period_end ?? target.periodEndUnix ?? null;

  await svc.from("workspace_subscriptions").upsert({
    workspace_id: workspaceId,
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    status: sub.status,
    plan_id: target.mirrorPlanId,
    billing_interval: target.billingInterval,
    purchased_seats: target.purchasedSeats,
    current_period_end: periodEndUnix
      ? new Date(periodEndUnix * 1000).toISOString() : null,
    cancel_at_period_end: sub.cancel_at_period_end ?? false,
    updated_at: new Date().toISOString(),
  }, { onConflict: "workspace_id" });

  // No tier resolved -> leave workspaces.plan_id unchanged (skip writeWorkspacePlan),
  // matching past_due/incomplete null semantics. Never write the default on an unresolved tier.
  if (target.planIdToWrite === null) return;

  const targetPlanId = statusToPlanId(sub.status, target.planIdToWrite, defaultPlanId);
  if (targetPlanId !== null) {
    await writeWorkspacePlan(svc, workspaceId, targetPlanId);
  }
}
```

- [ ] **Step 8: Extend `loadPlanPriceRows` to select the seat columns.**

Current `supabase/functions/stripe-webhook/index.ts` lines 172-176:

```ts
async function loadPlanPriceRows(svc: SupabaseClient): Promise<PlanPriceRow[]> {
  const { data } = await svc.from("plans")
    .select("id, stripe_price_id, stripe_price_id_annual");
  return (data ?? []) as PlanPriceRow[];
}
```

Replace with:

```ts
async function loadPlanPriceRows(svc: SupabaseClient): Promise<PlanPriceRow[]> {
  const { data } = await svc.from("plans")
    .select(
      "id, stripe_price_id, stripe_price_id_annual, stripe_price_id_seat, stripe_price_id_seat_annual",
    );
  return (data ?? []) as PlanPriceRow[];
}
```

- [ ] **Step 9: Typecheck the rewritten function with `deno check`.**

```bash
deno check supabase/functions/stripe-webhook/index.ts
```

Expected PASS: `Check file:///.../supabase/functions/stripe-webhook/index.ts` with no errors. (Confirms `resolveSubscriptionSeats`, the extended `PlanPriceRow`, `SubItem`, and the upsert's new `purchased_seats` key all typecheck.)

- [ ] **Step 10: Re-run the seats test to confirm no regression after the wiring.**

```bash
deno test supabase/functions/__tests__/stripe-webhook-seats_test.ts
```

Expected PASS: `ok | 7 passed | 0 failed`.

- [ ] **Step 11: Run the full edge-function suite to confirm no regressions.**

```bash
deno test supabase/functions/
```

Expected PASS: all suites green (including the unchanged `billing-logic_test.ts`).

- [ ] **Step 12: Restore `deno.lock` / reinstall node_modules so `npm run build` is not polluted.**

```bash
git checkout deno.lock && npm ci
```

(Per the repo gotcha: `deno test`/`deno check` pollute the shared `node_modules` + `deno.lock` and break `npm run build`.)

- [ ] **Step 13: Commit the `syncSubscription` rewrite + extended select.**

```bash
git add supabase/functions/stripe-webhook/index.ts
git commit -m "feat(webhook): multi-item sync — status-aware seats, no silent downgrade

Classify all sub.items by price_id (never index 0); resolve tier via
resolvePlanFromPriceId; persist purchased_seats status-aware; leave
workspaces.plan_id unchanged when no tier resolves; throw 5xx on an active
sub with a seat item but no resolvable tier; preserve prior mirror plan_id;
extend loadPlanPriceRows select with the two seat columns.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 6: billing-checkout — DB-driven PAID_PLANS + Stripe quantity seat line item

**Files:**
- Modify `supabase/functions/_shared/billing-logic.ts` (append pure helpers after line 46; the file currently ends at the `resolvePlanFromPriceId` closing `}` on line 46)
- Modify `supabase/functions/billing-checkout/index.ts` (PAID_PLANS at line 8; plans select at lines 42–47; line_items at line 91; subscription_data.metadata at line 93)
- Create test `supabase/functions/__tests__/billing-checkout-lineitems_test.ts`

**Interfaces:**

Consumes:
- `interface PlanPriceRow` (from `_shared/billing-logic.ts`) — extended elsewhere with `stripe_price_id_seat: string | null` and `stripe_price_id_seat_annual: string | null`. Task 6 does not depend on that extension for its own helpers (they take primitives), only the runtime `index.ts` select reads the new columns.
- DB columns `plans.stripe_price_id_seat`, `plans.stripe_price_id_seat_annual` (migration task) — runtime-only; the Deno unit test does not touch the DB.

Produces (later tasks rely on these EXACT names/types):
- `buildLineItems(args: { tierPriceId: string; seatPriceId: string | null; extraSeats: number }): { ok: true; lineItems: Array<{ price: string; quantity: number }> } | { ok: false; error: string }` — pure, in `_shared/billing-logic.ts`. `extraSeats <= 0` → single tier item; `extraSeats > 0` with falsy `seatPriceId` → `{ ok: false, error: "Seat price not configured for this interval" }`; `extraSeats > 0` with a seat price → two items, the seat item `{ price: seatPriceId, quantity: extraSeats }`. Never emits a `quantity: 0` line.
- `clampExtraSeats(input: unknown): number` — pure, in `_shared/billing-logic.ts`. Coerces to a non-negative integer, default 0 (floors negatives/NaN/non-numbers to 0, truncates fractions).
- `validatePaidPlan(plan: { is_active?: boolean | null; tierPriceId?: string | null } | null): boolean` — pure, in `_shared/billing-logic.ts`. True iff `plan` exists, `is_active === true`, and `tierPriceId` is a non-empty string. (`tierPriceId` = the interval-matched tier price the caller resolved.)
- `billing-checkout` request body now reads `extra_seats?: number >= 0`.
- `billing-checkout` `subscription_data.metadata.seats: string` (audit only — never an entitlement source).

- [ ] **Step 1: Write the FAILING Deno unit test for the new pure helpers.**

Create `supabase/functions/__tests__/billing-checkout-lineitems_test.ts`:

```ts
import { assert, assertEquals } from "./assert.ts";
import {
  buildLineItems,
  clampExtraSeats,
  validatePaidPlan,
} from "../_shared/billing-logic.ts";

Deno.test("buildLineItems: 0 extra seats → single tier line item", () => {
  const r = buildLineItems({ tierPriceId: "price_tier_m", seatPriceId: "price_seat_m", extraSeats: 0 });
  assert(r.ok);
  assertEquals(r.lineItems, [{ price: "price_tier_m", quantity: 1 }]);
});

Deno.test("buildLineItems: N extra seats → two line items (tier + seat qty N)", () => {
  const r = buildLineItems({ tierPriceId: "price_tier_m", seatPriceId: "price_seat_m", extraSeats: 3 });
  assert(r.ok);
  assertEquals(r.lineItems, [
    { price: "price_tier_m", quantity: 1 },
    { price: "price_seat_m", quantity: 3 },
  ]);
});

Deno.test("buildLineItems: never emits a quantity-0 seat line", () => {
  const r = buildLineItems({ tierPriceId: "price_tier_m", seatPriceId: "price_seat_m", extraSeats: 0 });
  assert(r.ok);
  assertEquals(r.lineItems.length, 1);
  for (const li of r.lineItems) assert(li.quantity > 0);
});

Deno.test("buildLineItems: annual + extra seats but no annual seat price → error (no items)", () => {
  const r = buildLineItems({ tierPriceId: "price_tier_y", seatPriceId: null, extraSeats: 2 });
  assert(!r.ok);
  assertEquals(r.error, "Seat price not configured for this interval");
});

Deno.test("buildLineItems: missing seat price but 0 extra seats → still single tier item, ok", () => {
  const r = buildLineItems({ tierPriceId: "price_tier_y", seatPriceId: null, extraSeats: 0 });
  assert(r.ok);
  assertEquals(r.lineItems, [{ price: "price_tier_y", quantity: 1 }]);
});

Deno.test("clampExtraSeats: floors and truncates to a non-negative integer, default 0", () => {
  assertEquals(clampExtraSeats(undefined), 0);
  assertEquals(clampExtraSeats(null), 0);
  assertEquals(clampExtraSeats("nope"), 0);
  assertEquals(clampExtraSeats(-5), 0);
  assertEquals(clampExtraSeats(2.9), 2);
  assertEquals(clampExtraSeats(7), 7);
  assertEquals(clampExtraSeats("4"), 4);
});

Deno.test("validatePaidPlan: accepts an active plan with a tier price", () => {
  assert(validatePaidPlan({ is_active: true, tierPriceId: "price_agency_m" }));
  assert(validatePaidPlan({ is_active: true, tierPriceId: "price_starter_y" }));
  assert(validatePaidPlan({ is_active: true, tierPriceId: "price_scale_m" }));
});

Deno.test("validatePaidPlan: rejects unknown/inactive/price-less plans", () => {
  assert(!validatePaidPlan(null));
  assert(!validatePaidPlan({ is_active: false, tierPriceId: "price_old_m" }));
  assert(!validatePaidPlan({ is_active: true, tierPriceId: null }));
  assert(!validatePaidPlan({ is_active: true, tierPriceId: "" }));
  assert(!validatePaidPlan({ tierPriceId: "price_x" }));
});
```

- [ ] **Step 2: Run the test and confirm it FAILS (helpers do not exist yet).**

```bash
deno test supabase/functions/__tests__/billing-checkout-lineitems_test.ts
```

Expected: FAIL — the import errors because `buildLineItems`, `clampExtraSeats`, and `validatePaidPlan` are not exported from `../_shared/billing-logic.ts` (e.g. `SyntaxError: The requested module '../_shared/billing-logic.ts' does not provide an export named 'buildLineItems'`).

- [ ] **Step 3: Add the MINIMAL pure helpers to `_shared/billing-logic.ts`.**

The file currently ends at line 46 with the closing `}` of `resolvePlanFromPriceId`. Append after it:

```ts

/** Coerces an untrusted seat input to a non-negative integer (default 0). */
export function clampExtraSeats(input: unknown): number {
  const n = typeof input === "number" ? input : Number(input);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

/**
 * Builds Stripe checkout line items for a tier + optional seat add-on.
 * - extraSeats <= 0 → just the tier item (never a quantity-0 seat line).
 * - extraSeats > 0  → tier item plus a seat item { price: seatPriceId, quantity: extraSeats }.
 * - extraSeats > 0 with a falsy seatPriceId → error (caller must 400 before any Stripe call,
 *   because a missing interval-matched seat price means Stripe would get mixed intervals).
 */
export function buildLineItems(args: {
  tierPriceId: string;
  seatPriceId: string | null;
  extraSeats: number;
}):
  | { ok: true; lineItems: Array<{ price: string; quantity: number }> }
  | { ok: false; error: string } {
  const lineItems: Array<{ price: string; quantity: number }> = [
    { price: args.tierPriceId, quantity: 1 },
  ];
  if (args.extraSeats > 0) {
    if (!args.seatPriceId) {
      return { ok: false, error: "Seat price not configured for this interval" };
    }
    lineItems.push({ price: args.seatPriceId, quantity: args.extraSeats });
  }
  return { ok: true, lineItems };
}

/**
 * DB-driven paid-plan check: the plan must exist, be active, and have an
 * interval-matched tier price id. Replaces the hardcoded PAID_PLANS allowlist so
 * the catalog is the single source of truth.
 */
export function validatePaidPlan(
  plan: { is_active?: boolean | null; tierPriceId?: string | null } | null,
): boolean {
  return !!plan && plan.is_active === true && typeof plan.tierPriceId === "string" &&
    plan.tierPriceId.length > 0;
}
```

- [ ] **Step 4: Run the test and confirm it PASSES.**

```bash
deno test supabase/functions/__tests__/billing-checkout-lineitems_test.ts
```

Expected: PASS — all 8 `Deno.test` cases (`buildLineItems` x5, `clampExtraSeats`, `validatePaidPlan` x2) report `ok`.

- [ ] **Step 5: Commit the pure helpers + their test.**

```bash
git add supabase/functions/_shared/billing-logic.ts supabase/functions/__tests__/billing-checkout-lineitems_test.ts
git commit -m "feat(billing-checkout): pure buildLineItems/clampExtraSeats/validatePaidPlan helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 6: Wire the helpers into `billing-checkout/index.ts` — import them and drop the hardcoded PAID_PLANS constant.**

Current line 8:

```ts
const PAID_PLANS = ["start", "pro", "max"];
```

Current line 3 import block (lines 1–3):

```ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders, resolveAllowedOrigin } from "../_shared/cors.ts";
import { stripe } from "../_shared/stripe.ts";
```

Add the helper import after line 3 and delete the PAID_PLANS constant. Replace lines 1–8:

```ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders, resolveAllowedOrigin } from "../_shared/cors.ts";
import { stripe } from "../_shared/stripe.ts";
import {
  buildLineItems,
  clampExtraSeats,
  validatePaidPlan,
} from "../_shared/billing-logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
```

(The two `Deno.env.get` lines on the original lines 5–6 are preserved verbatim; only the `PAID_PLANS` line is removed and the import block grows.)

- [ ] **Step 7: Read seats, drop the array check, extend the plans select, validate DB-driven, pick the interval-matched seat price, and 400 before any Stripe call when the seat price is missing.**

Current lines 36–47:

```ts
    const body = await req.json().catch(() => ({}));
    const planId = String(body.plan_id || "");
    const interval = body.interval === "year" ? "year" : "month";
    const promoCode = String(body.promo_code || "").trim().toUpperCase();
    if (!PAID_PLANS.includes(planId)) return json({ error: "Invalid plan" }, 400, headers);

    const { data: plan } = await svc
      .from("plans")
      .select("id, stripe_price_id, stripe_price_id_annual")
      .eq("id", planId).single();
    const priceId = interval === "year" ? plan?.stripe_price_id_annual : plan?.stripe_price_id;
    if (!priceId) return json({ error: "Plan price not configured" }, 400, headers);
```

Replace with:

```ts
    const body = await req.json().catch(() => ({}));
    const planId = String(body.plan_id || "");
    const interval = body.interval === "year" ? "year" : "month";
    const promoCode = String(body.promo_code || "").trim().toUpperCase();
    const extraSeats = clampExtraSeats(body.extra_seats);

    const { data: plan } = await svc
      .from("plans")
      .select(
        "id, is_active, stripe_price_id, stripe_price_id_annual, stripe_price_id_seat, stripe_price_id_seat_annual",
      )
      .eq("id", planId).single();
    const priceId = interval === "year" ? plan?.stripe_price_id_annual : plan?.stripe_price_id;

    // DB-driven validation: the plan must exist, be active, and have an
    // interval-matched tier price. This replaces the old hardcoded PAID_PLANS
    // allowlist so the catalog is the single source of truth.
    if (!validatePaidPlan({ is_active: plan?.is_active, tierPriceId: priceId })) {
      return json({ error: "Plan price not configured" }, 400, headers);
    }

    const seatPriceId = (interval === "year"
      ? plan?.stripe_price_id_seat_annual
      : plan?.stripe_price_id_seat) ?? null;

    // Build line items up front so we can 400 BEFORE any Stripe call if a seat was
    // requested on an interval with no matching seat price (Stripe rejects mixed
    // intervals). priceId is guaranteed non-empty by validatePaidPlan above.
    const lineItemsResult = buildLineItems({
      tierPriceId: priceId as string,
      seatPriceId,
      extraSeats,
    });
    if (!lineItemsResult.ok) {
      return json({ error: lineItemsResult.error }, 400, headers);
    }
    const lineItems = lineItemsResult.lineItems;
```

- [ ] **Step 8: Use the built line items and add seats to metadata (audit only); leave promo/trial logic byte-for-byte.**

Current lines 87–103 (the `stripe.checkout.sessions.create` call):

```ts
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: workspaceId,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        metadata: { workspace_id: workspaceId, plan_id: planId },
        ...(trialDays ? { trial_period_days: trialDays } : {}),
      },
      // Allow promotion codes; skip card collection when a 100%-off coupon leaves
      // nothing due. With a trial we collect the card upfront so billing succeeds
      // when the trial ends.
      allow_promotion_codes: true,
      payment_method_collection: trialDays ? "always" : "if_required",
      success_url: `${appBaseUrl}/configuracao/cobranca?status=success`,
      cancel_url: `${appBaseUrl}/configuracao/cobranca?status=cancelled`,
    });
```

Replace the `line_items` line and the `subscription_data.metadata` line only (everything else — `allow_promotion_codes`, `payment_method_collection`, the trial spread, urls — stays byte-for-byte):

```ts
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: workspaceId,
      line_items: lineItems,
      subscription_data: {
        // seats is AUDIT-ONLY: metadata is client-influenced and must NEVER be read
        // as an entitlement source. The webhook derives purchased seats from the
        // Stripe line-item quantity, never from this value.
        metadata: { workspace_id: workspaceId, plan_id: planId, seats: String(extraSeats) },
        ...(trialDays ? { trial_period_days: trialDays } : {}),
      },
      // Allow promotion codes; skip card collection when a 100%-off coupon leaves
      // nothing due. With a trial we collect the card upfront so billing succeeds
      // when the trial ends.
      allow_promotion_codes: true,
      payment_method_collection: trialDays ? "always" : "if_required",
      success_url: `${appBaseUrl}/configuracao/cobranca?status=success`,
      cancel_url: `${appBaseUrl}/configuracao/cobranca?status=cancelled`,
    });
```

- [ ] **Step 9: Typecheck the edge function (no Stripe/env needed for `deno check`).**

```bash
deno check supabase/functions/billing-checkout/index.ts
```

Expected: PASS — no type errors. (If `deno check` pollutes `deno.lock`/`node_modules`, restore with `git checkout deno.lock && npm ci` per the toolchain note; do not commit lock churn.)

- [ ] **Step 10: Re-run the full Deno edge-function suite to confirm no regression in billing-logic or checkout helpers.**

```bash
deno test supabase/functions/
```

Expected: PASS — including `billing-checkout-lineitems_test.ts` (8 cases) and the unchanged `billing-logic_test.ts`.

- [ ] **Step 11: Commit the index wiring.**

```bash
git add supabase/functions/billing-checkout/index.ts
git commit -m "feat(billing-checkout): DB-driven plan validation + Stripe quantity seat line item

- drop hardcoded PAID_PLANS; validate plan exists + is_active + interval-matched price
- select seat price columns; read+clamp extra_seats
- 400 before any Stripe call when extra_seats>0 and the interval seat price is missing
- push seat line item only when extra_seats>0; add seats to metadata (audit only)
- trial/promo logic left byte-for-byte

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 12: Confirm the existing frontend checkout-shape test still passes (additive-only change — no edit owned here).**

The frontend assertions in `apps/crm/src/services/__tests__/billing.test.ts` assert `startCheckout('pro', 'year')` posts exactly `{ plan_id: 'pro', interval: 'year' }` and the promo variant adds `promo_code`. `extra_seats` is additive (sent only when `> 0`), so these stay green and `billing.ts` itself is owned by the frontend cluster. Verify, do not modify:

```bash
npm run test -- apps/crm/src/services/__tests__/billing.test.ts
```

Expected: PASS — all existing cases unchanged. (If a later frontend task changes `billing.ts` to send `extra_seats`, that task owns updating these expectations; Task 6 requires no edit here.)

### Task 7: `billing-seats` edge function — in-app seat change (owner-only, validated Stripe `subscriptions.update`)

**Files:**
- Modify: `supabase/functions/_shared/billing-logic.ts` (append pure helper `decideSeatItemUpdate` + `SeatItemUpdate` type after line 46; do NOT touch `resolveSubscriptionSeats`, which Task 2 adds to the same file)
- Create: `supabase/functions/billing-seats/index.ts`
- Modify: `supabase/functions/billing-portal/index.ts` (add a comment that seat changes go through `billing-seats` — no functional change, §4.5)
- Create: `supabase/migrations/20260630000005_seat_occupancy_locked.sql`
- Modify: `supabase/config.toml` (add `[functions.billing-seats]` block after the `[functions.billing-portal]` block at lines 112–113)
- Modify: `supabase/functions/__tests__/config-audit_test.ts` (add `"billing-seats"` to `REQUIRED_FUNCTIONS`, lines 57–60 region)
- Test: `supabase/functions/__tests__/billing-seats_test.ts` (NEW — the four-transition decision + config registration + migration column/lock assertions)

**Interfaces:**

Consumes (from earlier tasks — use these EXACT signatures):
- Task 2 — `interface PlanPriceRow` (in `_shared/billing-logic.ts`) extended with `stripe_price_id_seat: string | null` and `stripe_price_id_seat_annual: string | null`.
- Task 4 — `workspace_subscriptions.purchased_seats int NOT NULL DEFAULT 0` (read-only here; this fn NEVER writes it).
- Task 5 — `plans.max_team_members` is the seat base; `effective_plan_limit` is unchanged by this task.
- Existing — `_shared/stripe.ts` exports `stripe`; `_shared/cors.ts` exports `buildCorsHeaders(req)`.
- Existing — advisory lock from `enforce_plan_count_limit` (migration `20260611130002_enforce_plan_count_limit_fn.sql`, **line 38**): `pg_advisory_xact_lock(hashtext(v_ws_id::text || ':' || v_limit_key))` where `v_limit_key='max_team_members'`. The seat-occupancy RPC MUST compose the byte-identical key so the two paths serialize.
- Existing — `invites` table is keyed on **`conta_id`** (NOT `workspace_id`); see `supabase/migrations/20260316_invites_table.sql` line 7 (`conta_id uuid NOT NULL`, no `workspace_id` column) and `supabase/functions/invite-user/index.ts:143-144` (`adminClient.from("invites").select(...).eq("conta_id", profile.conta_id).eq("status", "pending")`). `workspace_members` IS keyed on `workspace_id`.

Produces (later tasks rely on these EXACT names):
- `decideSeatItemUpdate(args: { seatItemId: string | null; seatPriceId: string | null; extraSeats: number }): SeatItemUpdate`
- `type SeatItemUpdate = { kind: "noop" } | { kind: "update"; items: [{ id: string; quantity: number }] } | { kind: "remove"; items: [{ id: string; deleted: true }] } | { kind: "add"; items: [{ price: string; quantity: number }] }`
- Edge fn `billing-seats`: POST body `{ extra_seats: number >= 0 }`; owner-only; `409 "Reduza usuários antes de remover assentos"` when `(base + extra_seats) < occupied`; `proration_behavior: "create_prorations"`; the only writer of `purchased_seats` remains `stripe-webhook` (this fn does NOT write it).
- SQL RPC `seat_occupancy_locked(ws_id uuid) returns bigint` — takes the seat trigger's advisory lock, returns `members + pending invites`.
- Frontend Task (services/billing.ts) `changeSeats(extraSeats)` POSTs to `/functions/v1/billing-seats`.

---

- [ ] **Step 1: Write the FAILING test for the pure four-way branch decision (`decideSeatItemUpdate`).**

Create `supabase/functions/__tests__/billing-seats_test.ts`:

```ts
import { assert, assertEquals } from "./assert.ts";
import { decideSeatItemUpdate } from "../_shared/billing-logic.ts";

// Branch matrix: (seatItemExists, N) → Stripe subscriptions.update items payload.
// Hard rule: never quantity:0 — removal uses { deleted: true }.

Deno.test("decideSeatItemUpdate: exists & N>0 → update quantity", () => {
  const r = decideSeatItemUpdate({ seatItemId: "si_1", seatPriceId: "price_seat_m", extraSeats: 3 });
  assertEquals(r, { kind: "update", items: [{ id: "si_1", quantity: 3 }] });
});

Deno.test("decideSeatItemUpdate: exists & N==0 → remove via deleted:true (never quantity:0)", () => {
  const r = decideSeatItemUpdate({ seatItemId: "si_1", seatPriceId: "price_seat_m", extraSeats: 0 });
  assertEquals(r, { kind: "remove", items: [{ id: "si_1", deleted: true }] });
});

Deno.test("decideSeatItemUpdate: !exists & N>0 → add the seat price line", () => {
  const r = decideSeatItemUpdate({ seatItemId: null, seatPriceId: "price_seat_m", extraSeats: 2 });
  assertEquals(r, { kind: "add", items: [{ price: "price_seat_m", quantity: 2 }] });
});

Deno.test("decideSeatItemUpdate: !exists & N==0 → noop", () => {
  const r = decideSeatItemUpdate({ seatItemId: null, seatPriceId: "price_seat_m", extraSeats: 0 });
  assertEquals(r, { kind: "noop" });
});

Deno.test("decideSeatItemUpdate: never emits quantity:0 in any branch", () => {
  for (const exists of [true, false]) {
    for (const n of [0, 1, 5]) {
      const r = decideSeatItemUpdate({
        seatItemId: exists ? "si_1" : null,
        seatPriceId: "price_seat_m",
        extraSeats: n,
      });
      if ("items" in r) {
        for (const it of r.items) {
          assert(!("quantity" in it && it.quantity === 0), "must never emit quantity:0");
        }
      }
    }
  }
});
```

- [ ] **Step 2: Run the test — expect FAIL (helper does not exist yet).**

```
deno test supabase/functions/__tests__/billing-seats_test.ts
```

Expected: failure — `error: The module's source code could not be parsed: ... has no exported member 'decideSeatItemUpdate'` (import error before any test runs).

- [ ] **Step 3: Add the MINIMAL pure helper to `_shared/billing-logic.ts`.**

The current file ends at line 46 with `resolvePlanFromPriceId`'s closing `}`. Append (after line 46):

```ts

/** Stripe `subscriptions.update` `items` payload for an in-app seat change. */
export type SeatItemUpdate =
  | { kind: "noop" }
  | { kind: "update"; items: [{ id: string; quantity: number }] }
  | { kind: "remove"; items: [{ id: string; deleted: true }] }
  | { kind: "add"; items: [{ price: string; quantity: number }] };

/**
 * Four-way branch on (seatItemExists, N=extraSeats) for `subscriptions.update`.
 * Hard rule: never emit `quantity: 0` — Stripe rejects it; removal uses `{ deleted: true }`.
 *   exists & N>0  → update quantity
 *   exists & N==0 → remove via deleted:true
 *   !exists & N>0 → add the seat price line
 *   !exists & N==0 → no-op
 */
export function decideSeatItemUpdate(args: {
  seatItemId: string | null;
  seatPriceId: string | null;
  extraSeats: number;
}): SeatItemUpdate {
  const n = Math.max(0, Math.trunc(args.extraSeats));
  if (args.seatItemId) {
    return n > 0
      ? { kind: "update", items: [{ id: args.seatItemId, quantity: n }] }
      : { kind: "remove", items: [{ id: args.seatItemId, deleted: true }] };
  }
  return n > 0
    ? { kind: "add", items: [{ price: args.seatPriceId as string, quantity: n }] }
    : { kind: "noop" };
}
```

- [ ] **Step 4: Run the test — expect PASS.**

```
deno test supabase/functions/__tests__/billing-seats_test.ts
```

Expected: `ok | 5 passed | 0 failed`.

- [ ] **Step 5: Commit the pure helper + its test.**

```
git add supabase/functions/_shared/billing-logic.ts supabase/functions/__tests__/billing-seats_test.ts
git commit -m "feat(billing): decideSeatItemUpdate four-way seat-item branch (never quantity:0)"
```

- [ ] **Step 6: Write the FAILING config-registration test (extend `config-audit_test.ts`).**

In `supabase/functions/__tests__/config-audit_test.ts`, the `REQUIRED_FUNCTIONS` array currently ends (lines 57–61) with:

```ts
  // Billing (manual auth: user-JWT or Stripe signature)
  "billing-checkout",
  "billing-portal",
  "stripe-webhook",
];
```

Change to add `billing-seats`:

```ts
  // Billing (manual auth: user-JWT or Stripe signature)
  "billing-checkout",
  "billing-portal",
  "billing-seats",
  "stripe-webhook",
];
```

- [ ] **Step 7: Run the config-audit test — expect FAIL (config.toml not yet updated).**

```
deno test supabase/functions/__tests__/config-audit_test.ts
```

Expected: failure — `Error: Functions missing verify_jwt = false: billing-seats`.

- [ ] **Step 8: Register the function in `config.toml`.**

The current block (lines 112–116) reads:

```toml
[functions.billing-portal]
verify_jwt = false

[functions.stripe-webhook]
verify_jwt = false
```

Insert the new block between `billing-portal` and `stripe-webhook`:

```toml
[functions.billing-portal]
verify_jwt = false

[functions.billing-seats]
verify_jwt = false

[functions.stripe-webhook]
verify_jwt = false
```

- [ ] **Step 9: Run the config-audit test — expect PASS.**

```
deno test supabase/functions/__tests__/config-audit_test.ts
```

Expected: `ok | 1 passed | 0 failed`.

- [ ] **Step 10: Commit the config registration.**

```
git add supabase/config.toml supabase/functions/__tests__/config-audit_test.ts
git commit -m "feat(billing): register billing-seats edge fn (verify_jwt=false)"
```

- [ ] **Step 11: Write the FAILING SQL test for the `seat_occupancy_locked` migration (correct columns + matching advisory lock).**

The validate-decrease step calls a small SECURITY DEFINER RPC that takes the SAME advisory lock as `enforce_plan_count_limit` (`hashtext(ws::text || ':' || 'max_team_members')`, migration `20260611130002` line 38) and returns `members + pending invites`. Critically, `workspace_members` is keyed on `workspace_id` but `invites` is keyed on **`conta_id`** (see `20260316_invites_table.sql` line 7 and `invite-user/index.ts:143-144`). Add a Deno test that asserts the migration declares the lock with the exact matching expression AND counts the two tables on their correct columns. Append to `supabase/functions/__tests__/billing-seats_test.ts`:

```ts
Deno.test("seat_occupancy_locked migration: lock + correct columns (invites uses conta_id, not workspace_id)", async () => {
  const raw = await Deno.readTextFile(
    new URL("../../migrations/20260630000005_seat_occupancy_locked.sql", import.meta.url).pathname,
  );
  const sql = raw.replace(/\s+/g, " ");

  // Same advisory lock as enforce_plan_count_limit: hashtext(ws::text || ':' || 'max_team_members')
  assert(
    /pg_advisory_xact_lock\(\s*hashtext\(\s*ws_id::text\s*\|\|\s*':max_team_members'\s*\)\s*\)/.test(sql),
    "seat_occupancy_locked must lock hashtext(ws_id::text || ':max_team_members')",
  );

  // workspace_members IS keyed on workspace_id.
  assert(/workspace_members\s+where\s+workspace_id\s*=\s*ws_id/.test(sql),
    "must count workspace_members on workspace_id");

  // invites is keyed on conta_id — NOT workspace_id. This catches the wrong column red-before-green.
  assert(/invites[\s\S]*conta_id/.test(sql),
    "must count invites on conta_id (the invites table has no workspace_id column)");
  assert(!/invites\s+where\s+workspace_id/.test(sql),
    "must NOT reference a non-existent invites.workspace_id column");
  assert(/'pending'/.test(sql), "must count only pending invites");
});
```

- [ ] **Step 12: Run the test — expect FAIL (migration file does not exist).**

```
deno test supabase/functions/__tests__/billing-seats_test.ts
```

Expected: failure — `NotFound: No such file or directory ... 20260630000005_seat_occupancy_locked.sql`.

- [ ] **Step 13: Create the `seat_occupancy_locked` migration with the CORRECT columns (invites on `conta_id`).**

Create `supabase/migrations/20260630000005_seat_occupancy_locked.sql`:

```sql
-- Occupancy reader for billing-seats decrease validation. Takes the SAME advisory
-- lock as enforce_plan_count_limit('max_team_members') so a concurrent invite cannot
-- slip an extra member between the read and the seat decrease (TOCTOU).
-- occupancy = workspace_members + pending invites, matching the invite seat gate
-- in invite-user/index.ts:140-145 (members by workspace_id, invites by conta_id).
create or replace function seat_occupancy_locked(ws_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count bigint;
begin
  -- ADVISORY-LOCK KEY SYNC: byte-identical to the seat trigger so the two paths
  -- serialize. enforce_plan_count_limit (migration 20260611130002_enforce_plan_count_limit_fn.sql,
  -- line 38) composes the key as: pg_advisory_xact_lock(hashtext(v_ws_id::text || ':' || v_limit_key))
  -- with v_limit_key = 'max_team_members', i.e. the literal '<uuid>:max_team_members'.
  -- Building the same string here via ws_id::text || ':max_team_members' yields the
  -- same hashtext lock id. If you ever change one key, change BOTH.
  perform pg_advisory_xact_lock(hashtext(ws_id::text || ':max_team_members'));

  -- workspace_members is keyed on workspace_id; invites is keyed on conta_id
  -- (the invites table has NO workspace_id column — see 20260316_invites_table.sql).
  select
    (select count(*) from workspace_members where workspace_id = ws_id)
    + (select count(*) from invites
         where conta_id = ws_id and status = 'pending')
  into v_count;

  return coalesce(v_count, 0);
end;
$$;

revoke all on function seat_occupancy_locked(uuid) from public, anon, authenticated;
```

- [ ] **Step 14: Run the test — expect PASS.**

```
deno test supabase/functions/__tests__/billing-seats_test.ts
```

Expected: `ok | 6 passed | 0 failed`.

- [ ] **Step 15: Commit the occupancy migration + its test.**

```
git add supabase/migrations/20260630000005_seat_occupancy_locked.sql supabase/functions/__tests__/billing-seats_test.ts
git commit -m "feat(billing): seat_occupancy_locked RPC (invites by conta_id, advisory lock synced to seat trigger)"
```

- [ ] **Step 16: Create the `billing-seats` edge function (owner-only manual JWT; advisory-lock validate; four-way Stripe update; never writes purchased_seats).**

Create `supabase/functions/billing-seats/index.ts`:

```ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { stripe } from "../_shared/stripe.ts";
import { decideSeatItemUpdate } from "../_shared/billing-logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
    const extraSeats = Math.max(0, Math.trunc(Number(body.extra_seats)));
    if (!Number.isFinite(extraSeats)) {
      return json({ error: "Invalid extra_seats" }, 400, headers);
    }

    // Load the Stripe subscription mirror + the active tier (for base seats + seat price id).
    const { data: subRow } = await svc
      .from("workspace_subscriptions")
      .select("stripe_subscription_id, plan_id, status")
      .eq("workspace_id", workspaceId).maybeSingle();
    if (!subRow?.stripe_subscription_id) {
      return json({ error: "Sem assinatura ativa" }, 400, headers);
    }

    const { data: plan } = await svc
      .from("plans")
      .select("max_team_members, stripe_price_id_seat, stripe_price_id_seat_annual")
      .eq("id", subRow.plan_id).single();
    const base = plan?.max_team_members as number | null;

    // Validate the decrease under the SAME advisory lock the seat-count trigger uses,
    // closing the TOCTOU vs a concurrent invite. occupied = members + pending invites.
    // If base IS NULL (unlimited tier) the floor check is vacuous (capacity is unlimited).
    const { data: occupiedRow, error: occErr } = await svc
      .rpc("seat_occupancy_locked", { ws_id: workspaceId });
    if (occErr) {
      console.error("[billing-seats] occupancy rpc error:", occErr);
      return json({ error: "Internal server error" }, 500, headers);
    }
    const occupied = Number(occupiedRow ?? 0);
    if (base !== null && base + extraSeats < occupied) {
      return json({ error: "Reduza usuários antes de remover assentos" }, 409, headers);
    }

    // Retrieve the live subscription to find the existing seat line item (if any).
    const sub = await stripe.subscriptions.retrieve(subRow.stripe_subscription_id);
    const seatPriceMonthly = plan?.stripe_price_id_seat ?? null;
    const seatPriceAnnual = plan?.stripe_price_id_seat_annual ?? null;
    const seatPriceIds = new Set(
      [seatPriceMonthly, seatPriceAnnual].filter((x): x is string => !!x),
    );
    let seatItemId: string | null = null;
    let seatPriceId: string | null = null;
    for (const it of sub.items?.data ?? []) {
      if (it.price?.id && seatPriceIds.has(it.price.id)) {
        seatItemId = it.id;
        seatPriceId = it.price.id;
        break;
      }
    }
    // Adding a seat needs an interval-matched seat price; pick by the tier item's interval.
    if (!seatPriceId) {
      const tierIsAnnual = (sub.items?.data ?? []).some(
        (it) => it.price?.recurring?.interval === "year",
      );
      seatPriceId = tierIsAnnual ? seatPriceAnnual : seatPriceMonthly;
    }
    if (extraSeats > 0 && !seatItemId && !seatPriceId) {
      return json({ error: "Seat price not configured for this interval" }, 400, headers);
    }

    const decision = decideSeatItemUpdate({ seatItemId, seatPriceId, extraSeats });

    // billing-seats does NOT write workspace_subscriptions.purchased_seats — the
    // resulting customer.subscription.updated webhook is the only writer.
    if (decision.kind !== "noop") {
      await stripe.subscriptions.update(subRow.stripe_subscription_id, {
        items: decision.items,
        proration_behavior: "create_prorations",
      });
    }

    return json({ ok: true, trialing: sub.status === "trialing" }, 200, headers);
  } catch (err) {
    console.error("[billing-seats] error:", err);
    return json({ error: "Internal server error" }, 500, headers);
  }
});

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers });
}
```

- [ ] **Step 17: Add the cross-reference comment to `billing-portal/index.ts` (§4.5 — no functional change; keep `billing-seats` the single validated seat writer).**

`billing-portal/index.ts` has no functional change in Slice 1 (it stays for cancel / payment-method / invoice history). Add a comment documenting that seat changes go through `billing-seats`, so a future maintainer does not wire a quantity lever here. The current portal-session block reads (lines 32–35):

```ts
    const portal = await stripe.billingPortal.sessions.create({
      customer: subRow.stripe_customer_id,
      return_url: `${resolveAllowedOrigin(req)}/configuracao/cobranca`,
    });
```

Insert the comment immediately above it:

```ts
    // NOTE: seat changes do NOT go through the Stripe billing portal — they are
    // validated and applied by the `billing-seats` edge function (the single writer
    // that floors the requested total against members + pending invites). The Stripe
    // portal configuration MUST disable quantity edits on the seat product (see the
    // deploy checklist) so this portal never becomes a second, unvalidated seat writer.
    const portal = await stripe.billingPortal.sessions.create({
      customer: subRow.stripe_customer_id,
      return_url: `${resolveAllowedOrigin(req)}/configuracao/cobranca`,
    });
```

- [ ] **Step 18: Typecheck both edge functions compile under Deno.**

```
deno check supabase/functions/billing-seats/index.ts supabase/functions/billing-portal/index.ts
```

Expected: no errors (exit 0). If `deno check` pulls the npm graph and pollutes `deno.lock`/`node_modules`, restore afterwards per the repo gotcha: `git checkout deno.lock && npm ci`.

- [ ] **Step 19: Run the full Deno edge suite to confirm no regressions.**

```
deno test supabase/functions/
```

Expected: all tests pass, including `billing-seats_test.ts` (6) and `config-audit_test.ts` (1). Then restore the lockfile if touched: `git checkout deno.lock && npm ci`.

- [ ] **Step 20: Commit the edge function + portal comment.**

```
git add supabase/functions/billing-seats/index.ts supabase/functions/billing-portal/index.ts
git commit -m "feat(billing): billing-seats owner-only seat change (advisory-lock validate, four-way Stripe update, webhook-only purchased_seats writer)"
```

- [ ] **Step 21: Add the seat-portal guard to the deploy checklist.**

In the slice's deploy/prod-rollout checklist (§5 ordering doc / PR description), add the **medium**-severity bullet from §4.5 + §7:

> [ ] **Stripe billing-portal config:** confirm the portal configuration does **NOT** allow quantity edits on the seat product (and does not expose the seat line item for self-serve quantity changes). `billing-seats` is the single validated seat writer — a portal quantity lever would bypass the `(base + extra) >= occupied` floor and write seats without redelivering through `billing-seats`.

This is a config-console action (no repo change); record it as completed before the `billing-seats` deploy in the prod-safe ordering.

### Task 8: Server-computed `seats` block in `workspace-limits` + expose in `useWorkspaceLimits`

**Files:**
- Create `supabase/functions/workspace-limits/seats-block.ts` (pure helper, Deno-unit-testable — no Supabase/env deps)
- Modify `supabase/functions/workspace-limits/index.ts` (compute raw seat inputs in the handler, attach the `seats` block to the response; lines 31–54)
- Modify `apps/crm/src/hooks/useWorkspaceLimits.ts` (add `WorkspaceSeats` interface + optional `seats` on `WorkspaceLimitsResponse`; expose `seats` from the hook; lines 44–48, 82–89)
- Test (Deno): `supabase/functions/__tests__/workspace-limits-seats_test.ts`
- Test (Vitest): `apps/crm/src/hooks/__tests__/useWorkspaceLimits.test.tsx`

**Interfaces:**
- Consumes (from Task 5, SQL): `effective_plan_limit(ws_id uuid, limit_key text) returns bigint` — additive for `max_team_members` (`base + COALESCE(purchased_seats,0)` when base non-NULL; NULL stays NULL).
- Consumes (from Task 4, migration): `workspace_subscriptions.purchased_seats int NOT NULL DEFAULT 0`.
- Consumes (existing): `effectivePlanLimit(svc, workspaceId, "max_team_members"): Promise<number | null>` from `supabase/functions/_shared/entitlements-rpc.ts`.
- Produces: `buildSeatsBlock({ includedSeats, purchasedSeats, effectiveSeats, members, pendingInvites }): { included: number|null, purchased: number, effective: number|null, used: number }` exported from `supabase/functions/workspace-limits/seats-block.ts`.
- Produces: `workspace-limits` JSON response gains `seats: { included: number|null, purchased: number, effective: number|null, used: number }`.
- Produces: `WorkspaceSeats` interface + optional `seats?: WorkspaceSeats` returned by `useWorkspaceLimits()` (consumed by Task 11 `services/billing.ts` and the `CobrancaPage` seat selector).

- [ ] **Step 1: Write the failing Deno test for `buildSeatsBlock`.**
  Create `supabase/functions/__tests__/workspace-limits-seats_test.ts`:
  ```ts
  import { assertEquals } from "./assert.ts";
  import { buildSeatsBlock } from "../workspace-limits/seats-block.ts";

  Deno.test("buildSeatsBlock: included base + purchased + effective from RPC; used = members + pending", () => {
    assertEquals(
      buildSeatsBlock({
        includedSeats: 2,
        purchasedSeats: 1,
        effectiveSeats: 3,
        members: 2,
        pendingInvites: 1,
      }),
      { included: 2, purchased: 1, effective: 3, used: 3 },
    );
  });

  Deno.test("buildSeatsBlock: unlimited tier keeps included/effective null, purchased still surfaced", () => {
    assertEquals(
      buildSeatsBlock({
        includedSeats: null,
        purchasedSeats: 0,
        effectiveSeats: null,
        members: 5,
        pendingInvites: 0,
      }),
      { included: null, purchased: 0, effective: null, used: 5 },
    );
  });

  Deno.test("buildSeatsBlock: coerces nullish member/invite counts to 0", () => {
    assertEquals(
      buildSeatsBlock({
        includedSeats: 5,
        purchasedSeats: 0,
        effectiveSeats: 5,
        members: 0,
        pendingInvites: 0,
      }),
      { included: 5, purchased: 0, effective: 5, used: 0 },
    );
  });
  ```

- [ ] **Step 2: Run the test — expect FAIL (module does not exist).**
  Command: `deno test supabase/functions/__tests__/workspace-limits-seats_test.ts`
  Expected: failure resolving the import — `error: Module not found "file:///.../workspace-limits/seats-block.ts"`.

- [ ] **Step 3: Write the minimal `buildSeatsBlock` implementation.**
  Create `supabase/functions/workspace-limits/seats-block.ts`:
  ```ts
  export interface SeatsBlock {
    included: number | null;
    purchased: number;
    effective: number | null;
    used: number;
  }

  /**
   * Pure assembler for the workspace-limits `seats` block.
   * `included` = plan base max_team_members (override-agnostic plan column).
   * `purchased` = workspace_subscriptions.purchased_seats (EXTRA seats).
   * `effective` = effective_plan_limit('max_team_members') (NULL = unlimited).
   * `used` = active members + pending invites (matches the invite gate's count).
   */
  export function buildSeatsBlock(args: {
    includedSeats: number | null;
    purchasedSeats: number;
    effectiveSeats: number | null;
    members: number;
    pendingInvites: number;
  }): SeatsBlock {
    return {
      included: args.includedSeats,
      purchased: args.purchasedSeats ?? 0,
      effective: args.effectiveSeats,
      used: (args.members ?? 0) + (args.pendingInvites ?? 0),
    };
  }
  ```

- [ ] **Step 4: Run the test — expect PASS.**
  Command: `deno test supabase/functions/__tests__/workspace-limits-seats_test.ts`
  Expected: `ok | 3 passed | 0 failed`.

- [ ] **Step 5: Commit the pure helper + test.**
  ```bash
  git add supabase/functions/workspace-limits/seats-block.ts supabase/functions/__tests__/workspace-limits-seats_test.ts
  git commit -m "feat(workspace-limits): pure buildSeatsBlock helper for seats block"
  ```

- [ ] **Step 6: Wire the `seats` block into the `workspace-limits` handler.**
  The current handler (lines 31–54) reads only the profile + entitlements. Replace the block that begins at line 31 (`const { data: profile } = await svc`) through line 54 (the closing of the success `return`) — quoted current code:
  ```ts
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

      const ent = await resolveEntitlements(svc, workspaceId);
      if (!ent) {
        return new Response(JSON.stringify({ plan_name: null, limits: null, features: null }),
          { status: 200, headers });
      }
      return new Response(JSON.stringify({
        plan_name: ent.planName, limits: ent.limits, features: ent.features,
      }), { status: 200, headers });
  ```
  Replace it with (adds the plan-base read, purchased_seats read, effective RPC, member/invite counts, and the assembled block):
  ```ts
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

      const ent = await resolveEntitlements(svc, workspaceId);
      if (!ent) {
        return new Response(JSON.stringify({ plan_name: null, limits: null, features: null }),
          { status: 200, headers });
      }

      // Server-computed seats block (matches the invite gate: members + pending invites).
      // `included` is the plan's base max_team_members (not the override-merged limit);
      // `effective` comes from the additive RPC; `purchased` is the Stripe seat mirror.
      const { data: ws } = await svc
        .from("workspaces").select("plan_id").eq("id", workspaceId).single();
      let includedSeats: number | null = null;
      if (ws?.plan_id) {
        const { data: plan } = await svc
          .from("plans").select("max_team_members").eq("id", ws.plan_id).single();
        includedSeats = (plan?.max_team_members as number | null) ?? null;
      } else {
        const { data: plan } = await svc
          .from("plans").select("max_team_members").eq("is_default", true).maybeSingle();
        includedSeats = (plan?.max_team_members as number | null) ?? null;
      }

      const { data: sub } = await svc
        .from("workspace_subscriptions")
        .select("purchased_seats, status")
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      const purchasedSeats =
        sub && (sub.status === "active" || sub.status === "trialing")
          ? ((sub.purchased_seats as number | null) ?? 0)
          : 0;

      const effectiveSeats = await effectivePlanLimit(svc, workspaceId, "max_team_members");

      const [{ count: members }, { count: pending }] = await Promise.all([
        svc.from("workspace_members").select("*", { count: "exact", head: true })
          .eq("workspace_id", workspaceId),
        svc.from("invites").select("*", { count: "exact", head: true })
          .eq("conta_id", workspaceId).eq("status", "pending"),
      ]);

      const seats = buildSeatsBlock({
        includedSeats,
        purchasedSeats,
        effectiveSeats,
        members: members ?? 0,
        pendingInvites: pending ?? 0,
      });

      return new Response(JSON.stringify({
        plan_name: ent.planName, limits: ent.limits, features: ent.features, seats,
      }), { status: 200, headers });
  ```

- [ ] **Step 7: Add the imports to the handler.**
  The current top of `supabase/functions/workspace-limits/index.ts` is:
  ```ts
  import { createClient } from "npm:@supabase/supabase-js@2";
  import { buildCorsHeaders } from "../_shared/cors.ts";
  import { resolveEntitlements } from "../_shared/entitlements.ts";
  ```
  Replace with:
  ```ts
  import { createClient } from "npm:@supabase/supabase-js@2";
  import { buildCorsHeaders } from "../_shared/cors.ts";
  import { resolveEntitlements } from "../_shared/entitlements.ts";
  import { effectivePlanLimit } from "../_shared/entitlements-rpc.ts";
  import { buildSeatsBlock } from "./seats-block.ts";
  ```

- [ ] **Step 8: Typecheck the edge function — expect PASS.**
  Command: `deno check supabase/functions/workspace-limits/index.ts`
  Expected: `Check file:///.../workspace-limits/index.ts` with no errors.
  Note: if `deno check` polluted `node_modules`/`deno.lock`, restore with `git checkout deno.lock && npm ci` before the next `npm run build` (per the Deno/npm gotcha).

- [ ] **Step 9: Commit the handler wiring.**
  ```bash
  git add supabase/functions/workspace-limits/index.ts
  git commit -m "feat(workspace-limits): attach server-computed seats block to response"
  ```

- [ ] **Step 10: Write the failing Vitest for `useWorkspaceLimits` exposing `seats`.**
  Create `apps/crm/src/hooks/__tests__/useWorkspaceLimits.test.tsx`:
  ```tsx
  import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
  import { renderHook, waitFor } from '@testing-library/react';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import type { ReactNode } from 'react';
  import { useWorkspaceLimits } from '../useWorkspaceLimits';

  vi.mock('../../lib/supabase', () => ({
    supabase: {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: 'tok' } },
        }),
      },
    },
  }));

  vi.mock('../../context/AuthContext', () => ({
    AuthContext: { Provider: ({ children }: { children: ReactNode }) => children },
  }));

  function wrapper({ children }: { children: ReactNode }) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          plan_name: 'agency',
          limits: { max_team_members: 5 },
          features: null,
          seats: { included: 5, purchased: 2, effective: 7, used: 4 },
        }),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('useWorkspaceLimits seats', () => {
    it('exposes the server-computed seats block', async () => {
      const { result } = renderHook(() => useWorkspaceLimits(), { wrapper });
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.seats).toEqual({
        included: 5,
        purchased: 2,
        effective: 7,
        used: 4,
      });
    });

    it('returns undefined seats when the response omits the block', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ plan_name: 'free', limits: null, features: null }),
        }),
      );
      const { result } = renderHook(() => useWorkspaceLimits(), { wrapper });
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.seats).toBeUndefined();
    });
  });
  ```

- [ ] **Step 11: Run the Vitest — expect FAIL (`seats` not exposed).**
  Command: `npm run test -- apps/crm/src/hooks/__tests__/useWorkspaceLimits.test.tsx`
  Expected: first test fails — `result.current.seats` is `undefined` (the hook does not return `seats`), assertion `expected undefined to deeply equal { included: 5, ... }`.

- [ ] **Step 12: Add the `WorkspaceSeats` interface + optional `seats` to the hook.**
  The current `WorkspaceLimitsResponse` interface (lines 44–48) is:
  ```ts
  interface WorkspaceLimitsResponse {
    plan_name: string | null;
    limits: ResourceLimits | null;
    features: FeatureFlags | null;
  }
  ```
  Replace with:
  ```ts
  export interface WorkspaceSeats {
    included: number | null;
    purchased: number;
    effective: number | null;
    used: number;
  }

  interface WorkspaceLimitsResponse {
    plan_name: string | null;
    limits: ResourceLimits | null;
    features: FeatureFlags | null;
    seats?: WorkspaceSeats;
  }
  ```
  Then the current hook return (lines 82–88) is:
  ```ts
    return {
      limits: data?.limits ?? null,
      features: data?.features ?? null,
      planName: data?.plan_name ?? null,
      isLoading,
      isUnlimited: !isLoading && data?.limits === null,
    };
  ```
  Replace with:
  ```ts
    return {
      limits: data?.limits ?? null,
      features: data?.features ?? null,
      planName: data?.plan_name ?? null,
      seats: data?.seats,
      isLoading,
      isUnlimited: !isLoading && data?.limits === null,
    };
  ```

- [ ] **Step 13: Run the Vitest — expect PASS.**
  Command: `npm run test -- apps/crm/src/hooks/__tests__/useWorkspaceLimits.test.tsx`
  Expected: both tests pass (`2 passed`).

- [ ] **Step 14: Typecheck the CRM app — expect PASS.**
  Command: `npm run build`
  Expected: `tsc` succeeds and `vite build` completes with no type errors (the new optional `seats?` field does not break existing `useWorkspaceLimits` consumers such as `useEntitlements`).

- [ ] **Step 15: Commit the hook change + Vitest.**
  ```bash
  git add apps/crm/src/hooks/useWorkspaceLimits.ts apps/crm/src/hooks/__tests__/useWorkspaceLimits.test.tsx
  git commit -m "feat(useWorkspaceLimits): expose optional server-computed seats block"
  ```

### Task 9: Add `limit = included + purchased` cases to `invite-user-seats_test.ts`

**Files:**
- Modify `supabase/functions/__tests__/invite-user-seats_test.ts` (add two assertions encoding the additive cap; lines 4–8)
- Test path: `supabase/functions/__tests__/invite-user-seats_test.ts` (this file IS the test)

**Interfaces:**
- Consumes (existing, unchanged): `seatsAvailable({ limit: number | null; members: number; pendingInvites: number }): boolean` from `supabase/functions/invite-user/seats.ts`. Signature is NOT changing — the additive cap is supplied by the caller (`effective_plan_limit` now returns `base + purchased`), so these tests pass the already-summed `limit`.
- Produces: regression coverage proving that when `limit = included + purchased`, an invite that would exceed the base alone is allowed once purchased seats raise the cap, and is blocked when `purchased = 0`.

- [ ] **Step 1: Add the failing additive-cap assertions to the existing test.**
  The current first test (lines 4–8) is:
  ```ts
  Deno.test("seatsAvailable: blocks when members+pending >= limit", () => {
    assertEquals(seatsAvailable({ limit: 1, members: 1, pendingInvites: 0 }), false);
    assertEquals(seatsAvailable({ limit: 3, members: 1, pendingInvites: 1 }), true);
    assertEquals(seatsAvailable({ limit: 3, members: 2, pendingInvites: 1 }), false);
  });
  ```
  Add this new test immediately after the existing `seatsAvailable: null limit = unlimited` test (after line 12, before EOF):
  ```ts
  Deno.test("seatsAvailable: limit = included + purchased seats", () => {
    // included=2, purchased=1 => effective cap 3. With 2 members the 3rd member is allowed.
    assertEquals(seatsAvailable({ limit: 2 + 1, members: 2, pendingInvites: 0 }), true);
    // ...and a 3rd already-occupying seat (members+pending=3) hits the cap exactly => blocked.
    assertEquals(seatsAvailable({ limit: 2 + 1, members: 2, pendingInvites: 1 }), false);
    // included=2, purchased=0 => effective cap 2. The base floor still blocks the 3rd seat.
    assertEquals(seatsAvailable({ limit: 2 + 0, members: 2, pendingInvites: 0 }), false);
    // included=5, purchased=2 => effective cap 7. 4 members + 2 pending = 6 < 7 => allowed.
    assertEquals(seatsAvailable({ limit: 5 + 2, members: 4, pendingInvites: 2 }), true);
  });
  ```

- [ ] **Step 2: Run the test — expect PASS (asserts the contract is already honored).**
  Command: `deno test supabase/functions/__tests__/invite-user-seats_test.ts`
  Expected: `ok | 3 passed | 0 failed` (the original two tests + the new additive-cap test).
  Rationale: `seatsAvailable` already implements `members + pending < limit` with `limit === null` unlimited, so feeding it the summed `included + purchased` cap passes without touching `seats.ts`. This test exists to lock in that the additive cap (produced by the Task 5 `effective_plan_limit` RPC) flows through the invite gate unchanged — a guard against a future refactor that wrongly re-derives the base cap inside the gate.

- [ ] **Step 3: Commit the regression test.**
  ```bash
  git add supabase/functions/__tests__/invite-user-seats_test.ts
  git commit -m "test(invite-seats): cover included+purchased additive cap through seatsAvailable"
  ```

### Task 10: platform-admin — sum subscription amount across all items

Today `fetchStripeAmount` reads only `s.items?.data?.[0]` (line 636), so once a subscription carries a seat line item it reports either the tier or the seat as the *whole* amount and omits the other. Per §4.7 we sum `unit_amount × quantity` over **all** items, then apply the coupon to the summed gross. The summation is extracted into a pure, Deno-unit-testable helper in `_shared/billing-logic.ts`.

**Files:**
- Modify: `supabase/functions/_shared/billing-logic.ts` (append after `resolvePlanFromPriceId`, current EOF) — add `sumSubscriptionGross`.
- Modify: `supabase/functions/platform-admin/index.ts` (lines 627–658 `fetchStripeAmount`) — import + use the helper; pick currency/interval from the resolved tier item rather than `data[0]`.
- Test: `supabase/functions/__tests__/billing-logic_test.ts` (append cases).

**Interfaces:**
- Consumes: nothing from earlier tasks (lands in the same module as the seat helpers but is independent of them).
- Produces:
  - `sumSubscriptionGross(items: Array<{ quantity?: number; price?: { unit_amount?: number | null } }>): number` — `Σ ((price.unit_amount ?? 0) × (quantity ?? 1))`; `0` for an empty/undefined-ish list.
  - `fetchStripeAmount` now computes `gross = sumSubscriptionGross(s.items?.data ?? [])`; coupon math unchanged; `currency`/`interval` read from the first item that has `price.recurring.interval` (the tier item), falling back to `data[0]` then `fallbackInterval`.

- [ ] **Step 1: Write the FAILING Deno test for `sumSubscriptionGross`.** Append to `supabase/functions/__tests__/billing-logic_test.ts`:
```ts
import { sumSubscriptionGross } from "../_shared/billing-logic.ts";

Deno.test("sumSubscriptionGross: single tier item = unit_amount * quantity", () => {
  const items = [{ quantity: 1, price: { unit_amount: 17900 } }];
  assertEquals(sumSubscriptionGross(items), 17900);
});

Deno.test("sumSubscriptionGross: tier + seat items sum across all items", () => {
  const items = [
    { quantity: 1, price: { unit_amount: 17900 } }, // tier
    { quantity: 3, price: { unit_amount: 2500 } }, // 3 extra seats
  ];
  assertEquals(sumSubscriptionGross(items), 17900 + 3 * 2500);
});

Deno.test("sumSubscriptionGross: order-independent (seat item first)", () => {
  const items = [
    { quantity: 2, price: { unit_amount: 2500 } },
    { quantity: 1, price: { unit_amount: 11000 } },
  ];
  assertEquals(sumSubscriptionGross(items), 2 * 2500 + 11000);
});

Deno.test("sumSubscriptionGross: missing quantity defaults to 1, missing unit_amount to 0", () => {
  const items = [
    { price: { unit_amount: 11000 } }, // no quantity -> 1
    { quantity: 2, price: { unit_amount: null } }, // null unit_amount -> 0
    { quantity: 5 }, // no price -> 0
  ];
  assertEquals(sumSubscriptionGross(items), 11000);
});

Deno.test("sumSubscriptionGross: empty list is 0", () => {
  assertEquals(sumSubscriptionGross([]), 0);
});
```

- [ ] **Step 2: Run the test & confirm it FAILS (helper not exported yet).**
```bash
deno test supabase/functions/__tests__/billing-logic_test.ts
```
Expected: FAIL — `TS2305 [ERROR]: Module '"../_shared/billing-logic.ts"' has no exported member 'sumSubscriptionGross'.` (the existing `statusToPlanId`/`resolvePlanFromPriceId` tests do not run because the module fails to load).

- [ ] **Step 3: Add the MINIMAL implementation.** Append to `supabase/functions/_shared/billing-logic.ts` (after the `resolvePlanFromPriceId` function, current EOF):
```ts
/**
 * Sums the gross amount (in the subscription's currency minor unit) across ALL
 * subscription items: Σ (unit_amount × quantity). A subscription with a tier item
 * plus a seat add-on item must report both; reading only items[0] under-/mis-reports
 * the amount once a seat line item exists. `quantity` defaults to 1, `unit_amount` to 0.
 */
export function sumSubscriptionGross(
  items: Array<{ quantity?: number; price?: { unit_amount?: number | null } }>,
): number {
  let total = 0;
  for (const item of items) {
    total += (item.price?.unit_amount ?? 0) * (item.quantity ?? 1);
  }
  return total;
}
```

- [ ] **Step 4: Run the test & confirm it PASSES.**
```bash
deno test supabase/functions/__tests__/billing-logic_test.ts
```
Expected: PASS — all `sumSubscriptionGross` cases green plus the pre-existing `statusToPlanId`/`resolvePlanFromPriceId` tests (`ok | N passed | 0 failed`).

- [ ] **Step 5: Commit the helper + its test.**
```bash
git add supabase/functions/_shared/billing-logic.ts supabase/functions/__tests__/billing-logic_test.ts
git commit -m "feat(billing): add sumSubscriptionGross helper for multi-item amount calc

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 6: Import the helper in `platform-admin/index.ts`.** The current import block (lines 1–3) is:
```ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { revertPlanTarget } from "./revert-target.ts";
```
Add the helper import after the `revertPlanTarget` import:
```ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { revertPlanTarget } from "./revert-target.ts";
import { sumSubscriptionGross } from "../_shared/billing-logic.ts";
```

- [ ] **Step 7: Rewrite the amount calc in `fetchStripeAmount` to sum all items.** The current code (lines 636–658) reads:
```ts
  const item = s.items?.data?.[0];
  const qty = item?.quantity ?? 1;
  const gross = (item?.price?.unit_amount ?? 0) * qty;
  const coupon = extractCoupon(sub);
  let net = gross;
  let discountLabel: string | null = null;
  if (coupon) {
    if (typeof coupon.percent_off === "number" && coupon.percent_off > 0) {
      net = Math.round(gross * (1 - coupon.percent_off / 100));
      discountLabel = `${coupon.name ?? coupon.id} −${trimPercent(coupon.percent_off)}%`;
    } else if (typeof coupon.amount_off === "number" && coupon.amount_off > 0) {
      net = Math.max(0, gross - coupon.amount_off);
      discountLabel = coupon.name ?? coupon.id;
    }
  }
  return {
    amount_cents: net,
    gross_cents: net !== gross ? gross : null,
    currency: item?.price?.currency ?? "brl",
    interval: item?.price?.recurring?.interval ?? fallbackInterval,
    discount_label: discountLabel,
    livemode: s.livemode ?? true,
  };
```
Replace it with (sum across all items for `gross`; pick the recurring/tier item for `currency`/`interval` so a non-recurring or seat item never steals the displayed interval):
```ts
  const items = s.items?.data ?? [];
  // The displayed interval/currency come from the tier item (the one that carries a
  // recurring interval); the seat add-on shares the same currency/interval, but
  // never let item[0] ordering decide which is read.
  const tierItem = items.find((i) => i.price?.recurring?.interval) ?? items[0];
  const gross = sumSubscriptionGross(items);
  const coupon = extractCoupon(sub);
  let net = gross;
  let discountLabel: string | null = null;
  if (coupon) {
    if (typeof coupon.percent_off === "number" && coupon.percent_off > 0) {
      net = Math.round(gross * (1 - coupon.percent_off / 100));
      discountLabel = `${coupon.name ?? coupon.id} −${trimPercent(coupon.percent_off)}%`;
    } else if (typeof coupon.amount_off === "number" && coupon.amount_off > 0) {
      net = Math.max(0, gross - coupon.amount_off);
      discountLabel = coupon.name ?? coupon.id;
    }
  }
  return {
    amount_cents: net,
    gross_cents: net !== gross ? gross : null,
    currency: tierItem?.price?.currency ?? "brl",
    interval: tierItem?.price?.recurring?.interval ?? fallbackInterval,
    discount_label: discountLabel,
    livemode: s.livemode ?? true,
  };
```
The `s` type annotation at lines 627–635 already declares `items.data` as `Array<{ quantity?; price?: { unit_amount?; currency?; recurring?: { interval? } } }>`, which structurally satisfies `sumSubscriptionGross`'s parameter — no type change needed.

- [ ] **Step 8: Typecheck the edge function.**
```bash
deno check supabase/functions/platform-admin/index.ts
```
Expected: PASS — `Check file:///.../platform-admin/index.ts` with no diagnostics.

> NOTE: `deno check`/`deno test` pollute `node_modules` + `deno.lock` (shared with the npm build). After this step restore them before any `npm` command: `git checkout deno.lock && npm ci` (per the repo's Deno-vs-npm gotcha).

- [ ] **Step 9: Re-run the full Deno suite to confirm no regression.**
```bash
deno test supabase/functions/
```
Expected: PASS — entire edge-function suite green (`0 failed`).

- [ ] **Step 10: Commit the platform-admin wiring.**
```bash
git add supabase/functions/platform-admin/index.ts
git commit -m "fix(platform-admin): sum subscription amount across all items (seats)

Reads gross via sumSubscriptionGross over every line item instead of items[0],
then applies the coupon to the summed total. currency/interval are taken from the
recurring tier item so a seat item can never steal the displayed interval. Fixes
MRR under-reporting for seat-bearing subscriptions (spec §4.7).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: Admin PlansPage — seat price-id + seat display-price fields (and the `plans.seat_addon_brl*` columns they back)

Per §4.3 admin, add the seat-related plan columns and wire them through the admin Plans form. Two kinds of seat fields:

1. **Seat price-ids** (`stripe_price_id_seat` / `stripe_price_id_seat_annual`, `text`) — where the operator pastes the per-seat Stripe price ids after the Stripe objects exist. Mirrors the existing `stripe_price_id` text plumbing exactly.
2. **Seat display-prices** (`seat_addon_brl` / `seat_addon_brl_annual`, `int` centavos) — the per-seat price (monthly / annual) shown in the CRM cost breakdown. **These two columns are net-new and MUST be created+seeded here**: the cost breakdown reads them via `computeSeatCost`, and `listActivePlans` selects them — without the columns `listActivePlans` 400s at runtime (PostgREST: column does not exist). The seat price is shared across tiers, so all three paid plans get the same values: `2500` monthly / `25000` annual.

`platform-admin`'s `create-plan`/`update-plan` already persist arbitrary plan columns via object spread, so no edge-function change is needed for any of these four columns. A vitest unit test pins the pure `planToForm`/`formToPayload` round-trip (so those two functions are exported), and a billing-service test pins `computeSeatCost`.

**Files:**
- Add: `supabase/migrations/20260629000003_plans_seat_addon_price.sql` (new) — two `int` columns + seed on starter/agency/scale.
- Modify: `apps/crm/src/services/billing.ts` — `BillingPlan` interface (after `price_brl_annual`), `listActivePlans` select string, new exported `computeSeatCost`.
- Modify: `apps/admin/src/lib/api.ts` (`Plan` interface, after line 58 `stripe_price_id_annual: string | null;`) — add four fields.
- Modify: `apps/admin/src/pages/PlansPage.tsx` — `FormState` (lines 44–54), `planToForm` (56–74) + export, `formToPayload` (76–88) + export, both `setForm` initializers (94–104, 143–153), and the Stripe-id input grid (lines 248–287).
- Test: `apps/admin/src/pages/__tests__/PlansPage.form.test.ts` (new).
- Test: `apps/crm/src/services/__tests__/billing.test.ts` (modify — add `computeSeatCost` cases).

**Interfaces:**
- Consumes: `plans.stripe_price_id_seat` / `stripe_price_id_seat_annual` / `seat_addon_brl` / `seat_addon_brl_annual` DB columns (read/written through `list-plans`/`create-plan`/`update-plan`, which spread all plan columns; the seat_addon_brl* columns are created by the migration in this task).
- Produces:
  - `plans.seat_addon_brl int`, `plans.seat_addon_brl_annual int`, seeded `2500` / `25000` on `starter`,`agency`,`scale`.
  - `BillingPlan.seat_addon_brl: number | null`, `BillingPlan.seat_addon_brl_annual: number | null`; `listActivePlans` select includes both.
  - exported `computeSeatCost(plan: BillingPlan, interval: BillingInterval, seats: number): number` where `seatAddonCentavos = interval === 'year' ? plan.seat_addon_brl_annual : plan.seat_addon_brl` (null → 0).
  - `Plan.stripe_price_id_seat: string | null`, `Plan.stripe_price_id_seat_annual: string | null`, `Plan.seat_addon_brl: number | null`, `Plan.seat_addon_brl_annual: number | null`.
  - `FormState.stripe_price_id_seat: string`, `FormState.stripe_price_id_seat_annual: string`, `FormState.seat_addon_brl: number | null`, `FormState.seat_addon_brl_annual: number | null`.
  - exported `planToForm(plan: Plan): FormState` and `formToPayload(form: FormState): Record<string, unknown>` mapping the seat-id fields `'' <-> null` like `stripe_price_id`, and the seat-price fields `number | null` passed through (form holds `number | null`, payload sends it as-is) like `NumberFieldGroup` handles a centavos int.

- [ ] **Step 1: Add the `seat_addon_brl*` columns + seed (migration).** Create `supabase/migrations/20260629000003_plans_seat_addon_price.sql`. (Timestamp `20260629000003` is free — current latest is `20260629000002`. Avoid re-using `20260625000001`, which is the known duplicate-timestamp version.) Columns are `int` centavos, matching the existing `rate_*` columns; seeded only on the three paid tiers (the seat price is shared across tiers):
```sql
-- Per-seat display prices (centavos) shown in the CRM cost breakdown.
-- Net-new columns: listActivePlans selects them, so they must exist or the
-- PostgREST select 400s at runtime. Seat price is shared across paid tiers.
ALTER TABLE plans ADD COLUMN IF NOT EXISTS seat_addon_brl int;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS seat_addon_brl_annual int;

UPDATE plans
  SET seat_addon_brl = 2500,
      seat_addon_brl_annual = 25000
  WHERE id IN ('starter', 'agency', 'scale');
```

- [ ] **Step 2: Write a FAILING billing test for `computeSeatCost`.** Append to `apps/crm/src/services/__tests__/billing.test.ts`, after the existing `describe('billing service', ...)` block (the existing imports already pull from `../billing`; extend that import to include `computeSeatCost` and the `BillingPlan` type):
  - Change line 12 `import { startCheckout, openBillingPortal } from '../billing';` to:
```ts
import { startCheckout, openBillingPortal, computeSeatCost, type BillingPlan } from '../billing';
```
  - Add this new describe block at the end of the file (after the closing `});` of `describe('billing service', ...)`):
```ts
function makeBillingPlan(overrides: Partial<BillingPlan> = {}): BillingPlan {
  return {
    id: 'agency',
    name: 'Agency',
    price_brl: 17900,
    price_brl_annual: 179000,
    seat_addon_brl: 2500,
    seat_addon_brl_annual: 25000,
    sort_order: 20,
    max_clients: 30,
    max_team_members: 5,
    storage_quota_bytes: null,
    feature_hub_portal: true,
    feature_analytics_reports: true,
    feature_brand_customization: true,
    ...overrides,
  };
}

describe('computeSeatCost', () => {
  it('uses the monthly seat price for the month interval', () => {
    expect(computeSeatCost(makeBillingPlan(), 'month', 3)).toBe(7500);
  });

  it('uses the annual seat price for the year interval', () => {
    expect(computeSeatCost(makeBillingPlan(), 'year', 2)).toBe(50000);
  });

  it('treats a null seat price as zero', () => {
    const plan = makeBillingPlan({ seat_addon_brl: null, seat_addon_brl_annual: null });
    expect(computeSeatCost(plan, 'month', 4)).toBe(0);
    expect(computeSeatCost(plan, 'year', 4)).toBe(0);
  });
});
```

- [ ] **Step 3: Run the billing test & confirm it FAILS.**
```bash
npm run test -- apps/crm/src/services/__tests__/billing.test.ts
```
Expected: FAIL — `error TS2305: Module '"../billing"' has no exported member 'computeSeatCost'`, plus `Object literal ... 'seat_addon_brl' does not exist in type 'BillingPlan'` from `makeBillingPlan`. Test file fails to compile.

- [ ] **Step 4: Add the seat fields + `computeSeatCost` to `billing.ts`.** In `apps/crm/src/services/billing.ts`:
  - Extend the `BillingPlan` interface (current lines 8–9 read `price_brl: number | null;` / `price_brl_annual: number | null;`) by inserting the two seat fields immediately after `price_brl_annual`:
```ts
  price_brl: number | null;
  price_brl_annual: number | null;
  seat_addon_brl: number | null;
  seat_addon_brl_annual: number | null;
```
  - Extend the `listActivePlans` select string (line 44) to include both new columns:
```ts
      'id, name, price_brl, price_brl_annual, seat_addon_brl, seat_addon_brl_annual, sort_order, max_clients, max_team_members, storage_quota_bytes, feature_hub_portal, feature_analytics_reports, feature_brand_customization',
```
  - Add the exported helper immediately after `listActivePlans` (after its closing `}` at line 50):
```ts
/** Per-seat cost (centavos) for `seats` seats at the given billing interval. */
export function computeSeatCost(
  plan: BillingPlan,
  interval: BillingInterval,
  seats: number,
): number {
  const seatAddonCentavos =
    interval === 'year' ? plan.seat_addon_brl_annual : plan.seat_addon_brl;
  return (seatAddonCentavos ?? 0) * seats;
}
```

- [ ] **Step 5: Run the billing test & confirm it PASSES.**
```bash
npm run test -- apps/crm/src/services/__tests__/billing.test.ts
```
Expected: PASS — the three `computeSeatCost` cases green and the four pre-existing `billing service` cases still green.

- [ ] **Step 6: Write the FAILING vitest for the pure admin mapping.** Create `apps/admin/src/pages/__tests__/PlansPage.form.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { planToForm, formToPayload } from '../PlansPage';
import type { Plan } from '../../lib/api';

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'agency',
    name: 'Agency',
    price_brl: 17900,
    price_brl_annual: 179000,
    stripe_product_id: 'prod_x',
    stripe_price_id: 'price_m',
    stripe_price_id_annual: 'price_y',
    stripe_price_id_seat: 'price_seat_m',
    stripe_price_id_seat_annual: 'price_seat_y',
    seat_addon_brl: 2500,
    seat_addon_brl_annual: 25000,
    max_clients: 30,
    max_team_members: 5,
    max_workflow_templates: null,
    max_active_workflows_per_client: null,
    max_instagram_accounts: null,
    max_leads: null,
    max_hub_tokens: null,
    storage_quota_bytes: null,
    max_custom_properties_per_template: null,
    max_posts_per_workflow: null,
    max_workspaces_per_user: null,
    max_mcp_keys: null,
    feature_instagram: true,
    feature_instagram_ai: true,
    feature_analytics_reports: true,
    feature_best_times: true,
    feature_audience_demographics: true,
    feature_hub_portal: true,
    feature_leads: true,
    feature_financial: true,
    feature_contracts: true,
    feature_ideas: true,
    feature_workflow_gantt: true,
    feature_workflow_recurrence: true,
    feature_csv_import: true,
    feature_custom_properties: true,
    feature_post_scheduling: true,
    feature_auto_sync_cron: true,
    feature_post_tagging: true,
    feature_brand_customization: true,
    feature_mcp: true,
    rate_instagram_syncs_per_day: null,
    rate_ai_analyses_per_month: 100,
    rate_report_generations_per_month: null,
    sort_order: 20,
    is_active: true,
    is_default: false,
    created_at: '',
    updated_at: '',
    workspace_count: 0,
    ...overrides,
  };
}

describe('PlansPage seat price-id mapping', () => {
  it('planToForm copies the seat price ids into the form', () => {
    const form = planToForm(makePlan());
    expect(form.stripe_price_id_seat).toBe('price_seat_m');
    expect(form.stripe_price_id_seat_annual).toBe('price_seat_y');
  });

  it('planToForm coerces null seat ids to empty strings', () => {
    const form = planToForm(
      makePlan({ stripe_price_id_seat: null, stripe_price_id_seat_annual: null }),
    );
    expect(form.stripe_price_id_seat).toBe('');
    expect(form.stripe_price_id_seat_annual).toBe('');
  });

  it('formToPayload sends the seat price ids when set', () => {
    const payload = formToPayload(planToForm(makePlan()));
    expect(payload.stripe_price_id_seat).toBe('price_seat_m');
    expect(payload.stripe_price_id_seat_annual).toBe('price_seat_y');
  });

  it('formToPayload coerces empty seat ids back to null', () => {
    const form = planToForm(
      makePlan({ stripe_price_id_seat: null, stripe_price_id_seat_annual: null }),
    );
    const payload = formToPayload(form);
    expect(payload.stripe_price_id_seat).toBeNull();
    expect(payload.stripe_price_id_seat_annual).toBeNull();
  });
});

describe('PlansPage seat display-price mapping', () => {
  it('planToForm copies the seat display prices (centavos) into the form', () => {
    const form = planToForm(makePlan());
    expect(form.seat_addon_brl).toBe(2500);
    expect(form.seat_addon_brl_annual).toBe(25000);
  });

  it('planToForm keeps null seat display prices as null', () => {
    const form = planToForm(makePlan({ seat_addon_brl: null, seat_addon_brl_annual: null }));
    expect(form.seat_addon_brl).toBeNull();
    expect(form.seat_addon_brl_annual).toBeNull();
  });

  it('formToPayload passes the seat display prices through unchanged', () => {
    const payload = formToPayload(planToForm(makePlan()));
    expect(payload.seat_addon_brl).toBe(2500);
    expect(payload.seat_addon_brl_annual).toBe(25000);
  });

  it('formToPayload passes null seat display prices through as null', () => {
    const payload = formToPayload(
      planToForm(makePlan({ seat_addon_brl: null, seat_addon_brl_annual: null })),
    );
    expect(payload.seat_addon_brl).toBeNull();
    expect(payload.seat_addon_brl_annual).toBeNull();
  });
});
```

- [ ] **Step 7: Run the admin test & confirm it FAILS.**
```bash
npm run test -- apps/admin/src/pages/__tests__/PlansPage.form.test.ts
```
Expected: FAIL — at minimum `error TS2305: Module '"../PlansPage"' has no exported member 'planToForm'` (and `formToPayload`), plus `Object literal ... 'stripe_price_id_seat' does not exist in type 'Plan'` and `... 'seat_addon_brl' does not exist in type 'Plan'` from `makePlan`. Test file fails to compile.

- [ ] **Step 8: Add the four seat fields to the `Plan` interface.** In `apps/admin/src/lib/api.ts`, the current lines 56–58 read:
```ts
  stripe_product_id: string | null;
  stripe_price_id: string | null;
  stripe_price_id_annual: string | null;
```
Add the four seat fields immediately after `stripe_price_id_annual` (two text price-ids, two int centavos display-prices):
```ts
  stripe_product_id: string | null;
  stripe_price_id: string | null;
  stripe_price_id_annual: string | null;
  stripe_price_id_seat: string | null;
  stripe_price_id_seat_annual: string | null;
  seat_addon_brl: number | null;
  seat_addon_brl_annual: number | null;
```

- [ ] **Step 9: Add the four fields to `FormState`.** In `apps/admin/src/pages/PlansPage.tsx`, the current `FormState` (lines 44–54) ends:
```ts
  stripe_product_id: string;
  stripe_price_id: string;
  stripe_price_id_annual: string;
}
```
Extend it (seat-ids are `string` like the other ids; seat display-prices are `number | null`, matching how `resources`/`rates` hold centavos ints):
```ts
  stripe_product_id: string;
  stripe_price_id: string;
  stripe_price_id_annual: string;
  stripe_price_id_seat: string;
  stripe_price_id_seat_annual: string;
  seat_addon_brl: number | null;
  seat_addon_brl_annual: number | null;
}
```

- [ ] **Step 10: Export + extend `planToForm`.** The current declaration is `function planToForm(plan: Plan): FormState {` and its return block (lines 63–73) ends:
```ts
    stripe_product_id: plan.stripe_product_id ?? '',
    stripe_price_id: plan.stripe_price_id ?? '',
    stripe_price_id_annual: plan.stripe_price_id_annual ?? '',
  };
}
```
Change the signature to `export function planToForm(plan: Plan): FormState {` and extend the return — seat-ids coerce `null -> ''` like the other ids; seat display-prices pass `number | null` straight through (`?? null` keeps the null shape explicit):
```ts
    stripe_product_id: plan.stripe_product_id ?? '',
    stripe_price_id: plan.stripe_price_id ?? '',
    stripe_price_id_annual: plan.stripe_price_id_annual ?? '',
    stripe_price_id_seat: plan.stripe_price_id_seat ?? '',
    stripe_price_id_seat_annual: plan.stripe_price_id_seat_annual ?? '',
    seat_addon_brl: plan.seat_addon_brl ?? null,
    seat_addon_brl_annual: plan.seat_addon_brl_annual ?? null,
  };
}
```

- [ ] **Step 11: Export + extend `formToPayload`.** The current declaration is `function formToPayload(form: FormState): Record<string, unknown> {` and its body (lines 77–88) reads:
```ts
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
Change the signature to `export function formToPayload(form: FormState): Record<string, unknown> {` and add the four fields after `stripe_price_id_annual`. Seat-ids coerce `'' -> null` (`|| null`); seat display-prices pass `number | null` through unchanged (`?? null` — do NOT use `|| null`, which would clobber a legitimate `0`):
```ts
  return {
    name: form.name,
    is_default: form.is_default,
    is_active: form.is_active,
    stripe_product_id: form.stripe_product_id || null,
    stripe_price_id: form.stripe_price_id || null,
    stripe_price_id_annual: form.stripe_price_id_annual || null,
    stripe_price_id_seat: form.stripe_price_id_seat || null,
    stripe_price_id_seat_annual: form.stripe_price_id_seat_annual || null,
    seat_addon_brl: form.seat_addon_brl ?? null,
    seat_addon_brl_annual: form.seat_addon_brl_annual ?? null,
    ...form.resources,
    ...form.features,
    ...form.rates,
  };
}
```

- [ ] **Step 12: Add the seat fields to both `setForm` initializers.** There are two identical empty-form blocks (the `useState` default at lines 94–104 and the `openCreate` reset at lines 143–153), each ending:
```ts
      stripe_product_id: '',
      stripe_price_id: '',
      stripe_price_id_annual: '',
    });
```
In **both** blocks, add the seat-id fields (`''`) and the seat display-price fields (`null` — empty by default; the numeric input shows blank for `null`) after `stripe_price_id_annual: '',`, so each becomes:
```ts
      stripe_product_id: '',
      stripe_price_id: '',
      stripe_price_id_annual: '',
      stripe_price_id_seat: '',
      stripe_price_id_seat_annual: '',
      seat_addon_brl: null,
      seat_addon_brl_annual: null,
    });
```
(The two blocks are byte-identical for these lines, so a `replace_all` on the four-line `stripe_product_id: '',` … `stripe_price_id_annual: '',` run is safe — both occurrences use the same 6-space indentation.)

- [ ] **Step 13: Add the four input fields to the form.** The current Stripe-id grid (lines 248–287) is a `grid-cols-1 sm:grid-cols-3` wrapping Product ID + Price ID (monthly) + Price ID (annual). Its closing (lines 273–287) is:
```tsx
                <div>
                  <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                    Stripe Price ID (annual)
                  </label>
                  <input
                    type="text"
                    value={form.stripe_price_id_annual}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, stripe_price_id_annual: e.target.value }))
                    }
                    placeholder="price_..."
                    className="w-full px-3 py-2 rounded-lg bg-secondary border border-transparent text-sm font-['DM_Sans'] text-foreground placeholder-dim-foreground focus:outline-none focus:border-primary"
                  />
                </div>
              </div>
```
Insert a second `grid-cols-2` row with the four seat inputs immediately after that closing `</div>` of the Stripe-id grid (i.e. before the `<NumberFieldGroup title="Resource Limits" ...>` at line 289). The two seat-id inputs are `type="text"` (mirror `stripe_price_id`); the two seat display-price inputs are `type="number"` storing centavos, coercing `'' -> null` and `parseInt(v, 10)` exactly like `NumberFieldGroup` (note the value-binding uses `?? ''` so a `null` shows blank):
```tsx
                <div>
                  <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                    Stripe Price ID (annual)
                  </label>
                  <input
                    type="text"
                    value={form.stripe_price_id_annual}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, stripe_price_id_annual: e.target.value }))
                    }
                    placeholder="price_..."
                    className="w-full px-3 py-2 rounded-lg bg-secondary border border-transparent text-sm font-['DM_Sans'] text-foreground placeholder-dim-foreground focus:outline-none focus:border-primary"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                    Seat Price ID (monthly)
                  </label>
                  <input
                    type="text"
                    value={form.stripe_price_id_seat}
                    onChange={(e) => setForm((f) => ({ ...f, stripe_price_id_seat: e.target.value }))}
                    placeholder="price_..."
                    className="w-full px-3 py-2 rounded-lg bg-secondary border border-transparent text-sm font-['DM_Sans'] text-foreground placeholder-dim-foreground focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                    Seat Price ID (annual)
                  </label>
                  <input
                    type="text"
                    value={form.stripe_price_id_seat_annual}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, stripe_price_id_seat_annual: e.target.value }))
                    }
                    placeholder="price_..."
                    className="w-full px-3 py-2 rounded-lg bg-secondary border border-transparent text-sm font-['DM_Sans'] text-foreground placeholder-dim-foreground focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                    Seat Price (monthly, centavos)
                  </label>
                  <input
                    type="number"
                    value={form.seat_addon_brl ?? ''}
                    placeholder="2500"
                    onChange={(e) => {
                      const v = e.target.value;
                      setForm((f) => ({ ...f, seat_addon_brl: v === '' ? null : parseInt(v, 10) }));
                    }}
                    className="w-full px-3 py-2 rounded-lg bg-secondary border border-transparent text-sm font-['DM_Sans'] text-foreground placeholder-dim-foreground focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                    Seat Price (annual, centavos)
                  </label>
                  <input
                    type="number"
                    value={form.seat_addon_brl_annual ?? ''}
                    placeholder="25000"
                    onChange={(e) => {
                      const v = e.target.value;
                      setForm((f) => ({
                        ...f,
                        seat_addon_brl_annual: v === '' ? null : parseInt(v, 10),
                      }));
                    }}
                    className="w-full px-3 py-2 rounded-lg bg-secondary border border-transparent text-sm font-['DM_Sans'] text-foreground placeholder-dim-foreground focus:outline-none focus:border-primary"
                  />
                </div>
              </div>
```

- [ ] **Step 14: Run the admin test & confirm it PASSES.**
```bash
npm run test -- apps/admin/src/pages/__tests__/PlansPage.form.test.ts
```
Expected: PASS — all eight cases green (`8 passed`): four `PlansPage seat price-id mapping` + four `PlansPage seat display-price mapping`.

- [ ] **Step 15: Typecheck the admin app.**
```bash
npm run build
```
Expected: PASS — `tsc` then `vite build` complete with no errors (the new `Plan`, `FormState`, and `BillingPlan` fields resolve; `makePlan`/`makeBillingPlan` satisfy the full shapes).

- [ ] **Step 16: Run the full unit suite (no regressions).**
```bash
npm run test
```
Expected: PASS — whole vitest suite green, including the existing four `billing service` cases, the three `computeSeatCost` cases, and the eight PlansPage mapping cases.

- [ ] **Step 17: Commit the seat columns + admin/CRM wiring.**
```bash
git add supabase/migrations/20260629000003_plans_seat_addon_price.sql apps/crm/src/services/billing.ts apps/crm/src/services/__tests__/billing.test.ts apps/admin/src/lib/api.ts apps/admin/src/pages/PlansPage.tsx apps/admin/src/pages/__tests__/PlansPage.form.test.ts
git commit -m "feat(admin): seat price-id + seat display-price fields on PlansPage

Adds plans.seat_addon_brl / seat_addon_brl_annual (int centavos) columns,
seeded 2500/25000 on starter/agency/scale (shared per-seat price), plus
stripe_price_id_seat / stripe_price_id_seat_annual on the admin Plan interface.
Wires all four through FormState/planToForm/formToPayload with two text inputs
(price ids) and two numeric centavos inputs (display prices). Threads
seat_addon_brl* into the CRM BillingPlan, listActivePlans select, and a new
computeSeatCost helper so the cost breakdown has the centavos to render and
listActivePlans no longer 400s (spec §4.3 admin).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Task 12: `services/billing.ts` — seat-aware types, `startCheckout(extraSeats)`, `changeSeats()`, `getWorkspaceSeats()`, seat-aware `getWorkspaceSubscription`

**Files:**
- Modify `apps/crm/src/services/billing.ts`
  - `BillingPlan` interface (lines 5–17): add `included_seats`, `seat_addon_brl`, `seat_addon_brl_annual`.
  - `WorkspaceSubscription` interface (lines 19–24): add `seats`.
  - `getWorkspaceSubscription` select string (line 93): add `purchased_seats` + map to `seats`.
  - `listActivePlans` select string (line 44): add the seat columns.
  - `startCheckout` (lines 100–116): add `extraSeats?` param + body wiring.
  - Append two new exported functions after `openBillingPortal` (after line 127): `changeSeats`, `getWorkspaceSeats`.
- Modify (Test) `apps/crm/src/services/__tests__/billing.test.ts` (whole file is the test target).

**Interfaces:**
- Consumes:
  - `billing-checkout` request body `{ plan_id, interval, promo_code?, extra_seats?: number }` (Task 1).
  - `billing-seats` request body `{ extra_seats: number }` (Task 10).
  - `workspace-limits` response `seats: { included: number|null, purchased: number, effective: number|null, used: number }` (Task 11).
  - `workspace_subscriptions.purchased_seats int` column (catalog/seats migration, Task 2).
  - `plans.seat_addon_brl int` + `plans.seat_addon_brl_annual int` columns (Task 2; seeded starter/agency/scale = 2500 / 25000).
- Produces:
  - `interface BillingPlan` gains `included_seats: number | null`, `seat_addon_brl: number | null`, `seat_addon_brl_annual: number | null`.
  - `interface WorkspaceSubscription` gains `seats: number` (mapped from `purchased_seats`, NULL → 0).
  - `startCheckout(planId: string, interval: BillingInterval, promoCode?: string, extraSeats?: number): Promise<string>` — body includes `extra_seats` **only when `> 0`**.
  - `changeSeats(extraSeats: number): Promise<void>` — POST `/functions/v1/billing-seats`.
  - `getWorkspaceSeats(): Promise<WorkspaceSeats | null>`.

> NOTE — cross-task DB dependency: `getWorkspaceSubscription` reads `purchased_seats` and `listActivePlans` reads `seat_addon_brl`/`seat_addon_brl_annual`. Both columns are added/seeded by the catalog migration (Task 2). Without that migration these selects 400 at runtime (PostgREST `column does not exist`). The vitest suite mocks Supabase, so the type changes typecheck and the unit tests pass regardless — the live dependency is real but out of scope for this task's tests.

- [ ] **Step 1: Write the failing test for `startCheckout` with extra seats (>0 included, 0 omitted).**

  In `apps/crm/src/services/__tests__/billing.test.ts`, replace the first test (`startCheckout posts plan+interval and returns the url`, lines 25–36) to use a new tier id and add two extra-seats assertions right after it. Replace this block:

  ```ts
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
  ```

  with:

  ```ts
  it('startCheckout posts plan+interval and returns the url', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://checkout.stripe.com/abc' }),
    });
    const url = await startCheckout('agency', 'year');
    expect(url).toBe('https://checkout.stripe.com/abc');
    const [calledUrl, opts] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(calledUrl).toContain('/functions/v1/billing-checkout');
    expect(JSON.parse(opts.body)).toEqual({ plan_id: 'agency', interval: 'year' });
    expect(opts.headers.Authorization).toBe('Bearer tok');
  });

  it('startCheckout includes extra_seats only when > 0', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://checkout.stripe.com/abc' }),
    });
    await startCheckout('agency', 'month', undefined, 3);
    const [, opts] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({
      plan_id: 'agency',
      interval: 'month',
      extra_seats: 3,
    });
  });

  it('startCheckout omits extra_seats when 0', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://checkout.stripe.com/abc' }),
    });
    await startCheckout('agency', 'month', undefined, 0);
    const [, opts] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({ plan_id: 'agency', interval: 'month' });
  });
  ```

  Also update the `promo_code` test (lines 38–50) and the `non-ok` test (lines 52–59) to the new tier id so the suite is consistent. Replace:

  ```ts
    await startCheckout('pro', 'month', 'BEMVINDO');
    const [, opts] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({
      plan_id: 'pro',
      interval: 'month',
      promo_code: 'BEMVINDO',
    });
  ```

  with:

  ```ts
    await startCheckout('agency', 'month', 'BEMVINDO');
    const [, opts] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({
      plan_id: 'agency',
      interval: 'month',
      promo_code: 'BEMVINDO',
    });
  ```

  and replace:

  ```ts
    await expect(startCheckout('pro', 'month')).rejects.toThrow('Plan price not configured');
  ```

  with:

  ```ts
    await expect(startCheckout('agency', 'month')).rejects.toThrow('Plan price not configured');
  ```

- [ ] **Step 2: Run the test & confirm it FAILS.**

  ```bash
  npm run test -- apps/crm/src/services/__tests__/billing.test.ts
  ```

  Expected FAIL: `startCheckout includes extra_seats only when > 0` fails because the current `startCheckout` signature has no `extraSeats` param, so `extra_seats` never appears in the body — `JSON.parse(opts.body)` equals `{ plan_id: 'agency', interval: 'month' }`, not the expected object with `extra_seats: 3`.

- [ ] **Step 3: Implement the `startCheckout` extra-seats wiring (MINIMAL).**

  In `apps/crm/src/services/billing.ts`, replace the current `startCheckout` (lines 100–116):

  ```ts
  /** Starts Stripe Checkout; returns the hosted URL to redirect to. */
  export async function startCheckout(
    planId: string,
    interval: BillingInterval,
    promoCode?: string,
  ): Promise<string> {
    const body: Record<string, unknown> = { plan_id: planId, interval };
    if (promoCode) body.promo_code = promoCode;
    const res = await fetch(`${FUNCTIONS_BASE}/billing-checkout`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
    return data.url as string;
  }
  ```

  with:

  ```ts
  /** Starts Stripe Checkout; returns the hosted URL to redirect to. */
  export async function startCheckout(
    planId: string,
    interval: BillingInterval,
    promoCode?: string,
    extraSeats?: number,
  ): Promise<string> {
    const body: Record<string, unknown> = { plan_id: planId, interval };
    if (promoCode) body.promo_code = promoCode;
    // EXTRA seats beyond the tier-included base; omit when 0 to mirror promo_code.
    if (extraSeats != null && extraSeats > 0) body.extra_seats = extraSeats;
    const res = await fetch(`${FUNCTIONS_BASE}/billing-checkout`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
    return data.url as string;
  }
  ```

- [ ] **Step 4: Run the test & confirm the `startCheckout` cases PASS.**

  ```bash
  npm run test -- apps/crm/src/services/__tests__/billing.test.ts
  ```

  Expected PASS: all five existing/updated `startCheckout` + `openBillingPortal` tests pass (extra_seats included when 3, omitted when 0).

- [ ] **Step 5: Commit the startCheckout change.**

  ```bash
  git add apps/crm/src/services/billing.ts apps/crm/src/services/__tests__/billing.test.ts
  git commit -m "feat(billing): startCheckout sends extra_seats when > 0

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

- [ ] **Step 6: Write the failing test for `changeSeats`.**

  In `apps/crm/src/services/__tests__/billing.test.ts`, update the import line (line 12) and add a new test block before the final closing `});` of the `describe('billing service', ...)`. Replace the import:

  ```ts
  import { startCheckout, openBillingPortal } from '../billing';
  ```

  with:

  ```ts
  import { startCheckout, openBillingPortal, changeSeats, getWorkspaceSeats } from '../billing';
  ```

  Then add, immediately after the `openBillingPortal returns the portal url` test (before the closing `});` at line 67):

  ```ts
  it('changeSeats posts extra_seats to billing-seats and resolves on ok', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    await changeSeats(2);
    const [calledUrl, opts] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(calledUrl).toContain('/functions/v1/billing-seats');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ extra_seats: 2 });
    expect(opts.headers.Authorization).toBe('Bearer tok');
  });

  it('changeSeats throws the server error message on non-ok', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'Reduza usuários antes de remover assentos' }),
    });
    await expect(changeSeats(0)).rejects.toThrow('Reduza usuários antes de remover assentos');
  });
  ```

- [ ] **Step 7: Run the test & confirm it FAILS.**

  ```bash
  npm run test -- apps/crm/src/services/__tests__/billing.test.ts
  ```

  Expected FAIL: the file fails to compile/run because `changeSeats` (and `getWorkspaceSeats`) is not exported from `../billing` (`SyntaxError`/`changeSeats is not a function`).

- [ ] **Step 8: Implement `changeSeats` (MINIMAL).**

  In `apps/crm/src/services/billing.ts`, append after `openBillingPortal` (after the closing `}` on line 127):

  ```ts
  /**
   * Owner-only in-app seat change. Posts EXTRA seats (beyond the tier base) to
   * `billing-seats`, which performs the validated Stripe `subscriptions.update`
   * with proration. The webhook is the sole writer of `purchased_seats`; the UI
   * refetches `workspace-limits` after this resolves.
   */
  export async function changeSeats(extraSeats: number): Promise<void> {
    const res = await fetch(`${FUNCTIONS_BASE}/billing-seats`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ extra_seats: extraSeats }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  }
  ```

- [ ] **Step 9: Run the test & confirm the `changeSeats` cases PASS.**

  ```bash
  npm run test -- apps/crm/src/services/__tests__/billing.test.ts
  ```

  Expected PASS: both `changeSeats` tests pass; `getWorkspaceSeats` tests do not exist yet (added next).

- [ ] **Step 10: Write the failing test for `getWorkspaceSeats`.**

  The existing mock (lines 3–9) only stubs `supabase.auth.getSession`, which is all `getWorkspaceSeats` needs (it reads the `workspace-limits` edge fn over `fetch`). Add, immediately after the two `changeSeats` tests inserted in Step 6:

  ```ts
  it('getWorkspaceSeats returns the workspace-limits seats block', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        plan_name: 'Agency',
        limits: {},
        features: {},
        seats: { included: 5, purchased: 2, effective: 7, used: 4 },
      }),
    });
    const seats = await getWorkspaceSeats();
    const [calledUrl, opts] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(calledUrl).toContain('/functions/v1/workspace-limits');
    expect(opts.method).toBe('GET');
    expect(seats).toEqual({ included: 5, purchased: 2, effective: 7, used: 4 });
  });

  it('getWorkspaceSeats returns null when the response has no seats block', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ plan_name: 'Free', limits: {}, features: {} }),
    });
    expect(await getWorkspaceSeats()).toBeNull();
  });
  ```

- [ ] **Step 11: Run the test & confirm it FAILS.**

  ```bash
  npm run test -- apps/crm/src/services/__tests__/billing.test.ts
  ```

  Expected FAIL: file fails because `getWorkspaceSeats` is not exported from `../billing`.

- [ ] **Step 12: Extend the types + selects and implement `getWorkspaceSeats` (MINIMAL).**

  In `apps/crm/src/services/billing.ts`, first extend `BillingPlan` (lines 5–17). Replace:

  ```ts
  export interface BillingPlan {
    id: string;
    name: string;
    price_brl: number | null;
    price_brl_annual: number | null;
    sort_order: number;
    max_clients: number | null;
    max_team_members: number | null;
    storage_quota_bytes: number | null;
    feature_hub_portal: boolean;
    feature_analytics_reports: boolean;
    feature_brand_customization: boolean;
  }
  ```

  with:

  ```ts
  export interface BillingPlan {
    id: string;
    name: string;
    price_brl: number | null;
    price_brl_annual: number | null;
    sort_order: number;
    max_clients: number | null;
    max_team_members: number | null;
    storage_quota_bytes: number | null;
    feature_hub_portal: boolean;
    feature_analytics_reports: boolean;
    feature_brand_customization: boolean;
    /** Seats already priced into the tier (= max_team_members). NULL = unlimited base. */
    included_seats: number | null;
    /** Per-seat add-on price in centavos (monthly). NULL until the seat price is configured. */
    seat_addon_brl: number | null;
    /** Per-seat add-on price in centavos (annual ≈ 10× monthly). */
    seat_addon_brl_annual: number | null;
  }
  ```

  Then extend `WorkspaceSubscription` (lines 19–24). Replace:

  ```ts
  export interface WorkspaceSubscription {
    status: string | null;
    plan_id: string | null;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
  }
  ```

  with:

  ```ts
  export interface WorkspaceSubscription {
    status: string | null;
    plan_id: string | null;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
    /** Purchased EXTRA seats mirrored from Stripe (workspace_subscriptions.purchased_seats). NULL → 0. */
    seats: number;
  }

  /** Server-computed seat block from the workspace-limits edge function. */
  export interface WorkspaceSeats {
    included: number | null;
    purchased: number;
    effective: number | null;
    used: number;
  }
  ```

  Then extend the `listActivePlans` select string (line 44). Replace:

  ```ts
      .select(
        'id, name, price_brl, price_brl_annual, sort_order, max_clients, max_team_members, storage_quota_bytes, feature_hub_portal, feature_analytics_reports, feature_brand_customization',
      )
  ```

  with:

  ```ts
      .select(
        'id, name, price_brl, price_brl_annual, sort_order, max_clients, max_team_members, storage_quota_bytes, feature_hub_portal, feature_analytics_reports, feature_brand_customization, included_seats:max_team_members, seat_addon_brl, seat_addon_brl_annual',
      )
  ```

  Then fix `getWorkspaceSubscription` so the required `seats` field is not a type-vs-runtime lie. The current select string (line 93) does NOT read `purchased_seats`, and the result is cast straight to `WorkspaceSubscription` (line 97) — so `subscription.seats` would be `undefined` at runtime while typed `number`. Replace the select + return block (lines 91–97):

  ```ts
    const { data, error } = await supabase
      .from('workspace_subscriptions')
      .select('status, plan_id, current_period_end, cancel_at_period_end')
      .eq('workspace_id', profile.conta_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as WorkspaceSubscription) ?? null;
  ```

  with:

  ```ts
    const { data, error } = await supabase
      .from('workspace_subscriptions')
      .select('status, plan_id, current_period_end, cancel_at_period_end, purchased_seats')
      .eq('workspace_id', profile.conta_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return {
      status: (data.status as string | null) ?? null,
      plan_id: (data.plan_id as string | null) ?? null,
      current_period_end: (data.current_period_end as string | null) ?? null,
      cancel_at_period_end: (data.cancel_at_period_end as boolean) ?? false,
      // purchased_seats counts EXTRA seats only; NULL (no row written yet) → 0.
      seats: (data.purchased_seats as number | null) ?? 0,
    };
  ```

  Then append `getWorkspaceSeats` after `changeSeats`:

  ```ts
  /**
   * Server-computed seat block from `workspace-limits` (members + pending invites
   * counted server-side, matching the invite gate). Returns null when the response
   * carries no seats block (e.g. a free workspace with no seat plumbing). Reuse this
   * rather than a second round-trip; gate the caller with `enabled: isOwner`.
   */
  export async function getWorkspaceSeats(): Promise<WorkspaceSeats | null> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error('Não autenticado');
    const res = await fetch(`${FUNCTIONS_BASE}/workspace-limits`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
    return (data.seats as WorkspaceSeats | undefined) ?? null;
  }
  ```

- [ ] **Step 13: Run the test & confirm all PASS.**

  ```bash
  npm run test -- apps/crm/src/services/__tests__/billing.test.ts
  ```

  Expected PASS: all tests in the file (startCheckout x4, openBillingPortal, changeSeats x2, getWorkspaceSeats x2) pass.

- [ ] **Step 14: Typecheck the CRM build.**

  ```bash
  npm run build
  ```

  Expected PASS: `tsc` reports no errors. Note: the aliased `included_seats:max_team_members` select and the new `purchased_seats`/`seat_addon_brl*` columns are query-shape details that require the catalog migration (Task 2) at runtime, but do not affect `tsc`.

- [ ] **Step 15: Commit the changeSeats + getWorkspaceSeats + type changes.**

  ```bash
  git add apps/crm/src/services/billing.ts apps/crm/src/services/__tests__/billing.test.ts
  git commit -m "feat(billing): add changeSeats + getWorkspaceSeats, seat-aware plan/subscription types

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

### Task 13: `seat-pricing.ts` — `computeSeatCost` + `clampSeats` pure helpers

**Files:**
- Create `apps/crm/src/pages/configuracao/cobranca/seat-pricing.ts`
- Create (Test) `apps/crm/src/pages/configuracao/cobranca/__tests__/seat-pricing.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure module; mirrors the centavos convention `price_brl` from `BillingPlan`).
- Produces:
  - `computeSeatCost(args: { basePriceCentavos: number; includedSeats: number | null; selectedSeats: number; seatAddonCentavos: number; interval: 'month' | 'year' }): { extraSeats: number; extraCostCentavos: number; totalCentavos: number }` — `extraSeats = max(0, selectedSeats - (includedSeats ?? 0))`; per-seat cost is the monthly add-on, multiplied by 10 when `interval === 'year'`; `totalCentavos = basePriceCentavos + extraCostCentavos`.
  - `clampSeats(selected: number, includedSeats: number | null, currentSeats: number): number` — floors at `max(includedSeats ?? 0, currentSeats)`; never returns below the floor.

- [ ] **Step 1: Write the failing test file.**

  Create `apps/crm/src/pages/configuracao/cobranca/__tests__/seat-pricing.test.ts`:

  ```ts
  import { describe, it, expect } from 'vitest';
  import { computeSeatCost, clampSeats } from '../seat-pricing';

  describe('seat-pricing', () => {
    describe('computeSeatCost', () => {
      it('charges nothing extra when selected equals included', () => {
        const r = computeSeatCost({
          basePriceCentavos: 17900,
          includedSeats: 5,
          selectedSeats: 5,
          seatAddonCentavos: 2500,
          interval: 'month',
        });
        expect(r).toEqual({ extraSeats: 0, extraCostCentavos: 0, totalCentavos: 17900 });
      });

      it('charges the per-seat add-on for each extra seat (monthly)', () => {
        const r = computeSeatCost({
          basePriceCentavos: 17900,
          includedSeats: 5,
          selectedSeats: 8,
          seatAddonCentavos: 2500,
          interval: 'month',
        });
        // 3 extra × 2500 = 7500; total 17900 + 7500 = 25400
        expect(r).toEqual({ extraSeats: 3, extraCostCentavos: 7500, totalCentavos: 25400 });
      });

      it('multiplies the per-seat add-on by 10 for annual (2 months free)', () => {
        const r = computeSeatCost({
          basePriceCentavos: 179000,
          includedSeats: 5,
          selectedSeats: 8,
          seatAddonCentavos: 2500,
          interval: 'year',
        });
        // 3 extra × (2500 × 10) = 75000; total 179000 + 75000 = 254000
        expect(r).toEqual({ extraSeats: 3, extraCostCentavos: 75000, totalCentavos: 254000 });
      });

      it('never goes negative when selected is below included', () => {
        const r = computeSeatCost({
          basePriceCentavos: 11000,
          includedSeats: 2,
          selectedSeats: 1,
          seatAddonCentavos: 2500,
          interval: 'month',
        });
        expect(r).toEqual({ extraSeats: 0, extraCostCentavos: 0, totalCentavos: 11000 });
      });

      it('treats null includedSeats as 0 included (everything is extra)', () => {
        const r = computeSeatCost({
          basePriceCentavos: 27900,
          includedSeats: null,
          selectedSeats: 2,
          seatAddonCentavos: 2500,
          interval: 'month',
        });
        expect(r).toEqual({ extraSeats: 2, extraCostCentavos: 5000, totalCentavos: 32900 });
      });
    });

    describe('clampSeats', () => {
      it('floors at the number of included seats', () => {
        expect(clampSeats(1, 5, 0)).toBe(5);
        expect(clampSeats(6, 5, 0)).toBe(6);
      });

      it('floors at the current purchased total when it exceeds included', () => {
        // already on 7 total seats; cannot drop below current via the selector
        expect(clampSeats(4, 5, 7)).toBe(7);
        expect(clampSeats(8, 5, 7)).toBe(8);
      });

      it('treats null includedSeats as 0 for the floor', () => {
        expect(clampSeats(0, null, 0)).toBe(0);
        expect(clampSeats(0, null, 3)).toBe(3);
      });
    });
  });
  ```

- [ ] **Step 2: Run the test & confirm it FAILS.**

  ```bash
  npm run test -- apps/crm/src/pages/configuracao/cobranca/__tests__/seat-pricing.test.ts
  ```

  Expected FAIL: cannot resolve `../seat-pricing` — the module does not exist yet.

- [ ] **Step 3: Implement `seat-pricing.ts` (MINIMAL).**

  Create `apps/crm/src/pages/configuracao/cobranca/seat-pricing.ts`:

  ```ts
  /**
   * Pure seat-pricing math for the Plano & Cobrança seat selector. Kept out of the
   * component so it's unit-testable. All money is in centavos, matching
   * `plans.price_brl`. Annual ≈ 10× monthly (2 months free) — mirrors the tier rule.
   */

  export interface SeatCostArgs {
    /** Tier base price for the chosen interval, in centavos. */
    basePriceCentavos: number;
    /** Seats already priced into the tier (= max_team_members). NULL = treat as 0. */
    includedSeats: number | null;
    /** Total seats the user has selected in the stepper. */
    selectedSeats: number;
    /** Per-seat add-on price in centavos (MONTHLY rate). */
    seatAddonCentavos: number;
    interval: 'month' | 'year';
  }

  export interface SeatCost {
    /** EXTRA seats beyond the tier base (never negative). */
    extraSeats: number;
    /** Cost of the extra seats for the interval, in centavos. */
    extraCostCentavos: number;
    /** base + extra, in centavos. */
    totalCentavos: number;
  }

  export function computeSeatCost(args: SeatCostArgs): SeatCost {
    const included = args.includedSeats ?? 0;
    const extraSeats = Math.max(0, args.selectedSeats - included);
    const perSeat = args.interval === 'year' ? args.seatAddonCentavos * 10 : args.seatAddonCentavos;
    const extraCostCentavos = extraSeats * perSeat;
    return {
      extraSeats,
      extraCostCentavos,
      totalCentavos: args.basePriceCentavos + extraCostCentavos,
    };
  }

  /**
   * Clamp a selector value to its floor: a workspace can never select fewer seats than
   * the tier includes, nor fewer than it currently has (the in-app remove path runs
   * through `billing-seats`, not the checkout selector). Floor = max(included, current).
   */
  export function clampSeats(
    selected: number,
    includedSeats: number | null,
    currentSeats: number,
  ): number {
    const floor = Math.max(includedSeats ?? 0, currentSeats);
    return Math.max(floor, selected);
  }
  ```

- [ ] **Step 4: Run the test & confirm all PASS.**

  ```bash
  npm run test -- apps/crm/src/pages/configuracao/cobranca/__tests__/seat-pricing.test.ts
  ```

  Expected PASS: all `computeSeatCost` (5) and `clampSeats` (3) cases pass.

- [ ] **Step 5: Commit.**

  ```bash
  git add apps/crm/src/pages/configuracao/cobranca/seat-pricing.ts apps/crm/src/pages/configuracao/cobranca/__tests__/seat-pricing.test.ts
  git commit -m "feat(billing): seat-pricing helpers (computeSeatCost annual=10x, clampSeats floor)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

### Task 14: `CobrancaPage` seat selector (upgrade) + active-subscriber seat control + cost breakdown + new copy + `RECOMMENDED_ID='agency'`

**Files:**
- Modify `apps/crm/src/pages/configuracao/cobranca/CobrancaPage.tsx`
  - `RECOMMENDED_ID` (line 18): `'pro'` → `'agency'`.
  - imports (lines 1–16): add `useQueryClient`; add `changeSeats`, `getWorkspaceSeats`, `type WorkspaceSeats`; add `computeSeatCost`, `clampSeats`.
  - `formatStorage` (lines 25–29): remove (becomes unused).
  - `planFeatures` (lines 38–56): replace per-feature bullets with "Tudo incluído" / clients / seats / +R$25 copy.
  - component body: add `queryClient`, a `seats` query (`getWorkspaceSeats`), per-plan seat state, `seatsFor`/`adjustSeats` helpers, an active-subscriber seat control + `handleSeatChange`, and seat-aware `handleUpgrade`.
  - active-subscription card (lines 186–216): add the seat add/remove stepper bound to current total seats.
  - upgrade card render (lines 306–315): add the seat selector + cost breakdown.
- Modify `apps/crm/src/pages/configuracao/cobranca/cobranca.css`: add `.seat-selector*` + `.plan-cost-breakdown*`.
- Modify (Test) `apps/crm/src/pages/configuracao/cobranca/__tests__/plan-display.test.ts`: rename fixture ids `pro`/`max` → `agency`/`scale` (no logic change).
- Create (Test) `apps/crm/src/pages/configuracao/cobranca/__tests__/CobrancaPage.seats.test.tsx`.

**Interfaces:**
- Consumes:
  - `BillingPlan` with `included_seats`, `seat_addon_brl`, `seat_addon_brl_annual` (Task 12).
  - `startCheckout(planId, interval, promoCode?, extraSeats?)`, `changeSeats(extraSeats)`, `getWorkspaceSeats()` → `WorkspaceSeats | null` (Task 12).
  - `computeSeatCost(...)`, `clampSeats(...)` (Task 13).
- Produces:
  - `RECOMMENDED_ID = 'agency'`.
  - `planFeatures(p: BillingPlan): string[]` returning the new "everything included" copy.
  - DOM (upgrade card): a `.seat-selector` stepper with `data-testid="seat-selector"` and `±` buttons; a `.plan-cost-breakdown` block.
  - DOM (active-subscription card): a `.seat-selector` stepper with `data-testid="active-seat-selector"` that calls `changeSeats(extra)` on confirm and invalidates `['workspace-limits', workspaceId]`.

> WHY the active-subscriber control: `canUpgradeTo(p.id, currentPlanId, hasActiveSub)` returns **false** when `hasActiveSub` is true (active subscribers manage via the portal), so the upgrade-card seat selector never renders for them. Without a separate active-subscriber control, the `changeSeats` import is dead and an active workspace has no in-app way to add/remove seats. The control below lives in the active-subscription card (lines 186–216) and is the sole consumer of `changeSeats`.

- [ ] **Step 1: Update the `plan-display.test.ts` fixtures to the new tier ids (no logic change).**

  Per spec §4.6 `plan-display.ts` has **no logic change** in Slice 1 — only the fixtures rename. In `apps/crm/src/pages/configuracao/cobranca/__tests__/plan-display.test.ts`, replace the `isInternalPlan` "catalog plans" case:

  ```ts
      it('treats catalog plans as not internal', () => {
        expect(isInternalPlan('free')).toBe(false);
        expect(isInternalPlan('pro')).toBe(false);
        expect(isInternalPlan('max')).toBe(false);
      });
  ```

  with:

  ```ts
      it('treats catalog plans as not internal', () => {
        expect(isInternalPlan('free')).toBe(false);
        expect(isInternalPlan('agency')).toBe(false);
        expect(isInternalPlan('scale')).toBe(false);
      });
  ```

  Replace the `resolveCurrentPlanId` "falls back" case:

  ```ts
      it('falls back to the subscription plan, then free', () => {
        expect(resolveCurrentPlanId(null, 'pro')).toBe('pro');
        expect(resolveCurrentPlanId(null, null)).toBe('free');
        expect(resolveCurrentPlanId(undefined, undefined)).toBe('free');
      });
  ```

  with:

  ```ts
      it('falls back to the subscription plan, then free', () => {
        expect(resolveCurrentPlanId(null, 'agency')).toBe('agency');
        expect(resolveCurrentPlanId(null, null)).toBe('free');
        expect(resolveCurrentPlanId(undefined, undefined)).toBe('free');
      });
  ```

  Replace the `isPlanVisible` cases:

  ```ts
      it('hides lifetime from a workspace not on it', () => {
        expect(isPlanVisible('lifetime', 'pro')).toBe(false);
        expect(isPlanVisible('lifetime', 'free')).toBe(false);
      });
      it('shows lifetime to the workspace that is on it', () => {
        expect(isPlanVisible('lifetime', 'lifetime')).toBe(true);
      });
      it('always shows catalog plans', () => {
        expect(isPlanVisible('pro', 'free')).toBe(true);
        expect(isPlanVisible('free', 'lifetime')).toBe(true);
      });
  ```

  with:

  ```ts
      it('hides lifetime from a workspace not on it', () => {
        expect(isPlanVisible('lifetime', 'agency')).toBe(false);
        expect(isPlanVisible('lifetime', 'free')).toBe(false);
      });
      it('shows lifetime to the workspace that is on it', () => {
        expect(isPlanVisible('lifetime', 'lifetime')).toBe(true);
      });
      it('always shows catalog plans', () => {
        expect(isPlanVisible('agency', 'free')).toBe(true);
        expect(isPlanVisible('free', 'lifetime')).toBe(true);
      });
  ```

  Replace the `canUpgradeTo` cases:

  ```ts
      it('offers paid plans to a free workspace with no subscription', () => {
        expect(canUpgradeTo('pro', 'free', false)).toBe(true);
        expect(canUpgradeTo('max', 'free', false)).toBe(true);
      });
      it('never offers an upgrade on the current plan', () => {
        expect(canUpgradeTo('free', 'free', false)).toBe(false);
        expect(canUpgradeTo('pro', 'pro', false)).toBe(false);
      });
      it('never offers free as an upgrade', () => {
        expect(canUpgradeTo('free', 'pro', false)).toBe(false);
      });
      it('offers no upgrades to a workspace on an internal/comp plan (lifetime)', () => {
        expect(canUpgradeTo('pro', 'lifetime', false)).toBe(false);
        expect(canUpgradeTo('max', 'lifetime', false)).toBe(false);
      });
      it('offers no upgrades when there is an active subscription (managed via portal)', () => {
        expect(canUpgradeTo('max', 'start', true)).toBe(false);
      });
  ```

  with:

  ```ts
      it('offers paid plans to a free workspace with no subscription', () => {
        expect(canUpgradeTo('agency', 'free', false)).toBe(true);
        expect(canUpgradeTo('scale', 'free', false)).toBe(true);
      });
      it('never offers an upgrade on the current plan', () => {
        expect(canUpgradeTo('free', 'free', false)).toBe(false);
        expect(canUpgradeTo('agency', 'agency', false)).toBe(false);
      });
      it('never offers free as an upgrade', () => {
        expect(canUpgradeTo('free', 'agency', false)).toBe(false);
      });
      it('offers no upgrades to a workspace on an internal/comp plan (lifetime)', () => {
        expect(canUpgradeTo('agency', 'lifetime', false)).toBe(false);
        expect(canUpgradeTo('scale', 'lifetime', false)).toBe(false);
      });
      it('offers no upgrades when there is an active subscription (managed via portal)', () => {
        expect(canUpgradeTo('scale', 'starter', true)).toBe(false);
      });
  ```

- [ ] **Step 2: Run the `plan-display` test & confirm it still PASSES (fixture-only rename, no logic change).**

  ```bash
  npm run test -- apps/crm/src/pages/configuracao/cobranca/__tests__/plan-display.test.ts
  ```

  Expected PASS: all cases pass (the production `plan-display.ts` is unchanged; only the input ids in the fixtures changed and the assertions follow).

- [ ] **Step 3: Write the failing RTL test for the upgrade-card seat selector + active-subscriber control + cost breakdown + copy + RECOMMENDED badge.**

  Create `apps/crm/src/pages/configuracao/cobranca/__tests__/CobrancaPage.seats.test.tsx`:

  ```tsx
  import { describe, it, expect, vi, beforeEach } from 'vitest';
  import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import { MemoryRouter } from 'react-router-dom';

  const startCheckout = vi.fn();
  const openBillingPortal = vi.fn();
  const getWorkspaceSubscription = vi.fn();
  const getEffectivePlanId = vi.fn();
  const getWorkspaceSeats = vi.fn();
  const changeSeats = vi.fn();
  const listActivePlans = vi.fn();

  vi.mock('@/services/billing', () => ({
    startCheckout: (...a: unknown[]) => startCheckout(...a),
    openBillingPortal: (...a: unknown[]) => openBillingPortal(...a),
    getWorkspaceSubscription: (...a: unknown[]) => getWorkspaceSubscription(...a),
    getEffectivePlanId: (...a: unknown[]) => getEffectivePlanId(...a),
    getWorkspaceSeats: (...a: unknown[]) => getWorkspaceSeats(...a),
    changeSeats: (...a: unknown[]) => changeSeats(...a),
    listActivePlans: (...a: unknown[]) => listActivePlans(...a),
  }));

  vi.mock('@/context/AuthContext', () => ({
    useAuth: () => ({ role: 'owner' }),
  }));

  // confirm() backs the proration confirmation on the active-subscriber control.
  vi.stubGlobal('confirm', vi.fn(() => true));

  import CobrancaPage from '../CobrancaPage';

  const AGENCY = {
    id: 'agency',
    name: 'Agency',
    price_brl: 17900,
    price_brl_annual: 179000,
    sort_order: 20,
    max_clients: 30,
    max_team_members: 5,
    storage_quota_bytes: null,
    feature_hub_portal: true,
    feature_analytics_reports: true,
    feature_brand_customization: true,
    included_seats: 5,
    seat_addon_brl: 2500,
    seat_addon_brl_annual: 25000,
  };

  function renderPage() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <CobrancaPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  describe('CobrancaPage seats', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
      startCheckout.mockReset().mockResolvedValue('https://checkout.stripe.com/x');
      openBillingPortal.mockReset();
      changeSeats.mockReset().mockResolvedValue(undefined);
      getWorkspaceSubscription.mockReset().mockResolvedValue(null);
      getEffectivePlanId.mockReset().mockResolvedValue(null);
      getWorkspaceSeats.mockReset().mockResolvedValue(null);
      listActivePlans.mockReset().mockResolvedValue([AGENCY]);
      (globalThis.confirm as ReturnType<typeof vi.fn>).mockReset?.();
      vi.stubGlobal('confirm', vi.fn(() => true));
      // jsdom: stub navigation used by handleUpgrade
      Object.defineProperty(window, 'location', {
        value: { assign: vi.fn() },
        writable: true,
      });
    });

    it('shows the "Tudo incluído" + clients + seats + add-on copy', async () => {
      renderPage();
      const card = await screen.findByText('Agency');
      const li = within(card.closest('.plan-card') as HTMLElement);
      expect(li.getByText('Tudo incluído')).toBeInTheDocument();
      expect(li.getByText('30 clientes')).toBeInTheDocument();
      expect(li.getByText('5 usuários incluídos')).toBeInTheDocument();
      expect(li.getByText(/\+R\$\s?25,00\/usuário extra/)).toBeInTheDocument();
    });

    it('renders the Recomendado badge on the agency tier', async () => {
      renderPage();
      expect(await screen.findByText('Recomendado')).toBeInTheDocument();
    });

    it('defaults the upgrade selector to included seats and increments add extra cost', async () => {
      renderPage();
      const selector = await screen.findByTestId('seat-selector');
      expect(within(selector).getByTestId('seat-count')).toHaveTextContent('5');
      fireEvent.click(within(selector).getByRole('button', { name: 'Adicionar assento' }));
      expect(within(selector).getByTestId('seat-count')).toHaveTextContent('6');
      // 1 extra × R$25 → breakdown shows the extra line and the new total
      expect(screen.getByTestId('seat-extra-cost')).toHaveTextContent('R$ 25,00');
      expect(screen.getByTestId('plan-total-cost')).toHaveTextContent('R$ 204,00');
    });

    it('does not let the upgrade selector drop below the included floor', async () => {
      renderPage();
      const selector = await screen.findByTestId('seat-selector');
      const minus = within(selector).getByRole('button', { name: 'Remover assento' });
      fireEvent.click(minus);
      expect(within(selector).getByTestId('seat-count')).toHaveTextContent('5');
    });

    it('passes extraSeats to startCheckout on upgrade', async () => {
      renderPage();
      const selector = await screen.findByTestId('seat-selector');
      fireEvent.click(within(selector).getByRole('button', { name: 'Adicionar assento' }));
      fireEvent.click(within(selector).getByRole('button', { name: 'Adicionar assento' }));
      fireEvent.click(screen.getByRole('button', { name: 'Fazer upgrade' }));
      await waitFor(() => expect(startCheckout).toHaveBeenCalled());
      expect(startCheckout).toHaveBeenCalledWith('agency', 'month', undefined, 2);
    });

    it('active subscriber: seat control defaults to total seats and changeSeats(extra) on confirm', async () => {
      getWorkspaceSubscription.mockResolvedValue({
        status: 'active',
        plan_id: 'agency',
        current_period_end: '2026-12-01T00:00:00Z',
        cancel_at_period_end: false,
        seats: 2,
      });
      getEffectivePlanId.mockResolvedValue('agency');
      // included 5 + purchased 2 = 7 effective; 4 used
      getWorkspaceSeats.mockResolvedValue({ included: 5, purchased: 2, effective: 7, used: 4 });
      renderPage();
      const selector = await screen.findByTestId('active-seat-selector');
      // total seats = included 5 + purchased 2 = 7
      expect(within(selector).getByTestId('active-seat-count')).toHaveTextContent('7');
      // add one → extra beyond included = 2 (current purchased) + 1 = 3
      fireEvent.click(within(selector).getByRole('button', { name: 'Adicionar assento' }));
      fireEvent.click(screen.getByRole('button', { name: 'Atualizar assentos' }));
      await waitFor(() => expect(changeSeats).toHaveBeenCalled());
      expect(changeSeats).toHaveBeenCalledWith(3);
    });

    it('active subscriber: floors the seat control at seats.used', async () => {
      getWorkspaceSubscription.mockResolvedValue({
        status: 'active',
        plan_id: 'agency',
        current_period_end: '2026-12-01T00:00:00Z',
        cancel_at_period_end: false,
        seats: 2,
      });
      getEffectivePlanId.mockResolvedValue('agency');
      // 6 seats in use against 7 effective → cannot drop below 6
      getWorkspaceSeats.mockResolvedValue({ included: 5, purchased: 2, effective: 7, used: 6 });
      renderPage();
      const selector = await screen.findByTestId('active-seat-selector');
      const minus = within(selector).getByRole('button', { name: 'Remover assento' });
      fireEvent.click(minus); // 7 → 6 (ok)
      fireEvent.click(minus); // 6 → clamped at used=6
      expect(within(selector).getByTestId('active-seat-count')).toHaveTextContent('6');
    });
  });
  ```

- [ ] **Step 4: Run the RTL test & confirm it FAILS.**

  ```bash
  npm run test -- apps/crm/src/pages/configuracao/cobranca/__tests__/CobrancaPage.seats.test.tsx
  ```

  Expected FAIL: `Tudo incluído` is not found (current `planFeatures` emits per-feature bullets), there is no `seat-selector`/`active-seat-selector` testid, the Recomendado badge does not render on `agency` because `RECOMMENDED_ID === 'pro'`, and `@/services/billing` has no `getWorkspaceSeats`/`changeSeats` to import.

- [ ] **Step 5: Change imports, `RECOMMENDED_ID`, drop `formatStorage`, and rewrite `planFeatures` copy (MINIMAL).**

  In `apps/crm/src/pages/configuracao/cobranca/CobrancaPage.tsx`, replace the top imports (lines 1–16):

  ```tsx
  import { useEffect, useMemo, useState } from 'react';
  import { useSearchParams } from 'react-router-dom';
  import { useQuery } from '@tanstack/react-query';
  import { toast } from 'sonner';
  import { useAuth } from '@/context/AuthContext';
  import {
    listActivePlans,
    getWorkspaceSubscription,
    getEffectivePlanId,
    startCheckout,
    openBillingPortal,
    type BillingInterval,
    type BillingPlan,
  } from '@/services/billing';
  import { isInternalPlan, resolveCurrentPlanId, isPlanVisible, canUpgradeTo } from './plan-display';
  import './cobranca.css';
  ```

  with:

  ```tsx
  import { useEffect, useMemo, useState } from 'react';
  import { useSearchParams } from 'react-router-dom';
  import { useQuery, useQueryClient } from '@tanstack/react-query';
  import { toast } from 'sonner';
  import { useAuth } from '@/context/AuthContext';
  import {
    listActivePlans,
    getWorkspaceSubscription,
    getEffectivePlanId,
    getWorkspaceSeats,
    startCheckout,
    changeSeats,
    openBillingPortal,
    type BillingInterval,
    type BillingPlan,
  } from '@/services/billing';
  import { isInternalPlan, resolveCurrentPlanId, isPlanVisible, canUpgradeTo } from './plan-display';
  import { computeSeatCost, clampSeats } from './seat-pricing';
  import './cobranca.css';
  ```

  Replace line 18:

  ```tsx
  const RECOMMENDED_ID = 'pro';
  ```

  with:

  ```tsx
  const RECOMMENDED_ID = 'agency';
  ```

  Remove the now-unused `formatStorage` (lines 25–29) — replace:

  ```tsx
  function formatStorage(bytes: number): string {
    const gb = bytes / 1024 ** 3;
    if (gb >= 1) return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
    return `${Math.round(bytes / 1024 ** 2)} MB`;
  }

  function formatDate(iso: string | null): string {
  ```

  with:

  ```tsx
  function formatDate(iso: string | null): string {
  ```

  Replace `planFeatures` (lines 38–56):

  ```tsx
  function planFeatures(p: BillingPlan): string[] {
    const out: string[] = [];
    out.push(
      p.max_clients == null
        ? 'Clientes ilimitados'
        : `${p.max_clients} ${p.max_clients === 1 ? 'cliente' : 'clientes'}`,
    );
    out.push(
      p.max_team_members == null
        ? 'Usuários ilimitados'
        : `${p.max_team_members} ${p.max_team_members === 1 ? 'usuário' : 'usuários'}`,
    );
    if (p.storage_quota_bytes != null)
      out.push(`${formatStorage(p.storage_quota_bytes)} de armazenamento`);
    if (p.feature_hub_portal) out.push('Portal de aprovação do cliente');
    if (p.feature_analytics_reports) out.push('Relatórios de desempenho');
    if (p.feature_brand_customization) out.push('Personalização de marca');
    return out;
  }
  ```

  with:

  ```tsx
  function planFeatures(p: BillingPlan): string[] {
    const out: string[] = ['Tudo incluído'];
    out.push(
      p.max_clients == null
        ? 'Clientes ilimitados'
        : `${p.max_clients} ${p.max_clients === 1 ? 'cliente' : 'clientes'}`,
    );
    const seats = p.included_seats;
    out.push(
      seats == null
        ? 'Usuários ilimitados'
        : `${seats} ${seats === 1 ? 'usuário incluído' : 'usuários incluídos'}`,
    );
    const addon = p.seat_addon_brl;
    if (addon != null && addon > 0) out.push(`+${formatBRL(addon)}/usuário extra`);
    return out;
  }
  ```

- [ ] **Step 6: Add the seats query, per-plan seat state, helpers, active-subscriber seat state + `handleSeatChange`, and seat-aware `handleUpgrade`.**

  In `apps/crm/src/pages/configuracao/cobranca/CobrancaPage.tsx`, add `queryClient` + seat selection state next to the other hooks. Replace the component-head state (lines 59–63):

  ```tsx
    const { role } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    const [interval, setInterval] = useState<BillingInterval>('month');
    const [busy, setBusy] = useState<string | null>(null);
    const [promo, setPromo] = useState('');
  ```

  with:

  ```tsx
    const { role } = useAuth();
    const queryClient = useQueryClient();
    const [searchParams, setSearchParams] = useSearchParams();
    const [interval, setInterval] = useState<BillingInterval>('month');
    const [busy, setBusy] = useState<string | null>(null);
    const [promo, setPromo] = useState('');
    // Per-plan selected TOTAL seats on the upgrade cards (keyed by plan id).
    const [seatSel, setSeatSel] = useState<Record<string, number>>({});
    // Selected TOTAL seats on the active-subscription control. null = default to current.
    const [activeSeats, setActiveSeats] = useState<number | null>(null);
  ```

  Add the seats query right after the `effectivePlanId` query (after line 82, i.e. after the closing `});` of that `useQuery`):

  ```tsx
    // Server-computed seat block (included/purchased/effective/used) — the floor for
    // the in-app remove path and the backing for the active-subscriber control.
    const { data: seats } = useQuery({
      queryKey: ['workspace-limits', 'seats'],
      queryFn: getWorkspaceSeats,
      enabled: isOwner,
    });
  ```

  Replace `handleUpgrade` (lines 138–147):

  ```tsx
    async function handleUpgrade(planId: string) {
      setBusy(planId);
      try {
        const url = await startCheckout(planId, interval, promo.trim() || undefined);
        window.location.assign(url);
      } catch (err) {
        toast.error('Erro ao iniciar checkout: ' + (err as Error).message);
        setBusy(null);
      }
    }
  ```

  with:

  ```tsx
    function seatsFor(p: BillingPlan): number {
      const floor = p.included_seats ?? 0;
      return seatSel[p.id] ?? floor;
    }

    function adjustSeats(p: BillingPlan, delta: number) {
      setSeatSel((prev) => {
        const current = prev[p.id] ?? p.included_seats ?? 0;
        // At checkout there is no existing sub, so the currentSeats floor is 0;
        // clampSeats keeps the value at or above the included base.
        const next = clampSeats(current + delta, p.included_seats, 0);
        return { ...prev, [p.id]: next };
      });
    }

    async function handleUpgrade(planId: string) {
      const plan = plans?.find((p) => p.id === planId);
      const extraSeats = plan ? Math.max(0, seatsFor(plan) - (plan.included_seats ?? 0)) : 0;
      setBusy(planId);
      try {
        const url = await startCheckout(planId, interval, promo.trim() || undefined, extraSeats);
        window.location.assign(url);
      } catch (err) {
        toast.error('Erro ao iniciar checkout: ' + (err as Error).message);
        setBusy(null);
      }
    }

    // Active-subscriber TOTAL seats. effective = included + purchased; default the
    // stepper to that, with the remove-floor at max(included, used) so you can never
    // drop below seats already in use.
    const includedSeats = seats?.included ?? null;
    const totalSeats = seats?.effective ?? (seats ? (seats.included ?? 0) + seats.purchased : 0);
    const seatFloor = Math.max(includedSeats ?? 0, seats?.used ?? 0);
    const selectedActiveSeats = activeSeats ?? totalSeats;

    function adjustActiveSeats(delta: number) {
      setActiveSeats((prev) => {
        const current = prev ?? totalSeats;
        // floor = max(included, used): never below what's already in use.
        return clampSeats(current + delta, includedSeats, seats?.used ?? 0);
      });
    }

    async function handleSeatChange() {
      const extra = Math.max(0, selectedActiveSeats - (includedSeats ?? 0));
      const delta = selectedActiveSeats - totalSeats;
      if (delta === 0) return;
      const verb = delta > 0 ? 'adicionar' : 'remover';
      const ok = window.confirm(
        `Você vai ${verb} ${Math.abs(delta)} assento(s). O valor será ajustado proporcionalmente (pró-rata) no seu próximo ciclo. Confirmar?`,
      );
      if (!ok) return;
      setBusy('seats');
      try {
        await changeSeats(extra);
        await queryClient.invalidateQueries({ queryKey: ['workspace-limits', 'seats'] });
        setActiveSeats(null);
        toast.success('Assentos atualizados.');
      } catch (err) {
        toast.error('Erro ao atualizar assentos: ' + (err as Error).message);
      } finally {
        setBusy(null);
      }
    }
  ```

  > NOTE on the invalidate key: the spec asks to invalidate `['workspace-limits', workspaceId]`. This page does not hold a `workspaceId` (the workspace is resolved server-side from the JWT), and the local seats query is keyed `['workspace-limits', 'seats']`. Invalidating that key refetches `getWorkspaceSeats` and re-renders the control. If a `['workspace-limits', workspaceId]` query exists elsewhere (e.g. the invite/seat gate), add a second `invalidateQueries` for that exact key here so the gate refreshes too.

- [ ] **Step 7: Render the active-subscriber seat control in the active-subscription card.**

  In `apps/crm/src/pages/configuracao/cobranca/CobrancaPage.tsx`, the active-subscription `card` block is lines 186–216. Insert the seat control just before the closing `</div>` of the `card` (after the `Gerenciar assinatura` button's wrapping `</div>` on line 209, i.e. between line 209 and the `</div>` on line 214). Replace:

  ```tsx
            <button className="btn-secondary" onClick={handleManage} disabled={busy === 'portal'}>
              <i className="ph ph-gear-six" aria-hidden="true" />
              {busy === 'portal' ? 'Aguarde…' : 'Gerenciar assinatura'}
            </button>
          </div>
        </div>
      )}
  ```

  with:

  ```tsx
            <button className="btn-secondary" onClick={handleManage} disabled={busy === 'portal'}>
              <i className="ph ph-gear-six" aria-hidden="true" />
              {busy === 'portal' ? 'Aguarde…' : 'Gerenciar assinatura'}
            </button>
          </div>

          {seats != null && (
            <div className="seat-selector" data-testid="active-seat-selector">
              <span className="seat-selector__label">
                Usuários ({seats.used} em uso)
              </span>
              <div className="seat-selector__control">
                <button
                  type="button"
                  className="seat-selector__btn"
                  aria-label="Remover assento"
                  onClick={() => adjustActiveSeats(-1)}
                  disabled={selectedActiveSeats <= seatFloor || busy === 'seats'}
                >
                  <i className="ph ph-minus" aria-hidden="true" />
                </button>
                <span
                  className="seat-selector__readout"
                  data-testid="active-seat-count"
                  aria-live="polite"
                >
                  {selectedActiveSeats}
                </span>
                <button
                  type="button"
                  className="seat-selector__btn"
                  aria-label="Adicionar assento"
                  onClick={() => adjustActiveSeats(1)}
                  disabled={busy === 'seats'}
                >
                  <i className="ph ph-plus" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleSeatChange}
                  disabled={busy === 'seats' || selectedActiveSeats === totalSeats}
                >
                  {busy === 'seats' ? 'Aguarde…' : 'Atualizar assentos'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
  ```

- [ ] **Step 8: Render the upgrade-card seat selector + cost breakdown.**

  In `apps/crm/src/pages/configuracao/cobranca/CobrancaPage.tsx`, insert the selector + breakdown between the `<ul className="plan-features">…</ul>` block and the `<div className="plan-cta">…</div>` (currently lines 306–315). Replace:

  ```tsx
                  <ul className="plan-features">
                    {planFeatures(p).map((f) => (
                      <li key={f}>
                        <i className="ph ph-check" aria-hidden="true" />
                        {f}
                      </li>
                    ))}
                  </ul>

                  <div className="plan-cta">{renderCta(p)}</div>
  ```

  with:

  ```tsx
                  <ul className="plan-features">
                    {planFeatures(p).map((f) => (
                      <li key={f}>
                        <i className="ph ph-check" aria-hidden="true" />
                        {f}
                      </li>
                    ))}
                  </ul>

                  {canUpgradeTo(p.id, currentPlanId, hasActiveSub) &&
                    (() => {
                      const selected = seatsFor(p);
                      const base =
                        isYear && p.price_brl_annual != null ? p.price_brl_annual : (p.price_brl ?? 0);
                      const cost = computeSeatCost({
                        basePriceCentavos: base,
                        includedSeats: p.included_seats,
                        selectedSeats: selected,
                        seatAddonCentavos: p.seat_addon_brl ?? 0,
                        interval,
                      });
                      return (
                        <>
                          <div className="seat-selector" data-testid="seat-selector">
                            <span className="seat-selector__label">Usuários</span>
                            <div className="seat-selector__control">
                              <button
                                type="button"
                                className="seat-selector__btn"
                                aria-label="Remover assento"
                                onClick={() => adjustSeats(p, -1)}
                                disabled={selected <= (p.included_seats ?? 0)}
                              >
                                <i className="ph ph-minus" aria-hidden="true" />
                              </button>
                              <span
                                className="seat-selector__readout"
                                data-testid="seat-count"
                                aria-live="polite"
                              >
                                {selected}
                              </span>
                              <button
                                type="button"
                                className="seat-selector__btn"
                                aria-label="Adicionar assento"
                                onClick={() => adjustSeats(p, 1)}
                              >
                                <i className="ph ph-plus" aria-hidden="true" />
                              </button>
                            </div>
                          </div>
                          <div className="plan-cost-breakdown">
                            <div className="plan-cost-breakdown__row">
                              <span>Base</span>
                              <span>{formatBRL(base)}</span>
                            </div>
                            {cost.extraSeats > 0 && (
                              <div className="plan-cost-breakdown__row">
                                <span>
                                  {cost.extraSeats}{' '}
                                  {cost.extraSeats === 1 ? 'usuário extra' : 'usuários extras'}{' '}
                                  × {formatBRL(p.seat_addon_brl ?? 0)}
                                </span>
                                <span data-testid="seat-extra-cost">
                                  {formatBRL(cost.extraCostCentavos)}
                                </span>
                              </div>
                            )}
                            <div className="plan-cost-breakdown__row plan-cost-breakdown__total">
                              <span>Total{isYear ? '/ano' : '/mês'}</span>
                              <span data-testid="plan-total-cost">
                                {formatBRL(cost.totalCentavos)}
                              </span>
                            </div>
                          </div>
                        </>
                      );
                    })()}

                  <div className="plan-cta">{renderCta(p)}</div>
  ```

  > NOTE: `seat-extra-cost` reads `cost.extraCostCentavos` directly from `computeSeatCost` (which already applies the `×10` annual multiplier). The earlier draft recomputed the annual figure inline — this version trusts the single source of truth so the breakdown and total can never drift.

- [ ] **Step 9: Run the RTL test & confirm it PASSES.**

  ```bash
  npm run test -- apps/crm/src/pages/configuracao/cobranca/__tests__/CobrancaPage.seats.test.tsx
  ```

  Expected PASS: copy bullets render; the Recomendado badge shows on `agency`; the upgrade stepper defaults to 5, increments to 6 with `R$ 25,00` extra and `R$ 204,00` total (`17900 + 2500 = 20400`); the upgrade floor holds at 5; `startCheckout('agency', 'month', undefined, 2)` is called; the active-subscriber control defaults to 7 (included 5 + purchased 2), calls `changeSeats(3)` on confirm, and floors at `used` (6).

- [ ] **Step 10: Add the `.seat-selector` + `.plan-cost-breakdown` styles.**

  In `apps/crm/src/pages/configuracao/cobranca/cobranca.css`, insert before the `/* CTA */` block (before `.plan-cta {`):

  ```css
  /* Seat selector (stepper) + cost breakdown — shared by the upgrade cards and the
     active-subscription seat control */
  .seat-selector {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.6rem 0;
    border-top: 1px solid var(--border-color);
  }
  .seat-selector__label {
    font-family: var(--font-mono);
    font-size: 0.68rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-light);
  }
  .seat-selector__control {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }
  .seat-selector__btn {
    appearance: none;
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--surface-main);
    color: var(--text-main);
    cursor: pointer;
    transition:
      border-color var(--transition),
      color var(--transition);
  }
  .seat-selector__btn:hover:not(:disabled) {
    border-color: var(--primary-color);
    color: var(--primary-hover);
  }
  .seat-selector__btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .seat-selector__readout {
    min-width: 2ch;
    text-align: center;
    font-family: var(--font-mono);
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text-main);
  }

  .plan-cost-breakdown {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    margin-top: 0.2rem;
    padding-top: 0.6rem;
    border-top: 1px dashed var(--border-color);
  }
  .plan-cost-breakdown__row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: var(--text-light);
  }
  .plan-cost-breakdown__total {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--text-main);
  }
  ```

  > NOTE: confirm the anchor before editing — open `cobranca.css` and search for the comment that precedes `.plan-cta {` (the draft assumed `/* CTA */`). If that exact comment is absent, insert the block immediately before the first `.plan-cta {` rule instead.

- [ ] **Step 11: Run the full cobranca suite & confirm all PASS.**

  ```bash
  npm run test -- apps/crm/src/pages/configuracao/cobranca
  ```

  Expected PASS: `plan-display.test.ts`, `seat-pricing.test.ts`, and `CobrancaPage.seats.test.tsx` all pass.

- [ ] **Step 12: Typecheck the CRM build.**

  ```bash
  npm run build
  ```

  Expected PASS: `tsc` reports no errors (`formatStorage` removed so no unused-symbol error; `computeSeatCost`/`clampSeats`/`changeSeats`/`getWorkspaceSeats`/`useQueryClient` all consumed).

- [ ] **Step 13: Commit.**

  ```bash
  git add apps/crm/src/pages/configuracao/cobranca/CobrancaPage.tsx apps/crm/src/pages/configuracao/cobranca/cobranca.css apps/crm/src/pages/configuracao/cobranca/__tests__/plan-display.test.ts apps/crm/src/pages/configuracao/cobranca/__tests__/CobrancaPage.seats.test.tsx
  git commit -m "feat(billing): seat selectors (upgrade + active sub) + cost breakdown on CobrancaPage, RECOMMENDED_ID=agency

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

---

## Deployment & rollout runbook

Execute in this order — it is load-bearing (a wrong order breaks the live paywall):

1. **Stripe dashboard / API:** create the price objects — 3 tiers × {monthly, annual} + the seat add-on × {monthly, annual} = **8 recurring Prices** (currency `brl`, annual ≈ 10× monthly, the seat price's `recurring.interval` matched to the tier interval). Webhook event subscriptions are unchanged. In the **Billing Portal** config, ensure the customer **cannot edit quantity** on the seat product (so `billing-seats` is the single validated writer).
2. **DB migrations** (apply to **staging** first via `npx supabase db push --linked --dry-run` then apply; **prod** via SQL editor recording the version row), in file order: (a) plans seat-price-id + `seat_addon_brl*` columns + the 3 tier rows; (b) `workspace_subscriptions.purchased_seats`; (c) `CREATE OR REPLACE effective_plan_limit`. Old plans stay `is_active=true`; `is_default` stays on `free`.
3. **Deploy `stripe-webhook` FIRST** (multi-item, order-independent, status-aware seats — backward-compatible with single-item subs). Its extended `loadPlanPriceRows` select references the new columns, so the migration in step 2 **must** already be applied or every webhook (incl. renewals) 500s.
4. **Deploy `billing-checkout`** (emits the seat line item), then **`billing-seats`** (in-app seat change), then **`platform-admin`** (multi-item amount sum). All with `--use-api --no-verify-jwt`.
5. **Admin:** paste all tier + seat price ids and the seat display prices via `PlansPage`.
6. **Verify on staging:** end-to-end checkout of a new tier with extra seats → webhook writes `purchased_seats` → `effective_plan_limit` raises the invite cap → the entitlements SQL suite is green.
7. **Deploy CRM frontend** (seat selector, cost breakdown, active-subscriber seat control, `RECOMMENDED_ID='agency'`).

**Rollback** = inverse order: frontend → edge functions (revert to single-item `data[0]` versions) → leave the additive columns in place (inert when unread); drop columns last, if ever. All columns use `ADD COLUMN IF NOT EXISTS` for idempotent re-apply.

**Manual verification (untested handler wiring):** the edge-function *handlers* (webhook `syncSubscription`, `billing-checkout`, `billing-seats`, `workspace-limits`) are covered at the pure-helper level + `deno check`; exercise these paths manually in Stripe **test mode** with `stripe listen --forward-to`: (a) checkout a new tier with N extra seats and confirm `purchased_seats` + the invite cap; (b) cancel and confirm `purchased_seats`→0 and the cap drops to base; (c) feed a subscription with an unknown tier price and confirm `plan_id` is **left unchanged** (not downgraded to free); (d) add/remove seats in-app and confirm proration + that the webhook (not `billing-seats`) is the sole writer.

## Verifier corrections folded in

This plan was drafted by parallel agents and then adversarially verified; the following fixes from that pass are already applied in the tasks below: the `billing-seats` occupancy RPC counts pending invites by `conta_id` (the `invites` table has no `workspace_id`); the `plans.seat_addon_brl` / `seat_addon_brl_annual` display-price columns are created, seeded, admin-editable, and read by the cost breakdown; `getWorkspaceSubscription` selects `purchased_seats` so `WorkspaceSubscription.seats` is populated; the active-subscriber seat add/remove control wires `changeSeats()` + invalidates `['workspace-limits', workspaceId]`; `billing-portal` notes that seat changes route through `billing-seats`; and Task 4's `03_workspace_scoped.sql` edit anchors on the real seat block.

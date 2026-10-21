# Admin Métricas: histórico de MRR e churn (sub-projeto B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store a daily per-workspace subscription snapshot, backfill June–August from Stripe and Pagar.me, and show monthly MRR/ARR, movement and churn charts on `/admin/metricas`, with the Dashboard's MRR tiles linking there.

**Architecture:** A pg_cron job calls a new edge function `metrics-snapshot-cron`, which prices `workspace_subscriptions` with the same `priceSubscriptionRows` as `get-mrr` and writes the whole day atomically through the RPC `admin_metrics_write_snapshot` (rows + completion marker). `platform-admin` gets `get-metrics-history` (reads marked month closes, classifies transitions in pure TypeScript) and `backfill-metrics` (prod-only guard, rebuilds month-end rows from provider history). The admin app renders two new Chart.js sections above Depósitos.

**Tech Stack:** Postgres + pg_cron (Supabase), Deno edge functions, React 19 + TanStack Query + Chart.js 4 / react-chartjs-2 5 (already root deps), Vitest, Deno test, psql suites.

**Spec:** `docs/superpowers/specs/2026-09-25-admin-metricas-historico-design.md` (read §4 before Task 5).

## Global Constraints

- All user-facing copy in Portuguese, **no em-dashes (—)** in any UI string.
- No hex colour literals in admin page/section files (`apps/admin/src/__tests__/no-hex-literals.test.ts`); chart colours come from CSS tokens wrapped in `hsl(...)`.
- Edge functions never return raw error details: generic message out, detail to `console.error`.
- Cron auth: `x-cron-secret` checked with `timingSafeEqual` before any work; failures call `reportCronFailure`.
- Internal (`is_internal`) workspaces never get snapshot rows. The snapshot writers (cron + backfill) use `fetchInternalWorkspaceIdsOrThrow` (fails CLOSED); `get-mrr`/`get-trials` keep the fail-open `fetchInternalWorkspaceIds`.
- "Pagante" = `status === "active"` AND `monthly_cents > 0` (same eligibility as `aggregateMrr`). Exception: a `pagarme` row with `status === "trialing"`, `provider_switch === true` and `monthly_cents > 0` is also pagante (switch in progress).
- `amount_source` values: `stripe | pagarme | catalog | backfill | unpriced` (helper `null` → `unpriced`, `monthly_cents` 0).
- Snapshot column is `billing_interval` (not `interval`).
- Snapshot date = calendar date in America/Sao_Paulo (fixed UTC-3, no DST since 2019). Month close instant for date D = D at 23:44 São Paulo = D+1 02:44 UTC.
- Cron schedule `44 2 * * *` (UTC). Function name `metrics-snapshot-cron`.
- Backfill guard: env `METRICS_BACKFILL_ALLOWED` must equal `"true"`, else HTTP 403 `{ "error": "backfill_not_allowed" }` **before any remote or DB call**.
- RPC grants exactly: `revoke all ... from public, anon, authenticated; grant execute ... to service_role;`.
- Never commit `deno.lock`. After any `deno test`, run `git checkout deno.lock`. If `node_modules/.deno` exists before running Vitest or `tsc`, run `rm -rf node_modules/.deno && npm ci` first (Deno pollutes `node_modules`).
- Deno test command for one file: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys <file>`.
- Vitest for one file: `npx vitest run <file>` from the repo root.
- Commit trailer on every commit: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File map

| File | Responsibility |
|---|---|
| `supabase/functions/_shared/sao-paulo-date.ts` (new) | São Paulo date, close instant, month helpers |
| `supabase/functions/_shared/stripe-amount.ts` (modify) | extract pure `stripeAmountFromSubscription` |
| `supabase/functions/_shared/internal-workspaces.ts` (modify) | add fail-closed `fetchInternalWorkspaceIdsOrThrow` |
| `supabase/functions/_shared/metrics-snapshot.ts` (new) | `SnapshotRow` type, `toSnapshotRows`, `writeSnapshot` RPC wrapper |
| `supabase/migrations/20260925130001_metrics_snapshots.sql` (new) | tables, RPC, grants, cron schedule |
| `supabase/tests/metrics_snapshot_rpcs.sql` (new) | psql suite for the RPC |
| `supabase/functions/metrics-snapshot-cron/{handler,index}.ts` (new) | cron function |
| `supabase/functions/platform-admin/mrr.ts` (modify) | exclude internal workspaces |
| `supabase/functions/platform-admin/metrics-logic.ts` (new) | pure closes + classification + month aggregation |
| `supabase/functions/platform-admin/metrics-history.ts` (new) | `get-metrics-history` handler |
| `supabase/functions/platform-admin/metrics-backfill-logic.ts` (new) | pure backfill status/mapping/precedence |
| `supabase/functions/platform-admin/metrics-backfill.ts` (new) | provider gateways + `backfill-metrics` handler |
| `supabase/functions/platform-admin/index.ts` (modify) | route the two actions |
| `apps/admin/src/lib/api.ts` (modify) | types + `getMetricsHistory` / `backfillMetrics` |
| `apps/admin/src/lib/chartTheme.ts` (new) | theme-aware chart colours from CSS tokens + Chart.js registration |
| `apps/admin/src/globals.css` (modify) | `--chart-1..3` tokens, both themes |
| `apps/admin/src/pages/metricas/metrics-view.ts` (new) | pure view helpers |
| `apps/admin/src/pages/metricas/useMetricsHistory.ts` (new) | shared React Query hook |
| `apps/admin/src/pages/metricas/RevenueSection.tsx` (new) | `#mrr` section |
| `apps/admin/src/pages/metricas/MovementSection.tsx` (new) | `#churn` section |
| `apps/admin/src/pages/MetricasPage.tsx` (modify) | sections, backfill button, hash scroll |
| `apps/admin/src/pages/DashboardPage.tsx` (modify) | tiles MRR / Pagantes / MRR projetado link to `#mrr` |
| `CLAUDE.md` (modify) | document `METRICS_BACKFILL_ALLOWED` |

---

### Task 1: Shared primitives (São Paulo dates, pure Stripe amount, fail-closed internal lookup)

**Files:**
- Create: `supabase/functions/_shared/sao-paulo-date.ts`
- Modify: `supabase/functions/_shared/stripe-amount.ts` (function `fetchStripeAmount`, lines ~90-145)
- Modify: `supabase/functions/_shared/internal-workspaces.ts`
- Test: `supabase/functions/__tests__/sao-paulo-date_test.ts` (new), `supabase/functions/__tests__/stripe-amount_test.ts` (append), `supabase/functions/__tests__/internal-workspaces_test.ts` (append)

**Interfaces:**
- Produces:
  - `saoPauloDate(now: Date): string` → `'YYYY-MM-DD'`
  - `closeInstant(date: string): Date`
  - `lastDayOfMonth(month: string): string`
  - `monthRange(from: string, to: string): string[]`
  - `previousMonth(month: string): string`
  - `stripeAmountFromSubscription(sub: unknown, fallbackInterval: string | null): StripeAmount`
  - `fetchInternalWorkspaceIdsOrThrow(svc): Promise<Set<string>>`

- [ ] **Step 1: Write failing tests for the date helpers**

`supabase/functions/__tests__/sao-paulo-date_test.ts`:

```ts
import { assertEquals } from "./assert.ts";
import {
  closeInstant,
  lastDayOfMonth,
  monthRange,
  previousMonth,
  saoPauloDate,
} from "../_shared/sao-paulo-date.ts";

Deno.test("saoPauloDate: before 03:00 UTC is still the previous São Paulo day", () => {
  assertEquals(saoPauloDate(new Date("2026-09-25T02:59:59Z")), "2026-09-24");
  assertEquals(saoPauloDate(new Date("2026-09-25T03:00:00Z")), "2026-09-25");
});

Deno.test("saoPauloDate: the 02:44 UTC cron tick belongs to the previous São Paulo day", () => {
  assertEquals(saoPauloDate(new Date("2026-10-01T02:44:00Z")), "2026-09-30");
});

Deno.test("closeInstant: D at 23:44 São Paulo is D+1 02:44 UTC, across month and year ends", () => {
  assertEquals(closeInstant("2026-06-30").toISOString(), "2026-07-01T02:44:00.000Z");
  assertEquals(closeInstant("2026-12-31").toISOString(), "2027-01-01T02:44:00.000Z");
});

Deno.test("lastDayOfMonth handles February and leap years", () => {
  assertEquals(lastDayOfMonth("2026-02"), "2026-02-28");
  assertEquals(lastDayOfMonth("2028-02"), "2028-02-29");
  assertEquals(lastDayOfMonth("2026-09"), "2026-09-30");
});

Deno.test("monthRange is inclusive and crosses years; empty when from > to", () => {
  assertEquals(monthRange("2026-11", "2027-02"), ["2026-11", "2026-12", "2027-01", "2027-02"]);
  assertEquals(monthRange("2026-09", "2026-09"), ["2026-09"]);
  assertEquals(monthRange("2026-10", "2026-09"), []);
});

Deno.test("previousMonth wraps the year", () => {
  assertEquals(previousMonth("2026-01"), "2025-12");
  assertEquals(previousMonth("2026-09"), "2026-08");
});
```

- [ ] **Step 2: Run it, expect failure** (module not found)

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/sao-paulo-date_test.ts`

- [ ] **Step 3: Implement `supabase/functions/_shared/sao-paulo-date.ts`**

```ts
// Calendar helpers for the admin metrics snapshots. Brazil abolished daylight saving time in
// 2019, so America/Sao_Paulo is a fixed UTC-3 and plain offset arithmetic is exact.

const SP_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Calendar date (YYYY-MM-DD) in São Paulo at the given instant. */
export function saoPauloDate(now: Date): string {
  return new Date(now.getTime() - SP_OFFSET_MS).toISOString().slice(0, 10);
}

/** The metrics close of São Paulo date D: 23:44 local, i.e. D+1 at 02:44 UTC (the cron tick). */
export function closeInstant(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1, 2, 44, 0));
}

/** Last calendar day (YYYY-MM-DD) of month 'YYYY-MM'. */
export function lastDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Inclusive list of months 'YYYY-MM' from `from` to `to`; empty when from > to. */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/** The month before 'YYYY-MM'. */
export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}
```

- [ ] **Step 4: Run the date tests, expect PASS**

- [ ] **Step 5: Write failing tests for `stripeAmountFromSubscription`**

Append to `supabase/functions/__tests__/stripe-amount_test.ts` (keep existing imports; add `stripeAmountFromSubscription` to the import from `../_shared/stripe-amount.ts`):

```ts
Deno.test("stripeAmountFromSubscription applies a percent coupon from discounts[]", () => {
  const amt = stripeAmountFromSubscription(
    {
      livemode: true,
      items: { data: [{ quantity: 1, price: { unit_amount: 10000, currency: "brl", recurring: { interval: "month" } } }] },
      discounts: [{ coupon: { id: "c1", name: "Parceiro", percent_off: 20 } }],
    },
    null,
  );
  assertEquals(amt.amount_cents, 8000);
  assertEquals(amt.gross_cents, 10000);
  assertEquals(amt.interval, "month");
  assertEquals(amt.discount_label, "Parceiro −20%");
});

Deno.test("stripeAmountFromSubscription: no coupon, interval falls back when price lacks recurring", () => {
  const amt = stripeAmountFromSubscription(
    { items: { data: [{ quantity: 2, price: { unit_amount: 5000, currency: "brl" } }] } },
    "year",
  );
  assertEquals(amt.amount_cents, 10000);
  assertEquals(amt.gross_cents, null);
  assertEquals(amt.interval, "year");
  assertEquals(amt.discount_label, null);
});
```

(`−` in the discount label is the existing U+2212 minus sign already produced by `fetchStripeAmount`, not an em-dash; it is not UI copy added by this plan.)

- [ ] **Step 6: Run, expect FAIL** (`stripeAmountFromSubscription` not exported)

- [ ] **Step 7: Extract the pure function in `stripe-amount.ts`**

Replace the body of `fetchStripeAmount` after the `try/catch` retrieval with a call to a new exported function that holds the existing parsing logic, verbatim:

```ts
/**
 * Pure: what a subscription object charges per interval, net of its active coupon. Shared by
 * fetchStripeAmount (live retrieve) and the metrics backfill (subscriptions.list pages).
 */
export function stripeAmountFromSubscription(
  sub: unknown,
  fallbackInterval: string | null,
): StripeAmount {
  const s = sub as {
    livemode?: boolean;
    items?: {
      data?: Array<{
        quantity?: number;
        price?: { unit_amount?: number | null; currency?: string; recurring?: { interval?: string } };
      }>;
    };
  };
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
}
```

and `fetchStripeAmount` ends with `return stripeAmountFromSubscription(sub, fallbackInterval);`.

- [ ] **Step 8: Write failing test for the fail-closed lookup**

Append to `supabase/functions/__tests__/internal-workspaces_test.ts` (add `fetchInternalWorkspaceIdsOrThrow` to its import):

```ts
Deno.test("fetchInternalWorkspaceIdsOrThrow returns the set on success", async () => {
  const svc = {
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [{ id: "w1" }], error: null }) }) }),
  };
  const ids = await fetchInternalWorkspaceIdsOrThrow(svc);
  assertEquals([...ids], ["w1"]);
});

Deno.test("fetchInternalWorkspaceIdsOrThrow throws on a query error instead of excluding none", async () => {
  const svc = {
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: null, error: { message: "boom" } }) }) }),
  };
  let threw = false;
  try {
    await fetchInternalWorkspaceIdsOrThrow(svc);
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});
```

If the file does not already import `assertEquals`, add `import { assertEquals } from "./assert.ts";`.

- [ ] **Step 9: Implement in `_shared/internal-workspaces.ts`** (append):

```ts
/**
 * Fail-CLOSED variant for writers of durable history (admin metrics snapshots). A snapshot
 * written with an internal workspace inside pollutes the history forever, so a lookup failure
 * must abort the write instead of excluding none.
 */
export async function fetchInternalWorkspaceIdsOrThrow(svc: DbClient): Promise<Set<string>> {
  const { data, error } = await svc.from("workspaces").select("id").eq("is_internal", true);
  if (error) throw new Error(`internal workspace lookup failed: ${error.message}`);
  return new Set<string>(((data ?? []) as Array<{ id: string }>).map((w) => w.id));
}
```

- [ ] **Step 10: Run the three test files, expect PASS**; then `git checkout deno.lock`.

- [ ] **Step 11: Commit**

```bash
git add supabase/functions/_shared/sao-paulo-date.ts supabase/functions/_shared/stripe-amount.ts supabase/functions/_shared/internal-workspaces.ts supabase/functions/__tests__/sao-paulo-date_test.ts supabase/functions/__tests__/stripe-amount_test.ts supabase/functions/__tests__/internal-workspaces_test.ts
git commit -m "feat(metrics): helpers de data de São Paulo, preço Stripe puro e lookup de internos que falha fechado

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Migration (tables, write RPC, grants, schedule) + psql suite

**Files:**
- Create: `supabase/migrations/20260925130001_metrics_snapshots.sql`
- Create: `supabase/tests/metrics_snapshot_rpcs.sql`

**Interfaces:**
- Produces: tables `workspace_subscription_snapshots`, `metrics_snapshot_runs`; RPC `admin_metrics_write_snapshot(p_date date, p_source text, p_rows jsonb) returns jsonb` → `{ "written": int, "skipped": bool }`. Each element of `p_rows` has keys `workspace_id, provider, plan_id, plan_name, status, billing_interval, monthly_cents, amount_source, provider_switch`.

- [ ] **Step 1: Check the migration version is free**

Run: `ls supabase/migrations | tail -3` — the new version `20260925130001` must be greater than the last one and unique. If `main` has moved past it, pick the next free `2026092513000N`.

- [ ] **Step 2: Write the psql suite first** — `supabase/tests/metrics_snapshot_rpcs.sql`:

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql
begin;
do $$
declare
  v_ws uuid; v_ws2 uuid; v_res jsonb; v_n int; v_raised boolean;
  v_row1 jsonb; v_row2 jsonb;
begin
  v_ws := et_make_workspace('free');
  v_ws2 := et_make_workspace('free');
  v_row1 := jsonb_build_object('workspace_id', v_ws, 'provider', 'stripe', 'plan_id', 'pro',
    'plan_name', 'Pro', 'status', 'active', 'billing_interval', 'month', 'monthly_cents', 9900,
    'amount_source', 'stripe', 'provider_switch', false);
  v_row2 := jsonb_build_object('workspace_id', v_ws2, 'provider', 'pagarme', 'plan_id', 'max',
    'plan_name', 'Max', 'status', 'trialing', 'billing_interval', 'year', 'monthly_cents', 19900,
    'amount_source', 'pagarme', 'provider_switch', true);

  -- 1. cron writes the day and its completion marker
  v_res := admin_metrics_write_snapshot('2026-09-24', 'cron', jsonb_build_array(v_row1, v_row2));
  assert (v_res->>'written')::int = 2, format('written: %s', v_res);
  assert not (v_res->>'skipped')::boolean, 'cron write must not skip';
  assert (select row_count from metrics_snapshot_runs where snapshot_date = '2026-09-24') = 2;
  assert (select source from metrics_snapshot_runs where snapshot_date = '2026-09-24') = 'cron';
  assert (select provider_switch from workspace_subscription_snapshots
          where workspace_id = v_ws2 and snapshot_date = '2026-09-24'), 'provider_switch stored';

  -- 2. a rerun replaces the whole day (a workspace that lost its subscription disappears)
  v_res := admin_metrics_write_snapshot('2026-09-24', 'cron', jsonb_build_array(v_row1));
  select count(*) into v_n from workspace_subscription_snapshots where snapshot_date = '2026-09-24';
  assert v_n = 1, format('rerun must replace the day, found %s rows', v_n);
  assert (select row_count from metrics_snapshot_runs where snapshot_date = '2026-09-24') = 1;

  -- 3. backfill never overwrites a cron date
  v_res := admin_metrics_write_snapshot('2026-09-24', 'backfill', jsonb_build_array(v_row2));
  assert (v_res->>'skipped')::boolean, 'backfill over a cron date must skip';
  assert (v_res->>'written')::int = 0;
  select count(*) into v_n from workspace_subscription_snapshots
    where snapshot_date = '2026-09-24' and source = 'cron';
  assert v_n = 1, 'cron rows untouched';

  -- 4. backfill on a free date writes; a second backfill replaces it
  v_res := admin_metrics_write_snapshot('2026-08-31', 'backfill', jsonb_build_array(v_row1, v_row2));
  assert (v_res->>'written')::int = 2;
  v_res := admin_metrics_write_snapshot('2026-08-31', 'backfill', jsonb_build_array(v_row1));
  select count(*) into v_n from workspace_subscription_snapshots where snapshot_date = '2026-08-31';
  assert v_n = 1, 'second backfill replaces the date';
  assert (select source from metrics_snapshot_runs where snapshot_date = '2026-08-31') = 'backfill';

  -- 5. an empty day is a legitimate close: marker with zero rows
  v_res := admin_metrics_write_snapshot('2026-07-31', 'backfill', '[]'::jsonb);
  assert (select row_count from metrics_snapshot_runs where snapshot_date = '2026-07-31') = 0;

  -- 6. cron over a backfilled date takes it over
  v_res := admin_metrics_write_snapshot('2026-08-31', 'cron', jsonb_build_array(v_row2));
  assert (select source from metrics_snapshot_runs where snapshot_date = '2026-08-31') = 'cron';
  assert (select count(*) from workspace_subscription_snapshots
          where snapshot_date = '2026-08-31' and source = 'backfill') = 0;

  -- 7. invalid source is rejected
  v_raised := false;
  begin
    perform admin_metrics_write_snapshot('2026-07-01', 'manual', '[]'::jsonb);
  exception when sqlstate '22023' then v_raised := true;
  end;
  assert v_raised, 'invalid source must raise 22023';
end $$;

-- 8. only service_role may execute
do $$
begin
  assert not has_function_privilege('anon',
    'public.admin_metrics_write_snapshot(date, text, jsonb)', 'execute'), 'anon must not execute';
  assert not has_function_privilege('authenticated',
    'public.admin_metrics_write_snapshot(date, text, jsonb)', 'execute'), 'authenticated must not execute';
  assert has_function_privilege('service_role',
    'public.admin_metrics_write_snapshot(date, text, jsonb)', 'execute'), 'service_role must execute';
end $$;
rollback;
```

- [ ] **Step 3: Write the migration** — `supabase/migrations/20260925130001_metrics_snapshots.sql`:

```sql
-- Admin Métricas, sub-projeto B (spec docs/superpowers/specs/2026-09-25-admin-metricas-historico-design.md).
--
-- workspace_subscription_snapshots: one row per workspace per São Paulo day while it has a
-- subscription (any status). metrics_snapshot_runs: completion marker; readers only trust dates
-- that have one, so a run that died halfway never reads as churn.
--
-- Deploy metrics-snapshot-cron BEFORE applying this migration: the schedule at the bottom starts
-- firing at the next 02:44 UTC.

create table public.workspace_subscription_snapshots (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  snapshot_date date not null,
  provider text not null check (provider in ('stripe', 'pagarme')),
  plan_id text,
  plan_name text,
  status text not null,
  billing_interval text,
  monthly_cents integer not null default 0 check (monthly_cents >= 0),
  amount_source text not null
    check (amount_source in ('stripe', 'pagarme', 'catalog', 'backfill', 'unpriced')),
  provider_switch boolean not null default false,
  source text not null check (source in ('cron', 'backfill')),
  created_at timestamptz not null default now(),
  unique (workspace_id, snapshot_date)
);

create index workspace_subscription_snapshots_date_idx
  on public.workspace_subscription_snapshots (snapshot_date);

alter table public.workspace_subscription_snapshots enable row level security;
revoke all on table public.workspace_subscription_snapshots from anon, authenticated;

create table public.metrics_snapshot_runs (
  snapshot_date date primary key,
  source text not null check (source in ('cron', 'backfill')),
  row_count integer not null,
  completed_at timestamptz not null default now()
);

alter table public.metrics_snapshot_runs enable row level security;
revoke all on table public.metrics_snapshot_runs from anon, authenticated;

-- Writes one whole day atomically: rows + marker, or nothing.
--   cron:     replaces every row of the date (a rerun drops workspaces that lost their sub).
--   backfill: skips a date the cron already owns; otherwise replaces the date.
create or replace function public.admin_metrics_write_snapshot(
  p_date date,
  p_source text,
  p_rows jsonb
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_written integer;
begin
  if p_source is null or p_source not in ('cron', 'backfill') then
    raise exception 'invalid source %', p_source using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a json array' using errcode = '22023';
  end if;

  -- Serialize concurrent writers of the same day (cron tick vs a manual trigger).
  perform pg_advisory_xact_lock(hashtext('metrics_snapshot:' || p_date::text));

  if p_source = 'backfill' and exists (
    select 1 from metrics_snapshot_runs where snapshot_date = p_date and source = 'cron'
  ) then
    return jsonb_build_object('written', 0, 'skipped', true);
  end if;

  delete from workspace_subscription_snapshots where snapshot_date = p_date;

  insert into workspace_subscription_snapshots (
    workspace_id, snapshot_date, provider, plan_id, plan_name, status, billing_interval,
    monthly_cents, amount_source, provider_switch, source
  )
  select r.workspace_id, p_date, r.provider, r.plan_id, r.plan_name, r.status, r.billing_interval,
         coalesce(r.monthly_cents, 0), r.amount_source, coalesce(r.provider_switch, false), p_source
  from jsonb_to_recordset(p_rows) as r(
    workspace_id uuid, provider text, plan_id text, plan_name text, status text,
    billing_interval text, monthly_cents integer, amount_source text, provider_switch boolean
  );
  get diagnostics v_written = row_count;

  insert into metrics_snapshot_runs (snapshot_date, source, row_count, completed_at)
  values (p_date, p_source, v_written, now())
  on conflict (snapshot_date) do update
    set source = excluded.source, row_count = excluded.row_count, completed_at = excluded.completed_at;

  return jsonb_build_object('written', v_written, 'skipped', false);
end;
$$;

-- Hosted Supabase grants EXECUTE to anon/authenticated/service_role explicitly at creation, so
-- the roles must be named; the service_role grant keeps local/CI (no hosted default ACL) working.
revoke all on function public.admin_metrics_write_snapshot(date, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.admin_metrics_write_snapshot(date, text, jsonb)
  to service_role;

-- Daily close at 23:44 São Paulo (02:44 UTC). Minute 44 of hour 2 only has the three every-minute jobs in prod (cron.job, 2026-09-25; see
-- 20260925110001_stagger_cron_schedules.sql). Idempotent.
do $$ begin
  if exists (select 1 from cron.job where jobname = 'metrics-snapshot-cron') then
    perform cron.unschedule('metrics-snapshot-cron');
  end if;
end $$;

select cron.schedule(
  'metrics-snapshot-cron',
  '44 2 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
            || '/functions/v1/metrics-snapshot-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
```

- [ ] **Step 4: Run the psql suite if a local Supabase is available**

Run: `npx supabase status >/dev/null 2>&1 && npx supabase db reset --local && psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/metrics_snapshot_rpcs.sql`
Expected: exits 0 with no assertion errors. If no local Supabase is running (Docker/colima not up), skip; the `entitlement-tests` CI job runs this file (it globs `supabase/tests/*.sql`). Note this in the report.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260925130001_metrics_snapshots.sql supabase/tests/metrics_snapshot_rpcs.sql
git commit -m "feat(metrics): tabelas de snapshot, marcador de conclusão, RPC atômico e agendamento do cron

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `metrics-snapshot-cron` function + shared snapshot module

**Files:**
- Create: `supabase/functions/_shared/metrics-snapshot.ts`
- Create: `supabase/functions/metrics-snapshot-cron/handler.ts`
- Create: `supabase/functions/metrics-snapshot-cron/index.ts`
- Test: `supabase/functions/__tests__/metrics-snapshot-cron_test.ts`

**Interfaces:**
- Consumes: `saoPauloDate` (Task 1), `fetchInternalWorkspaceIdsOrThrow` (Task 1), RPC `admin_metrics_write_snapshot` (Task 2), `priceSubscriptionRows` from `platform-admin/pricing.ts`, `toMonthlyCents` from `_shared/billing-logic.ts`.
- Produces (in `_shared/metrics-snapshot.ts`):
  ```ts
  export type AmountSource = "stripe" | "pagarme" | "catalog" | "backfill" | "unpriced";
  export interface SnapshotRow {
    workspace_id: string; provider: "stripe" | "pagarme"; plan_id: string | null;
    plan_name: string | null; status: string; billing_interval: string | null;
    monthly_cents: number; amount_source: AmountSource; provider_switch: boolean;
  }
  export interface PricedSnapshotSource {
    workspace_id: string; provider: string | null; status: string | null; plan_id: string | null;
    plan_name: string | null; interval: string | null; amount_cents: number | null;
    amount_source: "stripe" | "pagarme" | "catalog" | null;
    switched_from_stripe_subscription_id: string | null;
  }
  export function toSnapshotRows(priced: PricedSnapshotSource[], internalIds: Set<string>): SnapshotRow[];
  export type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> };
  export function writeSnapshot(svc: RpcClient, date: string, source: "cron" | "backfill", rows: SnapshotRow[]): Promise<{ written: number; skipped: boolean }>;
  ```
- Produces (handler): `createMetricsSnapshotHandler(deps: MetricsSnapshotDeps): (req: Request) => Promise<Response>`.

- [ ] **Step 1: Write failing tests** — `supabase/functions/__tests__/metrics-snapshot-cron_test.ts`:

```ts
import { assertEquals } from "./assert.ts";
import {
  type PricedSnapshotSource,
  type SnapshotRow,
  toSnapshotRows,
  writeSnapshot,
} from "../_shared/metrics-snapshot.ts";
import { createMetricsSnapshotHandler } from "../metrics-snapshot-cron/handler.ts";

const base: PricedSnapshotSource = {
  workspace_id: "w1",
  provider: "stripe",
  status: "active",
  plan_id: "pro",
  plan_name: "Pro",
  interval: "month",
  amount_cents: 9900,
  amount_source: "stripe",
  switched_from_stripe_subscription_id: null,
};

Deno.test("toSnapshotRows normalizes to monthly, drops internal and status-less rows", () => {
  const rows = toSnapshotRows(
    [
      base,
      { ...base, workspace_id: "w2", provider: "pagarme", interval: "year", amount_cents: 120000, amount_source: "pagarme", switched_from_stripe_subscription_id: "sub_1", status: "trialing" },
      { ...base, workspace_id: "internal" },
      { ...base, workspace_id: "w3", status: null },
    ],
    new Set(["internal"]),
  );
  assertEquals(rows.map((r) => r.workspace_id), ["w1", "w2"]);
  assertEquals(rows[0].monthly_cents, 9900);
  assertEquals(rows[1].monthly_cents, 10000);
  assertEquals(rows[1].billing_interval, "year");
  assertEquals(rows[1].provider_switch, true);
});

Deno.test("toSnapshotRows maps an unpriced row to amount_source 'unpriced' with 0 cents", () => {
  const [row] = toSnapshotRows([{ ...base, amount_cents: null, amount_source: null }], new Set());
  assertEquals(row.amount_source, "unpriced");
  assertEquals(row.monthly_cents, 0);
});

Deno.test("writeSnapshot calls the RPC and throws on error", async () => {
  const calls: unknown[] = [];
  const ok = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push([fn, args]);
      return Promise.resolve({ data: { written: 1, skipped: false }, error: null });
    },
  };
  const res = await writeSnapshot(ok, "2026-09-24", "cron", []);
  assertEquals(res, { written: 1, skipped: false });
  assertEquals(calls, [["admin_metrics_write_snapshot", { p_date: "2026-09-24", p_source: "cron", p_rows: [] }]]);

  const bad = { rpc: () => Promise.resolve({ data: null, error: { message: "denied" } }) };
  let threw = false;
  try {
    await writeSnapshot(bad, "2026-09-24", "cron", []);
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

function makeDeps(over: Partial<Parameters<typeof createMetricsSnapshotHandler>[0]> = {}) {
  const written: Array<{ date: string; rows: SnapshotRow[] }> = [];
  const failures: string[] = [];
  const deps = {
    cronSecret: "s3cret",
    timingSafeEqual: (a: string, b: string) => a === b,
    now: () => new Date("2026-10-01T02:44:00Z"),
    loadPricedRows: () => Promise.resolve([base]),
    loadInternalIds: () => Promise.resolve(new Set<string>()),
    write: (date: string, rows: SnapshotRow[]) => {
      written.push({ date, rows });
      return Promise.resolve({ written: rows.length, skipped: false });
    },
    reportFailure: (m: string) => {
      failures.push(m);
      return Promise.resolve();
    },
    ...over,
  };
  return { deps, written, failures };
}

const req = (secret?: string) =>
  new Request("http://x/metrics-snapshot-cron", {
    method: "POST",
    headers: secret ? { "x-cron-secret": secret } : {},
  });

Deno.test("cron rejects a missing or wrong secret without doing any work", async () => {
  const { deps, written } = makeDeps();
  const handler = createMetricsSnapshotHandler(deps);
  assertEquals((await handler(req())).status, 401);
  assertEquals((await handler(req("nope"))).status, 401);
  assertEquals(written.length, 0);
});

Deno.test("cron writes the São Paulo date of its tick (02:44 UTC on the 1st = last day of the month)", async () => {
  const { deps, written } = makeDeps();
  const res = await createMetricsSnapshotHandler(deps)(req("s3cret"));
  assertEquals(res.status, 200);
  assertEquals(written[0].date, "2026-09-30");
  assertEquals(written[0].rows.length, 1);
  const body = await res.json();
  assertEquals(body, { success: true, snapshot_date: "2026-09-30", written: 1 });
});

Deno.test("cron aborts before writing when the internal-workspace lookup fails", async () => {
  const { deps, written, failures } = makeDeps({
    loadInternalIds: () => Promise.reject(new Error("internal workspace lookup failed: boom")),
  });
  const res = await createMetricsSnapshotHandler(deps)(req("s3cret"));
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "Internal server error" });
  assertEquals(written.length, 0);
  assertEquals(failures.length, 1);
});
```

- [ ] **Step 2: Run, expect FAIL** (modules missing)

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/metrics-snapshot-cron_test.ts`

- [ ] **Step 3: Implement `supabase/functions/_shared/metrics-snapshot.ts`**

```ts
// Shared shape of one admin-metrics snapshot row and the single writer through the
// admin_metrics_write_snapshot RPC (migration 20260925130001). Used by metrics-snapshot-cron
// (daily close) and platform-admin backfill-metrics (month-end rebuild).

import { toMonthlyCents } from "./billing-logic.ts";

export type AmountSource = "stripe" | "pagarme" | "catalog" | "backfill" | "unpriced";

export interface SnapshotRow {
  workspace_id: string;
  provider: "stripe" | "pagarme";
  plan_id: string | null;
  plan_name: string | null;
  status: string;
  billing_interval: string | null;
  monthly_cents: number;
  amount_source: AmountSource;
  provider_switch: boolean;
}

/** One workspace_subscriptions row after priceSubscriptionRows. */
export interface PricedSnapshotSource {
  workspace_id: string;
  provider: string | null;
  status: string | null;
  plan_id: string | null;
  plan_name: string | null;
  interval: string | null;
  amount_cents: number | null;
  amount_source: "stripe" | "pagarme" | "catalog" | null;
  switched_from_stripe_subscription_id: string | null;
}

export function toSnapshotRows(
  priced: PricedSnapshotSource[],
  internalIds: Set<string>,
): SnapshotRow[] {
  return priced
    .filter((r) => !!r.status && !internalIds.has(r.workspace_id))
    .map((r) => {
      const monthly = toMonthlyCents(r.interval, r.amount_cents);
      return {
        workspace_id: r.workspace_id,
        provider: r.provider === "pagarme" ? "pagarme" : "stripe",
        plan_id: r.plan_id,
        plan_name: r.plan_name,
        status: r.status as string,
        billing_interval: r.interval,
        monthly_cents: monthly ?? 0,
        amount_source: monthly == null ? "unpriced" : (r.amount_source ?? "unpriced"),
        provider_switch: !!r.switched_from_stripe_subscription_id,
      };
    });
}

export type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export async function writeSnapshot(
  svc: RpcClient,
  date: string,
  source: "cron" | "backfill",
  rows: SnapshotRow[],
): Promise<{ written: number; skipped: boolean }> {
  const { data, error } = await svc.rpc("admin_metrics_write_snapshot", {
    p_date: date,
    p_source: source,
    p_rows: rows,
  });
  if (error) throw new Error(`admin_metrics_write_snapshot failed: ${error.message}`);
  const d = (data ?? {}) as { written?: number; skipped?: boolean };
  return { written: d.written ?? 0, skipped: !!d.skipped };
}
```

- [ ] **Step 4: Implement `supabase/functions/metrics-snapshot-cron/handler.ts`**

```ts
import { saoPauloDate } from "../_shared/sao-paulo-date.ts";
import {
  type PricedSnapshotSource,
  type SnapshotRow,
  toSnapshotRows,
} from "../_shared/metrics-snapshot.ts";

export interface MetricsSnapshotDeps {
  cronSecret: string;
  timingSafeEqual: (a: string, b: string) => boolean;
  now: () => Date;
  loadPricedRows: () => Promise<PricedSnapshotSource[]>;
  /** Must throw on failure (fail closed): a snapshot with an internal workspace is permanent. */
  loadInternalIds: () => Promise<Set<string>>;
  write: (date: string, rows: SnapshotRow[]) => Promise<{ written: number; skipped: boolean }>;
  reportFailure: (message: string) => Promise<void>;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export function createMetricsSnapshotHandler(deps: MetricsSnapshotDeps) {
  return async (req: Request): Promise<Response> => {
    if (!deps.timingSafeEqual(req.headers.get("x-cron-secret") ?? "", deps.cronSecret)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: JSON_HEADERS });
    }
    try {
      const date = saoPauloDate(deps.now());
      const [priced, internalIds] = await Promise.all([deps.loadPricedRows(), deps.loadInternalIds()]);
      const rows = toSnapshotRows(priced, internalIds);
      const { written } = await deps.write(date, rows);
      return new Response(JSON.stringify({ success: true, snapshot_date: date, written }), {
        status: 200,
        headers: JSON_HEADERS,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown";
      console.error("metrics-snapshot-cron failed:", message);
      await deps.reportFailure(message);
      return new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: JSON_HEADERS,
      });
    }
  };
}
```

- [ ] **Step 5: Implement `supabase/functions/metrics-snapshot-cron/index.ts`**

```ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { reportCronFailure } from "../_shared/triage.ts";
import { chunk, fetchAllRows } from "../_shared/paginate.ts";
import { setStripeLoader } from "../_shared/stripe-loader.ts";
import { fetchInternalWorkspaceIdsOrThrow } from "../_shared/internal-workspaces.ts";
import { type PricedSnapshotSource, writeSnapshot } from "../_shared/metrics-snapshot.ts";
import { type PlanMeta, priceSubscriptionRows } from "../platform-admin/pricing.ts";
import { createMetricsSnapshotHandler } from "./handler.ts";

// Same loader registration as platform-admin/index.ts, so unpriced rows get the same live
// Stripe fetch get-mrr does and the day's snapshot matches the MRR tile.
setStripeLoader(() => import("../_shared/stripe.ts").then((m) => m.stripe));

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ??
  (() => {
    throw new Error("CRON_SECRET is required");
  })();

const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface SubRow {
  workspace_id: string;
  provider: string | null;
  status: string | null;
  plan_id: string | null;
  billing_interval: string | null;
  stripe_subscription_id: string | null;
  amount_cents: number | null;
  currency: string | null;
  amount_interval: string | null;
  discount_label: string | null;
  switched_from_stripe_subscription_id: string | null;
}

async function loadPricedRows(): Promise<PricedSnapshotSource[]> {
  // workspace_subscriptions' primary key is workspace_id alone, so it is the total order.
  const rows = await fetchAllRows<SubRow>((from, to) =>
    svc
      .from("workspace_subscriptions")
      .select(
        "workspace_id, provider, status, plan_id, billing_interval, stripe_subscription_id, amount_cents, currency, amount_interval, discount_label, switched_from_stripe_subscription_id",
      )
      .not("status", "is", null)
      .order("workspace_id", { ascending: true })
      .range(from, to),
  );
  const planIds = [...new Set(rows.map((r) => r.plan_id).filter(Boolean))] as string[];
  const planById = new Map<string, PlanMeta>();
  for (const ids of chunk(planIds)) {
    const { data, error } = await svc
      .from("plans")
      .select("id, name, price_brl, price_brl_annual")
      .in("id", ids);
    if (error) throw error;
    for (const p of data ?? []) {
      planById.set(p.id, { name: p.name, price_brl: p.price_brl ?? null, price_brl_annual: p.price_brl_annual ?? null });
    }
  }
  const priced = await priceSubscriptionRows(svc, rows, new Map(), planById);
  return priced.map((r) => ({
    workspace_id: r.workspace_id,
    provider: r.provider,
    status: r.status ?? null,
    plan_id: r.plan_id,
    plan_name: r.plan_name,
    interval: r.interval,
    amount_cents: r.amount_cents,
    amount_source: r.amount_source,
    switched_from_stripe_subscription_id: r.switched_from_stripe_subscription_id,
  }));
}

Deno.serve(
  createMetricsSnapshotHandler({
    cronSecret: CRON_SECRET,
    timingSafeEqual,
    now: () => new Date(),
    loadPricedRows,
    loadInternalIds: () => fetchInternalWorkspaceIdsOrThrow(svc),
    write: (date, rows) => writeSnapshot(svc, date, "cron", rows),
    reportFailure: (message) => reportCronFailure(svc, "metrics-snapshot-cron", { stack: message }),
  }),
);
```

- [ ] **Step 6: Run the tests, expect PASS**; then `npm run check:functions` (expect no errors for the new files); `git checkout deno.lock`.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/metrics-snapshot.ts supabase/functions/metrics-snapshot-cron supabase/functions/__tests__/metrics-snapshot-cron_test.ts
git commit -m "feat(metrics): cron metrics-snapshot-cron grava o fechamento diário com o preço do get-mrr

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `get-mrr` / `get-trials` exclude internal workspaces

**Files:**
- Modify: `supabase/functions/platform-admin/mrr.ts` (`handleGetMrr`, `handleGetTrials`)
- Test: `supabase/functions/__tests__/platform-admin-mrr_test.ts` (append)

**Interfaces:**
- Consumes: `fetchInternalWorkspaceIds` (existing, fail-open) from `_shared/internal-workspaces.ts`.
- Produces: `handleGetMrr(svc, headers, fetchOwnerContactsFn?, fetchInternalIdsFn?)` and `handleGetTrials(svc, headers, fetchOwnerContactsFn?, fetchInternalIdsFn?)` with `fetchInternalIdsFn: (svc: SupabaseClient) => Promise<Set<string>>` defaulting to `fetchInternalWorkspaceIds`.

- [ ] **Step 1: Write failing tests** (append to `platform-admin-mrr_test.ts`, reusing its `makeFakeSvc`, `HEADERS`, `fakeFetchOwnerContacts`):

```ts
Deno.test("handleGetMrr excludes internal workspaces from the total and the list", async () => {
  const sub = (id: string) => ({
    workspace_id: id, provider: "stripe", status: "active", plan_id: "pro", billing_interval: "month",
    stripe_subscription_id: null, amount_cents: 9900, currency: "brl", amount_interval: "month", discount_label: null,
  });
  const svc = makeFakeSvc({
    subscriptions: [sub("ws-1"), sub("ws-int")],
    workspaces: [{ id: "ws-1", name: "Alpha" }, { id: "ws-int", name: "Interno" }],
    plans: [{ id: "pro", name: "Pro", price_brl: 9900, price_brl_annual: null }],
  });
  const res = await handleGetMrr(svc, HEADERS, fakeFetchOwnerContacts, () => Promise.resolve(new Set(["ws-int"])));
  const body = await res.json();
  assertEquals(body.mrr_cents, 9900);
  assertEquals(body.paying_count, 1);
  assertEquals(body.workspaces.map((w: { workspace_id: string }) => w.workspace_id), ["ws-1"]);
});

Deno.test("handleGetTrials excludes internal workspaces", async () => {
  const trial = (id: string) => ({
    workspace_id: id, provider: "stripe", plan_id: "pro", billing_interval: "month", stripe_subscription_id: null,
    current_period_end: "2026-10-01T00:00:00Z", amount_cents: 9900, currency: "brl", amount_interval: "month", discount_label: null,
  });
  const svc = makeFakeSvc({
    subscriptions: [trial("ws-1"), trial("ws-int")],
    workspaces: [{ id: "ws-1", name: "Alpha" }, { id: "ws-int", name: "Interno" }],
    plans: [{ id: "pro", name: "Pro", price_brl: 9900, price_brl_annual: null }],
  });
  const res = await handleGetTrials(svc, HEADERS, fakeFetchOwnerContacts, () => Promise.resolve(new Set(["ws-int"])));
  const body = await res.json();
  assertEquals(body.trial_count, 1);
  assertEquals(body.trials[0].workspace_id, "ws-1");
});
```

- [ ] **Step 2: Run, expect FAIL** (internal row still counted)

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/platform-admin-mrr_test.ts`

- [ ] **Step 3: Implement.** In `mrr.ts`:
  - add `import { fetchInternalWorkspaceIds } from "../_shared/internal-workspaces.ts";`
  - add the 4th parameter to both handlers: `fetchInternalIdsFn: (svc: SupabaseClient) => Promise<Set<string>> = fetchInternalWorkspaceIds,`
  - in both handlers, change `const rows = await fetchAllRows<...>(...)` to `const allRows = await fetchAllRows<...>(...)` and immediately add:

```ts
  // Internal (seeded/demo) workspaces never count as revenue; the metrics snapshots exclude them
  // too, so the tile and the history chart agree. Fails open (display only, nothing persisted).
  const internalIds = await fetchInternalIdsFn(svc);
  const rows = allRows.filter((s) => !internalIds.has(s.workspace_id));
```

Existing tests keep passing: their fake `workspaces.select()` has no `.eq`, so the default lookup throws inside `fetchInternalWorkspaceIds`, which catches and returns an empty set.

- [ ] **Step 4: Run, expect PASS**; `git checkout deno.lock`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/platform-admin/mrr.ts supabase/functions/__tests__/platform-admin-mrr_test.ts
git commit -m "feat(platform-admin): get-mrr e get-trials excluem workspaces internos

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Pure metrics logic (closes, classification, month aggregation)

**Files:**
- Create: `supabase/functions/platform-admin/metrics-logic.ts`
- Test: `supabase/functions/__tests__/platform-admin-metrics-logic_test.ts`

**Interfaces:**
- Consumes: `monthRange` (Task 1).
- Produces:
  ```ts
  export interface SnapshotRecord { workspace_id: string; snapshot_date: string; provider: "stripe" | "pagarme"; plan_id: string | null; plan_name: string | null; status: string; monthly_cents: number; provider_switch: boolean; }
  export interface RunRecord { snapshot_date: string; source: "cron" | "backfill"; }
  export interface MonthClose { month: string; close_date: string | null; source: "cron" | "backfill" | null; closed: boolean; }
  export type WorkspaceClass = "paying" | "past_due" | "out";
  export interface Movements { new: number; expansion: number; contraction: number; past_due: number; recovered: number; churn: number; switch: number; }
  export interface ChurnBlock { logos: number; lost_cents: number; base_logos: number; base_cents: number; logo_pct: number | null; revenue_pct: number | null; }
  export interface MetricsMonth { month: string; missing: boolean; close_date: string | null; closed: boolean; source: "cron" | "backfill" | null; mrr_cents: number | null; arr_cents: number | null; paying_count: number | null; by_provider: { stripe: number; pagarme: number } | null; by_plan: { plan_id: string | null; name: string; mrr_cents: number }[] | null; movements_since: string | null; movements: Movements | null; churn: ChurnBlock | null; }
  export function classOf(r: SnapshotRecord | undefined): WorkspaceClass;
  export function computeCloses(runs: RunRecord[], currentMonth: string): MonthClose[];
  export function diffCloses(prevRows: SnapshotRecord[], curRows: SnapshotRecord[]): { movements: Movements; churn: ChurnBlock };
  export function buildMonths(closes: MonthClose[], rowsByDate: Map<string, SnapshotRecord[]>): MetricsMonth[];
  ```
  `logo_pct` / `revenue_pct` are fractions (0.05 = 5%).

- [ ] **Step 1: Write failing tests** — `supabase/functions/__tests__/platform-admin-metrics-logic_test.ts`:

```ts
import { assertEquals } from "./assert.ts";
import {
  buildMonths,
  classOf,
  computeCloses,
  diffCloses,
  type SnapshotRecord,
} from "../platform-admin/metrics-logic.ts";

const row = (over: Partial<SnapshotRecord>): SnapshotRecord => ({
  workspace_id: "w",
  snapshot_date: "2026-08-31",
  provider: "stripe",
  plan_id: "pro",
  plan_name: "Pro",
  status: "active",
  monthly_cents: 10000,
  provider_switch: false,
  ...over,
});

const sum = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);
const mrr = (rows: SnapshotRecord[]) =>
  rows.filter((r) => classOf(r) === "paying").reduce((a, r) => a + r.monthly_cents, 0);

Deno.test("classOf: paying needs active AND a positive amount; switch-in-progress trial is paying", () => {
  assertEquals(classOf(undefined), "out");
  assertEquals(classOf(row({})), "paying");
  assertEquals(classOf(row({ monthly_cents: 0 })), "out");
  assertEquals(classOf(row({ status: "past_due" })), "past_due");
  assertEquals(classOf(row({ status: "trialing" })), "out");
  assertEquals(classOf(row({ status: "canceled" })), "out");
  assertEquals(classOf(row({ provider: "pagarme", status: "trialing", provider_switch: true })), "paying");
  assertEquals(classOf(row({ provider: "pagarme", status: "trialing", provider_switch: true, monthly_cents: 0 })), "out");
});

Deno.test("diffCloses covers all nine class transitions and reconciles with the MRR delta", () => {
  // "none->pay" exists only in cur; "pay->gone" and "pd->gone" exist only in prev.
  const prev = [
    row({ workspace_id: "trial->pay", status: "trialing" }),
    row({ workspace_id: "canceled->pay", status: "canceled" }),
    row({ workspace_id: "expand", monthly_cents: 10000 }),
    row({ workspace_id: "contract", monthly_cents: 10000 }),
    row({ workspace_id: "same", monthly_cents: 10000 }),
    row({ workspace_id: "switch", monthly_cents: 10000, provider: "stripe" }),
    row({ workspace_id: "pay->pd", monthly_cents: 7000 }),
    row({ workspace_id: "pay->gone", monthly_cents: 5000 }),
    row({ workspace_id: "pay->canceled", monthly_cents: 4000 }),
    row({ workspace_id: "pd->pay", status: "past_due", monthly_cents: 3000 }),
    row({ workspace_id: "pd->gone", status: "past_due", monthly_cents: 2000 }),
    row({ workspace_id: "pd->pd", status: "past_due", monthly_cents: 1500 }),
    row({ workspace_id: "out->pd", status: "trialing" }),
  ];
  const cur = [
    row({ workspace_id: "none->pay", monthly_cents: 6000 }),
    row({ workspace_id: "trial->pay", monthly_cents: 10000 }),
    row({ workspace_id: "canceled->pay", monthly_cents: 8000 }),
    row({ workspace_id: "expand", monthly_cents: 12000 }),
    row({ workspace_id: "contract", monthly_cents: 9000 }),
    row({ workspace_id: "same", monthly_cents: 10000 }),
    row({ workspace_id: "switch", monthly_cents: 11000, provider: "pagarme" }),
    row({ workspace_id: "pay->pd", status: "past_due", monthly_cents: 7000 }),
    row({ workspace_id: "pay->canceled", status: "canceled", monthly_cents: 4000 }),
    row({ workspace_id: "pd->pay", monthly_cents: 3000 }),
    row({ workspace_id: "pd->pd", status: "past_due", monthly_cents: 1500 }),
    row({ workspace_id: "out->pd", status: "past_due", monthly_cents: 9999 }),
  ];
  const { movements, churn } = diffCloses(prev, cur);
  assertEquals(movements, {
    new: 6000 + 10000 + 8000,
    expansion: 2000,
    contraction: -1000,
    past_due: -7000,
    recovered: 3000,
    churn: -(5000 + 4000),
    switch: 1000,
  });
  assertEquals(sum(movements as unknown as Record<string, number>), mrr(cur) - mrr(prev));
  // churn block: pay->gone, pay->canceled, pd->gone. Base = paying + past_due at prev close.
  assertEquals(churn.logos, 3);
  assertEquals(churn.lost_cents, 5000 + 4000 + 2000);
  assertEquals(churn.base_logos, 10); // expand, contract, same, switch, pay->pd, pay->gone, pay->canceled, pd->pay, pd->gone, pd->pd
  assertEquals(churn.base_cents, 10000 * 4 + 7000 + 5000 + 4000 + 3000 + 2000 + 1500);
  assertEquals(churn.logo_pct, 3 / 10);
  assertEquals(churn.revenue_pct, (11000 + 1000) / (10000 * 4 + 7000 + 5000 + 4000 + 3000 + 2000 + 1500));
});

Deno.test("diffCloses: a switch with provider_switch=false (marker already cleared) is still a switch", () => {
  const { movements } = diffCloses(
    [row({ workspace_id: "w", provider: "stripe", monthly_cents: 10000 })],
    [row({ workspace_id: "w", provider: "pagarme", monthly_cents: 10000, provider_switch: false })],
  );
  assertEquals(movements.switch, 0);
  assertEquals(movements.churn, 0);
  assertEquals(movements.new, 0);
});

Deno.test("diffCloses: zero denominators give null percentages", () => {
  const { churn } = diffCloses([], [row({})]);
  assertEquals(churn.logo_pct, null);
  assertEquals(churn.revenue_pct, null);
});

Deno.test("computeCloses: calendar series from first marker month, latest marker per month, gaps missing", () => {
  const closes = computeCloses(
    [
      { snapshot_date: "2026-06-30", source: "backfill" },
      { snapshot_date: "2026-08-29", source: "cron" },
      { snapshot_date: "2026-08-30", source: "cron" },
      { snapshot_date: "2026-09-24", source: "cron" },
    ],
    "2026-09",
  );
  assertEquals(closes, [
    { month: "2026-06", close_date: "2026-06-30", source: "backfill", closed: true },
    { month: "2026-07", close_date: null, source: null, closed: true },
    { month: "2026-08", close_date: "2026-08-30", source: "cron", closed: true },
    { month: "2026-09", close_date: "2026-09-24", source: "cron", closed: false },
  ]);
  assertEquals(computeCloses([], "2026-09"), []);
});

Deno.test("buildMonths: first month has no movements; a missing month is skipped for the comparison", () => {
  const months = buildMonths(
    [
      { month: "2026-06", close_date: "2026-06-30", source: "backfill", closed: true },
      { month: "2026-07", close_date: null, source: null, closed: true },
      { month: "2026-08", close_date: "2026-08-31", source: "backfill", closed: true },
    ],
    new Map([
      ["2026-06-30", [row({ workspace_id: "a", snapshot_date: "2026-06-30", monthly_cents: 10000 })]],
      ["2026-08-31", [
        row({ workspace_id: "a", snapshot_date: "2026-08-31", monthly_cents: 10000 }),
        row({ workspace_id: "b", snapshot_date: "2026-08-31", provider: "pagarme", plan_id: "max", plan_name: "Max", monthly_cents: 20000 }),
      ]],
    ]),
  );
  assertEquals(months[0].movements, null);
  assertEquals(months[0].mrr_cents, 10000);
  assertEquals(months[0].arr_cents, 120000);
  assertEquals(months[1].missing, true);
  assertEquals(months[1].mrr_cents, null);
  assertEquals(months[1].movements, null);
  assertEquals(months[2].movements_since, "2026-06");
  assertEquals(months[2].movements?.new, 20000);
  assertEquals(months[2].by_provider, { stripe: 10000, pagarme: 20000 });
  assertEquals(months[2].by_plan, [
    { plan_id: "max", name: "Max", mrr_cents: 20000 },
    { plan_id: "pro", name: "Pro", mrr_cents: 10000 },
  ]);
  assertEquals(months[2].paying_count, 2);
});

Deno.test("buildMonths: a close with a marker and zero rows is a real month with total churn", () => {
  const months = buildMonths(
    [
      { month: "2026-08", close_date: "2026-08-31", source: "cron", closed: true },
      { month: "2026-09", close_date: "2026-09-30", source: "cron", closed: true },
    ],
    new Map([["2026-08-31", [row({ workspace_id: "a", monthly_cents: 10000 })]], ["2026-09-30", []]]),
  );
  assertEquals(months[1].missing, false);
  assertEquals(months[1].mrr_cents, 0);
  assertEquals(months[1].movements?.churn, -10000);
  assertEquals(months[1].churn?.logo_pct, 1);
});
```

- [ ] **Step 2: Run, expect FAIL** (module missing)

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/platform-admin-metrics-logic_test.ts`

- [ ] **Step 3: Implement `supabase/functions/platform-admin/metrics-logic.ts`**

```ts
// Pure logic behind get-metrics-history (spec 2026-09-25-admin-metricas-historico-design.md §4).
// No I/O: the handler hands in the completion markers and the rows of each month close.

import { monthRange } from "../_shared/sao-paulo-date.ts";

export interface SnapshotRecord {
  workspace_id: string;
  snapshot_date: string;
  provider: "stripe" | "pagarme";
  plan_id: string | null;
  plan_name: string | null;
  status: string;
  monthly_cents: number;
  provider_switch: boolean;
}

export interface RunRecord {
  snapshot_date: string;
  source: "cron" | "backfill";
}

export interface MonthClose {
  month: string;
  close_date: string | null;
  source: "cron" | "backfill" | null;
  closed: boolean;
}

export type WorkspaceClass = "paying" | "past_due" | "out";

export interface Movements {
  new: number;
  expansion: number;
  contraction: number;
  past_due: number;
  recovered: number;
  churn: number;
  switch: number;
}

export interface ChurnBlock {
  logos: number;
  lost_cents: number;
  base_logos: number;
  base_cents: number;
  logo_pct: number | null;
  revenue_pct: number | null;
}

export interface MetricsMonth {
  month: string;
  missing: boolean;
  close_date: string | null;
  closed: boolean;
  source: "cron" | "backfill" | null;
  mrr_cents: number | null;
  arr_cents: number | null;
  paying_count: number | null;
  by_provider: { stripe: number; pagarme: number } | null;
  by_plan: { plan_id: string | null; name: string; mrr_cents: number }[] | null;
  movements_since: string | null;
  movements: Movements | null;
  churn: ChurnBlock | null;
}

/**
 * paying: active with a positive amount (aggregateMrr's eligibility), plus a Pagar.me trial that
 * is a Stripe switch in progress (the customer still pays Stripe until the period ends).
 */
export function classOf(r: SnapshotRecord | undefined): WorkspaceClass {
  if (!r) return "out";
  if (r.status === "active" && r.monthly_cents > 0) return "paying";
  if (r.status === "trialing" && r.provider === "pagarme" && r.provider_switch && r.monthly_cents > 0) {
    return "paying";
  }
  if (r.status === "past_due") return "past_due";
  return "out";
}

/** One close per calendar month from the first marker month to `currentMonth`. */
export function computeCloses(runs: RunRecord[], currentMonth: string): MonthClose[] {
  if (!runs.length) return [];
  const latestByMonth = new Map<string, RunRecord>();
  for (const r of runs) {
    const m = r.snapshot_date.slice(0, 7);
    const prev = latestByMonth.get(m);
    if (!prev || r.snapshot_date > prev.snapshot_date) latestByMonth.set(m, r);
  }
  const first = [...latestByMonth.keys()].sort()[0];
  return monthRange(first, currentMonth).map((month) => {
    const run = latestByMonth.get(month);
    return {
      month,
      close_date: run?.snapshot_date ?? null,
      source: run?.source ?? null,
      closed: month < currentMonth,
    };
  });
}

function byWorkspace(rows: SnapshotRecord[]): Map<string, SnapshotRecord> {
  return new Map(rows.map((r) => [r.workspace_id, r]));
}

export function diffCloses(
  prevRows: SnapshotRecord[],
  curRows: SnapshotRecord[],
): { movements: Movements; churn: ChurnBlock } {
  const prev = byWorkspace(prevRows);
  const cur = byWorkspace(curRows);
  const m: Movements = { new: 0, expansion: 0, contraction: 0, past_due: 0, recovered: 0, churn: 0, switch: 0 };
  let logos = 0;
  let lost = 0;
  let baseLogos = 0;
  let baseCents = 0;

  for (const id of new Set([...prev.keys(), ...cur.keys()])) {
    const p = prev.get(id);
    const c = cur.get(id);
    const pk = classOf(p);
    const ck = classOf(c);
    const pv = p?.monthly_cents ?? 0;
    const cv = c?.monthly_cents ?? 0;
    if (pk !== "out") {
      baseLogos++;
      baseCents += pv;
    }
    if (pk === "out" && ck === "paying") m.new += cv;
    else if (pk === "paying" && ck === "paying") {
      const delta = cv - pv;
      if (p!.provider !== c!.provider) m.switch += delta;
      else if (delta > 0) m.expansion += delta;
      else m.contraction += delta;
    } else if (pk === "paying" && ck === "past_due") m.past_due -= pv;
    else if (pk === "paying" && ck === "out") {
      m.churn -= pv;
      logos++;
      lost += pv;
    } else if (pk === "past_due" && ck === "paying") m.recovered += cv;
    else if (pk === "past_due" && ck === "out") {
      // Already left MRR as past_due; counts only in the churn block, at its last amount.
      logos++;
      lost += pv;
    }
    // past_due -> past_due, out -> past_due, out -> out: R$ 0.
  }

  return {
    movements: m,
    churn: {
      logos,
      lost_cents: lost,
      base_logos: baseLogos,
      base_cents: baseCents,
      logo_pct: baseLogos > 0 ? logos / baseLogos : null,
      revenue_pct: baseCents > 0 ? (lost + Math.abs(m.contraction)) / baseCents : null,
    },
  };
}

function aggregate(rows: SnapshotRecord[]) {
  let mrr = 0;
  let paying = 0;
  const byProvider = { stripe: 0, pagarme: 0 };
  const byPlan = new Map<string, { plan_id: string | null; name: string; mrr_cents: number }>();
  for (const r of rows) {
    if (classOf(r) !== "paying") continue;
    mrr += r.monthly_cents;
    paying++;
    byProvider[r.provider] += r.monthly_cents;
    const key = r.plan_id ?? "";
    const entry = byPlan.get(key) ?? { plan_id: r.plan_id, name: r.plan_name ?? r.plan_id ?? "Sem plano", mrr_cents: 0 };
    entry.mrr_cents += r.monthly_cents;
    byPlan.set(key, entry);
  }
  return {
    mrr,
    paying,
    byProvider,
    byPlan: [...byPlan.values()].sort((a, b) => b.mrr_cents - a.mrr_cents),
  };
}

export function buildMonths(
  closes: MonthClose[],
  rowsByDate: Map<string, SnapshotRecord[]>,
): MetricsMonth[] {
  const out: MetricsMonth[] = [];
  let prev: { month: string; rows: SnapshotRecord[] } | null = null;
  for (const c of closes) {
    if (!c.close_date) {
      out.push({
        month: c.month, missing: true, close_date: null, closed: c.closed, source: null,
        mrr_cents: null, arr_cents: null, paying_count: null, by_provider: null, by_plan: null,
        movements_since: null, movements: null, churn: null,
      });
      continue;
    }
    const rows = rowsByDate.get(c.close_date) ?? [];
    const agg = aggregate(rows);
    const diff = prev ? diffCloses(prev.rows, rows) : null;
    out.push({
      month: c.month,
      missing: false,
      close_date: c.close_date,
      closed: c.closed,
      source: c.source,
      mrr_cents: agg.mrr,
      arr_cents: agg.mrr * 12,
      paying_count: agg.paying,
      by_provider: agg.byProvider,
      by_plan: agg.byPlan,
      movements_since: prev?.month ?? null,
      movements: diff?.movements ?? null,
      churn: diff?.churn ?? null,
    });
    prev = { month: c.month, rows };
  }
  return out;
}
```

- [ ] **Step 4: Run, expect PASS**; `git checkout deno.lock`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/platform-admin/metrics-logic.ts supabase/functions/__tests__/platform-admin-metrics-logic_test.ts
git commit -m "feat(platform-admin): lógica pura de fechamentos, classificação das transições e churn

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `get-metrics-history` handler + route

**Files:**
- Create: `supabase/functions/platform-admin/metrics-history.ts`
- Modify: `supabase/functions/platform-admin/index.ts` (imports + `case "get-metrics-history"` next to `case "get-deposits"`)
- Test: `supabase/functions/__tests__/platform-admin-metrics-history_test.ts`

**Interfaces:**
- Consumes: `computeCloses`, `buildMonths`, `SnapshotRecord`, `RunRecord` (Task 5); `saoPauloDate` (Task 1); `fetchAllRows`, `chunk` (`_shared/paginate.ts`).
- Produces: `handleGetMetricsHistory(svc: SupabaseClient, headers: Record<string, string>, now?: Date): Promise<Response>` → body `{ generated_at: string; first_month: string | null; months: MetricsMonth[] }`.

- [ ] **Step 1: Write failing test** — `supabase/functions/__tests__/platform-admin-metrics-history_test.ts`:

```ts
import { assertEquals } from "./assert.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { handleGetMetricsHistory } from "../platform-admin/metrics-history.ts";

function fakeSvc(runs: unknown[], snapshots: Array<Record<string, unknown>>) {
  const requestedDates: string[][] = [];
  const db = {
    from(table: string) {
      if (table === "metrics_snapshot_runs") {
        return {
          select: () => ({
            order: () => ({ range: (f: number, t: number) => Promise.resolve({ data: runs.slice(f, t + 1), error: null }) }),
          }),
        };
      }
      if (table === "workspace_subscription_snapshots") {
        return {
          select: () => ({
            in: (_col: string, dates: string[]) => {
              requestedDates.push(dates);
              const data = snapshots.filter((s) => dates.includes(s.snapshot_date as string));
              const orderStep = {
                order: () => orderStep,
                range: (f: number, t: number) => Promise.resolve({ data: data.slice(f, t + 1), error: null }),
              };
              return orderStep;
            },
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { svc: db as unknown as SupabaseClient, requestedDates };
}

Deno.test("get-metrics-history reads only close dates and returns the calendar series", async () => {
  const snap = (ws: string, date: string, cents: number) => ({
    workspace_id: ws, snapshot_date: date, provider: "stripe", plan_id: "pro", plan_name: "Pro",
    status: "active", monthly_cents: cents, provider_switch: false,
  });
  const { svc, requestedDates } = fakeSvc(
    [
      { snapshot_date: "2026-08-31", source: "backfill" },
      { snapshot_date: "2026-09-23", source: "cron" },
      { snapshot_date: "2026-09-24", source: "cron" },
    ],
    [snap("a", "2026-08-31", 10000), snap("a", "2026-09-23", 10000), snap("a", "2026-09-24", 12000)],
  );
  const res = await handleGetMetricsHistory(svc, { "Content-Type": "application/json" }, new Date("2026-09-25T12:00:00Z"));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(requestedDates, [["2026-08-31", "2026-09-24"]]);
  assertEquals(body.first_month, "2026-08");
  assertEquals(body.months.map((m: { month: string }) => m.month), ["2026-08", "2026-09"]);
  assertEquals(body.months[1].closed, false);
  assertEquals(body.months[1].movements.expansion, 2000);
});

Deno.test("get-metrics-history with no markers returns an empty series", async () => {
  const { svc } = fakeSvc([], []);
  const body = await (await handleGetMetricsHistory(svc, {}, new Date("2026-09-25T12:00:00Z"))).json();
  assertEquals(body.first_month, null);
  assertEquals(body.months, []);
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement `supabase/functions/platform-admin/metrics-history.ts`**

```ts
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { chunk, fetchAllRows } from "../_shared/paginate.ts";
import { saoPauloDate } from "../_shared/sao-paulo-date.ts";
import { buildMonths, computeCloses, type RunRecord, type SnapshotRecord } from "./metrics-logic.ts";

/** get-metrics-history: month closes from the completion markers, classified in metrics-logic. */
export async function handleGetMetricsHistory(
  svc: SupabaseClient,
  headers: Record<string, string>,
  now: Date = new Date(),
): Promise<Response> {
  const runs = await fetchAllRows<RunRecord>((from, to) =>
    svc
      .from("metrics_snapshot_runs")
      .select("snapshot_date, source")
      .order("snapshot_date", { ascending: true })
      .range(from, to),
  );
  const closes = computeCloses(runs, saoPauloDate(now).slice(0, 7));
  const dates = closes.map((c) => c.close_date).filter((d): d is string => !!d);

  const rowsByDate = new Map<string, SnapshotRecord[]>();
  for (const ids of chunk(dates)) {
    // (snapshot_date, workspace_id) is unique, so it is a total order for .range() paging.
    const rows = await fetchAllRows<SnapshotRecord>((from, to) =>
      svc
        .from("workspace_subscription_snapshots")
        .select("workspace_id, snapshot_date, provider, plan_id, plan_name, status, monthly_cents, provider_switch")
        .in("snapshot_date", ids)
        .order("snapshot_date", { ascending: true })
        .order("workspace_id", { ascending: true })
        .range(from, to),
    );
    for (const r of rows) {
      const list = rowsByDate.get(r.snapshot_date) ?? [];
      list.push(r);
      rowsByDate.set(r.snapshot_date, list);
    }
  }

  const body = {
    generated_at: now.toISOString(),
    first_month: closes[0]?.month ?? null,
    months: buildMonths(closes, rowsByDate),
  };
  return new Response(JSON.stringify(body), { status: 200, headers });
}
```

- [ ] **Step 4: Route it in `index.ts`**: add `import { handleGetMetricsHistory } from "./metrics-history.ts";` next to the deposits import, and under `case "get-deposits":` block add:

```ts
      case "get-metrics-history":
        return await handleGetMetricsHistory(svc, headers);
```

- [ ] **Step 5: Run the test, expect PASS**; run `npm run check:functions`; `git checkout deno.lock`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/platform-admin/metrics-history.ts supabase/functions/platform-admin/index.ts supabase/functions/__tests__/platform-admin-metrics-history_test.ts
git commit -m "feat(platform-admin): ação get-metrics-history

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Pure backfill logic

**Files:**
- Create: `supabase/functions/platform-admin/metrics-backfill-logic.ts`
- Test: `supabase/functions/__tests__/platform-admin-metrics-backfill-logic_test.ts`

**Interfaces:**
- Consumes: `closeInstant`, `lastDayOfMonth`, `monthRange`, `previousMonth`, `saoPauloDate` (Task 1); `SnapshotRow` (Task 3); `toMonthlyCents`, `resolvePlanFromPriceId`, `PlanPriceRow` (`_shared/billing-logic.ts`).
- Produces:
  ```ts
  export interface StripeSubLite { id: string; customer: string; status: string; start_date: number | null; trial_start: number | null; trial_end: number | null; ended_at: number | null; price_id: string | null; amount_cents: number | null; interval: string | null; }
  export interface PagarmeSubLite { id: string; status: string; created_at: string | null; start_at: string | null; canceled_at: string | null; interval: string | null; price_cents: number | null; metadata_workspace_id: string | null; metadata_plan_id: string | null; }
  export interface BackfillPlanRow extends PlanPriceRow { name: string; price_brl_annual: number | null; }
  export interface BackfillLocal { customerToWorkspace: Map<string, string>; pagarmeSubToWorkspace: Map<string, string>; workspaceIds: Set<string>; plans: BackfillPlanRow[]; }
  export interface BackfillSkipped { stripe_unmapped: number; pagarme_unmapped: number; pagarme_divergent: number; }
  export interface BackfillPlan { dates: { date: string; rows: SnapshotRow[] }[]; skipped: BackfillSkipped; }
  export function stripeStatusAt(s: StripeSubLite, t: Date): "active" | "trialing" | null;
  export function pagarmeStatusAt(s: PagarmeSubLite, t: Date): "active" | "trialing" | null;
  export function mapPagarmeWorkspace(s: PagarmeSubLite, local: BackfillLocal): { workspace_id: string } | { skip: "unmapped" | "divergent" };
  export function buildBackfill(input: { stripe: StripeSubLite[]; pagarme: PagarmeSubLite[]; local: BackfillLocal; internalIds: Set<string>; todaySP: string }): BackfillPlan;
  ```

- [ ] **Step 1: Write failing tests** — `supabase/functions/__tests__/platform-admin-metrics-backfill-logic_test.ts`:

```ts
import { assertEquals } from "./assert.ts";
import {
  type BackfillLocal,
  buildBackfill,
  mapPagarmeWorkspace,
  type PagarmeSubLite,
  pagarmeStatusAt,
  type StripeSubLite,
  stripeStatusAt,
} from "../platform-admin/metrics-backfill-logic.ts";

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const T_JUN = new Date("2026-07-01T02:44:00Z"); // close of 2026-06-30

const stripeSub = (over: Partial<StripeSubLite> = {}): StripeSubLite => ({
  id: "sub_1", customer: "cus_1", status: "active",
  start_date: sec("2026-06-12T10:00:00Z"), trial_start: null, trial_end: null, ended_at: null,
  price_id: "price_pro_m", amount_cents: 9900, interval: "month", ...over,
});

const pagarmeSub = (over: Partial<PagarmeSubLite> = {}): PagarmeSubLite => ({
  id: "sub_pg1", status: "active", created_at: "2026-08-10T12:00:00Z", start_at: "2026-08-10T12:00:00Z",
  canceled_at: null, interval: "year", price_cents: 120000, metadata_workspace_id: "w2", metadata_plan_id: "max", ...over,
});

const local = (over: Partial<BackfillLocal> = {}): BackfillLocal => ({
  customerToWorkspace: new Map([["cus_1", "w1"]]),
  pagarmeSubToWorkspace: new Map([["sub_pg1", "w2"]]),
  workspaceIds: new Set(["w1", "w2", "w3"]),
  plans: [
    { id: "pro", name: "Pro", stripe_price_id: "price_pro_m", stripe_price_id_annual: "price_pro_y", price_brl_annual: 99000 },
    { id: "max", name: "Max", stripe_price_id: null, stripe_price_id_annual: null, price_brl_annual: 120000 },
  ],
  ...over,
});

Deno.test("stripeStatusAt compares timestamps with the 23:44 close instant", () => {
  // starts at noon on the last day of June: in force at the June close
  assertEquals(stripeStatusAt(stripeSub({ start_date: sec("2026-06-30T15:00:00Z") }), T_JUN), "active");
  assertEquals(stripeStatusAt(stripeSub({ start_date: sec("2026-07-02T00:00:00Z") }), T_JUN), null);
  // trial ending before 23:44 of the last day already counts as active
  assertEquals(
    stripeStatusAt(stripeSub({ trial_start: sec("2026-06-15T00:00:00Z"), trial_end: sec("2026-06-30T20:00:00Z") }), T_JUN),
    "active",
  );
  assertEquals(
    stripeStatusAt(stripeSub({ trial_start: sec("2026-06-15T00:00:00Z"), trial_end: sec("2026-07-15T00:00:00Z") }), T_JUN),
    "trialing",
  );
  assertEquals(stripeStatusAt(stripeSub({ ended_at: sec("2026-06-20T00:00:00Z") }), T_JUN), null);
});

Deno.test("pagarmeStatusAt: future start is trialing, canceled is gone", () => {
  const t = new Date("2026-09-01T02:44:00Z");
  assertEquals(pagarmeStatusAt(pagarmeSub({ created_at: "2026-08-20T00:00:00Z", start_at: "2026-09-10T00:00:00Z" }), t), "trialing");
  assertEquals(pagarmeStatusAt(pagarmeSub(), t), "active");
  assertEquals(pagarmeStatusAt(pagarmeSub({ canceled_at: "2026-08-25T00:00:00Z" }), t), null);
  assertEquals(pagarmeStatusAt(pagarmeSub({ created_at: "2026-09-05T00:00:00Z", start_at: "2026-09-05T00:00:00Z" }), t), null);
});

Deno.test("mapPagarmeWorkspace: mirror id wins, metadata fallback, divergence and unmapped", () => {
  assertEquals(mapPagarmeWorkspace(pagarmeSub(), local()), { workspace_id: "w2" });
  assertEquals(mapPagarmeWorkspace(pagarmeSub({ metadata_workspace_id: null }), local()), { workspace_id: "w2" });
  assertEquals(mapPagarmeWorkspace(pagarmeSub({ metadata_workspace_id: "w3" }), local()), { skip: "divergent" });
  assertEquals(mapPagarmeWorkspace(pagarmeSub({ id: "old_sub", metadata_workspace_id: "w3" }), local()), { workspace_id: "w3" });
  assertEquals(mapPagarmeWorkspace(pagarmeSub({ id: "old_sub", metadata_workspace_id: "gone" }), local()), { skip: "unmapped" });
});

Deno.test("buildBackfill: month-end rows from first start through the last closed month", () => {
  const plan = buildBackfill({
    stripe: [stripeSub({ ended_at: sec("2026-08-15T00:00:00Z") })],
    pagarme: [],
    local: local(),
    internalIds: new Set(),
    todaySP: "2026-09-25",
  });
  assertEquals(plan.dates.map((d) => d.date), ["2026-06-30", "2026-07-31", "2026-08-31"]);
  assertEquals(plan.dates[0].rows, [{
    workspace_id: "w1", provider: "stripe", plan_id: "pro", plan_name: "Pro", status: "active",
    billing_interval: "month", monthly_cents: 9900, amount_source: "backfill", provider_switch: false,
  }]);
  assertEquals(plan.dates[2].rows, []); // ended in August: empty close, still written
});

Deno.test("buildBackfill: Stripe and Pagar.me both in force -> Pagar.me with provider_switch, in either input order", () => {
  const stripe = [stripeSub({ customer: "cus_1" })];
  const pg = [pagarmeSub({ metadata_workspace_id: "w1", id: "sub_pgx", created_at: "2026-08-20T00:00:00Z", start_at: "2026-09-10T00:00:00Z" })];
  const l = local({ pagarmeSubToWorkspace: new Map([["sub_pgx", "w1"]]) });
  for (const [s, p] of [[stripe, pg], [[...stripe].reverse(), [...pg].reverse()]] as const) {
    const plan = buildBackfill({ stripe: [...s], pagarme: [...p], local: l, internalIds: new Set(), todaySP: "2026-09-25" });
    const aug = plan.dates.find((d) => d.date === "2026-08-31")!;
    assertEquals(aug.rows.length, 1);
    assertEquals(aug.rows[0].provider, "pagarme");
    assertEquals(aug.rows[0].status, "trialing");
    assertEquals(aug.rows[0].provider_switch, true);
    assertEquals(aug.rows[0].monthly_cents, 10000);
  }
});

Deno.test("buildBackfill: skips incomplete Stripe subs, internal workspaces, and counts unmapped", () => {
  const plan = buildBackfill({
    stripe: [
      stripeSub({ status: "incomplete_expired" }),
      stripeSub({ id: "sub_x", customer: "cus_unknown" }),
      stripeSub({ id: "sub_int", customer: "cus_int" }),
    ],
    pagarme: [pagarmeSub({ id: "orphan", metadata_workspace_id: null }), pagarmeSub({ metadata_workspace_id: "w3" })],
    local: local({ customerToWorkspace: new Map([["cus_1", "w1"], ["cus_int", "w-int"]]) }),
    internalIds: new Set(["w-int"]),
    todaySP: "2026-09-25",
  });
  assertEquals(plan.skipped, { stripe_unmapped: 1, pagarme_unmapped: 1, pagarme_divergent: 1 });
  assertEquals(plan.dates.flatMap((d) => d.rows).length, 0);
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement `supabase/functions/platform-admin/metrics-backfill-logic.ts`**

```ts
// Pure backfill of month-end snapshot rows from provider history (spec §3). No I/O.

import {
  closeInstant,
  lastDayOfMonth,
  monthRange,
  previousMonth,
  saoPauloDate,
} from "../_shared/sao-paulo-date.ts";
import { type PlanPriceRow, resolvePlanFromPriceId, toMonthlyCents } from "../_shared/billing-logic.ts";
import type { SnapshotRow } from "../_shared/metrics-snapshot.ts";

export interface StripeSubLite {
  id: string;
  customer: string;
  status: string;
  start_date: number | null; // unix seconds
  trial_start: number | null;
  trial_end: number | null;
  ended_at: number | null;
  price_id: string | null;
  amount_cents: number | null; // net of the coupon it carries today
  interval: string | null;
}

export interface PagarmeSubLite {
  id: string;
  status: string;
  created_at: string | null;
  start_at: string | null;
  canceled_at: string | null;
  interval: string | null;
  price_cents: number | null;
  metadata_workspace_id: string | null;
  metadata_plan_id: string | null;
}

export interface BackfillPlanRow extends PlanPriceRow {
  name: string;
  price_brl_annual: number | null;
}

export interface BackfillLocal {
  customerToWorkspace: Map<string, string>;
  pagarmeSubToWorkspace: Map<string, string>;
  workspaceIds: Set<string>;
  plans: BackfillPlanRow[];
}

export interface BackfillSkipped {
  stripe_unmapped: number;
  pagarme_unmapped: number;
  pagarme_divergent: number;
}

export interface BackfillPlan {
  dates: { date: string; rows: SnapshotRow[] }[];
  skipped: BackfillSkipped;
}

const ms = (sec: number | null) => (sec == null ? null : sec * 1000);
const iso = (s: string | null) => (s ? new Date(s).getTime() : null);

export function stripeStatusAt(s: StripeSubLite, t: Date): "active" | "trialing" | null {
  const now = t.getTime();
  const start = ms(s.start_date);
  if (start == null || start > now) return null;
  const ended = ms(s.ended_at);
  if (ended != null && ended <= now) return null;
  const ts = ms(s.trial_start);
  const te = ms(s.trial_end);
  if (ts != null && te != null && ts <= now && now < te) return "trialing";
  return "active";
}

export function pagarmeStatusAt(s: PagarmeSubLite, t: Date): "active" | "trialing" | null {
  const now = t.getTime();
  const created = iso(s.created_at) ?? iso(s.start_at);
  if (created == null || created > now) return null;
  const canceled = iso(s.canceled_at);
  if (canceled != null && canceled <= now) return null;
  const start = iso(s.start_at);
  if (start != null && start > now) return "trialing"; // Pagar.me "future" = our trial
  return "active";
}

export function mapPagarmeWorkspace(
  s: PagarmeSubLite,
  local: BackfillLocal,
): { workspace_id: string } | { skip: "unmapped" | "divergent" } {
  const mirrored = local.pagarmeSubToWorkspace.get(s.id);
  if (mirrored) {
    if (s.metadata_workspace_id && s.metadata_workspace_id !== mirrored) return { skip: "divergent" };
    return { workspace_id: mirrored };
  }
  if (s.metadata_workspace_id && local.workspaceIds.has(s.metadata_workspace_id)) {
    return { workspace_id: s.metadata_workspace_id };
  }
  return { skip: "unmapped" };
}

interface Candidate {
  workspace_id: string;
  provider: "stripe" | "pagarme";
  startMs: number;
  statusAt: (t: Date) => "active" | "trialing" | null;
  plan_id: string | null;
  plan_name: string | null;
  billing_interval: string | null;
  monthly_cents: number;
}

export function buildBackfill(input: {
  stripe: StripeSubLite[];
  pagarme: PagarmeSubLite[];
  local: BackfillLocal;
  internalIds: Set<string>;
  todaySP: string;
}): BackfillPlan {
  const { local, internalIds } = input;
  const skipped: BackfillSkipped = { stripe_unmapped: 0, pagarme_unmapped: 0, pagarme_divergent: 0 };
  const planName = (id: string | null) => local.plans.find((p) => p.id === id)?.name ?? null;
  const candidates: Candidate[] = [];

  for (const s of input.stripe) {
    if (s.status === "incomplete" || s.status === "incomplete_expired") continue;
    const ws = local.customerToWorkspace.get(s.customer);
    if (!ws) {
      skipped.stripe_unmapped++;
      continue;
    }
    if (internalIds.has(ws) || s.start_date == null) continue;
    const resolved = s.price_id ? resolvePlanFromPriceId(s.price_id, local.plans) : null;
    const interval = s.interval ?? resolved?.interval ?? null;
    candidates.push({
      workspace_id: ws,
      provider: "stripe",
      startMs: s.start_date * 1000,
      statusAt: (t) => stripeStatusAt(s, t),
      plan_id: resolved?.plan_id ?? null,
      plan_name: planName(resolved?.plan_id ?? null),
      billing_interval: interval,
      monthly_cents: toMonthlyCents(interval, s.amount_cents) ?? 0,
    });
  }

  for (const s of input.pagarme) {
    if (s.status === "failed") continue; // first charge failed; checkout compensates by cancel
    const mapped = mapPagarmeWorkspace(s, local);
    if ("skip" in mapped) {
      if (mapped.skip === "divergent") skipped.pagarme_divergent++;
      else skipped.pagarme_unmapped++;
      continue;
    }
    const startMs = iso(s.created_at) ?? iso(s.start_at);
    if (internalIds.has(mapped.workspace_id) || startMs == null) continue;
    const interval = s.interval === "month" ? "month" : "year";
    const catalog = local.plans.find((p) => p.id === s.metadata_plan_id)?.price_brl_annual ?? null;
    const price = s.price_cents ?? (interval === "year" ? catalog : null);
    candidates.push({
      workspace_id: mapped.workspace_id,
      provider: "pagarme",
      startMs,
      statusAt: (t) => pagarmeStatusAt(s, t),
      plan_id: s.metadata_plan_id,
      plan_name: planName(s.metadata_plan_id),
      billing_interval: interval,
      monthly_cents: toMonthlyCents(interval, price) ?? 0,
    });
  }

  if (!candidates.length) return { dates: [], skipped };

  const firstMonth = saoPauloDate(new Date(Math.min(...candidates.map((c) => c.startMs)))).slice(0, 7);
  const lastClosed = previousMonth(input.todaySP.slice(0, 7));
  const byWorkspace = new Map<string, Candidate[]>();
  for (const c of candidates) byWorkspace.set(c.workspace_id, [...(byWorkspace.get(c.workspace_id) ?? []), c]);

  const dates = monthRange(firstMonth, lastClosed).map((month) => {
    const date = lastDayOfMonth(month);
    const t = closeInstant(date);
    const rows: SnapshotRow[] = [];
    for (const [ws, list] of [...byWorkspace.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const inForce = list
        .map((c) => ({ c, status: c.statusAt(t) }))
        .filter((x): x is { c: Candidate; status: "active" | "trialing" } => x.status != null);
      if (!inForce.length) continue;
      const hasStripe = inForce.some((x) => x.c.provider === "stripe");
      const pagarme = inForce.filter((x) => x.c.provider === "pagarme");
      const pool = pagarme.length ? pagarme : inForce;
      // Latest start wins inside a provider; ties broken by provider name for determinism.
      const pick = [...pool].sort((a, b) => b.c.startMs - a.c.startMs || (a.c.provider < b.c.provider ? -1 : 1))[0];
      rows.push({
        workspace_id: ws,
        provider: pick.c.provider,
        plan_id: pick.c.plan_id,
        plan_name: pick.c.plan_name,
        status: pick.status,
        billing_interval: pick.c.billing_interval,
        monthly_cents: pick.c.monthly_cents,
        amount_source: pick.c.monthly_cents > 0 ? "backfill" : "unpriced",
        provider_switch: pagarme.length > 0 && hasStripe,
      });
    }
    return { date, rows };
  });

  return { dates, skipped };
}
```

- [ ] **Step 4: Run, expect PASS**; `git checkout deno.lock`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/platform-admin/metrics-backfill-logic.ts supabase/functions/__tests__/platform-admin-metrics-backfill-logic_test.ts
git commit -m "feat(platform-admin): lógica pura do backfill (status no fechamento, mapeamento Pagar.me, precedência)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Backfill gateways + `backfill-metrics` handler + route

**Files:**
- Create: `supabase/functions/platform-admin/metrics-backfill.ts`
- Modify: `supabase/functions/platform-admin/index.ts` (import + `case "backfill-metrics"`)
- Test: `supabase/functions/__tests__/platform-admin-metrics-backfill_test.ts`

**Interfaces:**
- Consumes: `buildBackfill`, `StripeSubLite`, `PagarmeSubLite`, `BackfillLocal` (Task 7); `writeSnapshot`, `SnapshotRow` (Task 3); `stripeAmountFromSubscription`, `STRIPE_TIMEOUT_MS` (`_shared/stripe-amount.ts`); `fetchInternalWorkspaceIdsOrThrow` (Task 1); `saoPauloDate` (Task 1); `withTimeout` (`platform-admin/pricing.ts`); `loadStripe` (`_shared/stripe-loader.ts`); `pagarmeFetch` (`_shared/pagarme.ts`).
- Produces:
  ```ts
  export interface BackfillDeps { allowed: boolean; now: () => Date; loadLocal: () => Promise<BackfillLocal>; loadInternalIds: () => Promise<Set<string>>; listStripeSubs: () => Promise<StripeSubLite[]>; listPagarmeSubs: () => Promise<PagarmeSubLite[]>; write: (date: string, rows: SnapshotRow[]) => Promise<{ written: number; skipped: boolean }>; }
  export interface BackfillReport { months_written: number; months_kept_cron: number; rows_written: number; skipped: { stripe_unmapped: number; pagarme_unmapped: number; pagarme_divergent: number } }
  export function toStripeSubLite(raw: unknown): StripeSubLite;
  export function toPagarmeSubLite(raw: unknown): PagarmeSubLite;
  export function handleBackfillMetrics(headers: Record<string, string>, deps: BackfillDeps): Promise<Response>;
  export function defaultBackfillDeps(svc: SupabaseClient): BackfillDeps;
  ```

- [ ] **Step 1: Write failing tests** — `supabase/functions/__tests__/platform-admin-metrics-backfill_test.ts`:

```ts
import { assertEquals } from "./assert.ts";
import {
  type BackfillDeps,
  handleBackfillMetrics,
  toPagarmeSubLite,
  toStripeSubLite,
} from "../platform-admin/metrics-backfill.ts";

const H = { "Content-Type": "application/json" };

function deps(over: Partial<BackfillDeps> = {}) {
  const calls: string[] = [];
  const d: BackfillDeps = {
    allowed: true,
    now: () => new Date("2026-09-25T12:00:00Z"),
    loadLocal: () => {
      calls.push("loadLocal");
      return Promise.resolve({
        customerToWorkspace: new Map([["cus_1", "w1"]]),
        pagarmeSubToWorkspace: new Map(),
        workspaceIds: new Set(["w1"]),
        plans: [{ id: "pro", name: "Pro", stripe_price_id: "price_m", stripe_price_id_annual: null, price_brl_annual: null }],
      });
    },
    loadInternalIds: () => {
      calls.push("loadInternalIds");
      return Promise.resolve(new Set());
    },
    listStripeSubs: () => {
      calls.push("stripe");
      return Promise.resolve([{
        id: "sub_1", customer: "cus_1", status: "active", start_date: Math.floor(Date.parse("2026-07-10T00:00:00Z") / 1000),
        trial_start: null, trial_end: null, ended_at: null, price_id: "price_m", amount_cents: 9900, interval: "month",
      }]);
    },
    listPagarmeSubs: () => {
      calls.push("pagarme");
      return Promise.resolve([]);
    },
    write: (date) => {
      calls.push(`write:${date}`);
      return Promise.resolve(date === "2026-08-31" ? { written: 0, skipped: true } : { written: 1, skipped: false });
    },
    ...over,
  };
  return { d, calls };
}

Deno.test("backfill-metrics refuses with 403 and touches nothing when not allowed", async () => {
  const { d, calls } = deps({ allowed: false });
  const res = await handleBackfillMetrics(H, d);
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "backfill_not_allowed" });
  assertEquals(calls, []);
});

Deno.test("backfill-metrics writes each month and reports kept cron months", async () => {
  const { d, calls } = deps();
  const res = await handleBackfillMetrics(H, d);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    months_written: 1,
    months_kept_cron: 1,
    rows_written: 1,
    skipped: { stripe_unmapped: 0, pagarme_unmapped: 0, pagarme_divergent: 0 },
  });
  assertEquals(calls.filter((c) => c.startsWith("write:")), ["write:2026-07-31", "write:2026-08-31"]);
});

Deno.test("backfill-metrics: a provider failure returns a generic 500 and writes nothing", async () => {
  const { d, calls } = deps({ listPagarmeSubs: () => Promise.reject(new Error("pagarme 401 {secret body}")) });
  const res = await handleBackfillMetrics(H, d);
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "backfill_failed" });
  assertEquals(calls.some((c) => c.startsWith("write:")), false);
});

Deno.test("toStripeSubLite reads ids, timestamps and the coupon-net amount", () => {
  const lite = toStripeSubLite({
    id: "sub_1", customer: { id: "cus_1" }, status: "canceled", start_date: 100, trial_start: null, trial_end: null, ended_at: 200,
    items: { data: [{ quantity: 1, price: { id: "price_m", unit_amount: 10000, currency: "brl", recurring: { interval: "month" } } }] },
    discounts: [{ coupon: { id: "c", percent_off: 10 } }],
  });
  assertEquals(lite, {
    id: "sub_1", customer: "cus_1", status: "canceled", start_date: 100, trial_start: null, trial_end: null, ended_at: 200,
    price_id: "price_m", amount_cents: 9000, interval: "month",
  });
});

Deno.test("toPagarmeSubLite reads price, interval and metadata", () => {
  assertEquals(
    toPagarmeSubLite({
      id: "sub_pg", status: "future", created_at: "2026-09-01T00:00:00Z", start_at: "2026-09-26T00:00:00Z",
      canceled_at: null, interval: "year", items: [{ pricing_scheme: { price: 120000 } }],
      metadata: { workspace_id: "w1", plan_id: "max" },
    }),
    {
      id: "sub_pg", status: "future", created_at: "2026-09-01T00:00:00Z", start_at: "2026-09-26T00:00:00Z",
      canceled_at: null, interval: "year", price_cents: 120000, metadata_workspace_id: "w1", metadata_plan_id: "max",
    },
  );
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement `supabase/functions/platform-admin/metrics-backfill.ts`**

```ts
// backfill-metrics: rebuilds month-end snapshot rows from Stripe + Pagar.me history (spec §3).
// Prod-only: prod and staging share one Stripe account, so the guard is enforced here, before
// any remote or database call.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { fetchAllRows } from "../_shared/paginate.ts";
import { pagarmeFetch } from "../_shared/pagarme.ts";
import { loadStripe } from "../_shared/stripe-loader.ts";
import { STRIPE_TIMEOUT_MS, stripeAmountFromSubscription } from "../_shared/stripe-amount.ts";
import { fetchInternalWorkspaceIdsOrThrow } from "../_shared/internal-workspaces.ts";
import { type SnapshotRow, writeSnapshot } from "../_shared/metrics-snapshot.ts";
import { saoPauloDate } from "../_shared/sao-paulo-date.ts";
import { withTimeout } from "./pricing.ts";
import {
  type BackfillLocal,
  type BackfillPlanRow,
  buildBackfill,
  type PagarmeSubLite,
  type StripeSubLite,
} from "./metrics-backfill-logic.ts";

export interface BackfillDeps {
  allowed: boolean;
  now: () => Date;
  loadLocal: () => Promise<BackfillLocal>;
  loadInternalIds: () => Promise<Set<string>>;
  listStripeSubs: () => Promise<StripeSubLite[]>;
  listPagarmeSubs: () => Promise<PagarmeSubLite[]>;
  write: (date: string, rows: SnapshotRow[]) => Promise<{ written: number; skipped: boolean }>;
}

export interface BackfillReport {
  months_written: number;
  months_kept_cron: number;
  rows_written: number;
  skipped: { stripe_unmapped: number; pagarme_unmapped: number; pagarme_divergent: number };
}

type Num = number | null | undefined;

export function toStripeSubLite(raw: unknown): StripeSubLite {
  const s = raw as {
    id: string;
    customer: string | { id?: string } | null;
    status: string;
    start_date?: Num;
    trial_start?: Num;
    trial_end?: Num;
    ended_at?: Num;
    items?: { data?: Array<{ price?: { id?: string } }> };
  };
  const amt = stripeAmountFromSubscription(raw, null);
  return {
    id: s.id,
    customer: typeof s.customer === "string" ? s.customer : s.customer?.id ?? "",
    status: s.status,
    start_date: s.start_date ?? null,
    trial_start: s.trial_start ?? null,
    trial_end: s.trial_end ?? null,
    ended_at: s.ended_at ?? null,
    price_id: s.items?.data?.[0]?.price?.id ?? null,
    amount_cents: amt.amount_cents,
    interval: amt.interval,
  };
}

export function toPagarmeSubLite(raw: unknown): PagarmeSubLite {
  const s = raw as {
    id: string;
    status: string;
    created_at?: string | null;
    start_at?: string | null;
    canceled_at?: string | null;
    interval?: string | null;
    items?: Array<{ pricing_scheme?: { price?: number | null } | null } | null> | null;
    metadata?: { workspace_id?: string | null; plan_id?: string | null } | null;
  };
  return {
    id: s.id,
    status: s.status,
    created_at: s.created_at ?? null,
    start_at: s.start_at ?? null,
    canceled_at: s.canceled_at ?? null,
    interval: s.interval ?? null,
    price_cents: s.items?.[0]?.pricing_scheme?.price ?? null,
    metadata_workspace_id: s.metadata?.workspace_id ?? null,
    metadata_plan_id: s.metadata?.plan_id ?? null,
  };
}

export async function handleBackfillMetrics(
  headers: Record<string, string>,
  deps: BackfillDeps,
): Promise<Response> {
  if (!deps.allowed) {
    return new Response(JSON.stringify({ error: "backfill_not_allowed" }), { status: 403, headers });
  }
  try {
    const [local, internalIds, stripe, pagarme] = await Promise.all([
      deps.loadLocal(),
      deps.loadInternalIds(),
      deps.listStripeSubs(),
      deps.listPagarmeSubs(),
    ]);
    const plan = buildBackfill({ stripe, pagarme, local, internalIds, todaySP: saoPauloDate(deps.now()) });
    const report: BackfillReport = { months_written: 0, months_kept_cron: 0, rows_written: 0, skipped: plan.skipped };
    for (const { date, rows } of plan.dates) {
      const res = await deps.write(date, rows);
      if (res.skipped) report.months_kept_cron++;
      else {
        report.months_written++;
        report.rows_written += res.written;
      }
    }
    return new Response(JSON.stringify(report), { status: 200, headers });
  } catch (err) {
    console.error("[platform-admin] backfill-metrics failed:", (err as Error).message);
    return new Response(JSON.stringify({ error: "backfill_failed" }), { status: 500, headers });
  }
}

// ─── Default (network) deps ────────────────────────────────────────────────

const STRIPE_MAX_PAGES = 100;
const PAGARME_PAGE_SIZE = 100;
const PAGARME_MAX_PAGES = 50;

type StripeSubsClient = {
  subscriptions: {
    list: (
      params: Record<string, unknown>,
      opts?: { timeout?: number },
    ) => Promise<{ data: unknown[]; has_more: boolean }>;
  };
};

async function listStripeSubscriptions(): Promise<StripeSubLite[]> {
  const client = await loadStripe();
  if (!client) throw new Error("stripe not configured");
  const stripe = client as unknown as StripeSubsClient;
  const out: StripeSubLite[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < STRIPE_MAX_PAGES; page++) {
    const res = await withTimeout(
      stripe.subscriptions.list(
        { status: "all", limit: 100, expand: ["data.discounts"], ...(startingAfter ? { starting_after: startingAfter } : {}) },
        { timeout: STRIPE_TIMEOUT_MS },
      ),
      STRIPE_TIMEOUT_MS,
      "stripe.subscriptions.list",
    );
    for (const raw of res.data) out.push(toStripeSubLite(raw));
    if (!res.has_more || !res.data.length) return out;
    startingAfter = (res.data[res.data.length - 1] as { id: string }).id;
  }
  // A partial list would write false churn into history: refuse instead.
  throw new Error("stripe subscriptions list exceeded the page cap");
}

async function listPagarmeSubscriptions(): Promise<PagarmeSubLite[]> {
  const out: PagarmeSubLite[] = [];
  for (let page = 1; page <= PAGARME_MAX_PAGES; page++) {
    const res = await pagarmeFetch<{ data?: unknown[] | null }>(
      "GET",
      `/subscriptions?page=${page}&size=${PAGARME_PAGE_SIZE}`,
    );
    const rows = res?.data ?? [];
    for (const raw of rows) out.push(toPagarmeSubLite(raw));
    if (rows.length < PAGARME_PAGE_SIZE) return out;
  }
  throw new Error("pagarme subscriptions list exceeded the page cap");
}

async function loadLocal(svc: SupabaseClient): Promise<BackfillLocal> {
  const subs = await fetchAllRows<{
    workspace_id: string;
    stripe_customer_id: string | null;
    pagarme_subscription_id: string | null;
  }>((from, to) =>
    svc
      .from("workspace_subscriptions")
      .select("workspace_id, stripe_customer_id, pagarme_subscription_id")
      .order("workspace_id", { ascending: true })
      .range(from, to),
  );
  const workspaces = await fetchAllRows<{ id: string }>((from, to) =>
    svc.from("workspaces").select("id").order("id", { ascending: true }).range(from, to),
  );
  const { data: plans, error } = await svc
    .from("plans")
    .select("id, name, stripe_price_id, stripe_price_id_annual, price_brl_annual");
  if (error) throw error;
  const customerToWorkspace = new Map<string, string>();
  const pagarmeSubToWorkspace = new Map<string, string>();
  for (const s of subs) {
    if (s.stripe_customer_id) customerToWorkspace.set(s.stripe_customer_id, s.workspace_id);
    if (s.pagarme_subscription_id) pagarmeSubToWorkspace.set(s.pagarme_subscription_id, s.workspace_id);
  }
  return {
    customerToWorkspace,
    pagarmeSubToWorkspace,
    workspaceIds: new Set(workspaces.map((w) => w.id)),
    plans: (plans ?? []) as BackfillPlanRow[],
  };
}

/** Lazy: nothing here runs until a dep is called, so the 403 guard precedes all I/O. */
export function defaultBackfillDeps(svc: SupabaseClient): BackfillDeps {
  return {
    allowed: Deno.env.get("METRICS_BACKFILL_ALLOWED") === "true",
    now: () => new Date(),
    loadLocal: () => loadLocal(svc),
    loadInternalIds: () => fetchInternalWorkspaceIdsOrThrow(svc),
    listStripeSubs: listStripeSubscriptions,
    listPagarmeSubs: listPagarmeSubscriptions,
    write: (date, rows) => writeSnapshot(svc, date, "backfill", rows),
  };
}
```

Check the exported name and generic signature of `pagarmeFetch` in `supabase/functions/_shared/pagarme.ts` before relying on `pagarmeFetch<T>(method, path)`; the Depósitos gateway (`platform-admin/deposits.ts`) calls it as `pagarmeFetch<T>("GET", path)`.

- [ ] **Step 4: Route it in `index.ts`**: add `import { defaultBackfillDeps, handleBackfillMetrics } from "./metrics-backfill.ts";` and, next to `get-metrics-history`:

```ts
      case "backfill-metrics":
        return await handleBackfillMetrics(headers, defaultBackfillDeps(svc));
```

- [ ] **Step 5: Run the test, expect PASS**; run `npm run check:functions`; `git checkout deno.lock`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/platform-admin/metrics-backfill.ts supabase/functions/platform-admin/index.ts supabase/functions/__tests__/platform-admin-metrics-backfill_test.ts
git commit -m "feat(platform-admin): ação backfill-metrics com guard de produção

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Admin data layer: API types, chart theme, view helpers

**Files:**
- Modify: `apps/admin/src/lib/api.ts` (after `getDeposits`, ~line 398)
- Create: `apps/admin/src/lib/chartTheme.ts`
- Modify: `apps/admin/src/globals.css` (`:root` and `[data-theme='dark']` blocks)
- Create: `apps/admin/src/pages/metricas/metrics-view.ts`
- Test: `apps/admin/src/pages/__tests__/metrics-view.test.ts`

**Interfaces:**
- Produces (api.ts): types `MetricsMovements`, `MetricsChurn`, `MetricsMonth`, `MetricsHistoryResponse`, `BackfillReport` (field-for-field the backend shapes in Tasks 5, 6, 8); `getMetricsHistory(): Promise<MetricsHistoryResponse>`; `backfillMetrics(): Promise<BackfillReport>`.
- Produces (chartTheme.ts): `useIsDark(): boolean`; `tokenColor(name: string, alpha?: number): string`; `getAdminChartTheme(): AdminChartTheme`; side-effect Chart.js registration.
- Produces (metrics-view.ts): `MOVEMENT_KEYS`, `MOVEMENT_LABELS`, `monthLabel(m)`, `formatPct(x)`, `latestMonth(months)`, `mrrDelta(months)`, `revenueSeries(months, mode)`, `movementSeries(months)`, `backfillToastMessage(r)`.

- [ ] **Step 1: Add the API types and calls** to `apps/admin/src/lib/api.ts`:

```ts
// ─── Métricas: histórico (sub-projeto B) ─────────────────────

export interface MetricsMovements {
  new: number;
  expansion: number;
  contraction: number;
  past_due: number;
  recovered: number;
  churn: number;
  switch: number;
}

export interface MetricsChurn {
  logos: number;
  lost_cents: number;
  base_logos: number;
  base_cents: number;
  logo_pct: number | null;
  revenue_pct: number | null;
}

export interface MetricsMonth {
  month: string;
  missing: boolean;
  close_date: string | null;
  closed: boolean;
  source: 'cron' | 'backfill' | null;
  mrr_cents: number | null;
  arr_cents: number | null;
  paying_count: number | null;
  by_provider: { stripe: number; pagarme: number } | null;
  by_plan: { plan_id: string | null; name: string; mrr_cents: number }[] | null;
  movements_since: string | null;
  movements: MetricsMovements | null;
  churn: MetricsChurn | null;
}

export interface MetricsHistoryResponse {
  generated_at: string;
  first_month: string | null;
  months: MetricsMonth[];
}

export interface BackfillReport {
  months_written: number;
  months_kept_cron: number;
  rows_written: number;
  skipped: { stripe_unmapped: number; pagarme_unmapped: number; pagarme_divergent: number };
}

export function getMetricsHistory() {
  return adminApi<MetricsHistoryResponse>('get-metrics-history');
}

export function backfillMetrics() {
  return adminApi<BackfillReport>('backfill-metrics');
}
```

- [ ] **Step 2: Add chart tokens to `apps/admin/src/globals.css`** — inside `:root { ... }` add:

```css
  --chart-1: 243 75% 64%;
  --chart-2: 173 58% 42%;
  --chart-3: 330 70% 60%;
```

and inside `[data-theme='dark'] { ... }` add:

```css
  --chart-1: 243 85% 72%;
  --chart-2: 173 55% 52%;
  --chart-3: 330 75% 68%;
```

- [ ] **Step 3: Create `apps/admin/src/lib/chartTheme.ts`**

```ts
import { useSyncExternalStore } from 'react';
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js';

// Explicit controllers: react-chartjs-2 only auto-registers the controller of the typed
// component it renders, and production tree-shaking drops the rest (CRM incident 2026-09-02,
// `"line" is not a registered controller`).
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarController,
  BarElement,
  LineController,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
);

function subscribe(callback: () => void): () => void {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

/** True while <html data-theme="dark">; re-renders on theme toggle so colours re-resolve. */
export function useIsDark(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => document.documentElement.getAttribute('data-theme') === 'dark',
    () => false,
  );
}

/**
 * Admin tokens are bare HSL triplets ("48 96% 53%"); canvas cannot read CSS variables, so this
 * wraps them in hsl(). Falls back to a neutral grey where the variable is absent (jsdom).
 */
export function tokenColor(name: string, alpha = 1): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  return raw ? `hsl(${raw} / ${alpha})` : `hsl(0 0% 50% / ${alpha})`;
}

export interface AdminChartTheme {
  text: string;
  grid: string;
  font: { family: string; size: number };
  provider: { stripe: string; pagarme: string };
  categorical: string[];
  movement: {
    new: string;
    expansion: string;
    recovered: string;
    switch: string;
    contraction: string;
    past_due: string;
    churn: string;
  };
  line: { logo: string; revenue: string };
  tooltip: {
    backgroundColor: string;
    titleColor: string;
    bodyColor: string;
    borderColor: string;
    borderWidth: number;
    padding: number;
  };
}

/** Call inside a component that also calls useIsDark(), so a theme flip re-resolves. */
export function getAdminChartTheme(): AdminChartTheme {
  return {
    text: tokenColor('muted-foreground'),
    grid: tokenColor('border', 0.6),
    font: { family: "'SF Pro Text', -apple-system, sans-serif", size: 11 },
    provider: { stripe: tokenColor('chart-1'), pagarme: tokenColor('chart-2') },
    categorical: [
      tokenColor('chart-1'),
      tokenColor('chart-2'),
      tokenColor('chart-3'),
      tokenColor('primary'),
      tokenColor('muted-foreground'),
    ],
    movement: {
      new: tokenColor('success'),
      expansion: tokenColor('success', 0.55),
      recovered: tokenColor('chart-2'),
      switch: tokenColor('chart-1'),
      contraction: tokenColor('warning', 0.6),
      past_due: tokenColor('warning'),
      churn: tokenColor('destructive'),
    },
    line: { logo: tokenColor('chart-3'), revenue: tokenColor('destructive') },
    tooltip: {
      backgroundColor: tokenColor('popover'),
      titleColor: tokenColor('popover-foreground'),
      bodyColor: tokenColor('muted-foreground'),
      borderColor: tokenColor('border'),
      borderWidth: 1,
      padding: 10,
    },
  };
}
```

- [ ] **Step 4: Write failing tests for the view helpers** — `apps/admin/src/pages/__tests__/metrics-view.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { MetricsMonth } from '../../lib/api';
import {
  backfillToastMessage,
  formatPct,
  latestMonth,
  monthLabel,
  movementSeries,
  mrrDelta,
  revenueSeries,
} from '../metricas/metrics-view';

const month = (over: Partial<MetricsMonth>): MetricsMonth => ({
  month: '2026-08',
  missing: false,
  close_date: '2026-08-31',
  closed: true,
  source: 'cron',
  mrr_cents: 10000,
  arr_cents: 120000,
  paying_count: 1,
  by_provider: { stripe: 10000, pagarme: 0 },
  by_plan: [{ plan_id: 'pro', name: 'Pro', mrr_cents: 10000 }],
  movements_since: null,
  movements: null,
  churn: null,
  ...over,
});

describe('metrics-view', () => {
  it('labels closed, open and missing months', () => {
    expect(monthLabel(month({}))).toBe('Agosto de 2026');
    expect(monthLabel(month({ month: '2026-09', closed: false }))).toBe('Setembro de 2026 (até hoje)');
    expect(monthLabel(month({ month: '2026-07', missing: true }))).toBe('Julho de 2026 (sem dados)');
  });

  it('formats fractions as Brazilian percentages and null as n/d', () => {
    expect(formatPct(0.0526)).toBe('5,3%');
    expect(formatPct(0)).toBe('0,0%');
    expect(formatPct(null)).toBe('n/d');
  });

  it('latestMonth skips missing months; mrrDelta compares with the previous available one', () => {
    const months = [
      month({ month: '2026-07', mrr_cents: 8000 }),
      month({ month: '2026-08', missing: true, mrr_cents: null }),
      month({ month: '2026-09', closed: false, mrr_cents: 10000 }),
    ];
    expect(latestMonth(months)?.month).toBe('2026-09');
    expect(mrrDelta(months)).toEqual({ cents: 2000, since: '2026-07' });
    expect(mrrDelta([month({})])).toBeNull();
  });

  it('revenueSeries by provider and by plan, in reais, null for missing months', () => {
    const months = [
      month({}),
      month({ month: '2026-09', missing: true, mrr_cents: null, by_provider: null, by_plan: null }),
    ];
    const byProvider = revenueSeries(months, 'provider');
    expect(byProvider.labels).toEqual(['Agosto de 2026', 'Setembro de 2026 (sem dados)']);
    expect(byProvider.series).toEqual([
      { key: 'stripe', label: 'Stripe', data: [100, null] },
      { key: 'pagarme', label: 'Pagar.me', data: [0, null] },
    ]);
    const byPlan = revenueSeries(months, 'plan');
    expect(byPlan.series).toEqual([{ key: 'pro', label: 'Pro', data: [100, null] }]);
  });

  it('movementSeries keeps signs and skips the first month (no movements)', () => {
    const months = [
      month({}),
      month({
        month: '2026-09',
        movements: { new: 5000, expansion: 0, contraction: -1000, past_due: 0, recovered: 0, churn: -2000, switch: 0 },
        churn: { logos: 1, lost_cents: 2000, base_logos: 4, base_cents: 20000, logo_pct: 0.25, revenue_pct: 0.15 },
      }),
    ];
    const s = movementSeries(months);
    expect(s.labels).toEqual(['Setembro de 2026']);
    expect(s.bars.find((b) => b.key === 'new')?.data).toEqual([50]);
    expect(s.bars.find((b) => b.key === 'churn')?.data).toEqual([-20]);
    expect(s.logoPct).toEqual([25]);
    expect(s.revenuePct).toEqual([15]);
  });

  it('builds the backfill toast in Portuguese without em-dashes', () => {
    const msg = backfillToastMessage({
      months_written: 3,
      months_kept_cron: 1,
      rows_written: 40,
      skipped: { stripe_unmapped: 2, pagarme_unmapped: 0, pagarme_divergent: 1 },
    });
    expect(msg).toBe('Histórico reconstruído: 3 meses gravados, 1 mantido do cron diário, 3 assinaturas ignoradas.');
    expect(msg).not.toContain('—');
  });
});
```

- [ ] **Step 5: Run, expect FAIL**

Run: `npx vitest run apps/admin/src/pages/__tests__/metrics-view.test.ts`

- [ ] **Step 6: Implement `apps/admin/src/pages/metricas/metrics-view.ts`**

```ts
import type { BackfillReport, MetricsMonth, MetricsMovements } from '../../lib/api';
import { formatMonth } from './deposits-view';

export const MOVEMENT_KEYS = [
  'new',
  'expansion',
  'recovered',
  'switch',
  'contraction',
  'past_due',
  'churn',
] as const satisfies readonly (keyof MetricsMovements)[];

export type MovementKey = (typeof MOVEMENT_KEYS)[number];

export const MOVEMENT_LABELS: Record<MovementKey, string> = {
  new: 'Novo',
  expansion: 'Expansão',
  recovered: 'Recuperado',
  switch: 'Troca de provedor',
  contraction: 'Contração',
  past_due: 'Inadimplência',
  churn: 'Churn',
};

export const BACKFILL_NOTE =
  'Mês reconstruído dos provedores: inadimplência anterior conta como ativa e o valor é o preço de hoje.';

export function monthLabel(m: MetricsMonth): string {
  const base = formatMonth(m.month);
  if (m.missing) return `${base} (sem dados)`;
  return m.closed ? base : `${base} (até hoje)`;
}

export function formatPct(x: number | null): string {
  if (x == null) return 'n/d';
  return `${(x * 100).toFixed(1).replace('.', ',')}%`;
}

const reais = (cents: number) => cents / 100;

export function latestMonth(months: MetricsMonth[]): MetricsMonth | null {
  for (let i = months.length - 1; i >= 0; i--) if (!months[i].missing) return months[i];
  return null;
}

/** MRR change of the latest available month against the previous available one. */
export function mrrDelta(months: MetricsMonth[]): { cents: number; since: string } | null {
  const available = months.filter((m) => !m.missing);
  if (available.length < 2) return null;
  const cur = available[available.length - 1];
  const prev = available[available.length - 2];
  return { cents: (cur.mrr_cents ?? 0) - (prev.mrr_cents ?? 0), since: prev.month };
}

export interface RevenueSeries {
  labels: string[];
  series: { key: string; label: string; data: (number | null)[] }[];
}

export function revenueSeries(months: MetricsMonth[], mode: 'provider' | 'plan'): RevenueSeries {
  const labels = months.map(monthLabel);
  if (mode === 'provider') {
    return {
      labels,
      series: (['stripe', 'pagarme'] as const).map((key) => ({
        key,
        label: key === 'stripe' ? 'Stripe' : 'Pagar.me',
        data: months.map((m) => (m.by_provider ? reais(m.by_provider[key]) : null)),
      })),
    };
  }
  const plans = new Map<string, string>();
  for (const m of months) for (const p of m.by_plan ?? []) plans.set(p.plan_id ?? '', p.name);
  return {
    labels,
    series: [...plans.entries()].map(([key, label]) => ({
      key: key || 'sem-plano',
      label,
      data: months.map((m) => {
        if (!m.by_plan) return null;
        const hit = m.by_plan.find((p) => (p.plan_id ?? '') === key);
        return reais(hit?.mrr_cents ?? 0);
      }),
    })),
  };
}

export interface MovementSeries {
  months: MetricsMonth[];
  labels: string[];
  bars: { key: MovementKey; label: string; data: number[] }[];
  logoPct: (number | null)[];
  revenuePct: (number | null)[];
}

/** Only months that have movements (not the first, not missing). */
export function movementSeries(all: MetricsMonth[]): MovementSeries {
  const months = all.filter((m) => m.movements);
  const pct = (x: number | null | undefined) => (x == null ? null : Math.round(x * 1000) / 10);
  return {
    months,
    labels: months.map(monthLabel),
    bars: MOVEMENT_KEYS.map((key) => ({
      key,
      label: MOVEMENT_LABELS[key],
      data: months.map((m) => reais(m.movements![key])),
    })),
    logoPct: months.map((m) => pct(m.churn?.logo_pct)),
    revenuePct: months.map((m) => pct(m.churn?.revenue_pct)),
  };
}

export function backfillToastMessage(r: BackfillReport): string {
  const ignored = r.skipped.stripe_unmapped + r.skipped.pagarme_unmapped + r.skipped.pagarme_divergent;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return (
    `Histórico reconstruído: ${plural(r.months_written, 'mês gravado', 'meses gravados')}, ` +
    `${plural(r.months_kept_cron, 'mantido do cron diário', 'mantidos do cron diário')}, ` +
    `${plural(ignored, 'assinatura ignorada', 'assinaturas ignoradas')}.`
  );
}
```

- [ ] **Step 7: Run, expect PASS.** Then run `npx tsc -p apps/admin/tsconfig.json --noEmit` (if `node_modules/.deno` exists, first `rm -rf node_modules/.deno && npm ci`).

- [ ] **Step 8: Commit**

```bash
git add apps/admin/src/lib/api.ts apps/admin/src/lib/chartTheme.ts apps/admin/src/globals.css apps/admin/src/pages/metricas/metrics-view.ts apps/admin/src/pages/__tests__/metrics-view.test.ts
git commit -m "feat(admin): tipos do histórico de métricas, tema dos gráficos e helpers de visualização

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Métricas page sections (`#mrr`, `#churn`), backfill button, hash scroll

**Files:**
- Create: `apps/admin/src/pages/metricas/useMetricsHistory.ts`
- Create: `apps/admin/src/pages/metricas/RevenueSection.tsx`
- Create: `apps/admin/src/pages/metricas/MovementSection.tsx`
- Modify: `apps/admin/src/pages/MetricasPage.tsx`
- Modify: `apps/admin/src/__tests__/no-hex-literals.test.ts` (add the two section files to `FILES`)
- Modify: `apps/admin/src/pages/__tests__/MetricasPage.test.tsx`
- Test: `apps/admin/src/pages/__tests__/MetricsSections.test.tsx` (new)

**Interfaces:**
- Consumes: Task 9 exports; `formatMoney` from `lib/subscription`; `Card, CardContent, CardHeader, CardTitle`; `Button`; `Skeleton`; `EmptyState`; `ErrorState`; `PageHeader`; table primitives.
- Produces: `useMetricsHistory()`; `RevenueSection`; `MovementSection`; MetricasPage sections `#mrr` and `#churn`.

- [ ] **Step 1: Write failing tests** — `apps/admin/src/pages/__tests__/MetricsSections.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('react-chartjs-2', () => ({
  Bar: ({ data }: { data: { labels: string[]; datasets: { label: string }[] } }) => (
    <div
      data-testid="bar-chart"
      data-labels={JSON.stringify(data.labels)}
      data-datasets={JSON.stringify(data.datasets.map((d) => d.label))}
    />
  ),
  Line: ({ data }: { data: { datasets: { label: string }[] } }) => (
    <div data-testid="line-chart" data-datasets={JSON.stringify(data.datasets.map((d) => d.label))} />
  ),
}));

vi.mock('../../lib/api', () => ({ getMetricsHistory: vi.fn() }));

import { getMetricsHistory, type MetricsHistoryResponse } from '../../lib/api';
import { RevenueSection } from '../metricas/RevenueSection';
import { MovementSection } from '../metricas/MovementSection';

const wrap = (ui: ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

const DATA: MetricsHistoryResponse = {
  generated_at: '2026-09-25T12:00:00Z',
  first_month: '2026-08',
  months: [
    {
      month: '2026-08', missing: false, close_date: '2026-08-31', closed: true, source: 'backfill',
      mrr_cents: 10000, arr_cents: 120000, paying_count: 1,
      by_provider: { stripe: 10000, pagarme: 0 },
      by_plan: [{ plan_id: 'pro', name: 'Pro', mrr_cents: 10000 }],
      movements_since: null, movements: null, churn: null,
    },
    {
      month: '2026-09', missing: false, close_date: '2026-09-24', closed: false, source: 'cron',
      mrr_cents: 15000, arr_cents: 180000, paying_count: 2,
      by_provider: { stripe: 10000, pagarme: 5000 },
      by_plan: [{ plan_id: 'pro', name: 'Pro', mrr_cents: 10000 }, { plan_id: 'max', name: 'Max', mrr_cents: 5000 }],
      movements_since: '2026-08',
      movements: { new: 5000, expansion: 0, contraction: 0, past_due: 0, recovered: 0, churn: 0, switch: 0 },
      churn: { logos: 0, lost_cents: 0, base_logos: 1, base_cents: 10000, logo_pct: 0, revenue_pct: 0 },
    },
  ],
};

beforeEach(() => vi.mocked(getMetricsHistory).mockReset());

describe('RevenueSection', () => {
  it('shows the current MRR, ARR, paying count and delta, and toggles the stack', async () => {
    vi.mocked(getMetricsHistory).mockResolvedValue(DATA);
    wrap(<RevenueSection />);
    expect(await screen.findByText('MRR atual')).toBeInTheDocument();
    expect(screen.getByTestId('revenue-mrr')).toHaveTextContent('150,00');
    expect(screen.getByTestId('revenue-arr')).toHaveTextContent('1.800,00');
    expect(screen.getByTestId('revenue-paying')).toHaveTextContent('2');
    expect(screen.getByTestId('revenue-delta')).toHaveTextContent('50,00');
    expect(JSON.parse(screen.getByTestId('bar-chart').dataset.datasets!)).toEqual(['Stripe', 'Pagar.me']);
    fireEvent.click(screen.getByRole('button', { name: 'Por plano' }));
    expect(JSON.parse(screen.getByTestId('bar-chart').dataset.datasets!)).toEqual(['Pro', 'Max']);
  });

  it('shows the empty state when there is no history yet', async () => {
    vi.mocked(getMetricsHistory).mockResolvedValue({ generated_at: '', first_month: null, months: [] });
    wrap(<RevenueSection />);
    expect(await screen.findByText('Histórico ainda vazio')).toBeInTheDocument();
  });

  it('shows the error state with retry', async () => {
    vi.mocked(getMetricsHistory).mockRejectedValue(new Error('boom'));
    wrap(<RevenueSection />);
    expect(await screen.findByRole('button', { name: /tentar novamente/i })).toBeInTheDocument();
  });
});

describe('MovementSection', () => {
  it('renders the movement bars, the churn line and the table', async () => {
    vi.mocked(getMetricsHistory).mockResolvedValue(DATA);
    wrap(<MovementSection />);
    expect(await screen.findByTestId('bar-chart')).toBeInTheDocument();
    expect(JSON.parse(screen.getByTestId('line-chart').dataset.datasets!)).toEqual([
      'Churn de logos (%)',
      'Churn de receita (%)',
    ]);
    expect(screen.getByRole('columnheader', { name: 'Novo' })).toBeInTheDocument();
    expect(screen.getByText('Setembro de 2026 (até hoje)')).toBeInTheDocument();
  });

  it('explains when there is only one month (nothing to compare)', async () => {
    vi.mocked(getMetricsHistory).mockResolvedValue({ ...DATA, months: [DATA.months[0]] });
    wrap(<MovementSection />);
    expect(await screen.findByText('Movimento aparece a partir do segundo mês')).toBeInTheDocument();
  });
});
```

`ErrorState`'s retry button reads "Tentar novamente".

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run apps/admin/src/pages/__tests__/MetricsSections.test.tsx`

- [ ] **Step 3: Implement `useMetricsHistory.ts`**

```ts
import { useQuery } from '@tanstack/react-query';
import { getMetricsHistory } from '../../lib/api';

export const METRICS_HISTORY_KEY = ['admin', 'metrics-history'] as const;

/** Shared by both chart sections and the page (same key, one request). */
export function useMetricsHistory() {
  return useQuery({
    queryKey: METRICS_HISTORY_KEY,
    queryFn: getMetricsHistory,
    staleTime: 5 * 60 * 1000,
  });
}
```

- [ ] **Step 4: Implement `RevenueSection.tsx`**

```tsx
import { useMemo, useState } from 'react';
import { Bar } from 'react-chartjs-2';
import { LineChart as LineChartIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { formatMoney } from '../../lib/subscription';
import { getAdminChartTheme, useIsDark } from '../../lib/chartTheme';
import { useMetricsHistory } from './useMetricsHistory';
import { BACKFILL_NOTE, latestMonth, monthLabel, mrrDelta, revenueSeries } from './metrics-view';
import { formatMonth } from './deposits-view';

function Stat({ label, value, testId, sub }: { label: string; value: string; testId: string; sub?: string }) {
  return (
    <div className="glass-surface bg-card border border-border rounded-2xl p-4 min-w-0">
      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
      <p data-testid={testId} className="text-xl sm:text-2xl font-bold font-sf break-words">
        {value}
      </p>
      {sub ? <p className="text-xs text-muted-foreground mt-1">{sub}</p> : null}
    </div>
  );
}

export function RevenueSection() {
  const q = useMetricsHistory();
  useIsDark(); // subscribes to theme flips so the tokens below re-resolve on re-render
  const theme = getAdminChartTheme();
  const [mode, setMode] = useState<'provider' | 'plan'>('provider');
  const months = q.data?.months ?? [];
  const series = useMemo(() => revenueSeries(months, mode), [months, mode]);

  if (q.isPending) return <Skeleton className="h-80 w-full rounded-2xl" />;
  if (q.isError) return <ErrorState message="Não foi possível carregar o histórico." onRetry={() => q.refetch()} />;
  if (!months.length) {
    return (
      <EmptyState
        icon={LineChartIcon}
        title="Histórico ainda vazio"
        description="O histórico começa no primeiro fechamento diário ou na reconstrução pelos provedores."
      />
    );
  }

  const current = latestMonth(months);
  const delta = mrrDelta(months);
  const colors = mode === 'provider' ? [theme.provider.stripe, theme.provider.pagarme] : theme.categorical;
  const data = {
    labels: series.labels,
    datasets: series.series.map((s, i) => ({
      label: s.label,
      data: s.data,
      backgroundColor: months.map((m) => (m.closed ? colors[i % colors.length] : colors[i % colors.length].replace(/\/ 1\)$/, '/ 0.45)'))),
      borderRadius: 4,
      stack: 'mrr',
    })),
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="MRR atual" testId="revenue-mrr" value={formatMoney(current?.mrr_cents ?? 0, 'brl')} sub={current ? monthLabel(current) : undefined} />
        <Stat label="ARR" testId="revenue-arr" value={formatMoney(current?.arr_cents ?? 0, 'brl')} />
        <Stat label="Pagantes" testId="revenue-paying" value={String(current?.paying_count ?? 0)} />
        <Stat
          label="Variação"
          testId="revenue-delta"
          value={delta ? `${delta.cents >= 0 ? '+' : ''}${formatMoney(delta.cents, 'brl')}` : 'n/d'}
          sub={delta ? `desde ${formatMonth(delta.since)}` : undefined}
        />
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">MRR por mês</CardTitle>
          <div className="flex gap-1" role="group" aria-label="Empilhar por">
            <Button size="sm" variant={mode === 'provider' ? 'secondary' : 'ghost'} onClick={() => setMode('provider')}>
              Por provedor
            </Button>
            <Button size="sm" variant={mode === 'plan' ? 'secondary' : 'ghost'} onClick={() => setMode('plan')}>
              Por plano
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-72">
            <Bar
              data={data}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                  x: { stacked: true, ticks: { color: theme.text, font: theme.font }, grid: { display: false } },
                  y: { stacked: true, ticks: { color: theme.text, font: theme.font }, grid: { color: theme.grid } },
                },
                plugins: {
                  legend: { labels: { color: theme.text, font: theme.font } },
                  tooltip: {
                    ...theme.tooltip,
                    callbacks: {
                      label: (ctx) => `${ctx.dataset.label}: ${formatMoney(Math.round(Number(ctx.raw ?? 0) * 100), 'brl')}`,
                      footer: (items) => (months[items[0]?.dataIndex ?? -1]?.source === 'backfill' ? BACKFILL_NOTE : ''),
                    },
                  },
                },
              }}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

The open month's lighter fill works because `tokenColor` returns `hsl(<triplet> / 1)`; the `.replace(/\/ 1\)$/, '/ 0.45)')` swaps the alpha. If `formatMoney` output for the tests differs (it uses `Intl` with `R$`), keep the `toHaveTextContent('150,00')` substring assertions, which match either way.

- [ ] **Step 5: Implement `MovementSection.tsx`**

```tsx
import { useMemo } from 'react';
import { Bar, Line } from 'react-chartjs-2';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { formatMoney } from '../../lib/subscription';
import { getAdminChartTheme, useIsDark } from '../../lib/chartTheme';
import { useMetricsHistory } from './useMetricsHistory';
import { formatPct, MOVEMENT_KEYS, MOVEMENT_LABELS, monthLabel, movementSeries } from './metrics-view';
import { formatMonth } from './deposits-view';

/** 'YYYY-MM' of the calendar month before `month`. */
function prevCalendarMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export function MovementSection() {
  const q = useMetricsHistory();
  useIsDark(); // subscribes to theme flips so the tokens below re-resolve on re-render
  const theme = getAdminChartTheme();
  const s = useMemo(() => movementSeries(q.data?.months ?? []), [q.data]);

  if (q.isPending) return <Skeleton className="h-80 w-full rounded-2xl" />;
  if (q.isError) return <ErrorState message="Não foi possível carregar o histórico." onRetry={() => q.refetch()} />;
  if (!s.months.length) {
    return (
      <EmptyState
        title="Movimento aparece a partir do segundo mês"
        description="Cada mês é comparado com o fechamento anterior."
      />
    );
  }

  const axis = { ticks: { color: theme.text, font: theme.font } };
  const bar = {
    labels: s.labels,
    datasets: s.bars.map((b) => ({
      label: b.label,
      data: b.data,
      backgroundColor: theme.movement[b.key],
      borderRadius: 3,
      stack: 'mov',
    })),
  };
  const line = {
    labels: s.labels,
    datasets: [
      { label: 'Churn de logos (%)', data: s.logoPct, borderColor: theme.line.logo, backgroundColor: theme.line.logo, tension: 0.25, spanGaps: true },
      { label: 'Churn de receita (%)', data: s.revenuePct, borderColor: theme.line.revenue, backgroundColor: theme.line.revenue, tension: 0.25, spanGaps: true },
    ],
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Movimento do MRR</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <Bar
                data={bar}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  scales: {
                    x: { ...axis, stacked: true, grid: { display: false } },
                    y: { ...axis, stacked: true, grid: { color: theme.grid } },
                  },
                  plugins: {
                    legend: { labels: { color: theme.text, font: theme.font } },
                    tooltip: {
                      ...theme.tooltip,
                      callbacks: {
                        label: (ctx) => `${ctx.dataset.label}: ${formatMoney(Math.round(Number(ctx.raw ?? 0) * 100), 'brl')}`,
                      },
                    },
                  },
                }}
              />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Churn</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <Line
                data={line}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  scales: { x: { ...axis, grid: { display: false } }, y: { ...axis, beginAtZero: true, grid: { color: theme.grid } } },
                  plugins: { legend: { labels: { color: theme.text, font: theme.font } }, tooltip: theme.tooltip },
                }}
              />
            </div>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardContent className="overflow-x-auto pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mês</TableHead>
                {MOVEMENT_KEYS.map((k) => (
                  <TableHead key={k} className="text-right">
                    {MOVEMENT_LABELS[k]}
                  </TableHead>
                ))}
                <TableHead className="text-right">Churn logos</TableHead>
                <TableHead className="text-right">Churn receita</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {s.months.map((m) => (
                <TableRow key={m.month}>
                  <TableCell className="whitespace-nowrap">
                    <span>{monthLabel(m)}</span>
                    {m.movements_since && m.movements_since !== prevCalendarMonth(m.month) ? (
                      <span className="block text-xs text-muted-foreground">desde {formatMonth(m.movements_since)}</span>
                    ) : null}
                  </TableCell>
                  {MOVEMENT_KEYS.map((k) => (
                    <TableCell key={k} className="text-right tabular-nums">
                      {formatMoney(m.movements![k], 'brl')}
                    </TableCell>
                  ))}
                  <TableCell className="text-right tabular-nums">{formatPct(m.churn?.logo_pct ?? null)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPct(m.churn?.revenue_pct ?? null)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
```

The "desde" hint only appears when a month without data sat in between (the comparison close is not the previous calendar month).

- [ ] **Step 6: Update `MetricasPage.tsx`**

```tsx
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/button';
import { backfillMetrics, type AdminApiError } from '../lib/api';
import { DepositsSection } from './metricas/DepositsSection';
import { RevenueSection } from './metricas/RevenueSection';
import { MovementSection } from './metricas/MovementSection';
import { METRICS_HISTORY_KEY, useMetricsHistory } from './metricas/useMetricsHistory';
import { backfillToastMessage } from './metricas/metrics-view';

const BACKFILL_CONFIRM =
  'Reconstruir o histórico a partir da Stripe e do Pagar.me? Meses já gravados pelo fechamento diário não são alterados.';

/**
 * Métricas: MRR/churn history (sub-project B) above the live Depósitos panel (A).
 * Spec: docs/superpowers/specs/2026-09-25-admin-metricas-historico-design.md.
 */
export default function MetricasPage() {
  const { hash } = useLocation();
  const history = useMetricsHistory();
  const qc = useQueryClient();

  // Dashboard tiles deep-link to #mrr; scroll once the charts have their height.
  useEffect(() => {
    if (!hash || history.isPending) return;
    document.getElementById(hash.slice(1))?.scrollIntoView?.({ block: 'start' });
  }, [hash, history.isPending]);

  const backfill = useMutation({
    mutationFn: backfillMetrics,
    onSuccess: (report) => {
      toast.success(backfillToastMessage(report));
      qc.invalidateQueries({ queryKey: METRICS_HISTORY_KEY });
    },
    onError: (err) =>
      toast.error(
        (err as AdminApiError).status === 403
          ? 'Disponível só em produção'
          : 'Não foi possível reconstruir o histórico.',
      ),
  });

  return (
    <div>
      <PageHeader
        title="Métricas"
        description="Receita, repasses e evolução da plataforma"
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={backfill.isPending}
            onClick={() => {
              if (window.confirm(BACKFILL_CONFIRM)) backfill.mutate();
            }}
          >
            <History />
            {backfill.isPending ? 'Reconstruindo...' : 'Reconstruir histórico'}
          </Button>
        }
      />
      <section id="mrr" aria-labelledby="mrr-title" className="scroll-mt-6 mb-10">
        <h2 id="mrr-title" className="font-sf text-lg font-semibold mb-4">
          Receita recorrente
        </h2>
        <RevenueSection />
      </section>
      <section id="churn" aria-labelledby="churn-title" className="scroll-mt-6 mb-10">
        <h2 id="churn-title" className="font-sf text-lg font-semibold mb-4">
          Movimento e churn
        </h2>
        <MovementSection />
      </section>
      <section id="depositos" aria-labelledby="depositos-title" className="scroll-mt-6">
        <h2 id="depositos-title" className="font-sf text-lg font-semibold mb-4">
          Depósitos
        </h2>
        <DepositsSection />
      </section>
    </div>
  );
}
```

Confirm `AdminApiError` is exported from `lib/api.ts` (line ~291: `export interface AdminApiError`). The ellipsis in "Reconstruindo..." is three dots, not an em-dash.

- [ ] **Step 7: Update `MetricasPage.test.tsx`** — extend the api mock and add tests:

```tsx
vi.mock('../../lib/api', () => ({
  getDeposits: vi.fn(() => new Promise(() => {})),
  getMetricsHistory: vi.fn(() => new Promise(() => {})),
  backfillMetrics: vi.fn(),
}));
vi.mock('react-chartjs-2', () => ({ Bar: () => null, Line: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
```

The global test setup runs `vi.restoreAllMocks()` after each test, which wipes factory-time implementations, so also add a `beforeEach` that re-arms them:

```tsx
beforeEach(async () => {
  const api = await import('../../lib/api');
  vi.mocked(api.getDeposits).mockReturnValue(new Promise(() => {}) as never);
  vi.mocked(api.getMetricsHistory).mockReturnValue(new Promise(() => {}) as never);
});
```

Keep the existing test and add assertions `expect(document.getElementById('mrr')).not.toBeNull(); expect(document.getElementById('churn')).not.toBeNull();`, plus:

```tsx
  it('asks for confirmation before running the backfill and maps 403 to a production-only toast', async () => {
    const { backfillMetrics } = await import('../../lib/api');
    const { toast } = await import('sonner');
    vi.mocked(backfillMetrics).mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }));
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <MetricasPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const button = screen.getByRole('button', { name: /reconstruir histórico/i });
    fireEvent.click(button);
    expect(backfillMetrics).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Disponível só em produção'));
    confirmSpy.mockRestore();
  });
```

(import `fireEvent`, `waitFor` from `@testing-library/react`.)

- [ ] **Step 8: Add both section files to the hex guard** — in `apps/admin/src/__tests__/no-hex-literals.test.ts` `FILES`, add `'pages/metricas/RevenueSection.tsx'` and `'pages/metricas/MovementSection.tsx'`.

- [ ] **Step 9: Run** `npx vitest run apps/admin/src/pages/__tests__/MetricsSections.test.tsx apps/admin/src/pages/__tests__/MetricasPage.test.tsx apps/admin/src/__tests__/no-hex-literals.test.ts` → PASS; then `npx tsc -p apps/admin/tsconfig.json --noEmit` and `npx eslint apps/admin/src/pages/metricas apps/admin/src/pages/MetricasPage.tsx apps/admin/src/lib/chartTheme.ts`.

- [ ] **Step 10: Commit**

```bash
git add apps/admin/src/pages/metricas apps/admin/src/pages/MetricasPage.tsx apps/admin/src/__tests__/no-hex-literals.test.ts apps/admin/src/pages/__tests__/MetricasPage.test.tsx apps/admin/src/pages/__tests__/MetricsSections.test.tsx
git commit -m "feat(admin): seções Receita recorrente e Movimento e churn, botão Reconstruir histórico

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Dashboard tiles link to `/admin/metricas#mrr`

**Files:**
- Modify: `apps/admin/src/pages/DashboardPage.tsx` (the `kpis` array ~lines 143-196 and its render ~lines 203-222)
- Test: `apps/admin/src/pages/__tests__/DashboardPage.test.tsx` (append)

**Interfaces:**
- Consumes: `metricasPath()` from `apps/admin/src/lib/routes.ts`; `Link` from `react-router-dom`.

- [ ] **Step 1: Write the failing test** (append inside the existing `describe`, reusing that file's setup helpers for mocked `listWorkspaces`/`getMrr`/`getTrials` and its render wrapper; copy the render call used by its first test):

```tsx
  it('links the MRR, Pagantes and MRR projetado tiles to the Métricas MRR section', async () => {
    renderPage();
    const links = await screen.findAllByRole('link');
    const tiles = links.filter((a) => a.getAttribute('href') === '/admin/metricas#mrr');
    expect(tiles.map((a) => a.textContent?.split(/\s/)[0])).toEqual(['Pagantes', 'MRR', 'MRR']);
    expect(links.some((a) => a.textContent?.startsWith('Workspaces'))).toBe(false);
  });
```

`renderPage()` and the `beforeEach` mocks already exist in this file (lines ~62-100); the tiles render their links while the MRR queries are still pending.

- [ ] **Step 2: Run, expect FAIL.** `npx vitest run apps/admin/src/pages/__tests__/DashboardPage.test.tsx`

- [ ] **Step 3: Implement.** Add `import { Link } from 'react-router-dom';` and `import { metricasPath } from '../lib/routes';` (merge with existing imports if present). Add `to?: string;` to the kpi item type, and `to: \`${metricasPath()}#mrr\`` to the `Pagantes`, `MRR` and `MRR projetado` entries. Replace the tile render with:

```tsx
        {kpis.map((kpi) => {
          const body = (
            <>
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">{kpi.label}</p>
              <p
                className={cn(
                  'text-2xl sm:text-3xl font-bold font-sf break-words',
                  kpi.tone === 'warning' && 'text-warning',
                )}
              >
                {kpi.loading ? '—' : kpi.value}
              </p>
              {!kpi.loading && kpi.sub ? <p className="text-xs text-muted-foreground mt-1">{kpi.sub}</p> : null}
            </>
          );
          const cls = 'glass-surface bg-card border border-border rounded-2xl p-5 min-w-0';
          return kpi.to ? (
            <Link
              key={kpi.label}
              to={kpi.to}
              className={cn(cls, 'block transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}
            >
              {body}
            </Link>
          ) : (
            <div key={kpi.label} className={cls}>
              {body}
            </div>
          );
        })}
```

(The `'—'` loading placeholder already exists in this file; it is a visual placeholder, not copy added by this plan. Leave it unchanged.)

- [ ] **Step 4: Run, expect PASS**; `npx tsc -p apps/admin/tsconfig.json --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/pages/DashboardPage.tsx apps/admin/src/pages/__tests__/DashboardPage.test.tsx
git commit -m "feat(admin): tiles de MRR do Dashboard levam ao histórico em Métricas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Docs + full CI gate

**Files:**
- Modify: `CLAUDE.md` (Environment variables → Edge functions list, after `PAGARME_RECIPIENT_ID`)

- [ ] **Step 1: Document the secret** — add after the `PAGARME_RECIPIENT_ID` bullet:

```markdown
- `METRICS_BACKFILL_ALLOWED` -- `true` libera a ação `backfill-metrics` do platform-admin
  (reconstrução do histórico de MRR/churn da página Métricas a partir da Stripe e do Pagar.me).
  Só prod recebe: prod e staging compartilham a conta Stripe, e o handler responde 403 sem
  nenhuma chamada remota quando a secret não é exatamente `true`. O snapshot diário é do
  `metrics-snapshot-cron` (pg_cron `44 2 * * *` UTC = 23:44 em São Paulo), que não depende dela
```

- [ ] **Step 2: Run the whole gate** (fix anything that fails before committing):

```bash
git checkout deno.lock
[ -d node_modules/.deno ] && rm -rf node_modules/.deno && npm ci
npm run lint
npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
npm run check:functions
npm run test:functions
git checkout deno.lock
```

If `format:check` fails, run `npm run format` and include the reformatted files.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: METRICS_BACKFILL_ALLOWED e o cron metrics-snapshot-cron

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Rollout (controller, after review; not a subagent task)

Order matters because a merge deploys the frontend immediately and the migration schedules the cron.

1. **Staging** (`--project-ref wlyzhyfondykzpsiqsce`):
   1. `npx supabase functions deploy metrics-snapshot-cron --no-verify-jwt --use-api --project-ref wlyzhyfondykzpsiqsce` and the same for `platform-admin`.
   2. `npx supabase db push --linked` against staging (tables, RPC, schedule).
   3. Trigger the cron by hand with the cron secret read from a file (never as a CLI argument); check `metrics_snapshot_runs` and the row count with `npx supabase db query --linked --project-ref wlyzhyfondykzpsiqsce`; open `/admin/metricas` against staging and confirm the sections render.
2. **Prod** (`--project-ref skjzpekeqefvlojenfsw`): same three steps. The user sets `METRICS_BACKFILL_ALLOWED=true` on prod only.
3. Anchor: right after the manual prod trigger, the day's snapshot MRR equals the Dashboard MRR tile, except workspaces mid provider switch.
4. Merge the PR.
5. Run "Reconstruir histórico" in prod; compare one backfilled month with the Stripe dashboard MRR.

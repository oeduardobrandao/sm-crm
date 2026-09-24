# Admin Depósitos panel + Métricas page shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new `/admin/metricas` page whose Depósitos section shows, live from Stripe and Pagar.me, when and how much will be deposited to the bank (next 30 days by day, then by month), plus balances, in-flight transfers and recent payouts.

**Architecture:** One new `platform-admin` action `get-deposits`. Pure logic in `deposits-logic.ts` (no env/network), provider gateways + the handler in `deposits.ts`, `Promise.allSettled` per provider so one failing never hides the other. Frontend: a typed `getDeposits()` wrapper, a `MetricasPage` shell with a single `DepositsSection`, pure view helpers in `deposits-view.ts`.

**Tech Stack:** Deno edge function (`npm:stripe@17` via `_shared/stripe-loader.ts`, `pagarmeFetch` from `_shared/pagarme.ts`), React 19 + TanStack Query + Tailwind/shadcn primitives in `apps/admin`, Deno tests (`supabase/functions/__tests__/`), Vitest + Testing Library.

Spec: `docs/superpowers/specs/2026-09-24-admin-depositos-design.md`.

## Global Constraints

- Amounts are **net** of provider fees (`net_cents`); gross and fee carried alongside.
- Upcoming rows: **next 30 days day by day** (`next30`), then **one row per month** (`byMonth`).
- New secret `PAGARME_RECIPIENT_ID` is optional, no default; absent ⇒ Pagar.me `configured: false`.
- Never return provider error bodies to the client; `console.error` internally; provider failure ⇒ `{ configured: true, ok: false, error: 'unavailable' }`.
- Every provider call has a 5s timeout; wrap with `withTimeout` from `platform-admin/pricing.ts`. Pagination is capped at **5 pages per source**; hitting the cap sets `truncated: true` on that provider.
- **Currency:** every Stripe source filters `currency === 'brl'` before summing; Pagar.me is BRL only; the response carries `currency: 'brl'`.
- **`deposit_on` drives everything**: the 30-day window, monthly grouping, row order and "Próximo depósito" use `deposit_on`, never `date`.
- `summary.partial` is true when a configured provider failed; the UI then labels the waiting total as partial and names the provider.
- Pagar.me is configured only when BOTH `PAGARME_RECIPIENT_ID` and `PAGARME_SECRET_KEY` are set; Stripe when `loadStripe()` returns a client.
- `deposits.ts` must NOT be imported by `mcp-admin`.
- Portuguese copy, **no em-dashes** (use period or colon). No 6-digit hex literals in `apps/admin/src/pages/**` (`no-hex-literals.test.ts`); colours via Tailwind tokens only.
- Icons: `lucide-react`. Toasts: not needed here. Money: `formatMoney` from `apps/admin/src/lib/subscription.ts`.
- All dates in the API contract are `YYYY-MM-DD` strings (UTC date part of the provider timestamp) or `YYYY-MM` for months.
- Commit after every task. Run `npm run format` before each commit that touches `apps/`.
- Test commands: Deno `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/<file>`; Vitest `npx vitest run <path>`. `npm run check:functions` is the only type gate for edge functions.

## File structure

| File | Responsibility |
|---|---|
| `supabase/functions/platform-admin/deposits-logic.ts` (new) | Types of the API contract, date helpers, grouping, transfer-date projection, horizon split, summary, and the two pure builders `buildStripeDeposits` / `buildPagarmeDeposits` that turn raw provider payloads into `ProviderDeposits` |
| `supabase/functions/platform-admin/deposits.ts` (new) | Gateway ports + real gateways (Stripe via `loadStripe()`, Pagar.me via `pagarmeFetch`), `handleGetDeposits` |
| `supabase/functions/platform-admin/index.ts` (modify) | `case "get-deposits"` |
| `supabase/functions/__tests__/platform-admin-deposits-logic_test.ts` (new) | Unit tests for the pure module |
| `supabase/functions/__tests__/platform-admin-deposits_test.ts` (new) | Handler tests with fake gateways |
| `apps/admin/src/lib/api.ts` (modify) | `DepositsResponse` types + `getDeposits()` |
| `apps/admin/src/lib/routes.ts` (modify) | `metricasPath()` |
| `apps/admin/src/router.tsx` (modify) | `metricas` route |
| `apps/admin/src/layouts/AdminLayout.tsx` (modify) | "Métricas" nav item |
| `apps/admin/src/pages/MetricasPage.tsx` (new) | Page shell: header + `<DepositsSection />` |
| `apps/admin/src/pages/metricas/deposits-view.ts` (new) | Pure formatting helpers for the section |
| `apps/admin/src/pages/metricas/DepositsSection.tsx` (new) | Summary strip + two provider cards, states |
| `apps/admin/src/pages/__tests__/deposits-view.test.ts` (new) | Helpers tests |
| `apps/admin/src/pages/__tests__/DepositsSection.test.tsx` (new) | Component states |
| `CLAUDE.md` (modify) | Document `PAGARME_RECIPIENT_ID` |

---

### Task 1: Pure logic: contract types, date helpers, grouping, projection, horizon, summary

**Files:**
- Create: `supabase/functions/platform-admin/deposits-logic.ts`
- Test: `supabase/functions/__tests__/platform-admin-deposits-logic_test.ts`

**Interfaces:**
- Produces (used by Tasks 2, 3 and mirrored in Task 4):

```ts
export type Provider = "stripe" | "pagarme";
export interface DayRow { date: string; deposit_on: string; net_cents: number; gross_cents: number; fee_cents: number; count: number; kind: "payout" | "projected"; manual_withdrawal?: boolean }
export interface MonthRow { month: string; net_cents: number; gross_cents: number; fee_cents: number; count: number }
export interface ProviderDeposits { configured: boolean; ok: boolean; error?: "unavailable"; truncated: boolean; balance: { available_cents: number; pending_cents: number; currency: "brl" } | null; meta: Record<string, string | number | boolean | null>; upcoming: { next30: DayRow[]; byMonth: MonthRow[] }; in_transit: { id: string; amount_cents: number; expected_on: string | null; status: string }[]; recent: { id: string; date: string; amount_cents: number; status: string }[] }
export interface DepositsSummary { next: { date: string; amount_cents: number; provider: Provider } | null; next_30d_cents: number; waiting_cents: number; partial: boolean }
export interface TransferSettings { transfer_enabled: boolean; transfer_interval: "daily" | "weekly" | "monthly" | string; transfer_day: number | null }
export interface StripeSchedule { interval?: string | null; delay_days?: number | null; weekly_anchor?: string | null; monthly_anchor?: number | null }
export function toDay(value: string | number | null | undefined): string | null   // ISO string or unix seconds → "YYYY-MM-DD" (UTC), null if invalid
export function addDays(day: string, n: number): string
export function nextBusinessDay(day: string): string          // Sat → Mon, Sun → Mon, else same day
export function projectTransferDate(availableOn: string, settings: TransferSettings | null): { deposit_on: string; manual_withdrawal: boolean }
export function stripeScheduleToTransferSettings(schedule: StripeSchedule | null): TransferSettings   // null/unknown → daily; manual → transfer_enabled:false
export function projectStripeArrival(availableOn: string, schedule: StripeSchedule | null): { deposit_on: string; manual_withdrawal: boolean }
export function groupByDay(items: { date: string; net_cents: number; gross_cents: number; fee_cents: number }[]): Map<string, { net_cents: number; gross_cents: number; fee_cents: number; count: number }>
export function splitHorizon(rows: DayRow[], today: string): { next30: DayRow[]; byMonth: MonthRow[] }
export function summarize(providers: Record<Provider, ProviderDeposits>): DepositsSummary
export function unavailable(): ProviderDeposits          // { configured: true, ok: false, error: "unavailable", truncated: false, balance: null, meta: {}, upcoming: { next30: [], byMonth: [] }, in_transit: [], recent: [] }
export function notConfigured(): ProviderDeposits        // same but configured: false, no error
```

- [ ] **Step 1: Write the failing tests**

```ts
// supabase/functions/__tests__/platform-admin-deposits-logic_test.ts
import { assertEquals } from "./assert.ts";
import {
  addDays,
  groupByDay,
  nextBusinessDay,
  notConfigured,
  projectStripeArrival,
  projectTransferDate,
  splitHorizon,
  stripeScheduleToTransferSettings,
  summarize,
  toDay,
  unavailable,
  type DayRow,
  type ProviderDeposits,
} from "../platform-admin/deposits-logic.ts";

// ─── toDay / addDays / nextBusinessDay ──────────────────────────────────────

Deno.test("toDay: ISO string keeps the UTC date part (Pagar.me 03:00Z is midnight BRT)", () => {
  assertEquals(toDay("2026-10-03T03:00:00Z"), "2026-10-03");
});

Deno.test("toDay: unix seconds (Stripe available_on)", () => {
  assertEquals(toDay(1680652800), "2023-04-05");
});

Deno.test("toDay: null / invalid → null", () => {
  assertEquals(toDay(null), null);
  assertEquals(toDay(undefined), null);
  assertEquals(toDay("not a date"), null);
});

Deno.test("addDays: crosses month and year boundaries", () => {
  assertEquals(addDays("2026-01-31", 1), "2026-02-01");
  assertEquals(addDays("2026-12-31", 1), "2027-01-01");
  assertEquals(addDays("2026-03-01", -1), "2026-02-28");
});

Deno.test("nextBusinessDay: weekend rolls to Monday, weekday stays", () => {
  assertEquals(nextBusinessDay("2026-09-26"), "2026-09-28"); // Sat → Mon
  assertEquals(nextBusinessDay("2026-09-27"), "2026-09-28"); // Sun → Mon
  assertEquals(nextBusinessDay("2026-09-28"), "2026-09-28"); // Mon
  assertEquals(nextBusinessDay("2026-10-02"), "2026-10-02"); // Fri
});

// ─── projectTransferDate ────────────────────────────────────────────────────

Deno.test("projectTransferDate: daily → same day, weekend → next business day", () => {
  assertEquals(
    projectTransferDate("2026-09-30", { transfer_enabled: true, transfer_interval: "daily", transfer_day: null }),
    { deposit_on: "2026-09-30", manual_withdrawal: false },
  );
  assertEquals(
    projectTransferDate("2026-09-26", { transfer_enabled: true, transfer_interval: "daily", transfer_day: null }),
    { deposit_on: "2026-09-28", manual_withdrawal: false },
  );
});

Deno.test("projectTransferDate: weekly → next transfer_day (1=Mon..5=Fri) on or after", () => {
  const wk = { transfer_enabled: true, transfer_interval: "weekly", transfer_day: 3 }; // Wed
  assertEquals(projectTransferDate("2026-09-28", wk).deposit_on, "2026-09-30"); // Mon → Wed
  assertEquals(projectTransferDate("2026-09-30", wk).deposit_on, "2026-09-30"); // Wed → same
  assertEquals(projectTransferDate("2026-10-01", wk).deposit_on, "2026-10-07"); // Thu → next Wed
});

Deno.test("projectTransferDate: monthly → next transfer_day on or after, clamped to month length", () => {
  const m15 = { transfer_enabled: true, transfer_interval: "monthly", transfer_day: 15 };
  assertEquals(projectTransferDate("2026-09-10", m15).deposit_on, "2026-09-15");
  assertEquals(projectTransferDate("2026-09-15", m15).deposit_on, "2026-09-15");
  assertEquals(projectTransferDate("2026-09-16", m15).deposit_on, "2026-10-15");
  const m31 = { transfer_enabled: true, transfer_interval: "monthly", transfer_day: 31 };
  assertEquals(projectTransferDate("2026-02-10", m31).deposit_on, "2026-03-02"); // clamp to 28 (Sat) then roll to Mon
  assertEquals(projectTransferDate("2026-04-10", m31).deposit_on, "2026-04-30"); // clamp, 30 is a Thu
});

Deno.test("projectTransferDate: monthly lands on weekend → next business day", () => {
  const m26 = { transfer_enabled: true, transfer_interval: "monthly", transfer_day: 26 };
  assertEquals(projectTransferDate("2026-09-20", m26).deposit_on, "2026-09-28"); // 26 is Sat
});

Deno.test("projectTransferDate: transfer disabled or null settings → manual_withdrawal, deposit_on = available day", () => {
  assertEquals(
    projectTransferDate("2026-09-30", { transfer_enabled: false, transfer_interval: "daily", transfer_day: null }),
    { deposit_on: "2026-09-30", manual_withdrawal: true },
  );
  assertEquals(projectTransferDate("2026-09-30", null), { deposit_on: "2026-09-30", manual_withdrawal: true });
});

Deno.test("projectTransferDate: unknown interval behaves like daily", () => {
  assertEquals(
    projectTransferDate("2026-09-30", { transfer_enabled: true, transfer_interval: "biweekly", transfer_day: null }).deposit_on,
    "2026-09-30",
  );
});

// ─── Stripe schedule ────────────────────────────────────────────────────────

Deno.test("stripeScheduleToTransferSettings: daily / null / unknown → daily enabled", () => {
  assertEquals(stripeScheduleToTransferSettings({ interval: "daily", delay_days: 30 }), {
    transfer_enabled: true, transfer_interval: "daily", transfer_day: null,
  });
  assertEquals(stripeScheduleToTransferSettings(null).transfer_interval, "daily");
  assertEquals(stripeScheduleToTransferSettings({ interval: "fortnightly" }).transfer_interval, "daily");
});

Deno.test("stripeScheduleToTransferSettings: weekly anchor name → 1..5, monthly anchor → day, manual → disabled", () => {
  assertEquals(stripeScheduleToTransferSettings({ interval: "weekly", weekly_anchor: "wednesday" }), {
    transfer_enabled: true, transfer_interval: "weekly", transfer_day: 3,
  });
  assertEquals(stripeScheduleToTransferSettings({ interval: "weekly", weekly_anchor: "sunday" }).transfer_day, 1); // clamped into Mon..Fri
  assertEquals(stripeScheduleToTransferSettings({ interval: "monthly", monthly_anchor: 15 }), {
    transfer_enabled: true, transfer_interval: "monthly", transfer_day: 15,
  });
  assertEquals(stripeScheduleToTransferSettings({ interval: "manual" }).transfer_enabled, false);
});

Deno.test("projectStripeArrival: daily → next business day; weekly/monthly follow the schedule; manual → manual_withdrawal", () => {
  assertEquals(projectStripeArrival("2026-09-26", { interval: "daily" }), { deposit_on: "2026-09-28", manual_withdrawal: false });
  assertEquals(projectStripeArrival("2026-09-29", null), { deposit_on: "2026-09-29", manual_withdrawal: false });
  assertEquals(projectStripeArrival("2026-09-28", { interval: "weekly", weekly_anchor: "friday" }).deposit_on, "2026-10-02");
  assertEquals(projectStripeArrival("2026-09-16", { interval: "monthly", monthly_anchor: 15 }).deposit_on, "2026-10-15");
  assertEquals(projectStripeArrival("2026-09-29", { interval: "manual" }), { deposit_on: "2026-09-29", manual_withdrawal: true });
});

// ─── groupByDay ─────────────────────────────────────────────────────────────

Deno.test("groupByDay: sums net/gross/fee and counts per day, insertion order preserved", () => {
  const g = groupByDay([
    { date: "2026-10-01", net_cents: 100, gross_cents: 110, fee_cents: 10 },
    { date: "2026-10-02", net_cents: 50, gross_cents: 55, fee_cents: 5 },
    { date: "2026-10-01", net_cents: 200, gross_cents: 220, fee_cents: 20 },
  ]);
  assertEquals([...g.keys()], ["2026-10-01", "2026-10-02"]);
  assertEquals(g.get("2026-10-01"), { net_cents: 300, gross_cents: 330, fee_cents: 30, count: 2 });
  assertEquals(g.get("2026-10-02"), { net_cents: 50, gross_cents: 55, fee_cents: 5, count: 1 });
});

// ─── splitHorizon ───────────────────────────────────────────────────────────

function row(date: string, net = 100, deposit_on = date): DayRow {
  return { date, deposit_on, net_cents: net, gross_cents: net + 10, fee_cents: 10, count: 1, kind: "projected" };
}

Deno.test("splitHorizon: deposit_on within [today, today+30) is day-level, the rest is monthly, both sorted", () => {
  const today = "2026-09-24";
  const out = splitHorizon(
    [row("2026-11-03"), row("2026-10-23"), row("2026-09-24"), row("2026-10-24"), row("2026-11-20"), row("2026-09-30")],
    today,
  );
  assertEquals(out.next30.map((r) => r.deposit_on), ["2026-09-24", "2026-09-30", "2026-10-23"]);
  assertEquals(out.byMonth, [
    { month: "2026-10", net_cents: 100, gross_cents: 110, fee_cents: 10, count: 1 },
    { month: "2026-11", net_cents: 200, gross_cents: 220, fee_cents: 20, count: 2 },
  ]);
});

Deno.test("splitHorizon: rows before today are dropped (overdue payouts are not upcoming)", () => {
  const out = splitHorizon([row("2026-09-01"), row("2026-09-24")], "2026-09-24");
  assertEquals(out.next30.length, 1);
  assertEquals(out.byMonth, []);
});

Deno.test("splitHorizon: day 30 exactly goes to byMonth", () => {
  const out = splitHorizon([row("2026-10-24")], "2026-09-24");
  assertEquals(out.next30, []);
  assertEquals(out.byMonth.length, 1);
});

// ─── summarize ──────────────────────────────────────────────────────────────

function provider(over: Partial<ProviderDeposits>): ProviderDeposits {
  return { ...unavailable(), ok: true, error: undefined, ...over };
}

Deno.test("summarize: earliest deposit_on across providers wins; totals sum next30 and everything", () => {
  const stripe = provider({
    upcoming: { next30: [row("2026-09-26", 300, "2026-09-28")], byMonth: [{ month: "2026-11", net_cents: 1000, gross_cents: 1100, fee_cents: 100, count: 2 }] },
  });
  const pagarme = provider({
    upcoming: { next30: [row("2026-09-25", 150)], byMonth: [] },
  });
  assertEquals(summarize({ stripe, pagarme }), {
    next: { date: "2026-09-25", amount_cents: 150, provider: "pagarme" },
    next_30d_cents: 450,
    waiting_cents: 1450,
    partial: false,
  });
});

Deno.test("summarize: a failed provider contributes nothing and marks the summary partial", () => {
  const pagarme = provider({ upcoming: { next30: [row("2026-09-25", 150)], byMonth: [] } });
  assertEquals(summarize({ stripe: unavailable(), pagarme }), {
    next: { date: "2026-09-25", amount_cents: 150, provider: "pagarme" },
    next_30d_cents: 150,
    waiting_cents: 150,
    partial: true,
  });
});

Deno.test("summarize: an unconfigured provider is not 'partial'; no rows → next null", () => {
  assertEquals(summarize({ stripe: provider({}), pagarme: notConfigured() }), {
    next: null,
    next_30d_cents: 0,
    waiting_cents: 0,
    partial: false,
  });
});

Deno.test("unavailable / notConfigured shapes", () => {
  assertEquals(unavailable().ok, false);
  assertEquals(unavailable().configured, true);
  assertEquals(unavailable().error, "unavailable");
  assertEquals(unavailable().truncated, false);
  assertEquals(notConfigured().configured, false);
  assertEquals(notConfigured().error, undefined);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/platform-admin-deposits-logic_test.ts`
Expected: FAIL with module not found `../platform-admin/deposits-logic.ts`.

- [ ] **Step 3: Implement `deposits-logic.ts`**

```ts
// supabase/functions/platform-admin/deposits-logic.ts
// Pure view-model for the admin Depósitos panel. No env, network or Supabase access here, in the
// same discipline as pagarme-detail.ts, so every projection rule is unit-testable in isolation.
// The gateways and the handler live in deposits.ts.
//
// Spec: docs/superpowers/specs/2026-09-24-admin-depositos-design.md §1.

export type Provider = "stripe" | "pagarme";

export interface DayRow {
  /** Day the funds become available at the provider (YYYY-MM-DD, UTC date part). */
  date: string;
  /** Projected day the money reaches the bank account. */
  deposit_on: string;
  net_cents: number;
  gross_cents: number;
  fee_cents: number;
  count: number;
  /** 'payout' = the provider already created the payout; 'projected' = derived from pending funds. */
  kind: "payout" | "projected";
  /** Pagar.me only: automatic transfer disabled, the money waits for a manual withdrawal. */
  manual_withdrawal?: boolean;
}

export interface MonthRow {
  /** YYYY-MM */
  month: string;
  net_cents: number;
  gross_cents: number;
  fee_cents: number;
  count: number;
}

export interface ProviderDeposits {
  configured: boolean;
  ok: boolean;
  error?: "unavailable";
  /** Pagination hit its cap: `upcoming` is incomplete. */
  truncated: boolean;
  balance: { available_cents: number; pending_cents: number; currency: "brl" } | null;
  /** Provider-specific display facts (Stripe schedule, Pagar.me transfer settings). */
  meta: Record<string, string | number | boolean | null>;
  upcoming: { next30: DayRow[]; byMonth: MonthRow[] };
  in_transit: { id: string; amount_cents: number; expected_on: string | null; status: string }[];
  recent: { id: string; date: string; amount_cents: number; status: string }[];
}

export interface DepositsSummary {
  next: { date: string; amount_cents: number; provider: Provider } | null;
  next_30d_cents: number;
  waiting_cents: number;
  /** A configured provider failed: the totals only cover the one that answered. */
  partial: boolean;
}

export interface TransferSettings {
  transfer_enabled: boolean;
  transfer_interval: "daily" | "weekly" | "monthly" | string;
  transfer_day: number | null;
}

/** `account.settings.payouts.schedule` as Stripe returns it. */
export interface StripeSchedule {
  interval?: string | null;
  delay_days?: number | null;
  /** 'monday' … 'sunday' */
  weekly_anchor?: string | null;
  /** 1 … 31 */
  monthly_anchor?: number | null;
}

// ─── dates ──────────────────────────────────────────────────────────────────

/** ISO string or unix seconds → YYYY-MM-DD (UTC date part). Pagar.me stamps payment_date at
 *  03:00Z (midnight in São Paulo) and Stripe's available_on is midnight UTC, so the UTC date is the
 *  business date for both. */
export function toDay(value: string | number | null | undefined): string | null {
  if (value == null || value === "") return null;
  const ms = typeof value === "number" ? value * 1000 : new Date(value).getTime();
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

function parseDay(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

function formatDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  const d = parseDay(day);
  d.setUTCDate(d.getUTCDate() + n);
  return formatDay(d);
}

/** 0 = Sunday … 6 = Saturday, in UTC (day strings carry no time). */
function weekday(day: string): number {
  return parseDay(day).getUTCDay();
}

export function nextBusinessDay(day: string): string {
  const wd = weekday(day);
  if (wd === 6) return addDays(day, 2);
  if (wd === 0) return addDays(day, 1);
  return day;
}

function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

/** Bank arrival for a Pagar.me payable that becomes available on `availableOn`, given the
 *  recipient's automatic transfer settings. Weekly transfer_day is 1 (Mon) … 5 (Fri); monthly
 *  transfer_day is 1 … 31 and is clamped to the month's length. Anything landing on a weekend
 *  rolls to Monday. Transfers disabled (or settings unknown) means the money only becomes
 *  available: the row is flagged manual_withdrawal and deposit_on stays the available day. */
export function projectTransferDate(
  availableOn: string,
  settings: TransferSettings | null,
): { deposit_on: string; manual_withdrawal: boolean } {
  if (!settings || !settings.transfer_enabled) {
    return { deposit_on: availableOn, manual_withdrawal: true };
  }
  if (settings.transfer_interval === "weekly" && settings.transfer_day != null) {
    const target = Math.min(Math.max(settings.transfer_day, 1), 5);
    const wd = weekday(availableOn); // 0..6
    const delta = (target - wd + 7) % 7;
    return { deposit_on: nextBusinessDay(addDays(availableOn, delta)), manual_withdrawal: false };
  }
  if (settings.transfer_interval === "monthly" && settings.transfer_day != null) {
    const d = parseDay(availableOn);
    let year = d.getUTCFullYear();
    let month = d.getUTCMonth();
    let target = Math.min(Math.max(settings.transfer_day, 1), daysInMonth(year, month));
    if (target < d.getUTCDate()) {
      month += 1;
      if (month > 11) {
        month = 0;
        year += 1;
      }
      target = Math.min(Math.max(settings.transfer_day, 1), daysInMonth(year, month));
    }
    const day = formatDay(new Date(Date.UTC(year, month, target)));
    return { deposit_on: nextBusinessDay(day), manual_withdrawal: false };
  }
  // daily, or an interval we do not know: the provider pays as soon as the funds are available.
  return { deposit_on: nextBusinessDay(availableOn), manual_withdrawal: false };
}

const STRIPE_WEEKDAY: Record<string, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 5, // Stripe never pays on weekends; clamp into the business week
  sunday: 1,
};

/** Maps Stripe's payout schedule onto the same TransferSettings shape Pagar.me uses, so one
 *  projection rule serves both. Brazil accounts are always daily automatic (Stripe docs), but the
 *  schedule is applied, not assumed: a weekly/monthly/manual account still projects correctly. */
export function stripeScheduleToTransferSettings(schedule: StripeSchedule | null): TransferSettings {
  const interval = schedule?.interval ?? "daily";
  if (interval === "manual") {
    return { transfer_enabled: false, transfer_interval: "manual", transfer_day: null };
  }
  if (interval === "weekly") {
    const anchor = (schedule?.weekly_anchor ?? "").toLowerCase();
    return { transfer_enabled: true, transfer_interval: "weekly", transfer_day: STRIPE_WEEKDAY[anchor] ?? 1 };
  }
  if (interval === "monthly") {
    const day = typeof schedule?.monthly_anchor === "number" ? schedule.monthly_anchor : 1;
    return { transfer_enabled: true, transfer_interval: "monthly", transfer_day: day };
  }
  return { transfer_enabled: true, transfer_interval: "daily", transfer_day: null };
}

/** Bank arrival for Stripe pending funds available on `availableOn`, under the account's schedule. */
export function projectStripeArrival(
  availableOn: string,
  schedule: StripeSchedule | null,
): { deposit_on: string; manual_withdrawal: boolean } {
  return projectTransferDate(availableOn, stripeScheduleToTransferSettings(schedule));
}

// ─── grouping / horizon / summary ───────────────────────────────────────────

export interface DayTotals {
  net_cents: number;
  gross_cents: number;
  fee_cents: number;
  count: number;
}

export function groupByDay(
  items: { date: string; net_cents: number; gross_cents: number; fee_cents: number }[],
): Map<string, DayTotals> {
  const out = new Map<string, DayTotals>();
  for (const it of items) {
    const cur = out.get(it.date) ?? { net_cents: 0, gross_cents: 0, fee_cents: 0, count: 0 };
    cur.net_cents += it.net_cents;
    cur.gross_cents += it.gross_cents;
    cur.fee_cents += it.fee_cents;
    cur.count += 1;
    out.set(it.date, cur);
  }
  return out;
}

export const HORIZON_DAYS = 30;

/** Rows whose deposit_on falls in [today, today+30) stay day-level; later rows collapse into one
 *  row per month. Rows before today are dropped: an overdue payout is not "upcoming". */
export function splitHorizon(rows: DayRow[], today: string): { next30: DayRow[]; byMonth: MonthRow[] } {
  const limit = addDays(today, HORIZON_DAYS);
  const next30 = rows
    .filter((r) => r.deposit_on >= today && r.deposit_on < limit)
    .sort((a, b) => a.deposit_on.localeCompare(b.deposit_on));
  const months = new Map<string, MonthRow>();
  for (const r of rows) {
    if (r.deposit_on < limit) continue;
    const month = r.deposit_on.slice(0, 7);
    const cur = months.get(month) ?? { month, net_cents: 0, gross_cents: 0, fee_cents: 0, count: 0 };
    cur.net_cents += r.net_cents;
    cur.gross_cents += r.gross_cents;
    cur.fee_cents += r.fee_cents;
    cur.count += r.count;
    months.set(month, cur);
  }
  const byMonth = [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
  return { next30, byMonth };
}

export function summarize(providers: Record<Provider, ProviderDeposits>): DepositsSummary {
  let next: DepositsSummary["next"] = null;
  let next_30d_cents = 0;
  let waiting_cents = 0;
  let partial = false;
  for (const provider of Object.keys(providers) as Provider[]) {
    const p = providers[provider];
    if (p.configured && !p.ok) partial = true;
    if (!p.ok) continue;
    for (const r of p.upcoming.next30) {
      next_30d_cents += r.net_cents;
      waiting_cents += r.net_cents;
      if (!next || r.deposit_on < next.date) {
        next = { date: r.deposit_on, amount_cents: r.net_cents, provider };
      }
    }
    for (const m of p.upcoming.byMonth) waiting_cents += m.net_cents;
  }
  return { next, next_30d_cents, waiting_cents, partial };
}

function emptyProvider(): ProviderDeposits {
  return {
    configured: true,
    ok: true,
    truncated: false,
    balance: null,
    meta: {},
    upcoming: { next30: [], byMonth: [] },
    in_transit: [],
    recent: [],
  };
}

/** The provider is set up but the live read failed. The client shows a retryable error state. */
export function unavailable(): ProviderDeposits {
  return { ...emptyProvider(), ok: false, error: "unavailable" };
}

/** The provider has no credentials in this environment. The client shows a "não configurado" state. */
export function notConfigured(): ProviderDeposits {
  return { ...emptyProvider(), configured: false, ok: false };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/platform-admin-deposits-logic_test.ts`
Expected: all PASS.

Note on `notConfigured().ok`: the test only asserts `configured` and `error`. `ok: false` is intentional so `summarize` skips it.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/platform-admin/deposits-logic.ts supabase/functions/__tests__/platform-admin-deposits-logic_test.ts
git commit -m "feat(platform-admin): lógica pura do painel de Depósitos (datas, projeção, horizonte, resumo)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Pure builders: raw Stripe / Pagar.me payloads → `ProviderDeposits`

**Files:**
- Modify: `supabase/functions/platform-admin/deposits-logic.ts` (append)
- Test: `supabase/functions/__tests__/platform-admin-deposits-logic_test.ts` (append)

**Interfaces:**
- Consumes: everything from Task 1.
- Produces (used by Task 3):

```ts
export interface StripeRaw {
  balance: { available: { amount: number; currency: string }[]; pending: { amount: number; currency: string }[] };
  payouts: { id: string; amount: number; arrival_date: number; status: string; currency: string }[];
  pendingTransactions: { id: string; net: number; amount: number; fee: number; available_on: number; status: string; currency: string; type: string }[];
  schedule: StripeSchedule | null;
  truncated: boolean;   // the pending-transactions pagination hit its cap
}
export function buildStripeDeposits(raw: StripeRaw, today: string): ProviderDeposits

export interface PagarmeRaw {
  balance: unknown;   // accepts { available_amount, waiting_funds_amount, transferred_amount } OR { available: { amount }, waiting_funds: { amount }, transferred: { amount } }
  payables: { id: number | string; status: string; amount: number; fee?: number | null; anticipation_fee?: number | null; payment_date: string; type?: string | null }[];
  recipient: { transfer_settings?: { transfer_enabled?: boolean | null; transfer_interval?: string | null; transfer_day?: number | null } | null; automatic_anticipation_settings?: { enabled?: boolean | null; type?: string | null; volume_percentage?: number | null; delay?: number | null } | null } | null;
  transfers: { id: string; amount: number; status: string; funding_estimated_date?: string | null; funding_date?: string | null; created_at?: string | null; date_created?: string | null }[];
  truncated: boolean;   // the payables pagination hit its cap
}
export function buildPagarmeDeposits(raw: PagarmeRaw, today: string): ProviderDeposits
export function parsePagarmeBalance(raw: unknown): { available_cents: number; pending_cents: number; currency: "brl" } | null
```

- [ ] **Step 1: Write the failing tests (append to the logic test file)**

```ts
import {
  buildPagarmeDeposits,
  buildStripeDeposits,
  parsePagarmeBalance,
  type PagarmeRaw,
  type StripeRaw,
} from "../platform-admin/deposits-logic.ts";

// ─── buildStripeDeposits ────────────────────────────────────────────────────

const TODAY = "2026-09-24";
const ts = (day: string) => Math.floor(new Date(`${day}T00:00:00Z`).getTime() / 1000);

function stripeRaw(over: Partial<StripeRaw> = {}): StripeRaw {
  return {
    balance: {
      available: [{ amount: 12345, currency: "brl" }, { amount: 99, currency: "usd" }],
      pending: [{ amount: 50000, currency: "brl" }],
    },
    payouts: [
      { id: "po_1", amount: 20000, arrival_date: ts("2026-09-25"), status: "pending", currency: "brl" },
      { id: "po_2", amount: 18000, arrival_date: ts("2026-09-23"), status: "paid", currency: "brl" },
      { id: "po_3", amount: 500, arrival_date: ts("2026-09-22"), status: "failed", currency: "brl" },
      { id: "po_usd", amount: 100, arrival_date: ts("2026-09-25"), status: "pending", currency: "usd" },
    ],
    pendingTransactions: [
      { id: "txn_1", net: 9700, amount: 10000, fee: 300, available_on: ts("2026-09-26"), status: "pending", currency: "brl", type: "charge" }, // Sat → Mon 28
      { id: "txn_2", net: 4850, amount: 5000, fee: 150, available_on: ts("2026-09-28"), status: "pending", currency: "brl", type: "charge" },
      { id: "txn_3", net: 97000, amount: 100000, fee: 3000, available_on: ts("2026-11-05"), status: "pending", currency: "brl", type: "charge" },
      { id: "txn_4", net: -2000, amount: -2000, fee: 0, available_on: ts("2026-09-28"), status: "pending", currency: "brl", type: "refund" },
      { id: "txn_5", net: 1, amount: 1, fee: 0, available_on: ts("2026-09-28"), status: "available", currency: "brl", type: "charge" }, // not pending: ignored
      // The payout po_1 itself shows up as a pending balance transaction with negative net on its
      // arrival day. It must NOT become a projected row, or it cancels the kind=payout row.
      { id: "txn_po", net: -20000, amount: -20000, fee: 0, available_on: ts("2026-09-25"), status: "pending", currency: "brl", type: "payout" },
    ],
    schedule: { interval: "daily", delay_days: 30 },
    truncated: false,
    ...over,
  };
}

Deno.test("buildStripeDeposits: picks the brl balance entries; truncated propagates", () => {
  const out = buildStripeDeposits(stripeRaw(), TODAY);
  assertEquals(out.configured, true);
  assertEquals(out.ok, true);
  assertEquals(out.truncated, false);
  assertEquals(out.balance, { available_cents: 12345, pending_cents: 50000, currency: "brl" });
  assertEquals(out.meta, { schedule_interval: "daily", delay_days: 30 });
  assertEquals(buildStripeDeposits(stripeRaw({ truncated: true }), TODAY).truncated, true);
});

Deno.test("buildStripeDeposits: a weekly schedule moves projected rows to the anchor day", () => {
  const out = buildStripeDeposits(stripeRaw({ schedule: { interval: "weekly", weekly_anchor: "friday" } }), TODAY);
  const projected = out.upcoming.next30.filter((r) => r.kind === "projected");
  // 26 (Sat) → next Fri 02/10; 28 (Mon) → Fri 02/10
  assertEquals(projected.map((r) => r.deposit_on), ["2026-10-02", "2026-10-02"]);
  assertEquals(out.meta.schedule_interval, "weekly");
});

Deno.test("buildStripeDeposits: manual schedule flags projected rows as manual_withdrawal", () => {
  const out = buildStripeDeposits(stripeRaw({ schedule: { interval: "manual" } }), TODAY);
  const projected = out.upcoming.next30.filter((r) => r.kind === "projected");
  assertEquals(projected.every((r) => r.manual_withdrawal === true), true);
});

Deno.test("buildStripeDeposits: pending payouts are kind=payout grouped by arrival_date; paid/failed go to recent; other currencies dropped", () => {
  const out = buildStripeDeposits(stripeRaw(), TODAY);
  const payoutRows = out.upcoming.next30.filter((r) => r.kind === "payout");
  assertEquals(payoutRows, [
    { date: "2026-09-25", deposit_on: "2026-09-25", net_cents: 20000, gross_cents: 20000, fee_cents: 0, count: 1, kind: "payout" },
  ]);
  const two = buildStripeDeposits(
    stripeRaw({
      payouts: [
        { id: "po_a", amount: 100, arrival_date: ts("2026-09-25"), status: "pending", currency: "brl" },
        { id: "po_b", amount: 200, arrival_date: ts("2026-09-25"), status: "in_transit", currency: "brl" },
      ],
      pendingTransactions: [],
    }),
    TODAY,
  );
  assertEquals(two.upcoming.next30, [
    { date: "2026-09-25", deposit_on: "2026-09-25", net_cents: 300, gross_cents: 300, fee_cents: 0, count: 2, kind: "payout" },
  ]);
  assertEquals(out.recent, [
    { id: "po_2", date: "2026-09-23", amount_cents: 18000, status: "paid" },
    { id: "po_3", date: "2026-09-22", amount_cents: 500, status: "failed" },
  ]);
});

Deno.test("buildStripeDeposits: pending transactions grouped by available_on (net), weekend rolls to Monday, refunds subtract, non-pending and payout-type ignored", () => {
  const out = buildStripeDeposits(stripeRaw(), TODAY);
  const projected = out.upcoming.next30.filter((r) => r.kind === "projected");
  assertEquals(projected.some((r) => r.date === "2026-09-25"), false); // txn_po excluded
  // 26 (Sat) → deposit_on 28; 28 (Mon) → 28. Both keyed by their own `date`, both deposit on the 28th.
  assertEquals(projected, [
    { date: "2026-09-26", deposit_on: "2026-09-28", net_cents: 9700, gross_cents: 10000, fee_cents: 300, count: 1, kind: "projected", manual_withdrawal: false },
    { date: "2026-09-28", deposit_on: "2026-09-28", net_cents: 2850, gross_cents: 3000, fee_cents: 150, count: 2, kind: "projected", manual_withdrawal: false },
  ]);
  assertEquals(out.upcoming.byMonth, [{ month: "2026-11", net_cents: 97000, gross_cents: 100000, fee_cents: 3000, count: 1 }]);
});

Deno.test("buildStripeDeposits: next30 is sorted by deposit_on then date", () => {
  const out = buildStripeDeposits(stripeRaw(), TODAY);
  assertEquals(out.upcoming.next30.map((r) => `${r.deposit_on}/${r.kind}`), [
    "2026-09-25/payout",
    "2026-09-28/projected",
    "2026-09-28/projected",
  ]);
});

Deno.test("buildStripeDeposits: no brl balance → balance null; null schedule → meta nulls", () => {
  const out = buildStripeDeposits(stripeRaw({ balance: { available: [], pending: [] }, schedule: null }), TODAY);
  assertEquals(out.balance, null);
  assertEquals(out.meta, { schedule_interval: null, delay_days: null });
});

// ─── parsePagarmeBalance ────────────────────────────────────────────────────

Deno.test("parsePagarmeBalance: flat *_amount shape", () => {
  assertEquals(
    parsePagarmeBalance({ available_amount: 1000, waiting_funds_amount: 2500, transferred_amount: 9 }),
    { available_cents: 1000, pending_cents: 2500, currency: "brl" },
  );
});

Deno.test("parsePagarmeBalance: nested v4-style shape", () => {
  assertEquals(
    parsePagarmeBalance({ available: { amount: 1000 }, waiting_funds: { amount: 2500 } }),
    { available_cents: 1000, pending_cents: 2500, currency: "brl" },
  );
});

Deno.test("parsePagarmeBalance: unknown shape → null", () => {
  assertEquals(parsePagarmeBalance(null), null);
  assertEquals(parsePagarmeBalance({ foo: 1 }), null);
});

// ─── buildPagarmeDeposits ───────────────────────────────────────────────────

function pagarmeRaw(over: Partial<PagarmeRaw> = {}): PagarmeRaw {
  return {
    balance: { available_amount: 700, waiting_funds_amount: 60000, transferred_amount: 0 },
    payables: [
      { id: 1, status: "waiting_funds", amount: 3090, fee: 155, anticipation_fee: 0, payment_date: "2026-09-30T03:00:00Z", type: "credit" },
      { id: 2, status: "waiting_funds", amount: 3090, fee: 155, anticipation_fee: 10, payment_date: "2026-09-30T03:00:00Z", type: "credit" },
      { id: 3, status: "waiting_funds", amount: 3090, fee: 155, anticipation_fee: 0, payment_date: "2026-10-30T03:00:00Z", type: "credit" },
      { id: 4, status: "waiting_funds", amount: 3090, fee: 155, anticipation_fee: 0, payment_date: "2026-11-30T03:00:00Z", type: "credit" },
      { id: 5, status: "paid", amount: 3090, fee: 155, anticipation_fee: 0, payment_date: "2026-08-30T03:00:00Z", type: "credit" }, // ignored
      { id: 6, status: "waiting_funds", amount: -500, fee: 0, anticipation_fee: 0, payment_date: "2026-09-30T03:00:00Z", type: "refund" }, // subtracts
    ],
    recipient: {
      transfer_settings: { transfer_enabled: true, transfer_interval: "daily", transfer_day: null },
      automatic_anticipation_settings: { enabled: false, type: "full", volume_percentage: 50, delay: null },
    },
    transfers: [
      { id: "tr_1", amount: 4000, status: "processing", funding_estimated_date: "2026-09-25T03:00:00Z", created_at: "2026-09-24T12:00:00Z" },
    ],
    truncated: false,
    ...over,
  };
}

Deno.test("buildPagarmeDeposits: waiting_funds payables grouped by payment_date with net = amount - fee - anticipation_fee", () => {
  const out = buildPagarmeDeposits(pagarmeRaw(), TODAY);
  assertEquals(out.configured, true);
  assertEquals(out.ok, true);
  assertEquals(out.truncated, false);
  assertEquals(buildPagarmeDeposits(pagarmeRaw({ truncated: true }), TODAY).truncated, true);
  assertEquals(out.balance, { available_cents: 700, pending_cents: 60000, currency: "brl" });
  // 30/09 (Wed): 2935 + 2925 - 500 = 5360 net; gross 3090+3090-500 = 5680; fee 155+155+10 = 320
  assertEquals(out.upcoming.next30, [
    { date: "2026-09-30", deposit_on: "2026-09-30", net_cents: 5360, gross_cents: 5680, fee_cents: 320, count: 3, kind: "projected", manual_withdrawal: false },
  ]);
  assertEquals(out.upcoming.byMonth, [
    { month: "2026-10", net_cents: 2935, gross_cents: 3090, fee_cents: 155, count: 1 },
    { month: "2026-11", net_cents: 2935, gross_cents: 3090, fee_cents: 155, count: 1 },
  ]);
});

Deno.test("buildPagarmeDeposits: meta carries transfer settings and anticipation", () => {
  const out = buildPagarmeDeposits(pagarmeRaw(), TODAY);
  assertEquals(out.meta, {
    transfer_enabled: true,
    transfer_interval: "daily",
    transfer_day: null,
    anticipation_enabled: false,
    anticipation_type: "full",
  });
});

Deno.test("buildPagarmeDeposits: monthly transfer settings shift deposit_on; transfers in flight mapped", () => {
  const out = buildPagarmeDeposits(
    pagarmeRaw({
      recipient: { transfer_settings: { transfer_enabled: true, transfer_interval: "monthly", transfer_day: 5 }, automatic_anticipation_settings: null },
    }),
    TODAY,
  );
  // 30/09 → next 5th = 05/10 (Mon)
  assertEquals(out.upcoming.next30.map((r) => r.deposit_on), ["2026-10-05"]);
  assertEquals(out.in_transit, [{ id: "tr_1", amount_cents: 4000, expected_on: "2026-09-25", status: "processing" }]);
  assertEquals(out.meta.anticipation_enabled, null);
});

Deno.test("buildPagarmeDeposits: transfers disabled → manual_withdrawal rows", () => {
  const out = buildPagarmeDeposits(
    pagarmeRaw({ recipient: { transfer_settings: { transfer_enabled: false, transfer_interval: "daily", transfer_day: null } } }),
    TODAY,
  );
  assertEquals(out.upcoming.next30[0].manual_withdrawal, true);
});

Deno.test("buildPagarmeDeposits: payables with an unparsable payment_date are skipped, not thrown", () => {
  const out = buildPagarmeDeposits(
    pagarmeRaw({ payables: [{ id: 9, status: "waiting_funds", amount: 100, fee: 0, payment_date: "nope" }] }),
    TODAY,
  );
  assertEquals(out.upcoming.next30, []);
  assertEquals(out.upcoming.byMonth, []);
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/platform-admin-deposits-logic_test.ts`
Expected: the new tests FAIL (`buildStripeDeposits is not a function` or missing export).

- [ ] **Step 3: Append the builders to `deposits-logic.ts`**

```ts
// ─── raw provider shapes (only the fields we read) ──────────────────────────

export interface StripeRaw {
  balance: {
    available: { amount: number; currency: string }[];
    pending: { amount: number; currency: string }[];
  };
  payouts: { id: string; amount: number; arrival_date: number; status: string; currency: string }[];
  /** Balance transactions with status 'pending' (the fetch may over-deliver; we filter again). */
  pendingTransactions: {
    id: string;
    net: number;
    amount: number;
    fee: number;
    available_on: number;
    status: string;
    currency: string;
    type: string;
  }[];
  schedule: StripeSchedule | null;
  /** The pending-transactions pagination hit its cap: rows are incomplete. */
  truncated: boolean;
}

const UPCOMING_PAYOUT_STATUSES = new Set(["pending", "in_transit"]);
const RECENT_PAYOUT_STATUSES = new Set(["paid", "failed", "canceled"]);
/** A created payout is itself a pending balance transaction (negative net, available_on =
 *  arrival_date). It is already represented by the kind=payout row from payouts.list, so it must
 *  not also become a projected row that cancels it out. */
const PAYOUT_TXN_TYPES = new Set(["payout", "payout_cancel", "payout_failure"]);

function pickBrlAmount(entries: { amount: number; currency: string }[]): number | null {
  const hit = entries.find((e) => e.currency?.toLowerCase() === "brl");
  return hit ? hit.amount : null;
}

function sortDayRows(rows: DayRow[]): DayRow[] {
  return rows.sort((a, b) =>
    a.deposit_on.localeCompare(b.deposit_on) || a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind)
  );
}

export function buildStripeDeposits(raw: StripeRaw, today: string): ProviderDeposits {
  const available = pickBrlAmount(raw.balance.available ?? []);
  const pending = pickBrlAmount(raw.balance.pending ?? []);
  const balance = available == null && pending == null
    ? null
    : { available_cents: available ?? 0, pending_cents: pending ?? 0, currency: "brl" as const };

  const rows: DayRow[] = [];
  const recent: ProviderDeposits["recent"] = [];
  const payoutItems: { date: string; net_cents: number; gross_cents: number; fee_cents: number }[] = [];
  for (const p of raw.payouts ?? []) {
    if (p.currency?.toLowerCase() !== "brl") continue;
    const day = toDay(p.arrival_date);
    if (!day) continue;
    if (UPCOMING_PAYOUT_STATUSES.has(p.status)) {
      payoutItems.push({ date: day, net_cents: p.amount, gross_cents: p.amount, fee_cents: 0 });
    } else if (RECENT_PAYOUT_STATUSES.has(p.status)) {
      recent.push({ id: p.id, date: day, amount_cents: p.amount, status: p.status });
    }
  }
  for (const [date, tot] of groupByDay(payoutItems)) {
    rows.push({ date, deposit_on: date, ...tot, kind: "payout" });
  }

  const pendingItems: { date: string; net_cents: number; gross_cents: number; fee_cents: number }[] = [];
  for (const t of raw.pendingTransactions ?? []) {
    if (t.status !== "pending") continue;
    if (t.currency?.toLowerCase() !== "brl") continue;
    if (PAYOUT_TXN_TYPES.has(t.type)) continue;
    const day = toDay(t.available_on);
    if (!day) continue;
    pendingItems.push({ date: day, net_cents: t.net, gross_cents: t.amount, fee_cents: t.fee });
  }
  for (const [date, tot] of groupByDay(pendingItems)) {
    const proj = projectStripeArrival(date, raw.schedule);
    rows.push({
      date,
      deposit_on: proj.deposit_on,
      ...tot,
      kind: "projected",
      manual_withdrawal: proj.manual_withdrawal,
    });
  }

  const split = splitHorizon(rows, today);
  return {
    configured: true,
    ok: true,
    truncated: raw.truncated === true,
    balance,
    meta: {
      schedule_interval: raw.schedule?.interval ?? null,
      delay_days: raw.schedule?.delay_days ?? null,
    },
    upcoming: { next30: sortDayRows(split.next30), byMonth: split.byMonth },
    in_transit: [],
    recent: recent.sort((a, b) => b.date.localeCompare(a.date)),
  };
}

export interface PagarmeRaw {
  /** GET /recipients/{id}/balance. Shape not validated in this repo; see parsePagarmeBalance. */
  balance: unknown;
  payables: {
    id: number | string;
    status: string;
    amount: number;
    fee?: number | null;
    anticipation_fee?: number | null;
    payment_date: string;
    type?: string | null;
  }[];
  recipient: {
    transfer_settings?: {
      transfer_enabled?: boolean | null;
      transfer_interval?: string | null;
      transfer_day?: number | null;
    } | null;
    automatic_anticipation_settings?: {
      enabled?: boolean | null;
      type?: string | null;
      volume_percentage?: number | null;
      delay?: number | null;
    } | null;
  } | null;
  transfers: {
    id: string;
    amount: number;
    status: string;
    funding_estimated_date?: string | null;
    funding_date?: string | null;
    created_at?: string | null;
    date_created?: string | null;
  }[];
  /** The payables pagination hit its cap: rows are incomplete. */
  truncated: boolean;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** The v5 balance doc is v4-shaped (`available.amount`, `waiting_funds.amount`); some responses
 *  flatten it to `available_amount` / `waiting_funds_amount`. Accept both, null otherwise. */
export function parsePagarmeBalance(
  raw: unknown,
): { available_cents: number; pending_cents: number; currency: "brl" } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const nested = (k: string) => num((r[k] as { amount?: unknown } | undefined)?.amount);
  const available = num(r.available_amount) ?? nested("available");
  const pending = num(r.waiting_funds_amount) ?? nested("waiting_funds");
  if (available == null && pending == null) return null;
  return { available_cents: available ?? 0, pending_cents: pending ?? 0, currency: "brl" };
}

function toTransferSettings(raw: PagarmeRaw["recipient"]): TransferSettings | null {
  const ts = raw?.transfer_settings;
  if (!ts) return null;
  return {
    transfer_enabled: ts.transfer_enabled === true,
    transfer_interval: ts.transfer_interval ?? "daily",
    transfer_day: typeof ts.transfer_day === "number" ? ts.transfer_day : null,
  };
}

export function buildPagarmeDeposits(raw: PagarmeRaw, today: string): ProviderDeposits {
  const settings = toTransferSettings(raw.recipient);
  const items: { date: string; net_cents: number; gross_cents: number; fee_cents: number }[] = [];
  for (const p of raw.payables ?? []) {
    if (p.status !== "waiting_funds") continue;
    const day = toDay(p.payment_date);
    if (!day) continue;
    const fee = (p.fee ?? 0) + (p.anticipation_fee ?? 0);
    items.push({ date: day, net_cents: p.amount - fee, gross_cents: p.amount, fee_cents: fee });
  }
  const rows: DayRow[] = [];
  for (const [date, tot] of groupByDay(items)) {
    const proj = projectTransferDate(date, settings);
    rows.push({
      date,
      deposit_on: proj.deposit_on,
      ...tot,
      kind: "projected",
      manual_withdrawal: proj.manual_withdrawal,
    });
  }
  const split = splitHorizon(rows, today);

  const in_transit: ProviderDeposits["in_transit"] = [];
  for (const t of raw.transfers ?? []) {
    in_transit.push({
      id: t.id,
      amount_cents: t.amount,
      expected_on: toDay(t.funding_estimated_date ?? t.funding_date ?? null),
      status: t.status,
    });
  }

  const ant = raw.recipient?.automatic_anticipation_settings ?? null;
  return {
    configured: true,
    ok: true,
    truncated: raw.truncated === true,
    balance: parsePagarmeBalance(raw.balance),
    meta: {
      transfer_enabled: settings ? settings.transfer_enabled : null,
      transfer_interval: settings ? settings.transfer_interval : null,
      transfer_day: settings ? settings.transfer_day : null,
      anticipation_enabled: ant ? ant.enabled === true : null,
      anticipation_type: ant?.type ?? null,
    },
    upcoming: { next30: sortDayRows(split.next30), byMonth: split.byMonth },
    in_transit,
    recent: [],
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/platform-admin-deposits-logic_test.ts`
Expected: all PASS. If the "sorted" test fails on tie order, the tie-break in `sortDayRows` (deposit_on, then date, then kind) is the contract; fix the expectation only if the code's order is what the spec wants (deposit_on ascending).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/platform-admin/deposits-logic.ts supabase/functions/__tests__/platform-admin-deposits-logic_test.ts
git commit -m "feat(platform-admin): builders puros Stripe/Pagar.me → ProviderDeposits

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Gateways + `handleGetDeposits` + action registration

**Files:**
- Create: `supabase/functions/platform-admin/deposits.ts`
- Modify: `supabase/functions/platform-admin/index.ts` (imports near line 8; switch near the `get-trials` case)
- Test: `supabase/functions/__tests__/platform-admin-deposits_test.ts`

**Interfaces:**
- Consumes: `buildStripeDeposits`, `buildPagarmeDeposits`, `summarize`, `unavailable`, `notConfigured`, `StripeRaw`, `PagarmeRaw`, `ProviderDeposits`, `DepositsSummary` (Tasks 1–2); `loadStripe` from `_shared/stripe-loader.ts`; `pagarmeFetch` from `_shared/pagarme.ts`; `withTimeout` from `platform-admin/pricing.ts`.
- Produces:

```ts
export interface StripeDepositsGateway { fetchRaw(): Promise<StripeRaw> }
export interface PagarmeDepositsGateway { fetchRaw(recipientId: string): Promise<PagarmeRaw> }
export interface DepositsGateways { stripe: StripeDepositsGateway | null; pagarme: PagarmeDepositsGateway; recipientId: string | null; pagarmeSecretPresent: boolean; today?: string }
export async function createStripeDepositsGateway(): Promise<StripeDepositsGateway | null>   // null when loadStripe() gives null
export function createPagarmeDepositsGateway(): PagarmeDepositsGateway
export interface DepositsResponse { generated_at: string; currency: "brl"; summary: DepositsSummary; stripe: ProviderDeposits; pagarme: ProviderDeposits }
export async function buildDepositsResponse(g: DepositsGateways): Promise<DepositsResponse>
export async function handleGetDeposits(headers: Record<string, string>, gateways?: DepositsGateways): Promise<Response>
```

- [ ] **Step 1: Write the failing handler tests**

```ts
// supabase/functions/__tests__/platform-admin-deposits_test.ts
import { assertEquals } from "./assert.ts";
import {
  buildDepositsResponse,
  handleGetDeposits,
  type DepositsGateways,
} from "../platform-admin/deposits.ts";
import type { PagarmeRaw, StripeRaw } from "../platform-admin/deposits-logic.ts";

const TODAY = "2026-09-24";
const ts = (day: string) => Math.floor(new Date(`${day}T00:00:00Z`).getTime() / 1000);

const STRIPE_RAW: StripeRaw = {
  balance: { available: [{ amount: 100, currency: "brl" }], pending: [{ amount: 9700, currency: "brl" }] },
  payouts: [],
  pendingTransactions: [
    { net: 9700, amount: 10000, fee: 300, available_on: ts("2026-09-29"), status: "pending", currency: "brl", type: "charge" },
  ],
  schedule: { interval: "daily", delay_days: 30 },
  truncated: false,
};

const PAGARME_RAW: PagarmeRaw = {
  balance: { available_amount: 0, waiting_funds_amount: 2935 },
  payables: [{ id: 1, status: "waiting_funds", amount: 3090, fee: 155, anticipation_fee: 0, payment_date: "2026-09-25T03:00:00Z" }],
  recipient: { transfer_settings: { transfer_enabled: true, transfer_interval: "daily", transfer_day: null } },
  transfers: [],
  truncated: false,
};

function gateways(over: Partial<DepositsGateways> = {}): DepositsGateways {
  return {
    stripe: { fetchRaw: () => Promise.resolve(STRIPE_RAW) },
    pagarme: { fetchRaw: (_id) => Promise.resolve(PAGARME_RAW) },
    recipientId: "re_test",
    pagarmeSecretPresent: true,
    today: TODAY,
    ...over,
  };
}

Deno.test("buildDepositsResponse: both providers ok, summary picks the earliest deposit, currency is brl", async () => {
  const out = await buildDepositsResponse(gateways());
  assertEquals(out.currency, "brl");
  assertEquals(out.stripe.ok, true);
  assertEquals(out.pagarme.ok, true);
  assertEquals(out.summary, {
    next: { date: "2026-09-25", amount_cents: 2935, provider: "pagarme" },
    next_30d_cents: 9700 + 2935,
    waiting_cents: 9700 + 2935,
    partial: false,
  });
  assertEquals(typeof out.generated_at, "string");
});

Deno.test("buildDepositsResponse: one provider throwing yields ok:false for it only, marks partial, and never leaks the error", async () => {
  const out = await buildDepositsResponse(
    gateways({ stripe: { fetchRaw: () => Promise.reject(new Error("secret sk_live_123 leaked")) } }),
  );
  assertEquals(out.stripe, {
    configured: true,
    ok: false,
    error: "unavailable",
    truncated: false,
    balance: null,
    meta: {},
    upcoming: { next30: [], byMonth: [] },
    in_transit: [],
    recent: [],
  });
  assertEquals(out.pagarme.ok, true);
  assertEquals(JSON.stringify(out).includes("sk_live"), false);
  assertEquals(out.summary.next?.provider, "pagarme");
  assertEquals(out.summary.partial, true);
});

Deno.test("buildDepositsResponse: recipient id set but PAGARME_SECRET_KEY absent → configured:false, gateway not called", async () => {
  let called = 0;
  const out = await buildDepositsResponse(
    gateways({
      pagarmeSecretPresent: false,
      pagarme: {
        fetchRaw: () => {
          called += 1;
          return Promise.resolve(PAGARME_RAW);
        },
      },
    }),
  );
  assertEquals(out.pagarme.configured, false);
  assertEquals(called, 0);
  assertEquals(out.summary.partial, false);
});

Deno.test("buildDepositsResponse: no Stripe gateway → configured:false; no recipient id → Pagar.me configured:false and gateway not called", async () => {
  let called = 0;
  const out = await buildDepositsResponse(
    gateways({
      stripe: null,
      recipientId: null,
      pagarme: {
        fetchRaw: () => {
          called += 1;
          return Promise.resolve(PAGARME_RAW);
        },
      },
    }),
  );
  assertEquals(out.stripe.configured, false);
  assertEquals(out.pagarme.configured, false);
  assertEquals(called, 0);
  assertEquals(out.summary, { next: null, next_30d_cents: 0, waiting_cents: 0, partial: false });
});

Deno.test("buildDepositsResponse: the recipient id is passed to the Pagar.me gateway", async () => {
  let seen: string | null = null;
  await buildDepositsResponse(
    gateways({
      pagarme: {
        fetchRaw: (id) => {
          seen = id;
          return Promise.resolve(PAGARME_RAW);
        },
      },
    }),
  );
  assertEquals(seen, "re_test");
});

Deno.test("handleGetDeposits: 200 JSON with the response body", async () => {
  const res = await handleGetDeposits({ "Content-Type": "application/json" }, gateways());
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.stripe.ok, true);
  assertEquals(body.pagarme.ok, true);
  assertEquals(body.summary.next.provider, "pagarme");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/platform-admin-deposits_test.ts`
Expected: FAIL, module `../platform-admin/deposits.ts` not found.

- [ ] **Step 3: Implement `deposits.ts`**

```ts
// supabase/functions/platform-admin/deposits.ts
// Admin Depósitos panel: live read of Stripe payouts/balance and Pagar.me payables/balance. The
// gateways are the only network code and are injected so the handler is testable with fakes
// (same pattern as pagarme-detail.ts). Each provider is settled independently: one failing must
// never hide the other. Nothing here is persisted.
//
// NOT imported by mcp-admin on purpose (it has no Stripe loader and the panel is admin-UI only).
//
// Spec: docs/superpowers/specs/2026-09-24-admin-depositos-design.md §1.

import { pagarmeFetch } from "../_shared/pagarme.ts";
import { loadStripe } from "../_shared/stripe-loader.ts";
import { STRIPE_TIMEOUT_MS } from "../_shared/stripe-amount.ts";
import { withTimeout } from "./pricing.ts";
import {
  buildPagarmeDeposits,
  buildStripeDeposits,
  notConfigured,
  summarize,
  unavailable,
  type DepositsSummary,
  type PagarmeRaw,
  type ProviderDeposits,
  type StripeRaw,
  type StripeSchedule,
} from "./deposits-logic.ts";

export interface StripeDepositsGateway {
  fetchRaw(): Promise<StripeRaw>;
}

export interface PagarmeDepositsGateway {
  fetchRaw(recipientId: string): Promise<PagarmeRaw>;
}

export interface DepositsGateways {
  /** null = no Stripe loader registered / STRIPE_SECRET_KEY missing → configured:false. */
  stripe: StripeDepositsGateway | null;
  pagarme: PagarmeDepositsGateway;
  /** PAGARME_RECIPIENT_ID; null → Pagar.me configured:false and the gateway is never called. */
  recipientId: string | null;
  /** PAGARME_SECRET_KEY present. pagarmeFetch only fails at call time when it is missing, which
   *  would read as "indisponível"; checking up front makes it "não configurado" instead. */
  pagarmeSecretPresent: boolean;
  /** YYYY-MM-DD; defaults to today (UTC). Injected so tests are deterministic. */
  today?: string;
}

export interface DepositsResponse {
  generated_at: string;
  /** Every amount in the payload is BRL centavos; Stripe sources are filtered to brl. */
  currency: "brl";
  summary: DepositsSummary;
  stripe: ProviderDeposits;
  pagarme: ProviderDeposits;
}

// ─── Stripe gateway ─────────────────────────────────────────────────────────

/** The slice of the Stripe SDK this module touches (the shared StripeClient type only knows
 *  subscriptions.retrieve). The real client satisfies this structurally. */
type StripeDepositsClient = {
  balance: { retrieve: (params?: undefined, opts?: { timeout?: number }) => Promise<StripeRaw["balance"]> };
  payouts: {
    list: (
      params: { limit: number },
      opts?: { timeout?: number },
    ) => Promise<{ data: StripeRaw["payouts"] }>;
  };
  balanceTransactions: {
    list: (
      params: Record<string, unknown>,
      opts?: { timeout?: number },
    ) => Promise<{ data: StripeRaw["pendingTransactions"]; has_more: boolean }>;
  };
  accounts: {
    retrieve: (
      params?: undefined,
      opts?: { timeout?: number },
    ) => Promise<{ settings?: { payouts?: { schedule?: StripeSchedule } } }>;
  };
};

const STRIPE_PAGE = 100;
const STRIPE_MAX_PAGES = 5;
const OPTS = { timeout: STRIPE_TIMEOUT_MS };

/** Pending balance transactions. Prefers the `available_on` range filter; if Stripe rejects it
 *  (400), falls back to `created >= now-40d` (Brazil cards settle at T+30) and filters status
 *  client-side. Bounded to STRIPE_MAX_PAGES pages of 100; `truncated` when the cap is hit with
 *  more pages left. */
async function listPendingTransactions(
  stripe: StripeDepositsClient,
): Promise<{ rows: StripeRaw["pendingTransactions"]; truncated: boolean }> {
  const nowSec = Math.floor(Date.now() / 1000);
  const attempts: Record<string, unknown>[] = [
    { available_on: { gte: nowSec }, limit: STRIPE_PAGE },
    { created: { gte: nowSec - 40 * 24 * 3600 }, limit: STRIPE_PAGE },
  ];
  let lastErr: unknown = null;
  for (const base of attempts) {
    try {
      const rows: StripeRaw["pendingTransactions"] = [];
      let starting_after: string | undefined;
      let truncated = false;
      for (let page = 0; page < STRIPE_MAX_PAGES; page++) {
        const params = starting_after ? { ...base, starting_after } : base;
        const res = await withTimeout(stripe.balanceTransactions.list(params, OPTS), STRIPE_TIMEOUT_MS, "stripe.balanceTransactions.list");
        for (const t of res.data) if (t.status === "pending") rows.push(t);
        if (!res.has_more || res.data.length === 0) break;
        starting_after = res.data[res.data.length - 1].id;
        if (page === STRIPE_MAX_PAGES - 1) truncated = true;
      }
      return { rows, truncated };
    } catch (err) {
      lastErr = err;
      const status = (err as { statusCode?: number; status?: number }).statusCode ?? (err as { status?: number }).status;
      if (status !== 400) throw err; // only a rejected filter falls through to the next attempt
    }
  }
  throw lastErr;
}

export async function createStripeDepositsGateway(): Promise<StripeDepositsGateway | null> {
  const client = await loadStripe();
  if (!client) return null;
  const stripe = client as unknown as StripeDepositsClient;
  return {
    async fetchRaw() {
      const [balance, payouts, pending, account] = await Promise.all([
        withTimeout(stripe.balance.retrieve(undefined, OPTS), STRIPE_TIMEOUT_MS, "stripe.balance.retrieve"),
        withTimeout(stripe.payouts.list({ limit: 25 }, OPTS), STRIPE_TIMEOUT_MS, "stripe.payouts.list"),
        listPendingTransactions(stripe),
        withTimeout(stripe.accounts.retrieve(undefined, OPTS), STRIPE_TIMEOUT_MS, "stripe.accounts.retrieve").catch(
          (err) => {
            // The schedule is display-only; a restricted key must not take the whole card down.
            console.error("[deposits] stripe.accounts.retrieve failed:", (err as Error).message);
            return null;
          },
        ),
      ]);
      return {
        balance,
        payouts: payouts.data,
        pendingTransactions: pending.rows,
        schedule: account?.settings?.payouts?.schedule ?? null,
        truncated: pending.truncated,
      };
    },
  };
}

// ─── Pagar.me gateway ───────────────────────────────────────────────────────

// Each pagarmeFetch has a 5s timeout and the whole handler must fit the edge runtime budget, so the
// sweep is capped: 5 pages × 100 = 500 waiting payables (12 per 12x subscription → ~40 subscriptions).
// Hitting the cap sets `truncated` and the UI says the list is partial instead of silently under-counting.
const PAGARME_PAGE = 100;
const PAGARME_MAX_PAGES = 5;

interface PagarmePayablesPage {
  data: PagarmeRaw["payables"];
  paging?: { next?: string | null; cursors?: { next?: string | null } | null } | null;
}

interface PagarmeTransfersPage {
  data: PagarmeRaw["transfers"];
  paging?: { next?: string | null } | null;
}

/** Pagar.me returns the next cursor either bare (`paging.cursors.next`) or as a full URL in
 *  `paging.next` (`…/payables?forward_cursor=abc&size=100`). Accept both. */
function nextCursor(paging: PagarmePayablesPage["paging"]): string | null {
  const raw = paging?.cursors?.next ?? paging?.next ?? null;
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) {
    try {
      return new URL(raw).searchParams.get("forward_cursor");
    } catch {
      return null;
    }
  }
  return raw;
}

async function listWaitingPayables(
  recipientId: string,
): Promise<{ rows: PagarmeRaw["payables"]; truncated: boolean }> {
  const rows: PagarmeRaw["payables"] = [];
  let cursor: string | null = null;
  let truncated = false;
  for (let page = 0; page < PAGARME_MAX_PAGES; page++) {
    const qs = new URLSearchParams({ recipient_id: recipientId, status: "waiting_funds", size: String(PAGARME_PAGE) });
    if (cursor) qs.set("forward_cursor", cursor);
    const res = await pagarmeFetch<PagarmePayablesPage>("GET", `/payables?${qs.toString()}`);
    rows.push(...(res?.data ?? []));
    cursor = nextCursor(res?.paging);
    if (!cursor || (res?.data ?? []).length === 0) break;
    if (page === PAGARME_MAX_PAGES - 1) truncated = true;
  }
  return { rows, truncated };
}

export function createPagarmeDepositsGateway(): PagarmeDepositsGateway {
  return {
    async fetchRaw(recipientId) {
      const id = encodeURIComponent(recipientId);
      const [balance, payablesPage, recipient, transfers] = await Promise.all([
        pagarmeFetch<unknown>("GET", `/recipients/${id}/balance`),
        listWaitingPayables(recipientId),
        pagarmeFetch<PagarmeRaw["recipient"]>("GET", `/recipients/${id}`),
        pagarmeFetch<PagarmeTransfersPage>(
          "GET",
          `/transfers?${new URLSearchParams({ recipient_id: recipientId, status: "pending_transfer,processing", count: "50" }).toString()}`,
        ).then((r) => r?.data ?? []).catch((err) => {
          // In-flight transfers are a nice-to-have; the endpoint is newer and its filter grammar
          // is the least documented. Degrade to an empty list rather than fail the card.
          console.error("[deposits] pagarme transfers failed:", (err as Error).message);
          return [] as PagarmeRaw["transfers"];
        }),
      ]);
      return { balance, payables: payablesPage.rows, recipient, transfers, truncated: payablesPage.truncated };
    },
  };
}

// ─── handler ────────────────────────────────────────────────────────────────

async function settleProvider(label: string, run: (() => Promise<ProviderDeposits>) | null): Promise<ProviderDeposits> {
  if (!run) return notConfigured();
  try {
    return await run();
  } catch (err) {
    console.error(`[deposits] ${label} failed:`, (err as Error).message);
    return unavailable();
  }
}

export async function buildDepositsResponse(g: DepositsGateways): Promise<DepositsResponse> {
  const today = g.today ?? new Date().toISOString().slice(0, 10);
  const pagarmeConfigured = !!g.recipientId && g.pagarmeSecretPresent;
  const [stripe, pagarme] = await Promise.all([
    settleProvider("stripe", g.stripe ? () => g.stripe!.fetchRaw().then((raw) => buildStripeDeposits(raw, today)) : null),
    settleProvider(
      "pagarme",
      pagarmeConfigured ? () => g.pagarme.fetchRaw(g.recipientId!).then((raw) => buildPagarmeDeposits(raw, today)) : null,
    ),
  ]);
  return {
    generated_at: new Date().toISOString(),
    currency: "brl",
    summary: summarize({ stripe, pagarme }),
    stripe,
    pagarme,
  };
}

async function defaultGateways(): Promise<DepositsGateways> {
  return {
    stripe: await createStripeDepositsGateway(),
    pagarme: createPagarmeDepositsGateway(),
    recipientId: Deno.env.get("PAGARME_RECIPIENT_ID")?.trim() || null,
    pagarmeSecretPresent: !!Deno.env.get("PAGARME_SECRET_KEY"),
  };
}

export async function handleGetDeposits(
  headers: Record<string, string>,
  gateways?: DepositsGateways,
): Promise<Response> {
  const body = await buildDepositsResponse(gateways ?? (await defaultGateways()));
  return new Response(JSON.stringify(body), { status: 200, headers });
}
```

- [ ] **Step 4: Register the action in `index.ts`**

Add the import next to the `mrr.ts` import (line 8):

```ts
import { handleGetDeposits } from "./deposits.ts";
```

Add the case right after `case "get-trials":`:

```ts
      case "get-deposits":
        return await handleGetDeposits(headers);
```

- [ ] **Step 5: Run the handler tests and the type check**

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/platform-admin-deposits_test.ts`
Expected: all PASS.

Run: `npm run check:functions`
Expected: no errors. If `stripe.balance.retrieve(undefined, OPTS)` mismatches the structural type because the SDK's first param is optional-but-typed, change the local type to `retrieve: (...args: unknown[]) => Promise<...>`.

- [ ] **Step 6: Run the whole edge suite once (guards the `mcp-admin` bundling constraint indirectly: nothing there imports `deposits.ts`)**

Run: `grep -rn "deposits" supabase/functions/mcp-admin/` → expected: no output.
Run: `npm run test:functions` → expected: PASS (a `deno.lock` diff may appear: `git checkout deno.lock` before committing, per repo memory).

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/platform-admin/deposits.ts supabase/functions/platform-admin/index.ts supabase/functions/__tests__/platform-admin-deposits_test.ts
git commit -m "feat(platform-admin): ação get-deposits (Stripe payouts/balance + Pagar.me recebíveis/saldo)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Frontend plumbing: API types, route, nav, page shell

**Files:**
- Modify: `apps/admin/src/lib/api.ts` (append after `listPlans`, around line 340)
- Modify: `apps/admin/src/lib/routes.ts`
- Modify: `apps/admin/src/router.tsx` (children array, after `workspaces/:id`)
- Modify: `apps/admin/src/layouts/AdminLayout.tsx` (lucide import block lines 3–17, `NAV_ITEMS` lines 24–33)
- Create: `apps/admin/src/pages/MetricasPage.tsx`
- Create: `apps/admin/src/pages/metricas/DepositsSection.tsx` (placeholder for this task only: renders `null`; Task 6 replaces it)
- Test: `apps/admin/src/pages/__tests__/MetricasPage.test.tsx`

**Interfaces:**
- Produces (used by Tasks 5–6):

```ts
// apps/admin/src/lib/api.ts
export type DepositProvider = 'stripe' | 'pagarme';
export interface DepositDayRow { date: string; deposit_on: string; net_cents: number; gross_cents: number; fee_cents: number; count: number; kind: 'payout' | 'projected'; manual_withdrawal?: boolean }
export interface DepositMonthRow { month: string; net_cents: number; gross_cents: number; fee_cents: number; count: number }
export interface ProviderDeposits { configured: boolean; ok: boolean; error?: 'unavailable'; truncated: boolean; balance: { available_cents: number; pending_cents: number; currency: 'brl' } | null; meta: Record<string, string | number | boolean | null>; upcoming: { next30: DepositDayRow[]; byMonth: DepositMonthRow[] }; in_transit: { id: string; amount_cents: number; expected_on: string | null; status: string }[]; recent: { id: string; date: string; amount_cents: number; status: string }[] }
export interface DepositsResponse { generated_at: string; currency: 'brl'; summary: { next: { date: string; amount_cents: number; provider: DepositProvider } | null; next_30d_cents: number; waiting_cents: number; partial: boolean }; stripe: ProviderDeposits; pagarme: ProviderDeposits }
export function getDeposits(): Promise<DepositsResponse>
// apps/admin/src/lib/routes.ts
export const metricasPath = () => '/admin/metricas';
```

- [ ] **Step 1: Write the failing page test**

```tsx
// apps/admin/src/pages/__tests__/MetricasPage.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/api', () => ({ getDeposits: vi.fn(() => new Promise(() => {})) }));

import MetricasPage from '../MetricasPage';

describe('MetricasPage', () => {
  it('renders the page header and the Depósitos section anchor', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <MetricasPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Métricas' })).toBeInTheDocument();
    expect(document.getElementById('depositos')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run apps/admin/src/pages/__tests__/MetricasPage.test.tsx`
Expected: FAIL, cannot resolve `../MetricasPage`.

- [ ] **Step 3: Add the API types and wrapper (`apps/admin/src/lib/api.ts`, after `listPlans`)**

```ts
// ─── Depósitos (admin Métricas page) ──────────────────────────
// Mirror of supabase/functions/platform-admin/deposits-logic.ts. Keep the two in sync by hand.

export type DepositProvider = 'stripe' | 'pagarme';

export interface DepositDayRow {
  /** Day the funds become available at the provider (YYYY-MM-DD). */
  date: string;
  /** Projected day the money reaches the bank account (YYYY-MM-DD). */
  deposit_on: string;
  net_cents: number;
  gross_cents: number;
  fee_cents: number;
  count: number;
  kind: 'payout' | 'projected';
  manual_withdrawal?: boolean;
}

export interface DepositMonthRow {
  /** YYYY-MM */
  month: string;
  net_cents: number;
  gross_cents: number;
  fee_cents: number;
  count: number;
}

export interface ProviderDeposits {
  configured: boolean;
  ok: boolean;
  error?: 'unavailable';
  /** Pagination hit its cap: `upcoming` is incomplete. */
  truncated: boolean;
  balance: { available_cents: number; pending_cents: number; currency: 'brl' } | null;
  meta: Record<string, string | number | boolean | null>;
  upcoming: { next30: DepositDayRow[]; byMonth: DepositMonthRow[] };
  in_transit: { id: string; amount_cents: number; expected_on: string | null; status: string }[];
  recent: { id: string; date: string; amount_cents: number; status: string }[];
}

export interface DepositsResponse {
  generated_at: string;
  currency: 'brl';
  summary: {
    next: { date: string; amount_cents: number; provider: DepositProvider } | null;
    next_30d_cents: number;
    waiting_cents: number;
    /** A configured provider failed: the totals only cover the one that answered. */
    partial: boolean;
  };
  stripe: ProviderDeposits;
  pagarme: ProviderDeposits;
}

export function getDeposits() {
  return adminApi<DepositsResponse>('get-deposits');
}
```

- [ ] **Step 4: Route helper, router entry, nav item**

`apps/admin/src/lib/routes.ts`, append:

```ts
export const metricasPath = () => '/admin/metricas';
```

`apps/admin/src/router.tsx`, add after the `workspaces/:id` child:

```tsx
      {
        path: 'metricas',
        lazy: async () => ({ Component: (await import('./pages/MetricasPage')).default }),
      },
```

`apps/admin/src/layouts/AdminLayout.tsx`: add `TrendingUp` to the `lucide-react` import list, and insert as the second `NAV_ITEMS` entry (right after Dashboard):

```ts
  { to: '/admin/metricas', icon: TrendingUp, label: 'Métricas' },
```

- [ ] **Step 5: Page shell + placeholder section**

```tsx
// apps/admin/src/pages/metricas/DepositsSection.tsx  (placeholder; Task 6 replaces this file)
export function DepositsSection() {
  return null;
}
```

```tsx
// apps/admin/src/pages/MetricasPage.tsx
import { PageHeader } from '../components/PageHeader';
import { DepositsSection } from './metricas/DepositsSection';

/**
 * Métricas: charts and money views for the platform. Sub-project A ships only the Depósitos
 * section; B adds the MRR/churn chart sections above it and links the Dashboard tiles here
 * by anchor (see docs/superpowers/specs/2026-09-24-admin-depositos-design.md).
 */
export default function MetricasPage() {
  return (
    <div>
      <PageHeader
        title="Métricas"
        description="Receita, repasses e evolução da plataforma"
      />
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

- [ ] **Step 6: Run the page test, the layout test and the typecheck**

Run: `npx vitest run apps/admin/src/pages/__tests__/MetricasPage.test.tsx apps/admin/src/layouts/__tests__/AdminLayout.test.tsx`
Expected: PASS. If `AdminLayout.test.tsx` asserts an exact nav list, add `Métricas` to its expectation in the position after Dashboard.

Run: `npx tsc -p apps/admin/tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 7: Format and commit**

```bash
npm run format
git add apps/admin/src/lib/api.ts apps/admin/src/lib/routes.ts apps/admin/src/router.tsx apps/admin/src/layouts/AdminLayout.tsx apps/admin/src/pages/MetricasPage.tsx apps/admin/src/pages/metricas/DepositsSection.tsx apps/admin/src/pages/__tests__/MetricasPage.test.tsx
git commit -m "feat(admin): página Métricas (rota, nav, tipos e getDeposits)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: View helpers for the Depósitos section

**Files:**
- Create: `apps/admin/src/pages/metricas/deposits-view.ts`
- Test: `apps/admin/src/pages/__tests__/deposits-view.test.ts`

**Interfaces:**
- Consumes: `DepositProvider`, `ProviderDeposits`, `DepositDayRow` from `lib/api.ts`.
- Produces (used by Task 6):

```ts
export function formatDay(day: string): string            // "2026-09-28" → "28/09/2026"
export function formatDayShort(day: string): string       // "2026-09-28" → "seg, 28/09"
export function formatMonth(month: string): string        // "2026-11" → "novembro de 2026"
export function providerName(p: DepositProvider): string  // 'Stripe' | 'Pagar.me'
export function scheduleCaption(p: DepositProvider, meta: ProviderDeposits['meta']): string | null
export function payoutStatusBadge(status: string): { label: string; variant: 'success' | 'warning' | 'danger' | 'neutral' | 'info' }
export function rowDateLabel(row: DepositDayRow): string  // "Deposita em" vs "Disponível em" prefix + day
export function waitingTotalLabel(data: Pick<DepositsResponse, 'summary' | 'stripe' | 'pagarme'>): string   // "A receber (total)" or "A receber (parcial: Stripe indisponível)"
export const NOT_CONFIGURED_SECRET: Record<DepositProvider, string>  // stripe: 'STRIPE_SECRET_KEY', pagarme: 'PAGARME_RECIPIENT_ID'
```

- [ ] **Step 1: Write the failing tests**

```ts
// apps/admin/src/pages/__tests__/deposits-view.test.ts
import { describe, expect, it } from 'vitest';
import {
  NOT_CONFIGURED_SECRET,
  formatDay,
  formatDayShort,
  formatMonth,
  payoutStatusBadge,
  providerName,
  rowDateLabel,
  scheduleCaption,
  waitingTotalLabel,
} from '../metricas/deposits-view';

describe('deposits-view', () => {
  it('formatDay / formatDayShort / formatMonth use pt-BR without timezone drift', () => {
    expect(formatDay('2026-09-28')).toBe('28/09/2026');
    expect(formatDayShort('2026-09-28')).toBe('seg, 28/09');
    expect(formatMonth('2026-11')).toBe('novembro de 2026');
  });

  it('providerName', () => {
    expect(providerName('stripe')).toBe('Stripe');
    expect(providerName('pagarme')).toBe('Pagar.me');
  });

  it('scheduleCaption: Stripe schedule', () => {
    expect(scheduleCaption('stripe', { schedule_interval: 'daily', delay_days: 30 })).toBe(
      'Repasse automático diário, D+30',
    );
    expect(scheduleCaption('stripe', { schedule_interval: null, delay_days: null })).toBeNull();
  });

  it('scheduleCaption: Pagar.me transfer settings', () => {
    expect(
      scheduleCaption('pagarme', {
        transfer_enabled: true,
        transfer_interval: 'daily',
        transfer_day: null,
        anticipation_enabled: false,
        anticipation_type: null,
      }),
    ).toBe('Transferência automática diária');
    expect(
      scheduleCaption('pagarme', {
        transfer_enabled: true,
        transfer_interval: 'weekly',
        transfer_day: 3,
        anticipation_enabled: true,
        anticipation_type: 'full',
      }),
    ).toBe('Transferência automática semanal (quarta-feira) · antecipação automática ativa');
    expect(
      scheduleCaption('pagarme', {
        transfer_enabled: true,
        transfer_interval: 'monthly',
        transfer_day: 15,
        anticipation_enabled: null,
        anticipation_type: null,
      }),
    ).toBe('Transferência automática mensal (dia 15)');
    expect(
      scheduleCaption('pagarme', {
        transfer_enabled: false,
        transfer_interval: 'daily',
        transfer_day: null,
        anticipation_enabled: null,
        anticipation_type: null,
      }),
    ).toBe('Transferência automática desligada: saque manual');
    expect(scheduleCaption('pagarme', {})).toBeNull();
  });

  it('payoutStatusBadge maps provider statuses to badge variants', () => {
    expect(payoutStatusBadge('paid')).toEqual({ label: 'Pago', variant: 'success' });
    expect(payoutStatusBadge('transferred')).toEqual({ label: 'Pago', variant: 'success' });
    expect(payoutStatusBadge('pending')).toEqual({ label: 'Pendente', variant: 'info' });
    expect(payoutStatusBadge('in_transit')).toEqual({ label: 'Em trânsito', variant: 'info' });
    expect(payoutStatusBadge('processing')).toEqual({ label: 'Em trânsito', variant: 'info' });
    expect(payoutStatusBadge('pending_transfer')).toEqual({ label: 'Pendente', variant: 'info' });
    expect(payoutStatusBadge('failed')).toEqual({ label: 'Falhou', variant: 'danger' });
    expect(payoutStatusBadge('canceled')).toEqual({ label: 'Cancelado', variant: 'neutral' });
    expect(payoutStatusBadge('weird')).toEqual({ label: 'weird', variant: 'neutral' });
  });

  it('rowDateLabel distinguishes deposit vs manual withdrawal', () => {
    const base = { date: '2026-09-26', deposit_on: '2026-09-28', net_cents: 1, gross_cents: 1, fee_cents: 0, count: 1, kind: 'projected' as const };
    expect(rowDateLabel(base)).toBe('Deposita em seg, 28/09');
    expect(rowDateLabel({ ...base, manual_withdrawal: true })).toBe('Disponível em seg, 28/09');
  });

  it('NOT_CONFIGURED_SECRET names the secret per provider', () => {
    expect(NOT_CONFIGURED_SECRET.stripe).toBe('STRIPE_SECRET_KEY');
    expect(NOT_CONFIGURED_SECRET.pagarme).toBe('PAGARME_RECIPIENT_ID');
  });

  it('waitingTotalLabel names the failed provider when the summary is partial', () => {
    const ok = { configured: true, ok: true, truncated: false, balance: null, meta: {}, upcoming: { next30: [], byMonth: [] }, in_transit: [], recent: [] };
    const failed = { ...ok, ok: false, error: 'unavailable' as const };
    const notConfigured = { ...ok, configured: false, ok: false };
    const summary = { next: null, next_30d_cents: 0, waiting_cents: 0, partial: false };
    expect(waitingTotalLabel({ summary, stripe: ok, pagarme: ok })).toBe('A receber (total)');
    expect(waitingTotalLabel({ summary: { ...summary, partial: true }, stripe: failed, pagarme: ok })).toBe(
      'A receber (parcial: Stripe indisponível)',
    );
    expect(waitingTotalLabel({ summary: { ...summary, partial: true }, stripe: failed, pagarme: failed })).toBe(
      'A receber (parcial: Stripe e Pagar.me indisponíveis)',
    );
    // not configured is not "partial"
    expect(waitingTotalLabel({ summary, stripe: ok, pagarme: notConfigured })).toBe('A receber (total)');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/admin/src/pages/__tests__/deposits-view.test.ts`
Expected: FAIL, cannot resolve `../metricas/deposits-view`.

- [ ] **Step 3: Implement**

```ts
// apps/admin/src/pages/metricas/deposits-view.ts
// Pure formatting for the Depósitos section. No React, no fetch, so the copy rules are testable.
import type { DepositDayRow, DepositProvider, DepositsResponse, ProviderDeposits } from '../../lib/api';

/** Day strings carry no time; parse as UTC midnight and format in UTC so the calendar day never shifts. */
function parseDay(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

export function formatDay(day: string): string {
  return parseDay(day).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

export function formatDayShort(day: string): string {
  const d = parseDay(day);
  const weekday = d.toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' }).replace('.', '');
  const dm = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
  return `${weekday}, ${dm}`;
}

export function formatMonth(month: string): string {
  return parseDay(`${month}-01`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function providerName(p: DepositProvider): string {
  return p === 'stripe' ? 'Stripe' : 'Pagar.me';
}

export const NOT_CONFIGURED_SECRET: Record<DepositProvider, string> = {
  stripe: 'STRIPE_SECRET_KEY',
  pagarme: 'PAGARME_RECIPIENT_ID',
};

const WEEKDAY_PT: Record<number, string> = {
  1: 'segunda-feira',
  2: 'terça-feira',
  3: 'quarta-feira',
  4: 'quinta-feira',
  5: 'sexta-feira',
};

const STRIPE_INTERVAL_PT: Record<string, string> = {
  daily: 'diário',
  weekly: 'semanal',
  monthly: 'mensal',
  manual: 'manual',
};

export function scheduleCaption(p: DepositProvider, meta: ProviderDeposits['meta']): string | null {
  if (p === 'stripe') {
    const interval = meta.schedule_interval;
    if (typeof interval !== 'string') return null;
    const delay = typeof meta.delay_days === 'number' ? `, D+${meta.delay_days}` : '';
    return `Repasse automático ${STRIPE_INTERVAL_PT[interval] ?? interval}${delay}`;
  }
  if (typeof meta.transfer_enabled !== 'boolean') return null;
  if (!meta.transfer_enabled) return 'Transferência automática desligada: saque manual';
  const interval = meta.transfer_interval;
  const day = typeof meta.transfer_day === 'number' ? meta.transfer_day : null;
  let text: string;
  if (interval === 'weekly') {
    text = `Transferência automática semanal${day && WEEKDAY_PT[day] ? ` (${WEEKDAY_PT[day]})` : ''}`;
  } else if (interval === 'monthly') {
    text = `Transferência automática mensal${day ? ` (dia ${day})` : ''}`;
  } else {
    text = 'Transferência automática diária';
  }
  if (meta.anticipation_enabled === true) text += ' · antecipação automática ativa';
  return text;
}

type BadgeVariant = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

const STATUS_BADGE: Record<string, { label: string; variant: BadgeVariant }> = {
  paid: { label: 'Pago', variant: 'success' },
  transferred: { label: 'Pago', variant: 'success' },
  pending: { label: 'Pendente', variant: 'info' },
  pending_transfer: { label: 'Pendente', variant: 'info' },
  in_transit: { label: 'Em trânsito', variant: 'info' },
  processing: { label: 'Em trânsito', variant: 'info' },
  failed: { label: 'Falhou', variant: 'danger' },
  canceled: { label: 'Cancelado', variant: 'neutral' },
};

export function payoutStatusBadge(status: string): { label: string; variant: BadgeVariant } {
  return STATUS_BADGE[status] ?? { label: status, variant: 'neutral' };
}

export function rowDateLabel(row: DepositDayRow): string {
  const prefix = row.manual_withdrawal ? 'Disponível em' : 'Deposita em';
  return `${prefix} ${formatDayShort(row.deposit_on)}`;
}

/** "total" only when every configured provider answered; otherwise names the ones that failed. */
export function waitingTotalLabel(
  data: Pick<DepositsResponse, 'summary' | 'stripe' | 'pagarme'>,
): string {
  if (!data.summary.partial) return 'A receber (total)';
  const failed = (['stripe', 'pagarme'] as DepositProvider[])
    .filter((p) => data[p].configured && !data[p].ok)
    .map(providerName);
  const who = failed.length > 1 ? `${failed.join(' e ')} indisponíveis` : `${failed[0]} indisponível`;
  return `A receber (parcial: ${who})`;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run apps/admin/src/pages/__tests__/deposits-view.test.ts`
Expected: PASS. If `formatDayShort` yields `seg., 28/09` on the CI Node ICU, the `.replace('.', '')` handles it; if it yields `seg 28/09` without the comma, adjust the template, not the test.

- [ ] **Step 5: Format and commit**

```bash
npm run format
git add apps/admin/src/pages/metricas/deposits-view.ts apps/admin/src/pages/__tests__/deposits-view.test.ts
git commit -m "feat(admin): helpers de formatação do painel de Depósitos

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `DepositsSection` component (summary strip + provider cards + states)

**Files:**
- Replace: `apps/admin/src/pages/metricas/DepositsSection.tsx`
- Test: `apps/admin/src/pages/__tests__/DepositsSection.test.tsx`

**Interfaces:**
- Consumes: `getDeposits`, `DepositsResponse`, `ProviderDeposits`, `DepositProvider` (Task 4); every helper from Task 5; `formatMoney` from `lib/subscription.ts`; `Card/CardHeader/CardTitle/CardContent`, `Badge`, `Button`, `Skeleton`, `Tooltip*` from `components/ui`; `EmptyState`, `ErrorState` from `components/`.
- Produces: `export function DepositsSection(): JSX.Element`.

- [ ] **Step 1: Write the failing component tests**

```tsx
// apps/admin/src/pages/__tests__/DepositsSection.test.tsx
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/api', () => ({ getDeposits: vi.fn() }));

import { getDeposits, type DepositsResponse, type ProviderDeposits } from '../../lib/api';
import { DepositsSection } from '../metricas/DepositsSection';

function provider(over: Partial<ProviderDeposits> = {}): ProviderDeposits {
  return {
    configured: true,
    ok: true,
    truncated: false,
    balance: { available_cents: 12345, pending_cents: 50000, currency: 'brl' },
    meta: {},
    upcoming: { next30: [], byMonth: [] },
    in_transit: [],
    recent: [],
    ...over,
  };
}

const RESPONSE: DepositsResponse = {
  generated_at: '2026-09-24T12:00:00.000Z',
  currency: 'brl',
  summary: {
    next: { date: '2026-09-25', amount_cents: 293500, provider: 'pagarme' },
    next_30d_cents: 1263500,
    waiting_cents: 5000000,
    partial: false,
  },
  stripe: provider({
    meta: { schedule_interval: 'daily', delay_days: 30 },
    upcoming: {
      next30: [
        { date: '2026-09-25', deposit_on: '2026-09-25', net_cents: 20000, gross_cents: 20000, fee_cents: 0, count: 1, kind: 'payout' },
        { date: '2026-09-26', deposit_on: '2026-09-28', net_cents: 950000, gross_cents: 1000000, fee_cents: 50000, count: 3, kind: 'projected' },
      ],
      byMonth: [{ month: '2026-11', net_cents: 97000, gross_cents: 100000, fee_cents: 3000, count: 1 }],
    },
    recent: [{ id: 'po_2', date: '2026-09-23', amount_cents: 18000, status: 'paid' }],
  }),
  pagarme: provider({
    balance: { available_cents: 0, pending_cents: 4000000, currency: 'brl' },
    meta: { transfer_enabled: true, transfer_interval: 'daily', transfer_day: null, anticipation_enabled: false, anticipation_type: null },
    upcoming: {
      next30: [
        { date: '2026-09-25', deposit_on: '2026-09-25', net_cents: 293500, gross_cents: 309000, fee_cents: 15500, count: 100, kind: 'projected', manual_withdrawal: false },
      ],
      byMonth: [
        { month: '2026-10', net_cents: 293500, gross_cents: 309000, fee_cents: 15500, count: 100 },
        { month: '2026-11', net_cents: 293500, gross_cents: 309000, fee_cents: 15500, count: 100 },
      ],
    },
    in_transit: [{ id: 'tr_1', amount_cents: 4000, expected_on: '2026-09-25', status: 'processing' }],
  }),
};

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DepositsSection />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(getDeposits).mockReset();
});

describe('DepositsSection', () => {
  it('shows skeletons while loading', () => {
    vi.mocked(getDeposits).mockReturnValue(new Promise(() => {}));
    renderSection();
    expect(screen.getAllByTestId('deposits-skeleton').length).toBeGreaterThan(0);
  });

  it('renders the summary strip and both provider cards with data', async () => {
    vi.mocked(getDeposits).mockResolvedValue(RESPONSE);
    renderSection();
    expect(await screen.findByText('Próximo depósito')).toBeInTheDocument();
    const summary = screen.getByTestId('deposits-summary');
    expect(within(summary).getByText('R$ 2.935,00')).toBeInTheDocument();
    expect(within(summary).getByText(/Pagar\.me · sex, 25\/09/)).toBeInTheDocument();
    expect(within(summary).getByText('R$ 12.635,00')).toBeInTheDocument();
    expect(within(summary).getByText('R$ 50.000,00')).toBeInTheDocument();
    expect(within(summary).getByText('A receber (total)')).toBeInTheDocument();

    const stripe = screen.getByTestId('deposits-card-stripe');
    expect(within(stripe).getByRole('heading', { name: 'Stripe' })).toBeInTheDocument();
    expect(within(stripe).getByText('Repasse automático diário, D+30')).toBeInTheDocument();
    expect(within(stripe).getByText('R$ 123,45')).toBeInTheDocument(); // disponível
    expect(within(stripe).getByText('R$ 500,00')).toBeInTheDocument(); // a compensar
    expect(within(stripe).getByText('Deposita em sex, 25/09')).toBeInTheDocument();
    expect(within(stripe).getByText('Deposita em seg, 28/09')).toBeInTheDocument();
    expect(within(stripe).getByText('R$ 9.500,00')).toBeInTheDocument();
    expect(within(stripe).getByText('novembro de 2026')).toBeInTheDocument();
    expect(within(stripe).getByText('Pago')).toBeInTheDocument();

    const pagarme = screen.getByTestId('deposits-card-pagarme');
    expect(within(pagarme).getByRole('heading', { name: 'Pagar.me' })).toBeInTheDocument();
    expect(within(pagarme).getByText('Transferência automática diária')).toBeInTheDocument();
    expect(within(pagarme).getByText('outubro de 2026')).toBeInTheDocument();
    expect(within(pagarme).getByText('Transferências em andamento')).toBeInTheDocument();
    expect(within(pagarme).getByText('Em trânsito')).toBeInTheDocument(); // the processing badge
    expect(within(pagarme).getByText('R$ 40,00')).toBeInTheDocument();
  });

  it('a payout row exposes gross and fee through the tooltip trigger label', async () => {
    vi.mocked(getDeposits).mockResolvedValue(RESPONSE);
    renderSection();
    const stripe = await screen.findByTestId('deposits-card-stripe');
    expect(within(stripe).getByLabelText('Bruto R$ 10.000,00, taxas R$ 500,00')).toBeInTheDocument();
  });

  it('shows the not-configured state naming the secret', async () => {
    vi.mocked(getDeposits).mockResolvedValue({
      ...RESPONSE,
      pagarme: { ...provider(), configured: false, ok: false, balance: null },
    });
    renderSection();
    const pagarme = await screen.findByTestId('deposits-card-pagarme');
    expect(within(pagarme).getByText('Não configurado')).toBeInTheDocument();
    expect(within(pagarme).getByText(/PAGARME_RECIPIENT_ID/)).toBeInTheDocument();
  });

  it('shows a per-provider error state with retry when ok is false, and labels the total as partial', async () => {
    vi.mocked(getDeposits).mockResolvedValue({
      ...RESPONSE,
      summary: { ...RESPONSE.summary, partial: true },
      stripe: { ...provider(), ok: false, error: 'unavailable', balance: null },
    });
    renderSection();
    const stripe = await screen.findByTestId('deposits-card-stripe');
    expect(within(stripe).getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('A receber (parcial: Stripe indisponível)')).toBeInTheDocument();
    fireEvent.click(within(stripe).getByRole('button', { name: 'Tentar novamente' }));
    expect(getDeposits).toHaveBeenCalledTimes(2);
  });

  it('warns when a provider list is truncated', async () => {
    vi.mocked(getDeposits).mockResolvedValue({
      ...RESPONSE,
      pagarme: { ...RESPONSE.pagarme, truncated: true },
    });
    renderSection();
    const pagarme = await screen.findByTestId('deposits-card-pagarme');
    expect(within(pagarme).getByText(/Lista parcial/)).toBeInTheDocument();
    expect(within(screen.getByTestId('deposits-card-stripe')).queryByText(/Lista parcial/)).toBeNull();
  });

  it('shows the section-level error when the request itself fails', async () => {
    vi.mocked(getDeposits).mockRejectedValue(new Error('boom'));
    renderSection();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('boom')).not.toBeInTheDocument();
  });

  it('shows "Nada previsto" when a provider has no upcoming rows', async () => {
    vi.mocked(getDeposits).mockResolvedValue({ ...RESPONSE, stripe: provider() });
    renderSection();
    const stripe = await screen.findByTestId('deposits-card-stripe');
    expect(within(stripe).getByText('Nada previsto')).toBeInTheDocument();
  });

  it('the "Atualizar" button refetches', async () => {
    vi.mocked(getDeposits).mockResolvedValue(RESPONSE);
    renderSection();
    await screen.findByTestId('deposits-summary');
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }));
    expect(getDeposits).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/admin/src/pages/__tests__/DepositsSection.test.tsx`
Expected: FAIL (placeholder renders null: no skeleton, no summary).

- [ ] **Step 3: Implement the component**

```tsx
// apps/admin/src/pages/metricas/DepositsSection.tsx
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Banknote, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { getDeposits, type DepositDayRow, type DepositMonthRow, type DepositProvider, type ProviderDeposits } from '../../lib/api';
import { formatMoney } from '../../lib/subscription';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import {
  NOT_CONFIGURED_SECRET,
  formatDayShort,
  formatMonth,
  payoutStatusBadge,
  providerName,
  rowDateLabel,
  scheduleCaption,
  waitingTotalLabel,
} from './deposits-view';

const PROVIDERS: DepositProvider[] = ['stripe', 'pagarme'];
const STALE_MS = 5 * 60 * 1000;

/**
 * Depósitos: when and how much each provider will deposit to the bank. Live read, nothing
 * persisted. Each provider card owns its state so a Pagar.me outage never hides Stripe.
 */
export function DepositsSection() {
  const query = useQuery({ queryKey: ['admin', 'deposits'], queryFn: getDeposits, staleTime: STALE_MS });
  const { data, isPending, isError, refetch, isFetching } = query;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Valores líquidos, já descontadas as taxas dos provedores.
          {data ? ` Atualizado ${new Date(data.generated_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.` : ''}
        </p>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : undefined} />
          Atualizar
        </Button>
      </div>

      {isError ? (
        <Card>
          <ErrorState message="Não foi possível carregar os depósitos." onRetry={() => refetch()} />
        </Card>
      ) : null}

      {isPending ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} data-testid="deposits-skeleton" className="h-24 rounded-2xl" />
          ))}
        </div>
      ) : data ? (
        <div data-testid="deposits-summary" className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatTile
            label="Próximo depósito"
            value={data.summary.next ? formatMoney(data.summary.next.amount_cents) : '—'}
            sub={
              data.summary.next
                ? `${providerName(data.summary.next.provider)} · ${formatDayShort(data.summary.next.date)}`
                : 'Nada previsto'
            }
          />
          <StatTile label="Próximos 30 dias" value={formatMoney(data.summary.next_30d_cents)} />
          <StatTile label={waitingTotalLabel(data)} value={formatMoney(data.summary.waiting_cents)} />
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {PROVIDERS.map((p) => (
          <Card key={p} data-testid={`deposits-card-${p}`}>
            <CardHeader>
              <CardTitle>{providerName(p)}</CardTitle>
              {data ? <ProviderCaption provider={p} deposits={data[p]} /> : null}
            </CardHeader>
            {isPending ? (
              <CardContent className="flex flex-col gap-3">
                <Skeleton data-testid="deposits-skeleton" className="h-5 w-2/3" />
                <Skeleton data-testid="deposits-skeleton" className="h-5 w-1/2" />
                <Skeleton data-testid="deposits-skeleton" className="h-24 w-full" />
              </CardContent>
            ) : data ? (
              <ProviderBody provider={p} deposits={data[p]} onRetry={() => refetch()} />
            ) : null}
          </Card>
        ))}
      </div>
    </div>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="glass-surface bg-card border border-border rounded-2xl p-5 min-w-0">
      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">{label}</p>
      <p className="text-2xl font-bold font-sf break-words">{value}</p>
      {sub ? <p className="text-xs text-muted-foreground mt-1">{sub}</p> : null}
    </div>
  );
}

function ProviderCaption({ provider, deposits }: { provider: DepositProvider; deposits: ProviderDeposits }) {
  if (!deposits.ok) return null;
  const caption = scheduleCaption(provider, deposits.meta);
  return caption ? <p className="text-xs text-muted-foreground">{caption}</p> : null;
}

function ProviderBody({
  provider,
  deposits,
  onRetry,
}: {
  provider: DepositProvider;
  deposits: ProviderDeposits;
  onRetry: () => void;
}) {
  if (!deposits.configured) {
    return (
      <EmptyState
        icon={Banknote}
        title="Não configurado"
        description={`Defina a secret ${NOT_CONFIGURED_SECRET[provider]} na function platform-admin para ler este provedor.`}
      />
    );
  }
  if (!deposits.ok) {
    return <ErrorState message={`Não foi possível ler ${providerName(provider)} agora.`} onRetry={onRetry} />;
  }
  const { balance, upcoming, in_transit, recent, truncated } = deposits;
  const nothingUpcoming = upcoming.next30.length === 0 && upcoming.byMonth.length === 0;

  return (
    <CardContent className="flex flex-col gap-5">
      {truncated ? (
        <p role="status" className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>Lista parcial: há mais recebíveis do que o painel lê de uma vez. Os totais abaixo estão subestimados.</span>
        </p>
      ) : null}
      {balance ? (
        <dl className="grid grid-cols-2 gap-3">
          <Field label="Disponível" value={formatMoney(balance.available_cents)} />
          <Field label="A compensar" value={formatMoney(balance.pending_cents)} />
        </dl>
      ) : null}

      <Block title="Próximos 30 dias">
        {upcoming.next30.length === 0 ? (
          <Muted>{nothingUpcoming ? 'Nada previsto' : 'Nada nos próximos 30 dias'}</Muted>
        ) : (
          <ul className="divide-y divide-border">
            {upcoming.next30.map((row) => (
              // date is unique per kind after groupByDay on both sources
              <DayRowItem key={`${row.kind}-${row.date}`} row={row} />
            ))}
          </ul>
        )}
      </Block>

      {upcoming.byMonth.length > 0 ? (
        <Block title="Meses seguintes">
          <ul className="divide-y divide-border">
            {upcoming.byMonth.map((m) => (
              <MonthRowItem key={m.month} row={m} />
            ))}
          </ul>
        </Block>
      ) : null}

      {in_transit.length > 0 ? (
        <Block title="Transferências em andamento">
          <ul className="divide-y divide-border">
            {in_transit.map((t) => {
              const badge = payoutStatusBadge(t.status);
              return (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="text-muted-foreground">
                    {t.expected_on ? `Previsto ${formatDayShort(t.expected_on)}` : 'Sem previsão'}
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge variant={badge.variant} size="sm">{badge.label}</Badge>
                    <span className="font-medium tabular-nums">{formatMoney(t.amount_cents)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </Block>
      ) : null}

      {recent.length > 0 ? (
        <Block title="Recentes">
          <ul className="divide-y divide-border">
            {recent.map((r) => {
              const badge = payoutStatusBadge(r.status);
              return (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="text-muted-foreground">{formatDayShort(r.date)}</span>
                  <span className="flex items-center gap-2">
                    <Badge variant={badge.variant} size="sm">{badge.label}</Badge>
                    <span className="font-medium tabular-nums">{formatMoney(r.amount_cents)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </Block>
      ) : null}
    </CardContent>
  );
}

function DayRowItem({ row }: { row: DepositDayRow }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2 text-sm">
      <span className="flex flex-col">
        <span>{rowDateLabel(row)}</span>
        <span className="text-xs text-muted-foreground">
          {row.kind === 'payout' ? 'Repasse já criado' : `${row.count} ${row.count === 1 ? 'item' : 'itens'}`}
        </span>
      </span>
      <NetAmount net={row.net_cents} gross={row.gross_cents} fee={row.fee_cents} />
    </li>
  );
}

function MonthRowItem({ row }: { row: DepositMonthRow }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2 text-sm">
      <span className="flex flex-col">
        <span className="capitalize">{formatMonth(row.month)}</span>
        <span className="text-xs text-muted-foreground">{row.count} {row.count === 1 ? 'item' : 'itens'}</span>
      </span>
      <NetAmount net={row.net_cents} gross={row.gross_cents} fee={row.fee_cents} />
    </li>
  );
}

/** Net in the row; gross and fee behind a tooltip, and in the accessible name so screen readers get it too. */
function NetAmount({ net, gross, fee }: { net: number; gross: number; fee: number }) {
  const detail = `Bruto ${formatMoney(gross)}, taxas ${formatMoney(fee)}`;
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span aria-label={detail} className="font-medium tabular-nums cursor-help">
            {formatMoney(net)}
          </span>
        </TooltipTrigger>
        <TooltipContent>{detail}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground py-2">{children}</p>;
}
```

- [ ] **Step 4: Run the component tests, the hex-literal test and the typecheck**

Run: `npx vitest run apps/admin/src/pages/__tests__/DepositsSection.test.tsx apps/admin/src/__tests__/no-hex-literals.test.ts apps/admin/src/pages/__tests__/MetricasPage.test.tsx`
Expected: PASS. Known-good facts if something fails: `Skeleton` spreads `...props` so `data-testid` lands on the div; `Badge` has `size="sm"`; TanStack Query is v5 (`isPending` exists); the in-transit block title is "Transferências em andamento" precisely so it never collides with the "Em trânsito" badge label.

Run: `npx tsc -p apps/admin/tsconfig.json --noEmit` → expected: no errors.

- [ ] **Step 5: Format and commit**

```bash
npm run format
git add apps/admin/src/pages/metricas/DepositsSection.tsx apps/admin/src/pages/__tests__/DepositsSection.test.tsx
git commit -m "feat(admin): seção Depósitos com resumo, cartões por provedor e estados

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Docs + full CI gate locally

**Files:**
- Modify: `CLAUDE.md` (env section, right after the `PAGARME_DASHBOARD_BASE` entry, line ~213)
- Modify: `.env.example` (right after the `PAGARME_DASHBOARD_BASE=` line, line ~86)

- [ ] **Step 1: Document the secret**

Insert after the `PAGARME_DASHBOARD_BASE=https://dash.pagar.me/merch_xxx/acc_yyy` line in `.env.example`:

```bash
# Pagar.me recipient id (rp_...) read by platform-admin get-deposits for the Admin Depósitos
# panel (balance, /payables, /transfers). Optional: unset = the Pagar.me card shows "Não
# configurado". Differs per environment (live recipient in prod, sandbox in staging).
PAGARME_RECIPIENT_ID=
```

Insert after the `PAGARME_DASHBOARD_BASE` bullet in `CLAUDE.md`:

```markdown
- `PAGARME_RECIPIENT_ID` -- id do recebedor (`rp_…`) da conta Pagar.me, usado por
  platform-admin `get-deposits` para ler saldo, recebíveis (`/payables`) e transferências
  do painel de Depósitos do Admin. Opcional, sem default: ausente, o cartão Pagar.me da
  página Métricas mostra "Não configurado" e o resto da página segue normal. Diferente
  por ambiente (recebedor live em prod, sandbox em staging). O cartão Stripe do mesmo
  painel usa `STRIPE_SECRET_KEY` (Balance, Payouts, Balance Transactions, Account)
```

- [ ] **Step 2: Run the full local gate**

```bash
npm run lint
npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
npm run check:functions
npm run test:functions
git checkout deno.lock 2>/dev/null || true
git status --short   # only CLAUDE.md and .env.example should be dirty
```

Expected: every command exits 0. If `test:functions` polluted `node_modules` (`ls node_modules/.deno`), run `npm ci` before continuing.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md .env.example
git commit -m "docs: PAGARME_RECIPIENT_ID para o painel de Depósitos do Admin

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Staging deploy + browser verification + field-shape confirmation

This task talks to real providers. It needs the staging project ref `wlyzhyfondykzpsiqsce` and the Pagar.me **sandbox** recipient id (from the Pagar.me sandbox dashboard, Recebedores). Secrets are set with the CLI reading from a file, never as inline args.

- [ ] **Step 1: Deploy the function to staging**

```bash
npx supabase functions deploy platform-admin --use-api --project-ref wlyzhyfondykzpsiqsce
```

Expected: deploy succeeds (`--use-api` avoids the broken local Docker bundler).

- [ ] **Step 2: Set the recipient secret on staging from a file**

Write the value into a scratchpad file (outside the repo) as `PAGARME_RECIPIENT_ID=rp_...`, then:

```bash
npx supabase secrets set --env-file /path/to/scratch/pagarme-recipient.env --project-ref wlyzhyfondykzpsiqsce
rm /path/to/scratch/pagarme-recipient.env
```

- [ ] **Step 3: Confirm the Pagar.me balance shape**

Run the admin against staging and read the network response:

```bash
npm run dev:admin:staging
```

Open `http://localhost:5177/admin/metricas` in the Browser pane (the worktree has no `.env.staging`: use the main checkout's script or copy `.env.staging` over; see memory `reference_worktree_env_staging_gotcha.md`). Use `read_network_requests` filtered by `platform-admin` and open the `get-deposits` response. Check:
- `pagarme.balance` is non-null. If it is `null` while the sandbox has a balance, the live shape is neither `available_amount` nor `available.amount`: note the actual field names, extend `parsePagarmeBalance` (Task 2) with that shape, add a test with the real payload, redeploy.
- `pagarme.upcoming.next30` / `byMonth` reflect the sandbox 12x subscriptions. If empty while `/payables` has rows, check the `paging` cursor field name in the raw response and fix `nextCursor`.
- `stripe.upcoming` has projected rows and `stripe.meta.schedule_interval` is `"daily"`. If `stripe.ok` is false, read the function log (`[deposits] stripe failed:`): a 400 on `available_on` means the fallback also failed; inspect the message.
- Sum of all Stripe `projected` rows (`next30` + `byMonth`) ≈ `stripe.balance.pending_cents`. A large gap means the pending sweep is picking up (or missing) transaction types it should not; compare against the raw `type` values.

- [ ] **Step 4: UI verification in the Browser pane**

- `read_page`: header "Métricas", section "Depósitos", summary strip with three tiles, two cards titled Stripe and Pagar.me.
- `read_console_messages` with `onlyErrors: true`: none.
- Screenshot both cards for the PR.
- Remove the secret (`npx supabase secrets unset PAGARME_RECIPIENT_ID --project-ref wlyzhyfondykzpsiqsce`), reload: the Pagar.me card shows "Não configurado" naming `PAGARME_RECIPIENT_ID`, the Stripe card is unaffected. Set the secret again.

- [ ] **Step 5: Cross-check numbers against the provider dashboards (user does this, record the result in the PR)**

- Stripe "A compensar" == Stripe Dashboard → Balances → Pending.
- Sum of Pagar.me next30 + byMonth == Pagar.me Dashboard → Saldo → "A receber" (sandbox).
- Next Stripe payout date/amount == Stripe Dashboard → Payouts → next.

- [ ] **Step 6: Open the PR**

```bash
git push -u origin claude/admin-metrics-dashboard-7457e0
gh pr create --title "feat(admin): página Métricas com painel de Depósitos (Stripe + Pagar.me)" --body-file /path/to/scratch/pr-body.md
```

PR body (write it to the scratch file first) must include: spec link, the screenshot, the cross-check results from Step 5, the note that **prod needs `platform-admin` redeployed and `PAGARME_RECIPIENT_ID` set BEFORE merging** (merge deploys the frontend immediately), and end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

Then wait for the external Codex review that fires on the PR, read its body, and address real findings (memory: `feedback_external_codex_pr_review.md`). Run `npm ci` after the review if `node_modules/.deno` appears.

---

## Self-review

**Spec coverage.** §1 gateways: Task 3 (all seven provider calls, timeouts, `allSettled`, generic errors). §1.2 helpers: Task 1 (`toDay`, `groupByDay`, `projectTransferDate`, `projectStripeArrival`, `splitHorizon`, `summarize`; `pickBrl` is `pickBrlAmount` inside Task 2, exercised via `buildStripeDeposits` tests). §1.3 contract: Task 1 types, mirrored in Task 4. §1.4 secret + docs: Tasks 3 and 7. §2 frontend: Task 4 (api, route, nav, `metricasPath`, page shell with `#depositos`), Task 5 (helpers), Task 6 (summary strip, cards, tables, tooltip with gross/fee, in-transit, recent, all four states, "Atualizar", `staleTime` 5 min). §3 tests: Tasks 1–6. §4 verification: Tasks 7–8. §5 (B constraints) is not implemented here by design.

**Placeholders.** None: every step has code or an exact command. The only deliberate unknown (Pagar.me balance field names) is handled by a dual-shape parser plus a confirmation step in Task 8.

**Type consistency.** `ProviderDeposits` (incl. `truncated`), `DayRow`/`DepositDayRow`, `MonthRow`/`DepositMonthRow`, `DepositsSummary` (incl. `partial`), `DepositsResponse` (incl. `currency`) have identical fields on both sides. `handleGetDeposits(headers, gateways?)` matches the `index.ts` call `handleGetDeposits(headers)`. `notConfigured()` returns `ok: false` with `configured: false`, so `summarize` neither counts it nor marks `partial`; `unavailable()` is `configured: true, ok: false` and does mark `partial`. `projectStripeArrival(availableOn, schedule)` is called with `raw.schedule` in `buildStripeDeposits`; `StripeRaw.schedule` is typed `StripeSchedule` and the gateway reads `account.settings.payouts.schedule` into it. `scheduleCaption` reads exactly the `meta` keys the builders write (`schedule_interval`, `delay_days`, `transfer_enabled`, `transfer_interval`, `transfer_day`, `anticipation_enabled`, `anticipation_type`). `waitingTotalLabel` reads `summary.partial` plus each provider's `configured`/`ok`.

**Codex spec review (2026-09-24) folded in:** Stripe schedule applied to arrival (not assumed daily); pagination caps + `truncated`; `summary.partial` + UI label; strict BRL filtering + `currency`; `deposit_on` as the single ordering/window key; `.env.example` entry; Pagar.me configured requires both secrets. The two sub-project B points (backfill environment guard, Pagar.me mapping + precedence) were added to the spec's §5 for B's brainstorm.

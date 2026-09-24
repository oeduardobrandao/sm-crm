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

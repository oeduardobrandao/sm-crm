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

/** The panel's "today" is the São Paulo business date, not the UTC one: Pagar.me stamps payables
 *  at BRT midnight (03:00Z), and Stripe's UTC-midnight `available_on` maps to the same or the
 *  next BRT day, so anchoring "today" to São Paulo is what makes both providers agree on what
 *  "today" means. Between 00:00 and 03:00 UTC the UTC calendar date is already tomorrow while
 *  it's still yesterday evening in São Paulo, which would otherwise make `splitHorizon` drop a
 *  same-day Pagar.me row as overdue. */
export function businessToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
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
    // 0..6 is a real JS UTC weekday (0 = Sunday .. 6 = Saturday) and is kept as-is, even when it
    // lands on a weekend — the business-day roll below handles that. Anything outside 0..6 (only
    // reachable from Pagar.me, whose documented range is 1..5) clamps into the Mon..Fri week.
    const raw = settings.transfer_day;
    const target = raw >= 0 && raw <= 6 ? raw : Math.min(Math.max(raw, 1), 5);
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

// Real JS UTC weekday numbers (0 = Sunday .. 6 = Saturday). A weekend anchor is kept as its real
// weekday, not clamped into the business week here -- projectTransferDate's business-day roll
// handles landing it on the following Monday.
const STRIPE_WEEKDAY: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
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
    let providerEarliest: string | null = null;
    let providerEarliestSum = 0;
    for (const r of p.upcoming.next30) {
      waiting_cents += r.net_cents;
      // A manual-withdrawal row (transfers disabled, or settings unknown) only becomes
      // AVAILABLE on deposit_on; nothing reaches the bank on its own. It is still money to
      // receive, but not a deposit forecast, so it stays out of `next` and the 30-day total.
      if (r.manual_withdrawal) continue;
      next_30d_cents += r.net_cents;
      if (providerEarliest === null || r.deposit_on < providerEarliest) {
        providerEarliest = r.deposit_on;
        providerEarliestSum = r.net_cents;
      } else if (r.deposit_on === providerEarliest) {
        providerEarliestSum += r.net_cents;
      }
    }
    for (const m of p.upcoming.byMonth) waiting_cents += m.net_cents;
    // Transfers already on their way but without a projectable landing day are still money
    // to receive; they just cannot be placed on the forecast timeline.
    for (const t of p.in_transit) waiting_cents += t.amount_cents;
    if (providerEarliest !== null && (!next || providerEarliest < next.date)) {
      next = { date: providerEarliest, amount_cents: providerEarliestSum, provider };
    }
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
/** Only a created payout's own negative transaction (type "payout") duplicates the kind=payout
 *  row already produced from payouts.list -- that one must be skipped, or it would cancel the
 *  payout row out. `payout_cancel` / `payout_failure` are the opposite: positive transactions
 *  that RETURN funds, for a payout that sits in `recent` (canceled/failed), not `upcoming`. They
 *  must count as projected funds, or a returned payout would vanish from the card entirely.
 *  Defensive, not observed: Stripe usually makes a returned payout available immediately, but if
 *  Stripe ever left one pending this is what stops it from being silently dropped. */
const PAYOUT_TXN_TYPES = new Set(["payout"]);

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
    // Pagar.me v5 returns "Daily" | "Weekly" | "Monthly" (capitalized); projectTransferDate and
    // the frontend both compare lowercase, so normalise here once instead of at every call site.
    transfer_interval: (ts.transfer_interval ?? "daily").toLowerCase(),
    transfer_day: typeof ts.transfer_day === "number" ? ts.transfer_day : null,
  };
}

/** A transfer Pagar.me already created but that hasn't landed at the bank yet. Anything else
 *  (already "transferred", "failed", etc.) is not in flight and must not appear on the card at
 *  all -- it either already happened or never will. */
const IN_FLIGHT_TRANSFER_STATUSES = new Set(["pending_transfer", "processing"]);

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

  // An in-flight transfer mirrors a Stripe pending/in_transit payout (buildStripeDeposits): the
  // provider already created it, so when we can project a landing day it belongs in `upcoming` as
  // kind=payout, not in the generic `in_transit` list -- that keeps both cards' "next deposit"
  // logic reading from the same place. A transfer whose day is unknown or already past cannot be
  // projected, so it stays in `in_transit`; the card still lists it, nothing silently disappears.
  // The payables it was funded from are already excluded above (only status "waiting_funds"
  // remains projected), so nothing here is double counted.
  const in_transit: ProviderDeposits["in_transit"] = [];
  const payoutItems: { date: string; net_cents: number; gross_cents: number; fee_cents: number }[] = [];
  for (const t of raw.transfers ?? []) {
    if (!IN_FLIGHT_TRANSFER_STATUSES.has(t.status)) continue;
    const expected_on = toDay(t.funding_estimated_date ?? t.funding_date ?? null);
    if (expected_on !== null && expected_on >= today) {
      payoutItems.push({ date: expected_on, net_cents: t.amount, gross_cents: t.amount, fee_cents: 0 });
    } else {
      in_transit.push({ id: t.id, amount_cents: t.amount, expected_on, status: t.status });
    }
  }
  for (const [date, tot] of groupByDay(payoutItems)) {
    rows.push({ date, deposit_on: date, ...tot, kind: "payout" });
  }

  const split = splitHorizon(rows, today);

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

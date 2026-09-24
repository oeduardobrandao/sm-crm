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
import {
  buildPagarmeDeposits,
  buildStripeDeposits,
  parsePagarmeBalance,
  type PagarmeRaw,
  type StripeRaw,
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

Deno.test("summarize: same-day rows of the chosen provider are summed into next.amount_cents", () => {
  const stripe = provider({
    upcoming: {
      next30: [
        { ...row("2026-09-25", 300), kind: "payout" },
        row("2026-09-26", 700, "2026-09-25"),
        row("2026-09-29", 50),
      ],
      byMonth: [],
    },
  });
  const pagarme = provider({ upcoming: { next30: [row("2026-09-26", 999)], byMonth: [] } });
  assertEquals(summarize({ stripe, pagarme }).next, { date: "2026-09-25", amount_cents: 1000, provider: "stripe" });
});

Deno.test("summarize: provider tie on the earliest date keeps the first provider, amounts never merge across providers", () => {
  const stripe = provider({ upcoming: { next30: [row("2026-09-25", 100)], byMonth: [] } });
  const pagarme = provider({ upcoming: { next30: [row("2026-09-25", 250)], byMonth: [] } });
  assertEquals(summarize({ stripe, pagarme }).next, { date: "2026-09-25", amount_cents: 100, provider: "stripe" });
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

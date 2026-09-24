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

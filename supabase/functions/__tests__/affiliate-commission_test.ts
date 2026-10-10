import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  applyCommissionAdjustment,
  commissionAvailableAt,
  commissionWindowShare,
  computeCommissionCents,
  disputeClosedIsLoss,
  invoicePriceId,
  recordInvoiceCommission,
  resolveChargeInvoiceId,
} from "../_shared/affiliate-commission.ts";

const PAID_AT = 1_790_000_000; // unix seconds
const PLANS = [
  { id: "start", stripe_price_id: "price_start_m", stripe_price_id_annual: "price_start_y" },
  { id: "pro", stripe_price_id: "price_pro_m", stripe_price_id_annual: "price_pro_y" },
];
const NO_FETCH = {
  retrieveInvoicePriceId: () => Promise.reject(new Error("should not re-read the invoice")),
};

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: "in_1",
    customer: "cus_1",
    amount_paid: 9990,
    currency: "brl",
    billing_reason: "subscription_cycle",
    status_transitions: { paid_at: PAID_AT },
    lines: { data: [{ amount: 9990, price: { id: "price_pro_m" } }] },
    ...overrides,
  };
}

/** Queues the happy path up to (not including) the commission upsert. */
function queueReferral(
  db: ReturnType<typeof createSupabaseQueryMock>,
  opts: { rule?: unknown; prior?: Array<{ covered_months: number }> } = {},
) {
  db.queue("workspace_subscriptions", "select", { data: { workspace_id: "ws-1" } });
  db.queue("affiliate_referrals", "select", { data: { affiliate_id: "aff-1" } });
  db.queue("affiliates", "select", { data: { id: "aff-1", status: "active" } });
  db.queue("plans", "select", { data: PLANS });
  db.queue("affiliate_commission_rules", "select", {
    data: "rule" in opts ? opts.rule : { rate_bps: 2500, months: 3 },
  });
  db.queue("affiliate_commissions", "select", { data: opts.prior ?? [] });
}

function upsertPayload(db: ReturnType<typeof createSupabaseQueryMock>) {
  const call = db.calls.find((c) => c.table === "affiliate_commissions" && c.operation === "upsert");
  return call?.payload as Record<string, unknown> | undefined;
}

Deno.test("computeCommissionCents: rate rounded down, zero for junk", () => {
  assertEquals(computeCommissionCents(9990, 2500), 2497);
  assertEquals(computeCommissionCents(4990, 3000), 1497);
  assertEquals(computeCommissionCents(0, 2000), 0);
  assertEquals(computeCommissionCents(9990, 0), 0);
  assertEquals(computeCommissionCents(-5, 2000), 0);
  assertEquals(computeCommissionCents(Number.NaN, 2000), 0);
});

Deno.test("commissionAvailableAt: 30-day hold", () => {
  const paid = new Date("2026-10-01T12:00:00Z");
  assertEquals(commissionAvailableAt(paid).toISOString(), "2026-10-31T12:00:00.000Z");
});

Deno.test("invoicePriceId: acacia, basil and proration shapes", () => {
  assertEquals(invoicePriceId({ lines: { data: [{ amount: 100, price: { id: "p1" } }] } }), "p1");
  assertEquals(
    invoicePriceId({ lines: { data: [{ amount: 100, pricing: { price_details: { price: "p2" } } }] } }),
    "p2",
  );
  // Proration: credit for the old plan (negative) + charge for the new one.
  assertEquals(
    invoicePriceId({
      lines: { data: [{ amount: -4990, price: { id: "old" } }, { amount: 9990, price: { id: "new" } }] },
    }),
    "new",
  );
  assertEquals(invoicePriceId({ lines: { data: [] } }), null);
  assertEquals(invoicePriceId({}), null);
});

Deno.test("commissionWindowShare: monthly, annual, proration and a closed window", () => {
  const base = { amountCents: 9990, interval: "month" as const, billingReason: "subscription_cycle", windowMonths: 3 };
  assertEquals(commissionWindowShare({ ...base, monthsUsed: 0 }), { commissionableCents: 9990, coveredMonths: 1 });
  assertEquals(commissionWindowShare({ ...base, monthsUsed: 2 }), { commissionableCents: 9990, coveredMonths: 1 });
  assertEquals(commissionWindowShare({ ...base, monthsUsed: 3 }), null);
  // Annual paid upfront: only 3 of the 12 months are inside the window.
  assertEquals(
    commissionWindowShare({ ...base, interval: "year", amountCents: 95880, monthsUsed: 0 }),
    { commissionableCents: 23970, coveredMonths: 3 },
  );
  // Upgrade proration inside the window: whole invoice, consumes no month.
  assertEquals(
    commissionWindowShare({ ...base, billingReason: "subscription_update", amountCents: 3000, monthsUsed: 1 }),
    { commissionableCents: 3000, coveredMonths: 0 },
  );
  assertEquals(commissionWindowShare({ ...base, billingReason: "subscription_update", monthsUsed: 3 }), null);
});

Deno.test("recordInvoiceCommission: trial invoice (zero) touches nothing", async () => {
  const db = createSupabaseQueryMock();
  const out = await recordInvoiceCommission(db as unknown as SupabaseClient, invoice({ amount_paid: 0 }), PAID_AT, NO_FETCH);
  assertEquals(out, "skipped:zero_amount");
  assertEquals(db.calls.length, 0);
});

Deno.test("recordInvoiceCommission: workspace without referral is a no-op", async () => {
  const db = createSupabaseQueryMock();
  db.queue("workspace_subscriptions", "select", { data: { workspace_id: "ws-1" } });
  db.queue("affiliate_referrals", "select", { data: null });
  const out = await recordInvoiceCommission(db as unknown as SupabaseClient, invoice(), PAID_AT, NO_FETCH);
  assertEquals(out, "skipped:no_referral");
  assert(!db.calls.some((c) => c.table === "affiliate_commissions"));
});

Deno.test("recordInvoiceCommission: suspended affiliate earns nothing", async () => {
  const db = createSupabaseQueryMock();
  db.queue("workspace_subscriptions", "select", { data: { workspace_id: "ws-1" } });
  db.queue("affiliate_referrals", "select", { data: { affiliate_id: "aff-1" } });
  db.queue("affiliates", "select", { data: { id: "aff-1", status: "suspended" } });
  const out = await recordInvoiceCommission(db as unknown as SupabaseClient, invoice(), PAID_AT, NO_FETCH);
  assertEquals(out, "skipped:affiliate_inactive");
  assert(!db.calls.some((c) => c.table === "affiliate_commissions"));
});

Deno.test("recordInvoiceCommission: Pro month 1 records 25% with the 30-day hold", async () => {
  const db = createSupabaseQueryMock();
  queueReferral(db);
  db.queue("affiliate_commissions", "upsert", { data: null });

  const out = await recordInvoiceCommission(db as unknown as SupabaseClient, invoice({ currency: "BRL" }), 1, NO_FETCH);
  assertEquals(out, "recorded");

  const call = db.calls.find((c) => c.table === "affiliate_commissions" && c.operation === "upsert")!;
  assertEquals(call.options, { onConflict: "stripe_invoice_id", ignoreDuplicates: true });
  const payload = upsertPayload(db)!;
  assertEquals(payload.affiliate_id, "aff-1");
  assertEquals(payload.workspace_id, "ws-1");
  assertEquals(payload.plan_id, "pro");
  assertEquals(payload.currency, "brl");
  assertEquals(payload.invoice_amount_cents, 9990);
  assertEquals(payload.commissionable_cents, 9990);
  assertEquals(payload.covered_months, 1);
  assertEquals(payload.rate_bps, 2500);
  assertEquals(payload.commission_cents, 2497);
  // paid_at comes from the invoice, not the event timestamp.
  assertEquals(payload.paid_at, new Date(PAID_AT * 1000).toISOString());
  assertEquals(payload.available_at, commissionAvailableAt(new Date(PAID_AT * 1000)).toISOString());

  const rule = db.calls.find((c) => c.table === "affiliate_commission_rules")!;
  assert(rule.modifiers.some((m) => m.method === "eq" && m.args[0] === "plan_id" && m.args[1] === "pro"));
  const window = db.calls.find((c) => c.table === "affiliate_commissions" && c.operation === "select")!;
  assert(window.modifiers.some((m) => m.method === "neq" && m.args[0] === "stripe_invoice_id" && m.args[1] === "in_1"));
});

Deno.test("recordInvoiceCommission: 4th paid month is outside the 3-month window", async () => {
  const db = createSupabaseQueryMock();
  queueReferral(db, { prior: [{ covered_months: 1 }, { covered_months: 1 }, { covered_months: 1 }] });
  const out = await recordInvoiceCommission(db as unknown as SupabaseClient, invoice(), PAID_AT, NO_FETCH);
  assertEquals(out, "skipped:window_closed");
  assertEquals(upsertPayload(db), undefined);
});

Deno.test("recordInvoiceCommission: annual Start upfront commissions 3/12 at 30%", async () => {
  const db = createSupabaseQueryMock();
  queueReferral(db, { rule: { rate_bps: 3000, months: 3 } });
  db.queue("affiliate_commissions", "upsert", { data: null });
  const out = await recordInvoiceCommission(
    db as unknown as SupabaseClient,
    invoice({
      amount_paid: 47880,
      billing_reason: "subscription_create",
      lines: { data: [{ amount: 47880, price: { id: "price_start_y" } }] },
    }),
    PAID_AT,
    NO_FETCH,
  );
  assertEquals(out, "recorded");
  const payload = upsertPayload(db)!;
  assertEquals(payload.plan_id, "start");
  assertEquals(payload.commissionable_cents, 11970);
  assertEquals(payload.covered_months, 3);
  assertEquals(payload.commission_cents, 3591);
});

Deno.test("recordInvoiceCommission: re-reads the invoice when the payload has no price", async () => {
  const db = createSupabaseQueryMock();
  queueReferral(db);
  db.queue("affiliate_commissions", "upsert", { data: null });
  let reads = 0;
  const out = await recordInvoiceCommission(
    db as unknown as SupabaseClient,
    invoice({ lines: undefined }),
    PAID_AT,
    { retrieveInvoicePriceId: (id) => (reads++, Promise.resolve(id === "in_1" ? "price_pro_m" : null)) },
  );
  assertEquals(out, "recorded");
  assertEquals(reads, 1);
});

Deno.test("recordInvoiceCommission: unknown price or plan without rule earns nothing", async () => {
  const unknown = createSupabaseQueryMock();
  unknown.queue("workspace_subscriptions", "select", { data: { workspace_id: "ws-1" } });
  unknown.queue("affiliate_referrals", "select", { data: { affiliate_id: "aff-1" } });
  unknown.queue("affiliates", "select", { data: { id: "aff-1", status: "active" } });
  unknown.queue("plans", "select", { data: PLANS });
  const out1 = await recordInvoiceCommission(
    unknown as unknown as SupabaseClient,
    invoice({ lines: { data: [{ amount: 9990, price: { id: "price_other" } }] } }),
    PAID_AT,
    NO_FETCH,
  );
  assertEquals(out1, "skipped:unknown_plan");

  const noRule = createSupabaseQueryMock();
  queueReferral(noRule, { rule: null });
  const out2 = await recordInvoiceCommission(noRule as unknown as SupabaseClient, invoice(), PAID_AT, NO_FETCH);
  assertEquals(out2, "skipped:no_rule");
});

Deno.test("recordInvoiceCommission: a failed read throws so Stripe redelivers", async () => {
  const db = createSupabaseQueryMock();
  db.queue("workspace_subscriptions", "select", { data: null, error: { message: "boom" } });
  let threw = false;
  try {
    await recordInvoiceCommission(db as unknown as SupabaseClient, invoice(), PAID_AT, NO_FETCH);
  } catch {
    threw = true;
  }
  assert(threw, "expected a throw");
});

Deno.test("recordInvoiceCommission: a failed insert throws", async () => {
  const db = createSupabaseQueryMock();
  queueReferral(db);
  db.queue("affiliate_commissions", "upsert", { data: null, error: { message: "boom" } });
  let threw = false;
  try {
    await recordInvoiceCommission(db as unknown as SupabaseClient, invoice(), PAID_AT, NO_FETCH);
  } catch {
    threw = true;
  }
  assert(threw, "expected a throw");
});

Deno.test("applyCommissionAdjustment: writes the cumulative refund and the dispute flag", async () => {
  const db = createSupabaseQueryMock();
  db.queue("affiliate_commissions", "update", { data: [{ id: "c1" }] });
  const changed = await applyCommissionAdjustment(db as unknown as SupabaseClient, "in_1", {
    refundedAmountCents: 4995,
  });
  assertEquals(changed, true);
  const payload = db.calls[0].payload as Record<string, unknown>;
  assertEquals(payload.refunded_amount_cents, 4995);
  assert(!("disputed" in payload));
  assert(db.calls[0].modifiers.some((m) => m.method === "eq" && m.args[0] === "stripe_invoice_id" && m.args[1] === "in_1"));
});

Deno.test("applyCommissionAdjustment: nothing to change makes no call", async () => {
  const db = createSupabaseQueryMock();
  assertEquals(await applyCommissionAdjustment(db as unknown as SupabaseClient, "in_1", {}), false);
  assertEquals(db.calls.length, 0);
});

Deno.test("disputeClosedIsLoss: only 'lost' keeps the commission zeroed", () => {
  assertEquals(disputeClosedIsLoss("lost"), true);
  assertEquals(disputeClosedIsLoss("won"), false);
  assertEquals(disputeClosedIsLoss("warning_closed"), false);
  assertEquals(disputeClosedIsLoss(null), false);
});

Deno.test("resolveChargeInvoiceId: payload field wins, null means standalone, absent re-reads", async () => {
  let reads = 0;
  const retrieve = (_id: string) => {
    reads++;
    return Promise.resolve({ invoice: "in_fresh" });
  };
  assertEquals(await resolveChargeInvoiceId({ id: "ch_1", invoice: "in_1" }, retrieve), "in_1");
  assertEquals(await resolveChargeInvoiceId({ id: "ch_1", invoice: { id: "in_2" } }, retrieve), "in_2");
  assertEquals(await resolveChargeInvoiceId({ id: "ch_1", invoice: null }, retrieve), null);
  assertEquals(reads, 0);
  assertEquals(await resolveChargeInvoiceId({ id: "ch_1" }, retrieve), "in_fresh");
  assertEquals(reads, 1);
});

import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  applyCommissionAdjustment,
  commissionAvailableAt,
  computeCommissionCents,
  disputeClosedIsLoss,
  recordInvoiceCommission,
  resolveChargeInvoiceId,
} from "../_shared/affiliate-commission.ts";

const PAID_AT = 1_790_000_000; // unix seconds

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: "in_1",
    customer: "cus_1",
    amount_paid: 9990,
    currency: "brl",
    status_transitions: { paid_at: PAID_AT },
    ...overrides,
  };
}

Deno.test("computeCommissionCents: 20% rounded down, zero for junk", () => {
  assertEquals(computeCommissionCents(9990, 2000), 1998);
  assertEquals(computeCommissionCents(9999, 2000), 1999);
  assertEquals(computeCommissionCents(0, 2000), 0);
  assertEquals(computeCommissionCents(9990, 0), 0);
  assertEquals(computeCommissionCents(-5, 2000), 0);
  assertEquals(computeCommissionCents(Number.NaN, 2000), 0);
});

Deno.test("commissionAvailableAt: 30-day hold", () => {
  const paid = new Date("2026-10-01T12:00:00Z");
  assertEquals(commissionAvailableAt(paid).toISOString(), "2026-10-31T12:00:00.000Z");
});

Deno.test("recordInvoiceCommission: trial invoice (zero) touches nothing", async () => {
  const db = createSupabaseQueryMock();
  const out = await recordInvoiceCommission(db as unknown as SupabaseClient, invoice({ amount_paid: 0 }), PAID_AT);
  assertEquals(out, "skipped:zero_amount");
  assertEquals(db.calls.length, 0);
});

Deno.test("recordInvoiceCommission: workspace without referral is a no-op", async () => {
  const db = createSupabaseQueryMock();
  db.queue("workspace_subscriptions", "select", { data: { workspace_id: "ws-1" } });
  db.queue("affiliate_referrals", "select", { data: null });
  const out = await recordInvoiceCommission(db as unknown as SupabaseClient, invoice(), PAID_AT);
  assertEquals(out, "skipped:no_referral");
  assert(!db.calls.some((c) => c.table === "affiliate_commissions"));
});

Deno.test("recordInvoiceCommission: suspended affiliate earns nothing", async () => {
  const db = createSupabaseQueryMock();
  db.queue("workspace_subscriptions", "select", { data: { workspace_id: "ws-1" } });
  db.queue("affiliate_referrals", "select", { data: { affiliate_id: "aff-1" } });
  db.queue("affiliates", "select", { data: { id: "aff-1", status: "suspended", commission_rate_bps: 2000 } });
  const out = await recordInvoiceCommission(db as unknown as SupabaseClient, invoice(), PAID_AT);
  assertEquals(out, "skipped:affiliate_inactive");
  assert(!db.calls.some((c) => c.table === "affiliate_commissions"));
});

Deno.test("recordInvoiceCommission: records 20% once per invoice with the 30-day hold", async () => {
  const db = createSupabaseQueryMock();
  db.queue("workspace_subscriptions", "select", { data: { workspace_id: "ws-1" } });
  db.queue("affiliate_referrals", "select", { data: { affiliate_id: "aff-1" } });
  db.queue("affiliates", "select", { data: { id: "aff-1", status: "active", commission_rate_bps: 2000 } });
  db.queue("affiliate_commissions", "upsert", { data: null });

  const out = await recordInvoiceCommission(db as unknown as SupabaseClient, invoice({ currency: "BRL" }), 1);
  assertEquals(out, "recorded");

  const call = db.calls.find((c) => c.table === "affiliate_commissions");
  assert(call, "commission upsert expected");
  assertEquals(call.options, { onConflict: "stripe_invoice_id", ignoreDuplicates: true });
  const payload = call.payload as Record<string, unknown>;
  assertEquals(payload.affiliate_id, "aff-1");
  assertEquals(payload.workspace_id, "ws-1");
  assertEquals(payload.stripe_invoice_id, "in_1");
  assertEquals(payload.currency, "brl");
  assertEquals(payload.invoice_amount_cents, 9990);
  assertEquals(payload.rate_bps, 2000);
  assertEquals(payload.commission_cents, 1998);
  // paid_at comes from the invoice, not the event timestamp.
  assertEquals(payload.paid_at, new Date(PAID_AT * 1000).toISOString());
  assertEquals(payload.available_at, commissionAvailableAt(new Date(PAID_AT * 1000)).toISOString());

  const subRead = db.calls.find((c) => c.table === "workspace_subscriptions");
  assert(subRead?.modifiers.some((m) => m.method === "eq" && m.args[0] === "stripe_customer_id" && m.args[1] === "cus_1"));
});

Deno.test("recordInvoiceCommission: a failed read throws so Stripe redelivers", async () => {
  const db = createSupabaseQueryMock();
  db.queue("workspace_subscriptions", "select", { data: null, error: { message: "boom" } });
  let threw = false;
  try {
    await recordInvoiceCommission(db as unknown as SupabaseClient, invoice(), PAID_AT);
  } catch {
    threw = true;
  }
  assert(threw, "expected a throw");
});

Deno.test("recordInvoiceCommission: a failed insert throws", async () => {
  const db = createSupabaseQueryMock();
  db.queue("workspace_subscriptions", "select", { data: { workspace_id: "ws-1" } });
  db.queue("affiliate_referrals", "select", { data: { affiliate_id: "aff-1" } });
  db.queue("affiliates", "select", { data: { id: "aff-1", status: "active", commission_rate_bps: 2000 } });
  db.queue("affiliate_commissions", "upsert", { data: null, error: { message: "boom" } });
  let threw = false;
  try {
    await recordInvoiceCommission(db as unknown as SupabaseClient, invoice(), PAID_AT);
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

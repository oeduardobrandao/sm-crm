import { assertEquals } from "./assert.ts";
import {
  buildReconcileColumns,
  extractChargeAttempt,
  extractChargeSubscriptionId,
  isTerminalRemoteStatus,
  parseWebhookEnvelope,
  selectPagarmeDunningStage,
  shouldSendTerminalDunningEmail,
} from "../pagarme-webhook/logic.ts";

const NOW = new Date("2026-08-12T12:00:00Z");

// ─── parseWebhookEnvelope ──────────────────────────────────────────────────

Deno.test("parseWebhookEnvelope: valid envelope keeps id/type/data, drops account/created_at", () => {
  const raw = {
    id: "hook_1",
    account: {},
    type: "charge.paid",
    created_at: "2026-08-12T12:00:00Z",
    data: { id: "ch_1" },
  };
  assertEquals(parseWebhookEnvelope(raw), {
    id: "hook_1",
    type: "charge.paid",
    data: { id: "ch_1" },
  });
});

Deno.test("parseWebhookEnvelope: non-object roots are null", () => {
  for (const raw of [null, "str", []]) {
    assertEquals(parseWebhookEnvelope(raw), null, JSON.stringify(raw));
  }
});

Deno.test("parseWebhookEnvelope: missing/invalid id, type or data is null", () => {
  const cases: Array<[unknown, string]> = [
    [{ type: "x", data: {} }, "missing id"],
    [{ id: "", type: "x", data: {} }, "empty id"],
    [{ id: "h", data: {} }, "missing type"],
    [{ id: "h", type: "x" }, "missing data"],
    [{ id: "h", type: "x", data: [] }, "array data"],
  ];
  for (const [raw, label] of cases) {
    assertEquals(parseWebhookEnvelope(raw), null, label);
  }
});

// ─── extractChargeSubscriptionId ───────────────────────────────────────────

Deno.test("extractChargeSubscriptionId: reads invoice.subscription_id", () => {
  assertEquals(extractChargeSubscriptionId({ invoice: { subscription_id: "sub_A" } }), "sub_A");
});

Deno.test("extractChargeSubscriptionId: reads invoice.subscriptionId (alternative casing)", () => {
  assertEquals(extractChargeSubscriptionId({ invoice: { subscriptionId: "sub_B" } }), "sub_B");
});

Deno.test("extractChargeSubscriptionId: reads subscription.id", () => {
  assertEquals(extractChargeSubscriptionId({ subscription: { id: "sub_C" } }), "sub_C");
});

Deno.test("extractChargeSubscriptionId: reads top-level subscription_id", () => {
  assertEquals(extractChargeSubscriptionId({ subscription_id: "sub_D" }), "sub_D");
});

Deno.test("extractChargeSubscriptionId: invoice.subscription_id takes precedence over top-level subscription_id", () => {
  assertEquals(
    extractChargeSubscriptionId({ invoice: { subscription_id: "sub_A" }, subscription_id: "sub_D" }),
    "sub_A",
  );
});

Deno.test("extractChargeSubscriptionId: a non sub_ prefixed value never resolves", () => {
  assertEquals(extractChargeSubscriptionId({ invoice: { subscription_id: "inv_X" } }), null);
});

Deno.test("extractChargeSubscriptionId: empty data is null", () => {
  assertEquals(extractChargeSubscriptionId({}), null);
});

// ─── extractChargeAttempt ───────────────────────────────────────────────────

Deno.test("extractChargeAttempt: reads last_transaction.attempt_count", () => {
  assertEquals(extractChargeAttempt({ last_transaction: { attempt_count: 3 } }), 3);
});

Deno.test("extractChargeAttempt: reads attempt_count and attempt fallbacks", () => {
  assertEquals(extractChargeAttempt({ attempt_count: 2 }), 2);
  assertEquals(extractChargeAttempt({ attempt: 1 }), 1);
});

Deno.test("extractChargeAttempt: a non-number value never counts, and empty data is null", () => {
  assertEquals(extractChargeAttempt({ last_transaction: { attempt_count: "3" } }), null);
  assertEquals(extractChargeAttempt({}), null);
});

// ─── isTerminalRemoteStatus ─────────────────────────────────────────────────

Deno.test("isTerminalRemoteStatus: canceled and failed are terminal, others are not", () => {
  assertEquals(isTerminalRemoteStatus("canceled"), true);
  assertEquals(isTerminalRemoteStatus("failed"), true);
  assertEquals(isTerminalRemoteStatus("active"), false);
  assertEquals(isTerminalRemoteStatus("future"), false);
  assertEquals(isTerminalRemoteStatus("paused"), false);
});

// ─── selectPagarmeDunningStage ──────────────────────────────────────────────

Deno.test("selectPagarmeDunningStage: 0/1 is first, 2+ is retry, never final", () => {
  assertEquals(selectPagarmeDunningStage(0), "first");
  assertEquals(selectPagarmeDunningStage(1), "first");
  assertEquals(selectPagarmeDunningStage(2), "retry");
  assertEquals(selectPagarmeDunningStage(7), "retry");
});

// ─── buildReconcileColumns ───────────────────────────────────────────────────

Deno.test("buildReconcileColumns: full active resets the dunning episode and the dunning key", () => {
  const result = buildReconcileColumns(
    {
      status: "active",
      current_cycle: { end_at: "2027-08-10T23:59:59Z", status: "billed" },
      next_billing_at: "2027-08-11T00:00:00Z",
    },
    { status: "trialing", current_period_end: "2026-09-11T00:00:00Z" },
    "subscription",
    NOW,
  );
  assertEquals(result, {
    status: "active",
    planEligible: true,
    columns: {
      status: "active",
      current_period_end: "2027-08-10T23:59:59Z",
      cancel_at_period_end: false,
      past_due_since: null,
      next_payment_attempt: null,
      failed_payment_count: 0,
      pagarme_dunning_key: null,
      updated_at: "2026-08-12T12:00:00.000Z",
    },
  });
});

Deno.test("buildReconcileColumns: future subscription maps to trialing with start_at as current_period_end", () => {
  const result = buildReconcileColumns(
    { status: "future", start_at: "2026-09-11T00:00:00Z" },
    { status: null, current_period_end: null },
    "subscription",
    NOW,
  );
  assertEquals(result, {
    status: "trialing",
    planEligible: true,
    columns: {
      status: "trialing",
      current_period_end: "2026-09-11T00:00:00Z",
      cancel_at_period_end: false,
      past_due_since: null,
      next_payment_attempt: null,
      failed_payment_count: 0,
      pagarme_dunning_key: null,
      updated_at: "2026-08-12T12:00:00.000Z",
    },
  });
});

Deno.test("buildReconcileColumns: canceled-but-paid-through retains current_period_end, sets cancel_at_period_end, writes no recovery fields", () => {
  const result = buildReconcileColumns(
    {
      status: "canceled",
      current_cycle: { end_at: "2027-08-10T23:59:59Z", status: "billed" },
    },
    { status: "active", current_period_end: "2027-08-10T23:59:59Z" },
    "subscription",
    NOW,
  );
  assertEquals(result?.status, "canceled");
  assertEquals(result?.planEligible, true);
  assertEquals(result?.columns, {
    status: "canceled",
    current_period_end: "2027-08-10T23:59:59Z",
    cancel_at_period_end: true,
    updated_at: "2026-08-12T12:00:00.000Z",
  });
  assertEquals("past_due_since" in (result?.columns ?? {}), false);
});

Deno.test("buildReconcileColumns: canceled trial (no current_cycle) never sets cancel_at_period_end, retains current_period_end", () => {
  const result = buildReconcileColumns(
    { status: "canceled" },
    { status: "trialing", current_period_end: "2026-09-11T00:00:00Z" },
    "subscription",
    NOW,
  );
  assertEquals(result?.columns.cancel_at_period_end, false);
  assertEquals(result?.columns.current_period_end, "2026-09-11T00:00:00Z");
});

Deno.test("buildReconcileColumns: subscription.* observing active while past_due holds the dunning episode (no status/recovery write)", () => {
  const result = buildReconcileColumns(
    {
      status: "active",
      current_cycle: { end_at: "2027-08-10T23:59:59Z", status: "billed" },
    },
    { status: "past_due", current_period_end: "2026-08-10T00:00:00Z" },
    "subscription",
    NOW,
  );
  assertEquals(result?.planEligible, false);
  assertEquals(result?.columns, {
    current_period_end: "2027-08-10T23:59:59Z",
    cancel_at_period_end: false,
    updated_at: "2026-08-12T12:00:00.000Z",
  });
  assertEquals("status" in (result?.columns ?? {}), false);
  assertEquals("past_due_since" in (result?.columns ?? {}), false);
});

Deno.test("buildReconcileColumns: charge.paid closes a dunning episode even while remote is active", () => {
  const result = buildReconcileColumns(
    {
      status: "active",
      current_cycle: { end_at: "2027-08-10T23:59:59Z", status: "billed" },
    },
    { status: "past_due", current_period_end: "2026-08-10T00:00:00Z" },
    "charge_paid",
    NOW,
  );
  assertEquals(result, {
    status: "active",
    planEligible: true,
    columns: {
      status: "active",
      current_period_end: "2027-08-10T23:59:59Z",
      cancel_at_period_end: false,
      past_due_since: null,
      next_payment_attempt: null,
      failed_payment_count: 0,
      pagarme_dunning_key: null,
      updated_at: "2026-08-12T12:00:00.000Z",
    },
  });
});

Deno.test("buildReconcileColumns: an unrecognized remote status returns null", () => {
  const result = buildReconcileColumns(
    { status: "paused" },
    { status: null, current_period_end: null },
    "subscription",
    NOW,
  );
  assertEquals(result, null);
});

Deno.test("buildReconcileColumns: remote failed normalizes to canceled and retains the stored period", () => {
  const result = buildReconcileColumns(
    { status: "failed" },
    { status: "past_due", current_period_end: "2026-08-10T00:00:00Z" },
    "subscription",
    NOW,
  );
  assertEquals(result?.status, "canceled");
  assertEquals(result?.columns.cancel_at_period_end, false);
  assertEquals(result?.columns.current_period_end, "2026-08-10T00:00:00Z");
});

// ─── shouldSendTerminalDunningEmail ─────────────────────────────────────────

Deno.test("shouldSendTerminalDunningEmail: remote failed on a trialing row (first charge ever) is genuine", () => {
  assertEquals(
    shouldSendTerminalDunningEmail("failed", { status: "trialing", past_due_since: null }),
    true,
  );
});

Deno.test("shouldSendTerminalDunningEmail: remote canceled with an open past_due episode is genuine", () => {
  assertEquals(
    shouldSendTerminalDunningEmail("canceled", {
      status: "past_due",
      past_due_since: "2026-08-11T00:00:00Z",
    }),
    true,
  );
});

Deno.test("shouldSendTerminalDunningEmail: remote canceled on a healthy active row is a voluntary cancel racing a late failure — never sends", () => {
  assertEquals(
    shouldSendTerminalDunningEmail("canceled", { status: "active", past_due_since: null }),
    false,
  );
});

Deno.test("shouldSendTerminalDunningEmail: remote canceled with a stamped past_due_since (even off past_due status) proves an open episode", () => {
  assertEquals(
    shouldSendTerminalDunningEmail("canceled", {
      status: "active",
      past_due_since: "2026-08-11T00:00:00Z",
    }),
    true,
  );
});

Deno.test("shouldSendTerminalDunningEmail: a row already canceled was already notified or voluntarily canceled — never resends", () => {
  assertEquals(
    shouldSendTerminalDunningEmail("failed", {
      status: "canceled",
      past_due_since: "2026-08-11T00:00:00Z",
    }),
    false,
  );
});

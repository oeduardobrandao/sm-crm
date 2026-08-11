import { assert, assertEquals } from "./assert.ts";
import {
  aggregateMrr,
  extractInvoiceSubscriptionId,
  hasEverSubscribed,
  isMrrStatus,
  resolvePlanFromPriceId,
  statusToPlanId,
  toMonthlyCents,
} from "../_shared/billing-logic.ts";

Deno.test("statusToPlanId: active/trialing grant the subscribed plan", () => {
  assertEquals(statusToPlanId("active", "pro", "free"), "pro");
  assertEquals(statusToPlanId("trialing", "starter", "free"), "starter");
});

Deno.test("statusToPlanId: past_due/incomplete leave plan unchanged (null)", () => {
  assertEquals(statusToPlanId("past_due", "pro", "free"), null);
  assertEquals(statusToPlanId("incomplete", "pro", "free"), null);
});

Deno.test("statusToPlanId: terminal statuses downgrade to default", () => {
  for (const s of ["canceled", "unpaid", "incomplete_expired", "paused"]) {
    assertEquals(statusToPlanId(s, "pro", "free"), "free");
  }
});

Deno.test("statusToPlanId: unknown status leaves plan unchanged", () => {
  assertEquals(statusToPlanId("future_status", "pro", "free"), null);
});

Deno.test("resolvePlanFromPriceId: matches monthly and annual prices", () => {
  const plans = [
    { id: "starter", stripe_price_id: "price_s_m", stripe_price_id_annual: "price_s_y" },
    { id: "pro", stripe_price_id: "price_p_m", stripe_price_id_annual: "price_p_y" },
  ];
  assertEquals(resolvePlanFromPriceId("price_p_m", plans), { plan_id: "pro", interval: "month" });
  assertEquals(resolvePlanFromPriceId("price_s_y", plans), { plan_id: "starter", interval: "year" });
  assert(resolvePlanFromPriceId("price_unknown", plans) === null);
});

// ─── hasEverSubscribed ────────────────────────────────────────────────────────

Deno.test("hasEverSubscribed: null/undefined row is false", () => {
  assertEquals(hasEverSubscribed(null), false);
  assertEquals(hasEverSubscribed(undefined), false);
});

Deno.test("hasEverSubscribed: only stripe_subscription_id set is true", () => {
  assertEquals(
    hasEverSubscribed({
      ever_subscribed_at: null,
      stripe_subscription_id: "sub_123",
      pagarme_subscription_id: null,
    }),
    true,
  );
});

Deno.test("hasEverSubscribed: only pagarme_subscription_id set is true", () => {
  assertEquals(
    hasEverSubscribed({
      ever_subscribed_at: null,
      stripe_subscription_id: null,
      pagarme_subscription_id: "sub_pg_123",
    }),
    true,
  );
});

Deno.test("hasEverSubscribed: only ever_subscribed_at set is true", () => {
  assertEquals(
    hasEverSubscribed({
      ever_subscribed_at: "2026-01-01T00:00:00.000Z",
      stripe_subscription_id: null,
      pagarme_subscription_id: null,
    }),
    true,
  );
});

Deno.test("hasEverSubscribed: none set is false", () => {
  assertEquals(
    hasEverSubscribed({
      ever_subscribed_at: null,
      stripe_subscription_id: null,
      pagarme_subscription_id: null,
    }),
    false,
  );
});

// ─── MRR helpers ─────────────────────────────────────────────────────────────

Deno.test("isMrrStatus: active/past_due count; trialing and terminal states do not", () => {
  assert(isMrrStatus("active"));
  assert(isMrrStatus("past_due"));
  for (
    const s of [
      "trialing",
      "canceled",
      "unpaid",
      "incomplete",
      "incomplete_expired",
      "paused",
      null,
      undefined,
      "",
    ]
  ) {
    assert(!isMrrStatus(s), `expected ${String(s)} to be excluded`);
  }
});

Deno.test("toMonthlyCents: monthly passthrough, annual /12 rounded, non-positive → null", () => {
  assertEquals(toMonthlyCents("month", 19990), 19990);
  assertEquals(toMonthlyCents("year", 99000), 8250);
  assertEquals(toMonthlyCents("year", 101900), 8492); // R$1019,00/yr → R$84,92/mo
  assertEquals(toMonthlyCents(null, 12345), 12345); // unknown interval treated as monthly
  assertEquals(toMonthlyCents("month", 0), null);
  assertEquals(toMonthlyCents("month", null), null);
  assertEquals(toMonthlyCents("year", -100), null);
});

Deno.test("aggregateMrr: sums monthly-normalized paying rows; total reconciles with breakdown", () => {
  const rows = [
    { workspace_id: "a", status: "active", interval: "month", amount_cents: 19990 }, // 199,90
    { workspace_id: "b", status: "active", interval: "year", amount_cents: 101900 }, // → 84,92
    { workspace_id: "c", status: "active", interval: "month", amount_cents: 9990 }, //   99,90
    { workspace_id: "d", status: "past_due", interval: "month", amount_cents: 11892 }, // 118,92
    { workspace_id: "e", status: "trialing", interval: "month", amount_cents: 9990 }, // excluded
    { workspace_id: "f", status: "active", interval: "month", amount_cents: 0 }, // excluded ($0)
  ];
  const r = aggregateMrr(rows);
  assertEquals(r.mrr_cents, 50364); // R$503,64
  assertEquals(r.paying_count, 4);
  assertEquals(r.priced.map((p) => p.monthly_cents), [19990, 8492, 9990, 11892]);
  assertEquals(r.priced.reduce((s, p) => s + p.monthly_cents, 0), r.mrr_cents);
});

Deno.test("aggregateMrr: comps and empty input are R$0 (no subscription rows exist)", () => {
  assertEquals(aggregateMrr([]), { mrr_cents: 0, paying_count: 0, priced: [] });
});

Deno.test("aggregateMrr: rows that cannot be priced are dropped, not counted", () => {
  const rows = [
    { status: "active", interval: "month", amount_cents: null }, // unpriced
    { status: "active", interval: "year", amount_cents: 0 }, // $0
    { status: "active", interval: "month", amount_cents: 5000 }, // kept
  ];
  const r = aggregateMrr(rows);
  assertEquals(r.mrr_cents, 5000);
  assertEquals(r.paying_count, 1);
});

// ─── extractInvoiceSubscriptionId ─────────────────────────────────────────────

Deno.test("extractInvoiceSubscriptionId reads the root string shape (acacia)", () => {
  assertEquals(extractInvoiceSubscriptionId({ subscription: "sub_123" }), "sub_123");
});

Deno.test("extractInvoiceSubscriptionId reads an expanded subscription object", () => {
  assertEquals(extractInvoiceSubscriptionId({ subscription: { id: "sub_123" } }), "sub_123");
});

Deno.test("extractInvoiceSubscriptionId reads the basil parent shape", () => {
  assertEquals(
    extractInvoiceSubscriptionId({
      parent: { subscription_details: { subscription: "sub_456" } },
    }),
    "sub_456",
  );
});

Deno.test("extractInvoiceSubscriptionId prefers the root shape over parent", () => {
  assertEquals(
    extractInvoiceSubscriptionId({
      subscription: "sub_root",
      parent: { subscription_details: { subscription: "sub_parent" } },
    }),
    "sub_root",
  );
});

Deno.test("extractInvoiceSubscriptionId returns null for a non-subscription invoice", () => {
  assertEquals(extractInvoiceSubscriptionId({}), null);
  assertEquals(extractInvoiceSubscriptionId({ subscription: null }), null);
  assertEquals(extractInvoiceSubscriptionId({ subscription: {} }), null);
});

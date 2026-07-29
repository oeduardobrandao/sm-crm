import { assert, assertEquals } from "./assert.ts";
import {
  computeMrrCents,
  resolvePlanFromPriceId,
  statusToPlanId,
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

// ─── computeMrrCents ─────────────────────────────────────────────────────────

const MRR_PLANS = [
  { id: "starter", price_brl: 9900, price_brl_annual: 99000 }, // annual/12 = 8250
  { id: "pro", price_brl: 29900, price_brl_annual: 358800 }, // annual/12 = 29900
  { id: "free", price_brl: 0, price_brl_annual: null },
];

Deno.test("computeMrrCents: sums active monthly subs at catalog price", () => {
  const subs = [
    { status: "active", plan_id: "starter", billing_interval: "month" },
    { status: "active", plan_id: "pro", billing_interval: "month" },
  ];
  assertEquals(computeMrrCents(subs, MRR_PLANS), { mrr_cents: 39800, paying_count: 2 });
});

Deno.test("computeMrrCents: annual subs are normalized to a monthly figure", () => {
  const subs = [{ status: "active", plan_id: "starter", billing_interval: "year" }];
  assertEquals(computeMrrCents(subs, MRR_PLANS), { mrr_cents: 8250, paying_count: 1 });
});

Deno.test("computeMrrCents: past_due counts, trialing/canceled/incomplete do not", () => {
  const subs = [
    { status: "active", plan_id: "starter", billing_interval: "month" },
    { status: "past_due", plan_id: "pro", billing_interval: "month" },
    { status: "trialing", plan_id: "pro", billing_interval: "month" },
    { status: "canceled", plan_id: "pro", billing_interval: "month" },
    { status: "incomplete", plan_id: "pro", billing_interval: "month" },
  ];
  // 9900 (starter active) + 29900 (pro past_due)
  assertEquals(computeMrrCents(subs, MRR_PLANS), { mrr_cents: 39800, paying_count: 2 });
});

Deno.test("computeMrrCents: comped/manual plan grants never appear (no subscription rows)", () => {
  // A comp sets workspaces.plan_id but writes no workspace_subscriptions row, so the input
  // to computeMrrCents simply does not contain it. An empty subscription set is R$ 0.
  assertEquals(computeMrrCents([], MRR_PLANS), { mrr_cents: 0, paying_count: 0 });
});

Deno.test("computeMrrCents: free (price 0) and unknown/absent plan prices contribute nothing", () => {
  const subs = [
    { status: "active", plan_id: "free", billing_interval: "month" },
    { status: "active", plan_id: "ghost", billing_interval: "month" }, // not in catalog
    { status: "active", plan_id: null, billing_interval: "month" },
    { status: "active", plan_id: "starter", billing_interval: "year" }, // 8250, priced
  ];
  assertEquals(computeMrrCents(subs, MRR_PLANS), { mrr_cents: 8250, paying_count: 1 });
});

Deno.test("computeMrrCents: annual sub with no annual price is skipped, not mispriced", () => {
  const plans = [{ id: "starter", price_brl: 9900, price_brl_annual: null }];
  const subs = [{ status: "active", plan_id: "starter", billing_interval: "year" }];
  assertEquals(computeMrrCents(subs, plans), { mrr_cents: 0, paying_count: 0 });
});

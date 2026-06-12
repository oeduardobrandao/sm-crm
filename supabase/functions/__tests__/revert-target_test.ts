import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { revertPlanTarget } from "../platform-admin/revert-target.ts";

Deno.test("live subscription => revert to stripe + sub plan", () => {
  assertEquals(revertPlanTarget({ status: "active", plan_id: "pro" }, "free"), { plan_source: "stripe", plan_id: "pro" });
  assertEquals(revertPlanTarget({ status: "trialing", plan_id: "max" }, "free"), { plan_source: "stripe", plan_id: "max" });
  // past_due/unpaid are still Stripe-managed (dunning) — hand control back to the webhook
  assertEquals(revertPlanTarget({ status: "past_due", plan_id: "pro" }, "free"), { plan_source: "stripe", plan_id: "pro" });
});

Deno.test("no/inactive subscription => revert to system + default plan", () => {
  assertEquals(revertPlanTarget(null, "free"), { plan_source: "system", plan_id: "free" });
  assertEquals(revertPlanTarget({ status: "canceled", plan_id: "pro" }, "free"), { plan_source: "system", plan_id: "free" });
  assertEquals(revertPlanTarget({ status: "active", plan_id: null }, "free"), { plan_source: "system", plan_id: "free" });
});

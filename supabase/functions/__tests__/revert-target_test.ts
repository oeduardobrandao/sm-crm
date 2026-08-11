import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { revertPlanTarget } from "../platform-admin/revert-target.ts";

const NOW = new Date("2026-08-11T00:00:00Z");

Deno.test("live subscription => revert to stripe + sub plan", () => {
  assertEquals(revertPlanTarget({ status: "active", plan_id: "pro" }, "free", NOW), { plan_source: "stripe", plan_id: "pro" });
  assertEquals(revertPlanTarget({ status: "trialing", plan_id: "max" }, "free", NOW), { plan_source: "stripe", plan_id: "max" });
  // past_due/unpaid are still Stripe-managed (dunning) — hand control back to the webhook
  assertEquals(revertPlanTarget({ status: "past_due", plan_id: "pro" }, "free", NOW), { plan_source: "stripe", plan_id: "pro" });
});

Deno.test("no/inactive subscription => revert to system + default plan", () => {
  assertEquals(revertPlanTarget(null, "free", NOW), { plan_source: "system", plan_id: "free" });
  assertEquals(revertPlanTarget({ status: "canceled", plan_id: "pro" }, "free", NOW), { plan_source: "system", plan_id: "free" });
  assertEquals(revertPlanTarget({ status: "active", plan_id: null }, "free", NOW), { plan_source: "system", plan_id: "free" });
});

Deno.test("live pagarme subscription => revert to pagarme + sub plan", () => {
  assertEquals(
    revertPlanTarget({ status: "active", plan_id: "pro", provider: "pagarme" }, "free", NOW),
    { plan_source: "pagarme", plan_id: "pro" },
  );
});

Deno.test("live subscription without provider => defaults to stripe (regression)", () => {
  assertEquals(
    revertPlanTarget({ status: "active", plan_id: "pro", provider: null }, "free", NOW),
    { plan_source: "stripe", plan_id: "pro" },
  );
});

Deno.test("canceled paid-through (future period end) => provider of the row, not system", () => {
  assertEquals(
    revertPlanTarget(
      {
        status: "canceled",
        plan_id: "pro",
        provider: "pagarme",
        cancel_at_period_end: true,
        current_period_end: "2026-12-31T00:00:00Z",
      },
      "free",
      NOW,
    ),
    { plan_source: "pagarme", plan_id: "pro" },
  );
  // no provider on a paid-through row still preserves current stripe-default behavior
  assertEquals(
    revertPlanTarget(
      {
        status: "canceled",
        plan_id: "pro",
        cancel_at_period_end: true,
        current_period_end: "2026-12-31T00:00:00Z",
      },
      "free",
      NOW,
    ),
    { plan_source: "stripe", plan_id: "pro" },
  );
});

Deno.test("canceled with period end already in the past => system + default plan", () => {
  assertEquals(
    revertPlanTarget(
      {
        status: "canceled",
        plan_id: "pro",
        provider: "pagarme",
        cancel_at_period_end: true,
        current_period_end: "2026-01-01T00:00:00Z",
      },
      "free",
      NOW,
    ),
    { plan_source: "system", plan_id: "free" },
  );
});

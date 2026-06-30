import { assert, assertEquals } from "./assert.ts";
import { resolveSyncTarget } from "../_shared/billing-logic.ts";
import type { PlanPriceRow } from "../_shared/billing-logic.ts";

const PLANS: PlanPriceRow[] = [
  {
    id: "agency",
    stripe_price_id: "price_agency_m",
    stripe_price_id_annual: "price_agency_y",
    stripe_price_id_seat: "price_seat_m",
    stripe_price_id_seat_annual: "price_seat_y",
  },
  {
    id: "scale",
    stripe_price_id: "price_scale_m",
    stripe_price_id_annual: "price_scale_y",
    stripe_price_id_seat: "price_seat_m",
    stripe_price_id_seat_annual: "price_seat_y",
  },
];

Deno.test("resolveSyncTarget: tier+seat resolves plan, seats, period from tier item (seat-first order)", () => {
  const r = resolveSyncTarget({
    items: [
      { price: { id: "price_seat_m" }, quantity: 3, current_period_end: 111 },
      { price: { id: "price_agency_m" }, quantity: 1, current_period_end: 222 },
    ],
    status: "active",
    plans: PLANS,
    priorPlanId: "agency",
  });
  assertEquals(r.planIdToWrite, "agency");
  assertEquals(r.mirrorPlanId, "agency");
  assertEquals(r.billingInterval, "month");
  assertEquals(r.purchasedSeats, 3);
  assertEquals(r.periodEndUnix, 222);
  assertEquals(r.mustThrow, false);
});

Deno.test("resolveSyncTarget: tier+seat order-independent (tier-first)", () => {
  const r = resolveSyncTarget({
    items: [
      { price: { id: "price_agency_m" }, quantity: 1, current_period_end: 222 },
      { price: { id: "price_seat_m" }, quantity: 3, current_period_end: 111 },
    ],
    status: "active",
    plans: PLANS,
    priorPlanId: "agency",
  });
  assertEquals(r.planIdToWrite, "agency");
  assertEquals(r.purchasedSeats, 3);
  assertEquals(r.periodEndUnix, 222);
  assertEquals(r.mustThrow, false);
});

Deno.test("resolveSyncTarget: tier-only sub yields 0 purchased seats", () => {
  const r = resolveSyncTarget({
    items: [{ price: { id: "price_agency_y" }, quantity: 1, current_period_end: 900 }],
    status: "active",
    plans: PLANS,
    priorPlanId: null,
  });
  assertEquals(r.planIdToWrite, "agency");
  assertEquals(r.billingInterval, "year");
  assertEquals(r.purchasedSeats, 0);
  assertEquals(r.periodEndUnix, 900);
  assertEquals(r.mustThrow, false);
});

Deno.test("resolveSyncTarget: canceled status forces purchased seats to 0, mirror keeps the resolved tier", () => {
  const r = resolveSyncTarget({
    items: [
      { price: { id: "price_agency_m" }, quantity: 1, current_period_end: 222 },
      { price: { id: "price_seat_m" }, quantity: 4, current_period_end: 222 },
    ],
    status: "canceled",
    plans: PLANS,
    priorPlanId: "agency",
  });
  // canceled writes the default plan downgrade upstream; here purchased must be 0
  assertEquals(r.purchasedSeats, 0);
  // tier still resolves so mirror reflects the resolved tier
  assertEquals(r.mirrorPlanId, "agency");
  assertEquals(r.mustThrow, false);
});

Deno.test("resolveSyncTarget: no tier resolves -> leave plan unchanged, preserve prior mirror, no throw on inactive status", () => {
  const r = resolveSyncTarget({
    items: [{ price: { id: "price_grandfathered_unknown" }, quantity: 1, current_period_end: 500 }],
    status: "past_due",
    plans: PLANS,
    priorPlanId: "pro",
  });
  assertEquals(r.planIdToWrite, null);
  assertEquals(r.mirrorPlanId, "pro"); // preserved, never nulled
  assertEquals(r.billingInterval, null);
  assertEquals(r.purchasedSeats, 0);
  assertEquals(r.periodEndUnix, 500);
  assertEquals(r.mustThrow, false);
});

Deno.test("resolveSyncTarget: active sub with seat item but no resolvable tier -> mustThrow", () => {
  const r = resolveSyncTarget({
    items: [
      { price: { id: "price_seat_m" }, quantity: 2, current_period_end: 700 },
      { price: { id: "price_grandfathered_unknown" }, quantity: 1, current_period_end: 700 },
    ],
    status: "active",
    plans: PLANS,
    priorPlanId: "agency",
  });
  assert(r.mustThrow === true);
});

Deno.test("resolveSyncTarget: active sub with seat item quantity 0 and no resolvable tier -> mustThrow (presence-based)", () => {
  // quantity: 0 on the seat item — quantity-based detection would miss this as hasSeatItem=false.
  // Presence-based detection must still flag mustThrow because the seat price id IS present.
  const r = resolveSyncTarget({
    items: [
      { price: { id: "price_seat_m" }, quantity: 0, current_period_end: 800 },
      { price: { id: "price_grandfathered_unknown" }, quantity: 1, current_period_end: 800 },
    ],
    status: "active",
    plans: PLANS,
    priorPlanId: "agency",
  });
  assert(r.mustThrow === true);
});

import { assert, assertEquals } from "./assert.ts";
import {
  buildLineItems,
  clampExtraSeats,
  validatePaidPlan,
} from "../_shared/billing-logic.ts";

Deno.test("buildLineItems: 0 extra seats → single tier line item", () => {
  const r = buildLineItems({ tierPriceId: "price_tier_m", seatPriceId: "price_seat_m", extraSeats: 0 });
  assert(r.ok);
  assertEquals(r.lineItems, [{ price: "price_tier_m", quantity: 1 }]);
});

Deno.test("buildLineItems: N extra seats → two line items (tier + seat qty N)", () => {
  const r = buildLineItems({ tierPriceId: "price_tier_m", seatPriceId: "price_seat_m", extraSeats: 3 });
  assert(r.ok);
  assertEquals(r.lineItems, [
    { price: "price_tier_m", quantity: 1 },
    { price: "price_seat_m", quantity: 3 },
  ]);
});

Deno.test("buildLineItems: never emits a quantity-0 seat line", () => {
  const r = buildLineItems({ tierPriceId: "price_tier_m", seatPriceId: "price_seat_m", extraSeats: 0 });
  assert(r.ok);
  assertEquals(r.lineItems.length, 1);
  for (const li of r.lineItems) assert(li.quantity > 0);
});

Deno.test("buildLineItems: annual + extra seats but no annual seat price → error (no items)", () => {
  const r = buildLineItems({ tierPriceId: "price_tier_y", seatPriceId: null, extraSeats: 2 });
  assert(!r.ok);
  assertEquals(r.error, "Seat price not configured for this interval");
});

Deno.test("buildLineItems: missing seat price but 0 extra seats → still single tier item, ok", () => {
  const r = buildLineItems({ tierPriceId: "price_tier_y", seatPriceId: null, extraSeats: 0 });
  assert(r.ok);
  assertEquals(r.lineItems, [{ price: "price_tier_y", quantity: 1 }]);
});

Deno.test("clampExtraSeats: floors and truncates to a non-negative integer, default 0", () => {
  assertEquals(clampExtraSeats(undefined), 0);
  assertEquals(clampExtraSeats(null), 0);
  assertEquals(clampExtraSeats("nope"), 0);
  assertEquals(clampExtraSeats(-5), 0);
  assertEquals(clampExtraSeats(2.9), 2);
  assertEquals(clampExtraSeats(7), 7);
  assertEquals(clampExtraSeats("4"), 4);
});

Deno.test("validatePaidPlan: accepts an active plan with a tier price", () => {
  assert(validatePaidPlan({ is_active: true, tierPriceId: "price_agency_m" }));
  assert(validatePaidPlan({ is_active: true, tierPriceId: "price_starter_y" }));
  assert(validatePaidPlan({ is_active: true, tierPriceId: "price_scale_m" }));
});

Deno.test("validatePaidPlan: rejects unknown/inactive/price-less plans", () => {
  assert(!validatePaidPlan(null));
  assert(!validatePaidPlan({ is_active: false, tierPriceId: "price_old_m" }));
  assert(!validatePaidPlan({ is_active: true, tierPriceId: null }));
  assert(!validatePaidPlan({ is_active: true, tierPriceId: "" }));
  assert(!validatePaidPlan({ tierPriceId: "price_x" }));
});

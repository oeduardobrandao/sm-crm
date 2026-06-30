import { assert, assertEquals } from "./assert.ts";
import {
  statusToPlanId,
  resolvePlanFromPriceId,
  resolveSubscriptionSeats,
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

const SEAT_PLANS = [
  {
    id: "starter",
    stripe_price_id: "price_s_m",
    stripe_price_id_annual: "price_s_y",
    stripe_price_id_seat: "price_seat_m",
    stripe_price_id_seat_annual: "price_seat_y",
  },
  {
    id: "agency",
    stripe_price_id: "price_a_m",
    stripe_price_id_annual: "price_a_y",
    stripe_price_id_seat: "price_seat_m",
    stripe_price_id_seat_annual: "price_seat_y",
  },
];

Deno.test("resolvePlanFromPriceId: a seat price resolves to null-as-tier", () => {
  assert(resolvePlanFromPriceId("price_seat_m", SEAT_PLANS) === null);
  assert(resolvePlanFromPriceId("price_seat_y", SEAT_PLANS) === null);
});

Deno.test("resolveSubscriptionSeats: tier-only subscription has 0 purchased seats", () => {
  const items = [{ price: { id: "price_a_m" }, quantity: 1 }];
  assertEquals(resolveSubscriptionSeats(items, SEAT_PLANS), { purchased_seats: 0 });
});

Deno.test("resolveSubscriptionSeats: tier+seat, [tier, seat] order", () => {
  const items = [
    { price: { id: "price_a_m" }, quantity: 1 },
    { price: { id: "price_seat_m" }, quantity: 3 },
  ];
  assertEquals(resolveSubscriptionSeats(items, SEAT_PLANS), { purchased_seats: 3 });
});

Deno.test("resolveSubscriptionSeats: tier+seat, [seat, tier] order (order-independent)", () => {
  const items = [
    { price: { id: "price_seat_m" }, quantity: 3 },
    { price: { id: "price_a_m" }, quantity: 1 },
  ];
  assertEquals(resolveSubscriptionSeats(items, SEAT_PLANS), { purchased_seats: 3 });
});

Deno.test("resolveSubscriptionSeats: annual seat price id is recognized", () => {
  const items = [
    { price: { id: "price_a_y" }, quantity: 1 },
    { price: { id: "price_seat_y" }, quantity: 2 },
  ];
  assertEquals(resolveSubscriptionSeats(items, SEAT_PLANS), { purchased_seats: 2 });
});

Deno.test("resolveSubscriptionSeats: missing/null quantity counts as 0, null price ignored", () => {
  const items = [
    { price: { id: "price_seat_m" }, quantity: null },
    { price: { id: "price_seat_m" } },
    { price: null, quantity: 5 },
  ];
  assertEquals(resolveSubscriptionSeats(items, SEAT_PLANS), { purchased_seats: 0 });
});

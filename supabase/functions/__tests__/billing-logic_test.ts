import { assert, assertEquals } from "./assert.ts";
import {
  statusToPlanId,
  resolvePlanFromPriceId,
  resolveSubscriptionSeats,
  sumSubscriptionGross,
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

Deno.test("resolveSubscriptionSeats: tier-only subscription has 0 purchased seats and no seat item", () => {
  const items = [{ price: { id: "price_a_m" }, quantity: 1 }];
  assertEquals(resolveSubscriptionSeats(items, SEAT_PLANS), { purchased_seats: 0, has_seat_item: false });
});

Deno.test("resolveSubscriptionSeats: tier+seat, [tier, seat] order", () => {
  const items = [
    { price: { id: "price_a_m" }, quantity: 1 },
    { price: { id: "price_seat_m" }, quantity: 3 },
  ];
  assertEquals(resolveSubscriptionSeats(items, SEAT_PLANS), { purchased_seats: 3, has_seat_item: true });
});

Deno.test("resolveSubscriptionSeats: tier+seat, [seat, tier] order (order-independent)", () => {
  const items = [
    { price: { id: "price_seat_m" }, quantity: 3 },
    { price: { id: "price_a_m" }, quantity: 1 },
  ];
  assertEquals(resolveSubscriptionSeats(items, SEAT_PLANS), { purchased_seats: 3, has_seat_item: true });
});

Deno.test("resolveSubscriptionSeats: annual seat price id is recognized", () => {
  const items = [
    { price: { id: "price_a_y" }, quantity: 1 },
    { price: { id: "price_seat_y" }, quantity: 2 },
  ];
  assertEquals(resolveSubscriptionSeats(items, SEAT_PLANS), { purchased_seats: 2, has_seat_item: true });
});

Deno.test("resolveSubscriptionSeats: missing/null quantity counts as 0, null price ignored", () => {
  const items = [
    { price: { id: "price_seat_m" }, quantity: null },
    { price: { id: "price_seat_m" } },
    { price: null, quantity: 5 },
  ];
  // null price items are ignored (no seat item from them); seat items with null/missing quantity
  // still register as has_seat_item: true but contribute 0 to purchased_seats
  assertEquals(resolveSubscriptionSeats(items, SEAT_PLANS), { purchased_seats: 0, has_seat_item: true });
});

Deno.test("resolveSubscriptionSeats: seat item with quantity 0 sets has_seat_item true but purchased_seats 0", () => {
  const items = [
    { price: { id: "price_seat_m" }, quantity: 0 },
  ];
  assertEquals(resolveSubscriptionSeats(items, SEAT_PLANS), { purchased_seats: 0, has_seat_item: true });
});

Deno.test("resolveSubscriptionSeats: seat item with quantity null sets has_seat_item true but purchased_seats 0", () => {
  const items = [
    { price: { id: "price_seat_y" }, quantity: null },
  ];
  assertEquals(resolveSubscriptionSeats(items, SEAT_PLANS), { purchased_seats: 0, has_seat_item: true });
});

// ─── sumSubscriptionGross ──────────────────────────────────────────────────────

type RawItem = { quantity?: number | null; unit_amount?: number | null };

function makeItems(raw: RawItem[]) {
  return raw.map((r) => ({
    quantity: r.quantity,
    price: { unit_amount: r.unit_amount },
  }));
}

Deno.test("sumSubscriptionGross: single item, basic multiplication", () => {
  // 1 × 4900 = 4900
  assertEquals(sumSubscriptionGross(makeItems([{ quantity: 1, unit_amount: 4900 }])), 4900);
});

Deno.test("sumSubscriptionGross: tier + seat two items are both summed", () => {
  // tier: 1 × 4900 = 4900; seat: 3 × 1000 = 3000 → 7900
  assertEquals(
    sumSubscriptionGross(makeItems([
      { quantity: 1, unit_amount: 4900 },
      { quantity: 3, unit_amount: 1000 },
    ])),
    7900,
  );
});

Deno.test("sumSubscriptionGross: quantity > 1 on a single item is multiplied", () => {
  // 5 × 990 = 4950
  assertEquals(sumSubscriptionGross(makeItems([{ quantity: 5, unit_amount: 990 }])), 4950);
});

Deno.test("sumSubscriptionGross: null unit_amount treated as 0", () => {
  // null unit_amount contributes 0; other item 1 × 2000 = 2000
  assertEquals(
    sumSubscriptionGross(makeItems([
      { quantity: 1, unit_amount: null },
      { quantity: 1, unit_amount: 2000 },
    ])),
    2000,
  );
});

Deno.test("sumSubscriptionGross: null quantity treated as 0", () => {
  // null quantity → 0 × 4900 = 0
  assertEquals(sumSubscriptionGross(makeItems([{ quantity: null, unit_amount: 4900 }])), 0);
});

Deno.test("sumSubscriptionGross: missing unit_amount and quantity both treated as 0", () => {
  // undefined quantity and unit_amount → 0
  assertEquals(
    sumSubscriptionGross([{ price: {} }] as Parameters<typeof sumSubscriptionGross>[0]),
    0,
  );
});

Deno.test("sumSubscriptionGross: empty items array returns 0", () => {
  assertEquals(sumSubscriptionGross([]), 0);
});

import { assert } from "./assert.ts";
import {
  extractCoupon,
  fetchStripeAmount,
  type StripeClient,
} from "../_shared/stripe-amount.ts";

function fakeStripe(sub: unknown, opts?: { rejectDiscountsExpand?: boolean }): StripeClient {
  return {
    subscriptions: {
      retrieve: (_id, params) => {
        if (opts?.rejectDiscountsExpand && params.expand.includes("discounts")) {
          return Promise.reject(new Error("cannot expand discounts"));
        }
        return Promise.resolve(sub);
      },
    },
  };
}

const priceItem = (unit: number, interval = "month") => ({
  quantity: 1,
  price: { unit_amount: unit, currency: "brl", recurring: { interval } },
});

Deno.test("fetchStripeAmount applies a percent_off coupon and labels it", async () => {
  const amt = await fetchStripeAmount(
    fakeStripe({
      items: { data: [priceItem(14900)] },
      discounts: [{ coupon: { id: "c1", name: "LANC20", percent_off: 20 } }],
    }),
    "sub_1",
    null,
  );
  assert(amt.amount_cents === 11920, `net was ${amt.amount_cents}`);
  assert(amt.gross_cents === 14900);
  assert(amt.discount_label === "LANC20 −20%", `label was ${amt.discount_label}`);
  assert(amt.interval === "month" && amt.currency === "brl");
});

Deno.test("fetchStripeAmount applies amount_off, floors at zero, keeps quantity", async () => {
  const amt = await fetchStripeAmount(
    fakeStripe({
      items: { data: [{ ...priceItem(5000), quantity: 2 }] },
      discounts: [{ coupon: { id: "c2", amount_off: 20000 } }],
    }),
    "sub_2",
    null,
  );
  assert(amt.amount_cents === 0, "amount_off must floor at zero");
  assert(amt.gross_cents === 10000, "gross must reflect unit_amount * quantity");
  assert(amt.discount_label === "c2", "amount_off label falls back to coupon id");
});

Deno.test("fetchStripeAmount without a coupon returns gross_cents null", async () => {
  const amt = await fetchStripeAmount(
    fakeStripe({ items: { data: [priceItem(14900, "year")] } }),
    "sub_3",
    null,
  );
  assert(amt.amount_cents === 14900 && amt.gross_cents === null);
  assert(amt.interval === "year");
});

Deno.test("fetchStripeAmount retries without the discounts expand and uses fallback interval", async () => {
  const amt = await fetchStripeAmount(
    fakeStripe(
      {
        items: { data: [{ quantity: 1, price: { unit_amount: 9900, currency: "brl" } }] },
        discount: { coupon: { id: "c3", name: "VIP", percent_off: 50 } },
      },
      { rejectDiscountsExpand: true },
    ),
    "sub_4",
    "month",
  );
  assert(amt.amount_cents === 4950, "legacy discount not applied after expand fallback");
  assert(amt.interval === "month", "fallback interval not used");
});

Deno.test("extractCoupon handles discounts[], legacy discount, and unexpanded strings", () => {
  const coupon = { id: "c", percent_off: 10 };
  assert(extractCoupon({ discounts: [{ coupon }] })?.id === "c");
  assert(extractCoupon({ discount: { coupon } })?.id === "c");
  assert(extractCoupon({ discounts: ["di_123"] }) === null, "unexpanded discount id must be null");
  assert(extractCoupon({}) === null);
});

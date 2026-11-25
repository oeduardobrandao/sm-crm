import { assert, assertEquals } from "./assert.ts";
import {
  extractCoupon,
  fetchStripeAmount,
  STRIPE_AMOUNT_EXPAND,
  stripeAmountFromSubscription,
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

Deno.test("stripeAmountFromSubscription applies a percent coupon from discounts[]", () => {
  const amt = stripeAmountFromSubscription(
    {
      livemode: true,
      items: { data: [{ quantity: 1, price: { unit_amount: 10000, currency: "brl", recurring: { interval: "month" } } }] },
      discounts: [{ coupon: { id: "c1", name: "Parceiro", percent_off: 20 } }],
    },
    null,
  );
  assertEquals(amt.amount_cents, 8000);
  assertEquals(amt.gross_cents, 10000);
  assertEquals(amt.interval, "month");
  assertEquals(amt.discount_label, "Parceiro −20%");
});

Deno.test("stripeAmountFromSubscription: no coupon, interval falls back when price lacks recurring", () => {
  const amt = stripeAmountFromSubscription(
    { items: { data: [{ quantity: 2, price: { unit_amount: 5000, currency: "brl" } }] } },
    "year",
  );
  assertEquals(amt.amount_cents, 10000);
  assertEquals(amt.gross_cents, null);
  assertEquals(amt.interval, "year");
  assertEquals(amt.discount_label, null);
});

const dualPrice = {
  unit_amount: 9990,
  currency: "brl",
  currency_options: { brl: { unit_amount: 9990 }, usd: { unit_amount: 2900 } },
  recurring: { interval: "month" },
};
const dualSub = (currency: string | undefined, extra: Record<string, unknown> = {}) => ({
  ...(currency ? { currency } : {}),
  items: { data: [{ quantity: 1, price: dualPrice }] },
  ...extra,
});

Deno.test("usd subscription uses the currency option", () => {
  const amt = stripeAmountFromSubscription(dualSub("usd"), null);
  assertEquals(amt.amount_cents, 2900);
  assertEquals(amt.currency, "usd");
  assertEquals(amt.gross_cents, null);
});

Deno.test("brl subscription unchanged", () => {
  const amt = stripeAmountFromSubscription(dualSub("brl"), null);
  assertEquals(amt.amount_cents, 9990);
  assertEquals(amt.currency, "brl");
});

Deno.test("usd with 100% percent coupon", () => {
  const amt = stripeAmountFromSubscription(
    dualSub("usd", { discounts: [{ coupon: { id: "F", percent_off: 100 } }] }),
    null,
  );
  assertEquals(amt.amount_cents, 0);
  assertEquals(amt.gross_cents, 2900);
  assertEquals(amt.currency, "usd");
});

Deno.test("usd with brl amount_off coupon is ignored", () => {
  const amt = stripeAmountFromSubscription(
    dualSub("usd", { discounts: [{ coupon: { id: "X", amount_off: 1000, currency: "brl" } }] }),
    null,
  );
  assertEquals(amt.amount_cents, 2900);
  assertEquals(amt.discount_label, null);
});

Deno.test("usd with amount_off currency option", () => {
  const amt = stripeAmountFromSubscription(
    dualSub("usd", {
      discounts: [
        {
          coupon: {
            id: "Y",
            amount_off: 1000,
            currency: "brl",
            currency_options: { usd: { amount_off: 500 } },
          },
        },
      ],
    }),
    null,
  );
  assertEquals(amt.amount_cents, 2400);
});

Deno.test("missing sub.currency falls back to price.currency", () => {
  const amt = stripeAmountFromSubscription(dualSub(undefined), null);
  assertEquals(amt.currency, "brl");
  assertEquals(amt.amount_cents, 9990);
});

Deno.test("fetchStripeAmount requests currency_options", async () => {
  const seen: string[][] = [];
  const stripe: StripeClient = {
    subscriptions: {
      retrieve: (_id, params) => {
        seen.push(params.expand);
        if (params.expand.includes("discounts")) return Promise.reject(new Error("x"));
        return Promise.resolve(dualSub("usd"));
      },
    },
  };
  const amt = await fetchStripeAmount(stripe, "sub_u", null);
  assertEquals(seen[0], STRIPE_AMOUNT_EXPAND);
  assert(seen[1].includes("items.data.price.currency_options"));
  assertEquals(amt.amount_cents, 2900);
});

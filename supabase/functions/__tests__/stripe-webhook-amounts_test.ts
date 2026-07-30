import { assertEquals } from "./assert.ts";
import { buildAmountColumns, clearedAmountColumns } from "../_shared/stripe-amount.ts";

Deno.test("buildAmountColumns maps a StripeAmount onto mirror columns", () => {
  const cols = buildAmountColumns({
    amount_cents: 9900,
    gross_cents: 12900,
    currency: "brl",
    interval: "month",
    discount_label: "LAUNCH -23%",
    livemode: true,
  });
  assertEquals(cols.amount_cents, 9900);
  assertEquals(cols.gross_cents, 12900);
  assertEquals(cols.currency, "brl");
  assertEquals(cols.amount_interval, "month");
  assertEquals(cols.discount_label, "LAUNCH -23%");
  assertEquals(typeof cols.amount_refreshed_at, "string");
});

Deno.test("clearedAmountColumns nulls every mirror column buildAmountColumns writes", () => {
  const built = buildAmountColumns({
    amount_cents: 9900,
    gross_cents: 12900,
    currency: "brl",
    interval: "month",
    discount_label: "LAUNCH -23%",
    livemode: true,
  });
  const cleared = clearedAmountColumns();
  // Same key set: a failed refresh must not leave any pricing column behind,
  // or readers would keep treating the row as priced and never retry it.
  assertEquals(Object.keys(cleared).sort(), Object.keys(built).sort());
  for (const [key, value] of Object.entries(cleared)) {
    assertEquals(value, null, `${key} must be cleared to null`);
  }
});

Deno.test("buildAmountColumns keeps a null gross (no discount) as null", () => {
  const cols = buildAmountColumns({
    amount_cents: 4900,
    gross_cents: null,
    currency: "brl",
    interval: "year",
    discount_label: null,
    livemode: true,
  });
  assertEquals(cols.amount_cents, 4900);
  assertEquals(cols.gross_cents, null);
  assertEquals(cols.amount_interval, "year");
  assertEquals(cols.discount_label, null);
});

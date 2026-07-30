import { assertEquals } from "./assert.ts";
import { buildAmountColumns } from "../_shared/stripe-amount.ts";

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

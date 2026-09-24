import { assertEquals } from "./assert.ts";
import {
  buildDepositsResponse,
  handleGetDeposits,
  type DepositsGateways,
} from "../platform-admin/deposits.ts";
import type { PagarmeRaw, StripeRaw } from "../platform-admin/deposits-logic.ts";

const TODAY = "2026-09-24";
const ts = (day: string) => Math.floor(new Date(`${day}T00:00:00Z`).getTime() / 1000);

const STRIPE_RAW: StripeRaw = {
  balance: { available: [{ amount: 100, currency: "brl" }], pending: [{ amount: 9700, currency: "brl" }] },
  payouts: [],
  pendingTransactions: [
    { net: 9700, amount: 10000, fee: 300, available_on: ts("2026-09-29"), status: "pending", currency: "brl", type: "charge" },
  ],
  schedule: { interval: "daily", delay_days: 30 },
  truncated: false,
};

const PAGARME_RAW: PagarmeRaw = {
  balance: { available_amount: 0, waiting_funds_amount: 2935 },
  payables: [{ id: 1, status: "waiting_funds", amount: 3090, fee: 155, anticipation_fee: 0, payment_date: "2026-09-25T03:00:00Z" }],
  recipient: { transfer_settings: { transfer_enabled: true, transfer_interval: "daily", transfer_day: null } },
  transfers: [],
  truncated: false,
};

function gateways(over: Partial<DepositsGateways> = {}): DepositsGateways {
  return {
    stripe: { fetchRaw: () => Promise.resolve(STRIPE_RAW) },
    pagarme: { fetchRaw: (_id) => Promise.resolve(PAGARME_RAW) },
    recipientId: "re_test",
    pagarmeSecretPresent: true,
    today: TODAY,
    ...over,
  };
}

Deno.test("buildDepositsResponse: both providers ok, summary picks the earliest deposit, currency is brl", async () => {
  const out = await buildDepositsResponse(gateways());
  assertEquals(out.currency, "brl");
  assertEquals(out.stripe.ok, true);
  assertEquals(out.pagarme.ok, true);
  assertEquals(out.summary, {
    next: { date: "2026-09-25", amount_cents: 2935, provider: "pagarme" },
    next_30d_cents: 9700 + 2935,
    waiting_cents: 9700 + 2935,
    partial: false,
  });
  assertEquals(typeof out.generated_at, "string");
});

Deno.test("buildDepositsResponse: one provider throwing yields ok:false for it only, marks partial, and never leaks the error", async () => {
  const out = await buildDepositsResponse(
    gateways({ stripe: { fetchRaw: () => Promise.reject(new Error("secret sk_live_123 leaked")) } }),
  );
  assertEquals(out.stripe, {
    configured: true,
    ok: false,
    truncated: false,
    balance: null,
    meta: {},
    upcoming: { next30: [], byMonth: [] },
    in_transit: [],
    recent: [],
    error: "unavailable",
  });
  assertEquals(out.pagarme.ok, true);
  assertEquals(JSON.stringify(out).includes("sk_live"), false);
  assertEquals(out.summary.next?.provider, "pagarme");
  assertEquals(out.summary.partial, true);
});

Deno.test("buildDepositsResponse: recipient id set but PAGARME_SECRET_KEY absent → configured:false, gateway not called", async () => {
  let called = 0;
  const out = await buildDepositsResponse(
    gateways({
      pagarmeSecretPresent: false,
      pagarme: {
        fetchRaw: () => {
          called += 1;
          return Promise.resolve(PAGARME_RAW);
        },
      },
    }),
  );
  assertEquals(out.pagarme.configured, false);
  assertEquals(called, 0);
  assertEquals(out.summary.partial, false);
});

Deno.test("buildDepositsResponse: no Stripe gateway → configured:false; no recipient id → Pagar.me configured:false and gateway not called", async () => {
  let called = 0;
  const out = await buildDepositsResponse(
    gateways({
      stripe: null,
      recipientId: null,
      pagarme: {
        fetchRaw: () => {
          called += 1;
          return Promise.resolve(PAGARME_RAW);
        },
      },
    }),
  );
  assertEquals(out.stripe.configured, false);
  assertEquals(out.pagarme.configured, false);
  assertEquals(called, 0);
  assertEquals(out.summary, { next: null, next_30d_cents: 0, waiting_cents: 0, partial: false });
});

Deno.test("buildDepositsResponse: the recipient id is passed to the Pagar.me gateway", async () => {
  let seen: string | null = null;
  await buildDepositsResponse(
    gateways({
      pagarme: {
        fetchRaw: (id) => {
          seen = id;
          return Promise.resolve(PAGARME_RAW);
        },
      },
    }),
  );
  assertEquals(seen, "re_test");
});

Deno.test("handleGetDeposits: 200 JSON with the response body", async () => {
  const res = await handleGetDeposits({ "Content-Type": "application/json" }, gateways());
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.stripe.ok, true);
  assertEquals(body.pagarme.ok, true);
  assertEquals(body.summary.next.provider, "pagarme");
});

import { assertEquals } from "./assert.ts";
import { resolveMirrorAmount, priceSubscriptionRows } from "../platform-admin/pricing.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const PRO = { name: "Pro", price_brl: 12900, price_brl_annual: 99000 };

Deno.test("mirror-priced row is used directly, no live fetch needed", () => {
  const r = resolveMirrorAmount(
    {
      provider: "stripe",
      amount_cents: 9900,
      currency: "brl",
      amount_interval: "month",
      discount_label: null,
      billing_interval: "month",
      stripe_subscription_id: "sub_1",
    },
    PRO,
  );
  assertEquals(r, {
    amount_cents: 9900,
    interval: "month",
    discount_label: null,
    amount_source: "stripe",
    needsLiveFetch: false,
  });
});

Deno.test("unpriced row with a subscription id asks for a live fetch, catalog fills meanwhile", () => {
  const r = resolveMirrorAmount(
    {
      provider: "stripe",
      amount_cents: null,
      currency: null,
      amount_interval: null,
      discount_label: null,
      billing_interval: "year",
      stripe_subscription_id: "sub_2",
    },
    PRO,
  );
  assertEquals(r.needsLiveFetch, true);
  assertEquals(r.amount_cents, 99000);
  assertEquals(r.interval, "year");
  assertEquals(r.amount_source, "catalog");
});

Deno.test("no subscription id: catalog only, never a live fetch", () => {
  const r = resolveMirrorAmount(
    {
      provider: "stripe",
      amount_cents: null,
      currency: null,
      amount_interval: null,
      discount_label: null,
      billing_interval: "month",
      stripe_subscription_id: null,
    },
    { name: "Free", price_brl: 0, price_brl_annual: null },
  );
  assertEquals(r.needsLiveFetch, false);
  assertEquals(r.amount_cents, 0);
  assertEquals(r.amount_source, "catalog");
});

Deno.test("mirror-priced discount label and interval win over billing_interval", () => {
  const r = resolveMirrorAmount(
    {
      provider: "stripe",
      amount_cents: 4900,
      currency: "brl",
      amount_interval: "year",
      discount_label: "LAUNCH -50%",
      billing_interval: "month",
      stripe_subscription_id: "sub_3",
    },
    PRO,
  );
  assertEquals(r.interval, "year");
  assertEquals(r.discount_label, "LAUNCH -50%");
});

Deno.test("priceSubscriptionRows prices mirror rows without touching the db or Stripe", async () => {
  // A db whose update would throw: proves no write-back happens for mirror-priced rows.
  const db = {
    from: () => {
      throw new Error("unexpected db call");
    },
  } as unknown as SupabaseClient;

  const priced = await priceSubscriptionRows(
    db,
    [
      {
        workspace_id: "ws-1",
        status: "active",
        plan_id: "pro",
        billing_interval: "month",
        stripe_subscription_id: "sub_1",
        provider: "stripe",
        amount_cents: 9900,
        currency: "brl",
        amount_interval: "month",
        discount_label: null,
      },
    ],
    new Map([["ws-1", "Alpha"]]),
    new Map([["pro", PRO]]),
  );

  assertEquals(priced.length, 1);
  assertEquals(priced[0].name, "Alpha");
  assertEquals(priced[0].plan_name, "Pro");
  assertEquals(priced[0].amount_cents, 9900);
  assertEquals(priced[0].amount_source, "stripe");
});

Deno.test("pagarme mirror-priced row labels amount_source pagarme, no live fetch", () => {
  const r = resolveMirrorAmount(
    {
      provider: "pagarme",
      amount_cents: 95900,
      currency: "brl",
      amount_interval: "year",
      discount_label: null,
      billing_interval: "year",
      stripe_subscription_id: null,
    },
    PRO,
  );
  assertEquals(r, {
    amount_cents: 95900,
    interval: "year",
    discount_label: null,
    amount_source: "pagarme",
    needsLiveFetch: false,
  });
});

Deno.test("unpriced pagarme row with a stale stripe id NEVER asks for a live fetch", () => {
  // A row that switched providers still carries the old stripe_subscription_id. Fetching it
  // live would price the DEAD Stripe subscription and write it over the Pagar.me mirror.
  const r = resolveMirrorAmount(
    {
      provider: "pagarme",
      amount_cents: null,
      currency: null,
      amount_interval: null,
      discount_label: null,
      billing_interval: "year",
      stripe_subscription_id: "sub_dead",
    },
    PRO,
  );
  assertEquals(r.needsLiveFetch, false);
  assertEquals(r.amount_cents, 99000);
  assertEquals(r.amount_source, "catalog");
});

Deno.test("null provider (legacy row) keeps stripe semantics", () => {
  const r = resolveMirrorAmount(
    {
      provider: null,
      amount_cents: 9900,
      currency: "brl",
      amount_interval: "month",
      discount_label: null,
      billing_interval: "month",
      stripe_subscription_id: "sub_1",
    },
    PRO,
  );
  assertEquals(r.amount_source, "stripe");
});

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
    currency: "brl",
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
    currency: "brl",
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

const PRO_USD = { name: "Pro", price_brl: 12900, price_brl_annual: 99000, price_usd: 4900, price_usd_annual: 46800 };

Deno.test("USD workspace with no mirror amount prices monthly Pro from the USD catalog", () => {
  const r = resolveMirrorAmount(
    {
      provider: "stripe",
      amount_cents: null,
      currency: null,
      amount_interval: null,
      discount_label: null,
      billing_interval: "month",
      stripe_subscription_id: null,
      workspace_currency: "usd",
    },
    PRO_USD,
  );
  assertEquals(r, {
    amount_cents: 4900,
    currency: "usd",
    interval: "month",
    discount_label: null,
    amount_source: "catalog",
    needsLiveFetch: false,
  });
});

Deno.test("USD workspace annual catalog uses price_usd_annual; missing USD price stays unpriced", () => {
  const base = {
    provider: "stripe",
    amount_cents: null,
    currency: null,
    amount_interval: null,
    discount_label: null,
    stripe_subscription_id: null,
    workspace_currency: "usd" as const,
  };
  const annual = resolveMirrorAmount({ ...base, billing_interval: "year" }, PRO_USD);
  assertEquals(annual.amount_cents, 46800);
  assertEquals(annual.currency, "usd");
  // Never falls back to the BRL price for a USD workspace: that would mix currencies.
  const noUsd = resolveMirrorAmount({ ...base, billing_interval: "month" }, { ...PRO_USD, price_usd: null });
  assertEquals(noUsd.amount_cents, null);
  assertEquals(noUsd.amount_source, null);
  assertEquals(noUsd.currency, "usd");
});

Deno.test("mirror amount keeps the mirror currency", () => {
  const r = resolveMirrorAmount(
    {
      provider: "stripe",
      amount_cents: 4900,
      currency: "usd",
      amount_interval: "month",
      discount_label: null,
      billing_interval: "month",
      stripe_subscription_id: "sub_us",
      workspace_currency: "usd",
    },
    PRO_USD,
  );
  assertEquals(r.amount_cents, 4900);
  assertEquals(r.currency, "usd");
  assertEquals(r.amount_source, "stripe");
});

Deno.test("BRL workspace catalog fallback reports currency brl", () => {
  const r = resolveMirrorAmount(
    {
      provider: "stripe",
      amount_cents: null,
      currency: null,
      amount_interval: null,
      discount_label: null,
      billing_interval: "month",
      stripe_subscription_id: null,
      workspace_currency: "brl",
    },
    PRO_USD,
  );
  assertEquals(r.amount_cents, 12900);
  assertEquals(r.currency, "brl");
});

Deno.test("priceSubscriptionRows carries the resolved currency", async () => {
  const db = {
    from: () => {
      throw new Error("unexpected db call");
    },
  } as unknown as SupabaseClient;
  const priced = await priceSubscriptionRows(
    db,
    [
      {
        workspace_id: "ws-us",
        status: "active",
        plan_id: "pro",
        billing_interval: "month",
        stripe_subscription_id: null,
        provider: "stripe",
        amount_cents: null,
        currency: null,
        amount_interval: null,
        discount_label: null,
        workspace_currency: "usd",
      },
    ],
    new Map(),
    new Map([["pro", PRO_USD]]),
  );
  assertEquals(priced[0].amount_cents, 4900);
  assertEquals(priced[0].currency, "usd");
});

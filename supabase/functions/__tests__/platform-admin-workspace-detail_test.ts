import { assert, assertEquals } from "./assert.ts";
import { makeFakeDb, type Resp } from "./mcp-admin-helpers.ts";
import { buildSubscriptionDetail } from "../platform-admin/workspace-detail.ts";
import type {
  PagarmeDetailGateway,
  PagarmeRemoteSubscription,
} from "../platform-admin/pagarme-detail.ts";

const BASE = "https://dash.pagar.me/merch_x/acc_y";

const PAGARME_ROW = {
  status: "trialing",
  plan_id: "max",
  billing_interval: "year",
  current_period_end: "2026-10-03T00:00:00.000Z",
  cancel_at_period_end: false,
  failed_payment_count: 0,
  stripe_customer_id: null,
  stripe_subscription_id: null,
  provider: "pagarme",
  pagarme_subscription_id: "sub_abc",
  installments: 12,
  amount_cents: 113880,
  gross_cents: null,
  currency: "brl",
  amount_interval: "year",
  discount_label: null,
};

const REMOTE: PagarmeRemoteSubscription = {
  id: "sub_abc",
  status: "future",
  start_at: "2026-10-03T00:00:00Z",
  card: { brand: "visa", last_four_digits: "4242", exp_month: 12, exp_year: 2028 },
};

function fakeGateway(impl: (id: string) => Promise<PagarmeRemoteSubscription>) {
  const calls: string[] = [];
  const gateway: PagarmeDetailGateway = {
    fetchSubscription: (id) => {
      calls.push(id);
      return impl(id);
    },
  };
  return { gateway, calls };
}

function dbFor(row: Record<string, unknown> | null, plans: Resp[]) {
  return makeFakeDb({
    workspace_subscriptions: [{ data: row, error: null }],
    plans,
  });
}

const PLAN_NAME_ONLY: Resp[] = [{ data: { name: "Max" }, error: null }];

Deno.test("pagarme row: one live fetch, link built, mirror amount kept, zero writes", async () => {
  const { db, calls } = dbFor(PAGARME_ROW, PLAN_NAME_ONLY);
  const { gateway, calls: fetched } = fakeGateway(() => Promise.resolve(REMOTE));
  const info = await buildSubscriptionDetail(db as never, "w1", {
    pagarme: gateway,
    pagarmeDashboardBase: BASE,
  });
  assert(info);
  assertEquals(fetched, ["sub_abc"]);
  assertEquals(info.provider, "pagarme");
  assertEquals(info.amount_cents, 113880);
  assertEquals(info.amount_source, "pagarme");
  assertEquals(info.pagarme_dashboard_url, `${BASE}/subscriptions/sub_abc/info`);
  assertEquals(info.pagarme_live_error, false);
  assertEquals(info.pagarme_live?.status, "trialing");
  assertEquals(info.pagarme_live?.card, { brand: "visa", last4: "4242", exp_month: 12, exp_year: 2028 });
  assertEquals(info.pagarme_live?.drift, null);
  assert(
    !calls.some((c) => c.table === "workspace_subscriptions" && c.method !== "from" && c.method !== "select" && c.method !== "eq" && c.method !== "maybeSingle"),
    "the Pagar.me branch must never write to workspace_subscriptions",
  );
});

Deno.test("pagarme row: gateway failure → error flag, live null, mirror and link intact", async () => {
  const { db, calls } = dbFor(PAGARME_ROW, PLAN_NAME_ONLY);
  const { gateway } = fakeGateway(() => Promise.reject(new Error("boom")));
  const info = await buildSubscriptionDetail(db as never, "w1", {
    pagarme: gateway,
    pagarmeDashboardBase: BASE,
  });
  assert(info);
  assertEquals(info.pagarme_live, null);
  assertEquals(info.pagarme_live_error, true);
  assertEquals(info.amount_cents, 113880);
  assertEquals(info.amount_source, "pagarme");
  assertEquals(info.pagarme_dashboard_url, `${BASE}/subscriptions/sub_abc/info`);
  assert(!calls.some((c) => c.table === "workspace_subscriptions" && c.method === "update"));
});

Deno.test("pagarme row: readOnly never calls the gateway and exposes no link", async () => {
  const { db } = dbFor(PAGARME_ROW, PLAN_NAME_ONLY);
  const { gateway, calls: fetched } = fakeGateway(() => Promise.resolve(REMOTE));
  const info = await buildSubscriptionDetail(db as never, "w1", {
    readOnly: true,
    pagarme: gateway,
    pagarmeDashboardBase: BASE,
  });
  assert(info);
  assertEquals(fetched, []);
  assertEquals(info.pagarme_dashboard_url, null);
  assertEquals(info.pagarme_live, null);
  assertEquals(info.pagarme_live_error, false);
  assertEquals(info.amount_source, "pagarme");
});

Deno.test("pagarme row without pagarme_subscription_id: no fetch, no link, mirror only", async () => {
  const { db } = dbFor({ ...PAGARME_ROW, pagarme_subscription_id: null }, PLAN_NAME_ONLY);
  const { gateway, calls: fetched } = fakeGateway(() => Promise.resolve(REMOTE));
  const info = await buildSubscriptionDetail(db as never, "w1", {
    pagarme: gateway,
    pagarmeDashboardBase: BASE,
  });
  assert(info);
  assertEquals(fetched, []);
  assertEquals(info.pagarme_dashboard_url, null);
  assertEquals(info.pagarme_live, null);
});

Deno.test("pagarme row without amount_cents: catalog fallback AND live fetch both happen", async () => {
  const { db } = dbFor(
    { ...PAGARME_ROW, amount_cents: null, currency: null, amount_interval: null },
    [
      { data: { name: "Max" }, error: null },
      { data: { price_brl: 29900, price_brl_annual: 113880 }, error: null },
    ],
  );
  const { gateway, calls: fetched } = fakeGateway(() => Promise.resolve(REMOTE));
  const info = await buildSubscriptionDetail(db as never, "w1", {
    pagarme: gateway,
    pagarmeDashboardBase: BASE,
  });
  assert(info);
  assertEquals(info.amount_cents, 113880);
  assertEquals(info.amount_source, "catalog");
  assertEquals(fetched, ["sub_abc"]);
  assertEquals(info.pagarme_live?.status, "trialing");
});

Deno.test("pagarme row: unset dashboard base → link null but the live read still runs", async () => {
  const { db } = dbFor(PAGARME_ROW, PLAN_NAME_ONLY);
  const { gateway, calls: fetched } = fakeGateway(() => Promise.resolve(REMOTE));
  const info = await buildSubscriptionDetail(db as never, "w1", {
    pagarme: gateway,
    pagarmeDashboardBase: null,
  });
  assert(info);
  assertEquals(info.pagarme_dashboard_url, null);
  assertEquals(fetched, ["sub_abc"]);
  assertEquals(info.pagarme_live?.status, "trialing");
});

Deno.test("stripe row: new fields are null/false and the Pagar.me gateway is never touched", async () => {
  const { db } = dbFor(
    {
      ...PAGARME_ROW,
      provider: "stripe",
      pagarme_subscription_id: null,
      stripe_subscription_id: "sub_stripe",
      amount_cents: null,
      currency: null,
      amount_interval: null,
      billing_interval: "month",
    },
    [
      { data: { name: "Max" }, error: null },
      { data: { price_brl: 29900, price_brl_annual: 113880 }, error: null },
    ],
  );
  const { gateway, calls: fetched } = fakeGateway(() => Promise.reject(new Error("must not be called")));
  // No Stripe loader is registered in tests, so the Stripe path falls back to the catalog.
  const info = await buildSubscriptionDetail(db as never, "w1", {
    pagarme: gateway,
    pagarmeDashboardBase: BASE,
  });
  assert(info);
  assertEquals(info.provider, "stripe");
  assertEquals(info.amount_source, "catalog");
  assertEquals(fetched, []);
  assertEquals(info.pagarme_dashboard_url, null);
  assertEquals(info.pagarme_live, null);
  assertEquals(info.pagarme_live_error, false);
});

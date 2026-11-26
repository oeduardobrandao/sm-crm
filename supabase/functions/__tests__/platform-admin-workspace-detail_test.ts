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

Deno.test("handleGetWorkspace: usage carries Instagram counts (total + active) and storage", async () => {
  const { handleGetWorkspace } = await import("../platform-admin/workspace-detail.ts");
  const { db, calls } = makeFakeDb({
    workspaces: [{
      data: { id: "w1", name: "X", logo_url: null, created_at: "t", plan_id: null, plan_source: null, storage_used_bytes: 5_000_000 },
      error: null,
    }],
    workspace_members: [{ data: [], error: null }],
    clientes: [{ data: null, error: null, count: 3 } as never],
    integracoes_status: [{ data: null, error: null, count: 0 } as never],
    instagram_accounts: [{
      data: [
        { authorization_status: "active" },
        { authorization_status: "revoked" },
        { authorization_status: "active" },
      ],
      error: null,
    }],
    workspace_subscriptions: [{ data: null, error: null }],
  });
  const res = await handleGetWorkspace(db as never, { workspace_id: "w1" }, {}, { readOnly: true });
  const body = await res.json();
  assertEquals(body.usage.instagram_account_count, 3);
  assertEquals(body.usage.instagram_account_count_active, 2);
  assertEquals(body.usage.storage_used_bytes, 5_000_000);
  assertEquals(body.usage.client_count, 3);
  assert(!("storage_used_bytes" in body.workspace), "storage lives under usage, not workspace");
  assert(
    calls.some((c) => c.table === "instagram_accounts" && c.method === "eq" &&
      JSON.stringify(c.args) === JSON.stringify(["clientes.conta_id", "w1"])),
    "Instagram accounts must be scoped to the workspace through clientes.conta_id",
  );
});

Deno.test("handleGetWorkspace: carries demo_created_at and the workspace's affiliate", async () => {
  const { handleGetWorkspace } = await import("../platform-admin/workspace-detail.ts");
  const { db, calls } = makeFakeDb({
    workspaces: [{
      data: {
        id: "w1", name: "X", logo_url: null, created_at: "t", plan_id: null, plan_source: "demo",
        demo_created_at: "2026-10-26T12:00:00Z", storage_used_bytes: 0,
      },
      error: null,
    }],
    workspace_members: [{ data: [], error: null }],
    affiliate_referrals: [{
      data: { affiliate_id: "aff-1", affiliates: { id: "aff-1", nome: "Bia", code: "bia123" } },
      error: null,
    }],
    workspace_subscriptions: [{ data: null, error: null }],
  });
  const res = await handleGetWorkspace(db as never, { workspace_id: "w1" }, {}, { readOnly: true });
  const body = await res.json();
  assertEquals(body.workspace.demo_created_at, "2026-10-26T12:00:00Z");
  assertEquals(body.affiliate, { id: "aff-1", name: "Bia", code: "bia123" });
  const sel = calls.find((c) => c.table === "workspaces" && c.method === "select");
  assert(String(sel?.args[0]).includes("demo_created_at"), "demo_created_at must be selected");
  assert(
    calls.some((c) => c.table === "affiliate_referrals" && c.method === "eq" &&
      JSON.stringify(c.args) === JSON.stringify(["workspace_id", "w1"])),
    "the referral lookup must be scoped to the workspace",
  );
});

Deno.test("handleGetWorkspace: affiliate is null without a referral, demo_created_at null when unset", async () => {
  const { handleGetWorkspace } = await import("../platform-admin/workspace-detail.ts");
  const { db } = makeFakeDb({
    workspaces: [{
      data: { id: "w1", name: "X", logo_url: null, created_at: "t", plan_id: null, plan_source: null, storage_used_bytes: 0 },
      error: null,
    }],
    workspace_members: [{ data: [], error: null }],
    workspace_subscriptions: [{ data: null, error: null }],
  });
  const res = await handleGetWorkspace(db as never, { workspace_id: "w1" }, {}, { readOnly: true });
  const body = await res.json();
  assertEquals(body.affiliate, null);
  assertEquals(body.workspace.demo_created_at, null);
});

Deno.test("handleGetWorkspace: selects and returns the reverse_trial_* columns (null when unset)", async () => {
  const { handleGetWorkspace } = await import("../platform-admin/workspace-detail.ts");
  const { db, calls } = makeFakeDb({
    workspaces: [{
      data: {
        id: "w1", name: "X", logo_url: null, created_at: "t", plan_id: "pro", plan_source: "trial",
        storage_used_bytes: 0, reverse_trial_started_at: "2026-12-01T15:00:00Z",
        reverse_trial_ends_at: "2026-12-15T15:00:00Z",
      },
      error: null,
    }],
    workspace_members: [{ data: [], error: null }],
    workspace_subscriptions: [{ data: null, error: null }],
  });
  const res = await handleGetWorkspace(db as never, { workspace_id: "w1" }, {}, { readOnly: true });
  const body = await res.json();
  assertEquals(body.workspace.plan_source, "trial");
  assertEquals(body.workspace.reverse_trial_started_at, "2026-12-01T15:00:00Z");
  assertEquals(body.workspace.reverse_trial_ends_at, "2026-12-15T15:00:00Z");
  assertEquals(body.workspace.reverse_trial_outcome, null);
  assertEquals(body.workspace.reverse_trial_first_paid_at, null);
  const sel = String(calls.find((c) => c.table === "workspaces" && c.method === "select")?.args[0]);
  for (const col of ["reverse_trial_started_at", "reverse_trial_ends_at", "reverse_trial_outcome", "reverse_trial_card_added_at"]) {
    assert(sel.includes(col), `${col} must be selected`);
  }
});

Deno.test("catalog fallback: a USD workspace reads the USD price and reports usd", async () => {
  const { db, calls } = makeFakeDb({
    workspace_subscriptions: [{
      data: { ...PAGARME_ROW, provider: "stripe", pagarme_subscription_id: null, installments: null, amount_cents: null, currency: null, amount_interval: null, billing_interval: "month" },
      error: null,
    }],
    plans: [
      { data: { name: "Pro" }, error: null },
      { data: { price_brl: 9900, price_brl_annual: null, price_usd: 4900, price_usd_annual: null }, error: null },
    ],
  });
  const info = await buildSubscriptionDetail(db as never, "w1", { billingCurrency: "usd" });
  assert(info);
  assertEquals(info.amount_cents, 4900);
  assertEquals(info.currency, "usd");
  assertEquals(info.amount_source, "catalog");
  // The caller already read workspaces.billing_currency: no second (unchecked) read here.
  assertEquals(calls.filter((c) => c.table === "workspaces").length, 0);
});

Deno.test("catalog fallback: no billingCurrency passed means brl, without reading workspaces", async () => {
  const { db, calls } = makeFakeDb({
    workspace_subscriptions: [{
      data: { ...PAGARME_ROW, provider: "stripe", pagarme_subscription_id: null, installments: null, amount_cents: null, currency: null, amount_interval: null, billing_interval: "month" },
      error: null,
    }],
    plans: [
      { data: { name: "Pro" }, error: null },
      { data: { price_brl: 9900, price_brl_annual: null, price_usd: 4900, price_usd_annual: null }, error: null },
    ],
  });
  const info = await buildSubscriptionDetail(db as never, "w1");
  assert(info);
  assertEquals(info.amount_cents, 9900);
  assertEquals(info.currency, "brl");
  assertEquals(calls.filter((c) => c.table === "workspaces").length, 0);
});

Deno.test("handleGetWorkspace: passes its billing_currency down to the catalog fallback (one workspaces read)", async () => {
  const { handleGetWorkspace } = await import("../platform-admin/workspace-detail.ts");
  const { db, calls } = makeFakeDb({
    workspaces: [{
      data: { id: "w1", name: "X", logo_url: null, created_at: "t", plan_id: "pro", plan_source: "stripe", storage_used_bytes: 0, billing_currency: "usd" },
      error: null,
    }],
    workspace_members: [{ data: [], error: null }],
    workspace_subscriptions: [{
      data: { ...PAGARME_ROW, provider: "stripe", pagarme_subscription_id: null, installments: null, amount_cents: null, currency: null, amount_interval: null, billing_interval: "month", plan_id: "pro" },
      error: null,
    }],
    plans: [
      { data: { id: "pro", name: "Pro" }, error: null },
      { data: { name: "Pro" }, error: null },
      { data: { price_brl: 9900, price_brl_annual: null, price_usd: 4900, price_usd_annual: null }, error: null },
    ],
  });
  const res = await handleGetWorkspace(db as never, { workspace_id: "w1" }, {}, { readOnly: true });
  const body = await res.json();
  assertEquals(body.subscription.amount_cents, 4900);
  assertEquals(body.subscription.currency, "usd");
  assertEquals(calls.filter((c) => c.table === "workspaces" && c.method === "from").length, 1);
});

Deno.test("handleGetWorkspace: selects and returns billing_currency (brl when unset)", async () => {
  const { handleGetWorkspace } = await import("../platform-admin/workspace-detail.ts");
  const run = async (billing_currency: unknown) => {
    const { db, calls } = makeFakeDb({
      workspaces: [{
        data: { id: "w1", name: "X", logo_url: null, created_at: "t", plan_id: "pro", plan_source: "stripe", storage_used_bytes: 0, billing_currency },
        error: null,
      }],
      workspace_members: [{ data: [], error: null }],
      workspace_subscriptions: [{ data: null, error: null }],
    });
    const res = await handleGetWorkspace(db as never, { workspace_id: "w1" }, {}, { readOnly: true });
    const sel = String(calls.find((c) => c.table === "workspaces" && c.method === "select")?.args[0]);
    return { body: await res.json(), sel };
  };
  const usd = await run("usd");
  assertEquals(usd.body.workspace.billing_currency, "usd");
  assert(usd.sel.includes("billing_currency"), "billing_currency must be selected");
  assertEquals((await run(undefined)).body.workspace.billing_currency, "brl");
});

function acqDetailDb(wsExtra: Record<string, unknown>, acq: Record<string, unknown> | null) {
  return makeFakeDb({
    workspaces: [{
      data: {
        id: "w1", name: "X", logo_url: null, created_at: "t", plan_id: null, plan_source: null,
        storage_used_bytes: 0, is_internal: false, ...wsExtra,
      },
      error: null,
    }],
    workspace_members: [{ data: [], error: null }],
    workspace_subscriptions: [{ data: null, error: null }],
    workspace_acquisition: [{ data: acq, error: null }],
  });
}

Deno.test("handleGetWorkspace: acquisition carries the channel bucket, campaign and both touches", async () => {
  const { handleGetWorkspace } = await import("../platform-admin/workspace-detail.ts");
  const { db, calls } = acqDetailDb({}, {
    channel: "meta_ads", campaign: "black-friday", captured: true,
    first_touch: { utm_source: "facebook" }, last_touch: { utm_source: "instagram" },
  });
  const res = await handleGetWorkspace(db as never, { workspace_id: "w1" }, {}, { readOnly: true });
  const body = await res.json();
  assertEquals(body.acquisition, {
    channel: "meta_ads", campaign: "black-friday", captured: true,
    first_touch: { utm_source: "facebook" }, last_touch: { utm_source: "instagram" },
  });
  assert(!("is_internal" in body.workspace), "is_internal is read for bucketing, not exposed");
  assert(
    calls.some((c) => c.table === "workspace_acquisition" && c.method === "eq" &&
      JSON.stringify(c.args) === JSON.stringify(["workspace_id", "w1"])),
    "the acquisition lookup must be scoped to the workspace",
  );
});

Deno.test("handleGetWorkspace: a demo workspace reports channel demo", async () => {
  const { handleGetWorkspace } = await import("../platform-admin/workspace-detail.ts");
  const { db } = acqDetailDb({ demo_created_at: "2026-10-26T12:00:00Z" }, {
    channel: "meta_ads", campaign: null, captured: true, first_touch: null, last_touch: null,
  });
  const res = await handleGetWorkspace(db as never, { workspace_id: "w1" }, {}, { readOnly: true });
  const body = await res.json();
  assertEquals(body.acquisition.channel, "demo");
});

Deno.test("handleGetWorkspace: no acquisition row and not a demo gives acquisition null", async () => {
  const { handleGetWorkspace } = await import("../platform-admin/workspace-detail.ts");
  const { db } = acqDetailDb({}, null);
  const res = await handleGetWorkspace(db as never, { workspace_id: "w1" }, {}, { readOnly: true });
  const body = await res.json();
  assertEquals(body.acquisition, null);
});

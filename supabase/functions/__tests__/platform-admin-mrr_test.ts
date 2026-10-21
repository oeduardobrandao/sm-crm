import { assertEquals } from "./assert.ts";
import { handleGetMrr, handleGetTrials } from "../platform-admin/mrr.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const HEADERS = { "Content-Type": "application/json" };

function makeFakeSvc(rows: {
  subscriptions: Record<string, unknown>[];
  workspaces: Array<{ id: string; name: string; created_at?: string }>;
  plans: Array<{ id: string; name: string; price_brl: number | null; price_brl_annual: number | null }>;
  lastActivity?: Array<{ workspace_id: string; last_activity_at: string | null }>;
}) {
  // workspace_subscriptions is read via fetchAllRows: .in()/.eq() -> .order() -> .range(from, to).
  // Data is only ever handed back through .range(), so a fixture larger than one page proves the
  // handler pages through it instead of stopping at the first slice.
  const subsRangeStep = {
    range: (from: number, to: number) =>
      Promise.resolve({ data: rows.subscriptions.slice(from, to + 1), error: null }),
  };
  const subsOrderStep = { order: () => subsRangeStep };
  const db = {
    from(table: string) {
      if (table === "workspace_subscriptions") {
        return {
          select: () => ({
            in: () => subsOrderStep,
            eq: () => subsOrderStep,
          }),
        };
      }
      if (table === "workspaces") {
        return { select: () => ({ in: () => Promise.resolve({ data: rows.workspaces, error: null }) }) };
      }
      if (table === "plans") {
        return { select: () => ({ in: () => Promise.resolve({ data: rows.plans, error: null }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc(fn: string) {
      if (fn === "admin_workspace_last_activity") {
        return Promise.resolve({ data: rows.lastActivity ?? [], error: null });
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
  };
  return db as unknown as SupabaseClient;
}

const fakeFetchOwnerContacts = (_svc: SupabaseClient, workspaceIds: string[]) =>
  Promise.resolve(
    new Map(
      workspaceIds.map((id) => [
        id,
        { name: `Owner of ${id}`, email: `${id}@example.com`, telefone: "11999999999", marketing_opt_in: true },
      ]),
    ),
  );

Deno.test("handleGetMrr attaches owner_* fields from fetchOwnerContacts to each row", async () => {
  const svc = makeFakeSvc({
    subscriptions: [
      {
        workspace_id: "ws-1",
        provider: "stripe",
        status: "active",
        plan_id: "pro",
        billing_interval: "month",
        stripe_subscription_id: null,
        amount_cents: 9900,
        currency: "brl",
        amount_interval: "month",
        discount_label: null,
      },
    ],
    workspaces: [{ id: "ws-1", name: "Alpha", created_at: "2026-01-01T00:00:00Z" }],
    plans: [{ id: "pro", name: "Pro", price_brl: 9900, price_brl_annual: null }],
    lastActivity: [{ workspace_id: "ws-1", last_activity_at: "2026-08-20T12:00:00Z" }],
  });

  const res = await handleGetMrr(svc, HEADERS, fakeFetchOwnerContacts);
  const body = await res.json();
  assertEquals(body.workspaces.length, 1);
  assertEquals(body.workspaces[0].owner_name, "Owner of ws-1");
  assertEquals(body.workspaces[0].owner_email, "ws-1@example.com");
  assertEquals(body.workspaces[0].owner_telefone, "11999999999");
  assertEquals(body.workspaces[0].owner_marketing_opt_in, true);
  assertEquals(body.workspaces[0].created_at, "2026-01-01T00:00:00Z");
  assertEquals(body.workspaces[0].last_activity_at, "2026-08-20T12:00:00Z");
});

Deno.test("handleGetTrials attaches owner_* fields from fetchOwnerContacts to each row", async () => {
  const svc = makeFakeSvc({
    subscriptions: [
      {
        workspace_id: "ws-2",
        provider: "stripe",
        plan_id: "pro",
        billing_interval: "year",
        stripe_subscription_id: null,
        current_period_end: "2026-09-01T00:00:00Z",
        amount_cents: 99000,
        currency: "brl",
        amount_interval: "year",
        discount_label: null,
      },
    ],
    workspaces: [{ id: "ws-2", name: "Beta", created_at: "2026-08-01T00:00:00Z" }],
    plans: [{ id: "pro", name: "Pro", price_brl: null, price_brl_annual: 99000 }],
    // No RPC row for ws-2: a workspace with no recorded activity comes back null, not missing.
  });

  const res = await handleGetTrials(svc, HEADERS, fakeFetchOwnerContacts);
  const body = await res.json();
  assertEquals(body.trials.length, 1);
  assertEquals(body.trials[0].owner_name, "Owner of ws-2");
  assertEquals(body.trials[0].owner_email, "ws-2@example.com");
  assertEquals(body.trials[0].monthly_cents, 8250); // round(99000/12) = 8250
  assertEquals(body.trials[0].created_at, "2026-08-01T00:00:00Z");
  assertEquals(body.trials[0].last_activity_at, null);
});

Deno.test("handleGetMrr aggregates past the 1000-row PostgREST page", async () => {
  const SUB_COUNT = 1500;
  const subscriptions = Array.from({ length: SUB_COUNT }, (_, i) => ({
    workspace_id: `ws-${i}`,
    provider: "stripe",
    status: "active",
    plan_id: null,
    billing_interval: "month",
    stripe_subscription_id: null,
    // amount_cents already mirrored -> resolveMirrorAmount short-circuits, no live Stripe fetch.
    amount_cents: 1000,
    currency: "brl",
    amount_interval: "month",
    discount_label: null,
  }));
  const workspaces = subscriptions.map((s, i) => ({
    id: s.workspace_id,
    name: `Workspace ${i}`,
    created_at: "2026-01-01T00:00:00Z",
  }));

  const svc = makeFakeSvc({ subscriptions, workspaces, plans: [] });

  const res = await handleGetMrr(svc, HEADERS, async () => new Map());
  const body = await res.json();
  assertEquals(body.paying_count, SUB_COUNT);
  assertEquals(body.workspaces.length, SUB_COUNT);
});

Deno.test("handleGetMrr excludes internal workspaces from the total and the list", async () => {
  const sub = (id: string) => ({
    workspace_id: id, provider: "stripe", status: "active", plan_id: "pro", billing_interval: "month",
    stripe_subscription_id: null, amount_cents: 9900, currency: "brl", amount_interval: "month", discount_label: null,
  });
  const svc = makeFakeSvc({
    subscriptions: [sub("ws-1"), sub("ws-int")],
    workspaces: [{ id: "ws-1", name: "Alpha" }, { id: "ws-int", name: "Interno" }],
    plans: [{ id: "pro", name: "Pro", price_brl: 9900, price_brl_annual: null }],
  });
  const res = await handleGetMrr(svc, HEADERS, fakeFetchOwnerContacts, () => Promise.resolve(new Set(["ws-int"])));
  const body = await res.json();
  assertEquals(body.mrr_cents, 9900);
  assertEquals(body.paying_count, 1);
  assertEquals(body.workspaces.map((w: { workspace_id: string }) => w.workspace_id), ["ws-1"]);
});

Deno.test("handleGetTrials excludes internal workspaces", async () => {
  const trial = (id: string) => ({
    workspace_id: id, provider: "stripe", plan_id: "pro", billing_interval: "month", stripe_subscription_id: null,
    current_period_end: "2026-10-01T00:00:00Z", amount_cents: 9900, currency: "brl", amount_interval: "month", discount_label: null,
  });
  const svc = makeFakeSvc({
    subscriptions: [trial("ws-1"), trial("ws-int")],
    workspaces: [{ id: "ws-1", name: "Alpha" }, { id: "ws-int", name: "Interno" }],
    plans: [{ id: "pro", name: "Pro", price_brl: 9900, price_brl_annual: null }],
  });
  const res = await handleGetTrials(svc, HEADERS, fakeFetchOwnerContacts, () => Promise.resolve(new Set(["ws-int"])));
  const body = await res.json();
  assertEquals(body.trial_count, 1);
  assertEquals(body.trials[0].workspace_id, "ws-1");
});

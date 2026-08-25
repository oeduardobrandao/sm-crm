import { assertEquals } from "./assert.ts";
import { handleGetMrr, handleGetTrials } from "../platform-admin/mrr.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const HEADERS = { "Content-Type": "application/json" };

function makeFakeSvc(rows: {
  subscriptions: Record<string, unknown>[];
  workspaces: Array<{ id: string; name: string }>;
  plans: Array<{ id: string; name: string; price_brl: number | null; price_brl_annual: number | null }>;
}) {
  const db = {
    from(table: string) {
      if (table === "workspace_subscriptions") {
        return {
          select: () => ({
            in: () => Promise.resolve({ data: rows.subscriptions, error: null }),
            eq: () => Promise.resolve({ data: rows.subscriptions, error: null }),
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
    workspaces: [{ id: "ws-1", name: "Alpha" }],
    plans: [{ id: "pro", name: "Pro", price_brl: 9900, price_brl_annual: null }],
  });

  const res = await handleGetMrr(svc, HEADERS, fakeFetchOwnerContacts);
  const body = await res.json();
  assertEquals(body.workspaces.length, 1);
  assertEquals(body.workspaces[0].owner_name, "Owner of ws-1");
  assertEquals(body.workspaces[0].owner_email, "ws-1@example.com");
  assertEquals(body.workspaces[0].owner_telefone, "11999999999");
  assertEquals(body.workspaces[0].owner_marketing_opt_in, true);
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
    workspaces: [{ id: "ws-2", name: "Beta" }],
    plans: [{ id: "pro", name: "Pro", price_brl: null, price_brl_annual: 99000 }],
  });

  const res = await handleGetTrials(svc, HEADERS, fakeFetchOwnerContacts);
  const body = await res.json();
  assertEquals(body.trials.length, 1);
  assertEquals(body.trials[0].owner_name, "Owner of ws-2");
  assertEquals(body.trials[0].owner_email, "ws-2@example.com");
  assertEquals(body.trials[0].monthly_cents, 8250); // round(99000/12) = 8250
});

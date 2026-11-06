import { assertEquals } from "./assert.ts";
import { classifyEnded, handleGetChurned } from "../platform-admin/churn.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const HEADERS = { "Content-Type": "application/json" };
const BASE = {
  ever_subscribed_at: null,
  amount_cents: 13990,
  amount_interval: "month",
  billing_interval: "month",
};
const snap = (status: string, date: string, monthly_cents: number | null = null) => ({
  workspace_id: "ws",
  snapshot_date: date,
  status,
  monthly_cents,
});

Deno.test("classifyEnded: an active snapshot is churn, priced from the latest active day", () => {
  const r = classifyEnded(BASE, [
    snap("trialing", "2026-10-01"),
    snap("active", "2026-10-10", 9990),
    snap("active", "2026-10-20", 13990),
  ]);
  assertEquals(r, { kind: "churn", monthly_cents: 13990 });
});

Deno.test("classifyEnded: trialing with no active day is trial_expired", () => {
  assertEquals(classifyEnded(BASE, [snap("trialing", "2026-10-01")]), {
    kind: "trial_expired",
    monthly_cents: null,
  });
});

Deno.test("classifyEnded: ever_subscribed_at without snapshots is churn, priced from the mirror", () => {
  const r = classifyEnded(
    { ...BASE, ever_subscribed_at: "2026-08-01T00:00:00Z", amount_cents: 120000, amount_interval: "year" },
    [],
  );
  assertEquals(r, { kind: "churn", monthly_cents: 10000 });
});

Deno.test("classifyEnded: no evidence at all is unknown", () => {
  assertEquals(classifyEnded(BASE, []), { kind: "unknown", monthly_cents: null });
});

function makeFakeSvc(rows: {
  subscriptions: Record<string, unknown>[];
  snapshots: Record<string, unknown>[];
}) {
  const ranged = (data: unknown[]) => ({
    range: (from: number, to: number) =>
      Promise.resolve({ data: data.slice(from, to + 1), error: null }),
  });
  const db = {
    from(table: string) {
      if (table === "workspace_subscriptions") {
        return {
          select: () => ({
            in: () => ({ gte: () => ({ order: () => ranged(rows.subscriptions) }) }),
          }),
        };
      }
      if (table === "workspace_subscription_snapshots") {
        return {
          select: () => ({
            in: () => ({
              in: () => ({ order: () => ({ order: () => ranged(rows.snapshots) }) }),
            }),
          }),
        };
      }
      if (table === "workspaces") {
        return {
          select: () => ({
            in: () =>
              Promise.resolve({
                data: [
                  { id: "ws-a", name: "Alfa", created_at: "2026-09-01T00:00:00Z" },
                  { id: "ws-b", name: "Beta", created_at: "2026-09-02T00:00:00Z" },
                  { id: "ws-int", name: "Interno", created_at: "2026-09-03T00:00:00Z" },
                ],
                error: null,
              }),
          }),
        };
      }
      if (table === "plans") {
        return {
          select: () => ({
            in: () => Promise.resolve({ data: [{ id: "pro", name: "Pro" }], error: null }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    rpc(fn: string) {
      if (fn === "admin_workspace_last_activity") return Promise.resolve({ data: [], error: null });
      throw new Error(`unexpected rpc ${fn}`);
    },
  };
  return db as unknown as SupabaseClient;
}

Deno.test("handleGetChurned classifies, sorts newest first, totals lost MRR and skips internal", async () => {
  const sub = (id: string, updated_at: string) => ({
    workspace_id: id,
    status: "canceled",
    plan_id: "pro",
    billing_interval: "month",
    amount_cents: 13990,
    amount_interval: "month",
    ever_subscribed_at: null,
    updated_at,
  });
  const svc = makeFakeSvc({
    subscriptions: [
      sub("ws-a", "2026-10-20T00:00:00Z"),
      sub("ws-b", "2026-11-01T00:00:00Z"),
      sub("ws-int", "2026-11-02T00:00:00Z"),
    ],
    snapshots: [
      { workspace_id: "ws-a", snapshot_date: "2026-10-01", status: "active", monthly_cents: 13990 },
      { workspace_id: "ws-b", snapshot_date: "2026-10-25", status: "trialing", monthly_cents: null },
    ],
  });

  const res = await handleGetChurned(
    svc,
    HEADERS,
    new Date("2026-11-06T00:00:00Z"),
    async () => new Map(),
    async () => new Set(["ws-int"]),
  );
  const body = await res.json();
  assertEquals(
    body.workspaces.map((w: { name: string; kind: string }) => [w.name, w.kind]),
    [["Beta", "trial_expired"], ["Alfa", "churn"]],
  );
  assertEquals(body.workspaces[0].plan_name, "Pro");
  assertEquals(body.churn_count, 1);
  assertEquals(body.trial_expired_count, 1);
  assertEquals(body.lost_mrr_cents, 13990);
});

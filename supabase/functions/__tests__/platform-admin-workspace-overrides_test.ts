import { assert, assertEquals } from "./assert.ts";
import { handleSetWorkspaceOverrides, handleClearWorkspaceOverrides } from "../platform-admin/workspace-overrides.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

type Resp = { data: unknown; error: unknown };
type Call = { table: string; method: string; args: unknown[] };

// Recording fake Supabase client (mirrors the pattern in platform-admin-plan-mutations_test.ts).
function makeFakeDb(responses: Record<string, Resp[]>) {
  const calls: Call[] = [];
  const queues: Record<string, Resp[]> = {};
  for (const k of Object.keys(responses)) queues[k] = [...responses[k]];
  function recorder(table: string) {
    // deno-lint-ignore no-explicit-any
    const rec: any = {};
    const next = (): Resp => (queues[table] ?? []).shift() ?? { data: null, error: null };
    for (const m of ["select", "eq", "in", "gte", "order", "limit", "insert", "update", "upsert", "delete"]) {
      rec[m] = (...args: unknown[]) => { calls.push({ table, method: m, args }); return rec; };
    }
    rec.single = () => { calls.push({ table, method: "single", args: [] }); return Promise.resolve(next()); };
    rec.maybeSingle = () => { calls.push({ table, method: "maybeSingle", args: [] }); return Promise.resolve(next()); };
    rec.then = (resolve: (r: Resp) => unknown) => Promise.resolve(resolve(next()));
    return rec;
  }
  const db = { from: (t: string) => { calls.push({ table: t, method: "from", args: [t] }); return recorder(t); } };
  return { db, calls };
}

function lastPayload(calls: Call[], table: string, method: string): Record<string, unknown> | undefined {
  const matches = calls.filter((x) => x.table === table && x.method === method);
  return matches.at(-1)?.args[0] as Record<string, unknown> | undefined;
}

const HEADERS = { "Content-Type": "application/json" };
const ADMIN_ID = "admin-1";

// ─── set-workspace-overrides ────────────────────────────────────

Deno.test("set-workspace-overrides creates the row on demand for a workspace billed directly (Stripe/Pagar.me), not manually comped", async () => {
  // Regression for: a workspace whose plan came from writeWorkspacePlan (Stripe) or
  // grant_pagarme_plan (Pagar.me) has workspaces.plan_id set but NO workspace_plan_overrides
  // row — that row was only ever created as a side effect of the admin's manual "assign plan"
  // (comp) action. The old code treated "row missing" as "workspace has no plan", rejecting
  // every real paying customer who was never manually comped.
  const { db, calls } = makeFakeDb({
    workspaces: [{ data: { plan_id: "max" }, error: null }],
    workspace_plan_overrides: [
      { data: null, error: null }, // no existing row
      { data: null, error: null }, // insert result
    ],
  });

  const res = await handleSetWorkspaceOverrides(
    db as unknown as SupabaseClient,
    { workspace_id: "ws-1", resource_overrides: { max_clients: 50 }, notes: "comp extra clients" },
    ADMIN_ID,
    HEADERS,
  );

  assertEquals(res.status, 200);
  assertEquals(calls.some((c) => c.table === "workspace_plan_overrides" && c.method === "update"), false);
  const payload = lastPayload(calls, "workspace_plan_overrides", "insert");
  assert(payload, "expected an insert on workspace_plan_overrides");
  assertEquals(payload.workspace_id, "ws-1");
  assertEquals(payload.resource_overrides, { max_clients: 50 });
  assertEquals(payload.notes, "comp extra clients");
  assertEquals(payload.updated_by, ADMIN_ID);
});

Deno.test("set-workspace-overrides still rejects a workspace with truly no plan assigned", async () => {
  const { db, calls } = makeFakeDb({
    workspaces: [{ data: { plan_id: null }, error: null }],
  });

  const res = await handleSetWorkspaceOverrides(
    db as unknown as SupabaseClient,
    { workspace_id: "ws-2", resource_overrides: { max_clients: 50 } },
    ADMIN_ID,
    HEADERS,
  );

  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "Workspace has no plan assigned. Assign a plan first.");
  // Must reject before ever touching workspace_plan_overrides.
  assertEquals(calls.some((c) => c.table === "workspace_plan_overrides"), false);
});

Deno.test("set-workspace-overrides updates the existing row instead of inserting (manual comp path unchanged)", async () => {
  const { db, calls } = makeFakeDb({
    workspaces: [{ data: { plan_id: "max" }, error: null }],
    workspace_plan_overrides: [
      { data: { id: "ov-1" }, error: null }, // existing row
      { data: null, error: null }, // update result
    ],
  });

  const res = await handleSetWorkspaceOverrides(
    db as unknown as SupabaseClient,
    { workspace_id: "ws-3", resource_overrides: { max_clients: 10 } },
    ADMIN_ID,
    HEADERS,
  );

  assertEquals(res.status, 200);
  assertEquals(calls.some((c) => c.table === "workspace_plan_overrides" && c.method === "insert"), false);
  const payload = lastPayload(calls, "workspace_plan_overrides", "update");
  assert(payload, "expected an update on workspace_plan_overrides");
  assertEquals(payload.resource_overrides, { max_clients: 10 });
  assertEquals(payload.updated_by, ADMIN_ID);
});

// ─── clear-workspace-overrides ──────────────────────────────────

Deno.test("clear-workspace-overrides is a no-op success when there is no override row", async () => {
  const { db, calls } = makeFakeDb({
    workspace_plan_overrides: [{ data: null, error: null }],
  });

  const res = await handleClearWorkspaceOverrides(
    db as unknown as SupabaseClient,
    { workspace_id: "ws-4" },
    ADMIN_ID,
    HEADERS,
  );

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.message, "Overrides cleared");
  assertEquals(calls.some((c) => c.table === "workspace_plan_overrides" && c.method === "update"), false);
});

Deno.test("clear-workspace-overrides nulls out an existing row", async () => {
  const { db, calls } = makeFakeDb({
    workspace_plan_overrides: [
      { data: { id: "ov-1" }, error: null },
      { data: null, error: null },
    ],
  });

  const res = await handleClearWorkspaceOverrides(
    db as unknown as SupabaseClient,
    { workspace_id: "ws-5" },
    ADMIN_ID,
    HEADERS,
  );

  assertEquals(res.status, 200);
  const payload = lastPayload(calls, "workspace_plan_overrides", "update");
  assert(payload, "expected an update on workspace_plan_overrides");
  assertEquals(payload.resource_overrides, null);
  assertEquals(payload.feature_overrides, null);
});

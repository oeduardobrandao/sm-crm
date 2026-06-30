import { assert, assertEquals } from "./assert.ts";
import { handleCreatePlan, handleUpdatePlan } from "../platform-admin/plan-mutations.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

type Resp = { data: unknown; error: unknown };
type Call = { table: string; method: string; args: unknown[] };

// Recording fake Supabase client (mirrors the pattern in mcp-writes_test.ts).
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

Deno.test("update-plan persists feature_mcp and max_mcp_keys (not silently dropped)", async () => {
  const { db, calls } = makeFakeDb({
    plans: [{ data: { id: "pro", feature_mcp: true, max_mcp_keys: 3 }, error: null }],
  });

  const res = await handleUpdatePlan(
    db as unknown as SupabaseClient,
    { action: "update-plan", plan_id: "pro", feature_mcp: true, max_mcp_keys: 3, feature_leads: true },
    HEADERS,
  );

  assertEquals(res.status, 200);
  const payload = lastPayload(calls, "plans", "update");
  assert(payload, "expected an update on the plans table");
  assertEquals(payload.feature_mcp, true); // DROPPED today: key absent from payload
  assertEquals(payload.max_mcp_keys, 3); // DROPPED today: key absent from payload
  // Control: a column that already worked must keep working.
  assertEquals(payload.feature_leads, true);
});

Deno.test("create-plan persists feature_mcp and max_mcp_keys", async () => {
  const { db, calls } = makeFakeDb({
    plans: [{ data: { id: "new", feature_mcp: true, max_mcp_keys: 2 }, error: null }],
  });

  const res = await handleCreatePlan(
    db as unknown as SupabaseClient,
    { action: "create-plan", name: "New", feature_mcp: true, max_mcp_keys: 2, max_clients: 7 },
    HEADERS,
  );

  assertEquals(res.status, 201);
  const payload = lastPayload(calls, "plans", "insert");
  assert(payload, "expected an insert on the plans table");
  assertEquals(payload.feature_mcp, true);
  assertEquals(payload.max_mcp_keys, 2);
  // Control: a column that already worked must keep working.
  assertEquals(payload.max_clients, 7);
});

Deno.test("update-plan with is_default:true persists feature_mcp via the real update, not the demote call", async () => {
  const { db, calls } = makeFakeDb({
    plans: [
      { data: null, error: null }, // demote: update({is_default:false}).eq("is_default", true)
      { data: { id: "pro", feature_mcp: true, is_default: true }, error: null }, // real update .single()
    ],
  });

  const res = await handleUpdatePlan(
    db as unknown as SupabaseClient,
    { action: "update-plan", plan_id: "pro", is_default: true, feature_mcp: true, max_mcp_keys: 4 },
    HEADERS,
  );

  assertEquals(res.status, 200);
  // Two updates fire on plans: [0] demotes the previous default, [1] is the real edit.
  const planUpdates = calls.filter((c) => c.table === "plans" && c.method === "update");
  assertEquals(planUpdates.length, 2);
  assertEquals(planUpdates[0].args[0], { is_default: false }); // demote carries no plan fields
  const real = lastPayload(calls, "plans", "update");
  assert(real, "expected a real update on the plans table");
  assertEquals(real.feature_mcp, true); // dropped under the drift bug
  assertEquals(real.max_mcp_keys, 4);
  assertEquals(real.is_default, true);
});

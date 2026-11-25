import { assert, assertEquals } from "./assert.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { handleSetWorkspacePlan, handleUnsetWorkspacePlan } from "../platform-admin/workspace-plan.ts";
import { callsTo, HEADERS, indexOfCall, makeFakeDb } from "./platform-admin-fake-db.ts";

const IDS = { adminId: "admin-1", userId: "user-1" };

function asSvc(db: unknown) {
  return db as unknown as SupabaseClient;
}

function workspaceUpdates(calls: ReturnType<typeof makeFakeDb>["calls"]) {
  return callsTo(calls, "workspaces", "update").map((c) => c.args[0] as Record<string, unknown>);
}

Deno.test("comp_ends_trial", async () => {
  const { db, calls } = makeFakeDb(
    {
      workspaces: [{ data: { plan_source: "trial" }, error: null }],
      workspace_plan_overrides: [{ data: null, error: null }],
    },
    { end_reverse_trial: [{ data: true, error: null }] },
  );
  const res = await handleSetWorkspacePlan(asSvc(db), { workspace_id: "ws-1", plan_id: "max" }, IDS, HEADERS);
  assertEquals(res.status, 200);

  const rpc = callsTo(calls, "rpc:end_reverse_trial", "rpc")[0];
  assert(rpc, "comp on a trial workspace must end the trial");
  assertEquals(rpc.args[0], { p_workspace: "ws-1", p_outcome: "ended_by_admin" });

  // The RPC compare-and-sets on plan_source='trial': it must run BEFORE the manual write.
  const rpcAt = indexOfCall(calls, "rpc:end_reverse_trial", "rpc");
  const updateAt = indexOfCall(calls, "workspaces", "update");
  assert(rpcAt >= 0 && updateAt > rpcAt, "end_reverse_trial before writing plan_source='manual'");
  assertEquals(workspaceUpdates(calls)[0], { plan_id: "max", plan_source: "manual" });

  const audit = callsTo(calls, "audit_log", "insert")[0]?.args[0] as Record<string, unknown>;
  assertEquals(audit.action, "admin-end-reverse-trial");
  assertEquals(audit.actor_user_id, "user-1");
  assertEquals((audit.metadata as Record<string, unknown>).reason, "comp");
  assertEquals("conta_id" in audit, false);
});

Deno.test("comp on a trial: RPC false (raced with a conversion) still comps, without the end audit", async () => {
  const { db, calls } = makeFakeDb(
    {
      workspaces: [{ data: { plan_source: "trial" }, error: null }],
      workspace_plan_overrides: [{ data: { id: 1 }, error: null }],
    },
    { end_reverse_trial: [{ data: false, error: null }] },
  );
  const res = await handleSetWorkspacePlan(asSvc(db), { workspace_id: "ws-1", plan_id: "max" }, IDS, HEADERS);
  assertEquals(res.status, 200);
  assertEquals(workspaceUpdates(calls)[0], { plan_id: "max", plan_source: "manual" });
  assertEquals(callsTo(calls, "audit_log", "insert").length, 0);
});

Deno.test("comp on a trial: RPC error throws and writes nothing", async () => {
  const { db, calls } = makeFakeDb(
    { workspaces: [{ data: { plan_source: "trial" }, error: null }] },
    { end_reverse_trial: [{ data: null, error: { message: "boom" } }] },
  );
  let threw = false;
  try {
    await handleSetWorkspacePlan(asSvc(db), { workspace_id: "ws-1", plan_id: "max" }, IDS, HEADERS);
  } catch {
    threw = true;
  }
  assert(threw, "expected a throw");
  assertEquals(workspaceUpdates(calls).length, 0);
});

Deno.test("comp on a non-trial workspace never calls end_reverse_trial", async () => {
  const { db, calls } = makeFakeDb({
    workspaces: [{ data: { plan_source: "stripe" }, error: null }],
    workspace_plan_overrides: [{ data: null, error: null }],
  });
  const res = await handleSetWorkspacePlan(asSvc(db), { workspace_id: "ws-1", plan_id: "pro" }, IDS, HEADERS);
  assertEquals(res.status, 200);
  assertEquals(callsTo(calls, "rpc:end_reverse_trial", "rpc").length, 0);
  assertEquals(workspaceUpdates(calls)[0], { plan_id: "pro", plan_source: "manual" });
  // Overrides row created on demand for the comp, as before.
  assertEquals(callsTo(calls, "workspace_plan_overrides", "insert").length, 1);
});

Deno.test("comp: missing ids is 400", async () => {
  const { db } = makeFakeDb();
  const res = await handleSetWorkspacePlan(asSvc(db), { workspace_id: "ws-1", plan_id: "" }, IDS, HEADERS);
  assertEquals(res.status, 400);
});

Deno.test("un-comp on a trial workspace is 409 in_reverse_trial and writes nothing", async () => {
  const { db, calls } = makeFakeDb({ workspaces: [{ data: { plan_source: "trial" }, error: null }] });
  const res = await handleUnsetWorkspacePlan(asSvc(db), { workspace_id: "ws-1" }, IDS.adminId, HEADERS);
  assertEquals(res.status, 409);
  const body = await res.json();
  assertEquals(body.code, "in_reverse_trial");
  assertEquals(workspaceUpdates(calls).length, 0);
});

Deno.test("un-comp on a manual workspace hands control back (revert target)", async () => {
  const { db, calls } = makeFakeDb({
    workspaces: [{ data: { plan_source: "manual" }, error: null }],
    workspace_subscriptions: [{ data: { status: "active", plan_id: "pro", provider: "stripe" }, error: null }],
    plans: [{ data: { id: "free" }, error: null }],
  });
  const res = await handleUnsetWorkspacePlan(asSvc(db), { workspace_id: "ws-1" }, IDS.adminId, HEADERS);
  assertEquals(res.status, 200);
  assertEquals(workspaceUpdates(calls)[0], { plan_id: "pro", plan_source: "stripe" });
});

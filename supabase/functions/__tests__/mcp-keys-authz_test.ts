import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { hasPermissionFor } from "../_shared/permissions.ts";

// mcp-keys/index.ts wraps its handler in Deno.serve, which no test in this
// suite invokes directly (it would bind a real network listener). This file
// pairs a source-contract check (confirms index.ts actually wires the gate
// this way) with a mirror of the decision logic exercised against the REAL
// hasPermissionFor + a stubbed service client.
//
// Task 11: the gate moved from `profiles.role` (global, stale after a
// workspace switch) to `has_permission_for(user, active_workspace_id,
// 'configuracoes', <action>)`.
//
// Revisão externa (P2): that gate demanded 'editar' for EVERY action,
// including 'list'. A papel with `configuracoes:ver` legitimately opens the
// read-only MCP tab, and got a 403 plus an empty list. The action is now
// parsed BEFORE the gate and only mutations require 'editar'.

function assertMatch(value: string, pattern: RegExp, msg?: string) {
  assert(pattern.test(value), msg ?? `Expected source to match ${pattern}`);
}

const source = await Deno.readTextFile(
  new URL("../mcp-keys/index.ts", import.meta.url),
);

Deno.test("mcp-keys: gate resolves active_workspace_id, then checks has_permission_for('configuracoes', requiredAction)", () => {
  assertMatch(source, /import \{ hasPermissionFor \} from ["']\.\.\/_shared\/permissions\.ts["']/);
  assertMatch(source, /\.select\(["']active_workspace_id["']\)/);
  assertMatch(
    source,
    /hasPermissionFor\(svc,\s*user\.id,\s*contaId,\s*["']configuracoes["'],\s*requiredAction\)/,
  );
  assert(
    !/\.select\(["']role, conta_id["']\)/.test(source),
    "the old profiles.role/conta_id select must be gone",
  );
  assert(
    !/profile\.role !== ["']owner["']/.test(source),
    "the old role-literal gate must be gone, not merely bypassed",
  );
});

Deno.test("mcp-keys: the action is parsed BEFORE the gate, and only 'list' downgrades to 'ver'", () => {
  assertMatch(source, /const requiredAction = action === ["']list["'] \? ["']ver["'] : ["']editar["']/);
  // Ordering is the whole point: a gate computed before `action` exists would
  // read `undefined` and silently demand 'editar' for everything again.
  const actionIdx = source.indexOf("const action = body.action");
  const gateIdx = source.indexOf("const requiredAction");
  assert(actionIdx > -1 && gateIdx > actionIdx, "action must be parsed before requiredAction");
  assert(
    !/hasPermissionFor\([^)]*["']configuracoes["'],\s*["']editar["']\)/.test(source),
    "no hardcoded 'editar' gate may remain -- it must go through requiredAction",
  );
});

/** Mirrors the gate in index.ts, against the REAL hasPermissionFor. */
async function gate(
  // deno-lint-ignore no-explicit-any
  svc: any,
  userId: string,
  profile: { active_workspace_id: string | null } | null,
  action = "create",
): Promise<{ status: number; contaId?: string }> {
  if (!profile?.active_workspace_id) return { status: 403 };
  const contaId = profile.active_workspace_id;
  const requiredAction = action === "list" ? "ver" : "editar";
  const canManage = await hasPermissionFor(svc, userId, contaId, "configuracoes", requiredAction);
  if (!canManage) return { status: 403 };
  return { status: 200, contaId };
}

Deno.test("no profile / no active workspace -> 403, no RPC call", async () => {
  const svc = createSupabaseQueryMock();
  assertEquals((await gate(svc, "u1", null)).status, 403);
  assertEquals((await gate(svc, "u1", { active_workspace_id: null })).status, 403);
  assertEquals(svc.calls.length, 0);
});

Deno.test("legacy owner/admin: has_permission_for('configuracoes','editar') resolves true", async () => {
  const svc = createSupabaseQueryMock();
  svc.queueRpc("has_permission_for", { data: true, error: null });
  const result = await gate(svc, "u1", { active_workspace_id: "ws-a" });
  assertEquals(result, { status: 200, contaId: "ws-a" });
  const call = svc.calls.find((c: { table: string }) => c.table === "rpc:has_permission_for");
  assertEquals(call?.payload, { p_user: "u1", p_workspace: "ws-a", p_module: "configuracoes", p_action: "editar" });
});

Deno.test("legacy agent: has_permission_for('configuracoes','editar') resolves false", async () => {
  const svc = createSupabaseQueryMock();
  svc.queueRpc("has_permission_for", { data: false, error: null });
  const result = await gate(svc, "u1", { active_workspace_id: "ws-a" });
  assertEquals(result.status, 403);
});

Deno.test("custom role (chassis 'agent') WITH configuracoes:editar -> allowed", async () => {
  const svc = createSupabaseQueryMock();
  svc.queueRpc("has_permission_for", { data: true, error: null });
  assertEquals((await gate(svc, "u1", { active_workspace_id: "ws-a" })).status, 200);
});

Deno.test("custom role (chassis 'agent') WITHOUT configuracoes:editar -> refused", async () => {
  const svc = createSupabaseQueryMock();
  svc.queueRpc("has_permission_for", { data: false, error: null });
  assertEquals((await gate(svc, "u1", { active_workspace_id: "ws-a" })).status, 403);
});

/**
 * Revisão externa (P2): the read/write split. `has_permission_for` is asked
 * for a DIFFERENT action per request, so these assert the p_action actually
 * sent, not just the resulting status -- a regression that kept demanding
 * 'editar' while a permissive stub said `true` would pass a status-only test.
 */
Deno.test("ver-only role: 'list' is allowed and asks for p_action 'ver'", async () => {
  const svc = createSupabaseQueryMock();
  svc.queueRpc("has_permission_for", { data: true, error: null });
  assertEquals((await gate(svc, "u1", { active_workspace_id: "ws-a" }, "list")).status, 200);
  const call = svc.calls.find((c: { table: string }) => c.table === "rpc:has_permission_for");
  assertEquals(call?.payload, {
    p_user: "u1",
    p_workspace: "ws-a",
    p_module: "configuracoes",
    p_action: "ver",
  });
});

Deno.test("ver-only role: mutations still ask for 'editar' and are refused", async () => {
  for (const action of ["create", "revoke"]) {
    const svc = createSupabaseQueryMock();
    // A ver-only papel: has_permission_for('configuracoes','editar') is false.
    svc.queueRpc("has_permission_for", { data: false, error: null });
    assertEquals(
      (await gate(svc, "u1", { active_workspace_id: "ws-a" }, action)).status,
      403,
      `${action} must stay 403 for a ver-only role`,
    );
    const call = svc.calls.find((c: { table: string }) => c.table === "rpc:has_permission_for");
    assertEquals(
      (call?.payload as { p_action: string }).p_action,
      "editar",
      `${action} must ask for 'editar'`,
    );
  }
});

Deno.test("an unknown action is treated as a mutation, not as a read", async () => {
  const svc = createSupabaseQueryMock();
  svc.queueRpc("has_permission_for", { data: false, error: null });
  // Fails closed: only the literal 'list' downgrades.
  assertEquals((await gate(svc, "u1", { active_workspace_id: "ws-a" }, "listar")).status, 403);
  const call = svc.calls.find((c: { table: string }) => c.table === "rpc:has_permission_for");
  assertEquals((call?.payload as { p_action: string }).p_action, "editar");
});

Deno.test("a role with NEITHER ver nor editar is refused even on 'list'", async () => {
  const svc = createSupabaseQueryMock();
  svc.queueRpc("has_permission_for", { data: false, error: null });
  assertEquals((await gate(svc, "u1", { active_workspace_id: "ws-a" }, "list")).status, 403);
});

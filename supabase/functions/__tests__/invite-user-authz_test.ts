import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { hasPermissionFor } from "../_shared/permissions.ts";

// invite-user/index.ts wraps its handler in Deno.serve, which no test in this
// suite invokes directly (it would bind a real network listener). Every other
// Deno.serve-wrapped edge function in this repo is instead covered by a
// source-contract test (see manage-workspace-invite-contract_test.ts) plus a
// mirror of the decision logic exercised against the REAL hasPermissionFor.
// This file does both for the Task-11 rewire: the "Agentes não têm permissão
// para [convidar/cancelar]" gates moved from `caller.role === 'agent'` to
// `hasPermissionFor(adminClient, user.id, caller.workspaceId, 'equipe', 'editar')`.

function assertMatch(value: string, pattern: RegExp, msg?: string) {
  assert(pattern.test(value), msg ?? `Expected source to match ${pattern}`);
}

const source = await Deno.readTextFile(
  new URL("../invite-user/index.ts", import.meta.url),
);

Deno.test("invite-user: cancel-invite (DELETE) and send-invite (POST) both gate on has_permission_for('equipe','editar')", () => {
  assertMatch(source, /import \{ hasPermissionFor \} from ["']\.\.\/_shared\/permissions\.ts["']/);
  const calls = source.match(/hasPermissionFor\(\s*adminClient,\s*user\.id,\s*caller\.workspaceId,\s*["']equipe["'],\s*["']editar["'],?\s*\)/g) ?? [];
  assertEquals(calls.length, 2, "expected one hasPermissionFor call in the DELETE branch and one in the POST branch");
  assert(
    !/caller\.role === ['"]agent['"]/.test(source),
    "the old role-literal gate must be gone, not merely bypassed",
  );
});

Deno.test("invite-user: admin-can't-invite-owner stays a role-literal check (not migrated to the permission model)", () => {
  // This rule is deliberately NOT part of Task 11's rewire -- it targets the
  // legacy 'owner' role specifically, not a delegable module permission.
  assertMatch(source, /caller\.role === ['"]admin['"] && role === ['"]owner['"]/);
  assertMatch(source, /Administradores não podem convidar novos donos\./);
});

/** Mirrors the DELETE/POST actor gate in index.ts, against the REAL hasPermissionFor. */
async function canManageTeam(
  // deno-lint-ignore no-explicit-any
  svc: any,
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  return await hasPermissionFor(svc, userId, workspaceId, "equipe", "editar");
}

Deno.test("legacy owner/admin: has_permission_for('equipe','editar') resolves true", async () => {
  const svc = createSupabaseQueryMock();
  svc.queueRpc("has_permission_for", { data: true, error: null });
  assertEquals(await canManageTeam(svc, "u1", "ws-a"), true);
  const call = svc.calls.find((c: { table: string }) => c.table === "rpc:has_permission_for");
  assertEquals(call?.payload, { p_user: "u1", p_workspace: "ws-a", p_module: "equipe", p_action: "editar" });
});

Deno.test("legacy agent: has_permission_for('equipe','editar') resolves false (not in the agent preset)", async () => {
  const svc = createSupabaseQueryMock();
  svc.queueRpc("has_permission_for", { data: false, error: null });
  assertEquals(await canManageTeam(svc, "u1", "ws-a"), false);
});

Deno.test("custom role (chassis 'agent') WITH equipe:editar -> true", async () => {
  const svc = createSupabaseQueryMock();
  svc.queueRpc("has_permission_for", { data: true, error: null });
  assertEquals(await canManageTeam(svc, "u1", "ws-a"), true);
});

Deno.test("custom role (chassis 'agent') WITHOUT equipe:editar -> false", async () => {
  const svc = createSupabaseQueryMock();
  svc.queueRpc("has_permission_for", { data: false, error: null });
  assertEquals(await canManageTeam(svc, "u1", "ws-a"), false);
});

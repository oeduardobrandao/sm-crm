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

Deno.test("invite-user: only-owner-invites-owner stays a role-literal check (not migrated to the permission model)", () => {
  // This rule is deliberately NOT part of Task 11's rewire -- it targets the
  // legacy 'owner' role specifically, not a delegable module permission.
  //
  // External-review fix: the ORIGINAL literal here was `caller.role ===
  // 'admin' && role === 'owner'`, which only ever blocked the legacy admin
  // role. A custom role (chassis role='agent') with 'equipe':'editar' sails
  // past the actor gate above and, under the old literal, could invite
  // itself or anyone else as owner -- a privilege escalation. The condition
  // must be `caller.role !== 'owner'`, not `=== 'admin'`.
  assertMatch(source, /caller\.role !== ['"]owner['"] && role === ['"]owner['"]/);
  assert(
    !/caller\.role === ['"]admin['"] && role === ['"]owner['"]/.test(source),
    "the old admin-literal check must be gone, not merely supplemented",
  );
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

// --- Only-owner-invites-owner guard (external-review fix) ---

/** Mirrors the fixed "only owner invites owner" guard in index.ts. */
function ownerInviteBlocked(callerRole: string, invitedRole: string): boolean {
  return callerRole !== "owner" && invitedRole === "owner";
}

Deno.test("owner-invite guard: custom-role actor (chassis 'agent', has equipe:editar) inviting role 'owner' -> denied", () => {
  // This actor already passed the equipe:editar actor gate above (mirrored
  // separately) -- the point of this guard is that passing THAT gate must
  // not also authorize minting a new owner.
  assertEquals(ownerInviteBlocked("agent", "owner"), true);
});

Deno.test("owner-invite guard: legacy admin inviting role 'owner' -> still denied (regression)", () => {
  assertEquals(ownerInviteBlocked("admin", "owner"), true);
});

Deno.test("owner-invite guard: owner inviting role 'owner' -> still allowed", () => {
  assertEquals(ownerInviteBlocked("owner", "owner"), false);
});

Deno.test("owner-invite guard: any caller inviting a non-owner role is unaffected", () => {
  assertEquals(ownerInviteBlocked("agent", "admin"), false);
  assertEquals(ownerInviteBlocked("admin", "agent"), false);
  assertEquals(ownerInviteBlocked("owner", "admin"), false);
});

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

// --- "Apenas donos e admins podem convidar com função elevada ou papel." guard ---
//
// Second external-review round: "atribuição segue dono e admin" (spec
// decision). An actor who only holds 'equipe':'editar' (never a legacy
// owner/admin) could otherwise invite someone as role='admin' (the legacy
// all-modules preset) or attach ANY role_id -- a permission set the actor
// itself may not hold. role==='owner' is excluded upstream by the guard
// above; this covers the remaining elevated shapes: role='admin', or any
// role_id (custom permission set) regardless of the coarse `role` value.

Deno.test("invite-user: the elevated-invite guard is a source fact, not merely a code comment", () => {
  assertMatch(
    source,
    /const isPrivilegedActor = caller\.role === ['"]owner['"] \|\| caller\.role === ['"]admin['"];/,
  );
  assertMatch(
    source,
    /if \(!isPrivilegedActor && \(role !== ['"]agent['"] \|\| typeof roleId === ['"]string['"]\)\)/,
  );
  assertMatch(source, /Apenas donos e admins podem convidar com função elevada ou papel\./);
});

/** Mirrors the elevated-invite guard in index.ts. */
function elevatedInviteBlocked(callerRole: string, role: string, roleId: string | null | undefined): boolean {
  const isPrivilegedActor = callerRole === "owner" || callerRole === "admin";
  return !isPrivilegedActor && (role !== "agent" || typeof roleId === "string");
}

Deno.test("elevated-invite guard: custom-role actor (equipe:editar only) inviting role='admin' -> denied", () => {
  assertEquals(elevatedInviteBlocked("agent", "admin", undefined), true);
  assertEquals(elevatedInviteBlocked("agent", "admin", null), true);
});

Deno.test("elevated-invite guard: custom-role actor inviting role='agent' WITH a role_id -> denied", () => {
  assertEquals(elevatedInviteBlocked("agent", "agent", "6b1f2e2e-1234-4abc-9def-0123456789ab"), true);
});

Deno.test("elevated-invite guard: custom-role actor inviting plain role='agent' with no role_id -> allowed", () => {
  assertEquals(elevatedInviteBlocked("agent", "agent", undefined), false); // key absent
  assertEquals(elevatedInviteBlocked("agent", "agent", null), false); // key present, explicit "no custom role"
});

Deno.test("elevated-invite guard: legacy admin is unaffected -- can invite role='admin' or attach a role_id", () => {
  assertEquals(elevatedInviteBlocked("admin", "admin", undefined), false);
  assertEquals(elevatedInviteBlocked("admin", "agent", "6b1f2e2e-1234-4abc-9def-0123456789ab"), false);
});

Deno.test("elevated-invite guard: owner is unaffected -- can invite any role or attach a role_id", () => {
  assertEquals(elevatedInviteBlocked("owner", "admin", undefined), false);
  assertEquals(elevatedInviteBlocked("owner", "agent", "6b1f2e2e-1234-4abc-9def-0123456789ab"), false);
  assertEquals(elevatedInviteBlocked("owner", "owner", undefined), false);
});

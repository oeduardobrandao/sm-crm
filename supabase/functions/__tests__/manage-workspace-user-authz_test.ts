import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { hasPermissionFor } from "../_shared/permissions.ts";

// The caller's role and workspace must come from workspace_members, never from
// profiles. profiles.role is global -- an owner in workspace A who is an agent
// in workspace B carried `owner` into B -- and until 20260729000002 the client
// could write profiles.conta_id directly. This function acts through a
// service-role client that bypasses RLS, so it is the last line of defence.
//
// Task 11: the actor gate itself moved from a role literal
// (`callerRole !== "owner" && callerRole !== "admin"`) to the permission model
// (`has_permission_for(user, workspace, 'equipe', 'editar')`). `authorize`
// mirrors index.ts's flow using the REAL hasPermissionFor against a stubbed
// service client, so these tests exercise the actual RPC contract, not a
// hand-rolled restatement of it.

/** Mirrors the authorization block in index.ts (post Task-11 rewire). */
async function authorize(
  // deno-lint-ignore no-explicit-any
  svc: any,
  userId: string,
  profile: { active_workspace_id: string | null } | null,
  membership: { role: string } | null,
): Promise<{ status: number; workspaceId?: string; role?: string }> {
  if (!profile?.active_workspace_id) return { status: 403 };
  if (!membership) return { status: 403 };
  const workspaceId = profile.active_workspace_id;
  const canManageTeam = await hasPermissionFor(svc, userId, workspaceId, "equipe", "editar");
  if (!canManageTeam) return { status: 403 };
  return { status: 200, workspaceId, role: membership.role };
}

Deno.test("non-member of the active workspace is refused (no RPC needed)", async () => {
  const svc = createSupabaseQueryMock();
  const result = await authorize(svc, "u1", { active_workspace_id: "ws-b" }, null);
  assertEquals(result.status, 403);
  assertEquals(svc.calls.length, 0, "must not call has_permission_for for a non-member");
});

Deno.test("caller with no active workspace is refused (no RPC needed)", async () => {
  const svc = createSupabaseQueryMock();
  const result = await authorize(svc, "u1", { active_workspace_id: null }, { role: "owner" });
  assertEquals(result.status, 403);
  assertEquals(svc.calls.length, 0);
});

Deno.test("legacy owner of the active workspace is allowed, scoped to that workspace", async () => {
  const svc = createSupabaseQueryMock();
  svc.queueRpc("has_permission_for", { data: true, error: null });
  const result = await authorize(svc, "u1", { active_workspace_id: "ws-a" }, { role: "owner" });
  assertEquals(result.status, 200);
  assertEquals(result.workspaceId, "ws-a");
  assertEquals(result.role, "owner");
  const call = svc.calls.find((c: { table: string }) => c.table === "rpc:has_permission_for");
  assertEquals(call?.payload, { p_user: "u1", p_workspace: "ws-a", p_module: "equipe", p_action: "editar" });
});

Deno.test("legacy admin of the active workspace is allowed", async () => {
  const svc = createSupabaseQueryMock();
  svc.queueRpc("has_permission_for", { data: true, error: null });
  const result = await authorize(svc, "u1", { active_workspace_id: "ws-a" }, { role: "admin" });
  assertEquals(result.status, 200);
});

Deno.test("legacy agent in the active workspace is refused (no 'equipe' in the agent preset)", async () => {
  const svc = createSupabaseQueryMock();
  svc.queueRpc("has_permission_for", { data: false, error: null });
  const result = await authorize(svc, "u1", { active_workspace_id: "ws-b" }, { role: "agent" });
  assertEquals(result.status, 403);
});

Deno.test("custom role (chassis 'agent') WITH equipe:editar is allowed", async () => {
  const svc = createSupabaseQueryMock();
  svc.queueRpc("has_permission_for", { data: true, error: null });
  const result = await authorize(svc, "u1", { active_workspace_id: "ws-a" }, { role: "agent" });
  assertEquals(result.status, 200);
});

Deno.test("custom role (chassis 'agent') WITHOUT equipe:editar is refused", async () => {
  const svc = createSupabaseQueryMock();
  svc.queueRpc("has_permission_for", { data: false, error: null });
  const result = await authorize(svc, "u1", { active_workspace_id: "ws-a" }, { role: "agent" });
  assertEquals(result.status, 403);
});

Deno.test("has_permission_for RPC error fails closed (denied, not thrown)", async () => {
  const svc = createSupabaseQueryMock();
  svc.queueRpc("has_permission_for", { data: null, error: { message: "boom" } });
  const result = await authorize(svc, "u1", { active_workspace_id: "ws-a" }, { role: "owner" });
  assertEquals(result.status, 403);
});

// --- Regression: the owner-protection guards below the actor gate are untouched by Task 11. ---
// These read `callerRole` (loaded from workspace_members, same as before) and `targetMembership`,
// never the permission model -- protecting the owner role itself is deliberately NOT delegable
// via a custom role's 'equipe' permission.

/** Mirrors the "Cannot modify an owner" guard in index.ts. */
function cannotModifyOwner(targetRole: string, callerRole: string): boolean {
  return targetRole === "owner" && callerRole !== "owner";
}

/** Mirrors the "Cannot modify yourself" guard in index.ts. */
function cannotModifySelf(targetUserId: string, callerUserId: string): boolean {
  return targetUserId === callerUserId;
}

Deno.test("regression: admin cannot modify an owner target", () => {
  assertEquals(cannotModifyOwner("owner", "admin"), true);
});

Deno.test("regression: owner CAN modify an owner target", () => {
  assertEquals(cannotModifyOwner("owner", "owner"), false);
});

Deno.test("regression: caller cannot modify themselves, even as owner", () => {
  assertEquals(cannotModifySelf("u1", "u1"), true);
  assertEquals(cannotModifySelf("u1", "u2"), false);
});

// --- Second external-review round: update-role additionally requires owner/admin ---
// Spec decision: "atribuição segue dono e admin". A custom-role actor (chassis
// 'agent') can still hold 'equipe':'editar' and pass the actor gate above --
// enough to remove members and manage invites -- but update-role specifically
// is reserved for the two legacy roles that already hold every permission
// themselves. Without this, such an actor could set a colleague to the legacy
// admin preset (all modules), a permission set the actor doesn't hold.

/** Mirrors the update-role-specific owner/admin gate in index.ts (runs AFTER the actor gate above). */
function updateRoleBlocked(action: string, callerRole: string): boolean {
  return action === "update-role" && callerRole !== "owner" && callerRole !== "admin";
}

Deno.test("update-role: custom-role actor (chassis 'agent', has equipe:editar) is denied", () => {
  assertEquals(updateRoleBlocked("update-role", "agent"), true);
});

Deno.test("update-role: legacy admin is allowed (regression)", () => {
  assertEquals(updateRoleBlocked("update-role", "admin"), false);
});

Deno.test("update-role: legacy owner is allowed (regression)", () => {
  assertEquals(updateRoleBlocked("update-role", "owner"), false);
});

Deno.test("remove and cancel-invite stay on equipe:editar alone -- NOT gated by this owner/admin check", () => {
  assertEquals(updateRoleBlocked("remove", "agent"), false);
  assertEquals(updateRoleBlocked("cancel-invite", "agent"), false);
});

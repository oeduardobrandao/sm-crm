import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// The caller's role and workspace must come from workspace_members, never from
// profiles. profiles.role is global -- an owner in workspace A who is an agent
// in workspace B carried `owner` into B -- and until 20260729000002 the client
// could write profiles.conta_id directly. This function acts through a
// service-role client that bypasses RLS, so it is the last line of defence.

/** Mirrors the authorization block in index.ts. */
function authorize(
  profile: { active_workspace_id: string | null } | null,
  membership: { role: string } | null,
): { status: number; workspaceId?: string; role?: string } {
  if (!profile?.active_workspace_id) return { status: 403 };
  if (!membership) return { status: 403 };
  if (membership.role !== "owner" && membership.role !== "admin") return { status: 403 };
  return { status: 200, workspaceId: profile.active_workspace_id, role: membership.role };
}

Deno.test("agent in the active workspace is refused, whatever profiles.role says", () => {
  // The stale-role case: this user is an owner elsewhere, an agent here.
  const result = authorize({ active_workspace_id: "ws-b" }, { role: "agent" });
  assertEquals(result.status, 403);
});

Deno.test("non-member of the active workspace is refused", () => {
  const result = authorize({ active_workspace_id: "ws-b" }, null);
  assertEquals(result.status, 403);
});

Deno.test("caller with no active workspace is refused", () => {
  const result = authorize({ active_workspace_id: null }, { role: "owner" });
  assertEquals(result.status, 403);
});

Deno.test("owner of the active workspace is allowed, scoped to that workspace", () => {
  const result = authorize({ active_workspace_id: "ws-a" }, { role: "owner" });
  assertEquals(result.status, 200);
  assertEquals(result.workspaceId, "ws-a");
  assertEquals(result.role, "owner");
});

Deno.test("admin of the active workspace is allowed", () => {
  const result = authorize({ active_workspace_id: "ws-a" }, { role: "admin" });
  assertEquals(result.status, 200);
});

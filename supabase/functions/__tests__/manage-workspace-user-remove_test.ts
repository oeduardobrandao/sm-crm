import { assert, assertEquals } from "./assert.ts";
import { removeMember } from "../manage-workspace-user/removeMember.ts";

// Fake client: records every delete/update, and lets the fixture control what
// profiles/workspace_members reads return.
function makeRemoveAdmin(opts: {
  profileActiveWorkspaceId?: string | null; // target's CURRENT active workspace, before removal
  otherMembershipWorkspaceId?: string | null; // another workspace_members row the target still has
  removeError?: boolean; // inject an error on the workspace_members delete
}) {
  const deletes: Array<{ table: string; userId: string; workspaceId: string }> = [];
  const updates: Array<{ table: string; row: any }> = [];
  return {
    _deletes: () => deletes,
    _updates: () => updates,
    // deno-lint-ignore no-explicit-any
    from: (table: string) => {
      let userId = "";
      let workspaceIdFilter: string | undefined;
      const api: any = {
        select: () => api,
        eq: (col: string, val: string) => {
          if (col === "user_id" || col === "id") userId = val;
          if (col === "workspace_id") workspaceIdFilter = val;
          return api;
        },
        limit: () => api,
        delete: () => {
          return {
            eq: (col: string, val: string) => {
              if (col === "user_id") userId = val;
              if (col === "workspace_id") workspaceIdFilter = val;
              return {
                eq: (col2: string, val2: string) => {
                  if (col2 === "user_id") userId = val2;
                  if (col2 === "workspace_id") workspaceIdFilter = val2;
                  deletes.push({ table, userId, workspaceId: workspaceIdFilter ?? "" });
                  return Promise.resolve({ error: opts.removeError ? { message: "boom" } : null });
                },
              };
            },
          };
        },
        update: (row: any) => {
          updates.push({ table, row });
          return { eq: () => Promise.resolve({ error: null }) };
        },
        maybeSingle: () => {
          if (table === "profiles") {
            return Promise.resolve({
              data: { active_workspace_id: opts.profileActiveWorkspaceId ?? null },
              error: null,
            });
          }
          if (table === "workspace_members") {
            return Promise.resolve({
              data: opts.otherMembershipWorkspaceId ? { workspace_id: opts.otherMembershipWorkspaceId } : null,
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
      return api;
    },
  };
}

Deno.test("removeMember deletes the target's membership row for the given workspace", async () => {
  const admin = makeRemoveAdmin({ profileActiveWorkspaceId: "other-ws" });
  // deno-lint-ignore no-explicit-any
  await removeMember(admin as any, { targetUserId: "u1", workspaceId: "ws-a" });
  assertEquals(admin._deletes(), [{ table: "workspace_members", userId: "u1", workspaceId: "ws-a" }]);
});

Deno.test("removeMember throws when the membership delete errors, without touching profiles", async () => {
  const admin = makeRemoveAdmin({ removeError: true });
  let threw = false;
  try {
    // deno-lint-ignore no-explicit-any
    await removeMember(admin as any, { targetUserId: "u1", workspaceId: "ws-a" });
  } catch {
    threw = true;
  }
  assert(threw, "expected the delete error to propagate");
  assertEquals(admin._updates(), []);
});

Deno.test("removeMember nulls active_workspace_id when the removed workspace WAS the active one and none remain", async () => {
  const admin = makeRemoveAdmin({ profileActiveWorkspaceId: "ws-a", otherMembershipWorkspaceId: null });
  // deno-lint-ignore no-explicit-any
  await removeMember(admin as any, { targetUserId: "u1", workspaceId: "ws-a" });
  assertEquals(admin._updates(), [
    { table: "profiles", row: { active_workspace_id: null, conta_id: null } },
  ]);
});

Deno.test("removeMember falls back to a remaining membership when the removed workspace WAS the active one", async () => {
  const admin = makeRemoveAdmin({ profileActiveWorkspaceId: "ws-a", otherMembershipWorkspaceId: "ws-b" });
  // deno-lint-ignore no-explicit-any
  await removeMember(admin as any, { targetUserId: "u1", workspaceId: "ws-a" });
  assertEquals(admin._updates(), [
    { table: "profiles", row: { active_workspace_id: "ws-b", conta_id: "ws-b" } },
  ]);
});

Deno.test("removeMember leaves active_workspace_id untouched when the removed workspace was NOT the active one", async () => {
  // The bug this fixes: removing someone from a workspace that ISN'T where
  // they're currently working must never reassign their active workspace.
  const admin = makeRemoveAdmin({ profileActiveWorkspaceId: "ws-somewhere-else", otherMembershipWorkspaceId: "ws-b" });
  // deno-lint-ignore no-explicit-any
  await removeMember(admin as any, { targetUserId: "u1", workspaceId: "ws-a" });
  assertEquals(admin._updates(), []);
});

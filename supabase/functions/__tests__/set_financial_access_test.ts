import { assertEquals } from "jsr:@std/assert";
import { handleSetFinancialAccess } from "../manage-workspace-user/setFinancialAccess.ts";

function fakeClient(rpcResult: { data?: unknown; error?: { message: string } }) {
  const calls: unknown[] = [];
  return {
    calls,
    rpc: (name: string, args: unknown) => {
      calls.push({ name, args });
      return Promise.resolve(rpcResult);
    },
  };
}

Deno.test("owner toggling an admin succeeds and reports the change", async () => {
  const client = fakeClient({ data: "updated" });
  const res = await handleSetFinancialAccess(client as never, {
    actorUserId: "owner-1",
    targetUserId: "admin-1",
    workspaceId: "ws-1",
    value: false,
  });
  assertEquals(res.status, 200);
  assertEquals(res.changed, true);
  assertEquals(client.calls.length, 1);
  assertEquals(client.calls[0], {
    name: "set_financial_access",
    args: {
      p_actor: "owner-1",
      p_target: "admin-1",
      p_workspace: "ws-1",
      p_value: false,
    },
  });
});

Deno.test("a caller whose MEMBERSHIP role is admin is rejected even if profiles says owner", async () => {
  const client = fakeClient({ error: { message: "not_owner" } });
  const res = await handleSetFinancialAccess(client as never, {
    actorUserId: "admin-2",
    targetUserId: "admin-1",
    workspaceId: "ws-1",
    value: false,
  });
  assertEquals(res.status, 403);
});

Deno.test("a non-admin target is rejected", async () => {
  const client = fakeClient({ error: { message: "target_not_admin" } });
  const res = await handleSetFinancialAccess(client as never, {
    actorUserId: "owner-1",
    targetUserId: "agent-1",
    workspaceId: "ws-1",
    value: false,
  });
  assertEquals(res.status, 400);
});

Deno.test("a foreign-workspace target is rejected", async () => {
  const client = fakeClient({ error: { message: "target_not_member" } });
  const res = await handleSetFinancialAccess(client as never, {
    actorUserId: "owner-1",
    targetUserId: "someone-else",
    workspaceId: "ws-1",
    value: false,
  });
  assertEquals(res.status, 404);
});

Deno.test("a no-op succeeds with 200 and reports no change", async () => {
  const client = fakeClient({ data: "noop" });
  const res = await handleSetFinancialAccess(client as never, {
    actorUserId: "owner-1",
    targetUserId: "admin-1",
    workspaceId: "ws-1",
    value: true,
  });
  assertEquals(res.status, 200);
  assertEquals(res.changed, false);
});

Deno.test("an unrecognized RPC error is mapped to a generic message, not leaked", async () => {
  const client = fakeClient({ error: { message: "duplicate key value violates unique constraint \"foo\"" } });
  const res = await handleSetFinancialAccess(client as never, {
    actorUserId: "owner-1",
    targetUserId: "admin-1",
    workspaceId: "ws-1",
    value: false,
  });
  assertEquals(res.status, 500);
  assertEquals(res.message.includes("constraint"), false);
});

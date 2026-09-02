import { assertEquals } from "jsr:@std/assert";
import { handleRoleAction } from "../manage-workspace-roles/handler.ts";

function fakeSvc(rpcResult: { data?: unknown; error?: { message: string } | null }) {
  const calls: Array<{ name: string; args: unknown }> = [];
  return {
    calls,
    rpc: (name: string, args: unknown) => {
      calls.push({ name, args });
      return Promise.resolve(rpcResult);
    },
  };
}

const WS = "ws-1";
const USER = "owner-1";
const ROLE_ID = "6b1f2e2e-1234-4abc-9def-0123456789ab";

Deno.test("create feliz: chama create_workspace_role com os args certos e devolve 200 {role_id}", async () => {
  const svc = fakeSvc({ data: "new-role-id" });
  const res = await handleRoleAction({ svc }, {
    userId: USER,
    workspaceId: WS,
    body: { action: "create", nome: "Editor", permissions: { clientes: "ver" } },
  });
  assertEquals(res.status, 200);
  assertEquals(res.body, { role_id: "new-role-id" });
  assertEquals(svc.calls.length, 1);
  assertEquals(svc.calls[0], {
    name: "create_workspace_role",
    args: {
      p_actor: USER,
      p_workspace: WS,
      p_nome: "Editor",
      p_permissions: { clientes: "ver" },
    },
  });
});

Deno.test("create: nome vazio -> 400 invalid_name sem chamar o rpc", async () => {
  const svc = fakeSvc({ data: "x" });
  const res = await handleRoleAction({ svc }, {
    userId: USER,
    workspaceId: WS,
    body: { action: "create", nome: "   ", permissions: {} },
  });
  assertEquals(res.status, 400);
  assertEquals(res.body, { error: "invalid_name" });
  assertEquals(svc.calls.length, 0);
});

Deno.test("create: nome ausente -> 400 invalid_name sem chamar o rpc", async () => {
  const svc = fakeSvc({ data: "x" });
  const res = await handleRoleAction({ svc }, {
    userId: USER,
    workspaceId: WS,
    body: { action: "create", permissions: {} },
  });
  assertEquals(res.status, 400);
  assertEquals(res.body, { error: "invalid_name" });
  assertEquals(svc.calls.length, 0);
});

Deno.test("create: permissions com módulo inválido -> 400 invalid_permissions sem chamar o rpc", async () => {
  const svc = fakeSvc({ data: "x" });
  const res = await handleRoleAction({ svc }, {
    userId: USER,
    workspaceId: WS,
    body: { action: "create", nome: "Editor", permissions: { foo: "ver" } },
  });
  assertEquals(res.status, 400);
  assertEquals(res.body, { error: "invalid_permissions" });
  assertEquals(svc.calls.length, 0);
});

Deno.test("create: permissions com nível inválido -> 400 invalid_permissions sem chamar o rpc", async () => {
  const svc = fakeSvc({ data: "x" });
  const res = await handleRoleAction({ svc }, {
    userId: USER,
    workspaceId: WS,
    body: { action: "create", nome: "Editor", permissions: { clientes: "escrever" } },
  });
  assertEquals(res.status, 400);
  assertEquals(res.body, { error: "invalid_permissions" });
  assertEquals(svc.calls.length, 0);
});

Deno.test("create: rpc not_owner -> 403", async () => {
  const svc = fakeSvc({ error: { message: "not_owner" } });
  const res = await handleRoleAction({ svc }, {
    userId: USER,
    workspaceId: WS,
    body: { action: "create", nome: "Editor", permissions: {} },
  });
  assertEquals(res.status, 403);
  assertEquals(res.body, { error: "not_owner" });
});

Deno.test("create: rpc duplicate_name -> 409", async () => {
  const svc = fakeSvc({ error: { message: "duplicate_name" } });
  const res = await handleRoleAction({ svc }, {
    userId: USER,
    workspaceId: WS,
    body: { action: "create", nome: "Editor", permissions: {} },
  });
  assertEquals(res.status, 409);
  assertEquals(res.body, { error: "duplicate_name" });
});

Deno.test("create: rpc invalid_permissions -> 400", async () => {
  const svc = fakeSvc({ error: { message: "invalid_permissions" } });
  const res = await handleRoleAction({ svc }, {
    userId: USER,
    workspaceId: WS,
    body: { action: "create", nome: "Editor", permissions: {} },
  });
  assertEquals(res.status, 400);
  assertEquals(res.body, { error: "invalid_permissions" });
});

Deno.test("create: rpc invalid_name (ex.: nome > 60 chars pego só no banco) -> 400", async () => {
  const svc = fakeSvc({ error: { message: "invalid_name" } });
  const res = await handleRoleAction({ svc }, {
    userId: USER,
    workspaceId: WS,
    body: { action: "create", nome: "x".repeat(61), permissions: {} },
  });
  assertEquals(res.status, 400);
  assertEquals(res.body, { error: "invalid_name" });
});

Deno.test("create: erro de rpc desconhecido -> 500 {error:'Internal server error'}, sem vazar a mensagem crua", async () => {
  const svc = fakeSvc({ error: { message: "duplicate key value violates unique constraint \"foo\"" } });
  const res = await handleRoleAction({ svc }, {
    userId: USER,
    workspaceId: WS,
    body: { action: "create", nome: "Editor", permissions: {} },
  });
  assertEquals(res.status, 500);
  assertEquals(res.body, { error: "Internal server error" });
});

Deno.test("update feliz: chama update_workspace_role com os args certos e devolve 200 {message}", async () => {
  const svc = fakeSvc({ data: "updated" });
  const res = await handleRoleAction({ svc }, {
    userId: USER,
    workspaceId: WS,
    body: { action: "update", roleId: ROLE_ID, nome: "Editor 2", permissions: { clientes: "editar" } },
  });
  assertEquals(res.status, 200);
  assertEquals(typeof (res.body as { message?: unknown }).message, "string");
  assertEquals(svc.calls.length, 1);
  assertEquals(svc.calls[0], {
    name: "update_workspace_role",
    args: {
      p_actor: USER,
      p_workspace: WS,
      p_role: ROLE_ID,
      p_nome: "Editor 2",
      p_permissions: { clientes: "editar" },
    },
  });
});

Deno.test("update: roleId ausente -> 400 sem chamar o rpc", async () => {
  const svc = fakeSvc({ data: "updated" });
  const res = await handleRoleAction({ svc }, {
    userId: USER,
    workspaceId: WS,
    body: { action: "update", nome: "Editor", permissions: {} },
  });
  assertEquals(res.status, 400);
  assertEquals(svc.calls.length, 0);
});

Deno.test("update: roleId não é uuid -> 400 sem chamar o rpc", async () => {
  const svc = fakeSvc({ data: "updated" });
  const res = await handleRoleAction({ svc }, {
    userId: USER,
    workspaceId: WS,
    body: { action: "update", roleId: "not-a-uuid", nome: "Editor", permissions: {} },
  });
  assertEquals(res.status, 400);
  assertEquals(svc.calls.length, 0);
});

Deno.test("update: rpc role_not_found -> 404", async () => {
  const svc = fakeSvc({ error: { message: "role_not_found" } });
  const res = await handleRoleAction({ svc }, {
    userId: USER,
    workspaceId: WS,
    body: { action: "update", roleId: ROLE_ID, nome: "Editor", permissions: {} },
  });
  assertEquals(res.status, 404);
  assertEquals(res.body, { error: "role_not_found" });
});

Deno.test("update: rpc role_in_use não se aplica (RPC nunca a levanta em update), mas not_owner -> 403", async () => {
  const svc = fakeSvc({ error: { message: "not_owner" } });
  const res = await handleRoleAction({ svc }, {
    userId: USER,
    workspaceId: WS,
    body: { action: "update", roleId: ROLE_ID, nome: "Editor", permissions: {} },
  });
  assertEquals(res.status, 403);
  assertEquals(res.body, { error: "not_owner" });
});

Deno.test("delete feliz: chama delete_workspace_role com os args certos e devolve 200 {message}", async () => {
  const svc = fakeSvc({ data: "deleted" });
  const res = await handleRoleAction({ svc }, {
    userId: USER,
    workspaceId: WS,
    body: { action: "delete", roleId: ROLE_ID },
  });
  assertEquals(res.status, 200);
  assertEquals(typeof (res.body as { message?: unknown }).message, "string");
  assertEquals(svc.calls.length, 1);
  assertEquals(svc.calls[0], {
    name: "delete_workspace_role",
    args: {
      p_actor: USER,
      p_workspace: WS,
      p_role: ROLE_ID,
    },
  });
});

Deno.test("delete: roleId ausente -> 400 sem chamar o rpc", async () => {
  const svc = fakeSvc({ data: "deleted" });
  const res = await handleRoleAction({ svc }, {
    userId: USER,
    workspaceId: WS,
    body: { action: "delete" },
  });
  assertEquals(res.status, 400);
  assertEquals(svc.calls.length, 0);
});

Deno.test("delete: roleId não é uuid -> 400 sem chamar o rpc", async () => {
  const svc = fakeSvc({ data: "deleted" });
  const res = await handleRoleAction({ svc }, {
    userId: USER,
    workspaceId: WS,
    body: { action: "delete", roleId: "not-a-uuid" },
  });
  assertEquals(res.status, 400);
  assertEquals(svc.calls.length, 0);
});

Deno.test("delete: rpc role_in_use -> 409", async () => {
  const svc = fakeSvc({ error: { message: "role_in_use" } });
  const res = await handleRoleAction({ svc }, {
    userId: USER,
    workspaceId: WS,
    body: { action: "delete", roleId: ROLE_ID },
  });
  assertEquals(res.status, 409);
  assertEquals(res.body, { error: "role_in_use" });
});

Deno.test("delete: rpc role_not_found -> 404", async () => {
  const svc = fakeSvc({ error: { message: "role_not_found" } });
  const res = await handleRoleAction({ svc }, {
    userId: USER,
    workspaceId: WS,
    body: { action: "delete", roleId: ROLE_ID },
  });
  assertEquals(res.status, 404);
  assertEquals(res.body, { error: "role_not_found" });
});

Deno.test("delete: erro de rpc desconhecido -> 500, sem vazar a mensagem crua", async () => {
  const svc = fakeSvc({ error: { message: "connection reset by peer" } });
  const res = await handleRoleAction({ svc }, {
    userId: USER,
    workspaceId: WS,
    body: { action: "delete", roleId: ROLE_ID },
  });
  assertEquals(res.status, 500);
  assertEquals(res.body, { error: "Internal server error" });
});

Deno.test("action desconhecida -> 400 sem chamar o rpc", async () => {
  const svc = fakeSvc({ data: "x" });
  const res = await handleRoleAction({ svc }, {
    userId: USER,
    workspaceId: WS,
    body: { action: "rename" },
  });
  assertEquals(res.status, 400);
  assertEquals(svc.calls.length, 0);
});

Deno.test("action ausente -> 400 sem chamar o rpc", async () => {
  const svc = fakeSvc({ data: "x" });
  const res = await handleRoleAction({ svc }, {
    userId: USER,
    workspaceId: WS,
    body: {},
  });
  assertEquals(res.status, 400);
  assertEquals(svc.calls.length, 0);
});

import { assertEquals } from "jsr:@std/assert";
import { handleSetClientScope } from "../manage-workspace-user/setClientScope.ts";

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

const base = {
  actorUserId: "owner-1",
  targetUserId: "agent-1",
  workspaceId: "ws-1",
  scope: "atribuidos" as const,
  clienteIds: [1, 2, 3],
};

Deno.test("passes the RPC args through and reports the change", async () => {
  const client = fakeClient({ data: { changed: true } });
  const res = await handleSetClientScope(client as never, base);
  assertEquals(res.status, 200);
  assertEquals(res.changed, true);
  assertEquals(client.calls, [
    {
      name: "set_member_client_scope",
      args: {
        p_actor: "owner-1",
        p_workspace: "ws-1",
        p_user: "agent-1",
        p_scope: "atribuidos",
        p_cliente_ids: [1, 2, 3],
      },
    },
  ]);
});

Deno.test("a no-op reports changed=false with 200", async () => {
  const client = fakeClient({ data: { changed: false } });
  const res = await handleSetClientScope(client as never, base);
  assertEquals(res.status, 200);
  assertEquals(res.changed, false);
});

Deno.test("scope todos still forwards the validated ids", async () => {
  const client = fakeClient({ data: { changed: true } });
  await handleSetClientScope(client as never, { ...base, scope: "todos" });
  assertEquals((client.calls[0] as { args: Record<string, unknown> }).args.p_cliente_ids, [1, 2, 3]);
});

const errorCases: Array<[string, number, string]> = [
  ["not_owner", 403, "Apenas o proprietário pode alterar esse acesso."],
  ["target_is_owner", 400, "O proprietário sempre vê todos os clientes."],
  ["target_not_member", 404, "Membro não encontrado neste workspace."],
  ["invalid_scope", 400, "Escopo inválido."],
  ["cliente_not_in_workspace", 400, "Algum cliente selecionado não pertence a este workspace."],
  ["feature_disabled", 403, "Recurso indisponível no seu plano."],
];
for (const [sentinel, status, message] of errorCases) {
  Deno.test(`maps ${sentinel} to ${status}`, async () => {
    const client = fakeClient({ error: { message: `P0001: ${sentinel}` } });
    const res = await handleSetClientScope(client as never, base);
    assertEquals(res.status, status);
    assertEquals(res.message, message);
    assertEquals(res.changed, false);
  });
}

Deno.test("an unrecognized RPC error is generic, never echoed", async () => {
  const client = fakeClient({ error: { message: 'duplicate key value violates constraint "foo"' } });
  const res = await handleSetClientScope(client as never, base);
  assertEquals(res.status, 500);
  assertEquals(res.message, "Não foi possível salvar o acesso.");
});

const badInputs: Array<[string, Record<string, unknown>]> = [
  ["bad scope", { scope: "tudo" }],
  ["non-integer id", { clienteIds: [1, 1.5] }],
  ["string id", { clienteIds: [1, "2"] }],
  ["zero id", { clienteIds: [0] }],
  ["negative id", { clienteIds: [-3] }],
  ["not an array", { clienteIds: "1,2" }],
  ["too many ids", { clienteIds: Array.from({ length: 2001 }, (_, i) => i + 1) }],
  ["missing target", { targetUserId: "" }],
];
for (const [label, patch] of badInputs) {
  Deno.test(`400 before any RPC for ${label}`, async () => {
    const client = fakeClient({ data: { changed: true } });
    const res = await handleSetClientScope(client as never, { ...base, ...patch } as never);
    assertEquals(res.status, 400);
    assertEquals(client.calls.length, 0);
  });
}

Deno.test("exactly 2000 ids and an empty list are accepted", async () => {
  const client = fakeClient({ data: { changed: true } });
  const ids = Array.from({ length: 2000 }, (_, i) => i + 1);
  assertEquals((await handleSetClientScope(client as never, { ...base, clienteIds: ids })).status, 200);
  assertEquals((await handleSetClientScope(client as never, { ...base, clienteIds: [] })).status, 200);
});

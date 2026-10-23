// deno-lint-ignore-file no-explicit-any
import { z } from "npm:zod@3";
import { assert, assertEquals } from "./assert.ts";
import {
  fakeServer,
  has,
  insertPayload,
  makeDeps,
  makeFakeDb,
  OWNER_CTX,
} from "./mcp-financeiro-helpers.ts";
import {
  McpOwnerError,
  memberRole,
  OWNER_ONLY_SCOPES,
  ownerOnlyScopeViolation,
  requireOwner,
  resolveMcpKey,
} from "../_shared/mcp-token.ts";
import { resolveOAuthCtx } from "../_shared/mcp-oauth.ts";
import { register } from "../mcp/register.ts";
import type { RegisteredTool } from "../mcp/queries.ts";
import { registerTools } from "../mcp/tools.ts";

const OWNER_ONLY_MSG = "somente o dono do workspace";

function errorText(r: { content: { text: string }[] }): string {
  return JSON.parse(r.content[0].text).error;
}

// ---- register(): ownerOnly gate -------------------------------------------------------------

Deno.test("mcp-financeiro-gate: owner passes, admin and agent refused", async () => {
  for (const [role, allowed] of [["owner", true], ["admin", false], ["agent", false], [undefined, false], [null, false]] as const) {
    const { db } = makeFakeDb({});
    const server = fakeServer();
    let ran = 0;
    register(server, makeDeps(db, { role }), "financeiro_x", "financeiro:read", "d", {}, async () => {
      ran++;
      return { ok: true };
    }, undefined, { ownerOnly: true });
    const res = await server.handlers["financeiro_x"]({});
    if (allowed) {
      assertEquals(ran, 1, `role ${role} runs`);
      assert(!res.isError, "owner not an error");
    } else {
      assertEquals(ran, 0, `role ${String(role)} must not run`);
      assert(res.isError === true, `role ${String(role)} isError`);
      assert(errorText(res).includes(OWNER_ONLY_MSG), "owner-only copy");
      assertEquals(
        errorText(res),
        "Permission denied: somente o dono do workspace pode usar as ferramentas do Financeiro.",
      );
    }
  }
});

Deno.test("mcp-financeiro-gate: scope is checked before the owner gate", async () => {
  const { db } = makeFakeDb({});
  const server = fakeServer();
  register(server, makeDeps(db, { role: "agent", scopes: [] }), "financeiro_x", "financeiro:read", "d", {}, async () => ({}), undefined, { ownerOnly: true });
  const res = await server.handlers["financeiro_x"]({});
  assert(errorText(res).includes("financeiro:read"), "names the missing scope");
});

Deno.test("mcp-financeiro-gate: a refused non-owner never reaches the plan check or the db", async () => {
  const { db, calls } = makeFakeDb({});
  const server = fakeServer();
  register(server, makeDeps(db, { role: "admin" }), "financeiro_x", "financeiro:read", "d", {}, async () => ({}), undefined, { ownerOnly: true });
  await server.handlers["financeiro_x"]({});
  assertEquals(calls.length, 0, "no db call before the owner gate");
});

Deno.test("mcp-financeiro-gate: feature_financial off refuses before run", async () => {
  const { db, calls } = makeFakeDb({}, { effective_plan_feature: [{ data: false, error: null }] });
  const server = fakeServer();
  let ran = 0;
  register(server, makeDeps(db), "financeiro_x", "financeiro:read", "d", {}, async () => {
    ran++;
    return {};
  }, undefined, { ownerOnly: true });
  const res = await server.handlers["financeiro_x"]({});
  assertEquals(ran, 0);
  assert(res.isError === true);
  assertEquals(errorText(res), "O plano deste workspace não inclui o Financeiro.");
  assertEquals(calls[0].table, "rpc:effective_plan_feature");
  assertEquals(calls[0].args[0], { ws_id: "workspace-A", feature_key: "feature_financial" });
  assert(!calls.some((c) => c.table === "audit_log"), "no audit on a refused call");
});

Deno.test("mcp-financeiro-gate: feature_financeiro_v2 is checked only when asked, and refuses when off", async () => {
  // v2 not requested: a single plan check.
  {
    const { db, calls } = makeFakeDb({});
    const server = fakeServer();
    register(server, makeDeps(db), "t", "financeiro:read", "d", {}, async () => ({ ok: 1 }), undefined, { ownerOnly: true });
    const res = await server.handlers["t"]({});
    assert(!res.isError);
    assertEquals(calls.filter((c) => c.table === "rpc:effective_plan_feature").length, 1);
  }
  // v2 requested and off.
  {
    const { db, calls } = makeFakeDb({}, {
      effective_plan_feature: [{ data: true, error: null }, { data: false, error: null }],
    });
    const server = fakeServer();
    let ran = 0;
    register(server, makeDeps(db), "t", "financeiro:read", "d", {}, async () => {
      ran++;
      return {};
    }, undefined, { ownerOnly: true, feature: "feature_financeiro_v2" });
    const res = await server.handlers["t"]({});
    assertEquals(ran, 0);
    assertEquals(errorText(res), "O Financeiro v2 não está ativo neste workspace.");
    assertEquals(calls[1].args[0], { ws_id: "workspace-A", feature_key: "feature_financeiro_v2" });
  }
  // v2 requested and on.
  {
    const { db } = makeFakeDb({});
    const server = fakeServer();
    register(server, makeDeps(db), "t", "financeiro:read", "d", {}, async () => ({ ok: 1 }), undefined, { ownerOnly: true, feature: "feature_financeiro_v2" });
    assert(!(await server.handlers["t"]({})).isError);
  }
});

Deno.test("mcp-financeiro-gate: non-ownerOnly tools never run the owner or plan gates", async () => {
  const { db, calls } = makeFakeDb({});
  const server = fakeServer();
  register(server, makeDeps(db, { role: "agent" }), "plain", "clientes:read", "d", {}, async () => ({ ok: 1 }));
  // scopes in OWNER_CTX do not include clientes:read
  const res = await server.handlers["plain"]({});
  assert(errorText(res).includes("clientes:read"));
  const { db: db2, calls: calls2 } = makeFakeDb({});
  const server2 = fakeServer();
  register(server2, makeDeps(db2, { role: "agent", scopes: ["clientes:read"] }), "plain", "clientes:read", "d", {}, async () => ({ ok: 1 }));
  assert(!(await server2.handlers["plain"]({})).isError);
  assert(!calls2.some((c) => c.table === "rpc:effective_plan_feature"), "no plan rpc");
  assertEquals(calls.length, 0);
});

Deno.test("mcp-financeiro-gate: the opt-in registry records name, scope and ownerOnly", () => {
  const { db } = makeFakeDb({});
  const server = fakeServer();
  const registry: RegisteredTool[] = [];
  const deps = makeDeps(db, {}, registry);
  register(server, deps, "a", "financeiro:read", "d", {}, async () => ({}), undefined, { ownerOnly: true });
  register(server, deps, "b", "clientes:read", "d", { x: z.string().optional() }, async () => ({}));
  assertEquals(registry, [
    { name: "a", scope: "financeiro:read", ownerOnly: true },
    { name: "b", scope: "clientes:read", ownerOnly: false },
  ]);
});

Deno.test("mcp-financeiro-gate: without a registry (production) register touches no shared state", async () => {
  const { db } = makeFakeDb({});
  const server = fakeServer();
  const deps = makeDeps(db);
  register(server, deps, "a", "financeiro:read", "d", {}, async () => ({ ok: true }), undefined, { ownerOnly: true });
  assert(!("registry" in deps), "no collector is created on the deps");
  assert(!(await server.handlers["a"]({})).isError, "the tool still runs");
  // The module no longer exports a shared, per-isolate collector.
  const mod = await import("../mcp/register.ts");
  assert(!("REGISTERED" in mod), "no module-global REGISTERED");
});

Deno.test("mcp-financeiro-gate: every financeiro:* tool registered by registerTools is ownerOnly (structural)", () => {
  const { db } = makeFakeDb({});
  const first: RegisteredTool[] = [];
  const second: RegisteredTool[] = [];
  // Two requests in the same isolate each get their own collector: nothing interleaves.
  registerTools(fakeServer() as any, makeDeps(db, {}, first));
  registerTools(fakeServer() as any, makeDeps(db, {}, second));
  assert(first.length > 0, "registerTools populates the registry");
  assertEquals(second, first, "each registerTools call collects only its own tools");
  for (const t of first) {
    if (t.scope.startsWith("financeiro:")) assert(t.ownerOnly, `${t.name} (${t.scope}) must be ownerOnly`);
  }
});

// ---- pure helpers ----------------------------------------------------------------------------

Deno.test("mcp-financeiro-gate: requireOwner and ownerOnlyScopeViolation", () => {
  requireOwner({ ...OWNER_CTX, role: "owner" });
  for (const role of ["admin", "agent", null, undefined]) {
    let caught: unknown;
    try {
      requireOwner({ ...OWNER_CTX, role });
    } catch (e) {
      caught = e;
    }
    assert(caught instanceof McpOwnerError, `role ${String(role)} refused`);
    assertEquals((caught as Error).message, "owner_only");
  }
  assertEquals([...OWNER_ONLY_SCOPES], ["financeiro:read", "financeiro:write"]);
  assertEquals(ownerOnlyScopeViolation(["posts:read", "financeiro:read"], "admin"), true);
  assertEquals(ownerOnlyScopeViolation(["financeiro:write"], null), true);
  assertEquals(ownerOnlyScopeViolation(["financeiro:write"], "owner"), false);
  assertEquals(ownerOnlyScopeViolation(["posts:read"], "agent"), false);
});

// ---- resolvers fill the role -----------------------------------------------------------------

Deno.test("mcp-financeiro-gate: demoted creator loses access (resolveMcpKey reads the role every call)", async () => {
  const raw = "mesaas_sk_" + "a".repeat(64);
  const keyRow = {
    id: "key-1", conta_id: "workspace-A", created_by: "user-1", scopes: ["financeiro:read"],
    expires_at: null, revoked_at: null,
  };
  const mk = (member: unknown) =>
    makeFakeDb({
      mcp_api_keys: [{ data: keyRow, error: null }, { data: null, error: null }],
      workspace_members: [{ data: member, error: null }],
    });
  const admin = mk({ role: "admin" });
  const ctxAdmin = await resolveMcpKey(admin.db as any, raw, "2026-10-23T12:00:00.000Z");
  assertEquals(ctxAdmin?.role, "admin");
  assert(has(admin.calls, "workspace_members", "eq", ["user_id", "user-1"]), "looks up created_by");
  assert(has(admin.calls, "workspace_members", "eq", ["workspace_id", "workspace-A"]), "scoped to conta_id");

  const owner = mk({ role: "owner" });
  assertEquals((await resolveMcpKey(owner.db as any, raw, "2026-10-23T12:00:00.000Z"))?.role, "owner");

  // Removed from the workspace: the key still resolves (as today) but with role null.
  const gone = mk(null);
  const ctxGone = await resolveMcpKey(gone.db as any, raw, "2026-10-23T12:00:00.000Z");
  assert(ctxGone !== null, "key still resolves");
  assertEquals(ctxGone?.role, null);
});

Deno.test("mcp-financeiro-gate: memberRole fails loud when the workspace_members read errors", async () => {
  const { db } = makeFakeDb({ workspace_members: [{ data: null, error: { message: "boom" } }] });
  let caught: unknown;
  try {
    await memberRole(db as any, "user-1", "workspace-A");
  } catch (e) {
    caught = e;
  }
  assert(caught !== undefined, "memberRole must throw, never resolve to null (fail open)");
  assertEquals((caught as { message?: string }).message, "boom");

  // resolveMcpKey propagates it instead of resolving a ctx with role null.
  const raw = "mesaas_sk_" + "a".repeat(64);
  const keyRow = {
    id: "key-1", conta_id: "workspace-A", created_by: "user-1", scopes: ["financeiro:read"],
    expires_at: null, revoked_at: null,
  };
  const k = makeFakeDb({
    mcp_api_keys: [{ data: keyRow, error: null }, { data: null, error: null }],
    workspace_members: [{ data: null, error: { message: "boom" } }],
  });
  let caught2: unknown;
  try {
    await resolveMcpKey(k.db as any, raw, "2026-10-23T12:00:00.000Z");
  } catch (e) {
    caught2 = e;
  }
  assert(caught2 !== undefined, "resolveMcpKey propagates the role read error");
});

function fakeJwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "none" })}.${b64(claims)}.sig`;
}

Deno.test("mcp-financeiro-gate: oauth resolver fills role", async () => {
  const token = fakeJwt({ client_id: "c1" });
  for (const role of ["owner", "admin", "agent"]) {
    const { db } = makeFakeDb({
      mcp_oauth_grants: [{ data: { conta_id: "workspace-A", scopes: ["financeiro:read"], revoked_at: null }, error: null }],
      workspace_members: [{ data: { role }, error: null }],
    });
    (db as any).auth.getUser = () => Promise.resolve({ data: { user: { id: "user-1" } }, error: null });
    const ctx = await resolveOAuthCtx(db as any, token, "2026-10-23T12:00:00.000Z");
    assertEquals(ctx?.role, role);
    assertEquals(ctx?.created_by, "user-1");
  }
  // Not a member: resolver still returns null (membership revalidated every request).
  const { db } = makeFakeDb({
    mcp_oauth_grants: [{ data: { conta_id: "workspace-A", scopes: ["financeiro:read"], revoked_at: null }, error: null }],
    workspace_members: [{ data: null, error: null }],
  });
  (db as any).auth.getUser = () => Promise.resolve({ data: { user: { id: "user-1" } }, error: null });
  assertEquals(await resolveOAuthCtx(db as any, token, "2026-10-23T12:00:00.000Z"), null);
});

// ---- create_client / create_member owner-only fields ------------------------------------------

function toolsFor(db: unknown, ctx: Record<string, unknown>) {
  const server = fakeServer();
  registerTools(server as any, makeDeps(db, { scopes: ["clientes:write", "membros:write"], ...ctx }));
  return server;
}

Deno.test("mcp-financeiro-gate: create_client valor_mensal from non-owner refused, accepted for owner", async () => {
  for (const role of ["admin", "agent", null, undefined]) {
    const { db, calls } = makeFakeDb({});
    const res = await toolsFor(db, { role }).handlers["create_client"]({ nome: "Ana", valor_mensal: 1500 });
    assert(res.isError === true, `role ${String(role)} refused`);
    assert(errorText(res).includes(OWNER_ONLY_MSG));
    assert(!calls.some((c) => c.method === "insert" || c.method === "update"), "nothing written");
  }
  // Non-owner without the financial field: unchanged behaviour.
  {
    const { db, calls } = makeFakeDb({
      clientes: [
        { data: [], error: null },
        { data: { id: 7, nome: "Ana", sigla: "AN", especialidade: null, cor: "#eab308", status: "ativo" }, error: null },
      ],
    });
    const res = await toolsFor(db, { role: "agent" }).handlers["create_client"]({ nome: "Ana" });
    assert(!res.isError, "no financial field: allowed for any role");
    assert(insertPayload(calls, "clientes") !== undefined);
  }
  // Owner with the field.
  {
    const { db, calls } = makeFakeDb({
      clientes: [
        { data: [], error: null },
        { data: { id: 7, nome: "Ana", sigla: "AN", especialidade: null, cor: "#eab308", status: "ativo" }, error: null },
      ],
    });
    const res = await toolsFor(db, { role: "owner" }).handlers["create_client"]({ nome: "Ana", valor_mensal: 0 });
    assert(!res.isError, "owner accepted");
    assertEquals(insertPayload(calls, "clientes")?.valor_mensal, 0);
  }
});

Deno.test("mcp-financeiro-gate: create_member custo_mensal/data_pagamento from non-owner refused, accepted for owner", async () => {
  for (const args of [{ custo_mensal: 3000 }, { data_pagamento: 5 }, { custo_mensal: 0 }]) {
    const { db, calls } = makeFakeDb({});
    const res = await toolsFor(db, { role: "admin" }).handlers["create_member"]({ nome: "João", ...args });
    assert(res.isError === true, `refused for ${JSON.stringify(args)}`);
    assert(errorText(res).includes(OWNER_ONLY_MSG));
    assert(!calls.some((c) => c.method === "insert" || c.method === "update"), "nothing written");
  }
  const row = { id: 5, nome: "João", cargo: "", tipo: "clt", data_pagamento: 5, crm_user_id: null, created_at: "2026-08-07" };
  {
    const { db, calls } = makeFakeDb({ membros: [{ data: [], error: null }, { data: row, error: null }] });
    const res = await toolsFor(db, { role: "owner" }).handlers["create_member"]({ nome: "João", custo_mensal: 3000, data_pagamento: 5 });
    assert(!res.isError, "owner accepted");
    assertEquals(insertPayload(calls, "membros")?.custo_mensal, 3000);
    assertEquals(insertPayload(calls, "membros")?.data_pagamento, 5);
  }
  {
    const { db } = makeFakeDb({ membros: [{ data: [], error: null }, { data: row, error: null }] });
    const res = await toolsFor(db, { role: "agent" }).handlers["create_member"]({ nome: "João" });
    assert(!res.isError, "no financial field: allowed for any role");
  }
});

Deno.test("mcp-financeiro-gate: create_client and create_member descriptions mention the owner-only fields", () => {
  const { db } = makeFakeDb({});
  const server = toolsFor(db, {});
  const sentence = "Campos financeiros (valor_mensal / custo_mensal, data_pagamento) só para o dono do workspace.";
  assert(server.descriptions["create_client"].includes(sentence), "create_client description");
  assert(server.descriptions["create_member"].includes(sentence), "create_member description");
});

// ---- audit resource_id -------------------------------------------------------------------------

Deno.test("mcp-financeiro-gate: audit resource_id from lancamento_id/recorrente_id/membro_id/cliente_id/funcao_id/inicio", async () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ lancamento_id: "l-1" }, "l-1"],
    [{ recorrente_id: "r-1" }, "r-1"],
    [{ membro_id: 12 }, "12"],
    [{ cliente_id: 9 }, "9"],
    [{ funcao_id: "f-1" }, "f-1"],
    [{ inicio: "2026-10-01" }, "2026-10-01"],
    [{ valor: 10 }, ""],
    [{ post_id: 3, lancamento_id: "l-1" }, "3"], // existing precedence is untouched
  ];
  for (const [args, expected] of cases) {
    const { db, calls } = makeFakeDb({});
    const server = fakeServer();
    register(server, makeDeps(db), "financeiro_x", "financeiro:write", "d", {}, async () => ({}), () => args, { ownerOnly: true });
    const res = await server.handlers["financeiro_x"]({});
    assert(!res.isError);
    const row = insertPayload(calls, "audit_log") as Record<string, any>;
    assertEquals(row.resource_id, expected, JSON.stringify(args));
    assertEquals(row.action, "mcp.financeiro_x");
  }
});

Deno.test("mcp-financeiro-gate: an ownerOnly tool without auditArgs audits empty args", async () => {
  const { db, calls } = makeFakeDb({});
  const server = fakeServer();
  register(server, makeDeps(db), "financeiro_x", "financeiro:read", "d", {}, async () => ({ ok: true }), undefined, {
    ownerOnly: true,
  });
  await server.handlers["financeiro_x"]({ valor: 1234, descricao: "segredo" });
  const ins = calls.find((c) => c.table === "audit_log" && c.method === "insert");
  assert(ins, "audit insert");
  assertEquals((ins!.args[0] as any).metadata.args, {});
});

Deno.test("mcp-financeiro-gate: ownerOnlyScopeViolation treats an undefined role as non-owner", () => {
  assertEquals(ownerOnlyScopeViolation(["financeiro:read"], undefined), true);
  assertEquals(ownerOnlyScopeViolation(["clientes:read"], undefined), false);
});

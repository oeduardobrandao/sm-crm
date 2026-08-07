import { assert, assertEquals } from "./assert.ts";
import { createClient, createMember, listMembers } from "../mcp/queries.ts";
import type { Deps } from "../mcp/queries.ts";
import { McpInputError, type McpKeyContext } from "../_shared/mcp-token.ts";
import { registerTools } from "../mcp/tools.ts";

type Resp = { data: unknown; error: unknown };
type Call = { table: string; method: string; args: unknown[] };

// Recording fake Supabase client supporting read + write chains. `await` / single /
// maybeSingle pull the next canned response from the table's queue.
function makeFakeDb(responses: Record<string, Resp[]>) {
  const calls: Call[] = [];
  const queues: Record<string, Resp[]> = {};
  for (const k of Object.keys(responses)) queues[k] = [...responses[k]];
  function recorder(table: string) {
    // deno-lint-ignore no-explicit-any
    const rec: any = {};
    const next = (): Resp => (queues[table] ?? []).shift() ?? { data: null, error: null };
    for (const m of ["select", "eq", "in", "gte", "order", "limit", "range", "insert", "update", "upsert", "delete"]) {
      rec[m] = (...args: unknown[]) => { calls.push({ table, method: m, args }); return rec; };
    }
    rec.single = () => { calls.push({ table, method: "single", args: [] }); return Promise.resolve(next()); };
    rec.maybeSingle = () => { calls.push({ table, method: "maybeSingle", args: [] }); return Promise.resolve(next()); };
    rec.then = (resolve: (r: Resp) => unknown) => Promise.resolve(resolve(next()));
    return rec;
  }
  const db = { from: (t: string) => { calls.push({ table: t, method: "from", args: [t] }); return recorder(t); } };
  return { db, calls };
}

function insertPayload(calls: Call[], table: string): Record<string, unknown> | undefined {
  const c = calls.find((x) => x.table === table && x.method === "insert");
  return c?.args[0] as Record<string, unknown> | undefined;
}
function updatePayload(calls: Call[], table: string): Record<string, unknown> | undefined {
  const c = calls.find((x) => x.table === table && x.method === "update");
  return c?.args[0] as Record<string, unknown> | undefined;
}
function has(calls: Call[], table: string, method: string, args: unknown[]): boolean {
  return calls.some((c) => c.table === table && c.method === method &&
    JSON.stringify(c.args) === JSON.stringify(args));
}

const CTX: McpKeyContext = {
  conta_id: "workspace-A",
  scopes: ["clientes:read", "clientes:write", "membros:read", "membros:write"],
  key_id: "k1",
  created_by: "user-1",
};

Deno.test("mcp-import: createClient inserts with derived sigla, defaults and ctx stamps", async () => {
  const { db, calls } = makeFakeDb({
    clientes: [
      { data: [], error: null },  // match scan: no rows
      { data: { id: 7, nome: "Dra. Ana", sigla: "DR", especialidade: null, cor: "#eab308", status: "ativo" }, error: null }, // insert result
    ],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  const out = await createClient(deps, { nome: "Dra. Ana", email: "ana@x.com", valor_mensal: 1500 });
  assert(has(calls, "clientes", "eq", ["conta_id", "workspace-A"]), "match scan scoped by conta_id");
  const row = insertPayload(calls, "clientes")!;
  assertEquals(row.conta_id, "workspace-A");
  assertEquals(row.user_id, "user-1");
  assertEquals(row.sigla, "DR");
  assertEquals(row.status, "ativo");
  assertEquals(row.valor_mensal, 1500);
  assertEquals(out.already_existed, false);
  assertEquals(out.filled_fields.length, 0);
  assert(!("email" in out), "email never echoed");
  assert(!("valor_mensal" in out), "valor_mensal never echoed");
});

Deno.test("mcp-import: createClient sigla falls back to XX for non-alphabetic nome", async () => {
  const { db, calls } = makeFakeDb({
    clientes: [
      { data: [], error: null },
      { data: { id: 8, nome: "123", sigla: "XX", especialidade: null, cor: "#eab308", status: "ativo" }, error: null },
    ],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  await createClient(deps, { nome: "123" });
  assertEquals(insertPayload(calls, "clientes")!.sigla, "XX");
});

Deno.test("mcp-import: createClient matches existing nome case-insensitively and fills only empty fields", async () => {
  const existing = {
    id: 3, nome: "Dra. Ana ", sigla: "DA", especialidade: null, cor: "#111111",
    status: "pausado", email: "ja@tem.com", telefone: "", valor_mensal: null,
  };
  const { db, calls } = makeFakeDb({
    clientes: [
      { data: [existing], error: null },   // match scan
      { data: null, error: null },         // update result (awaited chain)
    ],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  const out = await createClient(deps, {
    nome: "dra. ana", email: "novo@x.com", telefone: "1199999", valor_mensal: 2000,
  });
  assertEquals(out.already_existed, true);
  assertEquals(out.id, 3);
  assertEquals(out.status, "pausado", "existing status reported so the agent sees encerrado/pausado matches");
  const patch = updatePayload(calls, "clientes")!;
  assert(!Object.hasOwn(patch, "email"), "non-empty email NOT overwritten");
  assertEquals(patch.telefone, "1199999", "empty telefone filled");
  assertEquals(patch.valor_mensal, 2000, "NULL valor_mensal filled");
  assert(!Object.hasOwn(patch, "nome"), "nome never modified on match");
  assert(!Object.hasOwn(patch, "status"), "status never modified on match");
  assert(has(calls, "clientes", "eq", ["id", 3]), "update targets matched id");
  assertEquals(calls.filter((c) => c.table === "clientes" && c.method === "eq" && c.args[0] === "conta_id").length, 2,
    "BOTH the scan and the update carry conta_id");
  assertEquals(out.filled_fields.sort(), ["telefone", "valor_mensal"]);
  assert(!calls.some((c) => c.table === "clientes" && c.method === "insert"), "no insert on match");
});

Deno.test("mcp-import: createClient valor_mensal 0 on the existing row is real data, not filled", async () => {
  const existing = {
    id: 4, nome: "Beto", sigla: "BE", especialidade: null, cor: "#111111",
    status: "ativo", email: "", telefone: "", valor_mensal: 0,
  };
  const { db, calls } = makeFakeDb({ clientes: [{ data: [existing], error: null }] });
  const deps = { db, ctx: CTX } as unknown as Deps;
  const out = await createClient(deps, { nome: "Beto", valor_mensal: 900 });
  assert(!calls.some((c) => c.table === "clientes" && c.method === "update"), "no update: nothing to fill");
  assertEquals(out.filled_fields.length, 0);
});

Deno.test("mcp-import: createClient tie-break picks the first row of the id-ordered scan", async () => {
  const older = { id: 1, nome: "Dupla", sigla: "DU", especialidade: null, cor: "#1", status: "ativo", email: "", telefone: "", valor_mensal: null };
  const newer = { id: 9, nome: "Dupla", sigla: "DU", especialidade: null, cor: "#2", status: "ativo", email: "", telefone: "", valor_mensal: null };
  const { db, calls } = makeFakeDb({
    clientes: [
      { data: [older, newer], error: null },
      { data: null, error: null },
    ],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  const out = await createClient(deps, { nome: "Dupla", email: "a@b.c" });
  assertEquals(out.id, 1, "oldest row is canonical");
  assert(has(calls, "clientes", "order", ["id", { ascending: true }]), "scan is id-ordered");
  assert(has(calls, "clientes", "eq", ["id", 1]), "update targets the oldest id");
});

Deno.test("mcp-import: createClient plan limit -> McpInputError with pt-BR message", async () => {
  const { db } = makeFakeDb({
    clientes: [
      { data: [], error: null },
      { data: null, error: { message: "new row violates ... plan_limit_exceeded:max_clients" } },
    ],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  let msg = "";
  try {
    await createClient(deps, { nome: "Nova" });
  } catch (e) {
    if (e instanceof McpInputError) msg = e.message;
  }
  assertEquals(msg, "Limite de clientes do plano foi atingido.");
});

Deno.test("mcp-import: createClient scan paginates past the 1000-row PostgREST page", async () => {
  const page1 = Array.from({ length: 1000 }, (_, i) => ({
    id: i + 1, nome: `Cliente ${i + 1}`, sigla: "CL", especialidade: null, cor: "#1",
    status: "ativo", email: "", telefone: "", valor_mensal: null,
  }));
  const target = { id: 1001, nome: "Alvo", sigla: "AL", especialidade: null, cor: "#1", status: "ativo", email: "", telefone: "", valor_mensal: null };
  const { db, calls } = makeFakeDb({
    clientes: [
      { data: page1, error: null },        // page 1: full, no match
      { data: [target], error: null },     // page 2: short page containing the match
      { data: null, error: null },         // update result (fill email)
    ],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  const out = await createClient(deps, { nome: "alvo", email: "a@b.c" });
  assertEquals(out.already_existed, true);
  assertEquals(out.id, 1001);
  assert(has(calls, "clientes", "range", [0, 999]), "first page requested");
  assert(has(calls, "clientes", "range", [1000, 1999]), "second page requested");
});

Deno.test("mcp-import: createMember inserts with defaults and ctx stamps, no custo echo", async () => {
  const { db, calls } = makeFakeDb({
    membros: [
      { data: [], error: null },
      { data: { id: 5, nome: "João", cargo: "", tipo: "clt", data_pagamento: null, crm_user_id: null, created_at: "2026-08-07" }, error: null },
    ],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  const out = await createMember(deps, { nome: "João", custo_mensal: 3000 });
  const row = insertPayload(calls, "membros")!;
  assertEquals(row.conta_id, "workspace-A");
  assertEquals(row.user_id, "user-1");
  assertEquals(row.tipo, "clt");
  assertEquals(row.cargo, "");
  assertEquals(row.avatar_url, "");
  assertEquals(row.custo_mensal, 3000);
  assertEquals(out.already_existed, false);
  assert(!("custo_mensal" in out), "custo_mensal never echoed");
});

Deno.test("mcp-import: createMember matches nome, fills empty cargo and NULL custo only", async () => {
  const existing = { id: 2, nome: "Maria", cargo: "", tipo: "freelancer_mensal", custo_mensal: 0, data_pagamento: 5, crm_user_id: null, created_at: "2026-01-01" };
  const { db, calls } = makeFakeDb({
    membros: [
      { data: [existing], error: null },
      { data: null, error: null },
    ],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  const out = await createMember(deps, { nome: "MARIA", cargo: "Designer", tipo: "clt", custo_mensal: 4000 });
  const patch = updatePayload(calls, "membros")!;
  assertEquals(patch.cargo, "Designer", "empty cargo filled");
  assert(!Object.hasOwn(patch, "custo_mensal"), "custo 0 is real data, not filled");
  assert(!Object.hasOwn(patch, "tipo"), "tipo never modified on match");
  assert(has(calls, "membros", "eq", ["conta_id", "workspace-A"]), "scan scoped");
  assert(has(calls, "membros", "eq", ["id", 2]), "update targets matched id");
  assertEquals(out.already_existed, true);
  assertEquals(out.filled_fields, ["cargo"]);
  assertEquals(out.tipo, "freelancer_mensal", "existing tipo reported");
});

Deno.test("mcp-import: createMember same nome in another workspace still inserts (scan is conta-scoped)", async () => {
  // The fake db returns what the scan query would: an empty list, BECAUSE the real
  // query filters conta_id. The assertion that matters is the eq('conta_id', ...) call.
  const { db, calls } = makeFakeDb({
    membros: [
      { data: [], error: null },
      { data: { id: 6, nome: "João", cargo: "", tipo: "clt", data_pagamento: null, crm_user_id: null, created_at: "2026-08-07" }, error: null },
    ],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  const out = await createMember(deps, { nome: "João" });
  assert(has(calls, "membros", "eq", ["conta_id", "workspace-A"]), "scan carries conta_id");
  assertEquals(out.already_existed, false);
});

Deno.test("mcp-import: listMembers projects public fields, scoped and ordered", async () => {
  const { db, calls } = makeFakeDb({
    membros: [{
      data: [{ id: 1, nome: "Ana", cargo: "Social media", tipo: "clt", data_pagamento: 5, crm_user_id: null, created_at: "2026-08-01", custo_mensal: 9999 }],
      error: null,
    }],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  const out = await listMembers(deps);
  assert(has(calls, "membros", "eq", ["conta_id", "workspace-A"]), "scoped");
  assert(has(calls, "membros", "order", ["created_at", { ascending: false }]), "newest first");
  assertEquals(out.length, 1);
  assert(!("custo_mensal" in out[0]), "custo_mensal stripped even if selected by accident");
  assertEquals(out[0].nome, "Ana");
});

function makeFakeServer() {
  return {
    handlers: {} as Record<string, (a: unknown) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }>>,
    // deno-lint-ignore no-explicit-any
    tool(name: string, _d: any, _s: any, h: any) { this.handlers[name] = h; },
  };
}

Deno.test("mcp-import: create_client denies a ctx missing clientes:write", async () => {
  const { db } = makeFakeDb({});
  const deniedCtx: McpKeyContext = { conta_id: "workspace-A", scopes: ["clientes:read"], key_id: "k1", created_by: "user-1" };
  const server = makeFakeServer();
  registerTools(server as any, { db, ctx: deniedCtx } as unknown as Deps);
  const result = await server.handlers["create_client"]({ nome: "X" });
  assert(result.isError === true, "denied");
  assert(result.content[0].text.includes("clientes:write"), "names the missing scope");
});

Deno.test("mcp-import: create_member and list_members deny ctxs missing membros scopes", async () => {
  const { db } = makeFakeDb({});
  const deniedCtx: McpKeyContext = { conta_id: "workspace-A", scopes: ["clientes:read"], key_id: "k1", created_by: "user-1" };
  const server = makeFakeServer();
  registerTools(server as any, { db, ctx: deniedCtx } as unknown as Deps);
  const created = await server.handlers["create_member"]({ nome: "X" });
  assert(created.isError === true && created.content[0].text.includes("membros:write"), "create_member denied");
  const listed = await server.handlers["list_members"]({});
  assert(listed.isError === true && listed.content[0].text.includes("membros:read"), "list_members denied");
});

Deno.test("mcp-import: create_client audit row carries client_id, no nome/email in metadata", async () => {
  const { db, calls } = makeFakeDb({
    clientes: [
      { data: [], error: null },
      { data: { id: 7, nome: "Dra. Ana", sigla: "DR", especialidade: null, cor: "#eab308", status: "ativo" }, error: null },
    ],
  });
  const server = makeFakeServer();
  registerTools(server as any, { db, ctx: CTX } as unknown as Deps);
  await server.handlers["create_client"]({ nome: "Dra. Ana", email: "ana@x.com" });
  const auditRow = insertPayload(calls, "audit_log")! as Record<string, any>;
  assertEquals(auditRow.resource_id, "7", "resource_id from client_id");
  const meta = JSON.stringify(auditRow.metadata);
  assert(!meta.includes("Dra. Ana"), "no nome in audit metadata");
  assert(!meta.includes("ana@x.com"), "no email in audit metadata");
});

Deno.test("mcp-import: create_member audit row carries member_id via the extended extraction", async () => {
  const { db, calls } = makeFakeDb({
    membros: [
      { data: [], error: null },
      { data: { id: 5, nome: "João", cargo: "", tipo: "clt", data_pagamento: null, crm_user_id: null, created_at: "2026-08-07" }, error: null },
    ],
  });
  const server = makeFakeServer();
  registerTools(server as any, { db, ctx: CTX } as unknown as Deps);
  await server.handlers["create_member"]({ nome: "João" });
  const auditRow = insertPayload(calls, "audit_log")! as Record<string, any>;
  assertEquals(auditRow.resource_id, "5", "resource_id from member_id");
});

Deno.test("mcp-import: create_client denies a write-only ctx (needs clientes:read too)", async () => {
  const { db } = makeFakeDb({});
  const writeOnly: McpKeyContext = { conta_id: "workspace-A", scopes: ["clientes:write"], key_id: "k1", created_by: "user-1" };
  const server = makeFakeServer();
  registerTools(server as any, { db, ctx: writeOnly } as unknown as Deps);
  const result = await server.handlers["create_client"]({ nome: "X" });
  assert(result.isError === true, "denied");
  assert(result.content[0].text.includes("clientes:read"), "names the missing read scope");
});

Deno.test("mcp-import: create_member denies a write-only ctx (needs membros:read too)", async () => {
  const { db } = makeFakeDb({});
  const writeOnly: McpKeyContext = { conta_id: "workspace-A", scopes: ["membros:write"], key_id: "k1", created_by: "user-1" };
  const server = makeFakeServer();
  registerTools(server as any, { db, ctx: writeOnly } as unknown as Deps);
  const result = await server.handlers["create_member"]({ nome: "X" });
  assert(result.isError === true, "denied");
  assert(result.content[0].text.includes("membros:read"), "names the missing read scope");
});

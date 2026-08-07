import { assert, assertEquals } from "./assert.ts";
import { createClient } from "../mcp/queries.ts";
import type { Deps } from "../mcp/queries.ts";
import { McpInputError, type McpKeyContext } from "../_shared/mcp-token.ts";

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
    for (const m of ["select", "eq", "in", "gte", "order", "limit", "insert", "update", "upsert", "delete"]) {
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
  scopes: ["clientes:write", "membros:read", "membros:write"],
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

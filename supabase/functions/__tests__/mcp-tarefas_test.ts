import { assert, assertEquals } from "./assert.ts";
import { createTask, listTasks, updateTask } from "../mcp/queries.ts";
import type { Deps } from "../mcp/queries.ts";
import { registerTools } from "../mcp/tools.ts";
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
  conta_id: "workspace-A", scopes: ["tarefas:read", "tarefas:write"], key_id: "k1", created_by: "user-1",
};

Deno.test("mcp-tarefas: createTask stamps conta_id + user_id from ctx and validates membro ownership", async () => {
  const { db, calls } = makeFakeDb({
    membros: [{ data: { id: 3 }, error: null }],
    tarefas: [{ data: { id: 10, titulo: "X", status: "pendente" }, error: null }],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  const out = await createTask(deps, { titulo: "X", responsavel_id: 3 });
  assert(has(calls, "membros", "eq", ["conta_id", "workspace-A"]), "membro ownership scoped");
  const row = insertPayload(calls, "tarefas")!;
  assertEquals(row.conta_id, "workspace-A");
  assertEquals(row.user_id, "user-1");
  assertEquals(row.status, "pendente");
  assertEquals(out.id, 10);
});

Deno.test("mcp-tarefas: createTask membro from another workspace -> McpInputError, no insert", async () => {
  const { db, calls } = makeFakeDb({ membros: [{ data: null, error: null }] });
  const deps = { db, ctx: CTX } as unknown as Deps;
  let threw = false;
  try {
    await createTask(deps, { titulo: "X", responsavel_id: 999 });
  } catch (e) {
    threw = e instanceof McpInputError;
  }
  assert(threw, "throws McpInputError");
  assert(!calls.some((c) => c.table === "tarefas" && c.method === "insert"), "no insert happened");
});

Deno.test("mcp-tarefas: updateTask empty patch -> McpInputError", async () => {
  const { db } = makeFakeDb({});
  const deps = { db, ctx: CTX } as unknown as Deps;
  let threw = false;
  try {
    await updateTask(deps, { task_id: 1 });
  } catch (e) {
    threw = e instanceof McpInputError;
  }
  assert(threw, "throws on empty patch");
});

Deno.test("mcp-tarefas: updateTask explicit nulls clear responsavel/data_limite (omitted fields untouched)", async () => {
  const { db, calls } = makeFakeDb({
    tarefas: [
      { data: { id: 1 }, error: null },                       // prefetch existence
      { data: { id: 1, titulo: "X", status: "pendente" }, error: null }, // update result
    ],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  await updateTask(deps, { task_id: 1, responsavel_id: null, data_limite: null });
  const patch = updatePayload(calls, "tarefas")!;
  assertEquals(patch.responsavel_id, null);
  assertEquals(patch.data_limite, null);
  assert(!Object.hasOwn(patch, "titulo"), "omitted titulo not in patch");
  assert(!Object.hasOwn(patch, "descricao"), "omitted descricao not in patch");
});

Deno.test("mcp-tarefas: updateTask task from another workspace -> McpInputError", async () => {
  const { db } = makeFakeDb({ tarefas: [{ data: null, error: null }] });
  const deps = { db, ctx: CTX } as unknown as Deps;
  let threw = false;
  try {
    await updateTask(deps, { task_id: 404, status: "concluida" });
  } catch (e) {
    threw = e instanceof McpInputError;
  }
  assert(threw, "throws not-found");
});

Deno.test("mcp-tarefas: listTasks scopes by conta_id, clamps limit, flattens tags/subtarefas", async () => {
  const { db, calls } = makeFakeDb({
    tarefas: [{
      data: [{
        id: 1, titulo: "X", descricao: null, status: "pendente", responsavel_id: null,
        cliente_id: 7, data_limite: "2026-08-01", concluida_em: null,
        created_at: "t", updated_at: "t",
        clientes: { nome: "Cliente" },
        tarefa_tag_links: [{ tarefa_tags: { id: 2, nome: "urgente", cor: "#f00" } }],
        subtarefas: [{ id: 1, concluida: true }, { id: 2, concluida: false }],
      }],
      error: null,
    }],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  const out = await listTasks(deps, { limit: 9999 });
  assert(has(calls, "tarefas", "eq", ["conta_id", "workspace-A"]), "tenant scoped");
  assert(has(calls, "tarefas", "limit", [200]), "limit clamped to 200");
  assertEquals(out[0].cliente_nome, "Cliente");
  assertEquals(out[0].tags.length, 1);
  assertEquals(out[0].subtarefas_total, 2);
  assertEquals(out[0].subtarefas_concluidas, 1);
});

Deno.test("mcp-tarefas: list_tasks tool denies a ctx missing tarefas:read", async () => {
  const { db } = makeFakeDb({});
  const deniedCtx: McpKeyContext = {
    conta_id: "workspace-A", scopes: ["clientes:read"], key_id: "k1", created_by: "user-1",
  };
  const deps = { db, ctx: deniedCtx } as unknown as Deps;
  const server = {
    handlers: {} as Record<string, (a: unknown) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }>>,
    // deno-lint-ignore no-explicit-any
    tool(name: string, _d: any, _s: any, h: any) { this.handlers[name] = h; },
  };
  // deno-lint-ignore no-explicit-any
  registerTools(server as any, deps);
  const result = await server.handlers["list_tasks"]({});
  assert(result.isError === true, "scope-denied result is flagged isError");
  assert(result.content[0].text.includes("tarefas:read"), "error mentions the missing scope");
});

import { assert, assertEquals } from "./assert.ts";
import { createPost, createWorkflow } from "../mcp/queries.ts";
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
    for (const m of ["select", "eq", "in", "gte", "order", "limit", "insert", "delete"]) {
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

const CTX: McpKeyContext = {
  conta_id: "workspace-A", scopes: ["posts:write"], key_id: "k1", created_by: "user-1",
};
function insertPayload(calls: Call[], table: string): Record<string, unknown> | undefined {
  const c = calls.find((x) => x.table === table && x.method === "insert");
  return c?.args[0] as Record<string, unknown> | undefined;
}
function has(calls: Call[], table: string, method: string, args: unknown[]): boolean {
  return calls.some((c) => c.table === table && c.method === method &&
    JSON.stringify(c.args) === JSON.stringify(args));
}

Deno.test("createWorkflow: ownership-checked, agent-stamped, with default etapa", async () => {
  const { db, calls } = makeFakeDb({
    clientes: [{ data: { id: 5 }, error: null }],                       // verifyClient
    workflows: [{ data: { id: 99, cliente_id: 5, titulo: "X", status: "ativo", etapa_atual: 0, created_via: "agent", created_at: "t" }, error: null }],
    workflow_etapas: [{ data: null, error: null }],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  const out = await createWorkflow(deps, { client_id: 5, titulo: "X" });

  assert(has(calls, "clientes", "eq", ["conta_id", "workspace-A"]), "client ownership scoped");
  assert(has(calls, "clientes", "eq", ["id", 5]), "client ownership checks the id");
  const wf = insertPayload(calls, "workflows")!;
  assertEquals(wf.created_via, "agent");
  assertEquals(wf.status, "ativo");
  assertEquals(wf.conta_id, "workspace-A");
  assertEquals(wf.user_id, "user-1");
  const et = insertPayload(calls, "workflow_etapas")!;
  assertEquals(et.ordem, 0);
  assertEquals(et.status, "ativo");
  assertEquals(out.id, 99);
});

Deno.test("createWorkflow: missing client -> McpInputError, no insert", async () => {
  const { db, calls } = makeFakeDb({ clientes: [{ data: null, error: null }] });
  const deps = { db, ctx: CTX } as unknown as Deps;
  let err: unknown;
  try { await createWorkflow(deps, { client_id: 5, titulo: "X" }); } catch (e) { err = e; }
  assert(err instanceof McpInputError, "throws McpInputError");
  assert(!calls.some((c) => c.table === "workflows" && c.method === "insert"), "no workflow insert");
});

Deno.test("createPost: active-fluxo ownership, rascunho, agent, ordem max+1, TipTap conteudo", async () => {
  const { db, calls } = makeFakeDb({
    workflows: [{ data: { id: 99 }, error: null }],                    // verifyActiveWorkflow
    workflow_posts: [
      { data: { ordem: 2 }, error: null },                            // ordem query
      { data: { id: 500, status: "rascunho", created_via: "agent" }, error: null }, // insert
    ],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  const out = await createPost(deps, { workflow_id: 99, titulo: "T", tipo: "feed", body: "linha", ig_caption: "cap" });

  assert(has(calls, "workflows", "eq", ["conta_id", "workspace-A"]), "workflow ownership scoped");
  assert(has(calls, "workflows", "eq", ["status", "ativo"]), "workflow must be ativo");
  assert(has(calls, "workflows", "eq", ["id", 99]), "workflow ownership checks the id");
  const post = insertPayload(calls, "workflow_posts")!;
  assertEquals(post.status, "rascunho");
  assertEquals(post.created_via, "agent");
  assertEquals(post.conta_id, "workspace-A");
  assertEquals(post.ordem, 3);
  assertEquals((post.conteudo as { type: string }).type, "doc"); // not a raw string
  assertEquals(out.id, 500);
});

Deno.test("createPost: missing/inactive fluxo -> McpInputError, no insert", async () => {
  const { db, calls } = makeFakeDb({ workflows: [{ data: null, error: null }] });
  const deps = { db, ctx: CTX } as unknown as Deps;
  let err: unknown;
  try { await createPost(deps, { workflow_id: 99, titulo: "T" }); } catch (e) { err = e; }
  assert(err instanceof McpInputError, "throws McpInputError");
  assert(!calls.some((c) => c.table === "workflow_posts" && c.method === "insert"), "no post insert");
});

Deno.test("create_post tool redacts body/ig_caption from the audit log", async () => {
  const { db, calls } = makeFakeDb({
    workflows: [{ data: { id: 99 }, error: null }],
    workflow_posts: [
      { data: { ordem: 0 }, error: null },
      { data: { id: 1, status: "rascunho" }, error: null },
    ],
    audit_log: [{ data: null, error: null }],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  const server = {
    handlers: {} as Record<string, (a: unknown) => Promise<unknown>>,
    // deno-lint-ignore no-explicit-any
    tool(name: string, _d: any, _s: any, h: any) { this.handlers[name] = h; },
  };
  // deno-lint-ignore no-explicit-any
  registerTools(server as any, deps);
  await server.handlers["create_post"]({
    workflow_id: 99, titulo: "T", tipo: "feed",
    body: "ROTEIRO_SECRETO", ig_caption: "CAPTION_SECRETO",
  });
  const auditInsert = calls.find((c) => c.table === "audit_log" && c.method === "insert");
  assert(auditInsert, "audit_log insert happened");
  const meta = JSON.stringify(auditInsert!.args[0]);
  assert(!meta.includes("ROTEIRO_SECRETO"), "raw body must not be logged");
  assert(!meta.includes("CAPTION_SECRETO"), "raw ig_caption must not be logged");
  assert(meta.includes("body_len"), "logs body_len instead");
  assertEquals((auditInsert!.args[0] as Record<string, unknown>).resource_id, "99");
});

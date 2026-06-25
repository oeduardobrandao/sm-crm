import { assert, assertEquals } from "./assert.ts";
import { createPost, createWorkflow, createWorkflowTemplate, setPostProperty, updatePost } from "../mcp/queries.ts";
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

const CTX: McpKeyContext = {
  conta_id: "workspace-A", scopes: ["posts:write"], key_id: "k1", created_by: "user-1",
};
function insertPayload(calls: Call[], table: string): Record<string, unknown> | undefined {
  const c = calls.find((x) => x.table === table && x.method === "insert");
  return c?.args[0] as Record<string, unknown> | undefined;
}
function updatePayload(calls: Call[], table: string): Record<string, unknown> | undefined {
  const c = calls.find((x) => x.table === table && x.method === "update");
  return c?.args[0] as Record<string, unknown> | undefined;
}
function upsertPayload(calls: Call[], table: string): Record<string, unknown> | undefined {
  const c = calls.find((x) => x.table === table && x.method === "upsert");
  return c?.args[0] as Record<string, unknown> | undefined;
}
function has(calls: Call[], table: string, method: string, args: unknown[]): boolean {
  return calls.some((c) => c.table === table && c.method === method &&
    JSON.stringify(c.args) === JSON.stringify(args));
}

Deno.test("createWorkflow: ownership-checked, agent-stamped, default etapa (no template)", async () => {
  const { db, calls } = makeFakeDb({
    clientes: [{ data: { id: 5 }, error: null }],
    workflows: [{ data: { id: 99, cliente_id: 5, titulo: "X", status: "ativo", etapa_atual: 0, template_id: null, created_via: "agent", created_at: "t" }, error: null }],
    workflow_etapas: [{ data: null, error: null }],
  });
  const deps = { db, ctx: CTX, now: () => "T" } as unknown as Deps;
  const out = await createWorkflow(deps, { client_id: 5, titulo: "X" });

  assert(has(calls, "clientes", "eq", ["conta_id", "workspace-A"]), "client ownership scoped");
  assert(has(calls, "clientes", "eq", ["id", 5]), "client ownership checks the id");
  assert(!calls.some((c) => c.table === "workflow_templates"), "no template fetch when template_id omitted");
  const wf = insertPayload(calls, "workflows")!;
  assertEquals(wf.created_via, "agent");
  assertEquals(wf.status, "ativo");
  assertEquals(wf.conta_id, "workspace-A");
  assertEquals(wf.user_id, "user-1");
  assertEquals(wf.template_id, null);                 // explicit null for the old path
  const rows = insertPayload(calls, "workflow_etapas") as Record<string, unknown>[];
  assert(Array.isArray(rows), "etapas inserted as an array");
  assertEquals(rows.length, 1);
  assertEquals(rows[0].ordem, 0);
  assertEquals(rows[0].nome, "Conteúdo");
  assertEquals(rows[0].status, "ativo");
  assertEquals(rows[0].workflow_id, 99);
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

Deno.test("updatePost: ownership-scoped prefetch + guarded update, TipTap body", async () => {
  const { db, calls } = makeFakeDb({
    workflow_posts: [
      { data: { id: 7, status: "rascunho" }, error: null }, // prefetch
      { data: { id: 7, workflow_id: 1, titulo: "T", tipo: "feed", status: "rascunho", ig_caption: null, created_via: "human", updated_at: "t" }, error: null }, // guarded update
    ],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  const out = await updatePost(deps, { post_id: 7, body: "nova linha" });

  assert(has(calls, "workflow_posts", "eq", ["conta_id", "workspace-A"]), "tenant-scoped");
  assert(has(calls, "workflow_posts", "eq", ["id", 7]), "checks the id");
  assert(
    has(calls, "workflow_posts", "in", ["status", ["rascunho", "revisao_interna", "correcao_cliente"]]),
    "guarded update re-checks editable status",
  );
  const payload = updatePayload(calls, "workflow_posts")!;
  assertEquals((payload.conteudo as { type: string }).type, "doc"); // not a raw string
  assertEquals(payload.conteudo_plain, "nova linha");
  assert(!Object.hasOwn(payload, "created_via"), "created_via not written on edit");
  assertEquals(out.id, 7);
});

Deno.test("updatePost: missing post -> McpInputError, no update", async () => {
  const { db, calls } = makeFakeDb({ workflow_posts: [{ data: null, error: null }] });
  const deps = { db, ctx: CTX } as unknown as Deps;
  let err: unknown;
  try { await updatePost(deps, { post_id: 7, body: "x" }); } catch (e) { err = e; }
  assert(err instanceof McpInputError, "throws McpInputError");
  assert(!calls.some((c) => c.table === "workflow_posts" && c.method === "update"), "no update");
});

Deno.test("updatePost: non-editable status -> McpInputError, no update", async () => {
  const { db, calls } = makeFakeDb({
    workflow_posts: [{ data: { id: 7, status: "enviado_cliente" }, error: null }],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  let err: unknown;
  try { await updatePost(deps, { post_id: 7, body: "x" }); } catch (e) { err = e; }
  assert(err instanceof McpInputError, "throws McpInputError");
  assert(!calls.some((c) => c.table === "workflow_posts" && c.method === "update"), "no update");
});

Deno.test("updatePost: guarded update returns null (race) -> McpInputError", async () => {
  const { db } = makeFakeDb({
    workflow_posts: [
      { data: { id: 7, status: "rascunho" }, error: null }, // prefetch ok
      { data: null, error: null },                          // guarded update matched nothing
    ],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  let err: unknown;
  try { await updatePost(deps, { post_id: 7, titulo: "T" }); } catch (e) { err = e; }
  assert(err instanceof McpInputError, "throws McpInputError on race");
});

Deno.test("updatePost: presence semantics — empty string clears, omitted untouched", async () => {
  const { db, calls } = makeFakeDb({
    workflow_posts: [
      { data: { id: 7, status: "rascunho" }, error: null },
      { data: { id: 7, status: "rascunho" }, error: null },
    ],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  await updatePost(deps, { post_id: 7, ig_caption: "" }); // clear caption, no other field
  const payload = updatePayload(calls, "workflow_posts")!;
  assert(Object.hasOwn(payload, "ig_caption"), "ig_caption present (cleared)");
  assertEquals(payload.ig_caption, "");
  assert(!Object.hasOwn(payload, "titulo"), "titulo untouched");
  assert(!Object.hasOwn(payload, "conteudo"), "body untouched");
});

Deno.test("updatePost: body '' produces an empty TipTap doc", async () => {
  const { db, calls } = makeFakeDb({
    workflow_posts: [
      { data: { id: 7, status: "rascunho" }, error: null },
      { data: { id: 7, status: "rascunho" }, error: null },
    ],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  await updatePost(deps, { post_id: 7, body: "" });
  const payload = updatePayload(calls, "workflow_posts")!;
  assertEquals((payload.conteudo as { type: string }).type, "doc");
  assertEquals(payload.conteudo_plain, "");
});

Deno.test("updatePost: no updatable field -> McpInputError, no db access", async () => {
  const { db, calls } = makeFakeDb({});
  const deps = { db, ctx: CTX } as unknown as Deps;
  let err: unknown;
  try { await updatePost(deps, { post_id: 7 }); } catch (e) { err = e; }
  assert(err instanceof McpInputError, "throws McpInputError");
  assert(!calls.some((c) => c.table === "workflow_posts"), "no db access");
});

Deno.test("updatePost: status outside allowlist -> McpInputError, no db access", async () => {
  const { db, calls } = makeFakeDb({});
  const deps = { db, ctx: CTX } as unknown as Deps;
  let err: unknown;
  try { await updatePost(deps, { post_id: 7, status: "enviado_cliente" }); } catch (e) { err = e; }
  assert(err instanceof McpInputError, "throws McpInputError");
  assert(!calls.some((c) => c.table === "workflow_posts"), "rejected before any db access");
});

Deno.test("updatePost: editing a correcao_cliente post auto-moves it to revisao_interna", async () => {
  const { db, calls } = makeFakeDb({
    workflow_posts: [
      { data: { id: 7, status: "correcao_cliente" }, error: null },
      { data: { id: 7, status: "revisao_interna" }, error: null },
    ],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  await updatePost(deps, { post_id: 7, body: "revisado" });
  const payload = updatePayload(calls, "workflow_posts")!;
  assertEquals(payload.status, "revisao_interna");
});

Deno.test("updatePost: explicit status on a correcao_cliente post is honored", async () => {
  const { db, calls } = makeFakeDb({
    workflow_posts: [
      { data: { id: 7, status: "correcao_cliente" }, error: null },
      { data: { id: 7, status: "rascunho" }, error: null },
    ],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  await updatePost(deps, { post_id: 7, body: "revisado", status: "rascunho" });
  const payload = updatePayload(calls, "workflow_posts")!;
  assertEquals(payload.status, "rascunho");
});

Deno.test("updatePost: editing a rascunho post does not auto-set status", async () => {
  const { db, calls } = makeFakeDb({
    workflow_posts: [
      { data: { id: 7, status: "rascunho" }, error: null },
      { data: { id: 7, status: "rascunho" }, error: null },
    ],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  await updatePost(deps, { post_id: 7, body: "x" });
  const payload = updatePayload(calls, "workflow_posts")!;
  assert(!Object.hasOwn(payload, "status"), "status not auto-set for rascunho");
});

Deno.test("update_post tool redacts body/ig_caption from the audit log", async () => {
  const { db, calls } = makeFakeDb({
    workflow_posts: [
      { data: { id: 7, status: "rascunho" }, error: null }, // prefetch
      { data: { id: 7, status: "rascunho" }, error: null }, // guarded update
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
  await server.handlers["update_post"]({
    post_id: 7, titulo: "T",
    body: "ROTEIRO_SECRETO", ig_caption: "CAPTION_SECRETO",
  });
  const auditInsert = calls.find((c) => c.table === "audit_log" && c.method === "insert");
  assert(auditInsert, "audit_log insert happened");
  const meta = JSON.stringify(auditInsert!.args[0]);
  assert(!meta.includes("ROTEIRO_SECRETO"), "raw body must not be logged");
  assert(!meta.includes("CAPTION_SECRETO"), "raw ig_caption must not be logged");
  assert(meta.includes("body_len"), "logs body_len instead");
  assert(meta.includes("ig_caption_len"), "logs ig_caption_len instead");
  assertEquals((auditInsert!.args[0] as Record<string, unknown>).resource_id, "7");
});

Deno.test("setPostProperty: tenant+template scoped, select option, upsert with d.now", async () => {
  const { db, calls } = makeFakeDb({
    workflow_posts: [{ data: { id: 7, status: "rascunho", workflow_id: 3, workflows: { template_id: 9, conta_id: "workspace-A" } }, error: null }],
    template_property_definitions: [{ data: { id: 45, template_id: 9, name: "modo", type: "select", config: { options: [{ id: "t1" }] } }, error: null }],
    workflow_select_options: [{ data: [{ option_id: "w1" }], error: null }],
    post_property_values: [{ data: null, error: null }],
  });
  const deps = { db, ctx: CTX, now: () => "T" } as unknown as Deps;
  const out = await setPostProperty(deps, { post_id: 7, property_id: 45, value: "w1" });

  assert(has(calls, "workflow_posts", "eq", ["conta_id", "workspace-A"]), "post tenant-scoped");
  assert(has(calls, "workflow_posts", "eq", ["workflows.conta_id", "workspace-A"]), "embedded workflow tenant-scoped");
  assert(has(calls, "template_property_definitions", "eq", ["conta_id", "workspace-A"]), "def tenant-scoped");
  assert(has(calls, "workflow_select_options", "eq", ["workflow_id", 3]), "options workflow-scoped");
  assert(has(calls, "workflow_select_options", "eq", ["property_definition_id", 45]), "options def-scoped");
  const payload = upsertPayload(calls, "post_property_values")!;
  assertEquals(payload.post_id, 7);
  assertEquals(payload.property_definition_id, 45);
  assertEquals(payload.value, "w1");                 // valid workflow option
  assertEquals(payload.updated_at, "T");             // d.now injected
  assertEquals(out.status, "rascunho");
});

Deno.test("setPostProperty: missing post -> McpInputError, no upsert", async () => {
  const { db, calls } = makeFakeDb({ workflow_posts: [{ data: null, error: null }] });
  const deps = { db, ctx: CTX } as unknown as Deps;
  let err: unknown;
  try { await setPostProperty(deps, { post_id: 7, property_id: 45, value: "x" }); } catch (e) { err = e; }
  assert(err instanceof McpInputError, "throws McpInputError");
  assert(!calls.some((c) => c.table === "post_property_values" && c.method === "upsert"), "no upsert");
});

Deno.test("setPostProperty: non-editable status -> McpInputError, no upsert", async () => {
  const { db, calls } = makeFakeDb({
    workflow_posts: [{ data: { id: 7, status: "postado", workflow_id: 3, workflows: { template_id: 9, conta_id: "workspace-A" } }, error: null }],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  let err: unknown;
  try { await setPostProperty(deps, { post_id: 7, property_id: 45, value: "x" }); } catch (e) { err = e; }
  assert(err instanceof McpInputError, "throws McpInputError");
  assert(!calls.some((c) => c.table === "post_property_values" && c.method === "upsert"), "no upsert");
});

Deno.test("setPostProperty: workflow without template -> McpInputError, no upsert", async () => {
  const { db, calls } = makeFakeDb({
    workflow_posts: [{ data: { id: 7, status: "rascunho", workflow_id: 3, workflows: { template_id: null, conta_id: "workspace-A" } }, error: null }],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  let err: unknown;
  try { await setPostProperty(deps, { post_id: 7, property_id: 45, value: "x" }); } catch (e) { err = e; }
  assert(err instanceof McpInputError, "throws McpInputError");
  assert(!calls.some((c) => c.table === "post_property_values" && c.method === "upsert"), "no upsert");
});

Deno.test("setPostProperty: property from another template -> McpInputError, no upsert", async () => {
  const { db, calls } = makeFakeDb({
    workflow_posts: [{ data: { id: 7, status: "rascunho", workflow_id: 3, workflows: { template_id: 9, conta_id: "workspace-A" } }, error: null }],
    template_property_definitions: [{ data: { id: 45, template_id: 99, name: "x", type: "text", config: {} }, error: null }], // 99 != 9
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  let err: unknown;
  try { await setPostProperty(deps, { post_id: 7, property_id: 45, value: "x" }); } catch (e) { err = e; }
  assert(err instanceof McpInputError, "throws McpInputError");
  assert(!calls.some((c) => c.table === "post_property_values" && c.method === "upsert"), "no upsert");
});

Deno.test("setPostProperty: invalid select option -> McpInputError, no upsert", async () => {
  const { db, calls } = makeFakeDb({
    workflow_posts: [{ data: { id: 7, status: "rascunho", workflow_id: 3, workflows: { template_id: 9, conta_id: "workspace-A" } }, error: null }],
    template_property_definitions: [{ data: { id: 45, template_id: 9, name: "modo", type: "select", config: { options: [{ id: "t1" }] } }, error: null }],
    workflow_select_options: [{ data: [{ option_id: "w1" }], error: null }],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  let err: unknown;
  try { await setPostProperty(deps, { post_id: 7, property_id: 45, value: "nope" }); } catch (e) { err = e; }
  assert(err instanceof McpInputError, "throws McpInputError");
  assert(!calls.some((c) => c.table === "post_property_values" && c.method === "upsert"), "no upsert");
});

Deno.test("setPostProperty: correcao_cliente moves to revisao_interna BEFORE the upsert", async () => {
  const { db, calls } = makeFakeDb({
    workflow_posts: [
      { data: { id: 7, status: "correcao_cliente", workflow_id: 3, workflows: { template_id: 9, conta_id: "workspace-A" } }, error: null }, // fetch
      { data: { id: 7 }, error: null }, // guarded move result
    ],
    template_property_definitions: [{ data: { id: 45, template_id: 9, name: "anot", type: "text", config: {} }, error: null }],
    post_property_values: [{ data: null, error: null }],
  });
  const deps = { db, ctx: CTX, now: () => "T" } as unknown as Deps;
  const out = await setPostProperty(deps, { post_id: 7, property_id: 45, value: "nota" });

  assert(has(calls, "workflow_posts", "update", [{ status: "revisao_interna" }]), "moves to revisao_interna");
  assert(has(calls, "workflow_posts", "eq", ["status", "correcao_cliente"]), "guarded on correcao_cliente");
  const moveIdx = calls.findIndex((c) => c.table === "workflow_posts" && c.method === "update");
  const upsertIdx = calls.findIndex((c) => c.table === "post_property_values" && c.method === "upsert");
  assert(moveIdx >= 0 && upsertIdx >= 0 && moveIdx < upsertIdx, "status move happens before the upsert");
  assertEquals(out.status, "revisao_interna");
});

Deno.test("setPostProperty: correcao_cliente move returns null (race) -> McpInputError, no upsert", async () => {
  const { db, calls } = makeFakeDb({
    workflow_posts: [
      { data: { id: 7, status: "correcao_cliente", workflow_id: 3, workflows: { template_id: 9, conta_id: "workspace-A" } }, error: null },
      { data: null, error: null }, // guarded move matched nothing
    ],
    template_property_definitions: [{ data: { id: 45, template_id: 9, name: "anot", type: "text", config: {} }, error: null }],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  let err: unknown;
  try { await setPostProperty(deps, { post_id: 7, property_id: 45, value: "nota" }); } catch (e) { err = e; }
  assert(err instanceof McpInputError, "throws McpInputError");
  assert(!calls.some((c) => c.table === "post_property_values" && c.method === "upsert"), "no upsert after a failed move");
});

Deno.test("set_post_property tool redacts the raw value from the audit log", async () => {
  const { db, calls } = makeFakeDb({
    workflow_posts: [{ data: { id: 7, status: "rascunho", workflow_id: 3, workflows: { template_id: 9, conta_id: "workspace-A" } }, error: null }],
    template_property_definitions: [{ data: { id: 45, template_id: 9, name: "anot", type: "text", config: {} }, error: null }],
    post_property_values: [{ data: null, error: null }],
    audit_log: [{ data: null, error: null }],
  });
  const deps = { db, ctx: CTX, now: () => "T" } as unknown as Deps;
  const server = {
    handlers: {} as Record<string, (a: unknown) => Promise<unknown>>,
    // deno-lint-ignore no-explicit-any
    tool(name: string, _d: any, _s: any, h: any) { this.handlers[name] = h; },
  };
  // deno-lint-ignore no-explicit-any
  registerTools(server as any, deps);
  await server.handlers["set_post_property"]({ post_id: 7, property_id: 45, value: "ANOTACAO_SECRETA" });
  const auditInsert = calls.find((c) => c.table === "audit_log" && c.method === "insert");
  assert(auditInsert, "audit_log insert happened");
  const meta = JSON.stringify(auditInsert!.args[0]);
  assert(!meta.includes("ANOTACAO_SECRETA"), "raw value must not be logged");
  assert(meta.includes("value_kind"), "logs value_kind instead");
  assertEquals((auditInsert!.args[0] as Record<string, unknown>).resource_id, "7");
});

Deno.test("createWorkflow: with template instantiates its etapas + records template_id", async () => {
  const { db, calls } = makeFakeDb({
    clientes: [{ data: { id: 5 }, error: null }],
    workflow_templates: [{ data: { id: 12, etapas: [
      { nome: "Roteiro", prazo_dias: 2, tipo_prazo: "uteis", tipo: "padrao", responsavel_id: 8 },
      { nome: "Aprovação", prazo_dias: 1, tipo_prazo: "corridos", tipo: "aprovacao_cliente" },
    ] }, error: null }],
    workflows: [{ data: { id: 99, cliente_id: 5, titulo: "X", status: "ativo", etapa_atual: 0, template_id: 12, created_via: "agent", created_at: "t" }, error: null }],
    workflow_etapas: [{ data: null, error: null }],
  });
  const deps = { db, ctx: CTX, now: () => "T" } as unknown as Deps;
  const out = await createWorkflow(deps, { client_id: 5, titulo: "X", template_id: 12 });

  assert(has(calls, "workflow_templates", "eq", ["conta_id", "workspace-A"]), "template tenant-scoped");
  assert(has(calls, "workflow_templates", "eq", ["id", 12]), "template id checked");
  const wf = insertPayload(calls, "workflows")!;
  assertEquals(wf.template_id, 12);
  const rows = insertPayload(calls, "workflow_etapas") as Record<string, unknown>[];
  assertEquals(rows.length, 2);
  assertEquals(rows[0].nome, "Roteiro");
  assertEquals(rows[0].responsavel_id, 8);            // preserved
  assertEquals(rows[0].status, "ativo");
  assertEquals(rows[0].workflow_id, 99);
  assertEquals(rows[1].nome, "Aprovação");
  assertEquals(rows[1].status, "pendente");
  assertEquals(rows[1].workflow_id, 99);
  assertEquals(out.id, 99);
});

Deno.test("createWorkflow: template not found -> McpInputError, no workflow insert", async () => {
  const { db, calls } = makeFakeDb({
    clientes: [{ data: { id: 5 }, error: null }],
    workflow_templates: [{ data: null, error: null }],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  let err: unknown;
  try { await createWorkflow(deps, { client_id: 5, titulo: "X", template_id: 12 }); } catch (e) { err = e; }
  assert(err instanceof McpInputError, "throws McpInputError");
  assert(!calls.some((c) => c.table === "workflows" && c.method === "insert"), "no workflow insert");
});

Deno.test("createWorkflow: template with empty etapas falls back to the default step", async () => {
  const { db, calls } = makeFakeDb({
    clientes: [{ data: { id: 5 }, error: null }],
    workflow_templates: [{ data: { id: 12, etapas: [] }, error: null }],
    workflows: [{ data: { id: 99, cliente_id: 5, titulo: "X", status: "ativo", etapa_atual: 0, template_id: 12, created_via: "agent", created_at: "t" }, error: null }],
    workflow_etapas: [{ data: null, error: null }],
  });
  const deps = { db, ctx: CTX, now: () => "T" } as unknown as Deps;
  await createWorkflow(deps, { client_id: 5, titulo: "X", template_id: 12 });
  const rows = insertPayload(calls, "workflow_etapas") as Record<string, unknown>[];
  assertEquals(rows.length, 1);
  assertEquals(rows[0].nome, "Conteúdo");
  assertEquals(rows[0].workflow_id, 99);
});

Deno.test("createWorkflow: template with malformed (non-array) etapas falls back to default", async () => {
  const { db, calls } = makeFakeDb({
    clientes: [{ data: { id: 5 }, error: null }],
    workflow_templates: [{ data: { id: 12, etapas: null }, error: null }],
    workflows: [{ data: { id: 99, cliente_id: 5, titulo: "X", status: "ativo", etapa_atual: 0, template_id: 12, created_via: "agent", created_at: "t" }, error: null }],
    workflow_etapas: [{ data: null, error: null }],
  });
  const deps = { db, ctx: CTX, now: () => "T" } as unknown as Deps;
  await createWorkflow(deps, { client_id: 5, titulo: "X", template_id: 12 });
  const rows = insertPayload(calls, "workflow_etapas") as Record<string, unknown>[];
  assertEquals(rows.length, 1);
  assertEquals(rows[0].nome, "Conteúdo");
});

Deno.test("createWorkflowTemplate: inserts template + property defs with generated option ids", async () => {
  const { db, calls } = makeFakeDb({
    workflow_templates: [{ data: { id: 50, nome: "Modelo", modo_prazo: "padrao" }, error: null }],
    template_property_definitions: [{ data: [
      { id: 77, name: "modo", type: "select", config: { options: [{ id: "opt-1", label: "A", color: "#94a3b8" }] }, portal_visible: false, display_order: 0 },
    ], error: null }],
  });
  let n = 0;
  const deps = { db, ctx: CTX, genId: () => "opt-" + (++n) } as unknown as Deps;
  const out = await createWorkflowTemplate(deps, {
    nome: "Modelo",
    etapas: [{ nome: "Roteiro", prazo_dias: 2, tipo_prazo: "uteis", tipo: "padrao" }],
    properties: [{ name: "modo", type: "select", options: ["A"] }],
  });

  const tpl = insertPayload(calls, "workflow_templates")!;
  assertEquals(tpl.conta_id, "workspace-A");
  assertEquals(tpl.user_id, "user-1");
  assertEquals(tpl.nome, "Modelo");
  assertEquals(tpl.modo_prazo, "padrao");
  assertEquals((tpl.etapas as any[])[0], { nome: "Roteiro", prazo_dias: 2, tipo_prazo: "uteis", tipo: "padrao" });
  const defRows = insertPayload(calls, "template_property_definitions") as Record<string, unknown>[];
  assertEquals(defRows[0].template_id, 50);
  assertEquals(defRows[0].conta_id, "workspace-A");
  assertEquals((defRows[0].config as any).options[0].id, "opt-1");
  assertEquals(out.id, 50);
  assertEquals(out.properties[0].id, 77);
});

Deno.test("createWorkflowTemplate: modo_prazo honored; no properties -> no defs insert", async () => {
  const { db, calls } = makeFakeDb({
    workflow_templates: [{ data: { id: 50, nome: "M", modo_prazo: "data_fixa" }, error: null }],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  const out = await createWorkflowTemplate(deps, { nome: "M", modo_prazo: "data_fixa", etapas: [{ nome: "E1" }] });
  assertEquals(insertPayload(calls, "workflow_templates")!.modo_prazo, "data_fixa");
  assert(!calls.some((c) => c.table === "template_property_definitions"), "no property defs insert");
  assertEquals(out.properties, []);
});

Deno.test("createWorkflowTemplate: template cap -> friendly McpInputError, no defs insert", async () => {
  const { db, calls } = makeFakeDb({
    workflow_templates: [{ data: null, error: { message: "plan_limit_exceeded:max_workflow_templates" } }],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;
  let err: unknown;
  try { await createWorkflowTemplate(deps, { nome: "M", etapas: [{ nome: "E1" }], properties: [{ name: "p", type: "text" }] }); } catch (e) { err = e; }
  assert(err instanceof McpInputError, "friendly cap error");
  assert(!calls.some((c) => c.table === "template_property_definitions"), "no property defs insert");
});

Deno.test("createWorkflowTemplate: property cap -> compensating delete + friendly McpInputError", async () => {
  const { db, calls } = makeFakeDb({
    workflow_templates: [
      { data: { id: 50, nome: "M", modo_prazo: "padrao" }, error: null },  // template insert
      { data: null, error: null },                                          // compensating delete result
    ],
    template_property_definitions: [{ data: null, error: { message: "plan_limit_exceeded:max_custom_properties_per_template" } }],
  });
  const deps = { db, ctx: CTX, genId: () => "o" } as unknown as Deps;
  let err: unknown;
  try { await createWorkflowTemplate(deps, { nome: "M", etapas: [{ nome: "E1" }], properties: [{ name: "p", type: "select", options: ["A"] }] }); } catch (e) { err = e; }
  assert(err instanceof McpInputError, "friendly cap error");
  assert(has(calls, "workflow_templates", "eq", ["id", 50]) && has(calls, "workflow_templates", "eq", ["conta_id", "workspace-A"]), "compensating delete scoped to id+conta");
  assert(calls.some((c) => c.table === "workflow_templates" && c.method === "delete"), "compensating delete happened");
});

Deno.test("createWorkflowTemplate: cleanup best-effort — delete error does not mask the original error", async () => {
  const { db } = makeFakeDb({
    workflow_templates: [
      { data: { id: 50, nome: "M", modo_prazo: "padrao" }, error: null },          // template insert
      { data: null, error: { message: "delete blew up" } },                         // delete returns its own error
    ],
    template_property_definitions: [{ data: null, error: { message: "plan_limit_exceeded:max_custom_properties_per_template" } }],
  });
  const deps = { db, ctx: CTX, genId: () => "o" } as unknown as Deps;
  let err: unknown;
  try { await createWorkflowTemplate(deps, { nome: "M", etapas: [{ nome: "E1" }], properties: [{ name: "p", type: "select", options: ["A"] }] }); } catch (e) { err = e; }
  assert(err instanceof McpInputError, "original friendly cap error still thrown, not the delete error");
});

Deno.test("createWorkflowTemplate: duplicate property names -> McpInputError, no template insert", async () => {
  const { db, calls } = makeFakeDb({});
  const deps = { db, ctx: CTX } as unknown as Deps;
  let err: unknown;
  try { await createWorkflowTemplate(deps, { nome: "M", etapas: [{ nome: "E1" }], properties: [{ name: "x", type: "text" }, { name: "x", type: "text" }] }); } catch (e) { err = e; }
  assert(err instanceof McpInputError, "validation error");
  assert(!calls.some((c) => c.table === "workflow_templates"), "no template insert");
});

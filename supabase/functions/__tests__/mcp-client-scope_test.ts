// deno-lint-ignore-file no-explicit-any
// Acesso por cliente in the MCP (service role, no RLS): every client-linked tool honors the key
// user's client scope. Restricted scope here = assigned client 5, membro 30. Client 9 is hidden.
import { assert, assertEquals } from "./assert.ts";
import { type Call, fakeServer, makeDeps, makeFakeDb, type Resp } from "./mcp-financeiro-helpers.ts";
import { registerTools } from "../mcp/tools.ts";
import { clientScopeGetter, scopeOf } from "../mcp/queries.ts";
import { CLIENT_SCOPE_MESSAGE, errorResult } from "../mcp/register.ts";
import { ClientScopeError, type ClientScope } from "../_shared/client-scope.ts";
import { signSendNonce } from "../_shared/mcp-send-nonce.ts";

const RESTRICTED: ClientScope = { all: false, ids: new Set([5]), membroIds: new Set([30]) };
const NONE: ClientScope = { all: false, ids: new Set(), membroIds: new Set() };
const SECRET = "test-secret-key-for-client-scope-32ch!";
const USER = "user-1";
const CONTA = "workspace-A";
const ALL_SCOPES = [
  "clientes:read", "clientes:write", "posts:read", "posts:write", "workflows:read", "ideias:read",
  "tarefas:read", "tarefas:write",
];

function setup(
  scope: ClientScope,
  tables: Record<string, Resp[]> = {},
  rpc: Record<string, Resp[]> = {},
) {
  Deno.env.set("TOKEN_ENCRYPTION_KEY", SECRET);
  Deno.env.set("MCP_IMAGE_HOSTS", "files.example.com");
  const { db, calls } = makeFakeDb(tables, rpc);
  let loads = 0;
  const deps = {
    ...makeDeps(db, { scopes: ALL_SCOPES, role: "agent", key_id: "oauth:c1", created_by: USER, conta_id: CONTA }),
    apps: { enabled: true, oauth: true, r2Origin: null },
    signUrl: (k: string) => Promise.resolve(`signed:${k}`),
    clientScope: () => {
      loads++;
      return Promise.resolve(scope);
    },
  };
  const server = Object.assign(fakeServer(), { registerResource() {} });
  registerTools(server, deps);
  const call = async (tool: string, args: Record<string, unknown>) => {
    const res = await server.handlers[tool](args);
    let parsed: any;
    try {
      parsed = JSON.parse(res.content[0].text ?? "null");
    } catch {
      parsed = res.content[0].text; // card summary text
    }
    return { res, data: parsed, error: res.isError ? (parsed?.error ?? res.content[0].text) : undefined };
  };
  return { call, calls, deps, loads: () => loads };
}

const reads = (calls: Call[], table: string) => calls.filter((c) => c.table === table && c.method === "from").length;
const hasIn = (calls: Call[], table: string, col: string, ids: number[]) =>
  calls.some((c) => c.table === table && c.method === "in" && JSON.stringify(c.args) === JSON.stringify([col, ids]));
const wrote = (calls: Call[], table: string) =>
  calls.some((c) => c.table === table && ["insert", "update", "upsert", "delete"].includes(c.method));
const NOT_FOUND_CLIENT = "Cliente não encontrado neste workspace.";

// ---- lists ---------------------------------------------------------------------------------

Deno.test("client scope: lists filter by the assigned ids", async () => {
  const cases: Array<[string, Record<string, unknown>, string, string]> = [
    ["list_clients", {}, "clientes", "id"],
    ["list_posts", {}, "workflow_posts", "cliente_id"],
    ["list_workflows", {}, "workflows", "cliente_id"],
    ["list_ideas", {}, "ideias", "cliente_id"],
    ["list_pages", {}, "hub_pages", "cliente_id"],
    ["list_tasks", {}, "tarefas", "cliente_id"],
  ];
  for (const [tool, args, table, col] of cases) {
    const { call, calls } = setup(RESTRICTED, { [table]: [{ data: [], error: null }] });
    const { error } = await call(tool, args);
    assertEquals(error, undefined, tool);
    assert(hasIn(calls, table, col, [5]), `${tool} filters ${table}.${col} by [5]`);
  }
});

Deno.test("client scope: zero assigned clients -> empty lists without querying (never .in([]))", async () => {
  for (const [tool, table] of [
    ["list_clients", "clientes"], ["list_posts", "workflow_posts"], ["list_workflows", "workflows"],
    ["list_ideas", "ideias"], ["list_pages", "hub_pages"], ["list_tasks", "tarefas"],
    ["list_post_feedback", "post_approvals"],
  ]) {
    const { call, calls } = setup(NONE);
    const { data, error } = await call(tool, {});
    assertEquals(error, undefined, tool);
    assertEquals(data, [], tool);
    assertEquals(reads(calls, table), 0, `${tool} reads nothing`);
  }
  // Derived sort keeps its envelope.
  const { call } = setup(NONE);
  assertEquals((await call("list_posts", { sort_by_metric: "like_rate" })).data, { posts: [], truncated: false, cap: 500 });
});

Deno.test("client scope: unrestricted scope adds no filter", async () => {
  const ALL: ClientScope = { all: true, ids: new Set(), membroIds: new Set() };
  const { call, calls } = setup(ALL, { clientes: [{ data: [], error: null }] });
  await call("list_clients", {});
  assert(!calls.some((c) => c.method === "in"), "no .in filter");
});

Deno.test("client scope: list_post_feedback filters both scans by the assigned ids", async () => {
  const { call, calls } = setup(RESTRICTED);
  await call("list_post_feedback", {});
  assert(hasIn(calls, "post_approvals", "workflow_posts.cliente_id", [5]));
  assert(hasIn(calls, "post_media_notes", "workflow_posts.cliente_id", [5]));
});

Deno.test("client scope: list_post_feedback of a hidden post -> [], of the user's own post -> reads", async () => {
  const hidden = setup(RESTRICTED, { workflow_posts: [{ data: { id: 1, cliente_id: 9, responsavel_id: 31 }, error: null }] });
  assertEquals((await hidden.call("list_post_feedback", { post_id: 1 })).data, []);
  assertEquals(reads(hidden.calls, "post_approvals"), 0);

  const own = setup(RESTRICTED, { workflow_posts: [{ data: { id: 1, cliente_id: 9, responsavel_id: 30 }, error: null }] });
  await own.call("list_post_feedback", { post_id: 1 });
  assert(reads(own.calls, "post_approvals") > 0, "own post's feedback is read");
  assert(!hasIn(own.calls, "post_approvals", "workflow_posts.cliente_id", [5]), "no client filter on a single post");
});

// ---- reads by id ---------------------------------------------------------------------------

Deno.test("client scope: hidden client reads like a missing one", async () => {
  for (const tool of ["get_client", "get_brand_profile", "get_performance_baseline"]) {
    const { call, calls } = setup(RESTRICTED, { clientes: [{ data: { id: 9, nome: "X" }, error: null }] });
    const { data, error } = await call(tool, { client_id: 9 });
    assertEquals(error, undefined, tool);
    assertEquals(data, null, tool);
    assertEquals(reads(calls, "clientes"), 0, `${tool} does not read the hidden client`);
  }
  const ok = setup(RESTRICTED, { clientes: [{ data: { id: 5, nome: "A" }, error: null }] });
  assertEquals((await ok.call("get_client", { client_id: 5 })).data?.id, 5);
});

Deno.test("client scope: get_post hidden -> null; the user's own post in a hidden client -> visible", async () => {
  const row = (responsavel_id: number) => ({
    id: 1, workflow_id: null, cliente_id: 9, titulo: "T", tipo: "feed", status: "rascunho", ig_caption: null,
    conteudo_plain: "", created_via: "agent", instagram_media_id: null, instagram_permalink: null,
    scheduled_at: null, published_at: null, created_at: "t", responsavel_id,
  });
  const hidden = setup(RESTRICTED, { workflow_posts: [{ data: row(31), error: null }] });
  assertEquals((await hidden.call("get_post", { post_id: 1 })).data, null);
  assertEquals(reads(hidden.calls, "post_file_links"), 0, "no media read for a hidden post");

  const own = setup(RESTRICTED, { workflow_posts: [{ data: row(30), error: null }] });
  const { data } = await own.call("get_post", { post_id: 1 });
  assertEquals(data?.id, 1);
  assertEquals("responsavel_id" in data, false, "responsavel_id is read, not emitted");
});

Deno.test("client scope: cards and calendar of a hidden client -> existing not-found", async () => {
  const preview = setup(RESTRICTED, { clientes: [{ data: { id: 9, nome: "X" }, error: null }] });
  assertEquals(
    (await preview.call("preview_post", { client_id: 9, titulo: "T", tipo: "feed", ig_caption: "c" })).error,
    NOT_FOUND_CLIENT,
  );
  const caps = setup(RESTRICTED, { clientes: [{ data: { id: 9, nome: "X" }, error: null }] });
  assertEquals(
    (await caps.call("show_caption_options", { client_id: 9, options: [{ label: "a", text: "a" }, { label: "b", text: "b" }] })).error,
    NOT_FOUND_CLIENT,
  );
  const cal = setup(RESTRICTED, { clientes: [{ data: { id: 9, nome: "X" }, error: null }] });
  assertEquals((await cal.call("show_client_calendar", { client_id: 9 })).error, NOT_FOUND_CLIENT);
  assertEquals(reads(cal.calls, "workflow_posts"), 0);
});

const IMAGE = { download_url: "https://files.example.com/a.png", file_id: "f1" };
const attachPost = (cliente_id: number, responsavel_id: number) => ({
  id: 1, titulo: "T", tipo: "feed", status: "rascunho", cliente_id, responsavel_id, published_at: null,
  instagram_media_id: null, instagram_container_id: null, publish_processing_at: null,
  tiktok_publish_processing_at: null, tiktok_publish_status: null,
});

Deno.test("client scope: show_attach_image hidden -> not found; own post in hidden client -> limitado; assigned -> card", async () => {
  const hidden = setup(RESTRICTED, { workflow_posts: [{ data: attachPost(9, 31), error: null }] });
  assertEquals((await hidden.call("show_attach_image", { post_id: 1, images: [IMAGE] })).error, "Post não encontrado neste workspace.");

  const own = setup(RESTRICTED, { workflow_posts: [{ data: attachPost(9, 30), error: null }] });
  assertEquals((await own.call("show_attach_image", { post_id: 1, images: [IMAGE] })).error, CLIENT_SCOPE_MESSAGE);
  assertEquals(reads(own.calls, "post_file_links"), 0);

  const ok = setup(RESTRICTED, { workflow_posts: [{ data: attachPost(5, 31), error: null }] });
  const res = await ok.call("show_attach_image", { post_id: 1, images: [IMAGE] });
  assertEquals(res.error, undefined);
  assertEquals(res.res.structuredContent?.card, "attach_image");
});

// ---- writes (never "é dele") --------------------------------------------------------------

Deno.test("client scope: create_client is refused for a restricted key, before any read", async () => {
  const { call, calls } = setup(RESTRICTED);
  assertEquals((await call("create_client", { nome: "Nova" })).error, CLIENT_SCOPE_MESSAGE);
  assertEquals(reads(calls, "clientes"), 0);
});

Deno.test("client scope: create_* with a direct hidden client_id are refused (scope first, no client read)", async () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ["create_workflow", { client_id: 9, titulo: "F" }, "workflows"],
    ["create_post", { cliente_id: 9, titulo: "P" }, "workflow_posts"],
    ["create_task", { titulo: "T", cliente_id: 9 }, "tarefas"],
    ["create_task", { titulo: "T" }, "tarefas"],
  ];
  for (const [tool, args, target] of cases) {
    const { call, calls } = setup(RESTRICTED, { clientes: [{ data: { id: 9 }, error: null }] });
    assertEquals((await call(tool, args)).error, CLIENT_SCOPE_MESSAGE, `${tool} ${JSON.stringify(args)}`);
    assertEquals(reads(calls, "clientes"), 0, `${tool} reads no client`);
    assert(!wrote(calls, target), `${tool} writes nothing`);
  }
});

const hiddenPost = { id: 1, status: "rascunho", workflow_id: 7, cliente_id: 9, responsavel_id: 31, workflows: { template_id: 3 } };
const ownHiddenPost = { ...hiddenPost, responsavel_id: 30 };

/** Writes on a row fetched by id: [tool, args, table holding the row, the hidden row, write target]. */
const ROW_WRITES: Array<[string, Record<string, unknown>, string, Record<string, unknown>, string]> = [
  ["create_post", { workflow_id: 7, titulo: "P" }, "workflows", { id: 7, cliente_id: 9 }, "workflow_posts"],
  ["update_post", { post_id: 1, titulo: "x" }, "workflow_posts", hiddenPost, "workflow_posts"],
  ["set_post_property", { post_id: 1, property_id: 2, value: "a" }, "workflow_posts", hiddenPost, "post_property_values"],
  ["update_task", { task_id: 1, titulo: "x" }, "tarefas", { id: 1, cliente_id: 9 }, "tarefas"],
  ["update_task", { task_id: 1, titulo: "x" }, "tarefas", { id: 1, cliente_id: null }, "tarefas"],
  ["attach_image_to_post", { post_id: 1, image: IMAGE, position: 1, replace: false }, "workflow_posts", attachPost(9, 31), "post_file_links"],
];

Deno.test("client scope: a hidden row answers byte-identically to a missing row (no id probing)", async () => {
  for (const [tool, args, table, row, target] of ROW_WRITES) {
    const hidden = setup(RESTRICTED, { [table]: [{ data: row, error: null }] });
    const missing = setup(RESTRICTED, { [table]: [{ data: null, error: null }] });
    const h = await hidden.call(tool, args);
    const m = await missing.call(tool, args);
    assert(h.res.isError, `${tool} hidden is an error`);
    assertEquals(h.res.content[0].text, m.res.content[0].text, `${tool} ${JSON.stringify(row)}`);
    assert(h.error !== CLIENT_SCOPE_MESSAGE, `${tool} never says "limitado" for a hidden row`);
    assert(!wrote(hidden.calls, target), `${tool} writes nothing`);
  }
});

Deno.test("client scope: own post in a hidden client is readable but never writable", async () => {
  const cases: Array<[string, Record<string, unknown>, Record<string, unknown>, string]> = [
    ["update_post", { post_id: 1, titulo: "x" }, ownHiddenPost, "workflow_posts"],
    ["set_post_property", { post_id: 1, property_id: 2, value: "a" }, ownHiddenPost, "post_property_values"],
    ["attach_image_to_post", { post_id: 1, image: IMAGE, position: 1, replace: false }, attachPost(9, 30), "post_file_links"],
  ];
  for (const [tool, args, row, target] of cases) {
    const { call, calls } = setup(RESTRICTED, { workflow_posts: [{ data: row, error: null }] });
    assertEquals((await call(tool, args)).error, CLIENT_SCOPE_MESSAGE, tool);
    assert(!wrote(calls, target), `${tool} writes nothing`);
  }
});

Deno.test("client scope: writes to an assigned client go through", async () => {
  const { call, calls } = setup(RESTRICTED, {
    clientes: [{ data: { id: 5 }, error: null }],
    tarefas: [{ data: { id: 11 }, error: null }],
  });
  assertEquals((await call("create_task", { titulo: "T", cliente_id: 5 })).error, undefined);
  assert(wrote(calls, "tarefas"));
});

async function setMedia(row: Record<string, unknown> | null) {
  const s = setup(RESTRICTED, { workflow_posts: [{ data: row, error: null }] }, {
    post_media_set_from_uploads: [{ data: null, error: { message: "post_not_found" } }],
  });
  (s.deps as any).headObject = () => Promise.resolve({ contentLength: 1, contentType: "image/png" });
  const { setPostMedia } = await import("../mcp/media.ts");
  try {
    await setPostMedia(s.deps as any, { post_id: 1, items: [{ r2_key: `contas/${CONTA}/files/a.png`, size_bytes: 1, mime_type: "image/png" }] });
    return { err: undefined as unknown, calls: s.calls };
  } catch (e) {
    return { err: e, calls: s.calls };
  }
}

Deno.test("client scope: set_post_media hidden == missing; own post in hidden client -> limitado; no RPC for either", async () => {
  const hidden = await setMedia({ id: 1, cliente_id: 9, responsavel_id: 31 });
  const missing = await setMedia(null);
  assert(hidden.err instanceof Error && missing.err instanceof Error);
  assertEquals((hidden.err as Error).message, (missing.err as Error).message);
  assertEquals((hidden.err as Error).constructor, (missing.err as Error).constructor);
  assert(!hidden.calls.some((c) => c.table === "rpc:post_media_set_from_uploads"), "no RPC for a hidden post");

  const own = await setMedia({ id: 1, cliente_id: 9, responsavel_id: 30 });
  assert(own.err instanceof ClientScopeError);
  assert(!own.calls.some((c) => c.table === "rpc:post_media_set_from_uploads"));
});

Deno.test("client scope: send_post_to_client hidden == missing ('stale'); own post in hidden client -> limitado", async () => {
  const nonce = await signSendNonce(SECRET, { conta_id: CONTA, user_id: USER, post_id: 1 });
  const args = { post_id: 1, expected_status: "rascunho", nonce };
  const hidden = setup(RESTRICTED, { workflow_posts: [{ data: { id: 1, cliente_id: 9, responsavel_id: 31 }, error: null }] });
  // Missing post: the RPC finds no row and answers 'stale'.
  const missing = setup(RESTRICTED, { workflow_posts: [{ data: null, error: null }] }, {
    mcp_send_post_to_client: [{ data: "stale", error: null }],
  });
  const h = await hidden.call("send_post_to_client", args);
  const m = await missing.call("send_post_to_client", args);
  assertEquals(h.res.content, m.res.content);
  assertEquals(h.res.structuredContent, m.res.structuredContent);
  assert(!hidden.calls.some((c) => c.table === "rpc:mcp_send_post_to_client"), "no RPC for a hidden post");

  const own = setup(RESTRICTED, { workflow_posts: [{ data: { id: 1, cliente_id: 9, responsavel_id: 30 }, error: null }] });
  assertEquals((await own.call("send_post_to_client", args)).error, CLIENT_SCOPE_MESSAGE);
  assert(!own.calls.some((c) => c.table === "rpc:mcp_send_post_to_client"));
});

// ---- plumbing ------------------------------------------------------------------------------

Deno.test("client scope: errorResult maps ClientScopeError to the generic message without logging", () => {
  const orig = console.error;
  let logged = 0;
  console.error = () => {
    logged++;
  };
  try {
    const r = errorResult(new ClientScopeError());
    assertEquals(JSON.parse(r.content[0].text), { error: "Seu acesso é limitado aos clientes atribuídos." });
    assertEquals(r.isError, true);
    assertEquals(logged, 0);
  } finally {
    console.error = orig;
  }
});

Deno.test("client scope: tools that don't touch clients never load it (at-most-once is the clientScopeGetter test)", async () => {
  const s = setup(RESTRICTED, { clientes: [{ data: [], error: null }] });
  await s.call("list_workflow_templates", {});
  assertEquals(s.loads(), 0);
  await s.call("list_clients", {});
  await s.call("list_posts", {});
  assert(s.loads() >= 1);
});

Deno.test("clientScopeGetter: owner skips the read; others read workspace_members once", async () => {
  const owner = makeFakeDb({});
  const g1 = clientScopeGetter(owner.db as any, { conta_id: CONTA, scopes: [], key_id: "k", created_by: USER, role: "owner" });
  assertEquals((await g1()).all, true);
  assertEquals(reads(owner.calls, "workspace_members"), 0);

  const agent = makeFakeDb({
    workspace_members: [{ data: { role: "agent", client_scope: "atribuidos" }, error: null }],
    workspace_member_clientes: [{ data: [{ cliente_id: 5 }], error: null }],
    membros: [{ data: [{ id: 30 }], error: null }],
  });
  const g2 = clientScopeGetter(agent.db as any, { conta_id: CONTA, scopes: [], key_id: "k", created_by: USER, role: "agent" });
  const a = await g2();
  const b = await g2();
  assertEquals(a, b);
  assertEquals([...a.ids], [5]);
  assertEquals(reads(agent.calls, "workspace_members"), 1);
});

Deno.test("scopeOf without an injected getter loads from db (never 'all' by default), memoized", async () => {
  const { db, calls } = makeFakeDb({ workspace_members: [{ data: null, error: null }] });
  const deps = makeDeps(db, { role: undefined });
  const s1 = await scopeOf(deps);
  const s2 = await scopeOf(deps);
  assertEquals(s1.all, false);
  assertEquals(s1, s2);
  assertEquals(reads(calls, "workspace_members"), 1);

  const failing = makeFakeDb({ workspace_members: [{ data: null, error: { message: "boom" } }] });
  let threw = false;
  try {
    await scopeOf(makeDeps(failing.db));
  } catch {
    threw = true;
  }
  assert(threw, "a read error fails closed");
});

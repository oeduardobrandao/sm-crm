// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals } from "./assert.ts";
import { makeDeps, makeFakeDb } from "./mcp-financeiro-helpers.ts";
import { MCP_ALLOWED_SCOPES } from "../_shared/mcp-token.ts";
import { registerTools } from "../mcp/tools.ts";
import { register } from "../mcp/register.ts";
import { mergeToolMeta, TOOL_META } from "../mcp/tool-meta.ts";

type Recorded = { config: any; cb: (args: any) => Promise<any> };

/** Recording fake of McpServer.registerTool(name, config, cb). */
function recordingServer() {
  const tools: Record<string, Recorded> = {};
  return {
    tools,
    registerTool(name: string, config: any, cb: any) {
      tools[name] = { config, cb };
    },
    registerResource() {},
  };
}

function allScopesDeps() {
  const { db } = makeFakeDb({});
  return makeDeps(db, { scopes: [...MCP_ALLOWED_SCOPES], role: "owner" });
}

Deno.test("mcp-annotations: every tool has a title and annotations", () => {
  const server = recordingServer();
  registerTools(server, allScopesDeps());
  const names = Object.keys(server.tools);
  assertEquals(names.length, 49);
  for (const name of names) {
    const { config } = server.tools[name];
    assert(typeof config.title === "string" && config.title.length > 0, `${name}: title`);
    assertEquals(config.annotations.title, config.title);
    assertEquals(typeof config.annotations.readOnlyHint, "boolean", `${name}: readOnlyHint`);
    assertEquals(typeof config.annotations.destructiveHint, "boolean", `${name}: destructiveHint`);
    assertEquals(config.annotations.openWorldHint, false, `${name}: openWorldHint`);
    assert(!("_meta" in config), `${name}: no _meta while cards are off`);
    assert(!config.title.includes("—"), `${name}: no em dash in title`);
    if (/^(list|get)_/.test(name)) assertEquals(config.annotations.readOnlyHint, true, `${name}: read-only`);
    if (config.annotations.readOnlyHint) assertEquals(config.annotations.destructiveHint, false, `${name}: read-only is not destructive`);
  }
  for (const name of ["delete_lancamento", "delete_funcao", "fechar_periodo"]) {
    assertEquals(server.tools[name].config.annotations.destructiveHint, true, name);
  }
  assertEquals(server.tools["create_post"].config.annotations.readOnlyHint, false);
  assertEquals(server.tools["create_post"].config.annotations.destructiveHint, false);
  assertEquals(server.tools["create_post"].config.title, "Criar post em rascunho");
});

Deno.test("mcp-annotations: every TOOL_META entry maps to a tool that can register (no stale entries)", () => {
  const server = recordingServer();
  registerTools(server, { ...allScopesDeps(), apps: { enabled: true, oauth: true, r2Origin: null } });
  assertEquals(Object.keys(TOOL_META).sort(), Object.keys(server.tools).sort());
});

Deno.test("mcp-annotations: a card tool returns structuredContent, summary text and non-empty resultMeta", async () => {
  const { db, calls } = makeFakeDb({});
  const deps = makeDeps(db, { scopes: [...MCP_ALLOWED_SCOPES], role: "owner" });
  const server = recordingServer();
  register(
    server, deps, "list_clients", "clientes:read", "d", {},
    async () => ({ summary: "Prévia pronta.", data: { card: "x", v: 1, post_id: 7 } }),
    (_a, r) => ({ post_id: r.post_id }),
    { card: true, resultMeta: async () => ({ "mesaas/n": "t" }) },
  );
  const res = await server.tools["list_clients"].cb({});
  assertEquals(res.content, [{ type: "text", text: "Prévia pronta." }]);
  assertEquals(res.structuredContent, { card: "x", v: 1, post_id: 7 });
  assertEquals(res._meta, { "mesaas/n": "t" });
  const audit = calls.find((c) => c.table === "audit_log" && c.method === "insert")!.args[0] as any;
  assertEquals(audit.action, "mcp.list_clients");
  assertEquals(audit.metadata.args, { post_id: 7 });
});

Deno.test("mcp-annotations: a card tool with empty or no resultMeta has no _meta; errors stay generic", async () => {
  for (const rm of [undefined, async () => ({}), async () => undefined]) {
    const server = recordingServer();
    register(
      server, allScopesDeps(), "list_clients", "clientes:read", "d", {},
      async () => ({ summary: "ok", data: { card: "x" } }), undefined, { card: true, resultMeta: rm as any },
    );
    const res = await server.tools["list_clients"].cb({});
    assertEquals(res.structuredContent, { card: "x" });
    assert(!("_meta" in res));
  }
  const server = recordingServer();
  register(server, allScopesDeps(), "list_clients", "clientes:read", "d", {}, async () => { throw new Error("boom"); }, undefined, { card: true });
  const res = await server.tools["list_clients"].cb({});
  assertEquals(res.isError, true);
});

Deno.test("mcp-annotations: mergeToolMeta throws on a duplicate name", () => {
  const m = { title: "T", readOnly: true };
  assertEquals(Object.keys(mergeToolMeta({ a: m }, { b: m }, { c: m })).sort(), ["a", "b", "c"]);
  let msg = "";
  try { mergeToolMeta({ a: m }, { a: m }); } catch (e) { msg = (e as Error).message; }
  assertEquals(msg, "duplicate TOOL_META for a");
  msg = "";
  try { mergeToolMeta({ a: m }, { b: m }, { b: m }); } catch (e) { msg = (e as Error).message; }
  assertEquals(msg, "duplicate TOOL_META for b");
});

Deno.test("mcp-annotations: register passes the zod shape and description through", () => {
  const server = recordingServer();
  registerTools(server, allScopesDeps());
  const { config } = server.tools["list_clients"];
  assert(typeof config.description === "string" && config.description.length > 0);
  assert("status" in config.inputSchema, "inputSchema is the zod raw shape");
});

Deno.test("mcp-annotations: register throws for a tool without TOOL_META", () => {
  const server = recordingServer();
  let message = "";
  try {
    register(server, allScopesDeps(), "tool_sem_meta", "clientes:read", "x", {}, async () => ({}));
  } catch (e) {
    message = (e as Error).message;
  }
  assertEquals(message, "missing TOOL_META for tool_sem_meta");
  assertEquals(Object.keys(server.tools).length, 0);
});

Deno.test("mcp-annotations: opts.meta becomes _meta and resultMeta is attached to the result", async () => {
  const server = recordingServer();
  const seen: any[] = [];
  register(
    server, allScopesDeps(), "list_clients", "clientes:read", "d", {},
    async () => ({ ok: 1 }),
    undefined,
    {
      meta: { ui: { visibility: ["model"] } },
      resultMeta: async (args, data) => {
        seen.push([args, data]);
        return { "mesaas/x": "y" };
      },
    },
  );
  const { config, cb } = server.tools["list_clients"];
  assertEquals(config._meta, { ui: { visibility: ["model"] } });
  const res = await cb({ a: 1 });
  assertEquals(res._meta, { "mesaas/x": "y" });
  assertEquals(seen, [[{ a: 1 }, { ok: 1 }]]);
  assertEquals(JSON.parse(res.content[0].text), { ok: 1 });
});

Deno.test("mcp-annotations: an empty or undefined resultMeta adds no _meta", async () => {
  for (const rm of [async () => undefined, async () => ({})]) {
    const server = recordingServer();
    register(server, allScopesDeps(), "list_clients", "clientes:read", "d", {}, async () => ({}), undefined, { resultMeta: rm as any });
    const res = await server.tools["list_clients"].cb({});
    assert(!("_meta" in res));
  }
});

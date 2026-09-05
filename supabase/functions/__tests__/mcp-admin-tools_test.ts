import { assert, assertEquals } from "./assert.ts";
import { registerTools } from "../mcp-admin/tools.ts";
import { CTX, makeDeps, makeFakeDb } from "./mcp-admin-helpers.ts";

type Tool = { name: string; scope?: string; run: (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; isError?: boolean }> };

/** Servidor fake: captura (nome, callback) de cada server.tool(). */
function captureTools(deps: ReturnType<typeof makeDeps>) {
  const tools = new Map<string, Tool>();
  const server = { tool: (name: string, _desc: string, _shape: unknown, cb: Tool["run"]) => tools.set(name, { name, run: cb }) };
  registerTools(server, deps);
  return tools;
}

Deno.test("registerTools: registra as 18 tools do spec", () => {
  const tools = captureTools(makeDeps(makeFakeDb({}).db));
  assertEquals([...tools.keys()].sort(), [
    "create_banner", "create_kb_article", "create_popup", "get_banner", "get_dashboard", "get_kb_article", "get_popup", "get_workspace",
    "list_banners", "list_kb_articles", "list_plans", "list_popups", "list_workspaces",
    "update_banner", "update_kb_article", "update_popup", "upload_kb_image", "upload_popup_image",
  ]);
});

Deno.test("tool sem escopo → isError com a mensagem de permissão, sem tocar o banco", async () => {
  const { db, calls } = makeFakeDb({});
  const tools = captureTools(makeDeps(db, { ctx: { ...CTX, scopes: ["kb:read"] } }));
  const r = await tools.get("list_banners")!.run({});
  assertEquals(r.isError, true);
  assertEquals(JSON.parse(r.content[0].text), { error: "Permission denied: missing scope 'banners:read'." });
  assertEquals(calls.length, 0);
});

Deno.test("tool com sucesso → JSON no content e audit_log com resource_id do argumento", async () => {
  const { db, calls } = makeFakeDb({ global_banners: [{ data: { id: "b1", type: "info", status: "draft" }, error: null }], banner_dismissals: [{ data: [], error: null }] });
  const tools = captureTools(makeDeps(db));
  const r = await tools.get("get_banner")!.run({ banner_id: "b1" });
  assertEquals(r.isError, undefined);
  assertEquals(JSON.parse(r.content[0].text).banner.id, "b1");
  const audit = calls.find((c) => c.table === "audit_log" && c.method === "insert")!.args[0] as Record<string, unknown>;
  assertEquals(audit.action, "mcp_admin.get_banner");
  assertEquals(audit.resource_type, "mcp_admin");
  assertEquals(audit.resource_id, "b1");
  assertEquals(audit.actor_user_id, CTX.user_id);
  assertEquals(audit.conta_id, undefined);
  assertEquals((audit.metadata as Record<string, unknown>).key_id, CTX.key_id);
});

Deno.test("create → resource_id vem do id do resultado; args no audit sem payload", async () => {
  const { db, calls } = makeFakeDb({ global_banners: [{ data: { id: "b9", status: "draft" }, error: null }] });
  const tools = captureTools(makeDeps(db));
  await tools.get("create_banner")!.run({ type: "info", content: "segredo", target_mode: "all" });
  const audit = calls.find((c) => c.table === "audit_log" && c.method === "insert")!.args[0] as Record<string, unknown>;
  assertEquals(audit.resource_id, "b9");
  assert(!JSON.stringify(audit.metadata).includes("segredo"));
});

Deno.test("McpInputError → isError com a mensagem; erro interno → 'Internal error.'", async () => {
  const tools = captureTools(makeDeps(makeFakeDb({ global_banners: [{ data: null, error: null }] }).db));
  const r = await tools.get("get_banner")!.run({ banner_id: "zz" });
  assertEquals(JSON.parse(r.content[0].text), { error: "Banner não encontrado." });
  const boom = captureTools(makeDeps(makeFakeDb({ global_banners: [{ data: null, error: { message: "db down" } }] }).db));
  const r2 = await boom.get("get_banner")!.run({ banner_id: "b1" });
  assertEquals(JSON.parse(r2.content[0].text), { error: "Internal error." });
});

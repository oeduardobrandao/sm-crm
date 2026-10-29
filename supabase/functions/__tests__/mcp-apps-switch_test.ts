// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals } from "./assert.ts";
import { makeDeps, makeFakeDb } from "./mcp-financeiro-helpers.ts";
import { MCP_ALLOWED_SCOPES } from "../_shared/mcp-token.ts";
import { registerTools } from "../mcp/tools.ts";
import { cardResult } from "../mcp/register.ts";
import { appsEnabledFor, CARDS_MIME, CARDS_URI, r2OriginFrom, widgetOnly } from "../mcp/apps.ts";

const R2 = "https://x.r2.cloudflarestorage.com";

/** Recording fake of McpServer: registerTool(name, config, cb) and registerResource(name, uri, config, read). */
function recordingServer() {
  const tools: Record<string, { config: any; cb: (args: any) => Promise<any> }> = {};
  const resources: Array<{ name: string; uri: string; config: any; read: (...a: any[]) => Promise<any> }> = [];
  return {
    tools,
    resources,
    registerTool(name: string, config: any, cb: any) {
      tools[name] = { config, cb };
    },
    registerResource(name: string, uri: string, config: any, read: any) {
      resources.push({ name, uri, config, read });
    },
  };
}

function depsWith(apps?: { enabled: boolean; oauth: boolean; r2Origin: string | null }) {
  const { db } = makeFakeDb({});
  const deps = makeDeps(db, { scopes: [...MCP_ALLOWED_SCOPES], role: "owner" });
  return apps ? { ...deps, apps } : deps;
}

// Today's 49 tool names, sorted. Cards off must not change this list.
const BASELINE = [
  "confirmar_agendamento", "create_client", "create_lancamento", "create_media_upload", "create_member",
  "create_post", "create_recorrente", "create_task", "create_workflow", "create_workflow_template",
  "delete_funcao", "delete_lancamento", "encerrar_recorrente", "fechar_periodo", "get_acordo_versoes",
  "get_brand_profile", "get_client", "get_cliente_versoes", "get_cobrancas", "get_financeiro_v2",
  "get_performance_baseline", "get_post", "get_rentabilidade", "list_clients", "list_ideas",
  "list_lancamentos", "list_members", "list_pages", "list_post_feedback", "list_posts",
  "list_recorrentes", "list_tasks", "list_workflow_templates", "list_workflows", "reabrir_periodo",
  "save_acordo", "save_atribuicoes", "save_entregas", "save_financeiro_config", "save_funcao",
  "seed_financeiro_v2", "set_cobranca_cliente", "set_custo_membro", "set_post_media", "set_post_property",
  "update_lancamento", "update_post", "update_recorrente", "update_task",
];

Deno.test("appsEnabledFor: off by default and for anything but on / pilot + list", () => {
  assertEquals(appsEnabledFor("a", {}), false);
  assertEquals(appsEnabledFor("a", { MCP_APPS: undefined }), false);
  assertEquals(appsEnabledFor("a", { MCP_APPS: "on" }), true);
  assertEquals(appsEnabledFor("a", { MCP_APPS: "off" }), false);
  assertEquals(appsEnabledFor("a", { MCP_APPS: "ON" }), false);
  assertEquals(appsEnabledFor("a", { MCP_APPS: "yes" }), false);
  assertEquals(appsEnabledFor("a", { MCP_APPS: "pilot" }), false);
  assertEquals(appsEnabledFor("a", { MCP_APPS: "pilot", MCP_APPS_PILOT_CONTAS: "" }), false);
  assertEquals(appsEnabledFor("b", { MCP_APPS: "pilot", MCP_APPS_PILOT_CONTAS: "a, b" }), true);
  assertEquals(appsEnabledFor("a", { MCP_APPS: "pilot", MCP_APPS_PILOT_CONTAS: "a, b" }), true);
  assertEquals(appsEnabledFor("c", { MCP_APPS: "pilot", MCP_APPS_PILOT_CONTAS: "a, b" }), false);
  assertEquals(appsEnabledFor("", { MCP_APPS: "pilot", MCP_APPS_PILOT_CONTAS: "a,," }), false);
});

Deno.test("r2OriginFrom builds the R2 S3 origin or null", () => {
  assertEquals(r2OriginFrom("abc123"), "https://abc123.r2.cloudflarestorage.com");
  assertEquals(r2OriginFrom(undefined), null);
  assertEquals(r2OriginFrom(""), null);
});

Deno.test("widgetOnly needs cards on AND an OAuth connection", () => {
  const base = depsWith();
  assertEquals(widgetOnly(base), false);
  assertEquals(widgetOnly({ ...base, apps: { enabled: true, oauth: true, r2Origin: null } }), true);
  assertEquals(widgetOnly({ ...base, apps: { enabled: true, oauth: false, r2Origin: null } }), false);
  assertEquals(widgetOnly({ ...base, apps: { enabled: false, oauth: true, r2Origin: null } }), false);
});

Deno.test("cardResult: summary text, structuredContent, optional _meta", () => {
  assertEquals(cardResult("Pronto.", { card: "x", v: 1 }), {
    content: [{ type: "text", text: "Pronto." }],
    structuredContent: { card: "x", v: 1 },
  });
  assertEquals(cardResult("Pronto.", { card: "x" }, { "mesaas/a": 1 }), {
    content: [{ type: "text", text: "Pronto." }],
    structuredContent: { card: "x" },
    _meta: { "mesaas/a": 1 },
  });
});

Deno.test("off: tool list identical to baseline", () => {
  assertEquals(BASELINE.length, 49);
  const server = recordingServer();
  registerTools(server, depsWith({ enabled: false, oauth: true, r2Origin: R2 }));
  assertEquals(Object.keys(server.tools).sort(), BASELINE);
  assertEquals(server.resources.length, 0);
  // Same with no `apps` at all.
  const bare = recordingServer();
  registerTools(bare, depsWith());
  assertEquals(Object.keys(bare.tools).sort(), BASELINE);
  assertEquals(bare.resources.length, 0);
});

Deno.test("on: resource registered with the exact _meta", async () => {
  const server = recordingServer();
  registerTools(server, depsWith({ enabled: true, oauth: false, r2Origin: R2 }));
  assertEquals(server.resources.length, 1);
  const r = server.resources[0];
  assertEquals(r.name, "mesaas-cards");
  assertEquals(r.uri, CARDS_URI);
  assertEquals(r.uri, "ui://mesaas/cards-v1.html");
  assertEquals(r.config.mimeType, CARDS_MIME);
  assertEquals(r.config.mimeType, "text/html;profile=mcp-app");
  const ui = r.config._meta.ui;
  assertEquals(ui.prefersBorder, false);
  assertEquals(ui.csp.connectDomains, []);
  assertEquals(ui.csp.resourceDomains, [R2]);
  assert(!("domain" in ui), "no _meta.ui.domain");
  assertEquals(r.config._meta["openai/widgetDomain"], "https://www.mesaas.com.br");
  const out = await r.read();
  assertEquals(out.contents.length, 1);
  assertEquals(out.contents[0].uri, CARDS_URI);
  assertEquals(out.contents[0].mimeType, CARDS_MIME);
  assertEquals(typeof out.contents[0].text, "string");
  assertEquals(out.contents[0]._meta, r.config._meta);
});

Deno.test("on with no R2 account: resourceDomains is empty", () => {
  const server = recordingServer();
  registerTools(server, depsWith({ enabled: true, oauth: false, r2Origin: null }));
  assertEquals(server.resources[0].config._meta.ui.csp.resourceDomains, []);
});

Deno.test({
  name: "widget-only tools need oauth",
  fn() {
    const WIDGET_ONLY = ["send_post_to_client", "attach_image_to_post"];
    const plain = recordingServer();
    registerTools(plain, depsWith({ enabled: true, oauth: false, r2Origin: R2 }));
    for (const n of WIDGET_ONLY) assert(!(n in plain.tools), `${n} must not register without oauth`);
    const oauth = recordingServer();
    registerTools(oauth, depsWith({ enabled: true, oauth: true, r2Origin: R2 }));
    for (const n of WIDGET_ONLY) assert(n in oauth.tools, `${n} registers with oauth`);
  },
});

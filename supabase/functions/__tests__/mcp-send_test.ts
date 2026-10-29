// deno-lint-ignore-file no-explicit-any
import { z } from "npm:zod@3";
import { assert, assertEquals } from "./assert.ts";
import { makeDeps, makeFakeDb, rpcArgs } from "./mcp-financeiro-helpers.ts";
import type { Call, Resp } from "./mcp-financeiro-helpers.ts";
import { registerTools } from "../mcp/tools.ts";
import { SEND_TOOL_META } from "../mcp/send.ts";
import { signSendNonce, verifySendNonce } from "../_shared/mcp-send-nonce.ts";

const SECRET = "test-secret-key-for-send-nonce-32chars!";
// Other test modules set TOKEN_ENCRYPTION_KEY at load too; pin ours right before each registration.
const pinSecret = () => Deno.env.set("TOKEN_ENCRYPTION_KEY", SECRET);

/** Recording fake of McpServer that validates args with the tool's zod shape before calling the
 * handler (the SDK does this in production; calling handlers directly would skip the enum). */
function recordingServer() {
  const tools: Record<string, { config: any; cb: (args: any) => Promise<any> }> = {};
  return {
    tools,
    registerTool(name: string, config: any, cb: any) {
      tools[name] = {
        config,
        cb: (args: any) => {
          const parsed = z.object(config.inputSchema).safeParse(args);
          if (!parsed.success) {
            return Promise.resolve({ isError: true, content: [{ type: "text", text: parsed.error.message }] });
          }
          return cb(parsed.data);
        },
      };
    },
    registerResource() {},
  };
}

const CONTA = "workspace-A";
const USER = "user-1";
const OAUTH = { enabled: true, oauth: true, r2Origin: null };

function setup(
  responses: Record<string, Resp[]> = {},
  rpc: Record<string, Resp[]> = {},
  opts: { apps?: typeof OAUTH | undefined; key_id?: string } = { apps: OAUTH },
) {
  pinSecret();
  const { db, calls } = makeFakeDb(responses, rpc);
  const apps = "apps" in opts ? opts.apps : OAUTH;
  const key_id = opts.key_id ?? (apps?.oauth ? "oauth:client-x" : "mesaas_sk_key");
  const deps = {
    ...makeDeps(db, { scopes: ["posts:read", "posts:write"], role: "agent", key_id, conta_id: CONTA, created_by: USER }),
    ...(apps ? { apps } : {}),
  };
  const server = recordingServer();
  registerTools(server, deps);
  return { server, calls };
}

const nonceFor = (post_id: number, extra: Partial<{ conta_id: string; user_id: string }> = {}, now = Date.now()) =>
  signSendNonce(SECRET, { conta_id: CONTA, user_id: USER, post_id, ...extra }, now);

const rpcCalls = (calls: Call[]) => calls.filter((c) => c.table === "rpc:mcp_send_post_to_client");
const errorText = (res: any) => JSON.parse(res.content[0].text).error;
const auditRow = (calls: Call[]) => calls.find((c) => c.table === "audit_log" && c.method === "insert")?.args[0] as any;
const NO_MEDIA = { data: [], error: null };

const EXPIRED = "Este cartão expirou. Peça ao agente para mostrar o post de novo.";

Deno.test("SEND_TOOL_META", () => {
  assertEquals(SEND_TOOL_META, { send_post_to_client: { title: "Enviar post ao cliente", readOnly: false, openWorld: true } });
});

Deno.test("send_post_to_client: registered only with apps on + OAuth, app-only visibility, posts:write", () => {
  const on = setup();
  const tool = on.server.tools.send_post_to_client;
  assert(tool, "registered with apps on + oauth");
  assertEquals(tool.config._meta, { ui: { resourceUri: "ui://mesaas/cards-v1.html", visibility: ["app"] } });
  assertEquals(tool.config.annotations.openWorldHint, true);
  assertEquals(tool.config.annotations.readOnlyHint, false);

  assert(!setup({}, {}, { apps: { enabled: true, oauth: false, r2Origin: null }, key_id: "mesaas_sk_abc" }).server.tools.send_post_to_client, "mesaas_sk_ key");
  assert(!setup({}, {}, { apps: { enabled: false, oauth: true, r2Origin: null } }).server.tools.send_post_to_client, "apps off");
  assert(!setup({}, {}, { apps: undefined }).server.tools.send_post_to_client, "no apps");
});

Deno.test("send_post_to_client: missing posts:write scope is refused before any read", async () => {
  const { db, calls } = makeFakeDb({});
  const deps = { ...makeDeps(db, { scopes: ["posts:read"], key_id: "oauth:x", conta_id: CONTA, created_by: USER }), apps: OAUTH };
  pinSecret();
  const server = recordingServer();
  registerTools(server, deps);
  const res = await server.tools.send_post_to_client.cb({ post_id: 7, expected_status: "rascunho", nonce: await nonceFor(7) });
  assertEquals(res.isError, true);
  assertEquals(rpcCalls(calls).length, 0);
});

Deno.test("send_post_to_client: bad nonce -> expired-card message, no media read and no RPC", async () => {
  const cases: [string, string][] = [
    ["garbage", "garbage"],
    ["another post", await nonceFor(8)],
    ["another user", await nonceFor(7, { user_id: "user-2" })],
    ["another workspace", await nonceFor(7, { conta_id: "workspace-B" })],
    ["expired", await nonceFor(7, {}, Date.now() - 31 * 60 * 1000)],
  ];
  for (const [label, nonce] of cases) {
    const { server, calls } = setup({}, { mcp_send_post_to_client: [{ data: "sent", error: null }] });
    const res = await server.tools.send_post_to_client.cb({ post_id: 7, expected_status: "rascunho", nonce });
    assertEquals(res.isError, true, label);
    assertEquals(errorText(res), EXPIRED, label);
    assertEquals(rpcCalls(calls).length, 0, `${label}: RPC never called`);
    assert(!calls.some((c) => c.table === "post_file_links"), `${label}: no media read`);
    assert(!auditRow(calls), `${label}: refused call is not audited as a send`);
  }
});

Deno.test("send_post_to_client: each RPC outcome maps to its message and send_result card", async () => {
  const MESSAGES: Record<string, string> = {
    sent: "Post enviado ao cliente para aprovação.",
    already_sent: "Este post já está com o cliente.",
    approved: "O cliente já aprovou este post.",
    failed: "A publicação deste post falhou. Resolva no Mesaas antes de enviar de novo.",
    stale: "O post mudou no Mesaas. Atualize o cartão.",
  };
  for (const [outcome, message] of Object.entries(MESSAGES)) {
    const { server, calls } = setup({ post_file_links: [NO_MEDIA] }, { mcp_send_post_to_client: [{ data: outcome, error: null }] });
    const res = await server.tools.send_post_to_client.cb({ post_id: 7, expected_status: "aprovado_interno", nonce: await nonceFor(7) });
    assert(!res.isError, outcome);
    assertEquals(res.content, [{ type: "text", text: message }], outcome);
    assertEquals(res.structuredContent, { card: "send_result", v: 1, post_id: 7, outcome }, outcome);
    assert(!("_meta" in res), `${outcome}: no result _meta`);
    assertEquals(rpcCalls(calls).length, 1);
    assertEquals(rpcArgs(calls, "mcp_send_post_to_client"), {
      p_conta_id: CONTA, p_post_id: 7, p_expected_status: "aprovado_interno", p_actor: USER,
    });
    // Media read is scoped by workspace and post.
    assert(calls.some((c) => c.table === "post_file_links" && c.method === "eq" && c.args[0] === "conta_id" && c.args[1] === CONTA));
    assert(calls.some((c) => c.table === "post_file_links" && c.method === "eq" && c.args[0] === "post_id" && c.args[1] === 7));
    const audit = auditRow(calls);
    assertEquals(audit.action, "mcp.send_post_to_client");
    assertEquals(audit.metadata.args, { post_id: 7, expected_status: "aprovado_interno", outcome });
  }
});

Deno.test("send_post_to_client: audit row never carries the nonce", async () => {
  const nonce = await nonceFor(7);
  const { server, calls } = setup({ post_file_links: [NO_MEDIA] }, { mcp_send_post_to_client: [{ data: "sent", error: null }] });
  await server.tools.send_post_to_client.cb({ post_id: 7, expected_status: "rascunho", nonce });
  const audit = auditRow(calls);
  assert(audit, "audited");
  assert(!("nonce" in audit.metadata.args), "no nonce key");
  assert(!JSON.stringify(audit).includes(nonce), "nonce value nowhere in the row");
});

Deno.test("send_post_to_client: expected_status outside the allowed list is rejected by zod", async () => {
  for (const status of ["enviado_cliente", "aprovado_cliente", "postado", "falha_publicacao", "agendado"]) {
    const { server, calls } = setup({}, { mcp_send_post_to_client: [{ data: "sent", error: null }] });
    const res = await server.tools.send_post_to_client.cb({ post_id: 7, expected_status: status, nonce: await nonceFor(7) });
    assertEquals(res.isError, true, status);
    assertEquals(rpcCalls(calls).length, 0, status);
  }
  const { server } = setup({}, {});
  assertEquals((await server.tools.send_post_to_client.cb({ post_id: 7, expected_status: "rascunho" })).isError, true, "nonce required");
});

Deno.test("send_post_to_client: video without cover -> cover message, RPC not called", async () => {
  const { server, calls } = setup(
    { post_file_links: [{ data: [{ files: { kind: "image", thumbnail_r2_key: null } }, { files: { kind: "video", thumbnail_r2_key: null } }], error: null }] },
    { mcp_send_post_to_client: [{ data: "sent", error: null }] },
  );
  const res = await server.tools.send_post_to_client.cb({ post_id: 7, expected_status: "rascunho", nonce: await nonceFor(7) });
  assertEquals(res.isError, true);
  assertEquals(errorText(res), "Este vídeo está sem capa. Adicione a capa no Mesaas antes de enviar.");
  assertEquals(rpcCalls(calls).length, 0);
});

Deno.test("send_post_to_client: video with cover and images without thumbnail are fine", async () => {
  const { server, calls } = setup(
    { post_file_links: [{ data: [{ files: { kind: "image", thumbnail_r2_key: null } }, { files: { kind: "video", thumbnail_r2_key: "t.jpg" } }], error: null }] },
    { mcp_send_post_to_client: [{ data: "sent", error: null }] },
  );
  const res = await server.tools.send_post_to_client.cb({ post_id: 7, expected_status: "rascunho", nonce: await nonceFor(7) });
  assert(!res.isError);
  assertEquals(rpcCalls(calls).length, 1);
});

Deno.test("send_post_to_client: media read error, RPC error, workspace_unavailable and unknown outcome -> generic message", async () => {
  const GENERIC = "Não foi possível enviar o post ao cliente agora. Tente de novo ou envie pelo Mesaas.";
  const media = await (async () => {
    const { server, calls } = setup({ post_file_links: [{ data: null, error: { message: "boom" } }] }, { mcp_send_post_to_client: [{ data: "sent", error: null }] });
    const res = await server.tools.send_post_to_client.cb({ post_id: 7, expected_status: "rascunho", nonce: await nonceFor(7) });
    return { res, calls };
  })();
  assertEquals(media.res.isError, true);
  assertEquals(errorText(media.res), GENERIC);
  assertEquals(rpcCalls(media.calls).length, 0, "no send when the media read fails");

  const rpcErrors: Resp[] = [
    { data: null, error: { code: "P0403", message: "workspace_unavailable" } },
    { data: null, error: { code: "XX000", message: "connection reset by peer at 10.0.0.1" } },
    { data: "something_else", error: null },
    { data: null, error: null },
  ];
  for (const r of rpcErrors) {
    const { server } = setup({ post_file_links: [NO_MEDIA] }, { mcp_send_post_to_client: [r] });
    const res = await server.tools.send_post_to_client.cb({ post_id: 7, expected_status: "rascunho", nonce: await nonceFor(7) });
    assertEquals(res.isError, true, JSON.stringify(r));
    assertEquals(errorText(res), GENERIC, JSON.stringify(r));
    assert(!res.content[0].text.includes("workspace_unavailable") && !res.content[0].text.includes("10.0.0.1"), "no raw error");
  }
});

// ---- nonce on create_post / update_post / preview_post results ----------------------------------

const CREATED = { data: { id: 99, workflow_id: null, cliente_id: 5, titulo: "T", tipo: "feed", status: "rascunho" }, error: null };

async function createPostRes(opts: { apps?: typeof OAUTH | undefined; key_id?: string }) {
  const { server, calls } = setup({ clientes: [{ data: { id: 5 }, error: null }], workflow_posts: [{ data: null, error: null }, CREATED] }, {}, opts);
  const res = await server.tools.create_post.cb({ cliente_id: 5, titulo: "T" });
  return { res, calls };
}

Deno.test("create_post: _meta sendNonce for the created post only with apps on + OAuth", async () => {
  const { res } = await createPostRes({ apps: OAUTH });
  assert(!res.isError);
  const nonce = res._meta?.["mesaas/sendNonce"];
  assert(typeof nonce === "string", "nonce present");
  assertEquals(await verifySendNonce(SECRET, nonce, { conta_id: CONTA, user_id: USER, post_id: 99 }), true);
  assert(!res.content[0].text.includes(nonce), "nonce is not in the model-visible text");

  for (const opts of [
    { apps: { enabled: true, oauth: false, r2Origin: null }, key_id: "mesaas_sk_abc" },
    { apps: { enabled: false, oauth: true, r2Origin: null } },
    { apps: undefined },
  ]) {
    const { res: r } = await createPostRes(opts);
    assert(!r.isError);
    assert(!("_meta" in r), `no _meta for ${JSON.stringify(opts)}`);
  }
});

Deno.test("create_post: audit row carries no nonce", async () => {
  const { res, calls } = await createPostRes({ apps: OAUTH });
  const nonce = res._meta["mesaas/sendNonce"];
  assert(!JSON.stringify(auditRow(calls)).includes(nonce));
});

Deno.test("update_post: _meta sendNonce for post_id only with apps on + OAuth", async () => {
  const run = async (opts: { apps?: typeof OAUTH | undefined; key_id?: string }) => {
    const { server } = setup({
      workflow_posts: [{ data: { id: 12, status: "rascunho" }, error: null }, { data: { id: 12, status: "rascunho", titulo: "N" }, error: null }],
    }, {}, opts);
    return await server.tools.update_post.cb({ post_id: 12, titulo: "N" });
  };
  const res = await run({ apps: OAUTH });
  assert(!res.isError);
  assertEquals(await verifySendNonce(SECRET, res._meta["mesaas/sendNonce"], { conta_id: CONTA, user_id: USER, post_id: 12 }), true);
  const off = await run({ apps: { enabled: true, oauth: false, r2Origin: null }, key_id: "mesaas_sk_abc" });
  assert(!off.isError);
  assert(!("_meta" in off));
});

Deno.test("preview_post: _meta sendNonce only with post_id and apps on + OAuth", async () => {
  const CLIENT = { data: { id: 5, nome: "Clínica Aurora" }, error: null };
  const base = { client_id: 5, titulo: "T", tipo: "feed", ig_caption: "x" };
  {
    const { server } = setup({ clientes: [CLIENT], workflow_posts: [{ data: { id: 12, cliente_id: 5 }, error: null }] });
    const res = await server.tools.preview_post.cb({ ...base, post_id: 12 });
    assert(!res.isError);
    assertEquals(await verifySendNonce(SECRET, res._meta["mesaas/sendNonce"], { conta_id: CONTA, user_id: USER, post_id: 12 }), true);
    assert(!JSON.stringify(res.structuredContent).includes(res._meta["mesaas/sendNonce"]), "nonce not in structuredContent");
  }
  {
    const { server } = setup({ clientes: [CLIENT] });
    const res = await server.tools.preview_post.cb(base);
    assert(!res.isError);
    assert(!("_meta" in res), "no post_id -> no nonce");
  }
  {
    // Apps on without OAuth: the card renders but there is no send tool, so no nonce.
    const { server } = setup({ clientes: [CLIENT], workflow_posts: [{ data: { id: 12, cliente_id: 5 }, error: null }] }, {}, {
      apps: { enabled: true, oauth: false, r2Origin: null }, key_id: "mesaas_sk_abc",
    });
    const res = await server.tools.preview_post.cb({ ...base, post_id: 12 });
    assert(!res.isError);
    assert(!("_meta" in res));
  }
});

Deno.test("missing TOKEN_ENCRYPTION_KEY: registration throws with apps on + OAuth (before any write), not otherwise", () => {
  const register = (apps: typeof OAUTH | undefined, key_id: string) => {
    const { db, calls } = makeFakeDb({});
    const deps = { ...makeDeps(db, { scopes: ["posts:read", "posts:write"], key_id }), ...(apps ? { apps } : {}) };
    const server = recordingServer();
    registerTools(server, deps);
    return { server, calls };
  };
  Deno.env.delete("TOKEN_ENCRYPTION_KEY");
  try {
    let message = "";
    try { register(OAUTH, "oauth:x"); } catch (e) { message = (e as Error).message; }
    assert(message.includes("TOKEN_ENCRYPTION_KEY"), `throws: ${message}`);
    // Without widget-only tools the key is not needed.
    assert(register({ enabled: true, oauth: false, r2Origin: null }, "mesaas_sk_abc").server.tools.create_post);
    assert(register(undefined, "mesaas_sk_abc").server.tools.create_post);
  } finally {
    pinSecret();
  }
});

Deno.test("create_post/update_post descriptions: the agent does not send alone; a click in the card sends", () => {
  const { server } = setup();
  for (const name of ["create_post", "update_post"]) {
    const d: string = server.tools[name].config.description;
    assert(d.includes("O agente não envia sozinho ao cliente; um clique do usuário no cartão envia."), `${name}: ${d}`);
    assert(d.includes("não envia sozinho"), name);
    assert(!d.includes("nunca envia"), `${name}: old wording gone`);
    assert(!d.includes("—"), `${name}: no em dash`);
  }
});

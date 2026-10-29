// deno-lint-ignore-file no-explicit-any
// show_attach_image + attach_image_to_post (MCP Apps cards, spec §4.6). The recording server
// parses args through zod like the SDK does, so the limit tests mean something.
import { z } from "npm:zod@3";
import { assert, assertEquals } from "./assert.ts";
import { type Call, insertPayload, makeDeps, makeFakeDb, type Resp, rpcArgs } from "./mcp-financeiro-helpers.ts";
import { allowedImageHost, registerAttachTools } from "../mcp/attach.ts";
import { appOnlyToolMeta, cardToolMeta } from "../mcp/apps.ts";

const HOST = "files.oaiusercontent.com";
const URL_OK = `https://${HOST}/file-abc?sig=secret-token`;

const u32be = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const PNG_3x2 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ...u32be(13), 0x49, 0x48, 0x44, 0x52, ...u32be(3), ...u32be(2), 8, 6, 0, 0, 0,
  0, 0, 0, 0,
]);
const WEBP = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 88, 10, 0, 0, 0, 0, 0, 0, 0, 15, 0, 0, 7, 0, 0]);

function recordingServer() {
  const tools: Record<string, { config: any; call: (args: any) => Promise<any> }> = {};
  return {
    tools,
    registerTool(name: string, config: any, cb: (args: any) => Promise<any>) {
      tools[name] = {
        config,
        call: async (args: any) => {
          const parsed = z.object(config.inputSchema).safeParse(args);
          if (!parsed.success) return { isError: true, zod: parsed.error };
          return await cb(parsed.data);
        },
      };
    },
    registerResource() {},
  };
}

type Net = { dns: string[]; fetches: Array<{ url: string; init: RequestInit }> };

function setup(opts: {
  tables?: Record<string, Resp[]>;
  rpc?: Record<string, Resp[]>;
  body?: Uint8Array;
  contentType?: string;
  ip?: string;
  oauth?: boolean;
  putStatus?: number;
  putThrows?: boolean;
  quota?: number | null;
} = {}) {
  const { db, calls } = makeFakeDb(opts.tables ?? {}, opts.rpc ?? {});
  const net: Net = { dns: [], fetches: [] };
  const signed: string[] = [];
  const deps = {
    ...makeDeps(db, { scopes: ["posts:read", "posts:write"], key_id: opts.oauth === false ? "mesaas_sk_1" : "oauth:g1" }),
    apps: { enabled: true, oauth: opts.oauth !== false, r2Origin: null },
    randomUUID: () => "uuid-1",
    signUrl: (k: string) => Promise.resolve(`signed:${k}`),
    signPutUrl: (k: string, mime: string, size: number) => {
      signed.push(`${k}|${mime}|${size}`);
      return Promise.resolve(`https://r2.example/put/${k}?X-Amz-Signature=sig123&X-Amz-Credential=cred`);
    },
    storageQuota: () => Promise.resolve(opts.quota === undefined ? null : opts.quota),
    resolveDns: (host: string, type: "A" | "AAAA") => {
      net.dns.push(`${host}/${type}`);
      return Promise.resolve(type === "A" ? [opts.ip ?? "93.184.216.34"] : []);
    },
    fetchUrl: (url: string, init: RequestInit) => {
      net.fetches.push({ url, init });
      if (init.method === "PUT") {
        // Deno's fetch errors embed the full request URL, signature included.
        if (opts.putThrows) return Promise.reject(new TypeError(`error sending request for url (${url})`));
        return Promise.resolve(new Response(null, { status: opts.putStatus ?? 200 }));
      }
      return Promise.resolve(
        new Response(opts.body ?? PNG_3x2, { headers: { "content-type": opts.contentType ?? "image/png" } }),
      );
    },
  } as any;
  const server = recordingServer();
  registerAttachTools(server, deps);
  return { server, calls, net, signed };
}

const post = (over: Record<string, unknown> = {}) => ({
  data: {
    id: 10, titulo: "Skincare", tipo: "carrossel", status: "rascunho", cliente_id: 7,
    published_at: null, instagram_media_id: null, instagram_container_id: null,
    publish_processing_at: null, tiktok_publish_processing_at: null, tiktok_publish_status: null,
    ...over,
  },
  error: null,
});
const links = (n: number) => ({
  data: Array.from({ length: n }, (_, i) => ({ sort_order: i, files: { r2_key: `contas/workspace-A/files/old-${i}.jpg` } })),
  error: null,
});
const client = { data: { id: 7, nome: "Clínica Sol" }, error: null };

const attachArgs = (over: Record<string, unknown> = {}) => ({
  post_id: 10, image: { download_url: URL_OK, file_id: "file-abc" }, position: 2, replace: false, ...over,
});

function errorText(res: any): string {
  return JSON.parse(res.content[0].text).error;
}
const puts = (net: Net) => net.fetches.filter((f) => f.init.method === "PUT");
const gets = (net: Net) => net.fetches.filter((f) => f.init.method !== "PUT");
const rpcCalled = (calls: Call[]) => calls.some((c) => c.table === "rpc:mcp_attach_post_file");

function withHosts(value: string | undefined, fn: () => Promise<void>) {
  return async () => {
    const prev = Deno.env.get("MCP_IMAGE_HOSTS");
    if (value === undefined) Deno.env.delete("MCP_IMAGE_HOSTS");
    else Deno.env.set("MCP_IMAGE_HOSTS", value);
    try {
      await fn();
    } finally {
      if (prev === undefined) Deno.env.delete("MCP_IMAGE_HOSTS");
      else Deno.env.set("MCP_IMAGE_HOSTS", prev);
    }
  };
}

// ---- allowedImageHost --------------------------------------------------------------------------

Deno.test("allowedImageHost: empty or missing list refuses every host", () => {
  assertEquals(allowedImageHost(URL_OK, undefined), false);
  assertEquals(allowedImageHost(URL_OK, ""), false);
  assertEquals(allowedImageHost(URL_OK, " , "), false);
});

Deno.test("allowedImageHost: exact hostname only, trimmed and case-insensitive", () => {
  assertEquals(allowedImageHost("https://files.example/a.png", "files.example"), true);
  assertEquals(allowedImageHost("https://FILES.example/a.png", " other.example , Files.Example "), true);
  assertEquals(allowedImageHost("https://evil-files.example/a.png", "files.example"), false);
  assertEquals(allowedImageHost("https://files.example.evil.test/a.png", "files.example"), false);
  assertEquals(allowedImageHost("https://sub.files.example/a.png", "files.example"), false);
  assertEquals(allowedImageHost("not a url", "files.example"), false);
});

// ---- attach_image_to_post: refusals before any upload ------------------------------------------

Deno.test("attach: host not allowlisted → refused before DNS or fetch", withHosts("other.example", async () => {
  const { server, calls, net, signed } = setup({ tables: { workflow_posts: [post()], post_file_links: [links(1)] } });
  const res = await server.tools.attach_image_to_post.call(attachArgs());
  assertEquals(res.isError, true);
  assertEquals(errorText(res), "Não foi possível baixar esta imagem. Envie de novo pelo chat.");
  assertEquals(net.dns, []);
  assertEquals(net.fetches, []);
  assertEquals(signed, []);
  assert(!rpcCalled(calls));
}));

Deno.test("attach: download_url resolving to 10.0.0.1 → refused, nothing fetched", withHosts(HOST, async () => {
  const { server, calls, net, signed } = setup({ ip: "10.0.0.1", tables: { workflow_posts: [post()], post_file_links: [links(1)] } });
  const res = await server.tools.attach_image_to_post.call(attachArgs());
  assertEquals(errorText(res), "Não foi possível baixar esta imagem. Envie de novo pelo chat.");
  assert(net.dns.length > 0, "DNS was consulted");
  assertEquals(net.fetches, []);
  assertEquals(signed, []);
  assert(!rpcCalled(calls));
}));

Deno.test("attach: WebP bytes → format message, no PUT and no RPC", withHosts(HOST, async () => {
  const { server, calls, net, signed } = setup({
    body: WEBP, contentType: "image/webp", tables: { workflow_posts: [post()], post_file_links: [links(1)] },
  });
  const res = await server.tools.attach_image_to_post.call(attachArgs());
  assertEquals(errorText(res), "Formato não aceito. Use JPG ou PNG.");
  assertEquals(gets(net).length, 1);
  assertEquals(puts(net), []);
  assertEquals(signed, []);
  assert(!rpcCalled(calls));
}));

Deno.test("attach: response that is not an image → format message", withHosts(HOST, async () => {
  const { server, net } = setup({ contentType: "text/html", tables: { workflow_posts: [post()], post_file_links: [links(1)] } });
  const res = await server.tools.attach_image_to_post.call(attachArgs());
  assertEquals(errorText(res), "Formato não aceito. Use JPG ou PNG.");
  assertEquals(puts(net), []);
}));

Deno.test("attach: 8 MB + 1 byte → size message, no PUT and no RPC", withHosts(HOST, async () => {
  const big = new Uint8Array(8 * 1024 * 1024 + 1);
  big.set(PNG_3x2);
  const { server, calls, net, signed } = setup({ body: big, tables: { workflow_posts: [post()], post_file_links: [links(1)] } });
  const res = await server.tools.attach_image_to_post.call(attachArgs());
  assertEquals(errorText(res), "A imagem passa de 8 MB. Gere uma versão menor.");
  assertEquals(puts(net), []);
  assertEquals(signed, []);
  assert(!rpcCalled(calls));
}));

Deno.test("attach: quota precheck refuses before the PUT", withHosts(HOST, async () => {
  const { server, calls, net } = setup({
    quota: 100,
    tables: { workflow_posts: [post()], post_file_links: [links(1)], workspaces: [{ data: { storage_used_bytes: 90 }, error: null }] },
  });
  const res = await server.tools.attach_image_to_post.call(attachArgs());
  assertEquals(errorText(res), "Cota de armazenamento excedida. Libere espaço em Arquivos.");
  assertEquals(puts(net), []);
  assert(!rpcCalled(calls));
}));

Deno.test("attach: ineligible post refused before any fetch", withHosts(HOST, async () => {
  const cases: Array<[Resp, Resp, Record<string, unknown>, string]> = [
    [{ data: null, error: null }, links(0), {}, "Post não encontrado neste workspace."],
    [post({ status: "aprovado_cliente" }), links(1), {}, "Este post está com o cliente. Volte para rascunho no Mesaas para mudar as imagens."],
    [post({ status: "agendado" }), links(1), {}, "Este post não está em edição. Volte para rascunho no Mesaas para mudar as imagens."],
    [post({ instagram_media_id: "17890" }), links(1), {}, "Este post já foi publicado. As imagens não podem mais ser trocadas por aqui."],
    [post({ tipo: "reels" }), links(1), {}, "Posts do tipo reels não recebem imagens."],
    [post(), links(10), { position: 3 }, "Este post já tem 10 mídias. Substitua uma lâmina."],
    [post(), links(2), { position: 5 }, "Esta lâmina não existe neste post. Escolha uma lâmina de 1 a 3."],
    [post(), links(2), { position: 3, replace: true }, "Esta lâmina não existe neste post. Escolha uma lâmina de 1 a 2."],
    [post(), links(0), { position: 1, replace: true }, "Este post ainda não tem lâminas. Adicione a imagem como nova lâmina."],
  ];
  for (const [p, l, over, msg] of cases) {
    const { server, net, calls } = setup({ tables: { workflow_posts: [p], post_file_links: [l] } });
    const res = await server.tools.attach_image_to_post.call(attachArgs(over));
    assertEquals(errorText(res), msg);
    assertEquals(net.fetches, [], msg);
    assert(!rpcCalled(calls), msg);
  }
}));

// ---- attach_image_to_post: upload + RPC ---------------------------------------------------------

Deno.test("attach: success uploads to contas/<conta>/files/<uuid>.png and calls the RPC once", withHosts(HOST, async () => {
  const { server, calls, net, signed } = setup({
    tables: { workflow_posts: [post()], post_file_links: [links(1)] },
    rpc: { mcp_attach_post_file: [{ data: { link_id: 5, file_id: 9, sort_order: 1, is_cover: false, tipo: "carrossel" }, error: null }] },
  });
  const res = await server.tools.attach_image_to_post.call(attachArgs());
  assert(!res.isError, JSON.stringify(res));
  const key = "contas/workspace-A/files/uuid-1.png";
  assertEquals(signed, [`${key}|image/png|${PNG_3x2.byteLength}`]);
  assertEquals(puts(net).length, 1);
  const put = puts(net)[0];
  assertEquals(put.url, `https://r2.example/put/${key}?X-Amz-Signature=sig123&X-Amz-Credential=cred`);
  assertEquals((put.init.headers as Record<string, string>)["Content-Type"], "image/png");
  assert(put.init.signal instanceof AbortSignal);
  assertEquals(rpcArgs(calls, "mcp_attach_post_file"), {
    p_conta_id: "workspace-A",
    p_post_id: 10,
    p_actor: "user-1",
    p_file: { r2_key: key, name: "imagem-do-chat.png", mime_type: "image/png", size_bytes: PNG_3x2.byteLength, width: 3, height: 2 },
    p_position: 2,
    p_replace: false,
  });
  assertEquals(insertPayload(calls, "file_deletions"), undefined);
  assertEquals(JSON.parse(res.content[0].text), {
    post_id: 10, position: 2, replace: false, link_id: 5, file_id: 9, is_cover: false, tipo: "carrossel", url: `signed:${key}`,
  });
}));

Deno.test("attach: file_name becomes the file name (basename, trimmed)", withHosts(HOST, async () => {
  const { server, calls } = setup({
    tables: { workflow_posts: [post()], post_file_links: [links(1)] },
    rpc: { mcp_attach_post_file: [{ data: { link_id: 5, file_id: 9, sort_order: 1, is_cover: false, tipo: "carrossel" }, error: null }] },
  });
  await server.tools.attach_image_to_post.call(
    attachArgs({ image: { download_url: URL_OK, file_id: "f", file_name: "  ../pasta/Capa nova.png " } }),
  );
  assertEquals((rpcArgs(calls, "mcp_attach_post_file")!.p_file as any).name, "Capa nova.png");
}));

Deno.test("attach: PUT failure → generic message, no RPC, nothing queued", withHosts(HOST, async () => {
  const { server, calls } = setup({ putStatus: 403, tables: { workflow_posts: [post()], post_file_links: [links(1)] } });
  const res = await server.tools.attach_image_to_post.call(attachArgs());
  assertEquals(errorText(res), "Não foi possível salvar a imagem no post. Tente de novo.");
  assert(!rpcCalled(calls));
  assertEquals(insertPayload(calls, "file_deletions"), undefined);
}));

Deno.test("attach: PUT that throws logs neither the presigned URL nor its signature", withHosts(HOST, async () => {
  const logged: string[] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => {
    logged.push(a.map((x) => (x instanceof Error ? `${x.name}: ${x.message}` : String(x))).join(" "));
  };
  try {
    const { server, calls } = setup({ putThrows: true, tables: { workflow_posts: [post()], post_file_links: [links(1)] } });
    const res = await server.tools.attach_image_to_post.call(attachArgs());
    assertEquals(errorText(res), "Não foi possível salvar a imagem no post. Tente de novo.");
    assert(!rpcCalled(calls));
    assertEquals(insertPayload(calls, "file_deletions"), undefined);
  } finally {
    console.error = original;
  }
  assert(logged.length > 0, "the failure is logged");
  for (const line of logged) {
    assert(!line.includes("X-Amz"), line);
    assert(!line.includes("r2.example"), line);
    assert(!line.includes("https://"), line);
  }
}));

Deno.test("attach: an RPC error that is not one of its raises (transport, 5xx) is never queued", withHosts(HOST, async () => {
  for (
    const raw of [
      'duplicate key value violates unique constraint "post_file_links_one_cover"',
      "FetchError: error sending request",
      "upstream connect error 502",
      "",
    ]
  ) {
    const { server, calls } = setup({
      tables: { workflow_posts: [post()], post_file_links: [links(1)] },
      rpc: { mcp_attach_post_file: [{ data: null, error: { message: raw } }] },
    });
    const res = await server.tools.attach_image_to_post.call(attachArgs());
    assertEquals(errorText(res), "Não foi possível salvar a imagem no post. Tente de novo.", raw);
    assertEquals(insertPayload(calls, "file_deletions"), undefined, raw);
  }
}));

Deno.test("attach and show read media in (sort_order, id) order", withHosts(HOST, async () => {
  const { server, calls } = setup({ tables: { workflow_posts: [post()], post_file_links: [links(1)], clientes: [client] } });
  await server.tools.show_attach_image.call({ post_id: 10, image: { download_url: URL_OK, file_id: "f" } });
  const orders = calls.filter((c) => c.table === "post_file_links" && c.method === "order").map((c) => c.args[0]);
  assertEquals(orders, ["sort_order", "id"]);
}));

Deno.test("attach: every RPC raise queues the uploaded key and maps to pt-BR, never the raw error", withHosts(HOST, async () => {
  const key = "contas/workspace-A/files/uuid-1.png";
  const cases: Array<[string, string]> = [
    ["media_full", "Este post já tem 10 mídias. Substitua uma lâmina."],
    ["post_not_found", "Post não encontrado neste workspace."],
    ["post_not_editable:aprovado_cliente", "Este post está com o cliente. Volte para rascunho no Mesaas para mudar as imagens."],
    ["post_not_editable:publish_processing_at", "Este post não está em edição. Volte para rascunho no Mesaas para mudar as imagens."],
    ["post_published", "Este post já foi publicado. As imagens não podem mais ser trocadas por aqui."],
    ["tipo_not_image:reels", "Posts do tipo reels não recebem imagens."],
    ["tipo_not_image:weird", "Este tipo de post não recebe imagens."],
    ["invalid_position", "A lâmina escolhida não existe mais neste post. Abra o card de novo para ver as lâminas atuais."],
    ["quota_exceeded", "Cota de armazenamento excedida. Libere espaço em Arquivos."],
    ["workspace_unavailable", "Você não tem mais acesso a este workspace no Mesaas."],
    ["invalid_file", "Não foi possível salvar a imagem no post. Tente de novo."],
  ];
  for (const [raw, msg] of cases) {
    const { server, calls } = setup({
      tables: { workflow_posts: [post()], post_file_links: [links(1)] },
      rpc: { mcp_attach_post_file: [{ data: null, error: { message: raw } }] },
    });
    const res = await server.tools.attach_image_to_post.call(attachArgs());
    assertEquals(errorText(res), msg, raw);
    assert(!res.content[0].text.includes("publish_processing_at"), raw);
    assertEquals(insertPayload(calls, "file_deletions"), { r2_key: key }, raw);
  }
}));

Deno.test("attach: replace at a filled slide and append at 10 items with replace are allowed", withHosts(HOST, async () => {
  const { server, calls } = setup({
    tables: { workflow_posts: [post()], post_file_links: [links(10)] },
    rpc: { mcp_attach_post_file: [{ data: { link_id: 1, file_id: 2, sort_order: 9, is_cover: false, tipo: "carrossel" }, error: null }] },
  });
  const res = await server.tools.attach_image_to_post.call(attachArgs({ position: 10, replace: true }));
  assert(!res.isError, JSON.stringify(res));
  assertEquals(rpcArgs(calls, "mcp_attach_post_file")!.p_replace, true);
  assertEquals(rpcArgs(calls, "mcp_attach_post_file")!.p_position, 10);
}));

// ---- zod, registration, meta, audit -------------------------------------------------------------

Deno.test("attach: position 11 and 0 rejected by zod; replace is required", withHosts(HOST, async () => {
  const { server, net } = setup();
  for (const bad of [attachArgs({ position: 11 }), attachArgs({ position: 0 }), attachArgs({ position: 1.5 }), { ...attachArgs(), replace: undefined }]) {
    const res = await server.tools.attach_image_to_post.call(bad);
    assertEquals(res.isError, true);
    assert(res.zod, "zod rejected it");
  }
  assertEquals(net.fetches, []);
}));

Deno.test("attach_image_to_post is widget-only: app meta, posts:write, never for mesaas_sk_ keys", () => {
  const oauth = setup();
  assertEquals(oauth.server.tools.attach_image_to_post.config._meta, appOnlyToolMeta());
  assertEquals(oauth.server.tools.attach_image_to_post.config.title, "Anexar imagem ao post");
  assertEquals(oauth.server.tools.attach_image_to_post.config.annotations.readOnlyHint, false);
  const key = setup({ oauth: false });
  assert(!("attach_image_to_post" in key.server.tools));
  assert("show_attach_image" in key.server.tools, "the card itself still shows for API keys");
});

Deno.test("attach: posts:write scope required", withHosts(HOST, async () => {
  const { db } = makeFakeDb({});
  const deps = { ...makeDeps(db, { scopes: ["posts:read"], key_id: "oauth:g" }), apps: { enabled: true, oauth: true, r2Origin: null } } as any;
  const server = recordingServer();
  registerAttachTools(server, deps);
  const res = await server.tools.attach_image_to_post.call(attachArgs());
  assertEquals(errorText(res), "Permission denied: missing scope 'posts:write'.");
}));

Deno.test("audit rows of both tools never carry download_url", withHosts(HOST, async () => {
  const a = setup({
    tables: { workflow_posts: [post()], post_file_links: [links(1)] },
    rpc: { mcp_attach_post_file: [{ data: { link_id: 5, file_id: 9, sort_order: 1, is_cover: false, tipo: "carrossel" }, error: null }] },
  });
  await a.server.tools.attach_image_to_post.call(attachArgs());
  const attachAudit = insertPayload(a.calls, "audit_log") as any;
  assertEquals(attachAudit.metadata.args, { post_id: 10, position: 2, replace: false });
  assert(!JSON.stringify(attachAudit).includes("secret-token"));
  assert(!JSON.stringify(attachAudit).includes("download_url"));

  const s = setup({ tables: { workflow_posts: [post()], post_file_links: [links(1)], clientes: [client] } });
  await s.server.tools.show_attach_image.call({ post_id: 10, image: { download_url: URL_OK, file_id: "file-abc" }, position: 1 });
  const showAudit = insertPayload(s.calls, "audit_log") as any;
  assertEquals(showAudit.metadata.args, { post_id: 10, position: 1 });
  assert(!JSON.stringify(showAudit).includes("secret-token"));
  assert(!JSON.stringify(showAudit).includes("download_url"));
}));

// ---- show_attach_image --------------------------------------------------------------------------

Deno.test("show: card meta with openai/fileParams, posts:read, read-only", () => {
  const { server } = setup();
  const t = server.tools.show_attach_image;
  assertEquals(t.config._meta, { ...cardToolMeta(), "openai/fileParams": ["image"] });
  assertEquals(t.config.title, "Mostrar onde anexar a imagem");
  assertEquals(t.config.annotations.readOnlyHint, true);
});

Deno.test("show: eligible carousel → structuredContent with signed media urls", async () => {
  const { server } = setup({ tables: { workflow_posts: [post()], post_file_links: [links(2)], clientes: [client] } });
  const res = await server.tools.show_attach_image.call({
    post_id: 10, image: { download_url: URL_OK, file_id: "file-abc", mime_type: "image/png", file_name: "x.png" }, position: 2,
  });
  assert(!res.isError, JSON.stringify(res));
  assertEquals(res.structuredContent, {
    card: "attach_image",
    v: 1,
    post: { id: 10, titulo: "Skincare", tipo: "carrossel", status: "rascunho" },
    client: { id: 7, nome: "Clínica Sol" },
    media: [
      { position: 1, url: "signed:contas/workspace-A/files/old-0.jpg" },
      { position: 2, url: "signed:contas/workspace-A/files/old-1.jpg" },
    ],
    max: 10,
    eligible: true,
    image: { download_url: URL_OK, file_id: "file-abc" },
    position: 2,
  });
  assertEquals(typeof res.content[0].text, "string");
  assert(!res.content[0].text.includes("secret-token"), "the model summary never echoes the URL");
});

Deno.test("show: aprovado_cliente → eligible false with reason; media urls still set", async () => {
  const { server } = setup({ tables: { workflow_posts: [post({ status: "aprovado_cliente" })], post_file_links: [links(1)], clientes: [client] } });
  const res = await server.tools.show_attach_image.call({ post_id: 10, image: { download_url: URL_OK, file_id: "f" } });
  assertEquals(res.structuredContent.eligible, false);
  assertEquals(res.structuredContent.reason, "Este post está com o cliente. Volte para rascunho no Mesaas para mudar as imagens.");
  assertEquals(res.structuredContent.media, [{ position: 1, url: "signed:contas/workspace-A/files/old-0.jpg" }]);
  assert(!("position" in res.structuredContent));
});

Deno.test("show: publish state and tipo make the post ineligible", async () => {
  const published = "Este post já foi publicado. As imagens não podem mais ser trocadas por aqui.";
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ published_at: "2026-10-01T10:00:00Z" }, published],
    [{ instagram_media_id: "1789" }, published],
    [{ instagram_container_id: "c1" }, published],
    [{ publish_processing_at: "2026-10-29T10:00:00Z" }, published],
    [{ tiktok_publish_processing_at: "2026-10-29T10:00:00Z" }, published],
    [{ tiktok_publish_status: "initiated" }, published],
    [{ tiktok_publish_status: "processing" }, published],
    [{ tiktok_publish_status: "published" }, published],
    [{ tipo: "reels" }, "Posts do tipo reels não recebem imagens."],
    [{ tipo: "stories" }, "Posts do tipo stories não recebem imagens."],
  ];
  for (const [over, reason] of cases) {
    const { server } = setup({ tables: { workflow_posts: [post(over)], post_file_links: [links(0)], clientes: [client] } });
    const res = await server.tools.show_attach_image.call({ post_id: 10, image: { download_url: URL_OK, file_id: "f" } });
    assertEquals(res.structuredContent.eligible, false, JSON.stringify(over));
    assertEquals(res.structuredContent.reason, reason, JSON.stringify(over));
  }
  // A failed TikTok publish does not lock the media.
  const { server } = setup({ tables: { workflow_posts: [post({ tiktok_publish_status: "failed" })], post_file_links: [links(0)], clientes: [client] } });
  const res = await server.tools.show_attach_image.call({ post_id: 10, image: { download_url: URL_OK, file_id: "f" } });
  assertEquals(res.structuredContent.eligible, true);
});

Deno.test("show: 10 media stays eligible (replace is still possible)", async () => {
  const { server } = setup({ tables: { workflow_posts: [post()], post_file_links: [links(10)], clientes: [client] } });
  const res = await server.tools.show_attach_image.call({ post_id: 10, image: { download_url: URL_OK, file_id: "f" } });
  assertEquals(res.structuredContent.eligible, true);
  assertEquals(res.structuredContent.media.length, 10);
});

Deno.test("show: unknown post → pt-BR error; position 11 rejected by zod", async () => {
  const { server } = setup({ tables: { workflow_posts: [{ data: null, error: null }] } });
  const res = await server.tools.show_attach_image.call({ post_id: 99, image: { download_url: URL_OK, file_id: "f" } });
  assertEquals(errorText(res), "Post não encontrado neste workspace.");
  const bad = await server.tools.show_attach_image.call({ post_id: 10, image: { download_url: URL_OK, file_id: "f" }, position: 11 });
  assert(bad.zod);
});

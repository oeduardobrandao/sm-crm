// deno-lint-ignore-file no-explicit-any
import { z } from "npm:zod@3";
import { assert, assertEquals } from "./assert.ts";
import { insertPayload, makeDeps, makeFakeDb } from "./mcp-financeiro-helpers.ts";
import { registerTools } from "../mcp/tools.ts";
import { bodyToSlides, CARDS_TOOL_META, slidesToBody } from "../mcp/cards.ts";

/** Recording fake of McpServer that validates args with the tool's zod shape before calling the
 * handler (the SDK does this in production; calling handlers directly would skip the limits). */
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

const APPS = { enabled: true, oauth: true, r2Origin: null };

function setup(responses: Record<string, { data: unknown; error: unknown }[]> = {}) {
  const { db, calls } = makeFakeDb(responses);
  const deps = { ...makeDeps(db, { scopes: ["posts:read"], role: "owner" }), apps: APPS };
  const server = recordingServer();
  registerTools(server, deps);
  return { server, calls };
}

const CLIENT_OK = { data: { id: 5, nome: "Clínica Aurora" }, error: null };
const NO_ROW = { data: null, error: null };

Deno.test("slidesToBody/bodyToSlides round trip", () => {
  const slides = [{ texto: "  Primeiro slide \n" }, { texto: "\nSegundo" }, { texto: " Terceiro  " }];
  const trimmed = [{ texto: "Primeiro slide" }, { texto: "Segundo" }, { texto: "Terceiro" }];
  assertEquals(bodyToSlides(slidesToBody(slides)), trimmed);
  assertEquals(slidesToBody(slides).split("\n")[0], "Primeiro slide");
  assertEquals(bodyToSlides("a\n \n\n  \nb"), [{ texto: "a" }, { texto: "b" }]);
  assertEquals(bodyToSlides(""), []);
});

Deno.test("CARDS_TOOL_META titles", () => {
  assertEquals(CARDS_TOOL_META.preview_post, { title: "Mostrar prévia do post", readOnly: true });
  assertEquals(CARDS_TOOL_META.show_caption_options, { title: "Mostrar opções de legenda", readOnly: true });
});

Deno.test("preview_post: client from another workspace -> Cliente não encontrado", async () => {
  const { server, calls } = setup({ clientes: [NO_ROW] });
  const res = await server.tools.preview_post.cb({ client_id: 9, titulo: "T", tipo: "feed", ig_caption: "x" });
  assertEquals(res.isError, true);
  assertEquals(JSON.parse(res.content[0].text).error, "Cliente não encontrado neste workspace.");
  assert(calls.some((c) => c.table === "clientes" && c.method === "eq" && c.args[0] === "conta_id"), "scoped by conta_id");
});

Deno.test("preview_post: post_id of another workspace -> Post não encontrado", async () => {
  const { server } = setup({ clientes: [CLIENT_OK], workflow_posts: [NO_ROW] });
  const res = await server.tools.preview_post.cb({ client_id: 5, titulo: "T", tipo: "feed", ig_caption: "x", post_id: 77 });
  assertEquals(res.isError, true);
  assertEquals(JSON.parse(res.content[0].text).error, "Post não encontrado neste workspace.");
});

Deno.test("preview_post: structuredContent has card post_preview, v 1, caption_len, caption_max 2200", async () => {
  const { server } = setup({ clientes: [CLIENT_OK], workflow_posts: [{ data: { id: 12 }, error: null }] });
  const res = await server.tools.preview_post.cb({
    client_id: 5, titulo: "Dica de skincare", tipo: "carrossel", pilar: "Autoridade",
    slides: [{ texto: " Um " }, { texto: "Dois" }], ig_caption: "Legenda de teste", post_id: 12,
  });
  assert(!res.isError);
  assertEquals(res.content, [{ type: "text", text: 'Prévia de "Dica de skincare" para Clínica Aurora mostrada ao usuário.' }]);
  const sc = res.structuredContent;
  assertEquals(sc.card, "post_preview");
  assertEquals(sc.v, 1);
  assertEquals(sc.client, { id: 5, nome: "Clínica Aurora" });
  assertEquals(sc.caption_len, "Legenda de teste".length);
  assertEquals(sc.caption_max, 2200);
  assertEquals(sc.post_id, 12);
  assertEquals(sc.pilar, "Autoridade");
  assertEquals(sc.body, "Um\n\nDois");
  assertEquals(sc.slides.length, 2);
});

Deno.test("preview_post: reels body is the roteiro; a long caption is flagged, not rejected", async () => {
  const { server } = setup({ clientes: [CLIENT_OK] });
  const caption = "a".repeat(3000);
  const res = await server.tools.preview_post.cb({
    client_id: 5, titulo: "R", tipo: "reels", roteiro: "Cena 1\nCena 2", ig_caption: caption,
  });
  assert(!res.isError);
  assertEquals(res.structuredContent.body, "Cena 1\nCena 2");
  assertEquals(res.structuredContent.roteiro, "Cena 1\nCena 2");
  assertEquals(res.structuredContent.slides, []);
  assertEquals(res.structuredContent.caption_len, 3000);
  assertEquals(res.structuredContent.caption_max, 2200);
  assert(!("post_id" in res.structuredContent));
});

Deno.test("preview_post: zod limits (11 slides, empty/oversized slide, bad tipo, caption > 10000)", async () => {
  const { server } = setup({ clientes: [CLIENT_OK, CLIENT_OK, CLIENT_OK, CLIENT_OK, CLIENT_OK] });
  const base = { client_id: 5, titulo: "T", tipo: "carrossel", ig_caption: "x" };
  const eleven = Array.from({ length: 11 }, (_, i) => ({ texto: `s${i}` }));
  assertEquals((await server.tools.preview_post.cb({ ...base, slides: eleven })).isError, true);
  assertEquals((await server.tools.preview_post.cb({ ...base, slides: [{ texto: "" }] })).isError, true);
  assertEquals((await server.tools.preview_post.cb({ ...base, slides: [{ texto: "x".repeat(2001) }] })).isError, true);
  assertEquals((await server.tools.preview_post.cb({ ...base, tipo: "podcast" })).isError, true);
  assertEquals((await server.tools.preview_post.cb({ ...base, ig_caption: "x".repeat(10001) })).isError, true);
  const ten = Array.from({ length: 10 }, (_, i) => ({ texto: `s${i}` }));
  assert(!(await server.tools.preview_post.cb({ ...base, slides: ten })).isError);
});

Deno.test("show_caption_options: 1 or 4 options rejected; per-option limits; len reported", async () => {
  const { server } = setup({ clientes: [CLIENT_OK, CLIENT_OK] });
  const opt = (label: string, text: string) => ({ label, text });
  const base = { client_id: 5 };
  assertEquals((await server.tools.show_caption_options.cb({ ...base, options: [opt("A", "a")] })).isError, true);
  assertEquals(
    (await server.tools.show_caption_options.cb({ ...base, options: [opt("A", "a"), opt("B", "b"), opt("C", "c"), opt("D", "d")] })).isError,
    true,
  );
  assertEquals((await server.tools.show_caption_options.cb({ ...base, options: [opt("", "a"), opt("B", "b")] })).isError, true);
  assertEquals((await server.tools.show_caption_options.cb({ ...base, options: [opt("x".repeat(61), "a"), opt("B", "b")] })).isError, true);
  assertEquals((await server.tools.show_caption_options.cb({ ...base, options: [opt("A", ""), opt("B", "b")] })).isError, true);
  assertEquals((await server.tools.show_caption_options.cb({ ...base, options: [opt("A", "x".repeat(10001)), opt("B", "b")] })).isError, true);

  const res = await server.tools.show_caption_options.cb({ ...base, options: [opt("Curta", "abc"), opt("Longa", "abcdef")] });
  assert(!res.isError);
  assertEquals(res.content[0].text, "Opções de legenda para Clínica Aurora mostradas ao usuário.");
  assertEquals(res.structuredContent, {
    card: "caption_options", v: 1, client: { id: 5, nome: "Clínica Aurora" },
    options: [{ label: "Curta", text: "abc", len: 3 }, { label: "Longa", text: "abcdef", len: 6 }],
    caption_max: 2200,
  });
});

Deno.test("show_caption_options: foreign client / foreign post rejected", async () => {
  const opts = [{ label: "A", text: "a" }, { label: "B", text: "b" }];
  const s1 = setup({ clientes: [NO_ROW] });
  const r1 = await s1.server.tools.show_caption_options.cb({ client_id: 9, options: opts });
  assertEquals(JSON.parse(r1.content[0].text).error, "Cliente não encontrado neste workspace.");
  const s2 = setup({ clientes: [CLIENT_OK], workflow_posts: [NO_ROW] });
  const r2 = await s2.server.tools.show_caption_options.cb({ client_id: 5, post_id: 3, options: opts });
  assertEquals(JSON.parse(r2.content[0].text).error, "Post não encontrado neste workspace.");
});

Deno.test("audit rows carry no slide, roteiro or caption text", async () => {
  const secrets = ["SEGREDO-SLIDE", "SEGREDO-ROTEIRO", "SEGREDO-LEGENDA", "SEGREDO-OPCAO"];
  const { server, calls } = setup({ clientes: [CLIENT_OK, CLIENT_OK] });
  await server.tools.preview_post.cb({
    client_id: 5, titulo: "T", tipo: "carrossel", slides: [{ texto: secrets[0] }],
    roteiro: secrets[1], ig_caption: secrets[2],
  });
  const row1 = insertPayload(calls, "audit_log") as any;
  assertEquals(row1.action, "mcp.preview_post");
  assertEquals(row1.metadata.args, { client_id: 5, post_id: undefined, tipo: "carrossel", slides: 1, caption_len: secrets[2].length });

  await server.tools.show_caption_options.cb({
    client_id: 5, options: [{ label: "A", text: secrets[3] }, { label: "B", text: "b" }],
  });
  const rows = calls.filter((c) => c.table === "audit_log" && c.method === "insert").map((c) => c.args[0] as any);
  assertEquals(rows.length, 2);
  assertEquals(rows[1].metadata.args, { client_id: 5, post_id: undefined, options: 2 });
  const dump = JSON.stringify(rows);
  for (const s of secrets) assert(!dump.includes(s), `audit leaked ${s}`);
});

Deno.test("card tools carry the cards _meta and the scope posts:read", () => {
  const { server } = setup();
  for (const name of ["preview_post", "show_caption_options"]) {
    assertEquals(server.tools[name].config._meta, { ui: { resourceUri: "ui://mesaas/cards-v1.html" } }, name);
    assertEquals(server.tools[name].config.annotations.readOnlyHint, true, name);
  }
});

Deno.test("card tools: missing posts:read scope -> permission denied", async () => {
  const { db } = makeFakeDb({});
  const deps = { ...makeDeps(db, { scopes: ["clientes:read"], role: "owner" }), apps: APPS };
  const server = recordingServer();
  registerTools(server, deps);
  const res = await server.tools.preview_post.cb({ client_id: 5, titulo: "T", tipo: "feed", ig_caption: "x" });
  assertEquals(res.isError, true);
  assert(res.content[0].text.includes("posts:read"));
});

Deno.test("tools absent when apps disabled", () => {
  const { db } = makeFakeDb({});
  for (const apps of [undefined, { enabled: false, oauth: true, r2Origin: null }]) {
    const base = makeDeps(db, { scopes: ["posts:read"], role: "owner" });
    const server = recordingServer();
    registerTools(server, apps ? { ...base, apps } : base);
    assert(!("preview_post" in server.tools));
    assert(!("show_caption_options" in server.tools));
  }
});

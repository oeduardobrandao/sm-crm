import { assert, assertEquals } from "./assert.ts";
import { createKbArticle, getKbArticle, listKbArticles, updateKbArticle } from "../mcp-admin/queries.ts";
import { encodeOpaque } from "../mcp-admin/markdown.ts";
import { expectInputError, has, insertPayload, makeDeps, makeFakeDb, updatePayload } from "./mcp-admin-helpers.ts";

const DOC = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Olá" }] }] };
const ROW = { id: "a1", title: "T", slug: "t", excerpt: null, content: DOC, content_plain: "Olá", cover_image_url: null, category: "clientes", tags: [], status: "draft", display_order: 0, author_id: "adm-1", created_at: "t", updated_at: "t" };

Deno.test("listKbArticles: sem corpo, filtros de status e categoria, ordem por display_order", async () => {
  const { db, calls } = makeFakeDb({ kb_articles: [{ data: [ROW], error: null }] });
  const r = await listKbArticles(makeDeps(db), { status: "draft", category: "clientes" });
  assertEquals(Object.keys(r.articles[0]).sort(), ["category", "cover_image_url", "display_order", "excerpt", "id", "slug", "status", "tags", "title", "updated_at"]);
  assert(has(calls, "kb_articles", "eq", ["status", "draft"]));
  assert(has(calls, "kb_articles", "eq", ["category", "clientes"]));
  assert(has(calls, "kb_articles", "order", ["display_order", { ascending: true }]));
});

Deno.test("getKbArticle: por id (prevalece sobre slug) ou slug; devolve markdown + opaque_blocks", async () => {
  const iframe = { type: "iframe", attrs: { src: "https://www.loom.com/embed/x", width: "100%", height: "400px" } };
  const row = { ...ROW, content: { type: "doc", content: [...DOC.content, iframe] } };
  const { db, calls } = makeFakeDb({ kb_articles: [{ data: row, error: null }] });
  const r = await getKbArticle(makeDeps(db), { article_id: "a1", slug: "ignorado" });
  assertEquals(r.article.content_markdown, `Olá\n\n${encodeOpaque(iframe)}`);
  assertEquals(r.article.opaque_blocks, 1);
  assert(has(calls, "kb_articles", "eq", ["id", "a1"]));
  assert(!has(calls, "kb_articles", "eq", ["slug", "ignorado"]));
  assert(!("content" in r.article) && !("content_plain" in r.article));

  const { db: db2, calls: calls2 } = makeFakeDb({ kb_articles: [{ data: ROW, error: null }] });
  await getKbArticle(makeDeps(db2), { slug: "t" });
  assert(has(calls2, "kb_articles", "eq", ["slug", "t"]));
  await expectInputError(() => getKbArticle(makeDeps(db2), {}), "article_id ou slug");
  await expectInputError(() => getKbArticle(makeDeps(makeFakeDb({ kb_articles: [{ data: null, error: null }] }).db), { slug: "nao" }), "não encontrado");
});

Deno.test("createKbArticle: markdown → content + content_plain juntos, dims preenchidas, author_id = admin_id", async () => {
  const { db, calls } = makeFakeDb({ kb_articles: [{ data: { id: "a9", slug: "novo-post", status: "draft" }, error: null }] });
  const r = await createKbArticle(makeDeps(db), {
    title: "Novo post", slug: "novo-post", category: "primeiros-passos",
    content_markdown: "## Passo\n\nTexto **forte**\n\n![Tela](https://cdn.x/tela.png)", tags: ["a"], author_id: "hacker",
  });
  assertEquals(r, { id: "a9", slug: "novo-post", status: "draft" });
  const ins = insertPayload(calls, "kb_articles")!;
  assertEquals(ins.author_id, "adm-1");
  assertEquals(ins.content_plain, "Passo\nTexto forte\nTela");
  const img = (ins.content as { content: Array<{ type: string; attrs?: Record<string, unknown> }> }).content[2];
  assertEquals(img.type, "inlineImage");
  assertEquals(img.attrs!.width, 10); assertEquals(img.attrs!.height, 5);
  assert(!("content_markdown" in ins));
});

Deno.test("createKbArticle: content_markdown obrigatório; slug reservado/duplicado; categoria inválida", async () => {
  const { db } = makeFakeDb({});
  await expectInputError(() => createKbArticle(makeDeps(db), { title: "T", slug: "t", category: "clientes" }), "content_markdown");
  await expectInputError(() => createKbArticle(makeDeps(db), { title: "T", slug: "novo", category: "clientes", content_markdown: "x" }), "reserved");
  await expectInputError(() => createKbArticle(makeDeps(db), { title: "T", slug: "t", category: "nope", content_markdown: "x" }), "category");
  const dup = makeFakeDb({ kb_articles: [{ data: null, error: { code: "23505", message: "duplicate key" } }] });
  await expectInputError(() => createKbArticle(makeDeps(dup.db), { title: "T", slug: "t", category: "clientes", content_markdown: "x" }), "slug");
});

Deno.test("updateKbArticle: patch só de metadados não toca content; patch com markdown regrava content + plain", async () => {
  const { db, calls } = makeFakeDb({ kb_articles: [{ data: ROW, error: null }, { data: { id: "a1", slug: "t", status: "published" }, error: null }] });
  const r = await updateKbArticle(makeDeps(db), { article_id: "a1", status: "published", cover_image_url: "https://sb/storage/v1/object/public/kb-images/t/capa.png" });
  assertEquals(r, { id: "a1", slug: "t", status: "published" });
  assertEquals(updatePayload(calls, "kb_articles"), { status: "published", cover_image_url: "https://sb/storage/v1/object/public/kb-images/t/capa.png" });

  const { db: db2, calls: calls2 } = makeFakeDb({ kb_articles: [{ data: ROW, error: null }, { data: { id: "a1", slug: "t", status: "draft" }, error: null }] });
  await updateKbArticle(makeDeps(db2), { article_id: "a1", content_markdown: "Novo" });
  const up = updatePayload(calls2, "kb_articles")!;
  assertEquals(up.content_plain, "Novo");
  assertEquals((up.content as { type: string }).type, "doc");

  await expectInputError(() => updateKbArticle(makeDeps(makeFakeDb({ kb_articles: [{ data: ROW, error: null }] }).db), { article_id: "a1" }), "Nada para atualizar");
  await expectInputError(() => updateKbArticle(makeDeps(makeFakeDb({ kb_articles: [{ data: null, error: null }] }).db), { article_id: "zz", title: "x" }), "não encontrado");
  await expectInputError(() => updateKbArticle(makeDeps(makeFakeDb({ kb_articles: [{ data: ROW, error: null }] }).db), { article_id: "a1", content: DOC }), "content_markdown");
});

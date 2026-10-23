// Ferramentas de blog do mcp-admin (spec 2026-10-23-blog-automatico §2-§3): validação de
// rascunho com limites na mensagem, colisão de slug, update só em rascunho, upload no bucket
// blog-images e checks automáticos (links SSRF-safe com timeout, travessão, títulos parecidos).
import { z } from "npm:zod@3";
import { assert, assertEquals } from "./assert.ts";
import { registerTools } from "../mcp-admin/tools.ts";
import { createBlogDraft, getBlogPost, listBlogPosts, updateBlogDraft } from "../mcp-admin/blog.ts";
import { uploadBlogImage } from "../mcp-admin/images.ts";
import { runBlogChecks, titleSimilarity } from "../mcp-admin/blog-checks.ts";
import { collectBodyLinkUrls, isAllowedLinkTarget, validateBlogDraft } from "../_shared/blog-validate.ts";
import { BLOG_FILE_POSTS } from "../_shared/blog-file-posts.ts";
import { BLOG_FEATURE_SLUGS } from "../_shared/blog-rules.ts";
import { CTX, expectInputError, insertPayload, makeDeps, makeFakeDb, PNG_10x5, updatePayload } from "./mcp-admin-helpers.ts";

const BUCKET_URL = "https://sb/storage/v1/object/public/blog-images/";

function draft(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slug: "calendario-editorial-para-agencias",
    category: "guia",
    title: "Calendário editorial para agências: como montar o seu", // 53
    h1: "Como montar um calendário editorial que a sua agência segue",
    description:
      "Um passo a passo para montar o calendário editorial da agência, com modelos, prazos de aprovação e o que medir a cada mês de trabalho.",
    lede: "Um calendário bem feito tira a correria do fim do mês.",
    body_md: [
      "## Por onde começar",
      "",
      "Segundo a [pesquisa](https://example.com/estudo), metade das agências atrasa posts.",
      "",
      "![Equipe planejando](img:planejamento)",
      "",
      "Veja também [o guia de aprovação](/blog/como-organizar-aprovacao-de-posts).",
    ].join("\n"),
    cover_image: {
      url: `${BUCKET_URL}drafts/2026-09/capa.png`,
      alt: "Mesa com calendário",
      credit: "Fulano / Unsplash",
      license: "Unsplash License",
      source_url: "https://unsplash.com/photos/abc",
    },
    images: [{
      key: "planejamento",
      url: `${BUCKET_URL}drafts/2026-09/planejamento.png`,
      alt: "Equipe planejando",
      credit: "Ciclana / Pexels",
      license: "Pexels License",
      source_url: "https://pexels.com/photo/1",
    }],
    sources: [{ title: "Estudo de agências", publisher: "Instituto X", url: "https://example.com/estudo" }],
    topic_reason: "Tema evergreen com busca alta em setembro.",
    ...over,
  };
}

type Tool = { run: (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; isError?: boolean }> };
function captureTools(deps: ReturnType<typeof makeDeps>) {
  const tools = new Map<string, Tool>();
  registerTools({ tool: (name: string, _d: string, _s: unknown, cb: Tool["run"]) => tools.set(name, { run: cb }) }, deps);
  return tools;
}

/** Fila do blog_posts para um create válido: colisão de slug → títulos de 60 dias → insert. */
function createQueue(id = "p-1") {
  return {
    blog_posts: [
      { data: null, error: null },
      { data: [], error: null },
      { data: { id }, error: null },
    ],
  };
}

// ---------------------------------------------------------------------------
// Escopo, registro e auditoria
// ---------------------------------------------------------------------------

Deno.test("create_blog_draft sem blog:write → permissão negada, sem tocar o banco", async () => {
  const { db, calls } = makeFakeDb({});
  const tools = captureTools(makeDeps(db, { ctx: { ...CTX, scopes: ["blog:read"] } }));
  const r = await tools.get("create_blog_draft")!.run(draft());
  assertEquals(r.isError, true);
  assertEquals(JSON.parse(r.content[0].text), { error: "Permission denied: missing scope 'blog:write'." });
  assertEquals(calls.length, 0);
});

Deno.test("nenhuma tool aprova, publica ou apaga post do blog", () => {
  const tools = captureTools(makeDeps(makeFakeDb({}).db));
  const blog = [...tools.keys()].filter((n) => n.includes("blog")).sort();
  assertEquals(blog, ["create_blog_draft", "get_blog_post", "list_blog_posts", "update_blog_draft", "upload_blog_image"]);
});

Deno.test("create_blog_draft válido → rascunho, equipe, revision 1, checks gravados e audit sem conteúdo", async () => {
  const { db, calls } = makeFakeDb(createQueue("p-1"));
  const tools = captureTools(makeDeps(db));
  const r = await tools.get("create_blog_draft")!.run(draft());
  assertEquals(r.isError, undefined, r.content[0].text);
  const out = JSON.parse(r.content[0].text);
  assertEquals(out.id, "p-1");
  assertEquals(out.checks.links, { ok: true, broken: [] });
  assertEquals(out.checks.cover, true);

  const row = insertPayload(calls, "blog_posts")!;
  assertEquals(row.status, "rascunho");
  assertEquals(row.author, "equipe");
  assertEquals(row.revision, 1);
  assertEquals(row.slug, "calendario-editorial-para-agencias");
  assertEquals(row.feature_slug, null);
  assertEquals(row.checks, out.checks);

  const audit = insertPayload(calls, "audit_log")!;
  assertEquals(audit.action, "mcp_admin.create_blog_draft");
  assertEquals(audit.resource_id, "p-1");
  assert(!JSON.stringify(audit.metadata).includes("Calendário"));
});

// ---------------------------------------------------------------------------
// Validação (mensagens com os limites)
// ---------------------------------------------------------------------------

Deno.test("title de 64 caracteres → erro com o campo e a faixa 50 a 60", async () => {
  const title = "x".repeat(64);
  const { db, calls } = makeFakeDb({});
  await expectInputError(() => createBlogDraft(makeDeps(db), draft({ title })), "title: 64 caracteres; precisa ter de 50 a 60.");
  assertEquals(insertPayload(calls, "blog_posts"), undefined);
});

Deno.test("validateBlogDraft: uma linha por campo, com os limites", () => {
  const r = validateBlogDraft(draft({ title: "curto", description: "curta", category: "receita", slug: "Com Espaço" }), { partial: false });
  assert(!r.ok);
  if (r.ok) return;
  assert(r.errors.some((e) => e.startsWith("title: 5 caracteres; precisa ter de 50 a 60")), r.errors.join("\n"));
  assert(r.errors.some((e) => e.startsWith("description: 5 caracteres; precisa ter de 120 a 160")), r.errors.join("\n"));
  assert(r.errors.some((e) => e.startsWith("category:") && e.includes("comparativo")), r.errors.join("\n"));
  assert(r.errors.some((e) => e.startsWith("slug:")), r.errors.join("\n"));
});

Deno.test("validateBlogDraft partial: só valida os campos presentes", () => {
  assertEquals(validateBlogDraft({ lede: "Novo lede." }, { partial: true }).ok, true);
  const r = validateBlogDraft({ h1: "curto" }, { partial: true });
  assert(!r.ok && r.errors[0].startsWith("h1: 5 caracteres; precisa ter de 10 a 120"));
});

Deno.test("slug de post em arquivo → rejeitado", async () => {
  const { db } = makeFakeDb({});
  assert(BLOG_FILE_POSTS.some((p) => p.slug === "mesaas-vs-mlabs"));
  await expectInputError(() => createBlogDraft(makeDeps(db), draft({ slug: "mesaas-vs-mlabs" })), "slug:");
});

Deno.test("slug já usado no banco → rejeitado", async () => {
  const { db } = makeFakeDb({ blog_posts: [{ data: { id: "outro" }, error: null }] });
  await expectInputError(() => createBlogDraft(makeDeps(db), draft()), "slug: já existe");
});

Deno.test("sources vazio → rejeitado", async () => {
  const { db } = makeFakeDb({});
  await expectInputError(() => createBlogDraft(makeDeps(db), draft({ sources: [] })), "sources:");
});

Deno.test("imagem com license vazia → rejeitada com o caminho do campo", async () => {
  const d = draft();
  const images = [{ ...(d.images as Record<string, unknown>[])[0], license: "" }];
  const { db } = makeFakeDb({});
  await expectInputError(() => createBlogDraft(makeDeps(db), draft({ images })), "images[0].license");
});

Deno.test("capa sem licença → rejeitada", async () => {
  const { db } = makeFakeDb({});
  const cover_image = { ...(draft().cover_image as Record<string, unknown>), license: "" };
  await expectInputError(() => createBlogDraft(makeDeps(db), draft({ cover_image })), "cover_image.license");
});

Deno.test("imagem fora do bucket blog-images → rejeitada", async () => {
  const d = draft();
  const images = [{ ...(d.images as Record<string, unknown>[])[0], url: "https://outro.site/foto.png" }];
  const { db } = makeFakeDb({});
  await expectInputError(() => createBlogDraft(makeDeps(db), draft({ images })), "images[0].url");
});

Deno.test("![x](https://a/b.png) no corpo → rejeitado", async () => {
  const { db } = makeFakeDb({});
  await expectInputError(() => createBlogDraft(makeDeps(db), draft({ body_md: "Texto\n\n![x](https://a/b.png)" })), "img:");
});

Deno.test("![x](img:chave-inexistente) → rejeitado", async () => {
  const { db } = makeFakeDb({});
  await expectInputError(() => createBlogDraft(makeDeps(db), draft({ body_md: "![x](img:nao-existe)" })), "nao-existe");
});

Deno.test("HTML cru (<script>) no corpo → rejeitado", async () => {
  const { db } = makeFakeDb({});
  await expectInputError(() => createBlogDraft(makeDeps(db), draft({ body_md: "Oi <script>alert(1)</script>" })), "HTML");
});

Deno.test("link javascript:, protocolo relativo e definição de referência → rejeitados", async () => {
  for (const body of ["[x](javascript:alert(1))", "[x](//evil.com/a)", "[x][r]\n\n[r]: data:text/html,oi"]) {
    const r = validateBlogDraft(draft({ body_md: body }), { partial: false });
    assert(!r.ok && r.errors.some((e) => e.startsWith("body_md:")), `${body} → ${JSON.stringify(r)}`);
  }
  const ok = validateBlogDraft(draft({ body_md: "[a](https://x.com) [b](/precos) [c](#topo) [d](http://y.com)" }), { partial: false });
  assert(ok.ok, JSON.stringify(ok));
});

Deno.test("infográfico com fonte fora de sources → infografico[0].fonte", async () => {
  const body = [
    "```infografico",
    JSON.stringify({ tipo: "numeros", titulo: "Números", fonte: 3, itens: [{ valor: "50%", legenda: "a" }, { valor: "2x", legenda: "b" }] }),
    "```",
  ].join("\n");
  const { db } = makeFakeDb({});
  await expectInputError(() => createBlogDraft(makeDeps(db), draft({ body_md: body })), "infografico[0].fonte");
});

Deno.test("feature_slug desconhecido → rejeitado; conhecido → aceito", () => {
  const bad = validateBlogDraft(draft({ feature_slug: "kanban" }), { partial: false });
  assert(!bad.ok && bad.errors.some((e) => e.startsWith("feature_slug:")));
  assert(validateBlogDraft(draft({ feature_slug: BLOG_FEATURE_SLUGS[0] }), { partial: false }).ok);
});

// ---------------------------------------------------------------------------
// update_blog_draft
// ---------------------------------------------------------------------------

function row(over: Record<string, unknown> = {}) {
  return { id: "p-1", status: "rascunho", revision: 1, feature_slug: null, revision_note: null, ...draft(), ...over };
}

Deno.test("update_blog_draft em post publicado → rejeitado", async () => {
  const { db, calls } = makeFakeDb({ blog_posts: [{ data: row({ status: "publicado" }), error: null }] });
  await expectInputError(
    () => updateBlogDraft(makeDeps(db), { post_id: "p-1", lede: "Outro lede." }),
    "Só rascunhos podem ser editados pela rotina.",
  );
  assertEquals(updatePayload(calls, "blog_posts"), undefined);
});

Deno.test("update_blog_draft em ajuste_solicitado → rascunho, revised_after_note, revision 2, nota limpa", async () => {
  const { db, calls } = makeFakeDb({
    blog_posts: [
      { data: row({ status: "ajuste_solicitado", revision_note: "Troque a capa." }), error: null },
      { data: [], error: null },
      { data: { id: "p-1" }, error: null },
    ],
  });
  const out = await updateBlogDraft(makeDeps(db), { post_id: "p-1", lede: "Um lede reescrito depois da nota." }) as Record<string, unknown>;
  const patch = updatePayload(calls, "blog_posts")!;
  assertEquals(patch.status, "rascunho");
  assertEquals(patch.revised_after_note, true);
  assertEquals(patch.revision_note, null);
  assertEquals(patch.revision, 2);
  assertEquals(patch.lede, "Um lede reescrito depois da nota.");
  assert(patch.checks && typeof patch.checks === "object");
  assertEquals(out.revision, 2);
  assertEquals(out.status, "rascunho");
  // Guarda otimista: o update só vale para a revisão e o status lidos.
  assert(calls.some((c) => c.table === "blog_posts" && c.method === "eq" && c.args[0] === "revision" && c.args[1] === 1));
});

Deno.test("update_blog_draft valida o post mesclado (imagens removidas com img: no corpo)", async () => {
  const { db } = makeFakeDb({ blog_posts: [{ data: row(), error: null }] });
  await expectInputError(() => updateBlogDraft(makeDeps(db), { post_id: "p-1", images: [] }), "planejamento");
});

Deno.test("update_blog_draft: corrida (nenhuma linha atualizada) → pede para reler", async () => {
  const { db } = makeFakeDb({
    blog_posts: [{ data: row(), error: null }, { data: [], error: null }, { data: null, error: null }],
  });
  await expectInputError(() => updateBlogDraft(makeDeps(db), { post_id: "p-1", lede: "Outro lede." }), "get_blog_post");
});

Deno.test("update_blog_draft: post inexistente → McpInputError", async () => {
  const { db } = makeFakeDb({ blog_posts: [{ data: null, error: null }] });
  await expectInputError(() => updateBlogDraft(makeDeps(db), { post_id: "zz", lede: "x" }), "não encontrado");
});

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

Deno.test("list_blog_posts devolve posts, file_posts e feature_slugs; since_days filtra", async () => {
  const posts = [{ id: "p-1", slug: "a", title: "A", category: "guia", status: "rascunho" }];
  const { db, calls } = makeFakeDb({ blog_posts: [{ data: posts, error: null }] });
  const out = await listBlogPosts(makeDeps(db), { since_days: 60, status: "rascunho" });
  assertEquals(out.posts, posts);
  assertEquals(out.file_posts, BLOG_FILE_POSTS);
  assertEquals(out.feature_slugs, [...BLOG_FEATURE_SLUGS]);
  assert(calls.some((c) => c.method === "gte" && c.args[0] === "created_at" && c.args[1] === "2026-07-06T12:00:00.000Z"));
  assert(calls.some((c) => c.method === "eq" && c.args[0] === "status" && c.args[1] === "rascunho"));
});

Deno.test("get_blog_post: inexistente → McpInputError", async () => {
  const { db } = makeFakeDb({ blog_posts: [{ data: null, error: null }] });
  await expectInputError(() => getBlogPost(makeDeps(db), { post_id: "zz" }), "não encontrado");
});

// ---------------------------------------------------------------------------
// upload_blog_image
// ---------------------------------------------------------------------------

Deno.test("upload_blog_image: baixa no servidor e grava em blog-images/drafts/<yyyy-mm>/", async () => {
  const { db, storageCalls } = makeFakeDb({});
  const out = await uploadBlogImage(makeDeps(db), {
    source_url: "https://images.example.com/foto.png", filename: "Foto Linda.png", mime_type: "image/png",
    alt: "Uma foto", credit: "Fulano / Unsplash", license: "Unsplash License", page_url: "https://unsplash.com/photos/abc",
  });
  const up = storageCalls.find((c) => c.method === "upload")!;
  assertEquals(up.bucket, "blog-images");
  assert(String(up.args[0]).startsWith("drafts/2026-09/"), String(up.args[0]));
  assert(String(up.args[0]).endsWith("-foto-linda.png"));
  assertEquals(out.url, `${BUCKET_URL}${up.args[0]}`);
  assertEquals(out.width, 10);
  assertEquals(out.height, 5);
});

Deno.test("upload_blog_image: sem licença ou com http → rejeitado, sem baixar", async () => {
  let fetched = 0;
  const deps = makeDeps(makeFakeDb({}).db, { fetchUrl: () => { fetched++; return Promise.resolve(new Response(PNG_10x5)); } });
  const base = {
    source_url: "https://images.example.com/foto.png", filename: "f.png", mime_type: "image/png",
    alt: "Uma foto", credit: "Fulano", license: "CC BY 4.0", page_url: "https://site.com/p",
  };
  await expectInputError(() => uploadBlogImage(deps, { ...base, license: " " }), "license");
  await expectInputError(() => uploadBlogImage(deps, { ...base, page_url: "javascript:x" }), "page_url");
  await expectInputError(() => uploadBlogImage(deps, { ...base, source_url: "http://images.example.com/f.png" }), "https");
  assertEquals(fetched, 0);
});

// ---------------------------------------------------------------------------
// runBlogChecks
// ---------------------------------------------------------------------------

function checkPost(over: Record<string, unknown> = {}) {
  return { id: null, ...draft(), ...over } as Parameters<typeof runBlogChecks>[1];
}

Deno.test("runBlogChecks: link cujo fetch trava passa do timeout e entra em broken", async () => {
  const hang = "https://lento.example.com/x";
  const deps = makeDeps(makeFakeDb({ blog_posts: [{ data: [], error: null }] }).db, {
    fetchUrl: (url) => url.startsWith(hang) ? new Promise<Response>(() => {}) : Promise.resolve(new Response(null, { status: 200 })),
  });
  const c = await runBlogChecks(deps, checkPost({ body_md: `Veja [isto](${hang}).` }), { linkTimeoutMs: 30 });
  assertEquals(c.links, { ok: false, broken: [hang] });
});

Deno.test("runBlogChecks: HEAD 405 cai para GET; 404 e endereço privado vão para broken; 3xx conta como resposta", async () => {
  const seen: string[] = [];
  const deps = makeDeps(makeFakeDb({ blog_posts: [{ data: [], error: null }] }).db, {
    resolveDns: async (h, t) => t !== "A" ? [] : h === "interno.example.com" ? ["10.0.0.5"] : ["93.184.216.34"],
    fetchUrl: async (url, init) => {
      seen.push(`${init.method} ${url}`);
      assertEquals(init.redirect, "manual");
      assert(init.signal instanceof AbortSignal);
      if (url.includes("so-get") && init.method === "HEAD") return new Response(null, { status: 405 });
      if (url.includes("sumiu")) return new Response(null, { status: 404 });
      if (url.includes("move")) return new Response(null, { status: 301, headers: { location: "https://x" } });
      return new Response("ok", { status: 200 });
    },
  });
  const body = [
    "[a](https://site.example.com/so-get)",
    "[b](https://site.example.com/sumiu)",
    "[c](https://interno.example.com/admin)",
    "[d](https://site.example.com/move)",
    "[e](/precos)",
  ].join(" ");
  const c = await runBlogChecks(deps, checkPost({ body_md: body }), { linkTimeoutMs: 1000 });
  assertEquals(c.links.ok, false);
  assertEquals(c.links.broken.sort(), ["https://interno.example.com/admin", "https://site.example.com/sumiu"]);
  assert(seen.includes("GET https://site.example.com/so-get"));
  assert(!seen.some((s) => s.includes("interno")), "nunca busca host privado");
  assert(!seen.some((s) => s.includes("/precos")), "links relativos não são buscados");
});

Deno.test("runBlogChecks: no máximo 20 URLs únicas", async () => {
  let n = 0;
  const deps = makeDeps(makeFakeDb({ blog_posts: [{ data: [], error: null }] }).db, {
    fetchUrl: async () => { n++; return new Response(null, { status: 200 }); },
  });
  const links = Array.from({ length: 30 }, (_, i) => `[l${i}](https://s.example.com/${i}) [r${i}](https://s.example.com/${i})`).join(" ");
  await runBlogChecks(deps, checkPost({ body_md: links }), { linkTimeoutMs: 1000 });
  assertEquals(n, 20);
});

Deno.test("runBlogChecks: travessão e 'aprovado pela Meta' no texto; capa ausente", async () => {
  const deps = makeDeps(makeFakeDb({ blog_posts: [{ data: [], error: null }] }).db);
  const c = await runBlogChecks(deps, checkPost({
    body_md: "Rápido — e simples. App aprovado pela Meta.",
    cover_image: null,
  }), { linkTimeoutMs: 1000 });
  assertEquals(c.copy, { em_dash: true, meta_endorsement: true });
  assertEquals(c.cover, false);
  const clean = await runBlogChecks(makeDeps(makeFakeDb({ blog_posts: [{ data: [], error: null }] }).db), checkPost(), { linkTimeoutMs: 1000 });
  assertEquals(clean.copy, { em_dash: false, meta_endorsement: false });
  assertEquals(clean.images, { ok: true, missing_license: [] });
});

Deno.test("runBlogChecks: títulos parecidos com posts do banco e em arquivo (exclui o próprio post)", async () => {
  const { db, calls } = makeFakeDb({
    blog_posts: [{
      data: [
        { id: "p-1", title: "Calendário editorial para agências: como montar o seu" },
        { id: "p-2", title: "Calendário editorial para agências: como montar o seu em 2027" },
        { id: "p-3", title: "Tendências de Reels para 2027" },
      ],
      error: null,
    }],
  });
  const c = await runBlogChecks(makeDeps(db), checkPost({ id: "p-1" }), { linkTimeoutMs: 1000 });
  assertEquals(c.similar_titles, ["Calendário editorial para agências: como montar o seu em 2027"]);
  assert(calls.some((x) => x.method === "gte" && x.args[0] === "created_at"));

  const file = await runBlogChecks(
    makeDeps(makeFakeDb({ blog_posts: [{ data: [], error: null }] }).db),
    checkPost({ title: "Mesaas ou mLabs: comparativo para agências de 2026" }),
    { linkTimeoutMs: 1000 },
  );
  assertEquals(file.similar_titles, ["Mesaas ou mLabs: comparativo para agências em 2026"]);
});

Deno.test("titleSimilarity: ignora acento, caixa e pontuação", () => {
  assertEquals(titleSimilarity("Aprovação de Posts!", "aprovacao de posts"), 1);
  assert(titleSimilarity("Guia de Reels", "Planilha financeira") < 0.6);
});

Deno.test("runBlogChecks: falha na consulta de títulos não derruba os checks", async () => {
  const deps = makeDeps(makeFakeDb({ blog_posts: [{ data: null, error: { message: "db down" } }] }).db);
  const c = await runBlogChecks(deps, checkPost(), { linkTimeoutMs: 1000 });
  assertEquals(c.similar_titles, []);
});

Deno.test("shapes das tools de blog são soltos: o SDK não barra antes do validador com os limites", () => {
  const shapes = new Map<string, Record<string, unknown>>();
  registerTools({ tool: (name: string, _d: string, shape: Record<string, unknown>) => shapes.set(name, shape) }, makeDeps(makeFakeDb({}).db));
  // deno-lint-ignore no-explicit-any
  const create = z.object(shapes.get("create_blog_draft") as any);
  assert(create.safeParse(draft({ title: "x".repeat(64), sources: [], category: "receita" })).success);
  // deno-lint-ignore no-explicit-any
  const update = z.object(shapes.get("update_blog_draft") as any);
  assert(update.safeParse({ post_id: "00000000-0000-4000-8000-000000000000", h1: "x" }).success);
});

// ---------------------------------------------------------------------------
// Fix round 1: corpo lido como árvore Markdown, imagem sozinha, prefixo e porta
// ---------------------------------------------------------------------------

function bodyRejected(body: string, needle = "body_md:") {
  const r = validateBlogDraft(draft({ body_md: body }), { partial: false });
  assert(!r.ok && r.errors.some((e) => e.includes(needle)), `${JSON.stringify(body)} → ${JSON.stringify(r)}`);
}

Deno.test("links perigosos que escapavam da regex são recusados (árvore mdast)", () => {
  bodyRejected("[a [b] c](javascript:alert(1))", "javascript:alert(1)");
  bodyRejected("> [r]: javascript:alert(1)\n\n[clique][r]", "javascript:alert(1)");
  bodyRejected("- [r]: javascript:alert(1)\n\n[clique][r]", "javascript:alert(1)");
  bodyRejected("[`]`](javascript:alert(1))", "javascript:alert(1)");
  bodyRejected("[x](javascript&#58;alert(1))", "javascript:alert(1)");
  bodyRejected("[x](https://site.example.com:8080/a)", "8080");
  bodyRejected("Fale com contato@exemplo.com", "mailto:");
});

Deno.test("HTML e imagem por referência continuam recusados", () => {
  bodyRejected("Oi <b>forte</b>", "HTML");
  bodyRejected("![x][r]\n\n[r]: https://a/b.png", "por referência");
});

Deno.test("imagem precisa ficar sozinha no parágrafo", () => {
  const msg = "imagem img:planejamento precisa ficar sozinha no próprio parágrafo";
  bodyRejected("Antes ![Equipe](img:planejamento)", msg);
  bodyRejected("![Equipe](img:planejamento) depois", msg);
  bodyRejected("Uma linha\n![Equipe](img:planejamento)\noutra linha", msg);
  bodyRejected("[![Equipe](img:planejamento)](https://example.com)", msg);
  const ok = validateBlogDraft(draft({ body_md: "Texto.\n\n![Equipe](img:planejamento)\n\nMais texto." }), { partial: false });
  assert(ok.ok, JSON.stringify(ok));
});

Deno.test("url de imagem com ../ ou %2e saindo do bucket → recusada", async () => {
  for (const url of [
    `${BUCKET_URL}../kb-images/a.png`,
    `${BUCKET_URL}drafts/%2e%2e/%2e%2e/kb-images/a.png`,
    `${BUCKET_URL}./drafts/a.png`,
    "https://sb:444/storage/v1/object/public/blog-images/a.png",
  ]) {
    const d = draft();
    const images = [{ ...(d.images as Record<string, unknown>[])[0], url }];
    const { db } = makeFakeDb({});
    await expectInputError(() => createBlogDraft(makeDeps(db), draft({ images })), "images[0].url");
  }
});

Deno.test("runBlogChecks: link com porta explícita vai para broken sem fetch", async () => {
  let fetched = 0;
  const deps = makeDeps(makeFakeDb({ blog_posts: [{ data: [], error: null }] }).db, {
    fetchUrl: async () => { fetched++; return new Response(null, { status: 200 }); },
  });
  const c = await runBlogChecks(deps, checkPost({ sources: [], body_md: "[a](https://site.example.com:8443/x)" }), { linkTimeoutMs: 1000 });
  assertEquals(c.links.broken, ["https://site.example.com:8443/x"]);
  assertEquals(fetched, 0);
});

// ---------------------------------------------------------------------------
// Fix round 2: normalização de alvo como o browser, links dos checks pela árvore, imagem em lista
// ---------------------------------------------------------------------------

Deno.test("alvos com tab/LF/CR (crus, entidade ou %0x) e controles são recusados", () => {
  bodyRejected("[x](/&#9;/evil.com)", "evil.com");
  bodyRejected("[x](/&#10;/evil.com)", "evil.com");
  bodyRejected("[x](/%09/evil.com)", "evil.com");
  bodyRejected("[x](&#9;javascript:alert(1))", "javascript:alert(1)");
  bodyRejected("[x](/&#12;/evil.com)", "body_md: link"); // form feed sobrevive à decodificação
  // CommonMark troca NUL e DEL (crus ou por entidade) por U+FFFD antes da árvore; a regra vale na função.
  assertEquals(isAllowedLinkTarget("/a\u0000b"), false);
  assertEquals(isAllowedLinkTarget("/a\u007fb"), false);
  assertEquals(isAllowedLinkTarget("\u0000/precos"), true);
  bodyRejected("[x][r]\n\n[r]: /&#9;/evil.com", "evil.com");
  const ok = validateBlogDraft(draft({ body_md: "[a](/precos) [b](#secao) [c](/blog/x?y=1#z)" }), { partial: false });
  assert(ok.ok, JSON.stringify(ok));
});

Deno.test("imagem sozinha dentro de item de lista → recusada; em citação → aceita", () => {
  bodyRejected("- ![Equipe](img:planejamento)", "nível principal");
  bodyRejected("1. Passo\n\n   ![Equipe](img:planejamento)", "nível principal");
  const ok = validateBlogDraft(draft({ body_md: "> ![Equipe](img:planejamento)" }), { partial: false });
  assert(ok.ok, JSON.stringify(ok));
});

Deno.test("collectBodyLinkUrls lê a árvore: colchetes aninhados, definição em citação, autolink", () => {
  const body = [
    "[a [b] c](https://a.example.com/1)",
    "> [r]: https://b.example.com/2",
    "",
    "Veja www.c.example.com e [rel](/precos) e [dup](https://a.example.com/1).",
  ].join("\n");
  assertEquals(collectBodyLinkUrls(body), ["https://a.example.com/1", "https://b.example.com/2", "http://www.c.example.com"]);
});

// Ações de revisão e publicação do blog no platform-admin (spec 2026-10-23-blog-automatico §7):
// aprovar dispara o deploy hook com guarda de revisão, falha do hook volta o status, a listagem
// só confirma "publicado" quando o marcador mesaas-blog-rev da página no ar bate com a revisão.
// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals } from "./assert.ts";
import {
  type BlogAdminDeps,
  handleApproveBlogPost,
  handleGetBlogPost,
  handleListBlogPosts,
  handleRejectBlogPost,
  handleRepublishBlogPost,
  handleRequestBlogChanges,
  handleRetryBlogPublish,
  handleUnpublishBlogPost,
  handleUpdateBlogPost,
  fetchLivePage,
  parseBlogRevMarker,
} from "../platform-admin/blog-posts.ts";
import { fireHook, isDeployHookConfigured } from "../_shared/vercel-deploy-hook.ts";

const H = { "Content-Type": "application/json" };
const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const BUCKET_URL = "https://sb/storage/v1/object/public/blog-images/";
// 2026-10-24 01:30 UTC = 2026-10-23 22:30 em São Paulo.
const NOW = new Date("2026-10-24T01:30:00Z");

// ---------------------------------------------------------------------------
// Banco em memória: aplica eq/in de verdade, para os testes olharem o estado final.
// ---------------------------------------------------------------------------

type Row = Record<string, any>;

function makeDb(rows: Row[]) {
  const tables: Record<string, Row[]> = { blog_posts: rows.map((r) => ({ ...r })), audit_log: [] };
  const updates: Array<{ table: string; patch: Row; matched: number }> = [];

  function from(table: string) {
    let op: "select" | "update" | "insert" = "select";
    let patch: Row = {};
    let returning = false;
    let columns = "*";
    const filters: Array<(r: Row) => boolean> = [];
    let order: { col: string; asc: boolean } | null = null;
    let limit: number | null = null;

    const run = () => {
      const all = tables[table] ??= [];
      if (op === "insert") {
        all.push({ ...patch });
        return { data: null, error: null };
      }
      let hit = all.filter((r) => filters.every((f) => f(r)));
      if (op === "update") {
        for (const r of hit) Object.assign(r, patch);
        updates.push({ table, patch, matched: hit.length });
        if (!returning) return { data: null, error: null };
      }
      if (order) {
        const { col, asc } = order;
        hit = [...hit].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1));
      }
      if (limit !== null) hit = hit.slice(0, limit);
      const pick = (r: Row) =>
        columns === "*"
          ? { ...r }
          : Object.fromEntries(columns.split(",").map((c) => c.trim()).map((c) => [c, r[c]]));
      return { data: hit.map(pick), error: null };
    };

    const b: any = {
      select(cols = "*") {
        columns = cols;
        if (op === "update") returning = true;
        return b;
      },
      update(p: Row) {
        op = "update";
        patch = p;
        return b;
      },
      insert(p: Row) {
        op = "insert";
        patch = p;
        return b;
      },
      eq(col: string, v: unknown) {
        filters.push((r) => r[col] === v);
        return b;
      },
      in(col: string, vs: unknown[]) {
        filters.push((r) => vs.includes(r[col]));
        return b;
      },
      order(col: string, o?: { ascending?: boolean }) {
        order = { col, asc: o?.ascending !== false };
        return b;
      },
      limit(n: number) {
        limit = n;
        return b;
      },
      maybeSingle() {
        const r = run();
        const data = Array.isArray(r.data) ? r.data[0] ?? null : r.data;
        return Promise.resolve({ data, error: null });
      },
      then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
        return Promise.resolve(run()).then(res, rej);
      },
    };
    return b;
  }

  const db = {
    from,
    storage: { from: () => ({ getPublicUrl: (k: string) => ({ data: { publicUrl: BUCKET_URL + k } }) }) },
  };
  const row = (id = ID) => tables.blog_posts.find((r) => r.id === id)!;
  return { db: db as any, tables, updates, row };
}

function post(over: Row = {}): Row {
  return {
    id: ID,
    slug: "calendario-editorial-para-agencias",
    status: "rascunho",
    category: "guia",
    title: "Calendário editorial para agências: como montar o seu",
    h1: "Como montar um calendário editorial que a sua agência segue",
    description:
      "Um passo a passo para montar o calendário editorial da agência, com modelos, prazos de aprovação e o que medir a cada mês de trabalho.",
    lede: "Um calendário bem feito tira a correria do fim do mês.",
    body_md: "## Por onde começar\n\nSegundo a [pesquisa](https://example.com/estudo), metade das agências atrasa posts.",
    cover_image: {
      url: `${BUCKET_URL}drafts/2026-09/capa.png`,
      alt: "Mesa com calendário",
      credit: "Fulano / Unsplash",
      license: "Unsplash License",
      source_url: "https://unsplash.com/photos/abc",
    },
    images: [],
    sources: [{ title: "Estudo de agências", publisher: "Instituto X", url: "https://example.com/estudo" }],
    feature_slug: null,
    topic_reason: "Tema evergreen com busca alta em setembro.",
    checks: {},
    revision_note: null,
    revised_after_note: false,
    rejection_reason: null,
    date: null,
    updated: null,
    revision: 1,
    live_revision: null,
    publish_attempt_at: null,
    created_at: "2026-10-23T09:00:00Z",
    approved_at: null,
    approved_by: null,
    ...over,
  };
}

function makeDeps(over: Partial<BlogAdminDeps> = {}) {
  const hookCalls: number[] = [];
  const liveCalls: string[] = [];
  const deps: BlogAdminDeps = {
    hookConfigured: () => true,
    fireHook: () => {
      hookCalls.push(1);
      return Promise.resolve(true);
    },
    fetchLive: (slug) => {
      liveCalls.push(slug);
      return Promise.resolve(null);
    },
    now: () => NOW,
    runChecks: () =>
      Promise.resolve({
        links: { ok: true, broken: [] },
        images: { ok: true, missing_license: [] },
        cover: true,
        copy: { em_dash: false, meta_endorsement: false },
        similar_titles: [],
      }),
    ...over,
  };
  return { deps, hookCalls, liveCalls };
}

async function body(res: Response) {
  return await res.json();
}

const page = (rev: number) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta content="${rev}" name="mesaas-blog-rev"></head><body></body></html>`;

// ---------------------------------------------------------------------------
// Aprovar
// ---------------------------------------------------------------------------

Deno.test("approve com expected_revision antiga → 409, nada muda e o hook não dispara", async () => {
  const { db, row, updates } = makeDb([post({ revision: 3 })]);
  const { deps, hookCalls } = makeDeps();
  const res = await handleApproveBlogPost(db, { id: ID, expected_revision: 2 }, ADMIN, H, deps);
  assertEquals(res.status, 409);
  assertEquals(hookCalls.length, 0);
  assertEquals(row().status, "rascunho");
  assertEquals(updates.filter((u) => u.matched > 0).length, 0);
});

Deno.test("approve válido → publicando, date de São Paulo, approved_*, hook uma vez, audit", async () => {
  const { db, row, tables } = makeDb([post({ status: "ajuste_solicitado", revision: 2 })]);
  const { deps, hookCalls } = makeDeps();
  const res = await handleApproveBlogPost(db, { id: ID, expected_revision: 2 }, ADMIN, H, deps);
  assertEquals(res.status, 200);
  assertEquals(hookCalls.length, 1);
  const r = row();
  assertEquals(r.status, "publicando");
  assertEquals(r.date, "2026-10-23");
  assertEquals(r.approved_by, ADMIN);
  assertEquals(r.approved_at, NOW.toISOString());
  assertEquals(r.publish_attempt_at, NOW.toISOString());
  assertEquals((await body(res)).post.status, "publicando");
  const audit = tables.audit_log;
  assertEquals(audit.length, 1);
  assertEquals(audit[0].action, "blog.approve");
  assertEquals(audit[0].resource_id, ID);
  assertEquals(audit[0].actor_user_id, ADMIN);
});

Deno.test("approve mantém a date que já existia", async () => {
  const { db, row } = makeDb([post({ date: "2026-10-01" })]);
  const { deps } = makeDeps();
  const res = await handleApproveBlogPost(db, { id: ID, expected_revision: 1 }, ADMIN, H, deps);
  assertEquals(res.status, 200);
  assertEquals(row().date, "2026-10-01");
});

Deno.test("approve com hook falhando → volta ao status anterior e responde 502", async () => {
  const { db, row, tables } = makeDb([post({ status: "ajuste_solicitado", revision: 2 })]);
  const { deps } = makeDeps({ fireHook: () => Promise.resolve(false) });
  const res = await handleApproveBlogPost(db, { id: ID, expected_revision: 2 }, ADMIN, H, deps);
  assertEquals(res.status, 502);
  assertEquals((await body(res)).error, "deploy_hook_failed");
  const r = row();
  assertEquals(r.status, "ajuste_solicitado");
  assertEquals(r.date, null);
  assertEquals(r.approved_at, null);
  assertEquals(r.approved_by, null);
  assertEquals(r.publish_attempt_at, null);
  assertEquals(tables.audit_log.length, 0);
});

Deno.test("approve com hook lançando → tratado como falha (502, status volta)", async () => {
  const { db, row } = makeDb([post()]);
  const { deps } = makeDeps({ fireHook: () => Promise.reject(new Error("boom")) });
  const res = await handleApproveBlogPost(db, { id: ID, expected_revision: 1 }, ADMIN, H, deps);
  assertEquals(res.status, 502);
  assertEquals(row().status, "rascunho");
});

Deno.test("approve sem hook configurado → 503 antes de mudar qualquer coisa", async () => {
  const { db, row, updates } = makeDb([post()]);
  const { deps, hookCalls } = makeDeps({ hookConfigured: () => false });
  const res = await handleApproveBlogPost(db, { id: ID, expected_revision: 1 }, ADMIN, H, deps);
  assertEquals(res.status, 503);
  assertEquals((await body(res)).error, "publish_unavailable");
  assertEquals(row().status, "rascunho");
  assertEquals(updates.length, 0);
  assertEquals(hookCalls.length, 0);
});

Deno.test("approve de post rejeitado ou já publicado → 409", async () => {
  for (const status of ["rejeitado", "publicado", "publicando", "despublicado"]) {
    const { db, row } = makeDb([post({ status })]);
    const { deps, hookCalls } = makeDeps();
    const res = await handleApproveBlogPost(db, { id: ID, expected_revision: 1 }, ADMIN, H, deps);
    assertEquals(res.status, 409, status);
    assertEquals(row().status, status);
    assertEquals(hookCalls.length, 0);
  }
});

Deno.test("approve: id inválido ou expected_revision ausente → 400; id desconhecido → 404", async () => {
  const { db } = makeDb([post()]);
  const { deps } = makeDeps();
  assertEquals((await handleApproveBlogPost(db, { id: "x", expected_revision: 1 }, ADMIN, H, deps)).status, 400);
  assertEquals((await handleApproveBlogPost(db, { id: ID }, ADMIN, H, deps)).status, 400);
  assertEquals((await handleApproveBlogPost(db, { id: ID, expected_revision: 1.5 }, ADMIN, H, deps)).status, 400);
  assertEquals((await handleApproveBlogPost(db, { id: ID2, expected_revision: 1 }, ADMIN, H, deps)).status, 404);
});

// ---------------------------------------------------------------------------
// Listagem + confirmação no ar
// ---------------------------------------------------------------------------

Deno.test("parseBlogRevMarker: ordem dos atributos, aspas e ausência", () => {
  assertEquals(parseBlogRevMarker(`<meta name="mesaas-blog-rev" content="7">`), 7);
  assertEquals(parseBlogRevMarker(`<meta content='12' name='mesaas-blog-rev' />`), 12);
  assertEquals(parseBlogRevMarker(`<META NAME=mesaas-blog-rev CONTENT=3>`), 3);
  assertEquals(parseBlogRevMarker(`<meta name="description" content="5"><meta name="mesaas-blog-rev" content="2">`), 2);
  assertEquals(parseBlogRevMarker(`<meta name="mesaas-blog-rev-x" content="2">`), null);
  assertEquals(parseBlogRevMarker(`<meta name="mesaas-blog-rev" content="abc">`), null);
  assertEquals(parseBlogRevMarker(`<html></html>`), null);
});

Deno.test("list publicando rev 2 com página no ar em rev 1 → continua publicando", async () => {
  const { db, row } = makeDb([post({ status: "publicando", revision: 2, live_revision: 1 })]);
  const { deps } = makeDeps({ fetchLive: () => Promise.resolve(page(1)) });
  const res = await handleListBlogPosts(db, { tab: "aguardando" }, ADMIN, H, deps);
  assertEquals(res.status, 200);
  assertEquals(row().status, "publicando");
  assertEquals(row().live_revision, 1);
  const out = await body(res);
  assertEquals(out.posts[0].status, "publicando");
});

Deno.test("list publicando rev 2 com página no ar em rev 2 → publicado, live_revision 2", async () => {
  const { db, row } = makeDb([post({ status: "publicando", revision: 2, live_revision: 1 })]);
  const { deps } = makeDeps({ fetchLive: () => Promise.resolve(page(2)) });
  const res = await handleListBlogPosts(db, { tab: "aguardando" }, ADMIN, H, deps);
  assertEquals(res.status, 200);
  assertEquals(row().status, "publicado");
  assertEquals(row().live_revision, 2);
  const out = await body(res);
  // A resposta reflete a virada (some da aba Aguardando).
  assertEquals(out.posts.length, 0);
});

Deno.test("list com fetchLive lançando → continua publicando e responde 200", async () => {
  const { db, row } = makeDb([post({ status: "publicando", revision: 2 })]);
  const { deps } = makeDeps({ fetchLive: () => Promise.reject(new Error("timeout")) });
  const res = await handleListBlogPosts(db, { tab: "aguardando" }, ADMIN, H, deps);
  assertEquals(res.status, 200);
  assertEquals(row().status, "publicando");
  assertEquals((await body(res)).posts[0].status, "publicando");
});

Deno.test("list: sem body_md, filtra pela aba, last_draft_at de todos os status, no máximo 10 checagens", async () => {
  const rows = [
    post({ id: ID, status: "rascunho", created_at: "2026-10-20T09:00:00Z" }),
    post({ id: ID2, status: "rejeitado", created_at: "2026-10-22T09:00:00Z" }),
  ];
  for (let i = 0; i < 12; i++) {
    rows.push(post({
      id: `33333333-3333-4333-8333-${String(i).padStart(12, "0")}`,
      slug: `post-${i}`,
      status: "publicando",
      created_at: `2026-10-0${(i % 9) + 1}T09:00:00Z`,
    }));
  }
  const { db } = makeDb(rows);
  const live: string[] = [];
  const { deps } = makeDeps({ fetchLive: (slug) => (live.push(slug), Promise.resolve(null)) });
  const res = await handleListBlogPosts(db, { tab: "aguardando" }, ADMIN, H, deps);
  const out = await body(res);
  assertEquals(out.posts.length, 13);
  assert(out.posts.every((p: Row) => !("body_md" in p)));
  assert(out.posts.every((p: Row) => p.status !== "rejeitado"));
  assertEquals(out.last_draft_at, "2026-10-22T09:00:00Z");
  assertEquals(live.length, 10);

  const rej = await body(await handleListBlogPosts(db, { tab: "rejeitados" }, ADMIN, H, deps));
  assertEquals(rej.posts.map((p: Row) => p.id), [ID2]);
});

Deno.test("list: aba publicados traz publicado e despublicado; aba inválida → 400", async () => {
  const { db } = makeDb([post({ status: "publicado" }), post({ id: ID2, status: "despublicado" })]);
  const { deps } = makeDeps();
  const out = await body(await handleListBlogPosts(db, { tab: "publicados" }, ADMIN, H, deps));
  assertEquals(out.posts.map((p: Row) => p.status).sort(), ["despublicado", "publicado"]);
  assertEquals((await handleListBlogPosts(db, { tab: "todos" }, ADMIN, H, deps)).status, 400);
});

Deno.test("get-blog-post → linha completa; desconhecido → 404", async () => {
  const { db } = makeDb([post()]);
  const out = await body(await handleGetBlogPost(db, { id: ID }, H));
  assertEquals(out.post.body_md.startsWith("## Por onde"), true);
  assertEquals((await handleGetBlogPost(db, { id: ID2 }, H)).status, 404);
});

// ---------------------------------------------------------------------------
// Editar texto
// ---------------------------------------------------------------------------

Deno.test("editar post publicado → publicando, revision +1, live_revision igual, updated, hook uma vez", async () => {
  const { db, row, tables } = makeDb([
    post({ status: "publicado", revision: 2, live_revision: 2, date: "2026-10-01" }),
  ]);
  const { deps, hookCalls } = makeDeps();
  const res = await handleUpdateBlogPost(db, { id: ID, fields: { lede: "Um lede novo." } }, ADMIN, H, deps);
  assertEquals(res.status, 200);
  const r = row();
  assertEquals(r.status, "publicando");
  assertEquals(r.revision, 3);
  assertEquals(r.live_revision, 2);
  assertEquals(r.lede, "Um lede novo.");
  assertEquals(r.updated, "2026-10-23");
  assertEquals(r.date, "2026-10-01");
  assertEquals(r.publish_attempt_at, NOW.toISOString());
  assertEquals(hookCalls.length, 1);
  assertEquals(tables.audit_log[0].action, "blog.edit");
  assert(!JSON.stringify(tables.audit_log[0].metadata).includes("lede novo"));
});

Deno.test("editar rascunho → revision +1, status igual, checks regravados, sem hook", async () => {
  const { db, row } = makeDb([post()]);
  const { deps, hookCalls } = makeDeps();
  const res = await handleUpdateBlogPost(db, { id: ID, fields: { lede: "Outro lede." } }, ADMIN, H, deps);
  assertEquals(res.status, 200);
  assertEquals(row().status, "rascunho");
  assertEquals(row().revision, 2);
  assertEquals(row().updated, null);
  assertEquals(row().checks.cover, true);
  assertEquals(hookCalls.length, 0);
});

Deno.test("editar: campo inválido → 400 com os erros; campo não editável → 400; status rejeitado → 409", async () => {
  const { db, row } = makeDb([post(), post({ id: ID2, status: "rejeitado" })]);
  const { deps } = makeDeps();
  const bad = await handleUpdateBlogPost(db, { id: ID, fields: { title: "curto" } }, ADMIN, H, deps);
  assertEquals(bad.status, 400);
  const out = await body(bad);
  assertEquals(out.error, "invalid_fields");
  assert(out.details.some((e: string) => e.startsWith("title:")));
  assertEquals(row().revision, 1);
  assertEquals((await handleUpdateBlogPost(db, { id: ID, fields: { slug: "outro-slug" } }, ADMIN, H, deps)).status, 400);
  assertEquals((await handleUpdateBlogPost(db, { id: ID, fields: {} }, ADMIN, H, deps)).status, 400);
  assertEquals((await handleUpdateBlogPost(db, { id: ID2, fields: { lede: "x" } }, ADMIN, H, deps)).status, 409);
});

Deno.test("editar com expected_revision antiga → 409 sem gravar", async () => {
  const { db, row } = makeDb([post({ revision: 4 })]);
  const { deps } = makeDeps();
  const res = await handleUpdateBlogPost(db, { id: ID, expected_revision: 3, fields: { lede: "x." } }, ADMIN, H, deps);
  assertEquals(res.status, 409);
  assertEquals(row().revision, 4);
});

Deno.test("editar publicado sem hook configurado → 503 sem gravar", async () => {
  const { db, row } = makeDb([post({ status: "publicado", revision: 2 })]);
  const { deps } = makeDeps({ hookConfigured: () => false });
  const res = await handleUpdateBlogPost(db, { id: ID, fields: { lede: "x." } }, ADMIN, H, deps);
  assertEquals(res.status, 503);
  assertEquals(row().revision, 2);
  assertEquals(row().status, "publicado");
});

Deno.test("editar publicado com hook falhando → texto salvo, fica publicando, 502", async () => {
  const { db, row } = makeDb([post({ status: "publicado", revision: 2, live_revision: 2 })]);
  const { deps } = makeDeps({ fireHook: () => Promise.resolve(false) });
  const res = await handleUpdateBlogPost(db, { id: ID, fields: { lede: "Novo." } }, ADMIN, H, deps);
  assertEquals(res.status, 502);
  const out = await body(res);
  assertEquals(out.error, "deploy_hook_failed");
  assertEquals(out.saved, true);
  assertEquals(row().status, "publicando");
  assertEquals(row().revision, 3);
});

// ---------------------------------------------------------------------------
// Despublicar, republicar, tentar de novo
// ---------------------------------------------------------------------------

Deno.test("despublicar e republicar: transições e hook a cada uma", async () => {
  const { db, row, tables } = makeDb([post({ status: "publicado", revision: 2, live_revision: 2 })]);
  const { deps, hookCalls } = makeDeps();
  const un = await handleUnpublishBlogPost(db, { id: ID }, ADMIN, H, deps);
  assertEquals(un.status, 200);
  assertEquals(row().status, "despublicado");
  assertEquals(hookCalls.length, 1);

  const re = await handleRepublishBlogPost(db, { id: ID }, ADMIN, H, deps);
  assertEquals(re.status, 200);
  assertEquals(row().status, "publicando");
  assertEquals(row().publish_attempt_at, NOW.toISOString());
  assertEquals(hookCalls.length, 2);
  assertEquals(tables.audit_log.map((a) => a.action), ["blog.unpublish", "blog.republish"]);
});

Deno.test("despublicar rascunho → 409; republicar publicado → 409", async () => {
  const { db, row } = makeDb([post(), post({ id: ID2, status: "publicado" })]);
  const { deps, hookCalls } = makeDeps();
  assertEquals((await handleUnpublishBlogPost(db, { id: ID }, ADMIN, H, deps)).status, 409);
  assertEquals(row().status, "rascunho");
  assertEquals((await handleRepublishBlogPost(db, { id: ID2 }, ADMIN, H, deps)).status, 409);
  assertEquals(hookCalls.length, 0);
});

Deno.test("despublicar/republicar com hook falhando → status volta e 502", async () => {
  const { db, row } = makeDb([post({ status: "publicado" }), post({ id: ID2, status: "despublicado" })]);
  const { deps } = makeDeps({ fireHook: () => Promise.resolve(false) });
  assertEquals((await handleUnpublishBlogPost(db, { id: ID }, ADMIN, H, deps)).status, 502);
  assertEquals(row().status, "publicado");
  assertEquals((await handleRepublishBlogPost(db, { id: ID2 }, ADMIN, H, deps)).status, 502);
  assertEquals(row(ID2).status, "despublicado");
});

Deno.test("retry: só publicando; atualiza publish_attempt_at e dispara o hook", async () => {
  const { db, row } = makeDb([
    post({ status: "publicando", publish_attempt_at: "2026-10-23T10:00:00Z" }),
    post({ id: ID2 }),
  ]);
  const { deps, hookCalls } = makeDeps();
  assertEquals((await handleRetryBlogPublish(db, { id: ID }, ADMIN, H, deps)).status, 200);
  assertEquals(row().publish_attempt_at, NOW.toISOString());
  assertEquals(row().status, "publicando");
  assertEquals(hookCalls.length, 1);
  assertEquals((await handleRetryBlogPublish(db, { id: ID2 }, ADMIN, H, deps)).status, 409);
  const failing = makeDeps({ fireHook: () => Promise.resolve(false) }).deps;
  assertEquals((await handleRetryBlogPublish(db, { id: ID }, ADMIN, H, failing)).status, 502);
  assertEquals(row().status, "publicando");
});

// ---------------------------------------------------------------------------
// Pedir ajuste, rejeitar
// ---------------------------------------------------------------------------

Deno.test("pedir ajuste com nota vazia ou longa demais → 400", async () => {
  const { db, row } = makeDb([post()]);
  const { deps } = makeDeps();
  for (const note of [undefined, "", "   ", "x".repeat(1001)]) {
    assertEquals((await handleRequestBlogChanges(db, { id: ID, note }, ADMIN, H, deps)).status, 400);
  }
  assertEquals(row().status, "rascunho");
});

Deno.test("pedir ajuste → ajuste_solicitado com a nota e o chip de reescrita zerado", async () => {
  const { db, row, tables } = makeDb([post({ revised_after_note: true })]);
  const { deps } = makeDeps();
  const res = await handleRequestBlogChanges(db, { id: ID, note: "  Troque o exemplo.  " }, ADMIN, H, deps);
  assertEquals(res.status, 200);
  assertEquals(row().status, "ajuste_solicitado");
  assertEquals(row().revision_note, "Troque o exemplo.");
  assertEquals(row().revised_after_note, false);
  assertEquals(tables.audit_log[0].action, "blog.request_changes");
});

Deno.test("rejeitar → rejeitado com motivo opcional; publicado não pode ser rejeitado", async () => {
  const { db, row } = makeDb([post(), post({ id: ID2, status: "publicado" })]);
  const { deps } = makeDeps();
  assertEquals((await handleRejectBlogPost(db, { id: ID, reason: "Fora do tema." }, ADMIN, H, deps)).status, 200);
  assertEquals(row().status, "rejeitado");
  assertEquals(row().rejection_reason, "Fora do tema.");
  assertEquals((await handleRejectBlogPost(db, { id: ID2 }, ADMIN, H, deps)).status, 409);
  assertEquals((await handleRejectBlogPost(db, { id: ID, reason: "x".repeat(1001) }, ADMIN, H, deps)).status, 400);
});

Deno.test("fetchLivePage: GET com timeout e sem seguir redirect; 404 ou erro → null", async () => {
  let url = "";
  let init: RequestInit | undefined;
  const html = await fetchLivePage("meu-post", (u, i) => ((url = u), (init = i), Promise.resolve(new Response(page(4)))));
  assertEquals(url, "https://www.mesaas.com.br/blog/meu-post");
  assert(init?.signal instanceof AbortSignal);
  assertEquals(init?.redirect, "manual");
  assertEquals(parseBlogRevMarker(html ?? ""), 4);
  assertEquals(await fetchLivePage("x", () => Promise.resolve(new Response("nf", { status: 404 }))), null);
  assertEquals(await fetchLivePage("x", () => Promise.resolve(new Response(null, { status: 308 }))), null);
  assertEquals(await fetchLivePage("x", () => Promise.reject(new DOMException("t", "TimeoutError"))), null);
});

// ---------------------------------------------------------------------------
// Deploy hook e gate
// ---------------------------------------------------------------------------

Deno.test("fireHook: POST com timeout, true só em 2xx, false em erro, sem env não chama", async () => {
  const prev = Deno.env.get("VERCEL_BLOG_DEPLOY_HOOK");
  try {
    Deno.env.delete("VERCEL_BLOG_DEPLOY_HOOK");
    assertEquals(isDeployHookConfigured(), false);
    let calls = 0;
    assertEquals(await fireHook(() => (calls++, Promise.resolve(new Response("ok")))), false);
    assertEquals(calls, 0);

    Deno.env.set("VERCEL_BLOG_DEPLOY_HOOK", "https://api.vercel.com/v1/integrations/deploy/prj/abc");
    assertEquals(isDeployHookConfigured(), true);
    let init: RequestInit | undefined;
    assertEquals(await fireHook((_u, i) => ((init = i), Promise.resolve(new Response("ok")))), true);
    assertEquals(init?.method, "POST");
    assert(init?.signal instanceof AbortSignal);
    assertEquals(await fireHook(() => Promise.resolve(new Response("no", { status: 500 }))), false);
    assertEquals(await fireHook(() => Promise.reject(new DOMException("t", "TimeoutError"))), false);

    Deno.env.set("VERCEL_BLOG_DEPLOY_HOOK", "http://insecure.example/hook");
    assertEquals(isDeployHookConfigured(), false);
  } finally {
    if (prev === undefined) Deno.env.delete("VERCEL_BLOG_DEPLOY_HOOK");
    else Deno.env.set("VERCEL_BLOG_DEPLOY_HOOK", prev);
  }
});

Deno.test("platform-admin: toda ação do blog fica atrás do gate de admin (não admin → 403)", async () => {
  const src = await Deno.readTextFile(new URL("../platform-admin/index.ts", import.meta.url));
  const gate = src.indexOf("if (!admin)");
  assert(gate > 0, "admin gate not found");
  assert(src.slice(gate, gate + 200).includes("403"), "gate must answer 403");
  for (
    const action of [
      "list-blog-posts", "get-blog-post", "update-blog-post", "approve-blog-post", "request-blog-changes",
      "reject-blog-post", "unpublish-blog-post", "republish-blog-post", "retry-blog-publish",
    ]
  ) {
    const at = src.indexOf(`case "${action}":`);
    assert(at > gate, `${action} must be dispatched after the admin gate`);
  }
});

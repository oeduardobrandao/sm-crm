import { assert, assertEquals } from "./assert.ts";
import { type CommentsRouteDeps, handleCommentsRoute } from "../instagram-analytics/comments-routes.ts";
import type { IgComment } from "../instagram-analytics/comments-graph.ts";
import { AiBadOutputError, AiTimeoutError } from "../instagram-analytics/comments-ai.ts";
import { IgApiError } from "../_shared/instagram-messaging.ts";

const NOW = Date.parse("2026-11-03T12:00:00.000Z");
const DAY = 86_400_000;
const CONTA = "22222222-2222-2222-2222-222222222222";
const USER = "11111111-1111-1111-1111-111111111111";
const ACC_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const IG_USER = "17841400000000001";
const SCOPE = "instagram_business_manage_comments";

type Row = Record<string, unknown>;

/** Fake Supabase: filtra em memória e grava upserts. */
function makeSvc(tables: Record<string, Row[]>) {
  const upserts: { table: string; row: Row; opts: unknown }[] = [];
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let order: { col: string; asc: boolean } | null = null;
    let lim: number | null = null;
    const run = () => {
      let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      if (order) {
        const { col, asc } = order;
        rows = [...rows].sort((a, b) => (Number(a[col]) - Number(b[col])) * (asc ? 1 : -1));
      }
      if (lim !== null) rows = rows.slice(0, lim);
      return rows;
    };
    // deno-lint-ignore no-explicit-any
    const chain: any = {
      select: () => chain,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), chain),
      is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), chain),
      gt: (c: string, v: number) => (filters.push((r) => Number(r[c]) > v), chain),
      gte: (c: string, v: string) => (filters.push((r) => String(r[c] ?? "") >= v), chain),
      order: (col: string, o?: { ascending?: boolean }) => {
        order = { col, asc: o?.ascending !== false };
        return chain;
      },
      limit: (n: number) => ((lim = n), chain),
      maybeSingle: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: run()[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve({ data: run(), error: null }).then(res, rej),
      upsert: (row: Row, opts: unknown) => {
        upserts.push({ table, row, opts });
        return Promise.resolve({ data: null, error: null });
      },
    };
    return chain;
  };
  return { svc: { from }, upserts };
}

function account(over: Row = {}): Row {
  return {
    id: ACC_ID,
    client_id: "7",
    instagram_user_id: IG_USER,
    encrypted_access_token: "enc",
    authorization_status: "active",
    permissions: ["instagram_business_basic", SCOPE],
    ...over,
  };
}

function post(id: string, comments: number, daysAgo = 1, over: Row = {}): Row {
  return {
    instagram_account_id: ACC_ID,
    instagram_post_id: id,
    caption: `legenda ${id}`,
    media_type: "IMAGE",
    comments,
    posted_at: new Date(NOW - daysAgo * DAY).toISOString(),
    ...over,
  };
}

function comments(n: number, prefix = "c"): IgComment[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i}`,
    text: `comentário ${i} de ${prefix}`,
    timestamp: "2026-11-02T10:00:00+0000",
    username: `fulano_${prefix}${i}`,
    like_count: 0,
    replies_count: 0,
    replies_more: false,
  }));
}

function goodRaw(over: Record<string, unknown> = {}) {
  return {
    sentimento_geral: "positivo",
    resumo: "O público gostou bastante.",
    distribuicao: { apoio: 60, duvida: 20, critica: 10, discussao: 5, spam: 5 },
    temas: [{ tema: "Preço", peso: 40, exemplo: "quanto custa?", post_ids: ["p1", "intruso"] }],
    perguntas_frequentes: ["Qual o preço?"],
    ideias: [
      { titulo: "Ideia 1", descricao: "Desc 1", motivo: "Motivo 1" },
      { titulo: "Ideia 2", descricao: "Desc 2", motivo: "Motivo 2" },
      { titulo: "Ideia 3", descricao: "Desc 3", motivo: "Motivo 3" },
    ],
    ...over,
  };
}

interface Calls {
  graph: { mediaId: string; max: number; deadlineAt: number }[];
  gemini: { prompt: string; deadlineAt: number }[];
  rate: string[];
}

function setup(opts: {
  tables?: Record<string, Row[]>;
  graph?: (mediaId: string, max: number) => IgComment[] | Error;
  gemini?: () => unknown;
  geminiKey?: string | null;
  rateOk?: boolean;
} = {}) {
  const tables = opts.tables ?? {
    instagram_accounts: [account()],
    instagram_posts: [post("p1", 12)],
    instagram_comment_analyses: [],
  };
  const { svc, upserts } = makeSvc(tables);
  const calls: Calls = { graph: [], gemini: [], rate: [] };
  const deps: CommentsRouteDeps = {
    // deno-lint-ignore no-explicit-any
    svc: svc as any,
    contaId: CONTA,
    userId: USER,
    geminiKey: opts.geminiKey === undefined ? "key" : opts.geminiKey,
    now: () => NOW,
    decryptToken: () => Promise.resolve("tok"),
    verifyClientOwnership: () => Promise.resolve(),
    rateLimit: (key) => {
      calls.rate.push(key);
      return Promise.resolve(opts.rateOk ?? true);
    },
    fetchComments: (_d, args) => {
      calls.graph.push({ mediaId: args.mediaId, max: args.max, deadlineAt: args.deadlineAt });
      const r = opts.graph ? opts.graph(args.mediaId, args.max) : comments(8);
      if (r instanceof Error) return Promise.reject(r);
      return Promise.resolve({ comments: r.slice(0, args.max), truncated: r.length > args.max });
    },
    callGemini: (_d, args) => {
      calls.gemini.push({ prompt: args.prompt, deadlineAt: args.deadlineAt });
      try {
        return Promise.resolve(opts.gemini ? opts.gemini() : goodRaw());
      } catch (e) {
        return Promise.reject(e);
      }
    },
  };
  return { deps, upserts, calls, tables };
}

// deno-lint-ignore no-explicit-any
const body = (r: { body: unknown } | null): any => r?.body;

Deno.test("rota fora da família devolve null", async () => {
  const { deps } = setup();
  assertEquals(await handleCommentsRoute("GET", "/overview/7", deps), null);
  assertEquals(await handleCommentsRoute("POST", "/post-comments/7/p1", deps), null);
  assertEquals(await handleCommentsRoute("GET", "/comments-analysis/7/p1", deps), null);
});

Deno.test("sem escopo de comentários → 409 missing_comments_scope sem chamar a Graph", async () => {
  const { deps, calls } = setup({
    tables: {
      instagram_accounts: [account({ permissions: ["instagram_business_basic"] })],
      instagram_posts: [post("p1", 12)],
    },
  });
  const r = await handleCommentsRoute("GET", "/post-comments/7/p1", deps);
  assertEquals(r?.status, 409);
  assertEquals(body(r), { error: "missing_comments_scope" });
  assertEquals(calls.graph.length, 0);
  assertEquals(calls.rate.length, 0);
});

Deno.test("conta inativa → 404 account_not_found", async () => {
  const { deps, calls } = setup({
    tables: { instagram_accounts: [account({ authorization_status: "expired" })], instagram_posts: [] },
  });
  const r = await handleCommentsRoute("GET", "/post-comments/7/p1", deps);
  assertEquals(r?.status, 404);
  assertEquals(body(r), { error: "account_not_found" });
  assertEquals(calls.graph.length, 0);
});

Deno.test("post de outra conta → 404", async () => {
  const { deps, calls } = setup({
    tables: {
      instagram_accounts: [account()],
      instagram_posts: [post("p9", 12, 1, { instagram_account_id: "outra-conta" })],
    },
  });
  const r = await handleCommentsRoute("GET", "/post-comments/7/p9", deps);
  assertEquals(r?.status, 404);
  assertEquals(body(r), { error: "post_not_found" });
  assertEquals(calls.graph.length, 0);
});

Deno.test("GET post-comments devolve cached_analysis só do ig_user_id atual", async () => {
  const stored = {
    instagram_account_id: ACC_ID,
    scope: "post",
    instagram_post_id: "p1",
    result: { resumo: "x" },
    comments_analyzed: 8,
    comments_count_at_analysis: 10,
    analyzed_at: "2026-11-01T00:00:00.000Z",
    period_start: null,
    period_end: null,
  };
  const old = setup({
    tables: {
      instagram_accounts: [account()],
      instagram_posts: [post("p1", 12)],
      instagram_comment_analyses: [{ ...stored, ig_user_id: "conta-antiga" }],
    },
  });
  const r1 = await handleCommentsRoute("GET", "/post-comments/7/p1", old.deps);
  assertEquals(r1?.status, 200);
  assertEquals(body(r1).cached_analysis, null);
  assertEquals(body(r1).total_fetched, 8);
  assertEquals(body(r1).truncated, false);
  assertEquals(body(r1).comments_count, 12);
  assertEquals(body(r1).comments.length, 8);
  assertEquals(body(r1).comments[0].username, "fulano_c0");
  assertEquals(old.calls.rate, [`ig-comments-read:${CONTA}`]);
  assertEquals(old.calls.graph[0], { mediaId: "p1", max: 200, deadlineAt: NOW + 50_000 });

  const cur = setup({
    tables: {
      instagram_accounts: [account()],
      instagram_posts: [post("p1", 12)],
      instagram_comment_analyses: [{ ...stored, ig_user_id: IG_USER }],
    },
  });
  const r2 = await handleCommentsRoute("GET", "/post-comments/7/p1", cur.deps);
  assertEquals(body(r2).cached_analysis, {
    result: { resumo: "x" },
    comments_analyzed: 8,
    comments_count_at_analysis: 10,
    analyzed_at: "2026-11-01T00:00:00.000Z",
    period_start: null,
    period_end: null,
  });
});

Deno.test("postId codificado na URL é decodificado; id inválido → 404", async () => {
  const { deps, calls } = setup({
    tables: { instagram_accounts: [account()], instagram_posts: [post("1790", 3)] },
  });
  const ok = await handleCommentsRoute("GET", "/post-comments/7/%31790", deps);
  assertEquals(ok?.status, 200);
  assertEquals(calls.graph[0].mediaId, "1790");
  const bad = await handleCommentsRoute("GET", "/post-comments/7/a%2Fb", deps);
  assertEquals(bad?.status, 404);
});

Deno.test("POST com 4 comentários → 422 too_few_comments sem chamar Gemini", async () => {
  const { deps, calls, upserts } = setup({ graph: () => comments(4) });
  const r = await handleCommentsRoute("POST", "/comments-analysis/7/p1", deps);
  assertEquals(r?.status, 422);
  assertEquals(body(r), { error: "too_few_comments" });
  assertEquals(calls.gemini.length, 0);
  assertEquals(upserts.length, 0);
});

Deno.test("POST manda à IA só textos, grava upsert com analyzed_at novo e ideias com id", async () => {
  const { deps, calls, upserts } = setup();
  const r = await handleCommentsRoute("POST", "/comments-analysis/7/p1", deps);
  assertEquals(r?.status, 200);
  assertEquals(calls.rate, [`ig-comments-ai:${CONTA}`]);
  assertEquals(calls.graph[0], { mediaId: "p1", max: 200, deadlineAt: NOW + 20_000 });
  assertEquals(calls.gemini.length, 1);
  assertEquals(calls.gemini[0].deadlineAt, NOW + 50_000);
  const prompt = calls.gemini[0].prompt;
  assert(prompt.includes("comentário 3 de c"), "prompt leva o texto");
  assert(!prompt.includes("fulano_"), "prompt não leva username");
  assert(prompt.includes("legenda p1"), "prompt leva a legenda");

  assertEquals(upserts.length, 1);
  const u = upserts[0];
  assertEquals(u.table, "instagram_comment_analyses");
  assertEquals(u.opts, { onConflict: "instagram_account_id,scope,instagram_post_id" });
  assertEquals(u.row.conta_id, CONTA);
  assertEquals(u.row.instagram_account_id, ACC_ID);
  assertEquals(u.row.ig_user_id, IG_USER);
  assertEquals(u.row.scope, "post");
  assertEquals(u.row.instagram_post_id, "p1");
  assertEquals(u.row.comments_analyzed, 8);
  assertEquals(u.row.comments_count_at_analysis, 12);
  assertEquals(u.row.period_start, null);
  assertEquals(u.row.period_end, null);
  assertEquals(u.row.model, "gemini-2.5-flash-lite");
  assertEquals(u.row.analyzed_by, USER);
  assertEquals(u.row.analyzed_at, new Date(NOW).toISOString());
  // deno-lint-ignore no-explicit-any
  const result = u.row.result as any;
  assertEquals(result.ideias.length, 3);
  for (const i of result.ideias) assert(/^[0-9a-f-]{36}$/.test(i.id), "ideia com uuid");
  // post_ids só existem na análise de conta (sem allowPostIds são descartados)
  assertEquals(result.temas[0].post_ids, undefined);

  const a = body(r).analysis;
  assertEquals(a.result, result);
  assertEquals(a.analyzed_at, new Date(NOW).toISOString());
  assertEquals(a.comments_analyzed, 8);
  assertEquals(a.comments_count_at_analysis, 12);
});

Deno.test("POST: comments_count_at_analysis usa o maior entre o espelho e o buscado", async () => {
  const { deps, upserts } = setup({
    tables: { instagram_accounts: [account()], instagram_posts: [post("p1", 2)] },
  });
  await handleCommentsRoute("POST", "/comments-analysis/7/p1", deps);
  assertEquals(upserts[0].row.comments_count_at_analysis, 8);
});

Deno.test("POST redige username no resultado gravado", async () => {
  const { deps, upserts } = setup({
    gemini: () =>
      goodRaw({
        resumo: "fulano_c1 elogiou e @marcia.souza também.",
        ideias: [
          { titulo: "Responder FULANO_C2", descricao: "Desc", motivo: "Motivo" },
          { titulo: "Ideia 2", descricao: "Desc 2", motivo: "Motivo 2" },
          { titulo: "Ideia 3", descricao: "Desc 3", motivo: "Motivo 3" },
        ],
      }),
  });
  const r = await handleCommentsRoute("POST", "/comments-analysis/7/p1", deps);
  assertEquals(r?.status, 200);
  // deno-lint-ignore no-explicit-any
  const result = upserts[0].row.result as any;
  assertEquals(result.resumo, "alguém do público elogiou e alguém do público também.");
  assertEquals(result.ideias[0].titulo, "Responder alguém do público");
  assert(!JSON.stringify(result).includes("fulano"), "nenhum username sobra");
});

Deno.test("Gemini sem chave → 503 ai_unavailable; GET de comentários segue 200", async () => {
  const { deps, calls } = setup({ geminiKey: null });
  const r = await handleCommentsRoute("POST", "/comments-analysis/7/p1", deps);
  assertEquals(r?.status, 503);
  assertEquals(body(r), { error: "ai_unavailable" });
  assertEquals(calls.graph.length, 0);
  assertEquals(calls.rate.length, 0);
  const acc = await handleCommentsRoute("POST", "/comments-analysis-account/7", deps);
  assertEquals(acc?.status, 503);
  const g = await handleCommentsRoute("GET", "/post-comments/7/p1", deps);
  assertEquals(g?.status, 200);
});

Deno.test("AiTimeoutError → 504 ai_timeout", async () => {
  const { deps, upserts } = setup({
    gemini: () => {
      throw new AiTimeoutError("deadline");
    },
  });
  const r = await handleCommentsRoute("POST", "/comments-analysis/7/p1", deps);
  assertEquals(r?.status, 504);
  assertEquals(body(r), { error: "ai_timeout" });
  assertEquals(upserts.length, 0);
});

Deno.test("AiBadOutputError ou validação null → 502 ai_bad_output, sem upsert", async () => {
  for (
    const gemini of [
      () => {
        throw new AiBadOutputError("not_json");
      },
      () => ({ nada: true }),
      () => goodRaw({ ideias: [{ titulo: "só uma", descricao: "d", motivo: "m" }] }),
    ]
  ) {
    const { deps, upserts } = setup({ gemini });
    const r = await handleCommentsRoute("POST", "/comments-analysis/7/p1", deps);
    assertEquals(r?.status, 502);
    assertEquals(body(r), { error: "ai_bad_output" });
    assertEquals(upserts.length, 0);
  }
});

Deno.test("gemini_unavailable e gemini_http_* → 503 ai_unavailable", async () => {
  for (const msg of ["gemini_unavailable", "gemini_http_400"]) {
    const { deps, upserts } = setup({
      gemini: () => {
        throw new Error(msg);
      },
    });
    const r = await handleCommentsRoute("POST", "/comments-analysis/7/p1", deps);
    assertEquals(r?.status, 503);
    assertEquals(body(r), { error: "ai_unavailable" });
    assertEquals(upserts.length, 0);
  }
});

Deno.test("rate limit negado → 429", async () => {
  const { deps, calls } = setup({ rateOk: false });
  const an = await handleCommentsRoute("POST", "/comments-analysis/7/p1", deps);
  assertEquals(an?.status, 429);
  assertEquals(body(an), { error: "rate_limited" });
  const list = await handleCommentsRoute("GET", "/post-comments/7/p1", deps);
  assertEquals(list?.status, 429);
  const acc = await handleCommentsRoute("POST", "/comments-analysis-account/7", deps);
  assertEquals(acc?.status, 429);
  assertEquals(calls.graph.length, 0);
  assertEquals(calls.gemini.length, 0);
});

Deno.test("token expirado na Graph sobe no formato TOKEN_EXPIRED do index.ts", async () => {
  const expired = new IgApiError("Error validating access token", { graphCode: 190 });
  for (const [method, path] of [["GET", "/post-comments/7/p1"], ["POST", "/comments-analysis/7/p1"], ["POST", "/comments-analysis-account/7"]]) {
    const { deps } = setup({ graph: () => expired });
    let thrown: unknown = null;
    try {
      await handleCommentsRoute(method, path, deps);
    } catch (e) {
      thrown = e;
    }
    assertEquals((thrown as { code?: string })?.code, "TOKEN_EXPIRED");
  }
});

Deno.test("outra falha da Graph → 502 instagram_unavailable", async () => {
  const { deps } = setup({ graph: () => new IgApiError("boom", { graphCode: 100 }) });
  const r = await handleCommentsRoute("GET", "/post-comments/7/p1", deps);
  assertEquals(r?.status, 502);
  assertEquals(body(r), { error: "instagram_unavailable" });
});

Deno.test("Unauthorized do dono do cliente sobe para o index.ts", async () => {
  const { deps, calls } = setup();
  deps.verifyClientOwnership = () => Promise.reject(new Error("Unauthorized"));
  let thrown: unknown = null;
  try {
    await handleCommentsRoute("GET", "/post-comments/7/p1", deps);
  } catch (e) {
    thrown = e;
  }
  assertEquals((thrown as Error)?.message, "Unauthorized");
  assertEquals(calls.graph.length, 0);
});

Deno.test("conta: escolhe os 15 com mais comentários dos últimos 30 dias e corta 60 por post", async () => {
  const posts: Row[] = [];
  for (let i = 1; i <= 20; i++) posts.push(post(`p${i}`, i * 10));
  posts.push(post("velho", 9999, 40)); // fora dos 30 dias
  posts.push(post("zero", 0)); // sem comentários
  posts.push(post("outra", 5000, 1, { instagram_account_id: "outra-conta" }));
  const { deps, calls, upserts } = setup({
    tables: { instagram_accounts: [account()], instagram_posts: posts, instagram_comment_analyses: [] },
    graph: (id) => comments(100, id),
  });
  const r = await handleCommentsRoute("POST", "/comments-analysis-account/7", deps);
  assertEquals(r?.status, 200);
  const fetched = calls.graph.map((g) => g.mediaId).sort();
  const expected = Array.from({ length: 15 }, (_, i) => `p${20 - i}`).sort();
  assertEquals(fetched, expected);
  for (const g of calls.graph) {
    assertEquals(g.max, 60);
    assertEquals(g.deadlineAt, NOW + 20_000);
  }
  const prompt = calls.gemini[0].prompt;
  assert(!prompt.includes("fulano_"), "prompt sem username");
  assert(!prompt.includes("legenda velho"), "post antigo fora");

  const sum = Array.from({ length: 20 }, (_, i) => (i + 1) * 10).reduce((a, b) => a + b, 0);
  const u = upserts[0].row;
  assertEquals(u.scope, "account");
  assertEquals(u.instagram_post_id, null);
  assertEquals(u.comments_analyzed, 15 * 60);
  assertEquals(u.comments_count_at_analysis, sum);
  assertEquals(u.period_start, "2026-10-04");
  assertEquals(u.period_end, "2026-11-03");
  // deno-lint-ignore no-explicit-any
  const result = u.result as any;
  // "p1" não está entre os 15 escolhidos: o post_id é descartado
  assertEquals(result.temas[0].post_ids, undefined);
  assertEquals(body(r).current_comments, sum);
  assertEquals(body(r).analysis.period_start, "2026-10-04");
});

Deno.test("conta: post_ids das ideias ficam só entre os posts enviados", async () => {
  const { deps, upserts } = setup({
    tables: { instagram_accounts: [account()], instagram_posts: [post("p1", 30), post("p2", 20)] },
    graph: (id) => comments(10, id),
  });
  const r = await handleCommentsRoute("POST", "/comments-analysis-account/7", deps);
  assertEquals(r?.status, 200);
  // deno-lint-ignore no-explicit-any
  assertEquals((upserts[0].row.result as any).temas[0].post_ids, ["p1"]);
});

Deno.test("conta: menos de 10 comentários no total → 422", async () => {
  const { deps, calls } = setup({
    tables: { instagram_accounts: [account()], instagram_posts: [post("p1", 3), post("p2", 2)] },
    graph: (id) => comments(4, id),
  });
  const r = await handleCommentsRoute("POST", "/comments-analysis-account/7", deps);
  assertEquals(r?.status, 422);
  assertEquals(body(r), { error: "too_few_comments" });
  assertEquals(calls.gemini.length, 0);
});

Deno.test("conta: falha num post segue com os outros", async () => {
  const { deps, calls } = setup({
    tables: { instagram_accounts: [account()], instagram_posts: [post("p1", 30), post("p2", 20)] },
    graph: (id) => (id === "p1" ? new IgApiError("boom", { graphCode: 100 }) : comments(12, id)),
  });
  const r = await handleCommentsRoute("POST", "/comments-analysis-account/7", deps);
  assertEquals(r?.status, 200);
  assertEquals(body(r).analysis.comments_analyzed, 12);
  assert(!calls.gemini[0].prompt.includes("legenda p1"), "post que falhou fica fora");
});

Deno.test("GET conta devolve current_comments mesmo sem análise", async () => {
  const { deps, calls } = setup({
    tables: {
      instagram_accounts: [account()],
      instagram_posts: [post("p1", 7), post("p2", 5), post("velho", 100, 45)],
      instagram_comment_analyses: [
        // análise de outra conta do Instagram reconectada no mesmo cliente
        { instagram_account_id: ACC_ID, ig_user_id: "antiga", scope: "account", instagram_post_id: null, result: {} },
      ],
    },
  });
  const r = await handleCommentsRoute("GET", "/comments-analysis-account/7", deps);
  assertEquals(r?.status, 200);
  assertEquals(body(r), { analysis: null, current_comments: 12 });
  assertEquals(calls.graph.length, 0);
  assertEquals(calls.rate.length, 0);
});

Deno.test("GET conta devolve a análise salva do ig_user_id atual", async () => {
  const { deps } = setup({
    tables: {
      instagram_accounts: [account()],
      instagram_posts: [post("p1", 7)],
      instagram_comment_analyses: [{
        instagram_account_id: ACC_ID,
        ig_user_id: IG_USER,
        scope: "account",
        instagram_post_id: null,
        result: { resumo: "r" },
        comments_analyzed: 40,
        comments_count_at_analysis: 5,
        analyzed_at: "2026-11-02T00:00:00.000Z",
        period_start: "2026-10-03",
        period_end: "2026-11-02",
      }],
    },
  });
  const r = await handleCommentsRoute("GET", "/comments-analysis-account/7", deps);
  assertEquals(body(r).current_comments, 7);
  assertEquals(body(r).analysis.period_start, "2026-10-03");
  assertEquals(body(r).analysis.comments_count_at_analysis, 5);
});

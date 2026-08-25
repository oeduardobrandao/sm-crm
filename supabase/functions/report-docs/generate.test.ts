import { assert, assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { FakeTime } from "https://deno.land/std@0.208.0/testing/time.ts";
import { GenerateError, generateReportDocument } from "./generate.ts";

// Fake db: responde por tabela; grava inserts e chamadas de rpc para asserção.
// `errors` deixa uma tabela específica resolver { data: null, error } em vez
// de { data: result, error: null } -- simula uma query obrigatória falhando.
function makeDb(
  rows: Record<string, unknown>,
  opts: {
    feature?: boolean;
    errors?: Record<string, { message: string }>;
    featureByKey?: Record<string, boolean>;
    featureErrors?: Record<string, { message: string }>;
  } = {},
) {
  const inserts: Record<string, unknown>[] = [];
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  // deno-lint-ignore no-explicit-any
  const chain = (result: any, error: { message: string } | null = null): any => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gte", "lt", "order", "limit"]) {
      c[m] = () => chain(result, error);
    }
    c.maybeSingle = () => Promise.resolve({ data: error ? null : result, error });
    c.single = () => Promise.resolve({ data: error ? null : result, error });
    c.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: error ? null : result, error }).then(resolve);
    return c;
  };
  return {
    inserts,
    rpcCalls,
    from: (table: string) => {
      if (table === "report_documents") {
        return {
          insert: (row: Record<string, unknown>) => {
            inserts.push(row);
            return chain({ id: "doc-1" });
          },
        };
      }
      return chain(rows[table] ?? null, opts.errors?.[table] ?? null);
    },
    rpc: (name: string, args: Record<string, unknown> = {}) => {
      rpcCalls.push({ name, args });
      if (name === "effective_plan_feature") {
        const key = args.feature_key as string;
        if (opts.featureErrors?.[key]) {
          return Promise.resolve({ data: null, error: opts.featureErrors[key] });
        }
        return Promise.resolve({ data: opts.featureByKey?.[key] ?? opts.feature ?? true, error: null });
      }
      return Promise.resolve({ data: [], error: null });
    },
    // deno-lint-ignore no-explicit-any
  } as any;
}

const deps = {
  fetch: globalThis.fetch,
  // deno-lint-ignore no-explicit-any
  storage: {} as any,
  geminiKey: "",
  userId: "user-1",
};

Deno.test("cliente de outro workspace: not_found", async () => {
  const db = makeDb({ clientes: { id: 1, conta_id: "OUTRA", include_ai_analysis: true } });
  let err: unknown;
  try {
    await generateReportDocument(db, deps, "minha-conta", 1, "2026-07", null);
  } catch (e) { err = e; }
  assert(err instanceof GenerateError && err.code === "not_found");
});

Deno.test("mês futuro: bad_month", async () => {
  const db = makeDb({});
  let err: unknown;
  try {
    await generateReportDocument(db, deps, "c", 1, "2999-01", null);
  } catch (e) { err = e; }
  assert(err instanceof GenerateError && err.code === "bad_month");
});

Deno.test("caminho feliz sem IA insere documento ready com layout válido", async () => {
  const db = makeDb({
    clientes: { id: 1, conta_id: "c", nome: "X", especialidade: "Derma", include_ai_analysis: false },
    instagram_accounts: { id: "ig-1", username: "dra.x", follower_count: 100 },
    instagram_posts: [],
    instagram_follower_history: [],
    instagram_analytics_cache: null,
    instagram_account_metrics_daily: [],
    workspaces: { name: "DK", logo_url: null, brand_color: "#123456", report_splash_url: null },
  });
  const { id } = await generateReportDocument(db, deps, "c", 1, "2026-07", null);
  assertEquals(id, "doc-1");
  assertEquals(db.inserts.length, 1);
  const row = db.inserts[0] as {
    status: string;
    layout: { blocks: { type: string; config?: { title?: string } }[] };
    data_snapshot: { version: number };
  };
  assertEquals(row.status, "ready");
  assertEquals(row.data_snapshot.version, 1);
  const types = row.layout.blocks.map((b) => b.type);
  assert(types.includes("cover"));
  assert(!types.includes("ai_recommendations")); // IA desligada no cliente
  // hasAi é derivado do conteúdo (recsDoc), não da intenção: sem IA, a seção
  // "Próximos passos" não deve sobrar órfã (sem os blocos de conteúdo).
  assert(!row.layout.blocks.some((b) => b.config?.title === "Próximos passos"));

  // get_tag_performance usa bound INCLUSIVO (paridade com o gerador v2): não
  // pode ser a meia-noite exata do dia 1 do mês seguinte (endExclusive).
  const tagCall = db.rpcCalls.find((c: { name: string }) => c.name === "get_tag_performance");
  assert(tagCall, "esperava uma chamada a get_tag_performance");
  assert(
    (tagCall.args.p_month_end as string).endsWith("T23:59:59.999Z"),
    `p_month_end deveria ser o instante inclusivo, veio ${tagCall.args.p_month_end}`,
  );
});

Deno.test("IA desejada mas GEMINI_API_KEY ausente: sem seção 'Próximos passos' órfã", async () => {
  // Cenário real do bug: cliente QUER IA (include_ai_analysis !== false), mas
  // deps.geminiKey está vazio -- o mesmo `if (wantsAi && deps.geminiKey)` que
  // protege a chamada ao Gemini também deixa recsDoc/goalsDoc null aqui, sem
  // precisar mockar fetch/generateAINarrative. hasAi baseado em wantsAi (a
  // intenção) adicionaria a section_header "Próximos passos" mesmo assim;
  // hasAi baseado em recsDoc !== null (o conteúdo) não adiciona.
  const db = makeDb({
    clientes: { id: 1, conta_id: "c", nome: "X", especialidade: "Derma", include_ai_analysis: true },
    instagram_accounts: { id: "ig-1", username: "dra.x", follower_count: 100 },
    instagram_posts: [],
    instagram_follower_history: [],
    instagram_analytics_cache: null,
    instagram_account_metrics_daily: [],
    workspaces: { name: "DK", logo_url: null, brand_color: "#123456", report_splash_url: null },
  });
  await generateReportDocument(db, { ...deps, geminiKey: "" }, "c", 1, "2026-07", null);
  const row = db.inserts[0] as {
    layout: { blocks: { type: string; config?: { title?: string } }[] };
  };
  const types = row.layout.blocks.map((b) => b.type);
  assert(!types.includes("ai_recommendations"));
  assert(
    !row.layout.blocks.some((b) => b.config?.title === "Próximos passos"),
    "seção 'Próximos passos' não deveria existir sem nenhum bloco de conteúdo de IA embaixo",
  );
});

Deno.test("Gemini trava além do teto de 45s: race resolve com fallback e aborta o fetch em voo", async () => {
  // Achado de review externo: o fetch do Gemini não tinha AbortSignal, então
  // o perdedor do Promise.race ficava rodando órfão na isolate. Stub de
  // fetch que nunca resolve sozinho -- só o abort (disparado pelo timeout em
  // generate.ts) sinaliza que o generateAINarrative deveria desistir.
  const db = makeDb({
    clientes: { id: 1, conta_id: "c", nome: "X", especialidade: "Derma", include_ai_analysis: true },
    instagram_accounts: { id: "ig-1", username: "dra.x", follower_count: 100 },
    instagram_posts: [],
    instagram_follower_history: [],
    instagram_analytics_cache: null,
    instagram_account_metrics_daily: [],
    workspaces: { name: "DK", logo_url: null, brand_color: "#123456", report_splash_url: null },
  });

  const originalFetch = globalThis.fetch;
  let capturedSignal: AbortSignal | undefined;
  let aborted = false;
  globalThis.fetch = ((input: unknown, init?: RequestInit) => {
    if (typeof input === "string" && input.includes("generativelanguage.googleapis.com")) {
      capturedSignal = init?.signal ?? undefined;
      capturedSignal?.addEventListener("abort", () => { aborted = true; });
      return new Promise<Response>(() => {}); // nunca resolve por si só
    }
    return originalFetch(input as Parameters<typeof fetch>[0], init);
  }) as typeof fetch;

  const time = new FakeTime();
  try {
    const resultPromise = generateReportDocument(
      db, { ...deps, geminiKey: "fake-key" }, "c", 1, "2026-07", null,
    );
    await time.tickAsync(45_000);
    const { id } = await resultPromise;
    assertEquals(id, "doc-1");
  } finally {
    time.restore();
    globalThis.fetch = originalFetch;
  }

  assertExists(capturedSignal, "generateAINarrative deveria ter recebido o AbortSignal do controller");
  assertEquals(aborted, true, "o timeout deveria abortar o fetch em voo do Gemini");

  const row = db.inserts[0] as {
    layout: { blocks: { type: string; config?: { title?: string } }[] };
  };
  const types = row.layout.blocks.map((b) => b.type);
  assert(!types.includes("ai_recommendations"));
  assert(
    !row.layout.blocks.some((b) => b.config?.title === "Próximos passos"),
    "sem resposta a tempo, o layout deve cair no fallback sem seção órfã de IA",
  );
});

Deno.test("erro na query obrigatória de posts do mês: rejeita e não insere nada", async () => {
  // instagram_posts é fonte OBRIGATÓRIA (o mês do relatório): um erro de
  // banco transiente não pode virar "0 posts, KPIs zerados, ready" -- tem que
  // derrubar a geração inteira, igual a workspace. Fontes opcionais (cache,
  // best_times, snapshots de mês anterior) continuam degradando com log.
  const db = makeDb(
    {
      clientes: { id: 1, conta_id: "c", nome: "X", especialidade: "Derma", include_ai_analysis: false },
      instagram_accounts: { id: "ig-1", username: "dra.x", follower_count: 100 },
      instagram_follower_history: [],
      instagram_analytics_cache: null,
      instagram_account_metrics_daily: [],
      workspaces: { name: "DK", logo_url: null, brand_color: "#123456", report_splash_url: null },
    },
    { errors: { instagram_posts: { message: "boom" } } },
  );
  let err: unknown;
  try {
    await generateReportDocument(db, deps, "c", 1, "2026-07", null);
  } catch (e) { err = e; }
  // Erro genérico (não GenerateError): vira 500 via internalServerError no
  // index.ts, mensagem nunca sai pro cliente.
  assert(err instanceof Error && !(err instanceof GenerateError));
  assertEquals(db.inserts.length, 0);
});

Deno.test("templateId de outro workspace: not_found", async () => {
  const db = makeDb({
    clientes: { id: 1, conta_id: "c", nome: "X", especialidade: null, include_ai_analysis: false },
    instagram_accounts: { id: "ig-1", username: "x" },
    report_templates: { id: "t1", conta_id: "OUTRA", layout: { version: 1, blocks: [] } },
    workspaces: { name: "W", logo_url: null, brand_color: "#111111", report_splash_url: null },
  });
  let err: unknown;
  try {
    await generateReportDocument(db, deps, "c", 1, "2026-07", "b3b2a6a0-1111-4222-8333-444455556666");
  } catch (e) { err = e; }
  assert(err instanceof GenerateError && err.code === "not_found");
});

Deno.test("templateId com layout inválido: invalid_template", async () => {
  const db = makeDb({
    clientes: { id: 1, conta_id: "c", nome: "X", especialidade: null, include_ai_analysis: false },
    instagram_accounts: { id: "ig-1", username: "x" },
    report_templates: { id: "t1", conta_id: "c", layout: { version: 99, blocks: [] } },
    workspaces: { name: "W", logo_url: null, brand_color: "#111111", report_splash_url: null },
  });
  let err: unknown;
  try {
    await generateReportDocument(db, deps, "c", 1, "2026-07", "b3b2a6a0-1111-4222-8333-444455556666");
  } catch (e) { err = e; }
  assert(err instanceof GenerateError && err.code === "invalid_template");
});

Deno.test("templateId válido: layout do documento nasce do template com IA preenchida", async () => {
  const tplLayout = {
    version: 1,
    accent: "#9f1239",
    blocks: [
      { id: "c1", type: "cover", size: "full" },
      { id: "s1", type: "ai_summary", size: "full" },
      { id: "r1", type: "ai_recommendations", size: "full" },
    ],
  };
  const db = makeDb({
    clientes: { id: 1, conta_id: "c", nome: "X", especialidade: null, include_ai_analysis: false },
    instagram_accounts: { id: "ig-1", username: "x" },
    report_templates: { id: "t1", conta_id: "c", layout: tplLayout },
    workspaces: { name: "W", logo_url: null, brand_color: "#111111", report_splash_url: null },
    instagram_posts: [],
    instagram_follower_history: [],
  });
  await generateReportDocument(db, deps, "c", 1, "2026-07", "b3b2a6a0-1111-4222-8333-444455556666");
  const inserted = db.inserts[0] as { layout: { accent?: string; blocks: Array<{ id: string; type: string; text?: unknown }> } };
  assertEquals(inserted.layout.accent, "#9f1239");
  const ids = inserted.layout.blocks.map((b) => b.id);
  // sem IA (geminiKey vazio): ai_summary vira fallback COM texto; ai_recommendations é removido
  assert(ids.includes("c1") && ids.includes("s1"));
  assert(!ids.includes("r1"));
  const summary = inserted.layout.blocks.find((b) => b.id === "s1");
  assert(summary?.text !== undefined);
});

Deno.test("templateId com cover size != full (template legado, pré-validação): normaliza para full em vez de invalid_template", async () => {
  // Achado de review externo 2026-08-25: um template salvo antes da regra
  // "cover deve ser full" existir pode ter ficado com size 'third'/'half'.
  // Sem normalizeCoverSize ANTES de validateLayout, essa geração falharia com
  // invalid_template para sempre -- não há como o usuário corrigir um
  // template pela UI que nunca abre por causa do mesmo gate.
  const tplLayout = {
    version: 1,
    blocks: [{ id: "c", type: "cover", size: "third" }],
  };
  const db = makeDb({
    clientes: { id: 1, conta_id: "c", nome: "X", especialidade: null, include_ai_analysis: false },
    instagram_accounts: { id: "ig-1", username: "x" },
    report_templates: { id: "t1", conta_id: "c", layout: tplLayout },
    workspaces: { name: "W", logo_url: null, brand_color: "#111111", report_splash_url: null },
    instagram_posts: [],
    instagram_follower_history: [],
  });
  const { id } = await generateReportDocument(
    db, deps, "c", 1, "2026-07", "b3b2a6a0-1111-4222-8333-444455556666",
  );
  assertEquals(id, "doc-1");
  const inserted = db.inserts[0] as { layout: { blocks: Array<{ id: string; size: string }> } };
  const cover = inserted.layout.blocks.find((b) => b.id === "c");
  assertEquals(cover?.size, "full");
});

Deno.test('templateId "system": ignora o default do workspace e usa o padrão do sistema', async () => {
  // Achado de review externo (PR #379): "Padrão do sistema" no dialog do CRM
  // omitia templateId, que o servidor trata como "usa o is_default do
  // workspace" -- quando um default existe, a escolha explícita do sistema
  // virava silenciosamente o layout do default. A sentinela "system" tem que
  // pular TANTO a busca do template explícito QUANTO o fallback do
  // is_default, mesmo com um default presente na tabela.
  const tplLayout = {
    version: 1,
    accent: "#9f1239",
    blocks: [{ id: "c1", type: "cover", size: "full" }],
  };
  const db = makeDb({
    clientes: { id: 1, conta_id: "c", nome: "X", especialidade: null, include_ai_analysis: false },
    instagram_accounts: { id: "ig-1", username: "x" },
    // Default do workspace presente -- não pode vazar para o resultado.
    report_templates: { id: "t1", conta_id: "c", is_default: true, layout: tplLayout },
    workspaces: { name: "W", logo_url: null, brand_color: "#111111", report_splash_url: null },
    instagram_posts: [],
    instagram_follower_history: [],
  });
  await generateReportDocument(db, deps, "c", 1, "2026-07", "system");
  const inserted = db.inserts[0] as {
    layout: { accent?: string; blocks: Array<{ type: string; size?: string }> };
  };
  // Marcador: o template do workspace tem accent "#9f1239" e um único bloco
  // "cover"; o padrão do sistema (buildDefaultLayout) não tem `accent` e
  // inclui os blocos fixos do sistema (ex.: os KPIs em "third").
  assertEquals(inserted.layout.accent, undefined);
  const types = inserted.layout.blocks.map((b) => b.type);
  assert(types.includes("cover"));
  assert(
    inserted.layout.blocks.some((b) => b.type === "kpi_followers_gained" && b.size === "third"),
    "layout deveria ser o padrão do sistema (buildDefaultLayout), não o template default do workspace",
  );
});

Deno.test("sem templateId e sem default: layout padrão do sistema", async () => {
  const db = makeDb({
    clientes: { id: 1, conta_id: "c", nome: "X", especialidade: null, include_ai_analysis: false },
    instagram_accounts: { id: "ig-1", username: "x" },
    report_templates: null,
    workspaces: { name: "W", logo_url: null, brand_color: "#111111", report_splash_url: null },
    instagram_posts: [],
    instagram_follower_history: [],
  });
  await generateReportDocument(db, deps, "c", 1, "2026-07", null);
  const inserted = db.inserts[0] as { layout: { blocks: Array<{ type: string }> } };
  assert(inserted.layout.blocks.some((b) => b.type === "cover"));
});

Deno.test("com feature_brand_customization ativa, o snapshot carrega hub_theme das colunas do workspace", async () => {
  const db = makeDb({
    clientes: { id: 1, conta_id: "c", nome: "X", especialidade: "Derma", include_ai_analysis: false },
    instagram_accounts: { id: "ig-1", username: "dra.x", follower_count: 100 },
    instagram_posts: [],
    instagram_follower_history: [],
    instagram_analytics_cache: null,
    instagram_account_metrics_daily: [],
    workspaces: {
      name: "DK", logo_url: null, brand_color: "#123456", report_splash_url: null,
      hub_surface_theme: "warm", hub_font_display: "sora", hub_font_body: "manrope",
      hub_radius: "pill", hub_card_style: "outline",
    },
  }, { featureByKey: { feature_analytics_reports: true, feature_brand_customization: true } });
  await generateReportDocument(db, deps, "c", 1, "2026-07", null);
  const row = db.inserts[0] as { data_snapshot: { branding: { hub_theme?: unknown } } };
  assertEquals(row.data_snapshot.branding.hub_theme, {
    surface: "warm", font_display: "sora", font_body: "manrope",
    radius: "pill", card_style: "outline",
  });
});

Deno.test("sem feature_brand_customization, o snapshot usa os defaults neutros mesmo com colunas customizadas", async () => {
  const db = makeDb({
    clientes: { id: 1, conta_id: "c", nome: "X", especialidade: "Derma", include_ai_analysis: false },
    instagram_accounts: { id: "ig-1", username: "dra.x", follower_count: 100 },
    instagram_posts: [],
    instagram_follower_history: [],
    instagram_analytics_cache: null,
    instagram_account_metrics_daily: [],
    workspaces: {
      name: "DK", logo_url: null, brand_color: "#123456", report_splash_url: null,
      hub_surface_theme: "warm", hub_font_display: "sora", hub_font_body: "manrope",
      hub_radius: "pill", hub_card_style: "outline",
    },
  }, { featureByKey: { feature_analytics_reports: true, feature_brand_customization: false } });
  await generateReportDocument(db, deps, "c", 1, "2026-07", null);
  const row = db.inserts[0] as { data_snapshot: { branding: { hub_theme?: unknown } } };
  assertEquals(row.data_snapshot.branding.hub_theme, {
    surface: "neutral", font_display: "fraunces", font_body: "instrument-sans",
    radius: "soft", card_style: "filled",
  });
});

Deno.test("erro na RPC de feature_brand_customization degrada para os defaults neutros, sem lançar", async () => {
  const db = makeDb({
    clientes: { id: 1, conta_id: "c", nome: "X", especialidade: "Derma", include_ai_analysis: false },
    instagram_accounts: { id: "ig-1", username: "dra.x", follower_count: 100 },
    instagram_posts: [],
    instagram_follower_history: [],
    instagram_analytics_cache: null,
    instagram_account_metrics_daily: [],
    workspaces: {
      name: "DK", logo_url: null, brand_color: "#123456", report_splash_url: null,
      hub_surface_theme: "warm", hub_font_display: "sora", hub_font_body: "manrope",
      hub_radius: "pill", hub_card_style: "outline",
    },
  }, {
    featureByKey: { feature_analytics_reports: true },
    featureErrors: { feature_brand_customization: { message: "rpc indisponivel" } },
  });
  const { id } = await generateReportDocument(db, deps, "c", 1, "2026-07", null);
  assertEquals(id, "doc-1");
  const row = db.inserts[0] as { status: string; data_snapshot: { branding: { hub_theme?: { surface?: string } } } };
  assertEquals(row.status, "ready");
  assertEquals(row.data_snapshot.branding.hub_theme?.surface, "neutral");
});

Deno.test("generate: cacheia a foto de perfil e propaga client_name no snapshot", async () => {
  const uploaded: { path: string; contentType: string }[] = [];
  const storage = {
    from: (bucket: string) => ({
      upload: async (path: string, _body: unknown, opts: { contentType: string }) => {
        uploaded.push({ path, contentType: opts.contentType });
        return { error: null };
      },
      getPublicUrl: (path: string) => ({
        data: { publicUrl: `https://cdn.example/${bucket}/${path}` },
      }),
    }),
    createBucket: async () => ({}),
  };
  const fetchMock = (async (url: string) => {
    if (url === "https://cdninstagram.com/raw.jpg") {
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      });
    }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  const testDeps = { ...deps, fetch: fetchMock, storage };

  const db = makeDb({
    clientes: { id: 1, conta_id: "c", nome: "Dra. X", especialidade: "Derma", include_ai_analysis: false },
    instagram_accounts: {
      id: "ig-1", username: "dra.x", follower_count: 100,
      profile_picture_url: "https://cdninstagram.com/raw.jpg",
    },
    instagram_posts: [],
    instagram_follower_history: [],
    instagram_analytics_cache: null,
    instagram_account_metrics_daily: [],
    workspaces: { name: "DK", logo_url: null, brand_color: "#123456", report_splash_url: null },
  });
  await generateReportDocument(db, testDeps, "c", 1, "2026-07", null);
  const row = db.inserts[0] as {
    data_snapshot: { account: { client_name: string; profile_picture_url: string | null } };
  };
  assertEquals(row.data_snapshot.account.client_name, "Dra. X");
  assertEquals(
    row.data_snapshot.account.profile_picture_url,
    "https://cdn.example/instagram-posts/ig-1/avatar.jpg",
  );
  assertEquals(uploaded.length, 1);
  assertEquals(uploaded[0].path, "ig-1/avatar.jpg");
});

Deno.test("generate: avatar já estável não é recacheado (sem upload/download)", async () => {
  // instagram_accounts.profile_picture_url já pode ser uma URL estável (o
  // sync/refresh cron recacheia essa coluna depois da conexão inicial) --
  // recachear de novo a cada geração seria custo de rede/storage sem fim,
  // igual ao guard que os thumbnails de post já usam 30 linhas abaixo.
  const uploaded: { path: string; contentType: string }[] = [];
  const storage = {
    from: (bucket: string) => ({
      upload: async (path: string, _body: unknown, opts: { contentType: string }) => {
        uploaded.push({ path, contentType: opts.contentType });
        return { error: null };
      },
      getPublicUrl: (path: string) => ({
        data: { publicUrl: `https://cdn.example/${bucket}/${path}` },
      }),
    }),
    createBucket: async () => ({}),
  };
  const fetchMock = (async () => {
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  const testDeps = { ...deps, fetch: fetchMock, storage };
  const stableAvatar = "https://cdn.example/instagram-posts/ig-1/avatar.jpg";

  const db = makeDb({
    clientes: { id: 1, conta_id: "c", nome: "Dra. X", especialidade: "Derma", include_ai_analysis: false },
    instagram_accounts: {
      id: "ig-1", username: "dra.x", follower_count: 100,
      profile_picture_url: stableAvatar,
    },
    instagram_posts: [],
    instagram_follower_history: [],
    instagram_analytics_cache: null,
    instagram_account_metrics_daily: [],
    workspaces: { name: "DK", logo_url: null, brand_color: "#123456", report_splash_url: null },
  });
  await generateReportDocument(db, testDeps, "c", 1, "2026-07", null);
  const row = db.inserts[0] as {
    data_snapshot: { account: { profile_picture_url: string | null } };
  };
  assertEquals(row.data_snapshot.account.profile_picture_url, stableAvatar);
  assertEquals(uploaded.length, 0);
});

Deno.test("generate: falha no cache do avatar vira null, não a URL efêmera crua", async () => {
  // cachePostThumbnail's documented contract: "On any failure returns cdnUrl"
  // (o mesmo raw da Graph). Congelar esse valor no snapshot travaria uma URL
  // que VAI expirar (dias) sem chance de autocorreção -- achado de review
  // externo 2026-08-25. O loop de thumbnails de post (30 linhas abaixo) já se
  // protege com `if (cached && !isEphemeralInstagramUrl(cached))`; o avatar
  // precisa do mesmo guard.
  const storage = {
    from: () => ({
      upload: async () => ({ error: null }),
      getPublicUrl: () => ({ data: { publicUrl: "unused" } }),
    }),
    createBucket: async () => ({}),
  };
  const fetchMock = (async (url: string) => {
    if (url === "https://cdninstagram.com/raw.jpg") {
      return new Response("erro", { status: 500 });
    }
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  const testDeps = { ...deps, fetch: fetchMock, storage };

  const db = makeDb({
    clientes: { id: 1, conta_id: "c", nome: "Dra. X", especialidade: "Derma", include_ai_analysis: false },
    instagram_accounts: {
      id: "ig-1", username: "dra.x", follower_count: 100,
      profile_picture_url: "https://cdninstagram.com/raw.jpg",
    },
    instagram_posts: [],
    instagram_follower_history: [],
    instagram_analytics_cache: null,
    instagram_account_metrics_daily: [],
    workspaces: { name: "DK", logo_url: null, brand_color: "#123456", report_splash_url: null },
  });
  await generateReportDocument(db, testDeps, "c", 1, "2026-07", null);
  const row = db.inserts[0] as {
    data_snapshot: { account: { profile_picture_url: string | null } };
  };
  assertEquals(row.data_snapshot.account.profile_picture_url, null);
});

Deno.test("generate: foto manual (clientes.foto_url) tem prioridade sobre a do Instagram, mesma cadeia do hub-bootstrap", async () => {
  // Achado do usuário 2026-08-25 ("onde estão as fotos dos clientes?"): a
  // capa só olhava pra instagram_accounts.profile_picture_url e ignorava o
  // upload manual em clientes.foto_url, que hub-bootstrap/handler.ts já
  // prioriza primeiro. clientes.foto_url é estável por construção (upload
  // direto pro storage) -- não deve disparar nenhum cache/download.
  const uploaded: { path: string; contentType: string }[] = [];
  const storage = {
    from: (bucket: string) => ({
      upload: async (path: string, _body: unknown, opts: { contentType: string }) => {
        uploaded.push({ path, contentType: opts.contentType });
        return { error: null };
      },
      getPublicUrl: (path: string) => ({
        data: { publicUrl: `https://cdn.example/${bucket}/${path}` },
      }),
    }),
    createBucket: async () => ({}),
  };
  const fetchMock = (async () => new Response("{}", { status: 200 })) as typeof fetch;
  const testDeps = { ...deps, fetch: fetchMock, storage };
  const manualFoto = "https://cdn.example/clientes-fotos/1.png";

  const db = makeDb({
    clientes: {
      id: 1, conta_id: "c", nome: "Dra. X", especialidade: "Derma",
      include_ai_analysis: false, foto_url: manualFoto,
    },
    instagram_accounts: {
      id: "ig-1", username: "dra.x", follower_count: 100,
      profile_picture_url: "https://cdninstagram.com/raw.jpg",
    },
    instagram_posts: [],
    instagram_follower_history: [],
    instagram_analytics_cache: null,
    instagram_account_metrics_daily: [],
    workspaces: { name: "DK", logo_url: null, brand_color: "#123456", report_splash_url: null },
  });
  await generateReportDocument(db, testDeps, "c", 1, "2026-07", null);
  const row = db.inserts[0] as {
    data_snapshot: { account: { profile_picture_url: string | null } };
  };
  assertEquals(row.data_snapshot.account.profile_picture_url, manualFoto);
  assertEquals(uploaded.length, 0);
});

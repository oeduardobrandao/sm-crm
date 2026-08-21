import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { GenerateError, generateReportDocument } from "./generate.ts";

// Fake db: responde por tabela; grava inserts e chamadas de rpc para asserção.
function makeDb(rows: Record<string, unknown>, opts: { feature?: boolean } = {}) {
  const inserts: Record<string, unknown>[] = [];
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  // deno-lint-ignore no-explicit-any
  const chain = (result: any): any => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gte", "lt", "order", "limit"]) {
      c[m] = () => chain(result);
    }
    c.maybeSingle = () => Promise.resolve({ data: result, error: null });
    c.single = () => Promise.resolve({ data: result, error: null });
    c.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: result, error: null }).then(resolve);
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
      return chain(rows[table] ?? null);
    },
    rpc: (name: string, args: Record<string, unknown> = {}) => {
      rpcCalls.push({ name, args });
      return name === "effective_plan_feature"
        ? Promise.resolve({ data: opts.feature ?? true, error: null })
        : Promise.resolve({ data: [], error: null });
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
    await generateReportDocument(db, deps, "minha-conta", 1, "2026-07");
  } catch (e) { err = e; }
  assert(err instanceof GenerateError && err.code === "not_found");
});

Deno.test("mês futuro: bad_month", async () => {
  const db = makeDb({});
  let err: unknown;
  try {
    await generateReportDocument(db, deps, "c", 1, "2999-01");
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
  const { id } = await generateReportDocument(db, deps, "c", 1, "2026-07");
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
  await generateReportDocument(db, { ...deps, geminiKey: "" }, "c", 1, "2026-07");
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

import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { GenerateError, generateReportDocument } from "./generate.ts";

// Fake db: responde por tabela; grava inserts para asserção.
function makeDb(rows: Record<string, unknown>, opts: { feature?: boolean } = {}) {
  const inserts: Record<string, unknown>[] = [];
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
    rpc: (name: string) =>
      name === "effective_plan_feature"
        ? Promise.resolve({ data: opts.feature ?? true, error: null })
        : Promise.resolve({ data: [], error: null }),
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
  const row = db.inserts[0] as { status: string; layout: { blocks: { type: string }[] }; data_snapshot: { version: number } };
  assertEquals(row.status, "ready");
  assertEquals(row.data_snapshot.version, 1);
  const types = row.layout.blocks.map((b) => b.type);
  assert(types.includes("cover"));
  assert(!types.includes("ai_recommendations")); // IA desligada no cliente
});

import { assert } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { refreshReportDocument } from "./refresh.ts";
import { DocActionError } from "./errors.ts";

// Fake db própria deste arquivo (não importa a de generate.test.ts: não é
// exportada, e duplicação de helper de teste entre arquivos é o padrão da
// suíte). Idêntico idioma de generate.test.ts, com um `update` gravado em
// db.updates para report_documents.
function makeDb(
  rows: Record<string, unknown>,
  opts: { errors?: Record<string, { message: string }> } = {},
) {
  const updates: Record<string, unknown>[] = [];
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
    updates,
    rpcCalls,
    from: (table: string) => {
      if (table === "report_documents") {
        return {
          select: () => chain(rows.report_documents ?? null, opts.errors?.report_documents ?? null),
          update: (patch: Record<string, unknown>) => {
            updates.push(patch);
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
      }
      return chain(rows[table] ?? null, opts.errors?.[table] ?? null);
    },
    rpc: (name: string, args: Record<string, unknown> = {}) => {
      rpcCalls.push({ name, args });
      return name === "effective_plan_feature"
        ? Promise.resolve({ data: true, error: null })
        : Promise.resolve({ data: [], error: null });
    },
    // deno-lint-ignore no-explicit-any
  } as any;
}

const deps = {
  fetch: globalThis.fetch,
  // deno-lint-ignore no-explicit-any
  storage: {} as any,
};

Deno.test("doc de outro workspace: not_found", async () => {
  const db = makeDb({
    report_documents: { id: "d1", conta_id: "OUTRA", client_id: 1, period_start: "2026-07-01" },
  });
  let err: unknown;
  try {
    await refreshReportDocument(db, deps, "c", "d1");
  } catch (e) { err = e; }
  assert(err instanceof DocActionError && err.code === "not_found");
});

Deno.test("refresh re-snapshota e grava data_snapshot sem tocar layout", async () => {
  const db = makeDb({
    report_documents: { id: "d1", conta_id: "c", client_id: 1, period_start: "2026-07-01" },
    clientes: { id: 1, conta_id: "c", nome: "X", especialidade: "Derma", include_ai_analysis: false },
    instagram_accounts: { id: "ig-1", username: "x" },
    instagram_posts: [],
    instagram_follower_history: [],
    workspaces: { name: "W", logo_url: null, brand_color: "#123456", report_splash_url: null },
  });
  await refreshReportDocument(db, deps, "c", "d1");
  assert(db.updates.length === 1);
  const patch = db.updates[0] as { data_snapshot?: unknown; layout?: unknown };
  assert(patch.data_snapshot !== undefined);
  assert(patch.layout === undefined);
});

Deno.test("cliente do doc pertence a outro workspace: not_found", async () => {
  const db = makeDb({
    report_documents: { id: "d1", conta_id: "c", client_id: 1, period_start: "2026-07-01" },
    clientes: { id: 1, conta_id: "OUTRA", nome: "X", especialidade: "Derma", include_ai_analysis: false },
  });
  let err: unknown;
  try {
    await refreshReportDocument(db, deps, "c", "d1");
  } catch (e) { err = e; }
  assert(err instanceof DocActionError && err.code === "not_found");
  assert(db.updates.length === 0);
});

Deno.test("cliente sem conta Instagram conectada: not_found (GenerateError vira DocActionError)", async () => {
  const db = makeDb({
    report_documents: { id: "d1", conta_id: "c", client_id: 1, period_start: "2026-07-01" },
    clientes: { id: 1, conta_id: "c", nome: "X", especialidade: "Derma", include_ai_analysis: false },
    instagram_accounts: null,
  });
  let err: unknown;
  try {
    await refreshReportDocument(db, deps, "c", "d1");
  } catch (e) { err = e; }
  assert(err instanceof DocActionError && err.code === "not_found");
  assert(db.updates.length === 0);
});

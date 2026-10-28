import { assert } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { refreshReportDocument } from "./refresh.ts";
import { DocActionError } from "./errors.ts";

// Fake db própria deste arquivo (não importa a de generate.test.ts: não é
// exportada, e duplicação de helper de teste entre arquivos é o padrão da
// suíte). Idêntico idioma de generate.test.ts, com um `update` gravado em
// db.updates para report_documents.
function makeDb(
  rows: Record<string, unknown>,
  opts: { errors?: Record<string, { message: string }>; featureByKey?: Record<string, boolean> } = {},
) {
  const updates: Record<string, unknown>[] = [];
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  // deno-lint-ignore no-explicit-any
  const chain = (result: any, error: { message: string } | null = null): any => {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gte", "lt", "lte", "order", "limit", "range"]) {
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
        ? Promise.resolve({ data: opts.featureByKey?.[args.feature_key as string] ?? true, error: null })
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

const TT_ACCOUNT = {
  id: "tt-1", client_id: 1, username: "dra.tt", display_name: null, avatar_url: null,
  follower_count: 500, likes_count: 9000, video_count: 1, authorization_status: "active",
  last_synced_at: null,
};

type RefreshPatch = {
  data_snapshot: { instagram_connected?: boolean; tiktok?: { account: { handle: string } } | null };
  instagram_account_id: string | null;
  tiktok_account_id: string | null;
};

Deno.test("refresh reloads tiktok section", async () => {
  const db = makeDb({
    report_documents: { id: "d1", conta_id: "c", client_id: 1, period_start: "2026-07-01" },
    clientes: { id: 1, conta_id: "c", nome: "X", especialidade: null, include_ai_analysis: false },
    instagram_accounts: null,
    tiktok_accounts: TT_ACCOUNT,
    tiktok_posts: [{
      tiktok_video_id: "v1", posted_at: "2026-07-10T15:00:00Z", views: 10, likes: 1, comments: 0,
      shares: 0, title: "t", video_description: null, duration: 10, share_url: null, cover_image_url: null,
    }],
    workspaces: { name: "W", logo_url: null, brand_color: "#123456", report_splash_url: null },
  });
  await refreshReportDocument(db, deps, "c", "d1");
  assert(db.updates.length === 1);
  const patch = db.updates[0] as RefreshPatch;
  assert(patch.data_snapshot.tiktok?.account.handle === "dra.tt");
  assert(patch.data_snapshot.instagram_connected === false);
  assert(patch.tiktok_account_id === "tt-1");
  assert(patch.instagram_account_id === null);
});

Deno.test("refresh without feature_tiktok and no stored TikTok section writes none", async () => {
  const db = makeDb({
    report_documents: { id: "d1", conta_id: "c", client_id: 1, period_start: "2026-07-01" },
    clientes: { id: 1, conta_id: "c", nome: "X", especialidade: null, include_ai_analysis: false },
    instagram_accounts: { id: "ig-1", username: "x" },
    instagram_posts: [],
    tiktok_accounts: TT_ACCOUNT,
    workspaces: { name: "W", logo_url: null, brand_color: "#123456", report_splash_url: null },
  }, { featureByKey: { feature_tiktok: false } });
  await refreshReportDocument(db, deps, "c", "d1");
  const patch = db.updates[0] as RefreshPatch;
  assert(patch.data_snapshot.tiktok === null);
  assert(patch.tiktok_account_id === null);
  assert(patch.instagram_account_id === "ig-1");
});

Deno.test("refresh without feature_tiktok keeps a frozen TikTok section", async () => {
  const db = makeDb({
    report_documents: {
      id: "d1", conta_id: "c", client_id: 1, period_start: "2026-07-01",
      data_snapshot: FROZEN, instagram_account_id: "ig-1", tiktok_account_id: "tt-old",
    },
    clientes: { id: 1, conta_id: "c", nome: "X", especialidade: null, include_ai_analysis: false },
    instagram_accounts: { id: "ig-1", username: "dra.nova" },
    instagram_posts: [],
    tiktok_accounts: TT_ACCOUNT,
    workspaces: { name: "W", logo_url: null, brand_color: "#123456", report_splash_url: null },
  }, { featureByKey: { feature_tiktok: false } });
  await refreshReportDocument(db, deps, "c", "d1");
  const patch = db.updates[0] as CarryPatch;
  assert(patch.data_snapshot.tiktok?.account.handle === "old.tt");
  assert(patch.tiktok_account_id === "tt-old");
  assert(patch.instagram_account_id === "ig-1");
});

Deno.test("refresh: erro na leitura de instagram_accounts rejeita (500) e não grava nada", async () => {
  const db = makeDb({
    report_documents: { id: "d1", conta_id: "c", client_id: 1, period_start: "2026-07-01" },
    clientes: { id: 1, conta_id: "c", nome: "X", especialidade: null, include_ai_analysis: false },
    tiktok_accounts: TT_ACCOUNT,
    tiktok_posts: [],
    workspaces: { name: "W", logo_url: null, brand_color: "#123456", report_splash_url: null },
  }, { errors: { instagram_accounts: { message: "boom" } } });
  let err: unknown;
  try {
    await refreshReportDocument(db, deps, "c", "d1");
  } catch (e) { err = e; }
  assert(err instanceof Error && !(err instanceof DocActionError));
  assert(db.updates.length === 0);
});

// Um snapshot de duas redes, congelado: Instagram "old.ig" e TikTok "old.tt".
const FROZEN = {
  version: 1,
  account: { handle: "old.ig", specialty: "", profile_picture_url: null, client_name: "X" },
  instagram_connected: true,
  kpis: { reach: { value: 123, unit: "count", prev: null } },
  top_posts: [{ caption_preview: "post antigo" }],
  tiktok: { account: { handle: "old.tt", display_name: null, avatar_url: null }, top_posts: [] },
};
type CarryPatch = {
  data_snapshot: {
    instagram_connected?: boolean;
    account: { handle: string };
    kpis: { reach: { value: number | null } };
    top_posts: unknown[];
    tiktok?: { account: { handle: string } } | null;
  };
  instagram_account_id: string | null;
  tiktok_account_id: string | null;
};

Deno.test("refresh: TikTok desconectado mantém a seção TikTok congelada e refaz o Instagram", async () => {
  const db = makeDb({
    report_documents: {
      id: "d1", conta_id: "c", client_id: 1, period_start: "2026-07-01",
      data_snapshot: FROZEN, instagram_account_id: "ig-1", tiktok_account_id: "tt-old",
    },
    clientes: { id: 1, conta_id: "c", nome: "X", especialidade: null, include_ai_analysis: false },
    instagram_accounts: { id: "ig-1", username: "dra.nova" },
    instagram_posts: [],
    tiktok_accounts: { ...TT_ACCOUNT, authorization_status: "disconnected" },
    workspaces: { name: "W", logo_url: null, brand_color: "#123456", report_splash_url: null },
  });
  await refreshReportDocument(db, deps, "c", "d1");
  const patch = db.updates[0] as CarryPatch;
  assert(patch.data_snapshot.tiktok?.account.handle === "old.tt");
  assert(patch.tiktok_account_id === "tt-old");
  assert(patch.data_snapshot.account.handle === "dra.nova");
  assert(patch.data_snapshot.top_posts.length === 0);
  assert(patch.instagram_account_id === "ig-1");
});

Deno.test("refresh: Instagram desconectado mantém a seção Instagram congelada e refaz o TikTok", async () => {
  const db = makeDb({
    report_documents: {
      id: "d1", conta_id: "c", client_id: 1, period_start: "2026-07-01",
      data_snapshot: FROZEN, instagram_account_id: "ig-old", tiktok_account_id: "tt-1",
    },
    clientes: { id: 1, conta_id: "c", nome: "X", especialidade: null, include_ai_analysis: false },
    instagram_accounts: null,
    tiktok_accounts: TT_ACCOUNT,
    tiktok_posts: [],
    workspaces: { name: "W", logo_url: null, brand_color: "#123456", report_splash_url: null },
  });
  await refreshReportDocument(db, deps, "c", "d1");
  const patch = db.updates[0] as CarryPatch;
  assert(patch.data_snapshot.instagram_connected === true);
  assert(patch.data_snapshot.account.handle === "old.ig");
  assert(patch.data_snapshot.kpis.reach.value === 123);
  assert(patch.data_snapshot.top_posts.length === 1);
  assert(patch.instagram_account_id === "ig-old");
  assert(patch.data_snapshot.tiktok?.account.handle === "dra.tt");
  assert(patch.tiktok_account_id === "tt-1");
});

Deno.test("refresh: nenhuma rede conectada mais continua not_found, mesmo com snapshot congelado", async () => {
  const db = makeDb({
    report_documents: {
      id: "d1", conta_id: "c", client_id: 1, period_start: "2026-07-01",
      data_snapshot: FROZEN, instagram_account_id: "ig-old", tiktok_account_id: "tt-old",
    },
    clientes: { id: 1, conta_id: "c", nome: "X", especialidade: null, include_ai_analysis: false },
    instagram_accounts: null,
    tiktok_accounts: null,
  });
  let err: unknown;
  try {
    await refreshReportDocument(db, deps, "c", "d1");
  } catch (e) { err = e; }
  assert(err instanceof DocActionError && err.code === "not_found");
  assert(db.updates.length === 0);
});

import { assertEquals, assertExists } from "jsr:@std/assert";
import { closePreviousMonthIfMissing, closeStoriesForMonth } from "../instagram-sync-cron/monthly-close.ts";

const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);

Deno.test("não refaz mês já fechado", async () => {
  let graphCalls = 0;
  const db = {
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () =>
      Promise.resolve({ data: { id: 1 } }) }) }) }) }),
  };
  const f = (() => { graphCalls++; }) as unknown as typeof fetch;
  // Dia 5: já FORA da janela de finalização — o zero de chamadas aqui prova
  // a idempotência (linha existe), não a janela.
  await closePreviousMonthIfMissing(db, f, "acc", "tok", sec("2026-09-05T12:00:00Z"));
  assertEquals(graphCalls, 0);
});

Deno.test("janela de finalização: dia 1-3 do mês não fecha nada", async () => {
  let graphCalls = 0;
  // db.from lança se chamado -- prova que nenhuma linha é sequer checada
  // antes da janela de finalização (guarda 1 é a primeira, sem I/O).
  const db = { from: () => { throw new Error("db não deveria ser tocado"); } };
  const f = (() => { graphCalls++; return Promise.resolve({ json: () => Promise.resolve({}) }); }) as unknown as typeof fetch;

  for (const iso of ["2026-09-01T00:00:01Z", "2026-09-02T12:00:00Z", "2026-09-03T23:59:59Z"]) {
    await closePreviousMonthIfMissing(db, f, "acc", "tok", sec(iso));
  }
  assertEquals(graphCalls, 0);
});

Deno.test("dia 4+, linha ausente: insere agregado com os valores do fetch", async () => {
  let insertedRow: Record<string, unknown> | null = null;
  const db = {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () =>
        Promise.resolve({ data: null }) }) }) }),
      insert: (row: Record<string, unknown>) => {
        insertedRow = row;
        return Promise.resolve({ error: null });
      },
    }),
  };

  const simpleValues: Record<string, number> = {
    reach: 500, views: 200, saves: 10, accounts_engaged: 300,
    profile_views: 50, website_clicks: 5,
  };
  const f = ((url: string) => {
    const metric = new URL(url).searchParams.get("metric");
    if (metric === "follows_and_unfollows") {
      return Promise.resolve({
        json: () => Promise.resolve({
          data: [{
            name: "follows_and_unfollows",
            total_value: { breakdowns: [{ results: [
              { dimension_values: ["FOLLOWER"], value: 20 },
              { dimension_values: ["NON_FOLLOWER"], value: 5 },
            ] }] },
          }],
        }),
      });
    }
    return Promise.resolve({
      json: () => Promise.resolve({
        data: [{ name: metric, total_value: { value: simpleValues[metric!] } }],
      }),
    });
  }) as unknown as typeof fetch;

  // Dia 4 de outubro, 00:00:01Z -- primeiro instante já dentro da janela de
  // finalização; setembro (mês fechado) tem 30 dias, então cada métrica
  // aditiva cai num único chunk de 30d (evita duplicar o valor mockado por
  // chunk, o que aconteceria com um mês de 31 dias).
  await closePreviousMonthIfMissing(db, f, "acc-1", "tok", sec("2026-10-04T00:00:01Z"));

  assertExists(insertedRow);
  assertEquals(insertedRow, {
    instagram_account_id: "acc-1",
    month: "2026-09-01",
    reach_month: 500,
    views_month: 200,
    saves_month: 10,
    accounts_engaged_month: 300,
    profile_views_month: 50,
    website_clicks_month: 5,
    follows_month: 20,
    unfollows_month: 5,
  });
});

Deno.test("falha transitória em toda métrica (achado P1 rodada 3): não insere linha, não lança", async () => {
  let insertCalls = 0;
  const db = {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () =>
        Promise.resolve({ data: null }) }) }) }),
      insert: () => {
        insertCalls++;
        return Promise.resolve({ error: null });
      },
    }),
  };
  // Toda métrica volta com erro (não-190) -- fetchAccountTotalsDetailed
  // reporta isso em failedMetrics (distinto de uma resposta honestamente
  // vazia). Nenhuma linha deve ser inserida: sem outro marcador de "já
  // processado" além da própria linha, uma linha parcial bloquearia o
  // refill dessa métrica para sempre via a guarda de idempotência.
  const f = (() =>
    Promise.resolve({
      json: () => Promise.resolve({ error: { code: 100, message: "metric not available" } }),
    })) as unknown as typeof fetch;

  await closePreviousMonthIfMissing(db, f, "acc-1", "tok", sec("2026-09-04T00:00:01Z"));

  assertEquals(insertCalls, 0);
});

Deno.test("falha em SÓ UMA métrica (parcial): ainda não insere -- linha inteira só com sucesso completo", async () => {
  let insertCalls = 0;
  const db = {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () =>
        Promise.resolve({ data: null }) }) }) }),
      insert: () => {
        insertCalls++;
        return Promise.resolve({ error: null });
      },
    }),
  };
  const simpleValues: Record<string, number> = {
    reach: 500, views: 200, accounts_engaged: 300, profile_views: 50, website_clicks: 5,
  };
  const f = ((url: string) => {
    const metric = new URL(url).searchParams.get("metric");
    if (metric === "saves") {
      return Promise.resolve({
        json: () => Promise.resolve({ error: { code: 100, message: "metric not available" } }),
      });
    }
    if (metric === "follows_and_unfollows") {
      return Promise.resolve({
        json: () => Promise.resolve({
          data: [{
            name: "follows_and_unfollows",
            total_value: { breakdowns: [{ results: [
              { dimension_values: ["FOLLOWER"], value: 20 },
              { dimension_values: ["NON_FOLLOWER"], value: 5 },
            ] }] },
          }],
        }),
      });
    }
    return Promise.resolve({
      json: () => Promise.resolve({
        data: [{ name: metric, total_value: { value: simpleValues[metric!] } }],
      }),
    });
  }) as unknown as typeof fetch;

  await closePreviousMonthIfMissing(db, f, "acc-1", "tok", sec("2026-10-04T00:00:01Z"));

  // Unlike backfill.ts (which upserts whatever came, since it can retry the
  // SAME month via the cursor), closePreviousMonthIfMissing has no other
  // "already processed" marker than the row itself: inserting a partial row
  // here would permanently block `saves` from ever being refilled.
  assertEquals(insertCalls, 0);
});

Deno.test("mês honestamente sem dado em nenhuma métrica (fim real da retenção, achado P1 rodada 3): AINDA insere linha de nulls", async () => {
  let insertedRow: Record<string, unknown> | null = null;
  const db = {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () =>
        Promise.resolve({ data: null }) }) }) }),
      insert: (row: Record<string, unknown>) => {
        insertedRow = row;
        return Promise.resolve({ error: null });
      },
    }),
  };
  // Graph responde OK, sem erro, mas sem nenhum dado para a métrica --
  // fetchAccountTotalsDetailed reporta failed:false para cada uma (distinto
  // da falha transitória acima). Sem falha nenhuma, a linha (mesmo que só de
  // nulls) marca o mês como já verificado -- essa é a ÚNICA forma deste
  // módulo evitar reconsultar a Graph à toa em todo tick seguinte, já que ele
  // não tem um marcador separado como o metrics_backfilled_at de backfill.ts.
  const f = (() =>
    Promise.resolve({ json: () => Promise.resolve({ data: [] }) })) as unknown as typeof fetch;

  await closePreviousMonthIfMissing(db, f, "acc-1", "tok", sec("2026-09-04T00:00:01Z"));

  assertExists(insertedRow);
  assertEquals(insertedRow, {
    instagram_account_id: "acc-1",
    month: "2026-08-01",
    reach_month: null,
    views_month: null,
    saves_month: null,
    accounts_engaged_month: null,
    profile_views_month: null,
    website_clicks_month: null,
    follows_month: null,
    unfollows_month: null,
  });
});

// --- closeStoriesForMonth ---------------------------------------------------
//
// Own fake db, scoped to the two tables this function reads from
// (instagram_account_metrics_daily, instagram_story_insights) plus the one it
// writes to (instagram_account_metrics_monthly) -- distinct from the
// closePreviousMonthIfMissing mocks above, which model a single row via
// chained .eq() calls resolving straight to .maybeSingle()/.insert(), not a
// filterable table.

interface DailyRow {
  instagram_account_id: string;
  snapshot_date: string;
  stories_count_day: number | null;
}

interface StoryInsightRow {
  instagram_account_id: string;
  posted_at: string;
  reach?: number;
  impressions?: number;
  replies?: number;
  taps_forward?: number;
  taps_back?: number;
  exits?: number;
}

interface MonthlyStoriesRow {
  instagram_account_id: string;
  month: string;
  stories_count_month?: number | null;
  [key: string]: unknown;
}

interface StoriesFakeState {
  daily: DailyRow[];
  storyInsights: StoryInsightRow[];
  monthly: MonthlyStoriesRow[];
}

// Read-only builder: chains eq/gte/lt/not as narrowing filters over `rows`,
// terminating either via limit().maybeSingle() (single-row probe, mirrors
// the coverage-check query) or by being awaited directly (mirrors the
// aggregation query, which has no .maybeSingle()).
// deno-lint-ignore no-explicit-any
function readTable(rows: any[]) {
  let data = rows.slice();
  // deno-lint-ignore no-explicit-any
  const builder: any = {
    select() { return builder; },
    eq(col: string, val: unknown) { data = data.filter((r) => r[col] === val); return builder; },
    gte(col: string, val: unknown) { data = data.filter((r) => String(r[col]) >= String(val)); return builder; },
    lt(col: string, val: unknown) { data = data.filter((r) => String(r[col]) < String(val)); return builder; },
    not(col: string, op: string, val: unknown) {
      if (op === "is" && val === null) data = data.filter((r) => r[col] !== null && r[col] !== undefined);
      return builder;
    },
    limit(n: number) { data = data.slice(0, n); return builder; },
    maybeSingle() { return Promise.resolve({ data: data[0] ?? null, error: null }); },
    then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
      return Promise.resolve({ data, error: null }).then(onFulfilled, onRejected);
    },
  };
  return builder;
}

// Write builder for the monthly table: only `.update(patch).eq(...).eq(...)
// .is(...)` is exercised by closeStoriesForMonth, applying `patch` to
// whichever rows still match once the chain is awaited -- so the
// `.is("stories_count_month", null)` idempotency guard is enforced for real,
// not just recorded.
function monthlyStoriesTable(state: StoriesFakeState) {
  return {
    update(patch: Record<string, unknown>) {
      let matches = state.monthly.slice();
      // deno-lint-ignore no-explicit-any
      const upd: any = {
        eq(col: string, val: unknown) {
          matches = matches.filter((r) => (r as Record<string, unknown>)[col] === val);
          return upd;
        },
        is(col: string, val: unknown) {
          matches = matches.filter((r) => ((r as Record<string, unknown>)[col] ?? null) === val);
          return upd;
        },
        then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
          for (const row of matches) Object.assign(row, patch);
          return Promise.resolve({ error: null }).then(onFulfilled, onRejected);
        },
      };
      return upd;
    },
  };
}

function storiesDb(state: StoriesFakeState) {
  return {
    from(table: string) {
      if (table === "instagram_account_metrics_daily") return readTable(state.daily);
      if (table === "instagram_story_insights") return readTable(state.storyInsights);
      if (table === "instagram_account_metrics_monthly") return monthlyStoriesTable(state);
      throw new Error(`fake db: tabela inesperada ${table}`);
    },
  };
}

Deno.test("closeStoriesForMonth: sem cobertura no mês (nenhum dia com stories_count_day) não escreve nada", async () => {
  const state: StoriesFakeState = {
    daily: [{ instagram_account_id: "acc-1", snapshot_date: "2026-08-15", stories_count_day: null }],
    storyInsights: [],
    monthly: [{ instagram_account_id: "acc-1", month: "2026-08-01", stories_count_month: null }],
  };

  await closeStoriesForMonth(storiesDb(state), "acc-1", "2026-08");

  // Guard returned early -- the monthly row is untouched (still null, no
  // fabricated all-zero row for an account with no tracked Stories activity).
  assertEquals(state.monthly[0].stories_count_month, null);
});

Deno.test("closeStoriesForMonth: com cobertura, agrega instagram_story_insights do mês e escreve os totais", async () => {
  const state: StoriesFakeState = {
    daily: [
      { instagram_account_id: "acc-1", snapshot_date: "2026-08-10", stories_count_day: 2 },
    ],
    storyInsights: [
      { instagram_account_id: "acc-1", posted_at: "2026-08-05T10:00:00Z", reach: 100, impressions: 150, replies: 1, taps_forward: 10, taps_back: 2, exits: 3 },
      { instagram_account_id: "acc-1", posted_at: "2026-08-31T23:59:59Z", reach: 50, impressions: 80, replies: 0, taps_forward: 5, taps_back: 1, exits: 1 },
      // Just outside the month on both ends -- must NOT be counted. This is
      // exactly the boundary the snapshot_date/posted_at bounds must get
      // right: full "YYYY-MM-DD"/ISO bounds, not a bare "YYYY-MM" truncation.
      { instagram_account_id: "acc-1", posted_at: "2026-07-31T23:59:59Z", reach: 999 },
      { instagram_account_id: "acc-1", posted_at: "2026-09-01T00:00:00Z", reach: 999 },
      // Different account -- must not leak into acc-1's totals.
      { instagram_account_id: "acc-2", posted_at: "2026-08-10T00:00:00Z", reach: 999 },
    ],
    monthly: [{ instagram_account_id: "acc-1", month: "2026-08-01", stories_count_month: null }],
  };

  await closeStoriesForMonth(storiesDb(state), "acc-1", "2026-08");

  assertEquals(state.monthly[0], {
    instagram_account_id: "acc-1",
    month: "2026-08-01",
    stories_count_month: 2,
    stories_reach_month: 150,
    stories_impressions_month: 230,
    stories_replies_month: 1,
    stories_taps_forward_month: 15,
    stories_taps_back_month: 3,
    stories_exits_month: 4,
  });
});

Deno.test("closeStoriesForMonth: idempotente -- não sobrescreve quando stories_count_month já está preenchido", async () => {
  const state: StoriesFakeState = {
    daily: [{ instagram_account_id: "acc-1", snapshot_date: "2026-08-10", stories_count_day: 1 }],
    storyInsights: [
      { instagram_account_id: "acc-1", posted_at: "2026-08-05T10:00:00Z", reach: 100 },
    ],
    // Month already closed (e.g. by a previous tick) -- a second run must
    // leave the persisted totals alone via `.is("stories_count_month", null)`.
    monthly: [{ instagram_account_id: "acc-1", month: "2026-08-01", stories_count_month: 5, stories_reach_month: 9999 }],
  };

  await closeStoriesForMonth(storiesDb(state), "acc-1", "2026-08");

  assertEquals(state.monthly[0].stories_count_month, 5);
  assertEquals(state.monthly[0].stories_reach_month, 9999);
});

Deno.test("closeStoriesForMonth: virada de ano (dezembro -> janeiro) delimita o mês corretamente", async () => {
  const state: StoriesFakeState = {
    daily: [{ instagram_account_id: "acc-1", snapshot_date: "2026-12-20", stories_count_day: 1 }],
    storyInsights: [
      { instagram_account_id: "acc-1", posted_at: "2026-12-31T23:00:00Z", reach: 10 },
      { instagram_account_id: "acc-1", posted_at: "2027-01-01T00:00:00Z", reach: 999 }, // excluded
    ],
    monthly: [{ instagram_account_id: "acc-1", month: "2026-12-01", stories_count_month: null }],
  };

  await closeStoriesForMonth(storiesDb(state), "acc-1", "2026-12");

  assertEquals(state.monthly[0].stories_count_month, 1);
  assertEquals(state.monthly[0].stories_reach_month, 10);
});

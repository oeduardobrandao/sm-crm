import { assertEquals } from "jsr:@std/assert";
import {
  anchorFollowerTotals, nextBackfillMonth, runMaintenanceStep,
} from "../instagram-sync-cron/backfill.ts";

const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);

// --- Step 1: nextBackfillMonth (verbatim do brief) ------------------------

const NOW = sec("2026-09-05T12:00:00Z");

Deno.test("primeiro alvo é o mês anterior completo", () => {
  assertEquals(nextBackfillMonth(null, NOW), { month: "2026-08-01", done: false });
});

Deno.test("cursor anda um mês para trás", () => {
  assertEquals(nextBackfillMonth("2026-08-01", NOW), { month: "2026-07-01", done: false });
});

Deno.test("cap de 12 meses encerra", () => {
  assertEquals(nextBackfillMonth("2025-09-01", NOW).done, true);
});

// --- anchorFollowerTotals ---------------------------------------------------

Deno.test("anchorFollowerTotals: ancora no total atual e anda para trás por delta", () => {
  const deltas = new Map([
    ["2026-08-30", 3], // delta do dia 30 (variação entre 29 e 30)
    ["2026-08-31", 5], // delta do dia 31 (variação entre 30 e 31)
  ]);
  const result = anchorFollowerTotals(100, deltas);
  // total[31] = 100 (âncora); total[30] = 100 - 5 = 95; total[29] = 95 - 3 = 92
  assertEquals(result, new Map([
    ["2026-08-31", 100],
    ["2026-08-30", 95],
    ["2026-08-29", 92],
  ]));
});

Deno.test("anchorFollowerTotals: para no primeiro buraco, sem fabricar dado", () => {
  const deltas = new Map([
    ["2026-08-25", 1], // buraco entre 25 e 30 -- não deveria ser alcançado
    ["2026-08-30", 5],
    ["2026-08-31", 2],
  ]);
  const result = anchorFollowerTotals(50, deltas);
  // anda 31 -> 30 -> 29 (esperado), mas 29 não está no mapa -- para ali.
  // 25 nunca é consumido.
  assertEquals(result, new Map([
    ["2026-08-31", 50],
    ["2026-08-30", 48],
    ["2026-08-29", 43],
  ]));
});

Deno.test("anchorFollowerTotals: mapa vazio devolve mapa vazio", () => {
  assertEquals(anchorFollowerTotals(100, new Map()), new Map());
});

// --- runMaintenanceStep -----------------------------------------------------

interface AccountRow {
  id: string;
  authorization_status: string;
  encrypted_access_token: string | null;
  follower_count: number;
  metrics_backfill_cursor: string | null;
  metrics_backfilled_at: string | null;
}

interface FakeState {
  accounts: AccountRow[];
  monthly: Array<Record<string, unknown>>;
  followerHistory: Array<{ instagram_account_id: string; date: string; follower_count: number; source: string }>;
  dailyUpserts: Array<Record<string, unknown>[]>;
}

function accountsTable(state: FakeState) {
  const filters: Array<(row: AccountRow) => boolean> = [];
  // deno-lint-ignore no-explicit-any
  const builder: any = {
    select() { return builder; },
    eq(col: string, val: unknown) {
      filters.push((r) => (r as unknown as Record<string, unknown>)[col] === val);
      return builder;
    },
    not(col: string, op: string, val: unknown) {
      if (op === "in") {
        // supabase-js: `.not(col, 'in', '(1,2,3)')` -- exclui ids na lista.
        const excluded = new Set(String(val).replace(/[()]/g, "").split(",").filter(Boolean));
        filters.push((r) => !excluded.has(String((r as unknown as Record<string, unknown>)[col])));
      } else {
        filters.push((r) => (r as unknown as Record<string, unknown>)[col] !== val);
      }
      return builder;
    },
    is(col: string, val: unknown) {
      filters.push((r) => (r as unknown as Record<string, unknown>)[col] == val);
      return builder;
    },
    order() { return builder; },
    limit(n: number) {
      const rows = state.accounts.filter((r) => filters.every((f) => f(r))).slice(0, n);
      return Promise.resolve({ data: rows, error: null });
    },
    update(patch: Record<string, unknown>) {
      return {
        eq(col: string, val: unknown) {
          const row = state.accounts.find((r) => (r as unknown as Record<string, unknown>)[col] === val);
          if (row) Object.assign(row, patch);
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return builder;
}

function monthlyTable(state: FakeState) {
  const filters: Array<(row: Record<string, unknown>) => boolean> = [];
  // deno-lint-ignore no-explicit-any
  const builder: any = {
    select() { return builder; },
    eq(col: string, val: unknown) {
      filters.push((r) => r[col] === val);
      return builder;
    },
    maybeSingle() {
      const row = state.monthly.find((r) => filters.every((f) => f(r)));
      return Promise.resolve({ data: row ?? null, error: null });
    },
    // Fallback: `select(...).eq(...)` sem `.maybeSingle()` (ex.: a query de
    // exclusão do passo 2, que lê TODAS as contas já fechadas num mês).
    then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
      const rows = state.monthly.filter((r) => filters.every((f) => f(r)));
      return Promise.resolve({ data: rows, error: null }).then(onFulfilled, onRejected);
    },
    insert(row: Record<string, unknown>) {
      state.monthly.push(row);
      return Promise.resolve({ error: null });
    },
    upsert(row: Record<string, unknown>) {
      const idx = state.monthly.findIndex(
        (r) => r.instagram_account_id === row.instagram_account_id && r.month === row.month,
      );
      if (idx >= 0) state.monthly[idx] = row; else state.monthly.push(row);
      return Promise.resolve({ error: null });
    },
  };
  return builder;
}

function followerTable(state: FakeState) {
  const filters: Array<(row: { instagram_account_id: string; date: string; source: string }) => boolean> = [];
  let inFilter: { col: string; vals: unknown[] } | null = null;
  const resolve = () => {
    const rows = state.followerHistory.filter(
      (r) => filters.every((f) => f(r)) && (!inFilter || inFilter.vals.includes((r as unknown as Record<string, unknown>)[inFilter!.col])),
    );
    return { data: rows, error: null };
  };
  // deno-lint-ignore no-explicit-any
  const builder: any = {
    select() { return builder; },
    eq(col: string, val: unknown) {
      filters.push((r) => (r as unknown as Record<string, unknown>)[col] === val);
      return builder;
    },
    in(col: string, vals: unknown[]) { inFilter = { col, vals }; return builder; },
    then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
      return Promise.resolve(resolve()).then(onFulfilled, onRejected);
    },
    upsert(rows: Array<{ instagram_account_id: string; date: string; follower_count: number; source: string }>) {
      for (const row of rows) {
        const idx = state.followerHistory.findIndex(
          (r) => r.instagram_account_id === row.instagram_account_id && r.date === row.date,
        );
        if (idx >= 0) state.followerHistory[idx] = row; else state.followerHistory.push(row);
      }
      return Promise.resolve({ error: null });
    },
  };
  return builder;
}

function makeDb(state: FakeState) {
  return {
    from(table: string) {
      if (table === "instagram_accounts") return accountsTable(state);
      if (table === "instagram_account_metrics_monthly") return monthlyTable(state);
      if (table === "instagram_follower_history") return followerTable(state);
      throw new Error(`fake db: tabela inesperada ${table}`);
    },
    rpc(name: string, args: { p_rows: Record<string, unknown>[] }) {
      if (name === "upsert_metrics_daily") {
        state.dailyUpserts.push(args.p_rows);
        return Promise.resolve({ error: null });
      }
      throw new Error(`fake db: rpc inesperada ${name}`);
    },
  };
}

function emptyState(accounts: AccountRow[]): FakeState {
  return { accounts, monthly: [], followerHistory: [], dailyUpserts: [] };
}

const decryptToken = (b64: string) => Promise.resolve(`decrypted:${b64}`);

function graphOkFetch(simpleValues: Record<string, number>, dailyReach: Record<string, number> = {}, followerDeltas: Record<string, number> = {}) {
  return (async (url: string) => {
    const u = new URL(url);
    const metric = u.searchParams.get("metric");
    if (metric === "follows_and_unfollows") {
      return {
        json: () => Promise.resolve({
          data: [{
            name: "follows_and_unfollows",
            total_value: { breakdowns: [{ results: [
              { dimension_values: ["FOLLOWER"], value: 20 },
              { dimension_values: ["NON_FOLLOWER"], value: 5 },
            ] }] },
          }],
        }),
      };
    }
    if (metric === "reach" && !u.searchParams.get("metric_type")) {
      // fetchReachDaily: série diária, sem metric_type=total_value
      return {
        json: () => Promise.resolve({
          data: [{
            name: "reach",
            values: Object.entries(dailyReach).map(([date, value]) => ({
              value, end_time: `${date}T07:00:00+0000`,
            })),
          }],
        }),
      };
    }
    if (metric === "follower_count") {
      return {
        json: () => Promise.resolve({
          data: [{
            name: "follower_count",
            values: Object.entries(followerDeltas).map(([date, value]) => ({
              value, end_time: `${date}T07:00:00+0000`,
            })),
          }],
        }),
      };
    }
    return {
      json: () => Promise.resolve({
        data: [{ name: metric, total_value: { value: simpleValues[metric!] } }],
      }),
    };
  }) as unknown as typeof fetch;
}

const SIMPLE_VALUES: Record<string, number> = {
  reach: 500, views: 200, saves: 10, accounts_engaged: 300,
  profile_views: 50, website_clicks: 5,
};

Deno.test("runMaintenanceStep: primeiro tick roda extras (reach_day + histórico) + mês, avança cursor", async () => {
  const state = emptyState([{
    id: "acc-1", authorization_status: "active", encrypted_access_token: "enc-1",
    follower_count: 1000, metrics_backfill_cursor: null, metrics_backfilled_at: null,
  }]);
  const f = graphOkFetch(SIMPLE_VALUES, { "2026-08-30": 10 }, { "2026-08-30": 3 });

  const result = await runMaintenanceStep(makeDb(state), f, decryptToken, {
    batchLimit: 3, nowSec: NOW,
  });

  assertEquals(result, { backfilled: 1, monthsClosed: 0 });
  assertEquals(state.accounts[0].metrics_backfill_cursor, "2026-08-01");
  assertEquals(state.accounts[0].metrics_backfilled_at, null);
  assertEquals(state.monthly.length, 1);
  assertEquals(state.monthly[0].month, "2026-08-01");
  assertEquals(state.monthly[0].reach_month, 500);
  // extras de primeiro tick: reach_day via RPC + follower_history ancorado
  assertEquals(state.dailyUpserts.length, 1);
  assertEquals(state.dailyUpserts[0][0].reach_day, 10);
  // ancoragem: delta único em 2026-08-30 produz o próprio dia (âncora =
  // follower_count atual) + o dia anterior (total - delta)
  assertEquals(state.followerHistory.length, 2);
  const byDate = new Map(state.followerHistory.map((r) => [r.date, r.follower_count]));
  assertEquals(byDate.get("2026-08-30"), 1000);
  assertEquals(byDate.get("2026-08-29"), 997);
});

Deno.test("runMaintenanceStep: tick subsequente (cursor já setado) não repete os extras de primeiro tick", async () => {
  const state = emptyState([{
    id: "acc-1", authorization_status: "active", encrypted_access_token: "enc-1",
    follower_count: 1000, metrics_backfill_cursor: "2026-08-01", metrics_backfilled_at: null,
  }]);
  const f = graphOkFetch(SIMPLE_VALUES);

  const result = await runMaintenanceStep(makeDb(state), f, decryptToken, {
    batchLimit: 3, nowSec: NOW,
  });

  assertEquals(result, { backfilled: 1, monthsClosed: 0 });
  assertEquals(state.accounts[0].metrics_backfill_cursor, "2026-07-01");
  assertEquals(state.dailyUpserts.length, 0);
  assertEquals(state.followerHistory.length, 0);
});

Deno.test("runMaintenanceStep: mês HONESTAMENTE vazio (Graph OK, sem dado, sem falha) marca metrics_backfilled_at -- passo 1 não insere linha própria", async () => {
  const state = emptyState([{
    id: "acc-1", authorization_status: "active", encrypted_access_token: "enc-1",
    follower_count: 1000, metrics_backfill_cursor: "2026-08-01", metrics_backfilled_at: null,
  }]);
  // Graph responde 200 OK com `data: []` para tudo -- sem `.error`, é um mês
  // genuinamente vazio (fim de retenção), não uma falha transitória.
  const f = (() => Promise.resolve({
    json: () => Promise.resolve({ data: [] }),
  })) as unknown as typeof fetch;

  const result = await runMaintenanceStep(makeDb(state), f, decryptToken, {
    batchLimit: 3, nowSec: NOW,
  });

  assertEquals(result.backfilled, 1);
  assertEquals(typeof state.accounts[0].metrics_backfilled_at, "string");
  // O passo 1 (backfillOneAccount) não insere linha nenhuma para o mês-alvo
  // 2026-07 (fim de retenção, sem falha). A ÚNICA linha que aparece vem do
  // passo 2 (closePreviousMonthIfMissing, achado P1 rodada 3 -- monthly-close
  // agora insere uma linha de nulls quando o mês vem honestamente vazio SEM
  // falha, marcando-o como já verificado): esta conta acabou de virar "já
  // backfillada" durante o passo 1 e passa a ser elegível ao passo 2 na MESMA
  // invocação -- mesmo mock (`data: []` para tudo) também resolve o mês
  // 2026-08 (prevMonthOf de NOW) como honestamente vazio ali.
  assertEquals(state.monthly.length, 1);
  assertEquals(state.monthly[0].month, "2026-08-01");
  assertEquals(state.monthly[0].reach_month, null);
});

Deno.test("runMaintenanceStep: mês all-null POR FALHA (não-190) não finaliza -- cursor intocado, retentado no próximo tick (fix round 2)", async () => {
  const state = emptyState([{
    id: "acc-1", authorization_status: "active", encrypted_access_token: "enc-1",
    follower_count: 1000, metrics_backfill_cursor: "2026-08-01", metrics_backfilled_at: null,
  }]);
  // Toda métrica volta com um erro Graph não-190 (ex.: instabilidade
  // temporária) -- indistinguível de "vazio" olhando só os totais, mas
  // fetchAccountTotalsDetailed sabe que houve falha. ANTES do fix round 2,
  // isso marcava metrics_backfilled_at e perdia todos os meses mais antigos
  // permanentemente por causa de um blip transitório.
  let calls = 0;
  const f = (() => {
    calls++;
    return Promise.resolve({
      json: () => Promise.resolve({ error: { code: 100, message: "metric not available" } }),
    });
  }) as unknown as typeof fetch;

  const result = await runMaintenanceStep(makeDb(state), f, decryptToken, {
    batchLimit: 3, nowSec: NOW,
  });

  assertEquals(result.backfilled, 0); // não progrediu -- nem finalizou, nem avançou
  assertEquals(state.monthly.length, 0);
  assertEquals(state.accounts[0].metrics_backfilled_at, null); // NÃO finalizado
  assertEquals(state.accounts[0].metrics_backfill_cursor, "2026-08-01"); // intocado

  // Próximo tick reprocessa o MESMO mês (2026-07-01, já que o cursor não
  // avançou) -- desta vez a Graph responde normalmente.
  const f2 = graphOkFetch(SIMPLE_VALUES);
  const result2 = await runMaintenanceStep(makeDb(state), f2, decryptToken, {
    batchLimit: 3, nowSec: NOW,
  });
  assertEquals(result2.backfilled, 1);
  assertEquals(state.monthly.length, 1);
  assertEquals(state.monthly[0].month, "2026-07-01"); // o mesmo mês que falhou antes
  assertEquals(state.accounts[0].metrics_backfill_cursor, "2026-07-01");
  assertEquals(calls > 0, true); // confirma que a primeira tentativa realmente chamou a Graph
});

Deno.test("runMaintenanceStep: mês PARCIAL (algumas métricas vieram, outras falharam) salva o que veio mas NÃO avança o cursor (achado P1 rodada 3)", async () => {
  const state = emptyState([{
    // Cursor em 2026-07-01 -> alvo é 2026-06-01 (junho, 30 dias): um único
    // chunk de 30d por métrica aditiva/follows, sem duplicar o valor mockado
    // (mesma razão do teste "dia 4+" em monthly-close.ts para um mês de 31
    // dias vs 30) -- necessário aqui porque, ao contrário dos outros testes
    // deste arquivo, este afirma o VALOR exato de campos aditivos.
    id: "acc-1", authorization_status: "active", encrypted_access_token: "enc-1",
    follower_count: 1000, metrics_backfill_cursor: "2026-07-01", metrics_backfilled_at: null,
  }]);
  // `views` volta com erro Graph não-190; as outras 6 métricas vêm normais.
  // ANTES do fix, hasAny=true (6 de 7 vieram) fazia a linha ser upsertada E
  // o cursor avançar -- perdendo `views` desse mês para sempre, já que o
  // próximo tick nunca mais reprocessa um mês já avançado.
  const f = (async (url: string) => {
    const u = new URL(url);
    const metric = u.searchParams.get("metric");
    if (metric === "views") {
      return { json: () => Promise.resolve({ error: { code: 100, message: "metric not available" } }) };
    }
    if (metric === "follows_and_unfollows") {
      return {
        json: () => Promise.resolve({
          data: [{
            name: "follows_and_unfollows",
            total_value: { breakdowns: [{ results: [
              { dimension_values: ["FOLLOWER"], value: 20 },
              { dimension_values: ["NON_FOLLOWER"], value: 5 },
            ] }] },
          }],
        }),
      };
    }
    return {
      json: () => Promise.resolve({
        data: [{ name: metric, total_value: { value: SIMPLE_VALUES[metric!] } }],
      }),
    };
  }) as unknown as typeof fetch;

  const result = await runMaintenanceStep(makeDb(state), f, decryptToken, {
    batchLimit: 3, nowSec: NOW,
  });

  assertEquals(result.backfilled, 0); // não finalizou nem avançou -- não conta como progresso
  assertEquals(state.accounts[0].metrics_backfill_cursor, "2026-07-01"); // INTOCADO
  assertEquals(state.accounts[0].metrics_backfilled_at, null);

  // A linha do mês foi salva com o que veio -- views_month null, o resto com
  // valor real. Isso é o que permite o retry seguinte apenas REFAZER o campo
  // que faltou em vez de perder também o que já tinha sido obtido.
  assertEquals(state.monthly.length, 1);
  assertEquals(state.monthly[0].month, "2026-06-01");
  assertEquals(state.monthly[0].views_month, null);
  assertEquals(state.monthly[0].reach_month, 500);
  assertEquals(state.monthly[0].follows_month, 20);

  // Próximo tick reprocessa o MESMO mês (cursor intocado); desta vez `views`
  // também vem -- o upsert PREENCHE o campo que faltava na mesma linha (não
  // duplica) e ENTÃO avança o cursor.
  const f2 = graphOkFetch(SIMPLE_VALUES);
  const result2 = await runMaintenanceStep(makeDb(state), f2, decryptToken, {
    batchLimit: 3, nowSec: NOW,
  });
  assertEquals(result2.backfilled, 1);
  assertEquals(state.monthly.length, 1); // upsert atualizou a MESMA linha, não duplicou
  assertEquals(state.monthly[0].views_month, 200);
  assertEquals(state.accounts[0].metrics_backfill_cursor, "2026-06-01");
});

Deno.test("runMaintenanceStep: cursor no cap de 12 meses marca metrics_backfilled_at sem fetch de backfill", async () => {
  const state = emptyState([{
    id: "acc-1", authorization_status: "active", encrypted_access_token: "enc-1",
    follower_count: 1000, metrics_backfill_cursor: "2025-09-01", metrics_backfilled_at: null,
  }]);
  let graphCalls = 0;
  const f = (() => { graphCalls++; return Promise.resolve({ json: () => Promise.resolve({}) }); }) as unknown as typeof fetch;

  const result = await runMaintenanceStep(makeDb(state), f, decryptToken, {
    batchLimit: 3, nowSec: NOW,
  });

  assertEquals(result.backfilled, 1);
  // O cursor não avança (cap encerrou o backfill sem tocar a Graph) --
  // continua no valor pré-cap.
  assertEquals(state.accounts[0].metrics_backfill_cursor, "2025-09-01");
  assertEquals(typeof state.accounts[0].metrics_backfilled_at, "string");
  // O passo 1 (cap) faz ZERO chamadas Graph. As 12 observadas vêm do passo 2
  // (closePreviousMonthIfMissing), que roda na MESMA invocação porque esta
  // conta acabou de virar "já backfillada" durante o passo 1 -- 2 métricas
  // únicas (reach, accounts_engaged) em request único de 31d + 4 métricas
  // aditivas + follows_and_unfollows em 2 chunks de 30d cada (mês de agosto,
  // 31 dias) = 2 + 4*2 + 2 = 12.
  assertEquals(graphCalls, 12);
  // O mock devolve JSON vazio (sem `.error`) para tudo -- zero falhas, mês
  // honestamente vazio. Achado P1 rodada 3: monthly-close AGORA insere essa
  // linha de nulls mesmo assim (era pulada antes), pois a linha em si é o
  // único marcador de "mês já verificado" que este módulo tem -- sem ela,
  // todo tick de manutenção reconsultaria a Graph à toa para este mês.
  assertEquals(state.monthly.length, 1);
  assertEquals(state.monthly[0].month, "2026-08-01");
  assertEquals(state.monthly[0].reach_month, null);
});

Deno.test("runMaintenanceStep: TOKEN_EXPIRED marca authorization_status=expired e não derruba o passo", async () => {
  const state = emptyState([
    {
      id: "acc-expired", authorization_status: "active", encrypted_access_token: "enc-1",
      follower_count: 1000, metrics_backfill_cursor: "2026-08-01", metrics_backfilled_at: null,
    },
    {
      id: "acc-ok", authorization_status: "active", encrypted_access_token: "enc-2",
      follower_count: 500, metrics_backfill_cursor: "2026-08-01", metrics_backfilled_at: null,
    },
  ]);
  const f = ((url: string) => {
    // simula 190 apenas para a primeira conta -- diferenciada pelo token
    if (url.includes("access_token=decrypted%3Aenc-1") || url.includes("access_token=decrypted:enc-1")) {
      return Promise.resolve({ json: () => Promise.resolve({ error: { code: 190, message: "expired" } }) });
    }
    const u = new URL(url);
    const metric = u.searchParams.get("metric");
    if (metric === "follows_and_unfollows") {
      return Promise.resolve({
        json: () => Promise.resolve({
          data: [{ name: "follows_and_unfollows", total_value: { breakdowns: [{ results: [
            { dimension_values: ["FOLLOWER"], value: 1 }, { dimension_values: ["NON_FOLLOWER"], value: 0 },
          ] }] } }],
        }),
      });
    }
    return Promise.resolve({
      json: () => Promise.resolve({ data: [{ name: metric, total_value: { value: SIMPLE_VALUES[metric!] } }] }),
    });
  }) as unknown as typeof fetch;

  const result = await runMaintenanceStep(makeDb(state), f, decryptToken, {
    batchLimit: 3, nowSec: NOW,
  });

  assertEquals(state.accounts[0].authorization_status, "expired");
  assertEquals(state.accounts[0].metrics_backfill_cursor, "2026-08-01"); // não avançou
  assertEquals(state.accounts[1].authorization_status, "active");
  assertEquals(state.accounts[1].metrics_backfill_cursor, "2026-07-01"); // avançou normalmente
  assertEquals(result.backfilled, 1); // só a conta ok progrediu
});

Deno.test("runMaintenanceStep: seletor de pendentes ignora contas já backfilladas, inativas ou sem token", async () => {
  const state = emptyState([
    { id: "done", authorization_status: "active", encrypted_access_token: "enc", follower_count: 1, metrics_backfill_cursor: "2020-01-01", metrics_backfilled_at: "2026-01-01T00:00:00Z" },
    { id: "inactive", authorization_status: "expired", encrypted_access_token: "enc", follower_count: 1, metrics_backfill_cursor: null, metrics_backfilled_at: null },
    { id: "no-token", authorization_status: "active", encrypted_access_token: null, follower_count: 1, metrics_backfill_cursor: null, metrics_backfilled_at: null },
  ]);
  const f = graphOkFetch(SIMPLE_VALUES);

  const result = await runMaintenanceStep(makeDb(state), f, decryptToken, {
    batchLimit: 3, nowSec: NOW,
  });

  // nenhuma das três é elegível para o backfill pendente
  assertEquals(result.backfilled, 0);
  // "done" É elegível para o fechamento mensal (metrics_backfilled_at setado)
  assertEquals(result.monthsClosed, 1);
});

Deno.test("runMaintenanceStep: respeita batchLimit no seletor de pendentes", async () => {
  const state = emptyState([
    { id: "a1", authorization_status: "active", encrypted_access_token: "enc", follower_count: 1, metrics_backfill_cursor: "2026-08-01", metrics_backfilled_at: null },
    { id: "a2", authorization_status: "active", encrypted_access_token: "enc", follower_count: 1, metrics_backfill_cursor: "2026-08-01", metrics_backfilled_at: null },
    { id: "a3", authorization_status: "active", encrypted_access_token: "enc", follower_count: 1, metrics_backfill_cursor: "2026-08-01", metrics_backfilled_at: null },
  ]);
  const f = graphOkFetch(SIMPLE_VALUES);

  const result = await runMaintenanceStep(makeDb(state), f, decryptToken, {
    batchLimit: 2, nowSec: NOW,
  });

  assertEquals(result.backfilled, 2);
});

Deno.test("runMaintenanceStep: contas já backfilladas passam por closePreviousMonthIfMissing", async () => {
  const state = emptyState([{
    id: "acc-1", authorization_status: "active", encrypted_access_token: "enc-1",
    follower_count: 1000, metrics_backfill_cursor: "2020-01-01", metrics_backfilled_at: "2026-01-01T00:00:00Z",
  }]);
  const f = graphOkFetch(SIMPLE_VALUES);

  // dia 5 de setembro -- dentro da janela de finalização, mês de agosto ainda
  // dentro dos 90d de retenção
  const result = await runMaintenanceStep(makeDb(state), f, decryptToken, {
    batchLimit: 3, nowSec: NOW,
  });

  assertEquals(result.monthsClosed, 1);
  assertEquals(state.monthly.length, 1);
  assertEquals(state.monthly[0].month, "2026-08-01");
});

// --- Fix round 1 -------------------------------------------------------

Deno.test("runMaintenanceStep: fechamento mensal não starva contas com id fora da página fixa (fix round 1, achado 1)", async () => {
  // 3 contas já backfilladas, closeBatchLimit artificialmente baixo (2) para
  // simular "mais contas do que cabem numa página" sem precisar de 51 contas
  // reais. Sem a exclusão, tick 2 selecionaria de novo c1+c2 (menores ids) e
  // c3 nunca seria alcançada.
  const state = emptyState([
    { id: "c1", authorization_status: "active", encrypted_access_token: "enc", follower_count: 1, metrics_backfill_cursor: "2020-01-01", metrics_backfilled_at: "2026-01-01T00:00:00Z" },
    { id: "c2", authorization_status: "active", encrypted_access_token: "enc", follower_count: 1, metrics_backfill_cursor: "2020-01-01", metrics_backfilled_at: "2026-01-01T00:00:00Z" },
    { id: "c3", authorization_status: "active", encrypted_access_token: "enc", follower_count: 1, metrics_backfill_cursor: "2020-01-01", metrics_backfilled_at: "2026-01-01T00:00:00Z" },
  ]);
  const f = graphOkFetch(SIMPLE_VALUES);
  const db = makeDb(state);

  // Tick 1: página de 2, ninguém fechado ainda -- pega c1 e c2 (menores ids).
  const tick1 = await runMaintenanceStep(db, f, decryptToken, {
    batchLimit: 3, nowSec: NOW, closeBatchLimit: 2,
  });
  assertEquals(tick1.monthsClosed, 2);
  assertEquals(state.monthly.map((r) => r.instagram_account_id).sort(), ["c1", "c2"]);

  // Tick 2: c1 e c2 já têm a linha de 2026-08-01 -- excluídos do seletor.
  // c3 (que ficaria starvada com um limit(2) sem exclusão) é alcançada.
  const tick2 = await runMaintenanceStep(db, f, decryptToken, {
    batchLimit: 3, nowSec: NOW, closeBatchLimit: 2,
  });
  assertEquals(tick2.monthsClosed, 1);
  assertEquals(state.monthly.map((r) => r.instagram_account_id).sort(), ["c1", "c2", "c3"]);
});

Deno.test("runMaintenanceStep: TOKEN_EXPIRED durante os extras de primeiro tick marca expired sem gastar o fetch do mês (fix round 1, achado 2)", async () => {
  const state = emptyState([{
    id: "acc-1", authorization_status: "active", encrypted_access_token: "enc-1",
    follower_count: 1000, metrics_backfill_cursor: null, metrics_backfilled_at: null,
  }]);
  let graphCalls = 0;
  const f = ((url: string) => {
    graphCalls++;
    const u = new URL(url);
    const metric = u.searchParams.get("metric");
    // reach_day (fetchReachDaily): metric=reach SEM metric_type -- token expirado.
    if (metric === "reach" && !u.searchParams.get("metric_type")) {
      return Promise.resolve({ json: () => Promise.resolve({ error: { code: 190, message: "expired" } }) });
    }
    // Qualquer outra chamada (follower deltas, mês) não deveria acontecer --
    // devolve algo que faria o teste falhar de forma óbvia se acontecesse.
    return Promise.resolve({
      json: () => Promise.resolve({ data: [{ name: metric, total_value: { value: 999 } }] }),
    });
  }) as unknown as typeof fetch;

  const result = await runMaintenanceStep(makeDb(state), f, decryptToken, {
    batchLimit: 3, nowSec: NOW,
  });

  assertEquals(state.accounts[0].authorization_status, "expired");
  assertEquals(state.accounts[0].metrics_backfill_cursor, null); // nunca chegou no mês
  assertEquals(state.monthly.length, 0);
  assertEquals(result.backfilled, 0);
  // fetchReachDaily dispara os 3 chunks de 90d em paralelo antes de rejeitar
  // -- todos os 3 já foram despachados quando o Promise.all rejeita. Nenhuma
  // chamada extra (follower deltas, mês) acontece depois.
  assertEquals(graphCalls, 3);
});

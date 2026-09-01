import { assertEquals, assertExists } from "jsr:@std/assert";
import { closePreviousMonthIfMissing } from "../instagram-sync-cron/monthly-close.ts";

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

Deno.test("mês sem nenhum dado (fora da retenção da Graph): não insere linha de nulls", async () => {
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
  // Toda métrica volta com erro (não-190) -- a normalização em
  // fetchAccountTotals reduz isso a null por métrica; nenhuma vem não-null.
  const f = (() =>
    Promise.resolve({
      json: () => Promise.resolve({ error: { code: 100, message: "metric not available" } }),
    })) as unknown as typeof fetch;

  await closePreviousMonthIfMissing(db, f, "acc-1", "tok", sec("2026-09-04T00:00:01Z"));

  assertEquals(insertCalls, 0);
});

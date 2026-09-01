import { assertEquals, assertRejects } from "jsr:@std/assert";
import {
  fetchAccountTotals, fetchAccountTotalsDetailed, fetchClosedDayValues, fetchReachDaily,
  isWindowLiveEligible, UNIQUE_METRICS, VIEWS_WINDOW_DAYS,
} from "../_shared/instagram-account-metrics.ts";

const DAY = 86400;
const T0 = Math.floor(Date.parse("2026-08-01T00:00:00Z") / 1000);

function fakeFetch(handler: (url: URL) => unknown): typeof fetch {
  return ((input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const body = handler(url);
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  }) as typeof fetch;
}

Deno.test("UNIQUE_METRICS contains exactly reach and accounts_engaged", () => {
  assertEquals(UNIQUE_METRICS.has("reach"), true);
  assertEquals(UNIQUE_METRICS.has("accounts_engaged"), true);
  assertEquals(UNIQUE_METRICS.has("views"), false);
  assertEquals(UNIQUE_METRICS.size, 2);
});

Deno.test("conjunto vazio normaliza para null, nunca 0", async () => {
  const f = fakeFetch(() => ({ data: [] }));
  const r = await fetchAccountTotals(f, "tok", ["saves"], T0, T0 + 31 * DAY);
  assertEquals(r.saves, null);
});

Deno.test("métrica de únicos: um único request para a janela inteira", async () => {
  const calls: string[] = [];
  const f = fakeFetch((url) => {
    calls.push(`${url.searchParams.get("since")}-${url.searchParams.get("until")}`);
    return { data: [{ name: "reach", total_value: { value: 10281 } }] };
  });
  const r = await fetchAccountTotals(f, "tok", ["reach"], T0, T0 + 31 * DAY);
  assertEquals(r.reach, 10281);
  assertEquals(calls.length, 1); // NUNCA chunkado
});

Deno.test("métrica de únicos além do máximo: chunk-sum, nunca null pelo tamanho da janela", async () => {
  const calls: string[] = [];
  const f = fakeFetch((url) => {
    calls.push(`${url.searchParams.get("since")}-${url.searchParams.get("until")}`);
    return { data: [{ name: "reach", total_value: { value: 100 } }] };
  });
  const r = await fetchAccountTotals(f, "tok", ["reach"], T0, T0 + 61 * DAY);
  assertEquals(r.reach, 300); // 3 chunks de 30/30/1 dias, somados
  assertEquals(calls.length, 3);
});

Deno.test("métrica aditiva 31d: chunks somados", async () => {
  const f = fakeFetch(() => ({ data: [{ name: "views", total_value: { value: 100 } }] }));
  const r = await fetchAccountTotals(f, "tok", ["views"], T0, T0 + 31 * DAY);
  assertEquals(r.views, 200); // 2 chunks (30+1) de 100
});

Deno.test("falha de uma métrica não derruba as outras", async () => {
  const f = fakeFetch((url) =>
    url.searchParams.get("metric") === "saves"
      ? { error: { message: "boom" } }
      : { data: [{ name: "views", total_value: { value: 7 } }] });
  const r = await fetchAccountTotals(f, "tok", ["views", "saves"], T0, T0 + DAY);
  assertEquals(r.views, 7);
  assertEquals(r.saves, null);
});

Deno.test("falha de rede (fetch rejeita) em uma métrica não derruba as outras", async () => {
  const f = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.searchParams.get("metric") === "saves") throw new TypeError("network down");
    return new Response(
      JSON.stringify({ data: [{ name: "views", total_value: { value: 9 } }] }),
      { status: 200 },
    );
  }) as typeof fetch;
  const r = await fetchAccountTotals(f, "tok", ["views", "saves"], T0, T0 + DAY);
  assertEquals(r.views, 9);
  assertEquals(r.saves, null);
});

Deno.test("erro 190 sobe como TOKEN_EXPIRED", async () => {
  const f = fakeFetch(() => ({ error: { code: 190, message: "expired" } }));
  await assertRejects(() => fetchAccountTotals(f, "tok", ["views"], T0, T0 + DAY));
});

Deno.test("follows_and_unfollows: breakdown FOLLOWER/NON_FOLLOWER normalizado", async () => {
  const calls: string[] = [];
  const f = fakeFetch((url) => {
    calls.push(url.searchParams.get("breakdown") ?? "");
    return {
      data: [{
        name: "follows_and_unfollows",
        total_value: {
          breakdowns: [{
            dimension_keys: ["follow_type"],
            results: [
              { dimension_values: ["FOLLOWER"], value: 122 },
              { dimension_values: ["NON_FOLLOWER"], value: 68 },
            ],
          }],
        },
      }],
    };
  });
  const r = await fetchAccountTotals(f, "tok", ["follows_and_unfollows"], T0, T0 + DAY);
  assertEquals(r.follows_and_unfollows, { follows: 122, unfollows: 68, net: 54 });
  assertEquals(calls.every((b) => b === "follow_type"), true);
});

Deno.test("follows_and_unfollows: total_value ausente (sem breakdown) normaliza para null", async () => {
  const f = fakeFetch(() => ({
    data: [{ name: "follows_and_unfollows", period: "day" }],
  }));
  const r = await fetchAccountTotals(f, "tok", ["follows_and_unfollows"], T0, T0 + DAY);
  assertEquals(r.follows_and_unfollows, null);
});

// Pares reais de .superpowers/sdd/2026-08-31-report-app-parity/spike-result.json,
// bloco reach_daily. Prova da convenção (fix round 1, finding 1): a janela de
// UM dia [2026-08-31T00:00Z, 2026-09-01T00:00Z) (reach_total_chunk1) devolveu
// 579 -- o MESMO valor do último ponto de reach_daily, cujo end_time é
// "2026-08-31T07:00:00+0000". Ou seja a data do end_time É o dia medido, sem
// deslocamento de -1 dia (a hora 07:00Z é só o horário de corte da conta).
Deno.test("fetchReachDaily indexa pela DATA do end_time, sem deslocar um dia", async () => {
  const f = fakeFetch(() => ({
    data: [{
      name: "reach",
      values: [
        { end_time: "2026-08-28T07:00:00+0000", value: 483 },
        { end_time: "2026-08-29T07:00:00+0000", value: 393 },
        { end_time: "2026-08-30T07:00:00+0000", value: 719 },
        { end_time: "2026-08-31T07:00:00+0000", value: 579 },
      ],
    }],
  }));
  const m = await fetchReachDaily(f, "tok", T0, T0 + 31 * DAY);
  assertEquals(m.get("2026-08-28"), 483);
  assertEquals(m.get("2026-08-29"), 393);
  assertEquals(m.get("2026-08-30"), 719);
  // Par-prova do finding: chunk1 de UM dia (08-31) e o último ponto da série
  // diária concordam em 579 para a MESMA data -- não "08-30".
  assertEquals(m.get("2026-08-31"), 579);
});

// Fix round 2: uma série diária alimenta cursor de backfill. Um mapa parcial
// que parece "bem-sucedido" faria o consumidor avançar o cursor por cima de
// dias nunca de fato buscados -- pular esses dias PARA SEMPRE. Por isso
// qualquer chunk com erro (não-190) precisa DERRUBAR a chamada inteira, nunca
// devolver um Map incompleto silenciosamente.
Deno.test("fetchReachDaily: chunk do meio falha (não-190) -> rejeita, nunca mapa parcial", async () => {
  const middleChunkSince = String(T0 + 30 * DAY);
  const f = fakeFetch((url) => {
    if (url.searchParams.get("since") === middleChunkSince) {
      return { error: { message: "rate limited" } };
    }
    return {
      data: [{
        name: "reach",
        values: [{ end_time: "2026-08-05T07:00:00+0000", value: 100 }],
      }],
    };
  });
  let caught: unknown = null;
  try {
    await fetchReachDaily(f, "tok", T0, T0 + 61 * DAY); // 61d = 3 chunks (30/30/1)
  } catch (e) {
    caught = e;
  }
  assertEquals((caught as { code?: string } | null)?.code, "SERIES_INCOMPLETE");
  assertEquals((caught as { metric?: string } | null)?.metric, "reach");
});

Deno.test("fetchReachDaily: janela de um chunk só, sem erro -- comportamento inalterado", async () => {
  const calls: string[] = [];
  const f = fakeFetch((url) => {
    calls.push(`${url.searchParams.get("since")}-${url.searchParams.get("until")}`);
    return {
      data: [{
        name: "reach",
        values: [
          { end_time: "2026-08-01T07:00:00+0000", value: 10 },
          { end_time: "2026-08-02T07:00:00+0000", value: 20 },
        ],
      }],
    };
  });
  const m = await fetchReachDaily(f, "tok", T0, T0 + 3 * DAY); // < 30d -> 1 chunk só
  assertEquals(m.get("2026-08-01"), 10);
  assertEquals(m.get("2026-08-02"), 20);
  assertEquals(calls.length, 1);
});

Deno.test("fetchReachDaily: erro 190 sobe como TOKEN_EXPIRED, não SERIES_INCOMPLETE", async () => {
  const f = fakeFetch(() => ({ error: { code: 190, message: "expired" } }));
  let caught: unknown = null;
  try {
    await fetchReachDaily(f, "tok", T0, T0 + 3 * DAY);
  } catch (e) {
    caught = e;
  }
  assertEquals((caught as { code?: string } | null)?.code, "TOKEN_EXPIRED");
});

Deno.test("fetchClosedDayValues: 1 request por métrica, janela de 1 dia", async () => {
  const windows = new Set<string>();
  const f = fakeFetch((url) => {
    windows.add(`${url.searchParams.get("since")}-${url.searchParams.get("until")}`);
    return { data: [{ name: url.searchParams.get("metric")!.split(",")[0],
      total_value: { value: 3 } }] };
  });
  const v = await fetchClosedDayValues(f, "tok", "2026-08-30");
  assertEquals(v.views, 3);
  assertEquals(windows.size, 1); // todas as chamadas na MESMA janela [dia, dia+1)
});

Deno.test("fetchClosedDayValues: falha de rede só nos follows isola follows/unfollows, resto intacto", async () => {
  const f = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const metric = url.searchParams.get("metric");
    if (metric === "follows_and_unfollows") throw new TypeError("network down");
    return new Response(
      JSON.stringify({ data: [{ name: metric, total_value: { value: 5 } }] }),
      { status: 200 },
    );
  }) as typeof fetch;
  const v = await fetchClosedDayValues(f, "tok", "2026-08-30");
  assertEquals(v.views, 5);
  assertEquals(v.reach, 5);
  assertEquals(v.follows, null);
  assertEquals(v.unfollows, null);
});

Deno.test("fetchClosedDayValues: erro 190 nos follows ainda sobe como TOKEN_EXPIRED", async () => {
  const f = fakeFetch((url) =>
    url.searchParams.get("metric") === "follows_and_unfollows"
      ? { error: { code: 190, message: "expired" } }
      : { data: [{ name: url.searchParams.get("metric"), total_value: { value: 1 } }] });
  await assertRejects(() => fetchClosedDayValues(f, "tok", "2026-08-30"));
});

Deno.test("chunk falho no meio de uma janela grande derruba só aquela métrica, sem soma parcial", async () => {
  const secondChunkSince = String(T0 + 30 * DAY);
  const f = fakeFetch((url) => {
    const metric = url.searchParams.get("metric");
    if (metric === "views" && url.searchParams.get("since") === secondChunkSince) {
      return { error: { message: "rate limited" } }; // chunk do meio (2 de 3) falha
    }
    if (metric === "views") return { data: [{ name: "views", total_value: { value: 50 } }] };
    return { data: [{ name: "saves", total_value: { value: 9 } }] };
  });
  const r = await fetchAccountTotals(f, "tok", ["views", "saves"], T0, T0 + 61 * DAY);
  // 3 chunks (30/30/1); o do meio falhou -> a métrica inteira é null, NUNCA
  // a soma dos chunks que deram certo (50+50 seria um total fabricado).
  assertEquals(r.views, null);
  // saves não teve nenhum chunk com erro -> soma completa dos 3.
  assertEquals(r.saves, 27);
});

// --- fetchAccountTotalsDetailed (backfill fix round 2, achado 1) ----------
//
// fetchAccountTotals sozinho normaliza TANTO "Graph respondeu erro" QUANTO
// "Graph respondeu certinho e não tinha nada" para o mesmo null por métrica
// -- o backfill mensal precisa distinguir os dois (uma falha transitória não
// pode finalizar o backfill como se fosse fim de retenção), daí a variante
// Detailed abaixo.

Deno.test("fetchAccountTotalsDetailed: métrica com erro de chunk entra em failedMetrics", async () => {
  const f = fakeFetch(() => ({ error: { message: "rate limited" } }));
  const { totals, failedMetrics } = await fetchAccountTotalsDetailed(f, "tok", ["saves"], T0, T0 + DAY);
  assertEquals(totals.saves, null);
  assertEquals(failedMetrics, ["saves"]);
});

Deno.test("fetchAccountTotalsDetailed: métrica sem dado (Graph respondeu OK, vazio) NÃO entra em failedMetrics", async () => {
  const f = fakeFetch(() => ({ data: [] }));
  const { totals, failedMetrics } = await fetchAccountTotalsDetailed(f, "tok", ["saves"], T0, T0 + DAY);
  assertEquals(totals.saves, null);
  assertEquals(failedMetrics, []);
});

Deno.test("fetchAccountTotalsDetailed: falha de rede (fetch rejeita, não-190) entra em failedMetrics", async () => {
  const f = (() => Promise.reject(new TypeError("network down"))) as unknown as typeof fetch;
  const { totals, failedMetrics } = await fetchAccountTotalsDetailed(f, "tok", ["views"], T0, T0 + DAY);
  assertEquals(totals.views, null);
  assertEquals(failedMetrics, ["views"]);
});

Deno.test("fetchAccountTotalsDetailed: mistura -- só as métricas que realmente falharam entram em failedMetrics", async () => {
  const f = fakeFetch((url) => {
    const metric = url.searchParams.get("metric");
    if (metric === "saves") return { error: { message: "boom" } }; // falha
    if (metric === "profile_views") return { data: [] }; // vazio, sem falha
    return { data: [{ name: "views", total_value: { value: 42 } }] }; // valor real
  });
  const { totals, failedMetrics } = await fetchAccountTotalsDetailed(
    f, "tok", ["views", "saves", "profile_views"], T0, T0 + DAY,
  );
  assertEquals(totals, { views: 42, saves: null, profile_views: null });
  assertEquals(failedMetrics, ["saves"]);
});

Deno.test("fetchAccountTotalsDetailed: erro 190 ainda sobe como TOKEN_EXPIRED (não vira failedMetrics)", async () => {
  const f = fakeFetch(() => ({ error: { code: 190, message: "expired" } }));
  await assertRejects(() => fetchAccountTotalsDetailed(f, "tok", ["views"], T0, T0 + DAY));
});

Deno.test("fetchAccountTotalsDetailed: fetchAccountTotals continua devolvendo só os totais (contrato inalterado)", async () => {
  const f = fakeFetch((url) =>
    url.searchParams.get("metric") === "saves"
      ? { error: { message: "boom" } }
      : { data: [{ name: "views", total_value: { value: 7 } }] });
  const plain = await fetchAccountTotals(f, "tok", ["views", "saves"], T0, T0 + DAY);
  assertEquals(plain, { views: 7, saves: null });
});

// --- isWindowLiveEligible (Task final-fix Finding 3) -------------------------
// Gates whether a window's live Graph fetch is even attempted: a window fully
// outside the VIEWS_WINDOW_DAYS retention lookback can never return real data,
// so callers should skip the round-trip; a window that only partially
// overlaps still goes live unchanged.

Deno.test("isWindowLiveEligible: window fully inside retention -> eligible", () => {
  const nowSec = T0 + 100 * DAY;
  // window ends well within the last VIEWS_WINDOW_DAYS
  assertEquals(isWindowLiveEligible(T0 + 95 * DAY, T0 + 98 * DAY, nowSec), true);
});

Deno.test("isWindowLiveEligible: window fully outside (ends before) retention -> NOT eligible", () => {
  const nowSec = T0 + 200 * DAY;
  const retentionStart = nowSec - VIEWS_WINDOW_DAYS * DAY;
  // a whole month that ended well before the retention boundary
  const sinceSec = retentionStart - 40 * DAY;
  const untilSec = retentionStart - 10 * DAY;
  assertEquals(isWindowLiveEligible(sinceSec, untilSec, nowSec), false);
});

Deno.test("isWindowLiveEligible: window straddling the retention boundary (partial overlap) -> eligible", () => {
  const nowSec = T0 + 200 * DAY;
  const retentionStart = nowSec - VIEWS_WINDOW_DAYS * DAY;
  // starts before the boundary, ends after it -- partial overlap keeps live
  const sinceSec = retentionStart - 5 * DAY;
  const untilSec = retentionStart + 5 * DAY;
  assertEquals(isWindowLiveEligible(sinceSec, untilSec, nowSec), true);
});

Deno.test("isWindowLiveEligible: window ending exactly at the retention boundary -> NOT eligible", () => {
  const nowSec = T0 + 200 * DAY;
  const retentionStart = nowSec - VIEWS_WINDOW_DAYS * DAY;
  assertEquals(isWindowLiveEligible(retentionStart - 10 * DAY, retentionStart, nowSec), false);
});

Deno.test("isWindowLiveEligible: empty/inverted window -> NOT eligible", () => {
  const nowSec = T0 + 100 * DAY;
  assertEquals(isWindowLiveEligible(T0 + 10 * DAY, T0 + 10 * DAY, nowSec), false);
  assertEquals(isWindowLiveEligible(T0 + 10 * DAY, T0 + 5 * DAY, nowSec), false);
});

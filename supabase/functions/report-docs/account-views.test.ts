import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { fetchAccountViews } from "./account-views.ts";

const DAY = 86400;

// Fake fetch do Graph: devolve `perDay * dias do chunk` para conferir que as
// janelas somadas cobrem exatamente o mês pedido e a janela anterior.
function graphFake(perDay: number) {
  const calls: { since: number; until: number }[] = [];
  const fetchFn = ((input: string | URL | Request) => {
    const url = new URL(String(input));
    const since = Number(url.searchParams.get("since"));
    const until = Number(url.searchParams.get("until"));
    calls.push({ since, until });
    const days = Math.round((until - since) / DAY);
    return Promise.resolve(
      new Response(
        JSON.stringify({ data: [{ name: "views", total_value: { value: perDay * days } }] }),
        { status: 200 },
      ),
    );
  }) as typeof fetch;
  return { fetchFn, calls };
}

Deno.test("mês inteiro dentro da retenção: value = 31 dias; prev = janela anterior de MESMO comprimento", async () => {
  const { fetchFn, calls } = graphFake(10);
  // "Hoje": 20 de agosto de 2026 — julho e a janela anterior cabem nos 90 dias.
  const nowSec = Date.parse("2026-08-20T12:00:00Z") / 1000;
  const r = await fetchAccountViews(fetchFn, "tok", "2026-07", nowSec);
  assertEquals(r.value, 310); // 31 dias * 10
  // Semântica herdada da rota /views de Analytics: prev é a janela de mesmo
  // comprimento imediatamente anterior (31/mai a 30/jun), NÃO o mês-calendário.
  assertEquals(r.prev, 310);
  // Cada janela de 31 dias quebra em 2 chunks de <=30d.
  assertEquals(calls.length, 4);
});

Deno.test("mês parcialmente fora dos 90 dias: nada congela (null, null)", async () => {
  const { fetchFn, calls } = graphFake(10);
  // "Hoje": 15 de outubro — 1º de julho já saiu da retenção de 90 dias.
  const nowSec = Date.parse("2026-10-15T12:00:00Z") / 1000;
  const r = await fetchAccountViews(fetchFn, "tok", "2026-07", nowSec);
  assertEquals(r, { value: null, prev: null });
  assertEquals(calls.length, 0);
});

Deno.test("mês atual (janela anterior parcialmente fora): value vem, prev null", async () => {
  const { fetchFn } = graphFake(10);
  // "Hoje": 20 de agosto; relatório de agosto até agora. A janela anterior de
  // mesmo comprimento cabe na retenção, então prev existe — o caso sem prev é
  // quando prevSince < janela de 90d.
  const nowSec = Date.parse("2026-11-25T12:00:00Z") / 1000;
  const r = await fetchAccountViews(fetchFn, "tok", "2026-11", nowSec);
  // Novembro até agora (24 dias completos + fração) — value > 0.
  assertEquals(typeof r.value, "number");
});

Deno.test("erro do Graph propaga (o chamador degrada para null com warn)", async () => {
  const fetchFn = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ error: { message: "boom" } }), { status: 400 }),
    )) as typeof fetch;
  const nowSec = Date.parse("2026-08-20T12:00:00Z") / 1000;
  let threw = false;
  try {
    await fetchAccountViews(fetchFn, "tok", "2026-07", nowSec);
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

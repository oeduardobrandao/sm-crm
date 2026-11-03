import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  AiBadOutputError,
  AiTimeoutError,
  buildAccountPrompt,
  buildPostPrompt,
  callGemini,
  type CommentAnalysis,
  redactIdentities,
  validateAnalysis,
} from "../instagram-analytics/comments-ai.ts";

const idea = (n: number) => ({
  titulo: `Ideia ${n}`,
  descricao: `Descrição ${n}`,
  motivo: `Motivo ${n}`,
});

function fixture(): Record<string, unknown> {
  return {
    sentimento_geral: "positivo",
    resumo: "O público apoia e pergunta sobre pele oleosa e preço.",
    distribuicao: { apoio: 58, duvida: 24, critica: 8, discussao: 6, spam: 4 },
    temas: [
      { tema: "Pele oleosa", peso: 31, exemplo: "Minha pele é oleosa" },
      { tema: "Preço da consulta", peso: 18, exemplo: "Quanto custa?" },
      { tema: "Protetor com cor", peso: 9, exemplo: "Qual protetor?" },
    ],
    perguntas_frequentes: ["Quanto custa a consulta?"],
    ideias: [idea(1), idea(2), idea(3)],
  };
}

Deno.test("validateAnalysis aceita a saída de exemplo da spec", () => {
  const r = validateAnalysis(fixture(), {});
  assert(r);
  assertEquals(r.distribuicao.apoio, 58);
  assertEquals(r.temas.length, 3);
  assertEquals(r.ideias.length, 3);
});

Deno.test("rejeita rótulo desconhecido", () => {
  const f = fixture();
  f.sentimento_geral = "feliz";
  assertEquals(validateAnalysis(f, {}), null);
});

Deno.test("rejeita distribuicao que soma 90", () => {
  const f = fixture();
  f.distribuicao = { apoio: 50, duvida: 24, critica: 8, discussao: 4, spam: 4 };
  assertEquals(validateAnalysis(f, {}), null);
});

Deno.test("ajusta soma 101 para 100", () => {
  const f = fixture();
  f.distribuicao = { apoio: 59, duvida: 24, critica: 8, discussao: 6, spam: 4 };
  const r = validateAnalysis(f, {});
  assert(r);
  assertEquals(r.distribuicao.apoio, 58);
  const d = r.distribuicao;
  assertEquals(d.apoio + d.duvida + d.critica + d.discussao + d.spam, 100);
});

Deno.test("rejeita 2 ideias", () => {
  const f = fixture();
  f.ideias = [idea(1), idea(2)];
  assertEquals(validateAnalysis(f, {}), null);
});

Deno.test("filtra post_ids fora do conjunto", () => {
  const f = fixture();
  (f.temas as Record<string, unknown>[])[0].post_ids = ["a", "zzz"];
  const r = validateAnalysis(f, { allowPostIds: new Set(["a", "b"]) });
  assert(r);
  assertEquals(r.temas[0].post_ids, ["a"]);
});

Deno.test("redactIdentities remove @handle e username conhecido, sem caixa", () => {
  const a = {
    ...(validateAnalysis(fixture(), {}) as object),
    resumo: "@Maria_23 e joao.silva pedem preço",
    ideias: [],
  } as unknown as CommentAnalysis;
  const out = redactIdentities(a, ["maria_23", "JOAO.silva"]);
  assertEquals(
    out.resumo,
    "alguém do público e alguém do público pedem preço",
  );
});

Deno.test("buildPostPrompt não contém username e envolve os textos nos marcadores", () => {
  const p = buildPostPrompt({
    caption: "Legenda",
    mediaType: "IMAGE",
    texts: ["quanto custa?", "amei"],
  });
  assert(p.includes("<<<COMENTARIOS\nquanto custa?\namei\nCOMENTARIOS>>>"));
  assert(!p.includes("maria_23"));
  const acc = buildAccountPrompt({
    posts: [{ id: "p1", caption: "c", texts: ["oi"] }],
  });
  assert(acc.includes("<<<COMENTARIOS\noi\nCOMENTARIOS>>>"));
});

const okBody = (text: string) =>
  new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }),
    { status: 200 },
  );

Deno.test("callGemini tenta de novo em 429 e devolve o JSON", async () => {
  let calls = 0;
  const sleeps: number[] = [];
  let headerKey = "";
  const fetchFn = ((_u: string, init: RequestInit) => {
    calls++;
    headerKey = (init.headers as Record<string, string>)["x-goog-api-key"];
    return Promise.resolve(
      calls === 1 ? new Response("x", { status: 429 }) : okBody('{"a":1}'),
    );
  }) as unknown as typeof fetch;
  const r = await callGemini(
    { fetchFn, now: () => 0, sleep: (ms) => (sleeps.push(ms), Promise.resolve()) },
    { apiKey: "k", prompt: "p", deadlineAt: 50_000 },
  );
  assertEquals(r, { a: 1 });
  assertEquals(calls, 2);
  assertEquals(sleeps, [1000]);
  assertEquals(headerKey, "k");
});

Deno.test("callGemini lança AiTimeoutError quando o prazo acaba", async () => {
  let t = 0;
  const fetchFn = (() =>
    Promise.resolve(new Response("x", { status: 503 }))) as unknown as typeof fetch;
  await assertRejects(
    () =>
      callGemini(
        {
          fetchFn,
          now: () => t,
          sleep: (ms) => (t += ms, Promise.resolve()),
        },
        { apiKey: "k", prompt: "p", deadlineAt: 1500 },
      ),
    AiTimeoutError,
  );
});

Deno.test("callGemini lança AiBadOutputError em texto não JSON", async () => {
  const fetchFn = (() =>
    Promise.resolve(okBody("isso não é json"))) as unknown as typeof fetch;
  await assertRejects(
    () =>
      callGemini({ fetchFn, now: () => 0 }, {
        apiKey: "k",
        prompt: "p",
        deadlineAt: 50_000,
      }),
    AiBadOutputError,
  );
});

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { type AgendaConviteAuditEntry, createAgendaConviteHandler } from "../agenda-convite/handler.ts";

const BASE = "https://x.test/agenda-convite";
const CORS = { "Access-Control-Allow-Origin": "https://app.mesaas.com" };
const NOW = "2026-10-08T12:00:00.000Z";
const TOKEN = "0123456789abcdef".repeat(4);
const IP = "203.0.113.9";

type Mock = ReturnType<typeof createSupabaseQueryMock>;

interface Harness {
  db: Mock;
  handler: (req: Request) => Promise<Response>;
  limits: Array<{ key: string; max: number; win: number }>;
  audits: AgendaConviteAuditEntry[];
}

/** `deny` lists key prefixes whose rate limit answers "exhausted". */
function harness(opts: { deny?: string[]; auditThrows?: boolean } = {}): Harness {
  const db = createSupabaseQueryMock();
  const limits: Harness["limits"] = [];
  const audits: AgendaConviteAuditEntry[] = [];
  const handler = createAgendaConviteHandler({
    buildCorsHeaders: () => CORS,
    createDb: () => db as never,
    now: () => NOW,
    rateLimit: (_db, key, max, win) => {
      limits.push({ key, max, win });
      return Promise.resolve(!(opts.deny ?? []).some((p) => key.startsWith(p)));
    },
    auditLog: (entry) => {
      if (opts.auditThrows) return Promise.reject(new Error("audit down"));
      audits.push(entry);
      return Promise.resolve();
    },
  });
  return { db, handler, limits, audits };
}

/** agenda_convite_resolver: the token maps to guest 31 of conta-1. */
function tokenOk(db: Mock) {
  db.queueRpc("agenda_convite_resolver", { data: { convidado_id: 31, conta_id: "conta-1" }, error: null });
}

function tokenDesconhecido(db: Mock) {
  db.queueRpc("agenda_convite_resolver", { data: null, error: null });
}

function rpcCalls(db: Mock, fn: string) {
  return db.calls.filter((c) => c.table === `rpc:${fn}`);
}

function conviteRpcCalls(db: Mock) {
  return db.calls.filter((c) => c.table.startsWith("rpc:agenda_convite_"));
}

/** Calls past the resolver (the reads and the write). */
function dadosRpcCalls(db: Mock) {
  return conviteRpcCalls(db).filter((c) => c.table !== "rpc:agenda_convite_resolver");
}

function post(body: unknown, query = ""): Request {
  return new Request(`${BASE}${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": IP },
    body: JSON.stringify(body),
  });
}

function get(path: string): Request {
  return new Request(`${BASE}${path}`, { headers: { "x-forwarded-for": IP } });
}

function captureErrors<T>(fn: () => Promise<T>): Promise<{ result: T; logged: string[] }> {
  const logged: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
  };
  return fn().then((result) => ({ result, logged })).finally(() => {
    console.error = original;
  });
}

const ITEM = {
  ocorrencia_id: 7,
  sequencia: 3,
  inicio: "2026-10-09T17:00:00+00:00",
  fim: "2026-10-09T18:00:00+00:00",
  dia_inteiro: false,
  data_inicio_local: "2026-10-09",
  data_fim_local: "2026-10-09",
  tz: "America/Sao_Paulo",
  titulo: "Gravação de reels",
  descricao: "Levar o roteiro",
  local: "Estúdio",
  link_reuniao: null,
  resposta: null,
};

const LEITURA = {
  estado: "ok",
  convidado_id: 31,
  conta_id: "conta-1",
  workspace: { nome: "Agência X", brand_color: "#ffbf30", logo_url: null },
  organizador_nome: "Carla",
  titulo: "Gravação de reels",
  itens: [ITEM],
};

const RESPONDER = { token: TOKEN, acao: "responder", ocorrencia_id: 7, resposta: "sim", inicio_visto: ITEM.inicio };

// ------------------------------------------------------------------ gates

Deno.test("agenda-convite: OPTIONS answers 204 with CORS from buildCorsHeaders and does no work", async () => {
  const h = harness();
  const res = await h.handler(new Request(BASE, { method: "OPTIONS" }));
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "https://app.mesaas.com");
  assertEquals(h.db.calls.length, 0);
  assertEquals(h.limits.length, 0);
});

Deno.test("agenda-convite: other methods are 405 with CORS", async () => {
  const h = harness();
  const res = await h.handler(new Request(`${BASE}?token=${TOKEN}`, { method: "PUT" }));
  assertEquals(res.status, 405);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "https://app.mesaas.com");
  assertEquals(h.db.calls.length, 0);
});

Deno.test("agenda-convite: unknown paths are 404 and do no work", async () => {
  for (
    const p of [
      `/foo?token=${TOKEN}`,
      `/ocorrencia?token=${TOKEN}`,
      `/ocorrencia/7.txt?token=${TOKEN}`,
      `/ocorrencia/7/x.ics?token=${TOKEN}`,
      `/ocorrencia/0.ics?token=${TOKEN}`,
    ]
  ) {
    const h = harness();
    const res = await h.handler(get(p));
    assertEquals(res.status, 404, p);
    assertEquals(h.db.calls.length, 0, p);
    assertEquals(h.limits.length, 0, p);
  }
});

Deno.test("agenda-convite: a missing token is a 400 and spends no budget", async () => {
  const h = harness();
  const res = await h.handler(get(""));
  assertEquals(res.status, 400);
  assertEquals(await res.json(), { error: "Dados inválidos." });
  const res2 = await h.handler(post({ acao: "responder" }));
  assertEquals(res2.status, 400);
  assertEquals(h.limits.length, 0);
  assertEquals(h.db.calls.length, 0);
});

Deno.test("agenda-convite: a malformed token is a 404 that spends convite-badtoken and never reaches an RPC", async () => {
  for (const t of ["bad", TOKEN.toUpperCase(), TOKEN.slice(1), `${TOKEN}0`, `${TOKEN.slice(0, 63)}g`, `${TOKEN.slice(0, 63)}%20`]) {
    const h = harness();
    const res = await h.handler(get(`?token=${t}`));
    assertEquals(res.status, 404, t);
    assertEquals(await res.json(), { error: "Este convite não está mais disponível." }, t);
    assertEquals(h.limits, [{ key: `convite-badtoken:${IP}`, max: 30, win: 600 }], t);
    assertEquals(h.db.calls.length, 0, t);
  }
  // The same gate guards the write path and the .ics route.
  const hp = harness();
  const p = await hp.handler(post({ ...RESPONDER, token: "nope" }));
  assertEquals(p.status, 404);
  assertEquals(hp.limits.map((l) => l.key), [`convite-badtoken:${IP}`]);
  assertEquals(hp.db.calls.length, 0);

  const hi = harness();
  const i = await hi.handler(get("/ocorrencia/7.ics?token=nope"));
  assertEquals(i.status, 404);
  assertEquals(hi.db.calls.length, 0);
});

Deno.test("agenda-convite: an unknown token (resolver NULL) is a 404 that spends convite-badtoken only", async () => {
  const h = harness();
  tokenDesconhecido(h.db);
  const res = await h.handler(get(`?token=${TOKEN}`));
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "Este convite não está mais disponível." });
  assertEquals(rpcCalls(h.db, "agenda_convite_resolver").map((c) => c.payload), [{ p_token: TOKEN }]);
  assertEquals(h.limits, [{ key: `convite-badtoken:${IP}`, max: 30, win: 600 }]);
  assertEquals(dadosRpcCalls(h.db).length, 0);
});

Deno.test("agenda-convite: a resolver answer without a usable id is treated as unknown", async () => {
  for (const data of [true, {}, { convidado_id: 0, conta_id: "c" }, { convidado_id: 31 }, { convidado_id: "x", conta_id: "c" }]) {
    const h = harness();
    h.db.queueRpc("agenda_convite_resolver", { data, error: null });
    const res = await h.handler(get(`?token=${TOKEN}`));
    assertEquals(res.status, 404, JSON.stringify(data));
    assertEquals(h.limits.map((l) => l.key), [`convite-badtoken:${IP}`], JSON.stringify(data));
    assertEquals(dadosRpcCalls(h.db).length, 0);
  }
});

Deno.test("agenda-convite: an exhausted bad-token budget is a 429 with CORS", async () => {
  const h = harness({ deny: ["convite-badtoken:"] });
  const res = await h.handler(get("?token=bad"));
  assertEquals(res.status, 429);
  assertEquals(await res.json(), { error: "Muitas tentativas. Tente de novo em alguns minutos." });
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "https://app.mesaas.com");

  const h2 = harness({ deny: ["convite-badtoken:"] });
  tokenDesconhecido(h2.db);
  const res2 = await h2.handler(get(`?token=${TOKEN}`));
  assertEquals(res2.status, 429);
  assertEquals(res2.headers.get("Access-Control-Allow-Origin"), "https://app.mesaas.com");
});

Deno.test("agenda-convite: reads spend convite-read:<convidado_id> (300/300); 429 with CORS when exhausted", async () => {
  const h = harness({ deny: ["convite-read:"] });
  tokenOk(h.db);
  const res = await h.handler(get(`?token=${TOKEN}`));
  assertEquals(res.status, 429);
  assertEquals(await res.json(), { error: "Muitas tentativas. Tente de novo em alguns minutos." });
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "https://app.mesaas.com");
  assertEquals(h.limits, [{ key: "convite-read:31", max: 300, win: 300 }]);
  assertEquals(dadosRpcCalls(h.db).length, 0);

  const hi = harness({ deny: ["convite-read:"] });
  tokenOk(hi.db);
  const i = await hi.handler(get(`/ocorrencia/7.ics?token=${TOKEN}`));
  assertEquals(i.status, 429);
  assertEquals(hi.limits.map((l) => l.key), ["convite-read:31"]);
  assertEquals(dadosRpcCalls(hi.db).length, 0);
});

Deno.test("agenda-convite: writes spend convite-write:<convidado_id> (20/600) only; 429 with CORS when exhausted", async () => {
  const h = harness({ deny: ["convite-write:"] });
  tokenOk(h.db);
  const res = await h.handler(post(RESPONDER));
  assertEquals(res.status, 429);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "https://app.mesaas.com");
  assertEquals(h.limits, [{ key: "convite-write:31", max: 20, win: 600 }]);
  assertEquals(dadosRpcCalls(h.db).length, 0);
  assertEquals(h.audits.length, 0);

  // Reads never touch the write budget, even when it is exhausted.
  const hg = harness({ deny: ["convite-write:"] });
  tokenOk(hg.db);
  hg.db.queueRpc("agenda_convite_ler", { data: LEITURA, error: null });
  const g = await hg.handler(get(`?token=${TOKEN}`));
  assertEquals(g.status, 200);
  assertEquals(hg.limits.map((l) => l.key), ["convite-read:31"]);
});

// ------------------------------------------------------------------ reads

Deno.test("agenda-convite: GET returns exactly { workspace, organizador_nome, titulo, itens }", async () => {
  const h = harness();
  tokenOk(h.db);
  h.db.queueRpc("agenda_convite_ler", { data: LEITURA, error: null });
  const res = await h.handler(get(`?token=${TOKEN}`));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "https://app.mesaas.com");
  const body = await res.json();
  assertEquals(Object.keys(body).sort(), ["itens", "organizador_nome", "titulo", "workspace"]);
  assertEquals(body, {
    workspace: { nome: "Agência X", brand_color: "#ffbf30", logo_url: null },
    organizador_nome: "Carla",
    titulo: "Gravação de reels",
    itens: [ITEM],
  });
  assertEquals(JSON.stringify(body).includes("conta-1"), false, "conta_id never leaves the server");
  assertEquals(rpcCalls(h.db, "agenda_convite_ler").map((c) => c.payload), [{ p_token: TOKEN }]);
  assertEquals(h.limits.map((l) => l.key), ["convite-read:31"]);
});

Deno.test("agenda-convite: GET with estado nao_encontrado (flag off, removed, private) is the 404", async () => {
  for (const data of [{ estado: "nao_encontrado" }, { estado: "desligado" }, null]) {
    const h = harness();
    tokenOk(h.db);
    h.db.queueRpc("agenda_convite_ler", { data, error: null });
    const res = await h.handler(get(`?token=${TOKEN}`));
    assertEquals(res.status, 404, JSON.stringify(data));
    assertEquals(await res.json(), { error: "Este convite não está mais disponível." });
  }
});

Deno.test("agenda-convite: the token may travel in the POST body or the query", async () => {
  const h = harness();
  tokenOk(h.db);
  h.db.queueRpc("agenda_convite_responder", { data: ITEM, error: null });
  const { token: _t, ...semToken } = RESPONDER;
  const res = await h.handler(post(semToken, `?token=${TOKEN}`));
  assertEquals(res.status, 200);
  assertEquals(rpcCalls(h.db, "agenda_convite_resolver")[0].payload, { p_token: TOKEN });
});

// ------------------------------------------------------------------ .ics

Deno.test("agenda-convite: the .ics route returns text/calendar with UID, SEQUENCE and an attachment name", async () => {
  const h = harness();
  tokenOk(h.db);
  h.db.queueRpc("agenda_convite_ocorrencia", { data: ITEM, error: null });
  const res = await h.handler(get(`/ocorrencia/7.ics?token=${TOKEN}`));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "text/calendar; charset=utf-8");
  assertEquals(
    res.headers.get("Content-Disposition"),
    `attachment; filename="gravacao-de-reels.ics"; filename*=UTF-8''Grava%C3%A7%C3%A3o%20de%20reels.ics`,
  );
  assertEquals(res.headers.get("Cache-Control"), "private, no-store");
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "https://app.mesaas.com");
  const ics = await res.text();
  assertStringIncludes(ics, "METHOD:PUBLISH");
  assertStringIncludes(ics, "UID:agenda-oc-7@mesaas.com.br");
  assertStringIncludes(ics, "SEQUENCE:3");
  assertStringIncludes(ics, "SUMMARY:Gravação de reels");
  assert(!ics.includes("ORGANIZER") && !ics.includes("ATTENDEE") && !ics.includes("RRULE"));
  assertEquals(rpcCalls(h.db, "agenda_convite_ocorrencia").map((c) => c.payload), [{ p_token: TOKEN, p_ocorrencia: 7 }]);
  assertEquals(h.limits.map((l) => l.key), ["convite-read:31"]);
});

Deno.test("agenda-convite: the .ics route renders an all-day occurrence with DATE values", async () => {
  const h = harness();
  tokenOk(h.db);
  h.db.queueRpc("agenda_convite_ocorrencia", {
    data: { ...ITEM, dia_inteiro: true, data_inicio_local: "2026-10-09", data_fim_local: "2026-10-11" },
    error: null,
  });
  const ics = await (await h.handler(get(`/ocorrencia/7.ics?token=${TOKEN}`))).text();
  assertStringIncludes(ics, "DTSTART;VALUE=DATE:20261009");
  assertStringIncludes(ics, "DTEND;VALUE=DATE:20261011");
});

Deno.test("agenda-convite: the .ics route is a 404 when the RPC returns NULL, and POST to it is a 404 before any work", async () => {
  const h = harness();
  tokenOk(h.db);
  h.db.queueRpc("agenda_convite_ocorrencia", { data: null, error: null });
  const res = await h.handler(get(`/ocorrencia/7.ics?token=${TOKEN}`));
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "Este convite não está mais disponível." });

  const hp = harness();
  const p = await hp.handler(new Request(`${BASE}/ocorrencia/7.ics?token=${TOKEN}`, { method: "POST", body: "{}" }));
  assertEquals(p.status, 404);
  assertEquals(hp.db.calls.length, 0);
});

Deno.test("agenda-convite: routes tolerate the /functions/v1 prefix", async () => {
  const h = harness();
  tokenOk(h.db);
  h.db.queueRpc("agenda_convite_ocorrencia", { data: ITEM, error: null });
  const res = await h.handler(
    new Request(`https://proj.supabase.co/functions/v1/agenda-convite/ocorrencia/7.ics?token=${TOKEN}`),
  );
  assertEquals(res.status, 200);
});

// ------------------------------------------------------------------ responder

Deno.test("agenda-convite: responder validates the body before calling the RPC", async () => {
  const ruins: Array<Record<string, unknown>> = [
    { ...RESPONDER, acao: "remarcar" },
    { ...RESPONDER, acao: undefined },
    { ...RESPONDER, resposta: "talvez" },
    { ...RESPONDER, resposta: undefined },
    { ...RESPONDER, inicio_visto: undefined },
    { ...RESPONDER, inicio_visto: "amanhã" },
    { ...RESPONDER, inicio_visto: 1760000000 },
    { ...RESPONDER, inicio_visto: "2026-10-09" },
    { ...RESPONDER, ocorrencia_id: 0 },
    { ...RESPONDER, ocorrencia_id: "abc" },
    { ...RESPONDER, ocorrencia_id: 1.5 },
    { ...RESPONDER, ocorrencia_id: undefined },
  ];
  for (const body of ruins) {
    const h = harness();
    tokenOk(h.db);
    const res = await h.handler(post(body));
    assertEquals(res.status, 400, JSON.stringify(body));
    assertEquals(await res.json(), { error: "Dados inválidos." });
    assertEquals(dadosRpcCalls(h.db).length, 0);
    assertEquals(h.audits.length, 0);
  }
});

Deno.test("agenda-convite: responder calls the RPC with the token, returns { item } and audits with convidado_id", async () => {
  const h = harness();
  tokenOk(h.db);
  h.db.queueRpc("agenda_convite_responder", { data: { ...ITEM, resposta: "sim" }, error: null });
  const res = await h.handler(post({ ...RESPONDER, inicio_visto: "2026-10-09T17:00:00.000Z", conta_id: "outra" }));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "https://app.mesaas.com");
  assertEquals(await res.json(), { item: { ...ITEM, resposta: "sim" } });
  assertEquals(rpcCalls(h.db, "agenda_convite_responder").map((c) => c.payload), [{
    p_token: TOKEN,
    p_ocorrencia: 7,
    p_resposta: "sim",
    p_inicio_visto: "2026-10-09T17:00:00.000Z",
  }]);
  assertEquals(h.audits, [{
    conta_id: "conta-1",
    action: "agenda_convite_responder",
    resource_type: "agenda_ocorrencia",
    resource_id: "7",
    metadata: { convidado_id: 31, resposta: "sim" },
  }]);
  assert(!JSON.stringify(h.audits).includes(TOKEN), "the token never reaches the audit trail");
  assertEquals(h.limits.map((l) => l.key), ["convite-write:31"]);
});

Deno.test("agenda-convite: a failing audit never breaks the answer", async () => {
  const h = harness({ auditThrows: true });
  tokenOk(h.db);
  h.db.queueRpc("agenda_convite_responder", { data: { ...ITEM, resposta: "nao" }, error: null });
  const { result: res } = await captureErrors(() => h.handler(post({ ...RESPONDER, resposta: "nao" })));
  assertEquals(res.status, 200);
});

// ------------------------------------------------------------------ error map

Deno.test("agenda-convite: every agenda_convite:<codigo> maps to its status and message, with CORS", async () => {
  const mapa: Record<string, [number, string]> = {
    nao_encontrado: [404, "Este convite não está mais disponível."],
    desligado: [404, "Este convite não está mais disponível."],
    horario_mudou: [409, "Este evento mudou de horário. Atualize a página."],
    ja_aconteceu: [409, "Este evento já aconteceu."],
  };
  for (const [codigo, [status, msg]] of Object.entries(mapa)) {
    const h = harness();
    tokenOk(h.db);
    h.db.queueRpc("agenda_convite_responder", {
      data: null,
      error: { code: "P0001", message: `agenda_convite:${codigo}` },
    });
    const { result: res } = await captureErrors(() => h.handler(post(RESPONDER)));
    assertEquals(res.status, status, codigo);
    assertEquals(await res.json(), { error: msg }, codigo);
    assertEquals(res.headers.get("Access-Control-Allow-Origin"), "https://app.mesaas.com", codigo);
    assertEquals(h.audits.length, 0, `${codigo}: a failed write is not audited`);
  }
});

Deno.test("agenda-convite: the read and .ics RPCs use the same error map", async () => {
  const h = harness();
  tokenOk(h.db);
  h.db.queueRpc("agenda_convite_ler", { data: null, error: { code: "P0001", message: "agenda_convite:desligado" } });
  const { result: res } = await captureErrors(() => h.handler(get(`?token=${TOKEN}`)));
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "Este convite não está mais disponível." });

  const hi = harness();
  tokenOk(hi.db);
  hi.db.queueRpc("agenda_convite_ocorrencia", {
    data: null,
    error: { code: "P0001", message: "agenda_convite:nao_encontrado" },
  });
  const { result: ri } = await captureErrors(() => hi.handler(get(`/ocorrencia/7.ics?token=${TOKEN}`)));
  assertEquals(ri.status, 404);
});

Deno.test("agenda-convite: unknown RPC errors are a generic 500 and only the code is logged", async () => {
  const h = harness();
  tokenOk(h.db);
  h.db.queueRpc("agenda_convite_responder", {
    data: null,
    error: { code: "23505", message: 'duplicate key value violates "secret-constraint" for bia@fora.test' },
  });
  const { result: res, logged } = await captureErrors(() => h.handler(post(RESPONDER)));
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "Erro interno" });
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "https://app.mesaas.com");
  assert(logged.length > 0, "the failure should be logged");
  for (const linha of logged) {
    assertEquals(linha.includes("secret-constraint"), false);
    assertEquals(linha.includes("bia@fora.test"), false);
  }
});

Deno.test("agenda-convite: an unmapped agenda_convite code and a resolver error are 500s", async () => {
  const h = harness();
  tokenOk(h.db);
  h.db.queueRpc("agenda_convite_ler", { data: null, error: { code: "P0001", message: "agenda_convite:codigo_novo" } });
  const { result: res } = await captureErrors(() => h.handler(get(`?token=${TOKEN}`)));
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "Erro interno" });

  const hr = harness();
  hr.db.queueRpc("agenda_convite_resolver", { data: null, error: { code: "57014", message: "timeout" } });
  const { result: rr } = await captureErrors(() => hr.handler(get(`?token=${TOKEN}`)));
  assertEquals(rr.status, 500);
  assertEquals(hr.limits.length, 0, "a resolver failure spends no budget");
});

Deno.test("agenda-convite: a rejecting RPC is a generic 500 with CORS", async () => {
  const h = harness();
  tokenOk(h.db);
  h.db.queueRpc("agenda_convite_ler", () => {
    throw new Error("connection reset");
  });
  const { result: res } = await captureErrors(() => h.handler(get(`?token=${TOKEN}`)));
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "Erro interno" });
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "https://app.mesaas.com");
});

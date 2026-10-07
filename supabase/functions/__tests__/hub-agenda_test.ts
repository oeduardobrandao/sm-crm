import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createHubAgendaHandler, type HubAgendaAuditEntry } from "../hub-agenda/handler.ts";

const BASE = "https://x.test/hub-agenda";
const CORS = { "Access-Control-Allow-Origin": "https://app.mesaas.com" };
const NOW = "2026-10-08T12:00:00.000Z";

type Mock = ReturnType<typeof createSupabaseQueryMock>;

interface Harness {
  db: Mock;
  handler: (req: Request) => Promise<Response>;
  limits: Array<{ key: string; max: number; win: number }>;
  audits: HubAgendaAuditEntry[];
}

/** `deny` lists key prefixes whose rate limit answers "exhausted". */
function harness(opts: { deny?: string[]; auditThrows?: boolean } = {}): Harness {
  const db = createSupabaseQueryMock();
  const limits: Harness["limits"] = [];
  const audits: HubAgendaAuditEntry[] = [];
  const handler = createHubAgendaHandler({
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

/** resolveHubToken: client_hub_tokens row + effective_plan_feature(feature_hub_portal). */
function tokenOk(db: Mock) {
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queueRpc("effective_plan_feature", { data: true, error: null });
}

function rpcCalls(db: Mock, fn: string) {
  return db.calls.filter((c) => c.table === `rpc:${fn}`);
}

/** Calls other than the token lookup / feature check. */
function agendaRpcCalls(db: Mock) {
  return db.calls.filter((c) => c.table.startsWith("rpc:agenda_hub_"));
}

function post(body: unknown, query = ""): Request {
  return new Request(`${BASE}${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function get(path: string): Request {
  return new Request(`${BASE}${path}`);
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
  sequencia: 2,
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
  remarcacao: null,
};

// ------------------------------------------------------------------ gates

Deno.test("hub-agenda: OPTIONS answers 204 with CORS and does no work", async () => {
  const h = harness();
  const res = await h.handler(new Request(BASE, { method: "OPTIONS" }));
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "https://app.mesaas.com");
  assertEquals(h.db.calls.length, 0);
  assertEquals(h.limits.length, 0);
});

Deno.test("hub-agenda: other methods are 405", async () => {
  const h = harness();
  const res = await h.handler(new Request(`${BASE}?token=t`, { method: "PUT" }));
  assertEquals(res.status, 405);
  assertEquals(h.db.calls.length, 0);
});

Deno.test("hub-agenda: unknown paths are 404 and do no work", async () => {
  for (const p of ["/foo?token=t", "/ocorrencia?token=t", "/ocorrencia/7.txt?token=t", "/ocorrencia/7/x.ics?token=t"]) {
    const h = harness();
    const res = await h.handler(get(p));
    assertEquals(res.status, 404, p);
    assertEquals(h.db.calls.length, 0, p);
  }
});

Deno.test("hub-agenda: a missing token is a 400 and spends no budget", async () => {
  const h = harness();
  const res = await h.handler(get(""));
  assertEquals(res.status, 400);
  assertEquals(await res.json(), { error: "Dados inválidos." });
  const res2 = await h.handler(post({ acao: "responder" }));
  assertEquals(res2.status, 400);
  assertEquals(h.limits.length, 0);
  assertEquals(h.db.calls.length, 0);
});

Deno.test("hub-agenda: an unknown token is a 404 that debits the bad-token budget", async () => {
  const h = harness();
  h.db.queue("client_hub_tokens", "select", { data: null, error: null });
  const res = await h.handler(get("?token=bad"));
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "Link inválido." });
  assertEquals(h.limits.length, 1);
  assertEquals(h.limits[0].key.startsWith("hub-badtoken:"), true);
  assertEquals([h.limits[0].max, h.limits[0].win], [30, 600]);
  assertEquals(agendaRpcCalls(h.db).length, 0);
});

Deno.test("hub-agenda: an exhausted bad-token budget is a 429", async () => {
  const h = harness({ deny: ["hub-badtoken:"] });
  h.db.queue("client_hub_tokens", "select", { data: null, error: null });
  const res = await h.handler(get("?token=bad"));
  assertEquals(res.status, 429);
});

Deno.test("hub-agenda: an exhausted hub-read budget is a 429 for GET and for POST (no write debit)", async () => {
  const hg = harness({ deny: ["hub-read:"] });
  tokenOk(hg.db);
  const g = await hg.handler(get("?token=t"));
  assertEquals(g.status, 429);
  assertEquals(hg.limits, [{ key: "hub-read:conta-1:14", max: 300, win: 300 }]);
  assertEquals(agendaRpcCalls(hg.db).length, 0);

  const hp = harness({ deny: ["hub-read:"] });
  tokenOk(hp.db);
  const p = await hp.handler(post({ token: "t", acao: "cancelar_remarcacao", remarcacao_id: 1 }));
  assertEquals(p.status, 429);
  assertEquals(hp.limits.map((l) => l.key), ["hub-read:conta-1:14"]);
  assertEquals(agendaRpcCalls(hp.db).length, 0);
});

Deno.test("hub-agenda: an exhausted hub-write budget is a 429 for POST only", async () => {
  const hp = harness({ deny: ["hub-write:"] });
  tokenOk(hp.db);
  const p = await hp.handler(post({ token: "t", acao: "cancelar_remarcacao", remarcacao_id: 1 }));
  assertEquals(p.status, 429);
  assertEquals(hp.limits, [
    { key: "hub-read:conta-1:14", max: 300, win: 300 },
    { key: "hub-write:hub-agenda:conta-1:14", max: 60, win: 3600 },
  ]);
  assertEquals(agendaRpcCalls(hp.db).length, 0);
  assertEquals(hp.audits.length, 0);

  // Reads never touch the write budget, even when it is exhausted.
  const hg = harness({ deny: ["hub-write:"] });
  tokenOk(hg.db);
  hg.db.queueRpc("agenda_hub_listar", { data: { estado: "ok", itens: [], proximo: null }, error: null });
  const g = await hg.handler(get("?token=t"));
  assertEquals(g.status, 200);
  assertEquals(hg.limits.map((l) => l.key), ["hub-read:conta-1:14"]);
});

// ------------------------------------------------------------------ reads

Deno.test("hub-agenda: list forwards the cursor and the token's tenant, and returns proximo", async () => {
  const h = harness();
  tokenOk(h.db);
  h.db.queueRpc("agenda_hub_listar", {
    data: { estado: "ok", itens: [ITEM], proximo: { inicio: "2026-10-10T17:00:00+00:00", id: 9 } },
    error: null,
  });
  const res = await h.handler(
    get("?token=t&apos_inicio=2026-10-09T17:00:00%2B00:00&apos_id=7&conta_id=outra&cliente_id=99"),
  );
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    itens: [ITEM],
    proximo: { inicio: "2026-10-10T17:00:00+00:00", id: 9 },
  });
  const calls = rpcCalls(h.db, "agenda_hub_listar");
  assertEquals(calls.length, 1);
  assertEquals(calls[0].payload, {
    p_conta: "conta-1",
    p_cliente: 14,
    p_apos_inicio: "2026-10-09T17:00:00+00:00",
    p_apos_id: 7,
  });
});

Deno.test("hub-agenda: list without a cursor passes nulls and answers proximo null", async () => {
  const h = harness();
  tokenOk(h.db);
  h.db.queueRpc("agenda_hub_listar", { data: { estado: "ok", itens: [ITEM] }, error: null });
  const res = await h.handler(get("?token=t"));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { itens: [ITEM], proximo: null });
  assertEquals(rpcCalls(h.db, "agenda_hub_listar")[0].payload, {
    p_conta: "conta-1",
    p_cliente: 14,
    p_apos_inicio: null,
    p_apos_id: null,
  });
});

Deno.test("hub-agenda: a half or malformed cursor is a 400 without reaching the RPC", async () => {
  for (const q of [
    "&apos_inicio=2026-10-09T17:00:00Z",
    "&apos_id=7",
    "&apos_inicio=ontem&apos_id=7",
    "&apos_inicio=2026-10-09T17:00:00Z&apos_id=abc",
    "&apos_inicio=2026-10-09T17:00:00Z&apos_id=0",
    "&apos_inicio=2026-10-09T17:00:00Z&apos_id=1.5",
    "&ocorrencia=abc",
    "&ocorrencia=0",
  ]) {
    const h = harness();
    tokenOk(h.db);
    const res = await h.handler(get(`?token=t${q}`));
    assertEquals(res.status, 400, q);
    assertEquals(await res.json(), { error: "Dados inválidos." }, q);
    assertEquals(agendaRpcCalls(h.db).length, 0, q);
  }
});

Deno.test("hub-agenda: list with the flag off (estado desligado) is a 404", async () => {
  const h = harness();
  tokenOk(h.db);
  h.db.queueRpc("agenda_hub_listar", { data: { estado: "desligado", itens: [], proximo: null }, error: null });
  const res = await h.handler(get("?token=t"));
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "Evento não encontrado." });
});

// ------------------------------------------------------------------ period read (de / ate)

const DE = "2026-10-01T03:00:00.000Z";
const ATE = "2026-11-01T03:00:00.000Z";

Deno.test("hub-agenda: de+ate call agenda_hub_periodo with the ISO values and the token's tenant, and answer { itens }", async () => {
  const h = harness();
  tokenOk(h.db);
  h.db.queueRpc("agenda_hub_periodo", { data: { estado: "ok", itens: [ITEM] }, error: null });
  const res = await h.handler(get(`?token=t&de=${encodeURIComponent(DE)}&ate=${encodeURIComponent(ATE)}&conta_id=outra&cliente_id=99`));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { itens: [ITEM] });
  const calls = rpcCalls(h.db, "agenda_hub_periodo");
  assertEquals(calls.length, 1);
  assertEquals(calls[0].payload, { p_conta: "conta-1", p_cliente: 14, p_de: DE, p_ate: ATE });
  assertEquals(rpcCalls(h.db, "agenda_hub_listar").length, 0);
});

Deno.test("hub-agenda: the period read accepts an explicit offset (encoded +)", async () => {
  const h = harness();
  tokenOk(h.db);
  h.db.queueRpc("agenda_hub_periodo", { data: { estado: "ok", itens: [] }, error: null });
  const res = await h.handler(get("?token=t&de=2026-10-01T00:00:00%2B00:00&ate=2026-10-31T00:00:00-03:00"));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { itens: [] });
  assertEquals(rpcCalls(h.db, "agenda_hub_periodo")[0].payload, {
    p_conta: "conta-1",
    p_cliente: 14,
    p_de: "2026-10-01T00:00:00+00:00",
    p_ate: "2026-10-31T00:00:00-03:00",
  });
});

Deno.test("hub-agenda: only one of de/ate is a 400 without reaching the RPC", async () => {
  for (const q of [`&de=${DE}`, `&ate=${ATE}`]) {
    const h = harness();
    tokenOk(h.db);
    const res = await h.handler(get(`?token=t${q}`));
    assertEquals(res.status, 400, q);
    assertEquals(await res.json(), { error: "Dados inválidos." }, q);
    assertEquals(agendaRpcCalls(h.db).length, 0, q);
  }
});

Deno.test("hub-agenda: de/ate combined with ocorrencia or any cursor half is a 400", async () => {
  for (const extra of [
    "&ocorrencia=7",
    "&apos_inicio=2026-10-09T17:00:00Z&apos_id=7",
    "&apos_inicio=2026-10-09T17:00:00Z",
    "&apos_id=7",
  ]) {
    const h = harness();
    tokenOk(h.db);
    const res = await h.handler(get(`?token=t&de=${DE}&ate=${ATE}${extra}`));
    assertEquals(res.status, 400, extra);
    assertEquals(await res.json(), { error: "Dados inválidos." }, extra);
    assertEquals(agendaRpcCalls(h.db).length, 0, extra);
  }
});

Deno.test("hub-agenda: non-ISO de/ate are a 400 without reaching the RPC", async () => {
  for (const [de, ate] of [
    ["ontem", ATE],
    [DE, "amanha"],
    ["2026-10-01", "2026-11-01"], // dates alone: the period is a pair of instants
    ["2026-10-01T03:00:00", ATE], // no offset
    ["2026-13-01T03:00:00Z", ATE], // not a real date
    [DE, ""],
    ["", ""],
  ]) {
    const h = harness();
    tokenOk(h.db);
    const res = await h.handler(get(`?token=t&de=${encodeURIComponent(de)}&ate=${encodeURIComponent(ate)}`));
    assertEquals(res.status, 400, `${de} / ${ate}`);
    assertEquals(await res.json(), { error: "Dados inválidos." }, `${de} / ${ate}`);
    assertEquals(agendaRpcCalls(h.db).length, 0, `${de} / ${ate}`);
  }
});

Deno.test("hub-agenda: periodo_invalido from the RPC (window too long or ate <= de) is a 400", async () => {
  const h = harness();
  tokenOk(h.db);
  h.db.queueRpc("agenda_hub_periodo", { data: null, error: { code: "P0001", message: "agenda_hub:periodo_invalido" } });
  const { result, logged } = await captureErrors(() => h.handler(get(`?token=t&de=${DE}&ate=${ATE}`)));
  assertEquals(result.status, 400);
  assertEquals(await result.json(), { error: "Dados inválidos." });
  assertEquals(rpcCalls(h.db, "agenda_hub_periodo").length, 1);
  assertEquals(h.audits.length, 0);
  assert(logged.every((l) => !l.includes("conta-1")), "the log must not carry tenant data");
});

Deno.test("hub-agenda: the period read with estado desligado is a 404", async () => {
  const h = harness();
  tokenOk(h.db);
  h.db.queueRpc("agenda_hub_periodo", { data: { estado: "desligado", itens: [] }, error: null });
  const res = await h.handler(get(`?token=t&de=${DE}&ate=${ATE}`));
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "Evento não encontrado." });
});

Deno.test("hub-agenda: an inactive cliente (agenda_hub:nao_encontrado) is a 404 on the period read", async () => {
  const h = harness();
  tokenOk(h.db);
  h.db.queueRpc("agenda_hub_periodo", { data: null, error: { code: "P0001", message: "agenda_hub:nao_encontrado" } });
  const { result } = await captureErrors(() => h.handler(get(`?token=t&de=${DE}&ate=${ATE}`)));
  assertEquals(result.status, 404);
  assertEquals(await result.json(), { error: "Evento não encontrado." });
});

Deno.test("hub-agenda: the period read spends hub-read once and no write budget", async () => {
  const h = harness();
  tokenOk(h.db);
  h.db.queueRpc("agenda_hub_periodo", { data: { estado: "ok", itens: [] }, error: null });
  const res = await h.handler(get(`?token=t&de=${DE}&ate=${ATE}`));
  assertEquals(res.status, 200);
  assertEquals(h.limits, [{ key: "hub-read:conta-1:14", max: 300, win: 300 }]);

  // An exhausted hub-read budget stops the period read before the RPC.
  const hd = harness({ deny: ["hub-read:"] });
  tokenOk(hd.db);
  const denied = await hd.handler(get(`?token=t&de=${DE}&ate=${ATE}`));
  assertEquals(denied.status, 429);
  assertEquals(agendaRpcCalls(hd.db).length, 0);
});

// ------------------------------------------------------------------ deep link

Deno.test("hub-agenda: a single occurrence by deep link returns the item, or 404 when the RPC says NULL", async () => {
  const h = harness();
  tokenOk(h.db);
  h.db.queueRpc("agenda_hub_ocorrencia", { data: ITEM, error: null });
  const res = await h.handler(get("?token=t&ocorrencia=7"));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { item: ITEM });
  assertEquals(rpcCalls(h.db, "agenda_hub_ocorrencia")[0].payload, {
    p_conta: "conta-1",
    p_cliente: 14,
    p_ocorrencia: 7,
  });

  const h2 = harness();
  tokenOk(h2.db);
  h2.db.queueRpc("agenda_hub_ocorrencia", { data: null, error: null });
  const res2 = await h2.handler(get("?token=t&ocorrencia=8"));
  assertEquals(res2.status, 404);
  assertEquals(await res2.json(), { error: "Evento não encontrado." });
});

// ------------------------------------------------------------------ error map

Deno.test("hub-agenda: every agenda_hub:<codigo> maps to its status and message", async () => {
  const mapa: Record<string, [number, string]> = {
    nao_encontrado: [404, "Evento não encontrado."],
    desligado: [404, "Evento não encontrado."],
    horario_mudou: [409, "Este evento mudou de horário. Atualize a página."],
    ja_aconteceu: [409, "Este evento já aconteceu."],
    sugestao_passada: [400, "Escolha um horário no futuro."],
    hora_obrigatoria: [400, "Informe o horário."],
    pedido_pendente: [409, "Já existe um pedido de remarcação para este evento."],
    ja_resolvido: [409, "Este pedido já foi resolvido."],
    periodo_invalido: [400, "Dados inválidos."],
  };
  for (const [codigo, [status, msg]] of Object.entries(mapa)) {
    const h = harness();
    tokenOk(h.db);
    h.db.queueRpc("agenda_hub_responder", {
      data: null,
      error: { code: "P0001", message: `agenda_hub:${codigo}` },
    });
    const res = await h.handler(
      post({ token: "t", acao: "responder", ocorrencia_id: 7, resposta: "sim", inicio_visto: ITEM.inicio }),
    );
    assertEquals(res.status, status, codigo);
    assertEquals(await res.json(), { error: msg }, codigo);
    assertEquals(h.audits.length, 0, `${codigo}: a failed write is not audited`);
  }
});

Deno.test("hub-agenda: unknown RPC errors are a generic 500 and only the code is logged", async () => {
  const h = harness();
  tokenOk(h.db);
  h.db.queueRpc("agenda_hub_responder", {
    data: null,
    error: { code: "23505", message: 'duplicate key value violates "secret-constraint" for Clínica X' },
  });
  const { result: res, logged } = await captureErrors(() =>
    h.handler(post({ token: "t", acao: "responder", ocorrencia_id: 7, resposta: "nao", inicio_visto: ITEM.inicio }))
  );
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "Erro interno" });
  assert(logged.length > 0, "the failure should be logged");
  for (const linha of logged) {
    assertEquals(linha.includes("secret-constraint"), false);
    assertEquals(linha.includes("Clínica X"), false);
  }
});

Deno.test("hub-agenda: an unmapped agenda_hub code is a 500", async () => {
  const h = harness();
  tokenOk(h.db);
  h.db.queueRpc("agenda_hub_listar", { data: null, error: { code: "P0001", message: "agenda_hub:codigo_novo" } });
  const { result: res } = await captureErrors(() => h.handler(get("?token=t")));
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "Erro interno" });
});

Deno.test("hub-agenda: a rejecting RPC is a generic 500", async () => {
  const h = harness();
  tokenOk(h.db);
  h.db.queueRpc("agenda_hub_listar", () => {
    throw new Error("connection reset");
  });
  const { result: res } = await captureErrors(() => h.handler(get("?token=t")));
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "Erro interno" });
});

// ------------------------------------------------------------------ responder

Deno.test("hub-agenda: responder validates the body before calling the RPC", async () => {
  const ok = { token: "t", acao: "responder", ocorrencia_id: 7, resposta: "sim", inicio_visto: ITEM.inicio };
  const ruins: Array<Record<string, unknown>> = [
    { ...ok, resposta: "talvez" },
    { ...ok, resposta: undefined },
    { ...ok, inicio_visto: undefined },
    { ...ok, inicio_visto: "amanhã" },
    { ...ok, inicio_visto: 1760000000 },
    { ...ok, inicio_visto: "2026-10-09" },
    { ...ok, ocorrencia_id: 0 },
    { ...ok, ocorrencia_id: "abc" },
    { ...ok, ocorrencia_id: 1.5 },
    { ...ok, ocorrencia_id: undefined },
  ];
  for (const body of ruins) {
    const h = harness();
    tokenOk(h.db);
    const res = await h.handler(post(body));
    assertEquals(res.status, 400, JSON.stringify(body));
    assertEquals(await res.json(), { error: "Dados inválidos." });
    assertEquals(agendaRpcCalls(h.db).length, 0);
    assertEquals(h.audits.length, 0);
  }
});

Deno.test("hub-agenda: responder calls the RPC with the token's tenant and audits the write", async () => {
  const h = harness();
  tokenOk(h.db);
  h.db.queueRpc("agenda_hub_responder", { data: { ...ITEM, resposta: "sim" }, error: null });
  const res = await h.handler(
    post({
      token: "t",
      acao: "responder",
      ocorrencia_id: 7,
      resposta: "sim",
      inicio_visto: "2026-10-09T17:00:00.000Z",
      conta_id: "outra",
      cliente_id: 99,
    }),
  );
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { item: { ...ITEM, resposta: "sim" } });
  assertEquals(rpcCalls(h.db, "agenda_hub_responder")[0].payload, {
    p_conta: "conta-1",
    p_cliente: 14,
    p_ocorrencia: 7,
    p_resposta: "sim",
    p_inicio_visto: "2026-10-09T17:00:00.000Z",
  });
  assertEquals(h.audits, [{
    conta_id: "conta-1",
    action: "hub_agenda_responder",
    resource_type: "agenda_ocorrencia",
    resource_id: "7",
    metadata: { cliente_id: 14, resposta: "sim" },
  }]);
  assertEquals(h.limits.map((l) => l.key), ["hub-read:conta-1:14", "hub-write:hub-agenda:conta-1:14"]);
});

Deno.test("hub-agenda: the token may travel in the query of a POST", async () => {
  const h = harness();
  tokenOk(h.db);
  h.db.queueRpc("agenda_hub_responder", { data: ITEM, error: null });
  const res = await h.handler(
    post({ acao: "responder", ocorrencia_id: 7, resposta: "nao", inicio_visto: ITEM.inicio }, "?token=t"),
  );
  assertEquals(res.status, 200);
  assertEquals(h.db.calls.find((c) => c.table === "client_hub_tokens")?.modifiers.some(
    (m) => m.method === "eq" && m.args[0] === "token" && m.args[1] === "t",
  ), true);
});

Deno.test("hub-agenda: an audit failure never breaks the write", async () => {
  const h = harness({ auditThrows: true });
  tokenOk(h.db);
  h.db.queueRpc("agenda_hub_responder", { data: ITEM, error: null });
  const { result: res } = await captureErrors(() =>
    h.handler(post({ token: "t", acao: "responder", ocorrencia_id: 7, resposta: "sim", inicio_visto: ITEM.inicio }))
  );
  assertEquals(res.status, 200);
});

// ------------------------------------------------------------------ remarcar

Deno.test("hub-agenda: remarcar validates data, hora and mensagem", async () => {
  const ok = { token: "t", acao: "remarcar", ocorrencia_id: 7, data: "2026-10-12", hora: "14:30", mensagem: "Pode ser?" };
  const ruins: Array<Record<string, unknown>> = [
    { ...ok, data: undefined },
    { ...ok, data: "12/10/2026" },
    { ...ok, data: "2026-10-12T14:30:00Z" },
    { ...ok, data: "2026-02-31" },
    { ...ok, data: "2026-13-01" },
    { ...ok, hora: "2:30" },
    { ...ok, hora: "14:30:00" },
    { ...ok, hora: "24:00" },
    { ...ok, hora: "14:60" },
    { ...ok, hora: 1430 },
    { ...ok, mensagem: "x".repeat(1001) },
    { ...ok, mensagem: 42 },
    { ...ok, ocorrencia_id: -1 },
  ];
  for (const body of ruins) {
    const h = harness();
    tokenOk(h.db);
    const res = await h.handler(post(body));
    assertEquals(res.status, 400, JSON.stringify(body));
    assertEquals(await res.json(), { error: "Dados inválidos." });
    assertEquals(agendaRpcCalls(h.db).length, 0);
  }
});

Deno.test("hub-agenda: remarcar passes local date and time through and audits", async () => {
  const h = harness();
  tokenOk(h.db);
  h.db.queueRpc("agenda_hub_remarcar", { data: ITEM, error: null });
  const res = await h.handler(
    post({ token: "t", acao: "remarcar", ocorrencia_id: 7, data: "2026-10-12", hora: "14:30", mensagem: "  Pode ser?  " }),
  );
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { item: ITEM });
  assertEquals(rpcCalls(h.db, "agenda_hub_remarcar")[0].payload, {
    p_conta: "conta-1",
    p_cliente: 14,
    p_ocorrencia: 7,
    p_data: "2026-10-12",
    p_hora: "14:30",
    p_mensagem: "Pode ser?",
  });
  assertEquals(h.audits.length, 1);
  assertEquals(h.audits[0].action, "hub_agenda_remarcar");
  assertEquals(h.audits[0].resource_type, "agenda_ocorrencia");
  assertEquals(h.audits[0].resource_id, "7");
});

Deno.test("hub-agenda: remarcar accepts a null or missing hora and an empty mensagem (all-day events)", async () => {
  for (const extra of [{ hora: null }, {}]) {
    const h = harness();
    tokenOk(h.db);
    h.db.queueRpc("agenda_hub_remarcar", { data: ITEM, error: null });
    const res = await h.handler(
      post({ token: "t", acao: "remarcar", ocorrencia_id: 7, data: "2026-10-12", mensagem: "   ", ...extra }),
    );
    assertEquals(res.status, 200);
    const payload = rpcCalls(h.db, "agenda_hub_remarcar")[0].payload as Record<string, unknown>;
    assertEquals(payload.p_hora, null);
    assertEquals(payload.p_mensagem, null);
  }
});

Deno.test("hub-agenda: remarcar accepts a mensagem of exactly 1000 characters", async () => {
  const h = harness();
  tokenOk(h.db);
  h.db.queueRpc("agenda_hub_remarcar", { data: ITEM, error: null });
  const res = await h.handler(
    post({ token: "t", acao: "remarcar", ocorrencia_id: 7, data: "2026-10-12", hora: "09:00", mensagem: "x".repeat(1000) }),
  );
  assertEquals(res.status, 200);
});

Deno.test("hub-agenda: remarcar RPC errors map (hora_obrigatoria, sugestao_passada, pedido_pendente)", async () => {
  const casos: Array<[string, number, string]> = [
    ["hora_obrigatoria", 400, "Informe o horário."],
    ["sugestao_passada", 400, "Escolha um horário no futuro."],
    ["pedido_pendente", 409, "Já existe um pedido de remarcação para este evento."],
  ];
  for (const [codigo, status, msg] of casos) {
    const h = harness();
    tokenOk(h.db);
    h.db.queueRpc("agenda_hub_remarcar", { data: null, error: { code: "P0001", message: `agenda_hub:${codigo}` } });
    const res = await h.handler(
      post({ token: "t", acao: "remarcar", ocorrencia_id: 7, data: "2026-10-12", hora: null, mensagem: "" }),
    );
    assertEquals(res.status, status, codigo);
    assertEquals(await res.json(), { error: msg }, codigo);
  }
});

// ------------------------------------------------------------------ cancelar_remarcacao

Deno.test("hub-agenda: cancelar_remarcacao calls the RPC, audits and answers ok", async () => {
  const h = harness();
  tokenOk(h.db);
  h.db.queueRpc("agenda_hub_cancelar_remarcacao", { data: null, error: null });
  const res = await h.handler(post({ token: "t", acao: "cancelar_remarcacao", remarcacao_id: 5 }));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true });
  assertEquals(rpcCalls(h.db, "agenda_hub_cancelar_remarcacao")[0].payload, {
    p_conta: "conta-1",
    p_cliente: 14,
    p_remarcacao: 5,
  });
  assertEquals(h.audits.length, 1);
  assertEquals(h.audits[0].action, "hub_agenda_cancelar_remarcacao");
  assertEquals(h.audits[0].resource_type, "agenda_ocorrencia");
  assertEquals(h.audits[0].metadata, { cliente_id: 14, remarcacao_id: 5 });
});

Deno.test("hub-agenda: cancelar_remarcacao rejects bad ids and maps ja_resolvido", async () => {
  for (const id of [undefined, 0, -3, "x", 2.5]) {
    const h = harness();
    tokenOk(h.db);
    const res = await h.handler(post({ token: "t", acao: "cancelar_remarcacao", remarcacao_id: id }));
    assertEquals(res.status, 400);
    assertEquals(agendaRpcCalls(h.db).length, 0);
  }

  const h = harness();
  tokenOk(h.db);
  h.db.queueRpc("agenda_hub_cancelar_remarcacao", {
    data: null,
    error: { code: "P0001", message: "agenda_hub:ja_resolvido" },
  });
  const res = await h.handler(post({ token: "t", acao: "cancelar_remarcacao", remarcacao_id: 5 }));
  assertEquals(res.status, 409);
  assertEquals(await res.json(), { error: "Este pedido já foi resolvido." });
  assertEquals(h.audits.length, 0);
});

Deno.test("hub-agenda: an unknown acao, a non-object body and invalid JSON are 400", async () => {
  for (const body of [{ token: "t", acao: "apagar" }, { token: "t" }, { token: "t", acao: 3 }]) {
    const h = harness();
    tokenOk(h.db);
    const res = await h.handler(post(body));
    assertEquals(res.status, 400);
    assertEquals(agendaRpcCalls(h.db).length, 0);
  }

  const h = harness();
  tokenOk(h.db);
  const res = await h.handler(
    new Request(`${BASE}?token=t`, { method: "POST", body: "{not json" }),
  );
  assertEquals(res.status, 400);

  const h2 = harness();
  tokenOk(h2.db);
  const res2 = await h2.handler(new Request(`${BASE}?token=t`, { method: "POST", body: JSON.stringify([1, 2]) }));
  assertEquals(res2.status, 400);
});

// ------------------------------------------------------------------ .ics

Deno.test("hub-agenda: the .ics route returns text/calendar with UID, SEQUENCE and an attachment name", async () => {
  const h = harness();
  tokenOk(h.db);
  h.db.queueRpc("agenda_hub_ocorrencia", { data: ITEM, error: null });
  const res = await h.handler(get("/ocorrencia/7.ics?token=t"));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "text/calendar; charset=utf-8");
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "https://app.mesaas.com");
  assertEquals(res.headers.get("Cache-Control"), "private, no-store");
  assertEquals(
    res.headers.get("Content-Disposition"),
    `attachment; filename="gravacao-de-reels.ics"; filename*=UTF-8''Grava%C3%A7%C3%A3o%20de%20reels.ics`,
  );
  const body = await res.text();
  assertStringIncludes(body, "BEGIN:VCALENDAR\r\n");
  assertStringIncludes(body, "METHOD:PUBLISH\r\n");
  assertStringIncludes(body, "UID:agenda-oc-7@mesaas.com.br\r\n");
  assertStringIncludes(body, "SEQUENCE:2\r\n");
  assertStringIncludes(body, "DTSTAMP:20261008T120000Z\r\n");
  assertStringIncludes(body, "DTSTART:20261009T170000Z\r\n");
  assertStringIncludes(body, "DTEND:20261009T180000Z\r\n");
  assertStringIncludes(body, "SUMMARY:Gravação de reels\r\n");
  assertStringIncludes(body, "LOCATION:Estúdio\r\n");
  assertEquals(body.includes("ORGANIZER"), false);
  assertEquals(body.includes("ATTENDEE"), false);
  assertEquals(rpcCalls(h.db, "agenda_hub_ocorrencia")[0].payload, {
    p_conta: "conta-1",
    p_cliente: 14,
    p_ocorrencia: 7,
  });
  // A read: no write budget, no audit.
  assertEquals(h.limits.map((l) => l.key), ["hub-read:conta-1:14"]);
  assertEquals(h.audits.length, 0);
});

Deno.test("hub-agenda: the .ics route renders an all-day occurrence with DATE values", async () => {
  const h = harness();
  tokenOk(h.db);
  h.db.queueRpc("agenda_hub_ocorrencia", {
    data: {
      ...ITEM,
      sequencia: 0,
      dia_inteiro: true,
      inicio: "2026-10-09T03:00:00+00:00",
      fim: "2026-10-10T03:00:00+00:00",
      data_inicio_local: "2026-10-09",
      data_fim_local: "2026-10-10",
    },
    error: null,
  });
  const res = await h.handler(get("/ocorrencia/7.ics?token=t"));
  assertEquals(res.status, 200);
  const body = await res.text();
  assertStringIncludes(body, "SEQUENCE:0\r\n");
  assertStringIncludes(body, "DTSTART;VALUE=DATE:20261009\r\n");
  assertStringIncludes(body, "DTEND;VALUE=DATE:20261010\r\n");
});

Deno.test("hub-agenda: the .ics route is a 404 when the RPC returns NULL", async () => {
  const h = harness();
  tokenOk(h.db);
  h.db.queueRpc("agenda_hub_ocorrencia", { data: null, error: null });
  const res = await h.handler(get("/ocorrencia/7.ics?token=t"));
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "Evento não encontrado." });
});

Deno.test("hub-agenda: the .ics route 404s on invalid ids and non-GET methods before any work", async () => {
  for (const id of ["0", "99999999999999999999"]) {
    const h = harness();
    const res = await h.handler(get(`/ocorrencia/${id}.ics?token=t`));
    assertEquals(res.status, 404, id);
    assertEquals(h.db.calls.length, 0, id);
  }
  const h = harness();
  const res = await h.handler(
    new Request(`${BASE}/ocorrencia/7.ics?token=t`, { method: "POST", body: "{}" }),
  );
  assertEquals(res.status, 404);
  assertEquals(h.db.calls.length, 0);
});

Deno.test("hub-agenda: the .ics route needs a valid token and tolerates the /functions/v1 prefix", async () => {
  const h = harness();
  h.db.queue("client_hub_tokens", "select", { data: null, error: null });
  const bad = await h.handler(get("/ocorrencia/7.ics?token=bad"));
  assertEquals(bad.status, 404);
  assertEquals(await bad.json(), { error: "Link inválido." });

  const h2 = harness();
  tokenOk(h2.db);
  h2.db.queueRpc("agenda_hub_ocorrencia", { data: ITEM, error: null });
  const res = await h2.handler(
    new Request("https://proj.supabase.co/functions/v1/hub-agenda/ocorrencia/7.ics?token=t"),
  );
  assertEquals(res.status, 200);
});

Deno.test("hub-agenda: a malformed item (all-day without local dates) is a generic 500", async () => {
  const h = harness();
  tokenOk(h.db);
  h.db.queueRpc("agenda_hub_ocorrencia", {
    data: { ...ITEM, dia_inteiro: true, data_inicio_local: null, data_fim_local: null },
    error: null,
  });
  const { result: res } = await captureErrors(() => h.handler(get("/ocorrencia/7.ics?token=t")));
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "Erro interno" });
});

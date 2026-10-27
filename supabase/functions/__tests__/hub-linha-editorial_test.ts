import { assert, assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock, type QueryCall } from "../../../test/shared/supabaseMock.ts";
import { createHubLinhaEditorialHandler, type HubLinhaAuditEntry } from "../hub-linha-editorial/handler.ts";

// 12:00 UTC on Oct 26 is 09:00 in São Paulo: current month = 2026-10.
const NOW = "2026-10-26T12:00:00.000Z";
const buildCorsHeaders = () => ({ "Access-Control-Allow-Origin": "https://hub.mesaas.com" });

const LINHA_A = "11111111-1111-4111-8111-111111111111";
const LINHA_B = "22222222-2222-4222-8222-222222222222";
const ITEM_1 = "33333333-3333-4333-8333-333333333333";
const ITEM_2 = "44444444-4444-4444-8444-444444444444";
const COL_VISIVEL = "55555555-5555-4555-8555-555555555555";
const COL_OCULTA = "66666666-6666-4666-8666-666666666666";
const GENERIC = "Não foi possível concluir. Tente novamente.";

type Db = ReturnType<typeof createSupabaseQueryMock>;

function setup(opts: {
  validToken?: boolean;
  limiter?: (key: string) => boolean;
  now?: string;
  auditThrows?: boolean;
} = {}) {
  const db = createSupabaseQueryMock();
  if (opts.validToken !== false) {
    db.queue("client_hub_tokens", "select", {
      data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
      error: null,
    });
  }
  const limits: Array<[string, number, number]> = [];
  const audits: HubLinhaAuditEntry[] = [];
  const handler = createHubLinhaEditorialHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now: () => opts.now ?? NOW,
    rateLimit: (_db, key, max, win) => {
      limits.push([key, max, win]);
      return Promise.resolve(opts.limiter ? opts.limiter(key) : true);
    },
    auditLog: (entry) => {
      if (opts.auditThrows) return Promise.reject(new Error("audit down"));
      audits.push(entry);
      return Promise.resolve();
    },
  });
  return { db, limits, audits, handler };
}

const get = (token = "hub-123") =>
  new Request(`https://example.test/functions/v1/hub-linha-editorial?token=${token}`, { method: "GET" });

const post = (body: unknown) =>
  new Request("https://example.test/functions/v1/hub-linha-editorial", {
    method: "POST",
    body: JSON.stringify(body),
  });

const rpcCalls = (db: Db, name: string) => db.calls.filter((c) => c.table === `rpc:${name}`);
const tableCall = (db: Db, table: string) => db.calls.find((c) => c.table === table && c.operation === "select");
const mods = (call: QueryCall | undefined, method: string) =>
  (call?.modifiers ?? []).filter((m) => m.method === method).map((m) => m.args);

/** Silences console.error for the duration of fn (handler logs on purpose). */
async function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = original;
  }
}

/** Queues a full GET: one enviada linha (rodada 2) and one aprovada linha (rodada 1). */
function queueFullGet(db: Db) {
  db.queue("linhas_editoriais", "select", {
    data: [
      {
        id: LINHA_A,
        periodo: "2026-11-01",
        status: "enviada",
        enviada_at: "2026-10-25T13:00:00Z",
        decidida_at: null,
        rodada: 2,
        // Columns a careless select('*') would carry: they must never reach the client.
        enviada_por: "user-secret",
        created_by: "user-secret",
        conta_id: "conta-1",
        cliente_id: 14,
      },
      {
        id: LINHA_B,
        periodo: "2026-10-01",
        status: "aprovada",
        enviada_at: "2026-09-25T13:00:00Z",
        decidida_at: "2026-09-26T13:00:00Z",
        rodada: 1,
      },
    ],
    error: null,
  });
  db.queue("linha_editorial_colunas", "select", {
    data: [{ id: COL_VISIVEL, nome: "Pilar", tipo: "select", config: { options: [] }, ordem: 0, conta_id: "conta-1" }],
    error: null,
  });
  db.queue("linha_editorial_itens", "select", {
    data: [
      {
        id: ITEM_1,
        linha_id: LINHA_A,
        data: "2026-11-03",
        tipo: "carrossel",
        titulo: "Mitos do sono",
        direcao: "Três mitos",
        valores: { [COL_VISIVEL]: "Educação", [COL_OCULTA]: "interno", "orfa": 1 },
        ordem: 0,
        post_id: 999,
        convertido_por: "user-secret",
        convertido_at: "2026-10-01T00:00:00Z",
        conta_id: "conta-1",
      },
      {
        id: ITEM_2,
        linha_id: LINHA_B,
        data: null,
        tipo: "reels",
        titulo: "Bastidores",
        direcao: "",
        valores: {},
        ordem: 1,
      },
    ],
    error: null,
  });
  db.queue("linha_editorial_respostas", "select", {
    data: [
      {
        id: "r-old",
        linha_id: LINHA_A,
        item_id: null,
        acao: "ajustes",
        comentario: "rodada antiga",
        rodada: 1,
        is_workspace_user: false,
        created_at: "2026-10-20T00:00:00Z",
        token: "hub-123",
        author_user_id: null,
      },
      {
        id: "r-new",
        linha_id: LINHA_A,
        item_id: ITEM_1,
        acao: "comentario",
        comentario: "Gostei",
        rodada: 2,
        is_workspace_user: true,
        created_at: "2026-10-25T14:00:00Z",
        token: null,
        author_user_id: "user-secret",
      },
      {
        id: "r-b",
        linha_id: LINHA_B,
        item_id: null,
        acao: "aprovado",
        comentario: null,
        rodada: 1,
        is_workspace_user: false,
        created_at: "2026-09-26T13:00:00Z",
        token: "hub-123",
        author_user_id: null,
      },
    ],
    error: null,
  });
}

// ── auth, CORS, rate limits ────────────────────────────────────────────────

Deno.test("hub-linha-editorial OPTIONS returns CORS", async () => {
  const { db, handler } = setup();
  const res = await handler(new Request("https://example.test/hub-linha-editorial", { method: "OPTIONS" }));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "https://hub.mesaas.com");
  assertEquals(db.calls.length, 0);
});

Deno.test("hub-linha-editorial bad token debits hub-badtoken only", async () => {
  const { limits, handler } = setup({ validToken: false });
  const res = await handler(get("nope"));
  assertEquals(res.status, 404);
  assertEquals(limits.map(([k, max, win]) => [k.split(":")[0], max, win]), [["hub-badtoken", 30, 600]]);

  const viaPost = setup({ validToken: false });
  const res2 = await viaPost.handler(post({ token: "nope", linha_id: LINHA_A, acao: "aprovado" }));
  assertEquals(res2.status, 404);
  assertEquals(viaPost.limits.length, 1);
  assert(viaPost.limits[0][0].startsWith("hub-badtoken:"));
  assertEquals(rpcCalls(viaPost.db, "record_linha_decision").length, 0);
});

Deno.test("hub-linha-editorial GET debits hub-read at 300/300", async () => {
  const { limits, handler } = setup();
  const res = await handler(get());
  assertEquals(res.status, 200);
  assertEquals(limits, [["hub-read:conta-1:14", 300, 300]]);
});

Deno.test("hub-linha-editorial POST debits only hub-write:hub-linha-editorial at 60/3600", async () => {
  const { db, limits, handler } = setup();
  db.queueRpc("record_linha_decision", { data: { status: "aprovada", comentarios: 0 }, error: null });
  const res = await handler(post({ token: "hub-123", linha_id: LINHA_A, acao: "aprovado" }));
  assertEquals(res.status, 200);
  assertEquals(limits, [["hub-write:hub-linha-editorial:conta-1:14", 60, 3600]]);
  assert(!limits.some(([k]) => k.startsWith("hub-read:")));
});

Deno.test("hub-linha-editorial rate-limited GET and POST answer 429 with no data access", async () => {
  const g = setup({ limiter: () => false });
  assertEquals((await g.handler(get())).status, 429);
  assertEquals(g.db.calls.filter((c) => c.table.startsWith("linha")).length, 0);

  const p = setup({ limiter: () => false });
  const res = await p.handler(post({ token: "hub-123", linha_id: LINHA_A, acao: "aprovado" }));
  assertEquals(res.status, 429);
  assertEquals(rpcCalls(p.db, "record_linha_decision").length, 0);
});

Deno.test("hub-linha-editorial flag off returns 403 feature_disabled", async () => {
  for (const req of [get(), post({ token: "hub-123", linha_id: LINHA_A, acao: "aprovado" })]) {
    const { db, handler } = setup();
    // FIFO per name: the first answer is resolveHubToken's feature_hub_portal check.
    db.queueRpc("effective_plan_feature", { data: true, error: null }, { data: false, error: null });
    const res = await handler(req);
    assertEquals(res.status, 403);
    assertEquals(await readJson(res), { error: "feature_disabled", feature: "feature_linha_editorial" });
    const flagCall = rpcCalls(db, "effective_plan_feature")[1];
    assertEquals(flagCall.payload, { ws_id: "conta-1", feature_key: "feature_linha_editorial" });
    assertEquals(db.calls.filter((c) => c.table.startsWith("linha")).length, 0);
    assertEquals(rpcCalls(db, "record_linha_decision").length, 0);
  }
});

Deno.test("hub-linha-editorial flag check error fails closed with 403", async () => {
  const { db, handler } = setup();
  db.queueRpc("effective_plan_feature", { data: true, error: null }, { data: null, error: { message: "boom" } });
  const res = await quiet(() => handler(get()));
  assertEquals(res.status, 403);
  assertEquals(db.calls.filter((c) => c.table.startsWith("linha")).length, 0);
});

// ── GET ────────────────────────────────────────────────────────────────────

Deno.test("hub-linha-editorial GET strips hidden columns and never returns post_id, enviada_por, convertido_por, created_by, author_user_id, token", async () => {
  const { db, handler } = setup();
  queueFullGet(db);
  const res = await handler(get());
  assertEquals(res.status, 200);
  const body = await readJson(res);

  const raw = JSON.stringify(body);
  for (const field of ["post_id", "enviada_por", "convertido_por", "convertido_at", "created_by", "author_user_id", "token", "conta_id", "user-secret"]) {
    assert(!raw.includes(field), `response leaks ${field}`);
  }

  // Only visivel_cliente columns are read; oculta (CRM-only) is NOT a filter.
  const colCall = tableCall(db, "linha_editorial_colunas");
  assertEquals(mods(colCall, "eq"), [["conta_id", "conta-1"], ["visivel_cliente", true]]);
  assertEquals(colCall?.selectArgs[0][0], "id, nome, tipo, config, ordem");
  assert(!JSON.stringify(colCall?.modifiers).includes("oculta"), "oculta must not filter the Hub");

  const [a, b] = body.linhas;
  assertEquals(a.colunas, [{ id: COL_VISIVEL, nome: "Pilar", tipo: "select", config: { options: [] }, ordem: 0 }]);
  assertEquals(a.itens, [
    { id: ITEM_1, data: "2026-11-03", tipo: "carrossel", titulo: "Mitos do sono", direcao: "Três mitos", valores: { [COL_VISIVEL]: "Educação" } },
  ]);
  assertEquals(b.itens, [{ id: ITEM_2, data: null, tipo: "reels", titulo: "Bastidores", direcao: "", valores: {} }]);
});

Deno.test("hub-linha-editorial GET shapes linhas and keeps only the current rodada's respostas", async () => {
  const { db, handler } = setup();
  queueFullGet(db);
  const body = await readJson(await handler(get()));
  assertEquals(body.linhas.length, 2);
  const [a, b] = body.linhas;
  assertEquals(
    { id: a.id, periodo: a.periodo, status: a.status, enviada_at: a.enviada_at, decidida_at: a.decidida_at, rodada: a.rodada },
    { id: LINHA_A, periodo: "2026-11-01", status: "enviada", enviada_at: "2026-10-25T13:00:00Z", decidida_at: null, rodada: 2 },
  );
  assertEquals(Object.keys(a).sort(), ["colunas", "decidida_at", "enviada_at", "id", "itens", "periodo", "respostas", "rodada", "status"]);
  assertEquals(a.respostas, [
    { id: "r-new", item_id: ITEM_1, acao: "comentario", comentario: "Gostei", is_workspace_user: true, created_at: "2026-10-25T14:00:00Z" },
  ]);
  assertEquals(b.respostas.map((r: { id: string }) => r.id), ["r-b"]);
});

Deno.test("hub-linha-editorial GET excludes rascunho", async () => {
  const { db, handler } = setup();
  await handler(get());
  const linhaCall = tableCall(db, "linhas_editoriais");
  assertEquals(mods(linhaCall, "in"), [["status", ["enviada", "ajustes", "aprovada"]]]);
  assert(!JSON.stringify(linhaCall?.modifiers).includes("rascunho"));
});

Deno.test("hub-linha-editorial GET scopes by the token's conta and cliente", async () => {
  const { db, handler } = setup();
  queueFullGet(db);
  await handler(get());
  const linhaCall = tableCall(db, "linhas_editoriais");
  assertEquals(mods(linhaCall, "eq"), [["conta_id", "conta-1"], ["cliente_id", 14]]);
  assertEquals(linhaCall?.selectArgs[0][0], "id, periodo, status, enviada_at, decidida_at, rodada");
  for (const table of ["linha_editorial_itens", "linha_editorial_respostas"]) {
    const call = tableCall(db, table);
    assertEquals(mods(call, "eq"), [["conta_id", "conta-1"]], table);
    assertEquals(mods(call, "in"), [["linha_id", [LINHA_A, LINHA_B]]], table);
  }
  const respCall = tableCall(db, "linha_editorial_respostas");
  assert(!String(respCall?.selectArgs[0][0]).includes("token"));
  assert(!String(respCall?.selectArgs[0][0]).includes("author_user_id"));
});

Deno.test("hub-linha-editorial GET window is 3 months back to 3 ahead in São Paulo time", async () => {
  const { db, handler } = setup();
  await handler(get());
  const linhaCall = tableCall(db, "linhas_editoriais");
  assertEquals(mods(linhaCall, "gte"), [["periodo", "2026-07-01"]]);
  assertEquals(mods(linhaCall, "lte"), [["periodo", "2027-01-01"]]);

  // 01:00 UTC on Nov 1 is still Oct 31 in São Paulo: the window stays on October.
  const late = setup({ now: "2026-11-01T01:00:00.000Z" });
  await late.handler(get());
  const lateCall = tableCall(late.db, "linhas_editoriais");
  assertEquals(mods(lateCall, "gte"), [["periodo", "2026-07-01"]]);
  assertEquals(mods(lateCall, "lte"), [["periodo", "2027-01-01"]]);

  // Year rollover backwards.
  const jan = setup({ now: "2027-01-15T12:00:00.000Z" });
  await jan.handler(get());
  const janCall = tableCall(jan.db, "linhas_editoriais");
  assertEquals(mods(janCall, "gte"), [["periodo", "2026-10-01"]]);
  assertEquals(mods(janCall, "lte"), [["periodo", "2027-04-01"]]);
});

Deno.test("hub-linha-editorial GET orders items by data nulls last, then ordem", async () => {
  const { db, handler } = setup();
  queueFullGet(db);
  await handler(get());
  const itemCall = tableCall(db, "linha_editorial_itens");
  assertEquals(mods(itemCall, "order"), [["data", { ascending: true, nullsFirst: false }], ["ordem", { ascending: true }]]);
});

Deno.test("hub-linha-editorial GET with no linhas skips the other reads", async () => {
  const { db, handler } = setup();
  const res = await handler(get());
  assertEquals(await readJson(res), { linhas: [] });
  for (const table of ["linha_editorial_itens", "linha_editorial_colunas", "linha_editorial_respostas"]) {
    assertEquals(tableCall(db, table), undefined, table);
  }
});

Deno.test("hub-linha-editorial GET read error is a generic 500", async () => {
  const { db, handler } = setup();
  db.queue("linhas_editoriais", "select", { data: null, error: { message: "secret db detail" } });
  const res = await quiet(() => handler(get()));
  assertEquals(res.status, 500);
  const body = await readJson(res);
  assertEquals(body, { error: GENERIC });
});

// ── POST ───────────────────────────────────────────────────────────────────

Deno.test("hub-linha-editorial invalid uuid or acao returns 400 without calling the RPC", async () => {
  const bad: Array<Record<string, unknown>> = [
    { linha_id: "not-a-uuid", acao: "aprovado" },
    { linha_id: 42, acao: "aprovado" },
    { linha_id: LINHA_A, acao: "aprovar" },
    { linha_id: LINHA_A, acao: "rascunho" },
    { linha_id: LINHA_A },
    { linha_id: LINHA_A, acao: "comentario", item_id: "x", comentario: "oi" },
    { linha_id: LINHA_A, acao: "comentario", item_id: 7, comentario: "oi" },
    { linha_id: LINHA_A, acao: "aprovado", item_id: ITEM_1 },
    { linha_id: LINHA_A, acao: "comentario", comentario: 42 },
  ];
  for (const patch of bad) {
    const { db, handler } = setup();
    const res = await handler(post({ token: "hub-123", ...patch }));
    assertEquals(res.status, 400, JSON.stringify(patch));
    assertEquals(db.calls.length, 0, JSON.stringify(patch));
  }
  const { db, handler } = setup();
  const res = await handler(
    new Request("https://example.test/hub-linha-editorial", { method: "POST", body: "{nope" }),
  );
  assertEquals(res.status, 400);
  assertEquals(db.calls.length, 0);
  assertEquals((await handler(post({ linha_id: LINHA_A, acao: "aprovado" }))).status, 400);
});

Deno.test("hub-linha-editorial comentario over 2000 chars returns 422", async () => {
  for (const acao of ["comentario", "ajustes", "aprovado"]) {
    const { db, handler } = setup();
    const res = await handler(post({ token: "hub-123", linha_id: LINHA_A, acao, comentario: "a".repeat(2001) }));
    assertEquals(res.status, 422, acao);
    assertEquals(await readJson(res), { error: GENERIC });
    assertEquals(db.calls.length, 0, acao);
  }
  // Exactly 2000 is fine.
  const { db, handler } = setup();
  db.queueRpc("record_linha_comment", { data: "r-1", error: null });
  const ok = await handler(post({ token: "hub-123", linha_id: LINHA_A, acao: "comentario", comentario: "a".repeat(2000) }));
  assertEquals(ok.status, 200);
});

Deno.test("hub-linha-editorial empty comment returns 422 with no RPC", async () => {
  for (const comentario of [undefined, null, "", "   "]) {
    const { db, handler } = setup();
    const res = await handler(post({ token: "hub-123", linha_id: LINHA_A, acao: "comentario", comentario }));
    assertEquals(res.status, 422, String(comentario));
    assertEquals(db.calls.length, 0);
  }
});

Deno.test("hub-linha-editorial comentario calls record_linha_comment with token scope and no notification", async () => {
  const { db, audits, handler } = setup();
  db.queueRpc("record_linha_comment", { data: "r-1", error: null });
  const res = await handler(post({
    token: "hub-123",
    linha_id: LINHA_A,
    item_id: ITEM_1,
    acao: "comentario",
    comentario: "  Trocar o gancho  ",
    conta_id: "evil",
    cliente_id: 1,
  }));
  assertEquals(res.status, 200);
  assertEquals(await readJson(res), { ok: true });
  assertEquals(rpcCalls(db, "record_linha_comment")[0].payload, {
    p_linha_id: LINHA_A,
    p_item_id: ITEM_1,
    p_conta_id: "conta-1",
    p_cliente_id: 14,
    p_token: "hub-123",
    p_comentario: "Trocar o gancho",
  });
  assertEquals(rpcCalls(db, "create_linha_notification").length, 0);
  assertEquals(rpcCalls(db, "record_linha_decision").length, 0);
  assertEquals(audits.length, 0);
});

Deno.test("hub-linha-editorial linha-level comentario sends p_item_id null", async () => {
  const { db, handler } = setup();
  db.queueRpc("record_linha_comment", { data: "r-1", error: null });
  const res = await handler(post({ token: "hub-123", linha_id: LINHA_A, acao: "comentario", comentario: "Geral" }));
  assertEquals(res.status, 200);
  assertEquals((rpcCalls(db, "record_linha_comment")[0].payload as Record<string, unknown>).p_item_id, null);
});

Deno.test("hub-linha-editorial POST another client's linha returns 404", async () => {
  const { db, handler } = setup();
  db.queueRpc("record_linha_decision", { data: null, error: { code: "P0001", message: "nao_encontrada" } });
  const res = await quiet(() =>
    handler(post({ token: "hub-123", linha_id: LINHA_B, acao: "aprovado", conta_id: "conta-2", cliente_id: 77 }))
  );
  assertEquals(res.status, 404);
  assertEquals(await readJson(res), { error: GENERIC });
  const payload = rpcCalls(db, "record_linha_decision")[0].payload as Record<string, unknown>;
  assertEquals(payload.p_conta_id, "conta-1");
  assertEquals(payload.p_cliente_id, 14);
  assertEquals(payload.p_linha_id, LINHA_B);
  assertEquals(rpcCalls(db, "create_linha_notification").length, 0);
});

Deno.test("hub-linha-editorial maps RPC errors to 404, 409, 422, 403 and a generic 500", async () => {
  const cases: Array<[string, number]> = [
    ["nao_encontrada", 404],
    ["status_invalido", 409],
    ["comentario_obrigatorio", 422],
    ["secret db detail", 500],
  ];
  for (const [message, status] of cases) {
    const { db, audits, handler } = setup();
    db.queueRpc("record_linha_decision", { data: null, error: { code: "P0001", message } });
    const res = await quiet(() => handler(post({ token: "hub-123", linha_id: LINHA_A, acao: "ajustes" })));
    assertEquals(res.status, status, message);
    const body = await readJson(res);
    assertEquals(body, { error: GENERIC }, message);
    assertEquals(rpcCalls(db, "create_linha_notification").length, 0, message);
    assertEquals(audits.length, 0, message);
  }
  // Comment RPC errors map the same way.
  const c = setup();
  c.db.queueRpc("record_linha_comment", { data: null, error: { code: "P0001", message: "status_invalido" } });
  const cres = await quiet(() => c.handler(post({ token: "hub-123", linha_id: LINHA_A, acao: "comentario", comentario: "oi" })));
  assertEquals(cres.status, 409);
  // The flag can flip between the edge check and the RPC.
  const f = setup();
  f.db.queueRpc("record_linha_decision", {
    data: null,
    error: { code: "P0001", message: "feature_disabled:feature_linha_editorial" },
  });
  const fres = await quiet(() => f.handler(post({ token: "hub-123", linha_id: LINHA_A, acao: "aprovado" })));
  assertEquals(fres.status, 403);
  assertEquals(await readJson(fres), { error: "feature_disabled", feature: "feature_linha_editorial" });
});

Deno.test("hub-linha-editorial decision calls create_linha_notification after the RPC, and a notification failure still returns 200", async () => {
  const { db, handler } = setup();
  db.queueRpc("record_linha_decision", { data: { status: "ajustes", comentarios: 3 }, error: null });
  db.queueRpc("create_linha_notification", { data: null, error: { message: "notif down" } });
  const res = await quiet(() =>
    handler(post({ token: "hub-123", linha_id: LINHA_A, acao: "ajustes", comentario: "  Mudar a semana 2  " }))
  );
  assertEquals(res.status, 200);
  assertEquals(await readJson(res), { ok: true, status: "ajustes" });

  const order = db.calls.map((c) => c.table).filter((t) => t.startsWith("rpc:record") || t.startsWith("rpc:create"));
  assertEquals(order, ["rpc:record_linha_decision", "rpc:create_linha_notification"]);
  assertEquals(rpcCalls(db, "record_linha_decision")[0].payload, {
    p_linha_id: LINHA_A,
    p_conta_id: "conta-1",
    p_cliente_id: 14,
    p_token: "hub-123",
    p_acao: "ajustes",
    p_comentario: "Mudar a semana 2",
  });
  assertEquals(rpcCalls(db, "create_linha_notification")[0].payload, { p_linha_id: LINHA_A, p_acao: "ajustes" });

  // A thrown notification also never fails the decision.
  const t = setup();
  t.db.queueRpc("record_linha_decision", { data: { status: "aprovada", comentarios: 0 }, error: null });
  t.db.queueRpc("create_linha_notification", () => {
    throw new Error("network");
  });
  const tres = await quiet(() => t.handler(post({ token: "hub-123", linha_id: LINHA_A, acao: "aprovado" })));
  assertEquals(tres.status, 200);
});

Deno.test("hub-linha-editorial decision without comment sends p_comentario null", async () => {
  const { db, handler } = setup();
  db.queueRpc("record_linha_decision", { data: { status: "aprovada", comentarios: 0 }, error: null });
  const res = await handler(post({ token: "hub-123", linha_id: LINHA_A, acao: "aprovado", comentario: "   " }));
  assertEquals(res.status, 200);
  assertEquals(await readJson(res), { ok: true, status: "aprovada" });
  assertEquals((rpcCalls(db, "record_linha_decision")[0].payload as Record<string, unknown>).p_comentario, null);
});

Deno.test("hub-linha-editorial decision writes audit log", async () => {
  const { db, audits, handler } = setup();
  db.queueRpc("record_linha_decision", { data: { status: "aprovada", comentarios: 2 }, error: null });
  await handler(post({ token: "hub-123", linha_id: LINHA_A, acao: "aprovado" }));
  assertEquals(audits, [{
    conta_id: "conta-1",
    action: "hub_linha_editorial_aprovado",
    resource_type: "linha_editorial",
    resource_id: LINHA_A,
    metadata: { cliente_id: 14, acao: "aprovado", status: "aprovada", comentarios: 2 },
  }]);

  // An audit failure never breaks the decision.
  const broken = setup({ auditThrows: true });
  broken.db.queueRpc("record_linha_decision", { data: { status: "ajustes", comentarios: 1 }, error: null });
  const res = await quiet(() => broken.handler(post({ token: "hub-123", linha_id: LINHA_A, acao: "ajustes" })));
  assertEquals(res.status, 200);
});

Deno.test("hub-linha-editorial rejects other methods with 405", async () => {
  const { db, handler } = setup();
  const res = await handler(new Request("https://example.test/hub-linha-editorial?token=hub-123", { method: "DELETE" }));
  assertEquals(res.status, 405);
  assertEquals(db.calls.length, 0);
});

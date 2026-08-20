// instagram-webhook/process (Task 9) — processador de eventos + máquina de
// estados do envio. Estilo `tiktok-webhook_test.ts`/`instagram-webhook_test.ts`:
// DI via ProcessDeps/SendContext contra o supabaseMock compartilhado,
// baseDeps com `unreachable` para asserção por omissão. Chamadas de rede
// (Graph API) são roteadas por URL/método via `routedFetch`, já que o único
// ponto de injeção exposto por ProcessDeps é `fetchFn` (o cliente de
// messaging já embute Bearer + AbortSignal.timeout — Task 6).
//
// `processDelivery` (rotina: candidatos -> automações -> matching -> claim ->
// throttle) e `executeSend` (máquina de estados do envio, reusada pelo cron
// da Task 10) são exercitados separadamente: (c) é o único teste que atravessa
// as duas em conjunto, ponta a ponta; os cenários de estado do envio (f)-(i) e
// extras chamam `executeSend` direto com um `ClaimedSend` construído à mão —
// mais simples e isola a máquina de estados da lógica de roteamento.
import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import type { QueryCall } from "../../../test/shared/supabaseMock.ts";
import { createProcessDelivery, executeSend, BACKOFF_SECONDS } from "../instagram-webhook/process.ts";
import type { ClaimedSend, ProcessDeps } from "../instagram-webhook/process.ts";
import type { EventRow } from "../instagram-webhook/handler.ts";

type Db = ReturnType<typeof createSupabaseQueryMock>;

const IG_USER_ID = "ig-user-1";
const COMMENT_ID = "comment-1";
const MEDIA_ID = "media-1";
const CLIENT_ID = 501;
const CONTA_ID = "11111111-1111-1111-1111-111111111111";
const AUTOMATION_ID = "aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SEND_ID = "55555555-5555-5555-5555-555555555555";
const ENCRYPTED_TOKEN = "enc-token-1";

const FIXED_NOW = new Date("2026-08-14T12:00:00.000Z");
const COMMENT_EPOCH = Math.floor(FIXED_NOW.getTime() / 1000) - 60;
const COMMENT_ISO = new Date(COMMENT_EPOCH * 1000).toISOString();

function unreachable(label: string) {
  return () => {
    throw new Error(`must not be called: ${label}`);
  };
}

function callsFor(db: Db, table: string, operation: string) {
  return db.calls.filter((c: QueryCall) => c.table === table && c.operation === operation);
}

function rpcCallsFor(db: Db, name: string) {
  return db.calls.filter((c: QueryCall) => c.table === `rpc:${name}`);
}

// ── Fetch roteado por URL/método (o único hook de rede exposto é fetchFn) ──

type RouteResult = { status?: number; ok?: boolean; body: unknown } | { timeout: true };
type RouteHandler = () => RouteResult;

function routedFetch(handlers: {
  privateReply?: RouteHandler;
  publicReply?: RouteHandler;
  fetchComment?: RouteHandler;
  fetchReplies?: RouteHandler;
}) {
  const calls: Array<{ method: string; url: string; body?: string }> = [];
  const fetchFn = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, url, body: typeof init?.body === "string" ? init.body : undefined });

    let handler: RouteHandler | undefined;
    if (method === "POST" && url.includes("/messages")) handler = handlers.privateReply;
    else if (method === "GET" && url.includes("/replies?")) handler = handlers.fetchReplies;
    else if (method === "POST" && url.includes("/replies")) handler = handlers.publicReply;
    else if (method === "GET") handler = handlers.fetchComment;

    if (!handler) throw new Error(`fetch não mapeado no teste: ${method} ${url}`);
    const result = handler();
    if ("timeout" in result) throw new DOMException("tempo esgotado (teste)", "TimeoutError");
    const { status = 200, ok = status < 400, body } = result;
    return new Response(JSON.stringify(body), { status, statusText: ok ? "OK" : "Erro" });
  }) as unknown as typeof fetch;

  return { fetchFn, calls };
}

const okDecrypt = (t: string) => Promise.resolve(`plain:${t}`);

// ── Fixtures ─────────────────────────────────────────────────────────────

function commentValue(overrides: Record<string, unknown> = {}) {
  return {
    id: COMMENT_ID,
    from: { id: "commenter-1", username: "fulano" },
    media: { id: MEDIA_ID },
    text: "quero a promo",
    created_time: COMMENT_EPOCH,
    ...overrides,
  };
}

function eventRow(valueOverrides: Record<string, unknown> = {}, rowOverrides: Partial<EventRow> = {}): EventRow {
  return {
    id: "row-1",
    delivery_id: "delivery-1",
    ig_user_id: IG_USER_ID,
    comment_id: COMMENT_ID,
    raw: { field: "comments", value: commentValue(valueOverrides) },
    ...rowOverrides,
  };
}

function accountRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "acct-row-1",
    client_id: CLIENT_ID,
    instagram_user_id: IG_USER_ID,
    encrypted_access_token: ENCRYPTED_TOKEN,
    ...overrides,
  };
}

function automationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: AUTOMATION_ID,
    conta_id: CONTA_ID,
    client_id: CLIENT_ID,
    ig_media_id: null,
    keywords: ["promo"],
    dm_message: "Aqui está o link da promo!",
    public_reply: "Verifique sua DM!",
    created_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function baseProcessDeps(overrides: Partial<ProcessDeps> = {}): ProcessDeps {
  return {
    fetchFn: unreachable("fetchFn") as unknown as typeof fetch,
    decryptToken: unreachable("decryptToken") as unknown as (t: string) => Promise<string>,
    now: () => FIXED_NOW,
    hourlyCap: 700,
    ...overrides,
  };
}

function baseClaimedSend(overrides: Partial<ClaimedSend> = {}): ClaimedSend {
  return {
    send_id: SEND_ID,
    comment_id: COMMENT_ID,
    automation_id: AUTOMATION_ID,
    conta_id: CONTA_ID,
    commenter_id: "commenter-1",
    comment_created_at: COMMENT_ISO,
    dm_status: null,
    public_reply_status: null,
    attempts: 0,
    encrypted_access_token: ENCRYPTED_TOKEN,
    instagram_user_id: IG_USER_ID,
    ...overrides,
  };
}

function baseSendCtx(
  db: Db,
  overrides: Partial<{ fetchFn: typeof fetch; decryptToken: (t: string) => Promise<string>; now: () => Date }> = {},
) {
  return {
    svc: db as never,
    fetchFn: overrides.fetchFn ?? (unreachable("fetchFn") as unknown as typeof fetch),
    decryptToken: overrides.decryptToken ?? okDecrypt,
    now: overrides.now ?? (() => FIXED_NOW),
  };
}

// ══════════════════════════════ processDelivery ═══════════════════════════

Deno.test("processDelivery: zero contas candidatas -> stamp processed, nada mais é consultado", async () => {
  const db = createSupabaseQueryMock();
  db.queue("instagram_accounts", "select", { data: [], error: null });
  db.queue("instagram_webhook_events", "update", { data: null, error: null });

  await createProcessDelivery(baseProcessDeps())(db as never, [eventRow()]);

  assertEquals(callsFor(db, "instagram_comment_automations", "select").length, 0);
  const stamps = callsFor(db, "instagram_webhook_events", "update");
  assertEquals(stamps.length, 1);
  assert("processed_at" in (stamps[0].payload as Record<string, unknown>));
});

Deno.test("processDelivery: lookup de candidatos casa professional_account_id OU instagram_user_id", async () => {
  const db = createSupabaseQueryMock();
  db.queue("instagram_accounts", "select", { data: [], error: null });
  db.queue("instagram_webhook_events", "update", { data: null, error: null });

  await createProcessDelivery(baseProcessDeps())(db as never, [eventRow()]);

  const [candidates] = callsFor(db, "instagram_accounts", "select");
  const or = candidates.modifiers.find((m) => m.method === "or");
  assertEquals(
    or?.args[0],
    `professional_account_id.eq.${IG_USER_ID},instagram_user_id.eq.${IG_USER_ID}`,
  );
});

Deno.test("processDelivery: ig_user_id fora do conjunto seguro -> stamp direto, sem query de contas", async () => {
  const db = createSupabaseQueryMock();
  db.queue("instagram_webhook_events", "update", { data: null, error: null });

  const row = eventRow({}, { ig_user_id: "1,2)(injeta" });
  await createProcessDelivery(baseProcessDeps())(db as never, [row]);

  assertEquals(callsFor(db, "instagram_accounts", "select").length, 0);
  assertEquals(rpcCallsFor(db, "claim_automation_send").length, 0);
  assertEquals(callsFor(db, "instagram_webhook_events", "update").length, 1);
});

Deno.test("processDelivery (a): comentário da própria conta -> nenhuma claim RPC", async () => {
  const db = createSupabaseQueryMock();
  db.queue("instagram_accounts", "select", { data: [accountRow()], error: null });
  db.queue("instagram_comment_automations", "select", { data: [automationRow()], error: null });
  db.queue("instagram_webhook_events", "update", { data: null, error: null });

  const row = eventRow({ from: { id: IG_USER_ID, username: "agencia" } });
  await createProcessDelivery(baseProcessDeps())(db as never, [row]);

  assertEquals(rpcCallsFor(db, "claim_automation_send").length, 0);
  assertEquals(callsFor(db, "instagram_automation_sends", "update").length, 0);
  assertEquals(callsFor(db, "instagram_webhook_events", "update").length, 1);
});

Deno.test("processDelivery (b): reply (parent_id presente) -> nenhuma claim RPC", async () => {
  const db = createSupabaseQueryMock();
  db.queue("instagram_accounts", "select", { data: [accountRow()], error: null });
  db.queue("instagram_comment_automations", "select", { data: [automationRow()], error: null });
  db.queue("instagram_webhook_events", "update", { data: null, error: null });

  const row = eventRow({ parent_id: "parent-comment-1" });
  await createProcessDelivery(baseProcessDeps())(db as never, [row]);

  assertEquals(rpcCallsFor(db, "claim_automation_send").length, 0);
  assertEquals(callsFor(db, "instagram_webhook_events", "update").length, 1);
});

Deno.test("processDelivery: nenhuma automação casa a keyword -> stamp, sem claim", async () => {
  const db = createSupabaseQueryMock();
  db.queue("instagram_accounts", "select", { data: [accountRow()], error: null });
  db.queue("instagram_comment_automations", "select", { data: [automationRow()], error: null });
  db.queue("instagram_webhook_events", "update", { data: null, error: null });

  const row = eventRow({ text: "oi tudo bem" });
  await createProcessDelivery(baseProcessDeps())(db as never, [row]);

  assertEquals(rpcCallsFor(db, "claim_automation_send").length, 0);
  assertEquals(callsFor(db, "instagram_webhook_events", "update").length, 1);
});

Deno.test("processDelivery (c): match feliz -> claim, DM, mark_automation_dm_sent, reply pública, update final sent", async () => {
  const db = createSupabaseQueryMock();
  db.queue("instagram_accounts", "select", { data: [accountRow()], error: null }); // candidatos
  db.queue("instagram_comment_automations", "select", { data: [automationRow()], error: null }); // passo 2
  db.queueRpc("claim_automation_send", { data: [{ send_id: SEND_ID, outcome: "claimed" }], error: null });
  db.queue("instagram_comment_automations", "select", { data: [{ id: AUTOMATION_ID }], error: null }); // throttle: ids do cliente (sem filtro ativo)
  db.queue("instagram_automation_sends", "select", { data: null, error: null, count: 0 }); // throttle: contagem
  db.queue("instagram_comment_automations", "select", {
    data: { ativo: true, dm_message: "Aqui está o link da promo!", public_reply: "Verifique sua DM!", client_id: CLIENT_ID },
    error: null,
  }); // revalidação (executeSend)
  db.queue("instagram_accounts", "select", { data: { id: "acct-row-1" }, error: null }); // aptidão (executeSend)
  db.queueRpc("mark_automation_dm_sent", { data: true, error: null });
  db.queue("instagram_automation_sends", "update", { data: null, error: null }); // public_reply_status='unknown' (em voo)
  db.queue("instagram_automation_sends", "update", { data: null, error: null }); // public_reply sent
  db.queue("instagram_automation_sends", "update", { data: null, error: null }); // fechamento
  db.queue("instagram_webhook_events", "update", { data: null, error: null }); // stamp

  const { fetchFn, calls: fetchCalls } = routedFetch({
    privateReply: () => ({ body: { message_id: "m1" } }),
    publicReply: () => ({ body: { id: "reply-99" } }),
  });

  await createProcessDelivery(baseProcessDeps({ fetchFn, decryptToken: okDecrypt }))(db as never, [eventRow()]);

  const claimCalls = rpcCallsFor(db, "claim_automation_send");
  assertEquals(claimCalls.length, 1);
  assertEquals(claimCalls[0].payload, {
    p_comment_id: COMMENT_ID,
    p_automation_id: AUTOMATION_ID,
    p_conta_id: CONTA_ID,
    p_media_id: MEDIA_ID,
    p_commenter_id: "commenter-1",
    p_commenter_username: "fulano",
    p_comment_text: "quero a promo",
    p_comment_created_at: COMMENT_ISO,
  });

  assertEquals(fetchCalls.filter((c) => c.method === "POST" && c.url.endsWith("/messages")).length, 1);
  assertEquals(fetchCalls.filter((c) => c.method === "POST" && c.url.includes("/replies")).length, 1);
  assertEquals(rpcCallsFor(db, "mark_automation_dm_sent").length, 1);

  const sendUpdates = callsFor(db, "instagram_automation_sends", "update");
  assertEquals(sendUpdates.length, 3);
  assertEquals(sendUpdates[0].payload, { public_reply_status: "unknown" }, "estado em voo gravado ANTES do POST");
  assertEquals(sendUpdates[1].payload, { public_reply_id: "reply-99", public_reply_status: "sent" });
  assertEquals(sendUpdates[2].payload, { status: "sent" });

  assertEquals(callsFor(db, "instagram_webhook_events", "update").length, 1);
});

Deno.test("processDelivery (d): outcome cooldown -> stamp, nenhum send tocado além do claim", async () => {
  const db = createSupabaseQueryMock();
  db.queue("instagram_accounts", "select", { data: [accountRow()], error: null });
  db.queue("instagram_comment_automations", "select", { data: [automationRow()], error: null });
  db.queueRpc("claim_automation_send", { data: [{ send_id: null, outcome: "cooldown" }], error: null });
  db.queue("instagram_webhook_events", "update", { data: null, error: null });

  await createProcessDelivery(baseProcessDeps())(db as never, [eventRow()]);

  assertEquals(callsFor(db, "instagram_automation_sends", "select").length, 0, "não deve nem checar o throttle");
  assertEquals(callsFor(db, "instagram_automation_sends", "update").length, 0);
  assertEquals(callsFor(db, "instagram_webhook_events", "update").length, 1);
});

Deno.test("processDelivery: outcome duplicate -> mesmo tratamento que cooldown", async () => {
  const db = createSupabaseQueryMock();
  db.queue("instagram_accounts", "select", { data: [accountRow()], error: null });
  db.queue("instagram_comment_automations", "select", { data: [automationRow()], error: null });
  db.queueRpc("claim_automation_send", { data: [{ send_id: null, outcome: "duplicate" }], error: null });
  db.queue("instagram_webhook_events", "update", { data: null, error: null });

  await createProcessDelivery(baseProcessDeps())(db as never, [eventRow()]);

  assertEquals(callsFor(db, "instagram_automation_sends", "select").length, 0);
  assertEquals(callsFor(db, "instagram_webhook_events", "update").length, 1);
});

Deno.test("processDelivery (e): conflito cross-workspace -> nenhuma claim + 2 notificações, fail-closed", async () => {
  const db = createSupabaseQueryMock();
  const CLIENT_ID_2 = 502;
  const CONTA_ID_2 = "22222222-2222-2222-2222-222222222222";
  const AUTOMATION_ID_2 = "aaaaaaa2-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

  db.queue("instagram_accounts", "select", {
    data: [accountRow(), accountRow({ id: "acct-row-2", client_id: CLIENT_ID_2 })],
    error: null,
  });
  db.queue("instagram_comment_automations", "select", {
    data: [
      automationRow(),
      automationRow({ id: AUTOMATION_ID_2, conta_id: CONTA_ID_2, client_id: CLIENT_ID_2 }),
    ],
    error: null,
  });
  // notifyAutomationFailure roda 2x (uma por workspace envolvida)
  db.queue("notifications", "select", { data: [], error: null }, { data: [], error: null });
  db.queueRpc(
    "resolve_notification_targets",
    { data: ["user-1"], error: null },
    { data: ["user-2"], error: null },
  );
  db.queueRpc("insert_notification_batch", { data: null, error: null }, { data: null, error: null });
  db.queue("instagram_webhook_events", "update", { data: null, error: null });

  await createProcessDelivery(baseProcessDeps())(db as never, [eventRow()]);

  assertEquals(rpcCallsFor(db, "claim_automation_send").length, 0, "conflito é fail-closed: ninguém envia");
  assertEquals(callsFor(db, "notifications", "select").length, 2);
  assertEquals(rpcCallsFor(db, "resolve_notification_targets").length, 2);
  const inserts = rpcCallsFor(db, "insert_notification_batch");
  assertEquals(inserts.length, 2);
  const contaIdsNotified = inserts.map((c) => (c.payload as Record<string, unknown>).p_workspace_id).sort();
  assertEquals(contaIdsNotified, [CONTA_ID, CONTA_ID_2].sort());
  for (const call of inserts) {
    const payload = call.payload as Record<string, unknown>;
    assertEquals(payload.p_type, "instagram_automation_failed");
    assertEquals((payload.p_metadata as Record<string, unknown>).reason, "duplicate_account_conflict");
  }
  assertEquals(callsFor(db, "instagram_webhook_events", "update").length, 1);
});

Deno.test("processDelivery: throttle horário excedido -> retry sem incrementar attempts, sem executeSend", async () => {
  const db = createSupabaseQueryMock();
  db.queue("instagram_accounts", "select", { data: [accountRow()], error: null });
  db.queue("instagram_comment_automations", "select", { data: [automationRow()], error: null }); // passo 2
  db.queueRpc("claim_automation_send", { data: [{ send_id: SEND_ID, outcome: "claimed" }], error: null });
  db.queue("instagram_comment_automations", "select", { data: [{ id: AUTOMATION_ID }], error: null }); // throttle: ids do cliente
  db.queue("instagram_automation_sends", "select", { data: null, error: null, count: 700 });
  db.queue("instagram_automation_sends", "update", { data: null, error: null });
  db.queue("instagram_webhook_events", "update", { data: null, error: null });

  await createProcessDelivery(baseProcessDeps({ hourlyCap: 700 }))(db as never, [eventRow()]);

  // executeSend nunca deve rodar: só as duas queries de automações (passo 2 + throttle) tocam essa tabela.
  assertEquals(callsFor(db, "instagram_comment_automations", "select").length, 2);
  assertEquals(callsFor(db, "instagram_accounts", "select").length, 1);

  const sendUpdates = callsFor(db, "instagram_automation_sends", "update");
  assertEquals(sendUpdates.length, 1);
  const payload = sendUpdates[0].payload as Record<string, unknown>;
  assert(!("attempts" in payload), "throttle não deve incrementar attempts");
  assertEquals(payload.status, "retry");
  assertEquals(payload.next_attempt_at, new Date(FIXED_NOW.getTime() + 10 * 60 * 1000).toISOString());

  assertEquals(callsFor(db, "instagram_webhook_events", "update").length, 1);
});

Deno.test("processDelivery: throttle inclui automações PAUSADAS do mesmo cliente na contagem (Finding 1)", async () => {
  const db = createSupabaseQueryMock();
  const PAUSED_AUTOMATION_ID = "aaaaaaa9-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

  db.queue("instagram_accounts", "select", { data: [accountRow()], error: null });
  db.queue("instagram_comment_automations", "select", { data: [automationRow()], error: null }); // passo 2: só a ativa casa a keyword
  db.queueRpc("claim_automation_send", { data: [{ send_id: SEND_ID, outcome: "claimed" }], error: null });
  // Consulta DEDICADA do throttle, sem filtro de `ativo`: devolve a automação
  // ativa que casou (AUTOMATION_ID) E uma PAUSADA do MESMO client_id que já
  // disparou DMs recentes antes de ser pausada. Se a consulta estivesse
  // filtrando por ativo=true (o bug do Finding 1), a pausada nunca apareceria.
  db.queue("instagram_comment_automations", "select", {
    data: [{ id: AUTOMATION_ID }, { id: PAUSED_AUTOMATION_ID }],
    error: null,
  });
  db.queue("instagram_automation_sends", "select", { data: null, error: null, count: 700 });
  db.queue("instagram_automation_sends", "update", { data: null, error: null }); // throttle retry
  db.queue("instagram_webhook_events", "update", { data: null, error: null });

  await createProcessDelivery(baseProcessDeps({ hourlyCap: 700 }))(db as never, [eventRow()]);

  const countCalls = callsFor(db, "instagram_automation_sends", "select");
  assertEquals(countCalls.length, 1);
  const inModifier = countCalls[0].modifiers.find((m) => m.method === "in" && m.args[0] === "automation_id");
  assert(inModifier, "a contagem do throttle precisa filtrar por automation_id");
  const filteredIds = inModifier!.args[1] as string[];
  assert(filteredIds.includes(AUTOMATION_ID), "inclui a automação ativa que casou");
  assert(
    filteredIds.includes(PAUSED_AUTOMATION_ID),
    "inclui a automação PAUSADA do mesmo cliente -- exatamente o bypass do Finding 1",
  );

  const sendUpdates = callsFor(db, "instagram_automation_sends", "update");
  assertEquals(sendUpdates.length, 1);
  assertEquals((sendUpdates[0].payload as Record<string, unknown>).status, "retry");
});

Deno.test("processDelivery: from/text faltando -> fetchComment reconcilia e o fluxo segue até o claim", async () => {
  const db = createSupabaseQueryMock();
  db.queue("instagram_accounts", "select", { data: [accountRow()], error: null });
  db.queue("instagram_comment_automations", "select", { data: [automationRow()], error: null });
  db.queueRpc("claim_automation_send", { data: [{ send_id: null, outcome: "duplicate" }], error: null });
  db.queue("instagram_webhook_events", "update", { data: null, error: null });

  const { fetchFn } = routedFetch({
    fetchComment: () => ({ body: { id: COMMENT_ID, from: { id: "commenter-9", username: "nove" }, text: "quero a promo" } }),
  });

  const row = eventRow({ from: undefined, text: undefined });
  await createProcessDelivery(baseProcessDeps({ fetchFn, decryptToken: okDecrypt }))(db as never, [row]);

  const claimCalls = rpcCallsFor(db, "claim_automation_send");
  assertEquals(claimCalls.length, 1);
  const payload = claimCalls[0].payload as Record<string, unknown>;
  assertEquals(payload.p_commenter_id, "commenter-9");
  assertEquals(payload.p_comment_text, "quero a promo");
});

Deno.test("processDelivery: from/text ainda indeterminados após o GET -> skip seguro, sem claim", async () => {
  const db = createSupabaseQueryMock();
  db.queue("instagram_accounts", "select", { data: [accountRow()], error: null });
  db.queue("instagram_comment_automations", "select", { data: [automationRow()], error: null });
  db.queue("instagram_webhook_events", "update", { data: null, error: null });

  const { fetchFn } = routedFetch({
    fetchComment: () => ({ body: { id: COMMENT_ID } }), // sem from, sem text
  });

  const row = eventRow({ from: undefined, text: undefined });
  await createProcessDelivery(baseProcessDeps({ fetchFn, decryptToken: okDecrypt }))(db as never, [row]);

  assertEquals(rpcCallsFor(db, "claim_automation_send").length, 0);
  assertEquals(callsFor(db, "instagram_webhook_events", "update").length, 1);
});

// ── media.id ausente no payload (P2, external review) ──────────────────────
// `from`/`text` sozinhos não bastam para pular o GET: `media.id` também entra
// no gatilho, porque alimenta o filtro de automação específica de post e o
// `p_media_id` do claim. Sem isso, um comentário assinado que só omite
// `value.media.id` excluiria silenciosamente toda automação de post específico
// do matching e deixaria uma regra "todos os posts" vencer no lugar dela.

Deno.test("processDelivery: media.id ausente no payload mas presente no GET -> filtro por post usa o valor enriquecido", async () => {
  const db = createSupabaseQueryMock();
  const POST_SPECIFIC_AUTOMATION_ID = "aaaaaaa8-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

  db.queue("instagram_accounts", "select", { data: [accountRow()], error: null });
  db.queue("instagram_comment_automations", "select", {
    data: [
      automationRow(), // "todos os posts" (ig_media_id: null)
      automationRow({ id: POST_SPECIFIC_AUTOMATION_ID, ig_media_id: MEDIA_ID }), // específica do post
    ],
    error: null,
  });
  db.queueRpc("claim_automation_send", { data: [{ send_id: null, outcome: "duplicate" }], error: null });
  db.queue("instagram_webhook_events", "update", { data: null, error: null });

  const { fetchFn } = routedFetch({
    fetchComment: () => ({ body: { id: COMMENT_ID, media: { id: MEDIA_ID } } }),
  });

  // from/text presentes no payload (não acionariam o GET sozinhos); só media.id falta.
  const row = eventRow({ media: undefined });
  await createProcessDelivery(baseProcessDeps({ fetchFn, decryptToken: okDecrypt }))(db as never, [row]);

  const claimCalls = rpcCallsFor(db, "claim_automation_send");
  assertEquals(claimCalls.length, 1);
  const payload = claimCalls[0].payload as Record<string, unknown>;
  assertEquals(payload.p_media_id, MEDIA_ID, "media.id do GET alimenta o claim");
  assertEquals(
    payload.p_automation_id,
    POST_SPECIFIC_AUTOMATION_ID,
    "a automação específica do post vence -- sem o fix ela seria excluída do matching e a 'todos os posts' venceria no lugar dela",
  );
});

Deno.test("processDelivery: media.id ausente também no GET -> automação específica de post fica de fora, 'todos os posts' casa (comportamento atual, agora explícito)", async () => {
  const db = createSupabaseQueryMock();
  const POST_SPECIFIC_AUTOMATION_ID = "aaaaaaa8-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

  db.queue("instagram_accounts", "select", { data: [accountRow()], error: null });
  db.queue("instagram_comment_automations", "select", {
    data: [
      automationRow(), // "todos os posts"
      automationRow({ id: POST_SPECIFIC_AUTOMATION_ID, ig_media_id: MEDIA_ID }),
    ],
    error: null,
  });
  db.queueRpc("claim_automation_send", { data: [{ send_id: null, outcome: "duplicate" }], error: null });
  db.queue("instagram_webhook_events", "update", { data: null, error: null });

  const { fetchFn } = routedFetch({
    fetchComment: () => ({ body: { id: COMMENT_ID } }), // sem media também
  });

  const row = eventRow({ media: undefined });
  await createProcessDelivery(baseProcessDeps({ fetchFn, decryptToken: okDecrypt }))(db as never, [row]);

  const claimCalls = rpcCallsFor(db, "claim_automation_send");
  assertEquals(claimCalls.length, 1);
  const payload = claimCalls[0].payload as Record<string, unknown>;
  assertEquals(payload.p_media_id, null, "sem media.id em lugar nenhum -> segue com null, não trava o evento");
  assertEquals(payload.p_automation_id, AUTOMATION_ID, "só a automação 'todos os posts' sobra no matching");
});

// ══════════════════════════════ executeSend ════════════════════════════════

Deno.test("executeSend (f): token_expired -> conta marcada expired + notificação + failed, sem reply pública", async () => {
  const db = createSupabaseQueryMock();
  db.queue("instagram_comment_automations", "select", {
    data: { ativo: true, dm_message: "Aqui está o link!", public_reply: "Verifique sua DM!", client_id: CLIENT_ID },
    error: null,
  });
  db.queue("instagram_accounts", "select", { data: { id: "acct-row-1" }, error: null });
  db.queue("instagram_accounts", "update", { data: null, error: null });
  db.queue("notifications", "select", { data: [], error: null });
  db.queueRpc("resolve_notification_targets", { data: ["user-1"], error: null });
  db.queueRpc("insert_notification_batch", { data: null, error: null });
  db.queue("instagram_automation_sends", "update", { data: null, error: null });

  const { fetchFn, calls: fetchCalls } = routedFetch({
    privateReply: () => ({ status: 400, ok: false, body: { error: { message: "Error validating access token", code: 190 } } }),
  });

  await executeSend(baseSendCtx(db, { fetchFn }), baseClaimedSend());

  const acctUpdates = callsFor(db, "instagram_accounts", "update");
  assertEquals(acctUpdates.length, 1);
  assertEquals(acctUpdates[0].payload, { authorization_status: "expired" });
  assertEquals(
    acctUpdates[0].modifiers.some((m) => m.method === "eq" && m.args[0] === "client_id" && m.args[1] === CLIENT_ID),
    true,
  );

  assertEquals(rpcCallsFor(db, "resolve_notification_targets").length, 1);
  const insertCalls = rpcCallsFor(db, "insert_notification_batch");
  assertEquals(insertCalls.length, 1);
  assertEquals((insertCalls[0].payload as Record<string, unknown>).p_metadata, {
    client_id: CLIENT_ID,
    reason: "token_expired",
  });

  const sendUpdates = callsFor(db, "instagram_automation_sends", "update");
  assertEquals(sendUpdates.length, 1);
  assertEquals(sendUpdates[0].payload, { status: "failed", error_code: "token_expired" });

  assertEquals(rpcCallsFor(db, "mark_automation_dm_sent").length, 0);
  assertEquals(fetchCalls.length, 1, "não deve tentar a resposta pública depois de token_expired");
});

Deno.test("executeSend: DM usa professional_account_id no path quando presente (app-scoped só como fallback)", async () => {
  const db = createSupabaseQueryMock();
  db.queue("instagram_comment_automations", "select", {
    data: { ativo: true, dm_message: "msg", public_reply: null, client_id: CLIENT_ID },
    error: null,
  });
  db.queue("instagram_accounts", "select", {
    data: { id: "acct-row-1", professional_account_id: "17841400000000099" },
    error: null,
  });
  db.queueRpc("mark_automation_dm_sent", { data: null, error: null });
  db.queue("instagram_automation_sends", "update", { data: null, error: null });

  const { fetchFn, calls: fetchCalls } = routedFetch({
    privateReply: () => ({ body: { recipient_id: "r1", message_id: "m1" } }),
  });

  await executeSend(baseSendCtx(db, { fetchFn }), baseClaimedSend());

  const dmCalls = fetchCalls.filter((c) => c.method === "POST" && c.url.includes("/messages"));
  assertEquals(dmCalls.length, 1);
  assert(
    dmCalls[0].url.includes("/17841400000000099/messages"),
    `path do DM deve usar o ID profissional, não o app-scoped: ${dmCalls[0].url}`,
  );
});

Deno.test("executeSend (g): erro transiente com attempts=0 -> retry com next_attempt_at +60s", async () => {
  const db = createSupabaseQueryMock();
  db.queue("instagram_comment_automations", "select", {
    data: { ativo: true, dm_message: "msg", public_reply: "resposta", client_id: CLIENT_ID },
    error: null,
  });
  db.queue("instagram_accounts", "select", { data: { id: "acct-row-1" }, error: null });
  db.queue("instagram_automation_sends", "update", { data: null, error: null });

  const { fetchFn } = routedFetch({
    privateReply: () => ({ status: 500, ok: false, body: { error: { message: "temporary", code: 4 } } }),
  });

  await executeSend(baseSendCtx(db, { fetchFn }), baseClaimedSend({ attempts: 0 }));

  const sendUpdates = callsFor(db, "instagram_automation_sends", "update");
  assertEquals(sendUpdates.length, 1);
  assertEquals(sendUpdates[0].payload, {
    status: "retry",
    next_attempt_at: new Date(FIXED_NOW.getTime() + BACKOFF_SECONDS[0] * 1000).toISOString(),
    attempts: 1,
  });
});

Deno.test("executeSend (h): retry com dm_status='sent' -> NÃO chama sendPrivateReply, só a reply pública", async () => {
  const db = createSupabaseQueryMock();
  db.queue("instagram_comment_automations", "select", {
    data: { ativo: true, dm_message: "msg", public_reply: "Verifique sua DM!", client_id: CLIENT_ID },
    error: null,
  });
  db.queue("instagram_accounts", "select", { data: { id: "acct-row-1" }, error: null });
  db.queue("instagram_automation_sends", "update", { data: null, error: null }); // public_reply_status='unknown' (em voo)
  db.queue("instagram_automation_sends", "update", { data: null, error: null }); // public_reply sent
  db.queue("instagram_automation_sends", "update", { data: null, error: null }); // fechamento

  const { fetchFn, calls: fetchCalls } = routedFetch({
    publicReply: () => ({ body: { id: "reply-1" } }),
  });

  await executeSend(baseSendCtx(db, { fetchFn }), baseClaimedSend({ dm_status: "sent" }));

  assertEquals(rpcCallsFor(db, "mark_automation_dm_sent").length, 0);
  assertEquals(fetchCalls.filter((c) => c.url.endsWith("/messages")).length, 0);
  assertEquals(fetchCalls.filter((c) => c.method === "POST" && c.url.includes("/replies")).length, 1);

  const sendUpdates = callsFor(db, "instagram_automation_sends", "update");
  assertEquals(sendUpdates.length, 3);
  assertEquals(sendUpdates[0].payload, { public_reply_status: "unknown" }, "estado em voo gravado ANTES do POST");
  assertEquals(sendUpdates[1].payload, { public_reply_id: "reply-1", public_reply_status: "sent" });
  assertEquals(sendUpdates[2].payload, { status: "sent" });
});

Deno.test("executeSend (i-1): reply pública timeout + fetchReplies encontra -> sent com id, nunca reposta", async () => {
  const db = createSupabaseQueryMock();
  db.queue("instagram_comment_automations", "select", {
    data: { ativo: true, dm_message: "msg", public_reply: "Verifique sua DM!", client_id: CLIENT_ID },
    error: null,
  });
  db.queue("instagram_accounts", "select", { data: { id: "acct-row-1" }, error: null });
  db.queue("instagram_automation_sends", "update", { data: null, error: null }); // public_reply_status='unknown' (em voo)
  db.queue("instagram_automation_sends", "update", { data: null, error: null }); // reconciled sent
  db.queue("instagram_automation_sends", "update", { data: null, error: null }); // fechamento

  const { fetchFn, calls: fetchCalls } = routedFetch({
    publicReply: () => ({ timeout: true }),
    fetchReplies: () => ({
      body: { data: [{ id: "reply-found", text: "Verifique sua DM!", from: { id: IG_USER_ID } }] },
    }),
  });

  await executeSend(baseSendCtx(db, { fetchFn }), baseClaimedSend({ dm_status: "sent" }));

  const sendUpdates = callsFor(db, "instagram_automation_sends", "update");
  assertEquals(sendUpdates.length, 3);
  assertEquals(sendUpdates[0].payload, { public_reply_status: "unknown" }, "estado em voo gravado ANTES do POST");
  assertEquals(sendUpdates[1].payload, { public_reply_id: "reply-found", public_reply_status: "sent" });
  assertEquals(sendUpdates[2].payload, { status: "sent" });
  assertEquals(fetchCalls.filter((c) => c.method === "POST" && c.url.includes("/replies")).length, 1, "nunca reposta");
});

Deno.test("executeSend (i-2): reply pública timeout + fetchReplies NÃO encontra -> unknown, sent_partial, nunca reposta", async () => {
  const db = createSupabaseQueryMock();
  db.queue("instagram_comment_automations", "select", {
    data: { ativo: true, dm_message: "msg", public_reply: "Verifique sua DM!", client_id: CLIENT_ID },
    error: null,
  });
  db.queue("instagram_accounts", "select", { data: { id: "acct-row-1" }, error: null });
  db.queue("instagram_automation_sends", "update", { data: null, error: null }); // public_reply_status='unknown' (em voo, ANTES do POST)
  db.queue("instagram_automation_sends", "update", { data: null, error: null }); // fechamento

  const { fetchFn, calls: fetchCalls } = routedFetch({
    publicReply: () => ({ timeout: true }),
    fetchReplies: () => ({ body: { data: [] } }),
  });

  await executeSend(baseSendCtx(db, { fetchFn }), baseClaimedSend({ dm_status: "sent" }));

  const sendUpdates = callsFor(db, "instagram_automation_sends", "update");
  assertEquals(sendUpdates.length, 2);
  assertEquals(sendUpdates[0].payload, { public_reply_status: "unknown" });
  assertEquals(sendUpdates[1].payload, { status: "sent_partial" });
  assertEquals(fetchCalls.filter((c) => c.method === "POST" && c.url.includes("/replies")).length, 1, "nunca reposta");
});

// ── Finding 2 (external review): estado em voo da resposta pública ─────────
// 'unknown' é gravado ANTES da chamada à Graph API (nunca depois), então uma
// reentrada após crash/falha de persistência sempre encontra 'unknown' já
// persistido e NUNCA chama replyToComment de novo -- só reconcilia.

Deno.test("executeSend: grava public_reply_status='unknown' ANTES de chamar replyToComment (ordem verificada)", async () => {
  const db = createSupabaseQueryMock();
  db.queue("instagram_comment_automations", "select", {
    data: { ativo: true, dm_message: "msg", public_reply: "Verifique sua DM!", client_id: CLIENT_ID },
    error: null,
  });
  db.queue("instagram_accounts", "select", { data: { id: "acct-row-1" }, error: null });

  const sequence: string[] = [];
  db.queue("instagram_automation_sends", "update", () => {
    sequence.push("db:public_reply_status=unknown");
    return { data: null, error: null };
  });
  db.queue("instagram_automation_sends", "update", { data: null, error: null }); // sent
  db.queue("instagram_automation_sends", "update", { data: null, error: null }); // fechamento

  const { fetchFn } = routedFetch({
    publicReply: () => {
      sequence.push("fetch:replyToComment");
      return { body: { id: "reply-1" } };
    },
  });

  await executeSend(baseSendCtx(db, { fetchFn }), baseClaimedSend({ dm_status: "sent" }));

  assertEquals(
    sequence,
    ["db:public_reply_status=unknown", "fetch:replyToComment"],
    "o estado em voo precisa estar gravado ANTES da chamada externa, nunca depois",
  );
});

Deno.test("executeSend: reentrada com public_reply_status='unknown' -> NÃO chama replyToComment, só reconcilia; achou -> sent", async () => {
  const db = createSupabaseQueryMock();
  db.queue("instagram_comment_automations", "select", {
    data: { ativo: true, dm_message: "msg", public_reply: "Verifique sua DM!", client_id: CLIENT_ID },
    error: null,
  });
  db.queue("instagram_accounts", "select", { data: { id: "acct-row-1" }, error: null });
  db.queue("instagram_automation_sends", "update", { data: null, error: null }); // reconciled sent
  db.queue("instagram_automation_sends", "update", { data: null, error: null }); // fechamento

  // Sem handler `publicReply`: se o código chamar replyToComment na reentrada,
  // routedFetch lança "fetch não mapeado" e o teste falha -- é a asserção por
  // omissão para "nunca reposta".
  const { fetchFn, calls: fetchCalls } = routedFetch({
    fetchReplies: () => ({
      body: { data: [{ id: "reply-found", text: "Verifique sua DM!", from: { id: IG_USER_ID } }] },
    }),
  });

  await executeSend(
    baseSendCtx(db, { fetchFn }),
    baseClaimedSend({ dm_status: "sent", public_reply_status: "unknown" }),
  );

  assertEquals(fetchCalls.filter((c) => c.method === "POST" && c.url.includes("/replies")).length, 0, "nunca reposta");
  assertEquals(fetchCalls.filter((c) => c.method === "GET" && c.url.includes("/replies?")).length, 1);

  const sendUpdates = callsFor(db, "instagram_automation_sends", "update");
  assertEquals(sendUpdates.length, 2);
  assertEquals(sendUpdates[0].payload, { public_reply_id: "reply-found", public_reply_status: "sent" });
  assertEquals(sendUpdates[1].payload, { status: "sent" });
});

Deno.test("executeSend: reentrada com 'unknown' e fetchReplies não encontra -> mantém unknown sem regravar, nunca reposta", async () => {
  const db = createSupabaseQueryMock();
  db.queue("instagram_comment_automations", "select", {
    data: { ativo: true, dm_message: "msg", public_reply: "Verifique sua DM!", client_id: CLIENT_ID },
    error: null,
  });
  db.queue("instagram_accounts", "select", { data: { id: "acct-row-1" }, error: null });
  db.queue("instagram_automation_sends", "update", { data: null, error: null }); // fechamento (único update)

  const { fetchFn, calls: fetchCalls } = routedFetch({
    fetchReplies: () => ({ body: { data: [] } }),
  });

  await executeSend(
    baseSendCtx(db, { fetchFn }),
    baseClaimedSend({ dm_status: "sent", public_reply_status: "unknown" }),
  );

  assertEquals(fetchCalls.filter((c) => c.method === "POST" && c.url.includes("/replies")).length, 0, "nunca reposta");
  const sendUpdates = callsFor(db, "instagram_automation_sends", "update");
  assertEquals(sendUpdates.length, 1, "não achou -> mantém 'unknown', nada a regravar além do fechamento");
  assertEquals(sendUpdates[0].payload, { status: "sent_partial" });
});

Deno.test("executeSend: erro permanente no DM -> failed/dm_permanent, sem retry", async () => {
  const db = createSupabaseQueryMock();
  db.queue("instagram_comment_automations", "select", {
    data: { ativo: true, dm_message: "msg", public_reply: null, client_id: CLIENT_ID },
    error: null,
  });
  db.queue("instagram_accounts", "select", { data: { id: "acct-row-1" }, error: null });
  db.queue("instagram_automation_sends", "update", { data: null, error: null });

  const { fetchFn } = routedFetch({
    privateReply: () => ({ status: 400, ok: false, body: { error: { message: "comment deleted", code: 100 } } }),
  });

  await executeSend(baseSendCtx(db, { fetchFn }), baseClaimedSend());

  const sendUpdates = callsFor(db, "instagram_automation_sends", "update");
  assertEquals(sendUpdates.length, 1);
  assertEquals(sendUpdates[0].payload, { status: "failed", error_code: "dm_permanent" });
});

Deno.test("executeSend: transiente com attempts>=5 -> failed/retry_exhausted em vez de retry", async () => {
  const db = createSupabaseQueryMock();
  db.queue("instagram_comment_automations", "select", {
    data: { ativo: true, dm_message: "msg", public_reply: null, client_id: CLIENT_ID },
    error: null,
  });
  db.queue("instagram_accounts", "select", { data: { id: "acct-row-1" }, error: null });
  db.queue("instagram_automation_sends", "update", { data: null, error: null });

  const { fetchFn } = routedFetch({
    privateReply: () => ({ status: 500, ok: false, body: { error: { message: "temporary", code: 4 } } }),
  });

  await executeSend(baseSendCtx(db, { fetchFn }), baseClaimedSend({ attempts: 5 }));

  const sendUpdates = callsFor(db, "instagram_automation_sends", "update");
  assertEquals(sendUpdates.length, 1);
  assertEquals(sendUpdates[0].payload, { status: "failed", error_code: "retry_exhausted" });
});

Deno.test("executeSend: transiente com comentário criado há mais de 7 dias -> failed/retry_exhausted mesmo com attempts=0", async () => {
  const db = createSupabaseQueryMock();
  db.queue("instagram_comment_automations", "select", {
    data: { ativo: true, dm_message: "msg", public_reply: null, client_id: CLIENT_ID },
    error: null,
  });
  db.queue("instagram_accounts", "select", { data: { id: "acct-row-1" }, error: null });
  db.queue("instagram_automation_sends", "update", { data: null, error: null });

  const { fetchFn } = routedFetch({
    privateReply: () => ({ status: 500, ok: false, body: { error: { message: "temporary", code: 4 } } }),
  });

  const oldComment = new Date(FIXED_NOW.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
  await executeSend(baseSendCtx(db, { fetchFn }), baseClaimedSend({ attempts: 0, comment_created_at: oldComment }));

  const sendUpdates = callsFor(db, "instagram_automation_sends", "update");
  assertEquals(sendUpdates.length, 1);
  assertEquals(sendUpdates[0].payload, { status: "failed", error_code: "retry_exhausted" });
});

Deno.test("executeSend: automação excluída (sumiu) -> skipped/automation_inactive, sem tocar em conta ou token", async () => {
  const db = createSupabaseQueryMock();
  db.queue("instagram_comment_automations", "select", { data: null, error: null });
  db.queue("instagram_automation_sends", "update", { data: null, error: null });

  await executeSend(
    baseSendCtx(db, { decryptToken: unreachable("decryptToken") as unknown as (t: string) => Promise<string> }),
    baseClaimedSend(),
  );

  assertEquals(callsFor(db, "instagram_accounts", "select").length, 0);
  const sendUpdates = callsFor(db, "instagram_automation_sends", "update");
  assertEquals(sendUpdates.length, 1);
  assertEquals(sendUpdates[0].payload, { status: "skipped", skip_reason: "automation_inactive" });
});

Deno.test("executeSend: automação pausada (ativo=false) -> skipped/automation_inactive", async () => {
  const db = createSupabaseQueryMock();
  db.queue("instagram_comment_automations", "select", {
    data: { ativo: false, dm_message: "msg", public_reply: null, client_id: CLIENT_ID },
    error: null,
  });
  db.queue("instagram_automation_sends", "update", { data: null, error: null });

  await executeSend(
    baseSendCtx(db, { decryptToken: unreachable("decryptToken") as unknown as (t: string) => Promise<string> }),
    baseClaimedSend(),
  );

  const sendUpdates = callsFor(db, "instagram_automation_sends", "update");
  assertEquals(sendUpdates.length, 1);
  assertEquals(sendUpdates[0].payload, { status: "skipped", skip_reason: "automation_inactive" });
});

Deno.test("executeSend: conta ficou inapta entre o claim e o envio -> failed/account_unauthorized", async () => {
  const db = createSupabaseQueryMock();
  db.queue("instagram_comment_automations", "select", {
    data: { ativo: true, dm_message: "msg", public_reply: null, client_id: CLIENT_ID },
    error: null,
  });
  db.queue("instagram_accounts", "select", { data: null, error: null }); // não apta mais
  db.queue("instagram_automation_sends", "update", { data: null, error: null });

  await executeSend(
    baseSendCtx(db, { decryptToken: unreachable("decryptToken") as unknown as (t: string) => Promise<string> }),
    baseClaimedSend(),
  );

  const sendUpdates = callsFor(db, "instagram_automation_sends", "update");
  assertEquals(sendUpdates.length, 1);
  assertEquals(sendUpdates[0].payload, { status: "failed", error_code: "account_unauthorized" });
});

Deno.test("executeSend: sem resposta pública configurada -> fecha 'sent' logo após a DM, sem chamar replyToComment", async () => {
  const db = createSupabaseQueryMock();
  db.queue("instagram_comment_automations", "select", {
    data: { ativo: true, dm_message: "msg", public_reply: null, client_id: CLIENT_ID },
    error: null,
  });
  db.queue("instagram_accounts", "select", { data: { id: "acct-row-1" }, error: null });
  db.queue("instagram_automation_sends", "update", { data: null, error: null }); // fechamento (único update)

  const { fetchFn, calls: fetchCalls } = routedFetch({
    privateReply: () => ({ body: { message_id: "m1" } }),
  });

  await executeSend(baseSendCtx(db, { fetchFn }), baseClaimedSend());

  assertEquals(fetchCalls.filter((c) => c.method === "POST" && c.url.includes("/replies")).length, 0);
  const sendUpdates = callsFor(db, "instagram_automation_sends", "update");
  assertEquals(sendUpdates.length, 1);
  assertEquals(sendUpdates[0].payload, { status: "sent" });
});

Deno.test("executeSend: erro não-timeout na resposta pública -> public_reply_status=failed, fecha sent_partial", async () => {
  const db = createSupabaseQueryMock();
  db.queue("instagram_comment_automations", "select", {
    data: { ativo: true, dm_message: "msg", public_reply: "Verifique sua DM!", client_id: CLIENT_ID },
    error: null,
  });
  db.queue("instagram_accounts", "select", { data: { id: "acct-row-1" }, error: null });
  db.queue("instagram_automation_sends", "update", { data: null, error: null }); // public_reply_status='unknown' (em voo)
  db.queue("instagram_automation_sends", "update", { data: null, error: null }); // failed
  db.queue("instagram_automation_sends", "update", { data: null, error: null }); // fechamento

  const { fetchFn } = routedFetch({
    publicReply: () => ({ status: 400, ok: false, body: { error: { message: "comment deleted", code: 100 } } }),
  });

  await executeSend(baseSendCtx(db, { fetchFn }), baseClaimedSend({ dm_status: "sent" }));

  const sendUpdates = callsFor(db, "instagram_automation_sends", "update");
  assertEquals(sendUpdates.length, 3);
  assertEquals(sendUpdates[0].payload, { public_reply_status: "unknown" }, "estado em voo gravado ANTES do POST");
  assertEquals(sendUpdates[1].payload, { public_reply_status: "failed" });
  assertEquals(sendUpdates[2].payload, { status: "sent_partial" });
});

Deno.test("executeSend: 'já existe private reply' (already_replied) -> auto-correção, mark_automation_dm_sent chamado", async () => {
  const db = createSupabaseQueryMock();
  db.queue("instagram_comment_automations", "select", {
    data: { ativo: true, dm_message: "msg", public_reply: null, client_id: CLIENT_ID },
    error: null,
  });
  db.queue("instagram_accounts", "select", { data: { id: "acct-row-1" }, error: null });
  db.queueRpc("mark_automation_dm_sent", { data: true, error: null });
  db.queue("instagram_automation_sends", "update", { data: null, error: null }); // fechamento

  const { fetchFn } = routedFetch({
    privateReply: () => ({
      status: 400,
      ok: false,
      body: { error: { message: "The comment has already received a private reply", code: 10 } },
    }),
  });

  await executeSend(baseSendCtx(db, { fetchFn }), baseClaimedSend());

  assertEquals(rpcCallsFor(db, "mark_automation_dm_sent").length, 1);
  const sendUpdates = callsFor(db, "instagram_automation_sends", "update");
  assertEquals(sendUpdates.length, 1);
  assertEquals(sendUpdates[0].payload, { status: "sent" });
});

// ── Persistência pós-envio-aceito NUNCA vira erro permanente da Graph ──────
// (external review, on-PR): o classify-catch tem que embrulhar SÓ a chamada
// externa, nunca a escrita de banco que registra o resultado dela.

Deno.test(
  "executeSend: sendPrivateReply aceito + mark_automation_dm_sent falha -> LANÇA, sem marcar failed (Finding 1, P1)",
  async () => {
    const db = createSupabaseQueryMock();
    db.queue("instagram_comment_automations", "select", {
      data: { ativo: true, dm_message: "msg", public_reply: null, client_id: CLIENT_ID },
      error: null,
    });
    db.queue("instagram_accounts", "select", { data: { id: "acct-row-1" }, error: null });
    db.queueRpc("mark_automation_dm_sent", { data: null, error: { message: "connection reset" } });

    const { fetchFn } = routedFetch({
      privateReply: () => ({ body: { message_id: "m1" } }),
    });

    let threw = false;
    try {
      await executeSend(baseSendCtx(db, { fetchFn }), baseClaimedSend());
    } catch {
      threw = true;
    }
    assert(threw, "uma falha de persistência da RPC precisa propagar, não ser engolida e reclassificada");

    assertEquals(
      callsFor(db, "instagram_automation_sends", "update").length,
      0,
      "nenhum UPDATE deve rodar -- em especial, NUNCA status='failed' para um DM que a Graph já aceitou; " +
        "a linha fica 'processing' para o cron reclamar e self-heal via already_replied",
    );
  },
);

Deno.test(
  "executeSend: replyToComment aceito + UPDATE 'sent' falha -> LANÇA, public_reply_status permanece 'unknown' (Finding 2, P2)",
  async () => {
    const db = createSupabaseQueryMock();
    db.queue("instagram_comment_automations", "select", {
      data: { ativo: true, dm_message: "msg", public_reply: "Verifique sua DM!", client_id: CLIENT_ID },
      error: null,
    });
    db.queue("instagram_accounts", "select", { data: { id: "acct-row-1" }, error: null });
    db.queue("instagram_automation_sends", "update", { data: null, error: null }); // public_reply_status='unknown' (em voo) -- ok
    db.queue("instagram_automation_sends", "update", { data: null, error: { message: "connection reset" } }); // grava 'sent' -- falha

    const { fetchFn } = routedFetch({
      publicReply: () => ({ body: { id: "reply-1" } }),
    });

    let threw = false;
    try {
      await executeSend(baseSendCtx(db, { fetchFn }), baseClaimedSend({ dm_status: "sent" }));
    } catch {
      threw = true;
    }
    assert(threw, "uma falha de persistência do UPDATE 'sent' precisa propagar, não ser engolida e reclassificada");

    const sendUpdates = callsFor(db, "instagram_automation_sends", "update");
    assertEquals(sendUpdates.length, 2, "só o pre-write 'unknown' e a tentativa falha de 'sent'");
    assertEquals(sendUpdates[0].payload, { public_reply_status: "unknown" });
    assertEquals(sendUpdates[1].payload, { public_reply_id: "reply-1", public_reply_status: "sent" });
    assertEquals(
      sendUpdates.filter((c) => (c.payload as Record<string, unknown>).public_reply_status === "failed").length,
      0,
      "NUNCA deve sobrescrever com 'failed' -- 'unknown' é o que fica persistido de fato; " +
        "a reentrada reconcilia via GET replies em vez de arriscar repostar",
    );
  },
);

// ══════════════════════ executeSend: dm_buttons (button template) ═════════

const BUTTONS_FIXTURE = [{ title: "Agendar", url: "https://agenda.x" }];
const TEMPLATE_BODY = {
  recipient: { comment_id: COMMENT_ID },
  message: {
    attachment: {
      type: "template",
      payload: {
        template_type: "button",
        text: "Escolha:",
        buttons: [{ type: "web_url", url: "https://agenda.x", title: "Agendar" }],
      },
    },
  },
};

function buttonsAutomationSelect(db: Db) {
  db.queue("instagram_comment_automations", "select", {
    data: {
      ativo: true,
      dm_message: "Escolha:",
      dm_buttons: BUTTONS_FIXTURE,
      public_reply: null,
      client_id: CLIENT_ID,
    },
    error: null,
  });
}

Deno.test("executeSend: dm_buttons -> POST com button template exato e p_dm_kind='buttons'", async () => {
  const db = createSupabaseQueryMock();
  buttonsAutomationSelect(db);
  db.queue("instagram_accounts", "select", { data: { id: "acct-row-1" }, error: null });
  db.queueRpc("mark_automation_dm_sent", { data: true, error: null });
  db.queue("instagram_automation_sends", "update", { data: null, error: null }); // fechamento

  const { fetchFn, calls: fetchCalls } = routedFetch({
    privateReply: () => ({ body: { message_id: "m1" } }),
  });

  await executeSend(baseSendCtx(db, { fetchFn }), baseClaimedSend());

  const dmCalls = fetchCalls.filter((c) => c.method === "POST" && c.url.includes("/messages"));
  assertEquals(dmCalls.length, 1);
  assertEquals(JSON.parse(dmCalls[0].body ?? "null"), TEMPLATE_BODY);

  const marks = rpcCallsFor(db, "mark_automation_dm_sent");
  assertEquals(marks.length, 1);
  assertEquals(marks[0].payload, { p_send_id: SEND_ID, p_dm_kind: "buttons" });

  const sendUpdates = callsFor(db, "instagram_automation_sends", "update");
  assertEquals(sendUpdates.length, 1);
  assertEquals(sendUpdates[0].payload, { status: "sent" });
});

Deno.test("executeSend: template recusado (permanent) -> fallback texto no 2º POST, p_dm_kind='buttons_fallback_text'", async () => {
  const db = createSupabaseQueryMock();
  buttonsAutomationSelect(db);
  db.queue("instagram_accounts", "select", { data: { id: "acct-row-1" }, error: null });
  db.queueRpc("mark_automation_dm_sent", { data: true, error: null });
  db.queue("instagram_automation_sends", "update", { data: null, error: null }); // fechamento

  let attempt = 0;
  const { fetchFn, calls: fetchCalls } = routedFetch({
    privateReply: () =>
      ++attempt === 1
        ? { status: 400, ok: false, body: { error: { message: "unsupported message payload", code: 100 } } }
        : { body: { message_id: "m2" } },
  });

  await executeSend(baseSendCtx(db, { fetchFn }), baseClaimedSend());

  const dmCalls = fetchCalls.filter((c) => c.method === "POST" && c.url.includes("/messages"));
  assertEquals(dmCalls.length, 2);
  assertEquals(JSON.parse(dmCalls[0].body ?? "null"), TEMPLATE_BODY);
  assertEquals(JSON.parse(dmCalls[1].body ?? "null"), {
    recipient: { comment_id: COMMENT_ID },
    message: { text: "Escolha:\n\nAgendar: https://agenda.x" },
  });

  const marks = rpcCallsFor(db, "mark_automation_dm_sent");
  assertEquals(marks.length, 1);
  assertEquals(marks[0].payload, { p_send_id: SEND_ID, p_dm_kind: "buttons_fallback_text" });

  const sendUpdates = callsFor(db, "instagram_automation_sends", "update");
  assertEquals(sendUpdates.length, 1);
  assertEquals(sendUpdates[0].payload, { status: "sent" });
});

Deno.test("executeSend: permanent no template E no fallback -> failed/dm_permanent com exatamente 2 POSTs", async () => {
  const db = createSupabaseQueryMock();
  buttonsAutomationSelect(db);
  db.queue("instagram_accounts", "select", { data: { id: "acct-row-1" }, error: null });
  db.queue("instagram_automation_sends", "update", { data: null, error: null });

  const { fetchFn, calls: fetchCalls } = routedFetch({
    privateReply: () => ({ status: 400, ok: false, body: { error: { message: "no can do", code: 100 } } }),
  });

  await executeSend(baseSendCtx(db, { fetchFn }), baseClaimedSend());

  const dmCalls = fetchCalls.filter((c) => c.method === "POST" && c.url.includes("/messages"));
  assertEquals(dmCalls.length, 2, "template + fallback, nada além");

  const sendUpdates = callsFor(db, "instagram_automation_sends", "update");
  assertEquals(sendUpdates.length, 1);
  assertEquals(sendUpdates[0].payload, { status: "failed", error_code: "dm_permanent" });
  assertEquals(rpcCallsFor(db, "mark_automation_dm_sent").length, 0);
});

Deno.test("executeSend: transient no template -> retry SEM tentar o fallback (1 POST)", async () => {
  const db = createSupabaseQueryMock();
  buttonsAutomationSelect(db);
  db.queue("instagram_accounts", "select", { data: { id: "acct-row-1" }, error: null });
  db.queue("instagram_automation_sends", "update", { data: null, error: null });

  const { fetchFn, calls: fetchCalls } = routedFetch({
    privateReply: () => ({ status: 500, ok: false, body: { error: { message: "temporary", code: 4 } } }),
  });

  await executeSend(baseSendCtx(db, { fetchFn }), baseClaimedSend({ attempts: 0 }));

  const dmCalls = fetchCalls.filter((c) => c.method === "POST" && c.url.includes("/messages"));
  assertEquals(dmCalls.length, 1, "transient NÃO dispara o fallback; o retry recomeça do template");

  const sendUpdates = callsFor(db, "instagram_automation_sends", "update");
  assertEquals(sendUpdates.length, 1);
  assertEquals(sendUpdates[0].payload, {
    status: "retry",
    next_attempt_at: new Date(FIXED_NOW.getTime() + BACKOFF_SECONDS[0] * 1000).toISOString(),
    attempts: 1,
  });
});

Deno.test("executeSend: sem dm_buttons -> body de texto puro e p_dm_kind='text'", async () => {
  const db = createSupabaseQueryMock();
  db.queue("instagram_comment_automations", "select", {
    data: { ativo: true, dm_message: "msg", public_reply: null, client_id: CLIENT_ID },
    error: null,
  });
  db.queue("instagram_accounts", "select", { data: { id: "acct-row-1" }, error: null });
  db.queueRpc("mark_automation_dm_sent", { data: true, error: null });
  db.queue("instagram_automation_sends", "update", { data: null, error: null });

  const { fetchFn, calls: fetchCalls } = routedFetch({
    privateReply: () => ({ body: { message_id: "m1" } }),
  });

  await executeSend(baseSendCtx(db, { fetchFn }), baseClaimedSend());

  const dmCalls = fetchCalls.filter((c) => c.method === "POST" && c.url.includes("/messages"));
  assertEquals(dmCalls.length, 1);
  assertEquals(JSON.parse(dmCalls[0].body ?? "null"), {
    recipient: { comment_id: COMMENT_ID },
    message: { text: "msg" },
  });

  const marks = rpcCallsFor(db, "mark_automation_dm_sent");
  assertEquals(marks.length, 1);
  assertEquals(marks[0].payload, { p_send_id: SEND_ID, p_dm_kind: "text" });
});

// instagram-automation-cron (Task 10) — cron de retry/manutenção: sends
// inelegíveis, sweep de eventos órfãos, sweep de convergência dos vínculos,
// retries via executeSend, re-check diário de assinaturas e purge. Estilo
// `instagram-webhook-process_test.ts`:
// DI via InstagramAutomationCronDeps contra o supabaseMock compartilhado,
// baseDeps com `unreachable` para asserção por omissão. `executeSend` e
// `createProcessDelivery` são consumidos DIRETO (não mockados) — as fases 4 e
// 5 são provadas observando as escritas que só eles produzem no mock de DB.
import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import type { QueryCall } from "../../../test/shared/supabaseMock.ts";
import { createInstagramAutomationCronHandler } from "../instagram-automation-cron/handler.ts";
import type { InstagramAutomationCronDeps } from "../instagram-automation-cron/handler.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

type Db = ReturnType<typeof createSupabaseQueryMock>;

const CRON_SECRET = "segredo-cron";
const timingSafeEqual = (a: string, b: string) => a === b;

const FIXED_NOW = new Date("2026-08-14T12:00:00.000Z");

const CLIENT_ID = 501;
const CONTA_ID = "11111111-1111-1111-1111-111111111111";
const AUTOMATION_ID = "aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SEND_ID = "55555555-5555-5555-5555-555555555555";
const ACCOUNT_ROW_ID = "acct-row-1";
const ENCRYPTED_TOKEN = "enc-token-1";
const MEDIA_ID = "media-1";

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

function callKey(c: QueryCall): string {
  return c.operation === "rpc" ? c.table : `${c.table}:${c.operation}`;
}

function hasModifier(call: QueryCall, method: string, args: unknown[]): boolean {
  return call.modifiers.some((m) => m.method === method && JSON.stringify(m.args) === JSON.stringify(args));
}

async function readJson(response: Response) {
  return await response.json();
}

function baseDeps(db: Db, overrides: Partial<InstagramAutomationCronDeps> = {}): InstagramAutomationCronDeps {
  return {
    cronSecret: CRON_SECRET,
    timingSafeEqual,
    createServiceDb: () => db as unknown as SupabaseClient,
    fetchFn: unreachable("fetchFn") as unknown as typeof fetch,
    decryptToken: unreachable("decryptToken") as unknown as (t: string) => Promise<string>,
    now: () => FIXED_NOW,
    ...overrides,
  };
}

// Fila padrão das 6 fases "vazias" (nada a fazer em nenhuma): usada pelo happy
// path e como base para os testes que só sobrescrevem UMA fase.
function queueEmptyRun(db: Db) {
  db.queueRpc("fail_ineligible_automation_sends", { data: 0, error: null });
  db.queue("instagram_webhook_events", "select", { data: [], error: null });
  db.queueRpc("sweep_pending_instagram_automation_links", { data: 0, error: null });
  db.queueRpc("claim_retryable_automation_sends", { data: [], error: null });
  db.queue("instagram_comment_automations", "select", { data: [], error: null });
  db.queue("instagram_webhook_events", "delete", { data: null, error: null });
}

function claimedSendFixture(overrides: Record<string, unknown> = {}) {
  return {
    send_id: SEND_ID,
    comment_id: "comment-1",
    automation_id: AUTOMATION_ID,
    conta_id: CONTA_ID,
    media_id: MEDIA_ID,
    commenter_id: "commenter-1",
    comment_created_at: "2026-08-14T11:00:00.000Z",
    dm_status: null,
    public_reply_status: null,
    public_reply_text: null,
    attempts: 0,
    encrypted_access_token: ENCRYPTED_TOKEN,
    instagram_user_id: "ig-user-1",
    ...overrides,
  };
}

function fetchSubscribedFieldsRoute(fields: string[]) {
  const calls: string[] = [];
  const fetchFn = (async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    if (!url.includes("/me/subscribed_apps")) {
      throw new Error(`fetch não mapeado no teste: ${url}`);
    }
    return new Response(JSON.stringify({ data: [{ subscribed_fields: fields }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

// ══════════════════════════════ (a) Auth ═══════════════════════════════════

Deno.test("instagram-automation-cron: sem x-cron-secret -> 401 e nenhuma chamada de DB", async () => {
  const handler = createInstagramAutomationCronHandler(
    baseDeps(undefined as unknown as Db, {
      createServiceDb: unreachable("createServiceDb") as unknown as () => SupabaseClient,
    }),
  );

  const response = await handler(new Request("https://example.test/instagram-automation-cron"));
  assertEquals(response.status, 401);
});

Deno.test("instagram-automation-cron: x-cron-secret errado -> 401 e nenhuma chamada de DB", async () => {
  const handler = createInstagramAutomationCronHandler(
    baseDeps(undefined as unknown as Db, {
      createServiceDb: unreachable("createServiceDb") as unknown as () => SupabaseClient,
    }),
  );

  const response = await handler(
    new Request("https://example.test/instagram-automation-cron", {
      headers: { "x-cron-secret": "errado" },
    }),
  );
  assertEquals(response.status, 401);
});

// ══════════════════════════════ (b) Happy path ═════════════════════════════

Deno.test("instagram-automation-cron: happy path chama as fases na ordem e retorna 200 { ok: true, failed: 0 }", async () => {
  const db = createSupabaseQueryMock();
  queueEmptyRun(db);

  const handler = createInstagramAutomationCronHandler(baseDeps(db));
  const response = await handler(
    new Request("https://example.test/instagram-automation-cron", {
      headers: { "x-cron-secret": CRON_SECRET },
    }),
  );

  assertEquals(response.status, 200);
  assertEquals(await readJson(response), { ok: true, failed: 0 });

  const expectedSequence = [
    "rpc:fail_ineligible_automation_sends",
    "rpc:sweep_pending_instagram_automation_links",
    "instagram_webhook_events:select",
    "rpc:claim_retryable_automation_sends",
    "instagram_comment_automations:select",
    "instagram_webhook_events:delete",
  ];
  const actualSequence = db.calls.map(callKey).filter((k: string) => expectedSequence.includes(k));
  assertEquals(actualSequence, expectedSequence);
});

Deno.test("instagram-automation-cron: happy path não chama reportCronFailure (nenhum cron_failures insert)", async () => {
  const db = createSupabaseQueryMock();
  queueEmptyRun(db);

  const handler = createInstagramAutomationCronHandler(baseDeps(db));
  await handler(
    new Request("https://example.test/instagram-automation-cron", {
      headers: { "x-cron-secret": CRON_SECRET },
    }),
  );

  assertEquals(callsFor(db, "cron_failures", "insert").length, 0);
});

// ══════════════════════════════ (c) Retries: executeSend ═══════════════════

Deno.test("instagram-automation-cron: claim devolve 1 send -> executeSend é chamado com ela", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("fail_ineligible_automation_sends", { data: 0, error: null });
  db.queue("instagram_webhook_events", "select", { data: [], error: null });
  db.queueRpc("sweep_pending_instagram_automation_links", { data: 0, error: null });
  db.queueRpc("claim_retryable_automation_sends", { data: [claimedSendFixture()], error: null });
  // 1ª resposta: revalidação da automação dentro de executeSend (não achou -> skipped/automation_inactive).
  db.queue("instagram_comment_automations", "select", { data: null, error: null });
  // 2ª resposta: query da fase 6 (re-check), vazia.
  db.queue("instagram_comment_automations", "select", { data: [], error: null });
  db.queue("instagram_automation_sends", "update", { data: null, error: null });
  db.queue("instagram_webhook_events", "delete", { data: null, error: null });

  const handler = createInstagramAutomationCronHandler(baseDeps(db));
  const response = await handler(
    new Request("https://example.test/instagram-automation-cron", {
      headers: { "x-cron-secret": CRON_SECRET },
    }),
  );

  assertEquals(response.status, 200);
  assertEquals(await readJson(response), { ok: true, failed: 0 });

  // Prova que executeSend rodou com O send claimado: a revalidação lê
  // exatamente o automation_id do fixture.
  const automationLookups = callsFor(db, "instagram_comment_automations", "select");
  assert(automationLookups.length >= 1, "executeSend deveria ter consultado a automação");
  assert(
    hasModifier(automationLookups[0], "eq", ["id", AUTOMATION_ID]),
    "revalidação deveria filtrar pelo automation_id do send claimado",
  );

  // E que o efeito (skipped/automation_inactive, automação não encontrada)
  // foi gravado no send_id correto.
  const sendUpdates = callsFor(db, "instagram_automation_sends", "update");
  assertEquals(sendUpdates.length, 1);
  assertEquals(sendUpdates[0].payload, { status: "skipped", skip_reason: "automation_inactive" });
  assert(hasModifier(sendUpdates[0], "eq", ["id", SEND_ID]), "update deveria mirar o send_id claimado");
});

Deno.test("instagram-automation-cron: retries com 2 sends, 1 falha -> failed=1 e reportCronFailure dispara", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("fail_ineligible_automation_sends", { data: 0, error: null });
  db.queue("instagram_webhook_events", "select", { data: [], error: null });
  db.queueRpc("sweep_pending_instagram_automation_links", { data: 0, error: null });
  db.queueRpc("claim_retryable_automation_sends", {
    data: [claimedSendFixture({ send_id: "send-a" }), claimedSendFixture({ send_id: "send-b" })],
    error: null,
  });
  // send-a: revalidação explode (erro de banco) -> executeSend lança, contado como falha.
  db.queue("instagram_comment_automations", "select", { data: null, error: { message: "db indisponível" } });
  // send-b: automação não encontrada -> skipped/automation_inactive (sucesso).
  db.queue("instagram_comment_automations", "select", { data: null, error: null });
  // Fase 6 (recheck), vazia.
  db.queue("instagram_comment_automations", "select", { data: [], error: null });
  db.queue("instagram_automation_sends", "update", { data: null, error: null });
  db.queue("instagram_webhook_events", "delete", { data: null, error: null });
  db.queue("cron_failures", "insert", { data: null, error: null });

  const handler = createInstagramAutomationCronHandler(baseDeps(db));
  const response = await handler(
    new Request("https://example.test/instagram-automation-cron", {
      headers: { "x-cron-secret": CRON_SECRET },
    }),
  );

  assertEquals(response.status, 200);
  assertEquals(await readJson(response), { ok: true, failed: 1 });
  assertEquals(callsFor(db, "cron_failures", "insert").length, 1);
});

// ══════════════════════════════ (d) Re-check de assinaturas ════════════════

Deno.test("instagram-automation-cron: assinatura caiu (sem 'comments') -> comments_subscribed_at=NULL + notificação", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("fail_ineligible_automation_sends", { data: 0, error: null });
  db.queue("instagram_webhook_events", "select", { data: [], error: null });
  db.queueRpc("sweep_pending_instagram_automation_links", { data: 0, error: null });
  db.queueRpc("claim_retryable_automation_sends", { data: [], error: null });
  db.queue("instagram_comment_automations", "select", {
    data: [{ client_id: CLIENT_ID, conta_id: CONTA_ID }],
    error: null,
  });
  db.queue("instagram_accounts", "select", {
    data: [{ id: ACCOUNT_ROW_ID, client_id: CLIENT_ID, encrypted_access_token: ENCRYPTED_TOKEN }],
    error: null,
  });
  db.queue("instagram_accounts", "update", { data: null, error: null });
  // notifyAutomationFailure: sem notificação prévia -> resolve targets -> insere.
  db.queue("notifications", "select", { data: [], error: null });
  db.queueRpc("resolve_notification_targets", { data: ["user-1"], error: null });
  db.queueRpc("insert_notification_batch", { data: null, error: null });
  db.queue("instagram_webhook_events", "delete", { data: null, error: null });

  const { fetchFn } = fetchSubscribedFieldsRoute(["messages"]); // sem "comments"
  const decryptToken = (t: string) => Promise.resolve(`plain:${t}`);

  const handler = createInstagramAutomationCronHandler(baseDeps(db, { fetchFn, decryptToken }));
  const response = await handler(
    new Request("https://example.test/instagram-automation-cron", {
      headers: { "x-cron-secret": CRON_SECRET },
    }),
  );

  assertEquals(response.status, 200);
  assertEquals(await readJson(response), { ok: true, failed: 0 });

  const acctUpdates = callsFor(db, "instagram_accounts", "update");
  assertEquals(acctUpdates.length, 1);
  assertEquals(acctUpdates[0].payload, { comments_subscribed_at: null });
  assert(hasModifier(acctUpdates[0], "eq", ["id", ACCOUNT_ROW_ID]));

  const notifyCalls = rpcCallsFor(db, "insert_notification_batch");
  assertEquals(notifyCalls.length, 1);
  const payload = notifyCalls[0].payload as Record<string, unknown>;
  assertEquals(payload.p_workspace_id, CONTA_ID);
  assertEquals((payload.p_metadata as Record<string, unknown>).reason, "subscription_lost");
});

Deno.test("instagram-automation-cron: assinatura confirmada ('comments' presente) -> comments_subscribed_at=now, sem notificar", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("fail_ineligible_automation_sends", { data: 0, error: null });
  db.queue("instagram_webhook_events", "select", { data: [], error: null });
  db.queueRpc("sweep_pending_instagram_automation_links", { data: 0, error: null });
  db.queueRpc("claim_retryable_automation_sends", { data: [], error: null });
  db.queue("instagram_comment_automations", "select", {
    data: [{ client_id: CLIENT_ID, conta_id: CONTA_ID }],
    error: null,
  });
  db.queue("instagram_accounts", "select", {
    data: [{ id: ACCOUNT_ROW_ID, client_id: CLIENT_ID, encrypted_access_token: ENCRYPTED_TOKEN }],
    error: null,
  });
  db.queue("instagram_accounts", "update", { data: null, error: null });
  db.queue("instagram_webhook_events", "delete", { data: null, error: null });

  const { fetchFn } = fetchSubscribedFieldsRoute(["comments", "messages"]);
  const decryptToken = (t: string) => Promise.resolve(`plain:${t}`);

  const handler = createInstagramAutomationCronHandler(baseDeps(db, { fetchFn, decryptToken }));
  const response = await handler(
    new Request("https://example.test/instagram-automation-cron", {
      headers: { "x-cron-secret": CRON_SECRET },
    }),
  );

  assertEquals(response.status, 200);
  assertEquals(await readJson(response), { ok: true, failed: 0 });

  const acctUpdates = callsFor(db, "instagram_accounts", "update");
  assertEquals(acctUpdates.length, 1);
  assertEquals(acctUpdates[0].payload, { comments_subscribed_at: FIXED_NOW.toISOString() });

  assertEquals(callsFor(db, "notifications", "select").length, 0);
  assertEquals(rpcCallsFor(db, "insert_notification_batch").length, 0);
});

Deno.test("instagram-automation-cron: sem automações ativas -> fase de re-check nem consulta instagram_accounts", async () => {
  const db = createSupabaseQueryMock();
  queueEmptyRun(db);

  const handler = createInstagramAutomationCronHandler(baseDeps(db));
  await handler(
    new Request("https://example.test/instagram-automation-cron", {
      headers: { "x-cron-secret": CRON_SECRET },
    }),
  );

  assertEquals(callsFor(db, "instagram_accounts", "select").length, 0);
});

Deno.test("instagram-automation-cron: re-check filtra authorization_status='active' -- conta com token expirado não é buscada/reverificada", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("fail_ineligible_automation_sends", { data: 0, error: null });
  db.queue("instagram_webhook_events", "select", { data: [], error: null });
  db.queueRpc("sweep_pending_instagram_automation_links", { data: 0, error: null });
  db.queueRpc("claim_retryable_automation_sends", { data: [], error: null });
  db.queue("instagram_comment_automations", "select", {
    data: [{ client_id: CLIENT_ID, conta_id: CONTA_ID }],
    error: null,
  });
  // Com o filtro authorization_status='active' aplicado, uma conta com token
  // expirado/revogado nunca volta nessa query -- mesmo tendo
  // comments_subscribed_at velho. baseDeps() já usa fetchFn/decryptToken
  // "unreachable": se o código tentasse reverificá-la mesmo assim, o teste
  // capturaria isso via failed=1 (fetchSubscribedFields nunca deve rodar).
  db.queue("instagram_accounts", "select", { data: [], error: null });
  db.queue("instagram_webhook_events", "delete", { data: null, error: null });

  const handler = createInstagramAutomationCronHandler(baseDeps(db));
  const response = await handler(
    new Request("https://example.test/instagram-automation-cron", {
      headers: { "x-cron-secret": CRON_SECRET },
    }),
  );

  assertEquals(response.status, 200);
  assertEquals(await readJson(response), { ok: true, failed: 0 });

  const acctSelects = callsFor(db, "instagram_accounts", "select");
  assertEquals(acctSelects.length, 1);
  assert(
    hasModifier(acctSelects[0], "eq", ["authorization_status", "active"]),
    "re-check deveria filtrar authorization_status='active' (consistente com a tripla de aptidão usada no resto do módulo)",
  );
});

// ══════════════════════════════ Fase 2: fail_ineligible ═══════════════════

Deno.test("instagram-automation-cron: fail_ineligible_automation_sends com erro não aborta as fases seguintes", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("fail_ineligible_automation_sends", { data: null, error: { message: "rpc indisponível" } });
  db.queue("instagram_webhook_events", "select", { data: [], error: null });
  db.queueRpc("sweep_pending_instagram_automation_links", { data: 0, error: null });
  db.queueRpc("claim_retryable_automation_sends", { data: [], error: null });
  db.queue("instagram_comment_automations", "select", { data: [], error: null });
  db.queue("instagram_webhook_events", "delete", { data: null, error: null });
  db.queue("cron_failures", "insert", { data: null, error: null });

  const handler = createInstagramAutomationCronHandler(baseDeps(db));
  const response = await handler(
    new Request("https://example.test/instagram-automation-cron", {
      headers: { "x-cron-secret": CRON_SECRET },
    }),
  );

  assertEquals(response.status, 200);
  const body = await readJson(response);
  assertEquals(body.ok, true);
  assert(body.failed >= 1);

  // As fases seguintes rodaram mesmo com a fase 2 falhando.
  assertEquals(callsFor(db, "instagram_webhook_events", "select").length, 1);
  assertEquals(rpcCallsFor(db, "claim_retryable_automation_sends").length, 1);
  assertEquals(callsFor(db, "instagram_webhook_events", "delete").length, 1);
});

// Contraparte POSITIVA do teste acima: prova que o `media_id` devolvido por
// `claim_retryable_automation_sends` chega intacto até a revalidação de alvo.
// Se ele se perdesse no caminho (chegando `undefined`), todo retry de automação
// específica viraria skipped/target_changed sem nenhum teste ficar vermelho.
Deno.test("instagram-automation-cron: retry claimado cujo media_id CASA o alvo específico -> prossegue e manda a DM", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("fail_ineligible_automation_sends", { data: 0, error: null });
  db.queueRpc("sweep_pending_instagram_automation_links", { data: 0, error: null });
  db.queue("instagram_webhook_events", "select", { data: [], error: null });
  db.queueRpc("claim_retryable_automation_sends", {
    data: [claimedSendFixture({ media_id: MEDIA_ID })],
    error: null,
  });
  db.queue("instagram_comment_automations", "select", {
    data: {
      ativo: true,
      dm_message: "msg",
      public_reply: null,
      client_id: CLIENT_ID,
      ig_media_id: MEDIA_ID, // específica DO MESMO post do comentário
      workflow_post_id: null,
    },
    error: null,
  });
  db.queue("instagram_accounts", "select", { data: { id: ACCOUNT_ROW_ID }, error: null }); // aptidão
  db.queueRpc("mark_automation_dm_sent", { data: true, error: null });
  db.queue("instagram_automation_sends", "update", { data: null, error: null }); // fechamento
  db.queue("instagram_comment_automations", "select", { data: [], error: null }); // fase 6 (re-check), vazia
  db.queue("instagram_webhook_events", "delete", { data: null, error: null });

  const dmCalls: string[] = [];
  const fetchFn = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if ((init?.method ?? "GET").toUpperCase() !== "POST" || !url.includes("/messages")) {
      throw new Error(`fetch não mapeado no teste: ${url}`);
    }
    dmCalls.push(url);
    return new Response(JSON.stringify({ message_id: "m1" }), { status: 200 });
  }) as unknown as typeof fetch;

  const handler = createInstagramAutomationCronHandler(
    baseDeps(db, { fetchFn, decryptToken: (t: string) => Promise.resolve(`plain:${t}`) }),
  );
  const response = await handler(
    new Request("https://example.test/instagram-automation-cron", {
      headers: { "x-cron-secret": CRON_SECRET },
    }),
  );

  assertEquals(response.status, 200);
  assertEquals(await readJson(response), { ok: true, failed: 0 });

  assertEquals(dmCalls.length, 1, "a DM do retry precisa sair quando o alvo casa");
  assertEquals(rpcCallsFor(db, "mark_automation_dm_sent").length, 1);
  const sendUpdates = callsFor(db, "instagram_automation_sends", "update");
  assertEquals(sendUpdates.length, 1);
  assertEquals(sendUpdates[0].payload, { status: "sent" });
});

// ═══════════════════ Fase 4: sweep de eventos órfãos ══════════════════════

Deno.test("instagram-automation-cron: sweep encontra evento órfão -> reprocessa via processDelivery (idempotente)", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("fail_ineligible_automation_sends", { data: 0, error: null });
  db.queue("instagram_webhook_events", "select", {
    data: [
      {
        id: "row-orfao-1",
        delivery_id: "delivery-1",
        ig_user_id: "ig-user-1",
        comment_id: "comment-orfao",
        raw: { field: "comments", value: { id: "comment-orfao", from: { id: "c1" }, text: "oi", created_time: 1755172800 } },
      },
    ],
    error: null,
  });
  // processDelivery: zero contas candidatas -> stamp processed direto.
  db.queue("instagram_accounts", "select", { data: [], error: null });
  db.queue("instagram_webhook_events", "update", { data: null, error: null });
  db.queueRpc("sweep_pending_instagram_automation_links", { data: 0, error: null });
  db.queueRpc("claim_retryable_automation_sends", { data: [], error: null });
  db.queue("instagram_comment_automations", "select", { data: [], error: null });
  db.queue("instagram_webhook_events", "delete", { data: null, error: null });

  const handler = createInstagramAutomationCronHandler(baseDeps(db));
  const response = await handler(
    new Request("https://example.test/instagram-automation-cron", {
      headers: { "x-cron-secret": CRON_SECRET },
    }),
  );

  assertEquals(response.status, 200);
  assertEquals(await readJson(response), { ok: true, failed: 0 });

  // Prova que processDelivery rodou sobre a linha varrida: consultou candidatos
  // e carimbou processed_at (única forma de chegar nesse update com o mock
  // vazio de instagram_accounts).
  assertEquals(callsFor(db, "instagram_accounts", "select").length, 1);
  const stamps = callsFor(db, "instagram_webhook_events", "update");
  assertEquals(stamps.length, 1);
  assert("processed_at" in (stamps[0].payload as Record<string, unknown>));
});

Deno.test("instagram-automation-cron: sweep filtra processed_at IS NULL e received_at < now - 10min, limit 50", async () => {
  const db = createSupabaseQueryMock();
  queueEmptyRun(db);

  const handler = createInstagramAutomationCronHandler(baseDeps(db));
  await handler(
    new Request("https://example.test/instagram-automation-cron", {
      headers: { "x-cron-secret": CRON_SECRET },
    }),
  );

  const sweepCalls = callsFor(db, "instagram_webhook_events", "select");
  assertEquals(sweepCalls.length, 1);
  const cutoff = new Date(FIXED_NOW.getTime() - 10 * 60 * 1000).toISOString();
  assert(hasModifier(sweepCalls[0], "is", ["processed_at", null]));
  assert(hasModifier(sweepCalls[0], "lt", ["received_at", cutoff]));
  assert(hasModifier(sweepCalls[0], "limit", [50]));
});

// ═══════════════════ Fase 3: sweep de convergência dos vínculos ════════════

Deno.test("instagram-automation-cron: sweep de convergência chama a RPC de vínculo e loga o count", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("fail_ineligible_automation_sends", { data: 0, error: null });
  db.queue("instagram_webhook_events", "select", { data: [], error: null });
  db.queueRpc("sweep_pending_instagram_automation_links", { data: 3, error: null });
  db.queueRpc("claim_retryable_automation_sends", { data: [], error: null });
  db.queue("instagram_comment_automations", "select", { data: [], error: null });
  db.queue("instagram_webhook_events", "delete", { data: null, error: null });

  const handler = createInstagramAutomationCronHandler(baseDeps(db));
  const response = await handler(
    new Request("https://example.test/instagram-automation-cron", {
      headers: { "x-cron-secret": CRON_SECRET },
    }),
  );

  assertEquals(response.status, 200);
  assertEquals(await readJson(response), { ok: true, failed: 0 });
  assertEquals(rpcCallsFor(db, "sweep_pending_instagram_automation_links").length, 1);
});

Deno.test("instagram-automation-cron: sweep de convergência com erro não aborta o run nem as fases seguintes", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("fail_ineligible_automation_sends", { data: 0, error: null });
  db.queue("instagram_webhook_events", "select", { data: [], error: null });
  db.queueRpc("sweep_pending_instagram_automation_links", { data: null, error: { message: "rpc indisponível" } });
  db.queueRpc("claim_retryable_automation_sends", { data: [], error: null });
  db.queue("instagram_comment_automations", "select", { data: [], error: null });
  db.queue("instagram_webhook_events", "delete", { data: null, error: null });
  db.queue("cron_failures", "insert", { data: null, error: null });

  const handler = createInstagramAutomationCronHandler(baseDeps(db));
  const response = await handler(
    new Request("https://example.test/instagram-automation-cron", {
      headers: { "x-cron-secret": CRON_SECRET },
    }),
  );

  assertEquals(response.status, 200);
  const body = await readJson(response);
  assertEquals(body.ok, true);
  assert(body.failed >= 1);

  assertEquals(rpcCallsFor(db, "claim_retryable_automation_sends").length, 1);
  assertEquals(callsFor(db, "instagram_webhook_events", "delete").length, 1);
});

Deno.test("instagram-automation-cron: retry claimado cuja automação trocou de alvo -> skipped/target_changed", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("fail_ineligible_automation_sends", { data: 0, error: null });
  db.queue("instagram_webhook_events", "select", { data: [], error: null });
  db.queueRpc("sweep_pending_instagram_automation_links", { data: 0, error: null });
  // O send foi claimado com a mídia do comentário original; a automação, nesse
  // meio tempo, virou específica de OUTRO post.
  db.queueRpc("claim_retryable_automation_sends", {
    data: [claimedSendFixture({ media_id: "media-antiga" })],
    error: null,
  });
  db.queue("instagram_comment_automations", "select", {
    data: {
      ativo: true,
      dm_message: "msg",
      public_reply: null,
      client_id: CLIENT_ID,
      ig_media_id: MEDIA_ID,
      workflow_post_id: null,
    },
    error: null,
  });
  db.queue("instagram_comment_automations", "select", { data: [], error: null }); // fase 6 (re-check), vazia
  db.queue("instagram_automation_sends", "update", { data: null, error: null });
  db.queue("instagram_webhook_events", "delete", { data: null, error: null });

  // fetchFn/decryptToken continuam `unreachable`: nenhuma DM pode sair aqui.
  const handler = createInstagramAutomationCronHandler(baseDeps(db));
  const response = await handler(
    new Request("https://example.test/instagram-automation-cron", {
      headers: { "x-cron-secret": CRON_SECRET },
    }),
  );

  assertEquals(response.status, 200);
  assertEquals(await readJson(response), { ok: true, failed: 0 });

  const sendUpdates = callsFor(db, "instagram_automation_sends", "update");
  assertEquals(sendUpdates.length, 1);
  assertEquals(sendUpdates[0].payload, { status: "skipped", skip_reason: "target_changed" });
  assert(hasModifier(sendUpdates[0], "eq", ["id", SEND_ID]));
});

// ══════════════════════════════ Fase 7: purge ══════════════════════════════

Deno.test("instagram-automation-cron: purge apaga processed_at IS NOT NULL e received_at < now - 30 dias", async () => {
  const db = createSupabaseQueryMock();
  queueEmptyRun(db);

  const handler = createInstagramAutomationCronHandler(baseDeps(db));
  await handler(
    new Request("https://example.test/instagram-automation-cron", {
      headers: { "x-cron-secret": CRON_SECRET },
    }),
  );

  const purgeCalls = callsFor(db, "instagram_webhook_events", "delete");
  assertEquals(purgeCalls.length, 1);
  const cutoff = new Date(FIXED_NOW.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  assert(hasModifier(purgeCalls[0], "not", ["processed_at", "is", null]));
  assert(hasModifier(purgeCalls[0], "lt", ["received_at", cutoff]));
});

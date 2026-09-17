import { assert, assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createHubPostHistoryHandler, sanitizeHistoryApprovals, sanitizeHistoryEvents } from "../hub-post-history/handler.ts";

const now = () => "2026-09-17T12:00:00.000Z";
const buildCorsHeaders = () => ({ "Access-Control-Allow-Origin": "https://hub.mesaas.com" });

function makeHandler(db: ReturnType<typeof createSupabaseQueryMock>, rateLimit = async () => true) {
  return createHubPostHistoryHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
    rateLimit,
  });
}

function queueOwnedPost(db: ReturnType<typeof createSupabaseQueryMock>) {
  db.queue("client_hub_tokens", "select", { data: { cliente_id: 14, conta_id: "conta-1", is_active: true }, error: null });
  db.queue("workflow_posts", "select", { data: { id: 99, cliente_id: 14, conta_id: "conta-1" }, error: null });
}

const rawEvents = [
  // internal move before the first send: must be dropped by the floor (and by the allowlist)
  { id: 1, from_status: "rascunho", to_status: "revisao_interna", source: "workspace_user", actor_user_id: "u-1", actor_name: "Ana da Agência", post_approval_id: null, created_at: "2026-09-01T10:00:00.000Z", from_custom_status_id: null, to_custom_status_id: null, from_custom_nome: null, to_custom_nome: null, snapshot_conteudo_plain: null, snapshot_ig_caption: null },
  // first send (from an internal status): kept, from_status hidden, snapshot exposed
  { id: 2, from_status: "aprovado_interno", to_status: "enviado_cliente", source: "workspace_user", actor_user_id: "u-1", actor_name: "Ana da Agência", post_approval_id: null, created_at: "2026-09-02T10:00:00.000Z", from_custom_status_id: null, to_custom_status_id: null, from_custom_nome: null, to_custom_nome: null, snapshot_conteudo_plain: "texto v1", snapshot_ig_caption: "legenda v1" },
  // custom-status-only move: from = to, must be dropped
  { id: 3, from_status: "enviado_cliente", to_status: "enviado_cliente", source: "workspace_user", actor_user_id: "u-1", actor_name: "Ana da Agência", post_approval_id: null, created_at: "2026-09-02T11:00:00.000Z", from_custom_status_id: null, to_custom_status_id: "cs-1", from_custom_nome: null, to_custom_nome: "Em revisão do cliente", snapshot_conteudo_plain: null, snapshot_ig_caption: null },
  // client correction, linked to an approval
  { id: 4, from_status: "enviado_cliente", to_status: "correcao_cliente", source: "client", actor_user_id: null, actor_name: null, post_approval_id: 501, created_at: "2026-09-03T09:00:00.000Z", from_custom_status_id: null, to_custom_status_id: null, from_custom_nome: null, to_custom_nome: null, snapshot_conteudo_plain: null, snapshot_ig_caption: null },
  // team moves the post back to an internal status: to_status not visible, dropped
  { id: 5, from_status: "correcao_cliente", to_status: "revisao_interna", source: "workspace_user", actor_user_id: "u-2", actor_name: "Bia", post_approval_id: null, created_at: "2026-09-03T10:00:00.000Z", from_custom_status_id: null, to_custom_status_id: null, from_custom_nome: null, to_custom_nome: null, snapshot_conteudo_plain: null, snapshot_ig_caption: null },
  // cron publishes
  { id: 6, from_status: "agendado", to_status: "postado", source: "system", actor_user_id: null, actor_name: null, post_approval_id: null, created_at: "2026-09-05T10:00:00.000Z", from_custom_status_id: null, to_custom_status_id: null, from_custom_nome: null, to_custom_nome: null, snapshot_conteudo_plain: null, snapshot_ig_caption: null },
];

Deno.test("sanitizeHistoryEvents applies allowlist, floor, from=to drop, and hides actors", () => {
  const events = sanitizeHistoryEvents(rawEvents);
  assertEquals(events.map((e) => e.id), [2, 4, 6]);
  assertEquals(events[0], {
    id: 2,
    to_status: "enviado_cliente",
    source: "team",
    created_at: "2026-09-02T10:00:00.000Z",
    post_approval_id: null,
    snapshot: { conteudo_plain: "texto v1", ig_caption: "legenda v1" },
  });
  assertEquals(events[1].source, "client");
  assertEquals(events[1].post_approval_id, 501);
  assertEquals(events[1].snapshot, null);
  assertEquals(events[2].source, "system");
  for (const ev of events) {
    assert(!("from_status" in ev), "from_status must not leak");
    assert(!("actor_name" in ev), "actor_name must not leak");
    assert(!("actor_user_id" in ev), "actor_user_id must not leak");
    assert(!("to_custom_nome" in ev), "custom status names must not leak");
  }
});

Deno.test("sanitizeHistoryEvents returns nothing when the post was never sent to the client", () => {
  assertEquals(sanitizeHistoryEvents([rawEvents[0], rawEvents[4]]), []);
});

const rawApprovals = [
  // team note written on the CRM Mensagens page BEFORE the first send: must be dropped
  // (team mensagem), and NOT because of any floor
  { id: 500, action: "mensagem", comentario: "Ana, revisa o CTA antes de enviar", motivo: null, is_workspace_user: true, token: null, author_user_id: "u-1", created_at: "2026-09-01T12:00:00.000Z" },
  { id: 501, action: "correcao", comentario: "Trocar a foto", motivo: "imagem_video", is_workspace_user: false, token: "hub-123", author_user_id: null, created_at: "2026-09-03T09:00:00.000Z" },
  // team reply via replyToPostApproval: internal, never shown to the client
  { id: 502, action: "mensagem", comentario: "Cliente reclamou de novo, alguém olha?", motivo: null, is_workspace_user: true, token: null, author_user_id: "u-2", created_at: "2026-09-05T11:00:00.000Z" },
  // client comment from the new composer: kept
  { id: 503, action: "mensagem", comentario: "Ficou ótimo", motivo: null, is_workspace_user: false, token: "hub-123", author_user_id: null, created_at: "2026-09-05T12:00:00.000Z" },
];

Deno.test("sanitizeHistoryApprovals drops team-authored mensagem rows, keeps client rows regardless of date, and hides token/author", () => {
  const approvals = sanitizeHistoryApprovals(rawApprovals);
  assertEquals(approvals.map((a) => a.id), [501, 503]);
  assertEquals(approvals[1], {
    id: 503,
    action: "mensagem",
    comentario: "Ficou ótimo",
    motivo: null,
    is_workspace_user: false,
    created_at: "2026-09-05T12:00:00.000Z",
  });
  for (const a of approvals) {
    assert(!("token" in a), "token must not leak");
    assert(!("author_user_id" in a), "author_user_id must not leak");
  }
});

Deno.test("sanitizeHistoryApprovals keeps client approvals for a post that has no send event (no floor on approvals)", () => {
  const onlyClientRows = [rawApprovals[1], rawApprovals[3]];
  assertEquals(sanitizeHistoryApprovals(onlyClientRows).map((a) => a.id), [501, 503]);
});

Deno.test("hub-post-history returns sanitized events and approvals for an owned post", async () => {
  const db = createSupabaseQueryMock();
  queueOwnedPost(db);
  db.queue("post_status_events", "select", { data: rawEvents, error: null });
  db.queue("post_approvals", "select", { data: rawApprovals, error: null });

  const response = await makeHandler(db)(new Request("https://example.test/hub-post-history?token=hub-123&post_id=99"));
  const body = await readJson(response);

  assertEquals(response.status, 200);
  assertEquals(body.events.map((e: { id: number }) => e.id), [2, 4, 6]);
  assertEquals(body.approvals.map((a: { id: number }) => a.id), [501, 503]);
  assertEquals(body.approvals[0].motivo, "imagem_video");
  assert(!body.approvals.some((a: { is_workspace_user: boolean; action: string }) => a.action === "mensagem" && a.is_workspace_user), "team messages must not leak");
  assert(!("token" in body.approvals[0]), "token must not leak");
  assert(!("author_user_id" in body.approvals[0]), "author_user_id must not leak");

  const eventsQuery = db.calls.find((c) => c.table === "post_status_events");
  assert(eventsQuery);
  assertEquals(eventsQuery.modifiers.find((m) => m.method === "eq")?.args, ["post_id", 99]);
  const approvalsQuery = db.calls.find((c) => c.table === "post_approvals");
  assert(approvalsQuery);
  assertEquals(approvalsQuery.selectArgs[0], ["id, action, comentario, motivo, is_workspace_user, created_at"]);
});

Deno.test("hub-post-history returns 403 for a post owned by another client and reads no history", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: { cliente_id: 14, conta_id: "conta-1", is_active: true }, error: null });
  db.queue("workflow_posts", "select", { data: { id: 99, cliente_id: 999, conta_id: "conta-1" }, error: null });

  const response = await makeHandler(db)(new Request("https://example.test/hub-post-history?token=hub-123&post_id=99"));
  assertEquals(response.status, 403);
  assert(!db.calls.some((c) => c.table === "post_status_events" || c.table === "post_approvals"));
});

Deno.test("hub-post-history returns 403 for a post in another workspace", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: { cliente_id: 14, conta_id: "conta-1", is_active: true }, error: null });
  db.queue("workflow_posts", "select", { data: { id: 99, cliente_id: 14, conta_id: "conta-2" }, error: null });

  const response = await makeHandler(db)(new Request("https://example.test/hub-post-history?token=hub-123&post_id=99"));
  assertEquals(response.status, 403);
});

Deno.test("hub-post-history returns 404 for an unknown post", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: { cliente_id: 14, conta_id: "conta-1", is_active: true }, error: null });
  db.queue("workflow_posts", "select", { data: null, error: null });
  const response = await makeHandler(db)(new Request("https://example.test/hub-post-history?token=hub-123&post_id=99"));
  assertEquals(response.status, 404);
});

Deno.test("hub-post-history returns 404 for an invalid token", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: null, error: null });
  const response = await makeHandler(db)(new Request("https://example.test/hub-post-history?token=expired&post_id=99"));
  assertEquals(response.status, 404);
});

Deno.test("hub-post-history rejects a non-numeric post_id and a missing token with 400", async () => {
  const db = createSupabaseQueryMock();
  assertEquals((await makeHandler(db)(new Request("https://example.test/hub-post-history?token=hub-123&post_id=abc"))).status, 400);
  assertEquals((await makeHandler(db)(new Request("https://example.test/hub-post-history?post_id=1"))).status, 400);
});

Deno.test("hub-post-history rejects POST with 405", async () => {
  const db = createSupabaseQueryMock();
  const response = await makeHandler(db)(new Request("https://example.test/hub-post-history?token=hub-123&post_id=99", { method: "POST" }));
  assertEquals(response.status, 405);
});

Deno.test("hub-post-history returns 429 when the read rate limit trips", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: { cliente_id: 14, conta_id: "conta-1", is_active: true }, error: null });
  const response = await makeHandler(db, async () => false)(new Request("https://example.test/hub-post-history?token=hub-123&post_id=99"));
  assertEquals(response.status, 429);
});

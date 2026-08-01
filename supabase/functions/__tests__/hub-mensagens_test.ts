import { assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createHubMensagensHandler } from "../hub-mensagens/handler.ts";

const buildCorsHeaders = () => ({ "Access-Control-Allow-Origin": "https://app.mesaas.com" });

function makeHandler(db: ReturnType<typeof createSupabaseQueryMock>) {
  return createHubMensagensHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now: () => "2026-07-31T12:00:00.000Z",
  });
}

// resolveHubToken hits client_hub_tokens + effective_plan_feature (feature_hub_portal),
// then the handler checks effective_plan_feature (feature_mensagens) itself.
function setupToken(db: ReturnType<typeof createSupabaseQueryMock>, mensagensOn = true) {
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queueRpc("effective_plan_feature", { data: true, error: null });
  db.queueRpc("effective_plan_feature", { data: mensagensOn, error: null });
}

const FEED_ROW = {
  source: "post_feedback", item_id: 1, cliente_id: 14, cliente_nome: "ACME",
  post_id: 7, workflow_id: 3, post_titulo: "Post de julho",
  action: "mensagem", content: "Oi!", is_workspace_user: true,
  author_user_id: "u-1", author_name: "Ana", author_avatar_url: null,
  created_at: "2026-07-30T10:00:00.000Z",
};

Deno.test("hub-mensagens: invalid token returns 404", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: null, error: null });
  const res = await makeHandler(db)(new Request("https://x.test/hub-mensagens?token=bad"));
  assertEquals(res.status, 404);
});

Deno.test("hub-mensagens: feature_mensagens off returns 403", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db, false);
  const res = await makeHandler(db)(new Request("https://x.test/hub-mensagens?token=t"));
  assertEquals(res.status, 403);
});

Deno.test("hub-mensagens: GET returns feed items + unread", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queueRpc("get_mensagens_feed", { data: [FEED_ROW], error: null });
  db.queueRpc("get_mensagens_unread", { data: [{ cliente_id: 14, unread_count: 2 }], error: null });
  const res = await makeHandler(db)(new Request("https://x.test/hub-mensagens?token=t"));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.items.length, 1);
  assertEquals(body.unread, 2);

  // Assert tenant scoping: verify RPC calls include correct account/client ids from token
  const feedCall = db.calls.find((c) => c.table === "rpc:get_mensagens_feed");
  assertEquals(feedCall?.payload?.p_conta_id, "conta-1");
  assertEquals(feedCall?.payload?.p_cliente_id, 14);

  const unreadCall = db.calls.find((c) => c.table === "rpc:get_mensagens_unread");
  assertEquals(unreadCall?.payload?.p_conta_id, "conta-1");
  assertEquals(unreadCall?.payload?.p_cliente_id, 14);
});

Deno.test("hub-mensagens: GET forwards the composite cursor to get_mensagens_feed", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queueRpc("get_mensagens_feed", { data: [FEED_ROW], error: null });
  db.queueRpc("get_mensagens_unread", { data: [{ cliente_id: 14, unread_count: 2 }], error: null });
  const res = await makeHandler(db)(
    new Request(
      "https://x.test/hub-mensagens?token=t&before=2026-07-30T10:00:00.000Z&before_source=post_feedback&before_item_id=1",
    ),
  );
  assertEquals(res.status, 200);

  const feedCall = db.calls.find((c) => c.table === "rpc:get_mensagens_feed");
  assertEquals(feedCall?.payload?.p_before, "2026-07-30T10:00:00.000Z");
  assertEquals(feedCall?.payload?.p_before_source, "post_feedback");
  assertEquals(feedCall?.payload?.p_before_item_id, 1);
});

Deno.test("hub-mensagens: GET with count=1 returns only unread", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queueRpc("get_mensagens_unread", { data: [{ cliente_id: 14, unread_count: 5 }], error: null });
  const res = await makeHandler(db)(new Request("https://x.test/hub-mensagens?token=t&count=1"));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.unread, 5);
});

Deno.test("hub-mensagens: POST requires content", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  const res = await makeHandler(db)(new Request("https://x.test/hub-mensagens", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "t", content: "   " }),
  }));
  assertEquals(res.status, 400);
});

Deno.test("hub-mensagens: POST inserts a general message scoped to the token's cliente", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queue("mensagens", "insert", { data: { id: 9 }, error: null });
  const res = await makeHandler(db)(new Request("https://x.test/hub-mensagens", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "t", content: "Olá equipe!" }),
  }));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.ok, true);

  // Assert tenant scoping: verify insert payload uses token-resolved account/client ids, not request body
  const insertCall = db.calls.find((c) => c.table === "mensagens" && c.operation === "insert");
  assertEquals(insertCall?.payload, {
    conta_id: "conta-1",
    cliente_id: 14,
    content: "Olá equipe!",
    is_workspace_user: false,
  });
});

Deno.test("hub-mensagens: POST /seen marks the cliente marker", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queueRpc("mark_mensagens_seen", { data: null, error: null });
  const res = await makeHandler(db)(new Request("https://x.test/hub-mensagens/seen", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "t" }),
  }));
  assertEquals(res.status, 200);
});

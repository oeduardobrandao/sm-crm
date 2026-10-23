import { assert, assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createHubMediaNotesHandler } from "../hub-media-notes/handler.ts";

const now = () => "2026-10-23T12:00:00.000Z";
const buildCorsHeaders = () => ({ "Access-Control-Allow-Origin": "https://hub.mesaas.com" });

function setup(opts: { validToken?: boolean; limiter?: (key: string) => boolean } = {}) {
  const db = createSupabaseQueryMock();
  if (opts.validToken !== false) {
    db.queue("client_hub_tokens", "select", {
      data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
      error: null,
    });
  }
  const keys: string[] = [];
  const handler = createHubMediaNotesHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
    rateLimit: (_db, key) => {
      keys.push(key);
      return Promise.resolve(opts.limiter ? opts.limiter(key) : true);
    },
  });
  return { db, keys, handler };
}

function post(body: unknown) {
  return new Request("https://example.test/hub-media-notes", { method: "POST", body: JSON.stringify(body) });
}

const rpcCalls = (db: ReturnType<typeof createSupabaseQueryMock>, name: string) =>
  db.calls.filter((c) => c.table === `rpc:${name}`);

const CREATE = { token: "hub-123", op: "create", post_id: 99, link_id: 41, body: "  Trocar a cor  " };

Deno.test("hub-media-notes create calls hub_create_media_note with token-derived conta and cliente", async () => {
  const { db, handler } = setup();
  db.queueRpc("hub_create_media_note", { data: 7, error: null });
  const res = await handler(post({ ...CREATE, t_seconds: 12.5, x: 0.25, y: 0.5, conta_id: "evil", cliente_id: 1 }));
  assertEquals(res.status, 200);
  assertEquals(await readJson(res), { ok: true, note_id: 7 });
  const [call] = rpcCalls(db, "hub_create_media_note");
  assertEquals(call.payload, {
    p_conta_id: "conta-1",
    p_cliente_id: 14,
    p_token: "hub-123",
    p_post_id: 99,
    p_link_id: 41,
    p_t_seconds: 12.5,
    p_x: 0.25,
    p_y: 0.5,
    p_body: "Trocar a cor",
  });
  assert(!("p_file_id" in (call.payload as object)), "client never sends a file id");
  const notif = rpcCalls(db, "create_post_approval_notification");
  assertEquals(notif.length, 1);
  assertEquals(notif[0].payload, { p_post_id: 99, p_action: "mensagem", p_comentario: "Trocar a cor" });
});

Deno.test("hub-media-notes create sends null anchors when omitted", async () => {
  const { db, handler } = setup();
  db.queueRpc("hub_create_media_note", { data: 8, error: null });
  const res = await handler(post(CREATE));
  assertEquals(res.status, 200);
  const payload = rpcCalls(db, "hub_create_media_note")[0].payload as Record<string, unknown>;
  assertEquals([payload.p_t_seconds, payload.p_x, payload.p_y], [null, null, null]);
});

Deno.test("hub-media-notes create never debits hub-read", async () => {
  const { db, keys, handler } = setup();
  db.queueRpc("hub_create_media_note", { data: 7, error: null });
  await handler(post(CREATE));
  assertEquals(keys, ["hub-write:hub-media-notes:conta-1:14"]);
  assert(!keys.some((k) => k.startsWith("hub-read:")));
});

Deno.test("hub-media-notes write limit is 60 per hour and 429s when exceeded", async () => {
  const seen: Array<[string, number, number]> = [];
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: { cliente_id: 14, conta_id: "conta-1", is_active: true }, error: null });
  const handler = createHubMediaNotesHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
    rateLimit: (_d, key, max, win) => {
      seen.push([key, max, win]);
      return Promise.resolve(false);
    },
  });
  const res = await handler(post(CREATE));
  assertEquals(res.status, 429);
  assertEquals(seen, [["hub-write:hub-media-notes:conta-1:14", 60, 3600]]);
  assertEquals(rpcCalls(db, "hub_create_media_note").length, 0);
});

Deno.test("hub-media-notes post_not_visible maps to 400", async () => {
  const { db, handler } = setup();
  db.queueRpc("hub_create_media_note", { data: null, error: { message: "post_not_visible" } });
  const res = await handler(post(CREATE));
  assertEquals(res.status, 400);
  assertEquals((await readJson(res)).error, "Post ainda não foi enviado para o cliente.");
  assertEquals(rpcCalls(db, "create_post_approval_notification").length, 0);
});

Deno.test("hub-media-notes note_not_found maps to 404", async () => {
  const { db, handler } = setup();
  db.queueRpc("hub_add_media_note_reply", { data: null, error: { message: "note_not_found" } });
  const res = await handler(post({ token: "hub-123", op: "reply", note_id: 5, body: "Ok" }));
  assertEquals(res.status, 404);
  assertEquals((await readJson(res)).error, "Post não encontrado.");
});

Deno.test("hub-media-notes post_not_found maps to 404, link_not_on_post and invalid_anchor to 400", async () => {
  for (const [code, status, msg] of [
    ["post_not_found", 404, "Post não encontrado."],
    ["link_not_on_post", 400, "Dados inválidos."],
    ["invalid_anchor", 400, "Dados inválidos."],
  ] as const) {
    const { db, handler } = setup();
    db.queueRpc("hub_create_media_note", { data: null, error: { message: code } });
    const res = await handler(post(CREATE));
    assertEquals(res.status, status, code);
    assertEquals((await readJson(res)).error, msg, code);
  }
});

Deno.test("hub-media-notes unknown rpc error is a generic 500 that never leaks detail", async () => {
  const { db, handler } = setup();
  db.queueRpc("hub_create_media_note", { data: null, error: { message: "secret db detail" } });
  const original = console.error;
  console.error = () => {};
  try {
    const res = await handler(post(CREATE));
    assertEquals(res.status, 500);
    const body = await readJson(res);
    assertEquals(body.error, "Erro ao salvar comentário.");
    assert(!JSON.stringify(body).includes("secret"));
  } finally {
    console.error = original;
  }
});

Deno.test("hub-media-notes rejects x without y (and the reverse) with no RPC call", async () => {
  for (const anchor of [{ x: 0.5 }, { y: 0.5 }]) {
    const { db, handler } = setup();
    const res = await handler(post({ ...CREATE, ...anchor }));
    assertEquals(res.status, 400);
    assertEquals((await readJson(res)).error, "Dados inválidos.");
    assertEquals(db.calls.length, 0);
  }
});

Deno.test("hub-media-notes rejects out-of-range and malformed input before any DB call", async () => {
  const bad: Array<Record<string, unknown>> = [
    { x: 1.5, y: 0.5 },
    { x: -0.1, y: 0.5 },
    { x: 0.5, y: "0.5" },
    { t_seconds: -1 },
    { t_seconds: "3" },
    { body: "   " },
    { body: "a".repeat(2001) },
    { body: 42 },
    { post_id: 0 },
    { post_id: 1.5 },
    { link_id: "41" },
    { link_id: -2 },
  ];
  for (const patch of bad) {
    const { db, handler } = setup();
    const res = await handler(post({ ...CREATE, ...patch }));
    assertEquals(res.status, 400, JSON.stringify(patch));
    assertEquals(db.calls.length, 0, JSON.stringify(patch));
  }
  const { db, handler } = setup();
  const res = await handler(post({ token: "hub-123", op: "reply", note_id: 0, body: "oi" }));
  assertEquals(res.status, 400);
  assertEquals(db.calls.length, 0);
});

Deno.test("hub-media-notes rejects unknown op, missing token and bad JSON", async () => {
  const { handler } = setup();
  assertEquals((await handler(post({ ...CREATE, op: "delete" }))).status, 400);
  assertEquals((await handler(post({ ...CREATE, token: "" }))).status, 400);
  const res = await handler(new Request("https://example.test/hub-media-notes", { method: "POST", body: "{nope" }));
  assertEquals(res.status, 400);
  assertEquals((await handler(new Request("https://example.test/x", { method: "GET" }))).status, 405);
});

Deno.test("hub-media-notes reply notifies with action mensagem", async () => {
  const { db, handler } = setup();
  db.queueRpc("hub_add_media_note_reply", { data: 31, error: null });
  db.queue("post_media_notes", "select", { data: { post_id: 99 }, error: null });
  const res = await handler(post({ token: "hub-123", op: "reply", note_id: 5, body: " Combinado " }));
  assertEquals(res.status, 200);
  assertEquals(await readJson(res), { ok: true, reply_id: 31 });
  assertEquals(rpcCalls(db, "hub_add_media_note_reply")[0].payload, {
    p_conta_id: "conta-1",
    p_cliente_id: 14,
    p_token: "hub-123",
    p_note_id: 5,
    p_body: "Combinado",
  });
  const lookup = db.calls.find((c) => c.table === "post_media_notes")!;
  assert(lookup.modifiers.some((m) => m.method === "eq" && m.args[0] === "conta_id" && m.args[1] === "conta-1"));
  const notif = rpcCalls(db, "create_post_approval_notification");
  assertEquals(notif[0].payload, { p_post_id: 99, p_action: "mensagem", p_comentario: "Combinado" });
});

Deno.test("hub-media-notes notification failure only logs", async () => {
  const { db, handler } = setup();
  db.queueRpc("hub_create_media_note", { data: 7, error: null });
  db.queueRpc("create_post_approval_notification", { data: null, error: { message: "boom" } });
  const original = console.error;
  console.error = () => {};
  try {
    const res = await handler(post(CREATE));
    assertEquals(res.status, 200);
    assertEquals((await readJson(res)).note_id, 7);
  } finally {
    console.error = original;
  }
});

Deno.test("hub-media-notes unknown token returns 404 Link inválido and consults the bad-token limiter", async () => {
  const { db, keys, handler } = setup({ validToken: false });
  db.queue("client_hub_tokens", "select", { data: null, error: null });
  const req = new Request("https://example.test/hub-media-notes", {
    method: "POST",
    headers: { "x-forwarded-for": "1.2.3.4" },
    body: JSON.stringify(CREATE),
  });
  const res = await handler(req);
  assertEquals(res.status, 404);
  assertEquals((await readJson(res)).error, "Link inválido.");
  assertEquals(keys.length, 1);
  assert(keys[0].startsWith("hub-badtoken:"));
  assertEquals(rpcCalls(db, "hub_create_media_note").length, 0);
});

Deno.test("hub-media-notes bad-token limiter exceeded returns 429", async () => {
  const { db, handler } = setup({ validToken: false, limiter: () => false });
  db.queue("client_hub_tokens", "select", { data: null, error: null });
  assertEquals((await handler(post(CREATE))).status, 429);
});

Deno.test("hub-media-notes CORS preflight returns 200 with buildCorsHeaders", async () => {
  const { db, handler } = setup({ validToken: false });
  const res = await handler(new Request("https://example.test/hub-media-notes", { method: "OPTIONS" }));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "https://hub.mesaas.com");
  assertEquals(db.calls.length, 0);
});

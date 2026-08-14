// stream-webhook — DI-factory handler tests against the shared supabaseMock (mirrors
// tiktok-webhook_test.ts's convention). deps.verifySignature is injected directly, so these
// tests never touch the real HMAC path (that's covered by stream-shared_test.ts) — only the
// handler's ordering (signature before db), status mapping, and the monotonic settle guard.
import { assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import type { QueryCall } from "../../../test/shared/supabaseMock.ts";
import { createStreamWebhookHandler } from "../stream-webhook/handler.ts";
import type { StreamWebhookDeps } from "../stream-webhook/handler.ts";

type Db = ReturnType<typeof createSupabaseQueryMock>;

function callsFor(db: Db, table: string, operation: string) {
  return db.calls.filter((c: QueryCall) => c.table === table && c.operation === operation);
}

function unreachable(label: string) {
  return () => {
    throw new Error(`must not be called: ${label}`);
  };
}

function baseDeps(db: Db, overrides: Partial<StreamWebhookDeps> = {}): StreamWebhookDeps {
  return {
    createDb: () => db as never,
    verifySignature: (unreachable("verifySignature") as unknown) as StreamWebhookDeps["verifySignature"],
    ...overrides,
  };
}

function webhookRequest(body: string, opts?: { method?: string; signature?: string | null }): Request {
  const method = opts?.method ?? "POST";
  const headers: Record<string, string> = {};
  if (opts?.signature !== null) headers["Webhook-Signature"] = opts?.signature ?? "time=1,sig1=abc";
  return new Request("https://example.test/stream-webhook", {
    method,
    headers,
    ...(method === "GET" || method === "HEAD" ? {} : { body }),
  });
}

function payload(overrides: Partial<{ uid: string; state: string }> = {}) {
  const uid = "uid" in overrides ? overrides.uid : "video-uid-1";
  const body: Record<string, unknown> = {};
  if (uid !== undefined) body.uid = uid;
  body.status = { state: overrides.state ?? "ready" };
  return JSON.stringify(body);
}

// ── method gate ──────────────────────────────────────────────────────────────

Deno.test("stream-webhook: GET is rejected with 405 before signature check or db access", async () => {
  const db = createSupabaseQueryMock();
  const handler = createStreamWebhookHandler(baseDeps(db));

  const response = await handler(webhookRequest(payload(), { method: "GET" }));

  assertEquals(response.status, 405);
  assertEquals(db.calls.length, 0);
});

// ── signature gate ───────────────────────────────────────────────────────────

Deno.test("stream-webhook: bad signature returns 401 with a generic body and never touches the db", async () => {
  const db = createSupabaseQueryMock();
  const body = payload();
  let capturedBody: string | undefined;
  const handler = createStreamWebhookHandler(baseDeps(db, {
    verifySignature: (b) => {
      capturedBody = b;
      return Promise.resolve(false);
    },
  }));

  const response = await handler(webhookRequest(body, { signature: "time=1,sig1=deadbeef" }));

  assertEquals(response.status, 401);
  assertEquals(await response.json(), { error: "invalid signature" });
  assertEquals(db.calls.length, 0, "an invalid signature must never reach the database");
  assertEquals(capturedBody, body, "the exact raw bytes must be handed to verifySignature");
});

Deno.test("stream-webhook: verifySignature receives the header verbatim", async () => {
  const db = createSupabaseQueryMock();
  let capturedHeader: string | null | undefined;
  const handler = createStreamWebhookHandler(baseDeps(db, {
    verifySignature: (_b, header) => {
      capturedHeader = header;
      return Promise.resolve(false);
    },
  }));

  await handler(webhookRequest(payload(), { signature: "time=1700000000,sig1=abcdef" }));

  assertEquals(capturedHeader, "time=1700000000,sig1=abcdef");
});

// ── missing uid / unknown state -> 200 no-op ────────────────────────────────

Deno.test("stream-webhook: missing uid acks 200 and never touches the db", async () => {
  const db = createSupabaseQueryMock();
  const handler = createStreamWebhookHandler(baseDeps(db, { verifySignature: () => Promise.resolve(true) }));

  const response = await handler(webhookRequest(JSON.stringify({ status: { state: "ready" } })));

  assertEquals(response.status, 200);
  assertEquals(db.calls.length, 0);
});

Deno.test("stream-webhook: unrecognized state acks 200 with no db update", async () => {
  const db = createSupabaseQueryMock();
  const handler = createStreamWebhookHandler(baseDeps(db, { verifySignature: () => Promise.resolve(true) }));

  const response = await handler(webhookRequest(payload({ state: "inprogress" })));

  assertEquals(response.status, 200);
  assertEquals(callsFor(db, "files", "update").length, 0);
});

Deno.test("stream-webhook: malformed JSON body acks 200 and never touches the db", async () => {
  const db = createSupabaseQueryMock();
  const handler = createStreamWebhookHandler(baseDeps(db, { verifySignature: () => Promise.resolve(true) }));

  const response = await handler(webhookRequest("{not json"));

  assertEquals(response.status, 200);
  assertEquals(db.calls.length, 0);
});

// ── happy path: ready / error settle via the monotonic update chain ────────

Deno.test("stream-webhook: state:ready updates files with the monotonic pending-guarded chain and returns 200", async () => {
  const db = createSupabaseQueryMock();
  db.queue("files", "update", { data: null, error: null });
  const handler = createStreamWebhookHandler(baseDeps(db, { verifySignature: () => Promise.resolve(true) }));

  const response = await handler(webhookRequest(payload({ uid: "video-uid-1", state: "ready" })));

  assertEquals(response.status, 200);
  const updates = callsFor(db, "files", "update");
  assertEquals(updates.length, 1);
  assertEquals(updates[0].payload, { stream_status: "ready" });
  assertEquals(updates[0].modifiers, [
    { method: "eq", args: ["stream_uid", "video-uid-1"] },
    { method: "eq", args: ["stream_status", "pending"] },
  ]);
});

Deno.test("stream-webhook: state:error maps to stream_status error via the same monotonic chain", async () => {
  const db = createSupabaseQueryMock();
  db.queue("files", "update", { data: null, error: null });
  const handler = createStreamWebhookHandler(baseDeps(db, { verifySignature: () => Promise.resolve(true) }));

  const response = await handler(webhookRequest(payload({ uid: "video-uid-2", state: "error" })));

  assertEquals(response.status, 200);
  const updates = callsFor(db, "files", "update");
  assertEquals(updates.length, 1);
  assertEquals(updates[0].payload, { stream_status: "error" });
  assertEquals(updates[0].modifiers, [
    { method: "eq", args: ["stream_uid", "video-uid-2"] },
    { method: "eq", args: ["stream_status", "pending"] },
  ]);
});

Deno.test("stream-webhook: unknown uid or already-settled row still acks 200 (zero-row update, no error)", async () => {
  const db = createSupabaseQueryMock();
  // The monotonic .eq("stream_status","pending") guard matches zero rows for an unknown uid or
  // an already-settled row — PostgREST reports that as success, not an error.
  db.queue("files", "update", { data: null, error: null });
  const handler = createStreamWebhookHandler(baseDeps(db, { verifySignature: () => Promise.resolve(true) }));

  const response = await handler(webhookRequest(payload({ uid: "no-such-uid", state: "ready" })));

  assertEquals(response.status, 200);
  assertEquals(callsFor(db, "files", "update").length, 1);
});

// ── db failure -> generic 500 ───────────────────────────────────────────────

Deno.test("stream-webhook: a db error on settle returns a generic 500, never the raw error detail", async () => {
  const db = createSupabaseQueryMock();
  db.queue("files", "update", { data: null, error: { message: "connection reset" } });
  const handler = createStreamWebhookHandler(baseDeps(db, { verifySignature: () => Promise.resolve(true) }));

  const response = await handler(webhookRequest(payload({ uid: "video-uid-3", state: "ready" })));

  assertEquals(response.status, 500);
  const responseBody = await response.json();
  assertEquals(responseBody, { error: "Internal server error" });
  assertEquals(JSON.stringify(responseBody).includes("connection reset"), false);
});

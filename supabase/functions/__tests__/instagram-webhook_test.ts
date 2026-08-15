// instagram-webhook (Task 8) — HTTP handler tests: Meta handshake, HMAC signature,
// durable-ack (mirrors tiktok-webhook_test.ts's DI/baseDeps-with-unreachable style against the
// shared supabaseMock). Two invariants get dedicated coverage: (1) the raw event insert is
// AWAITED and durably persisted BEFORE the 200 is returned; (2) processing runs strictly AFTER
// the 200, via the injected waitUntil, never inline.
import { assertEquals } from "./assert.ts";
import { createInstagramWebhookHandler } from "../instagram-webhook/handler.ts";
import type { EventRow, InstagramWebhookDeps } from "../instagram-webhook/handler.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import type { QueryCall } from "../../../test/shared/supabaseMock.ts";

type Db = ReturnType<typeof createSupabaseQueryMock>;

const SECRET = "app-secret";
const VERIFY = "verify-token";

async function sign(body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `sha256=${hex}`;
}

function callsFor(db: Db, table: string, operation: string) {
  return db.calls.filter((c: QueryCall) => c.table === table && c.operation === operation);
}

function unreachable(label: string) {
  return () => {
    throw new Error(`must not be called: ${label}`);
  };
}

// Mirrors tiktok-webhook_test.ts's baseDeps: db-touching/background deps default to
// `unreachable` so a test that doesn't expect them to fire gets a loud failure instead of a
// silently-passing assertion on a call count.
function baseDeps(db: Db, overrides: Partial<InstagramWebhookDeps> = {}): InstagramWebhookDeps {
  return {
    createServiceDb: () => db as never,
    metaAppSecret: SECRET,
    verifyToken: VERIFY,
    waitUntil: (unreachable("waitUntil") as unknown) as InstagramWebhookDeps["waitUntil"],
    processDelivery: (unreachable("processDelivery") as unknown) as InstagramWebhookDeps["processDelivery"],
    randomUUID: () => "fixed-id",
    ...overrides,
  };
}

const BODY = JSON.stringify({
  object: "instagram",
  entry: [{ id: "acc1", time: 1, changes: [{ field: "comments", value: { id: "c1", text: "promo" } }] }],
});

Deno.test("GET handshake: verify_token certo ecoa hub.challenge", async () => {
  const db = createSupabaseQueryMock();
  const handler = createInstagramWebhookHandler(baseDeps(db));

  const res = await handler(
    new Request(`https://x/instagram-webhook?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=42`),
  );

  assertEquals(res.status, 200);
  assertEquals(await res.text(), "42");
  assertEquals(db.calls.length, 0, "the handshake must never touch the database");
});

Deno.test("GET handshake: verify_token errado -> 403 sem corpo", async () => {
  const db = createSupabaseQueryMock();
  const handler = createInstagramWebhookHandler(baseDeps(db));

  const res = await handler(
    new Request("https://x/instagram-webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42"),
  );

  assertEquals(res.status, 403);
  assertEquals(await res.text(), "");
  assertEquals(db.calls.length, 0);
});

Deno.test("POST com assinatura válida: insere linhas normalizadas, 200 vazio, processa depois", async () => {
  const db = createSupabaseQueryMock();
  db.queue("instagram_webhook_events", "insert", { data: null, error: null });

  let bg: Promise<void> | null = null;
  const processed: EventRow[] = [];
  // A macrotask gap (setTimeout, not just a bare Promise.resolve microtask) so the assertion
  // right after `handler()` returns can prove processing genuinely hasn't run yet — mirrors
  // tiktok-webhook_test.ts's "the insert is awaited before the 200" trick.
  const handler = createInstagramWebhookHandler(baseDeps(db, {
    waitUntil: (p: Promise<void>) => {
      bg = p;
    },
    processDelivery: async (_svc, rows) => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      processed.push(...rows);
    },
  }));

  const res = await handler(
    new Request("https://x/instagram-webhook", {
      method: "POST",
      headers: { "X-Hub-Signature-256": await sign(BODY) },
      body: BODY,
    }),
  );

  assertEquals(res.status, 200);
  assertEquals(await res.text(), "");

  const inserts = callsFor(db, "instagram_webhook_events", "insert");
  assertEquals(inserts.length, 1);
  const rows = inserts[0].payload as EventRow[];
  assertEquals(rows.length, 1);
  assertEquals(rows[0].ig_user_id, "acc1");
  assertEquals(rows[0].comment_id, "c1");

  assertEquals(processed.length, 0, "processing must not have run yet — it's still awaiting the setTimeout gap");
  if (bg) await bg;
  assertEquals(processed.length, 1);
  assertEquals(processed[0].comment_id, "c1");
});

Deno.test("POST com assinatura inválida: 401, sem insert, sem processamento", async () => {
  const db = createSupabaseQueryMock();
  const handler = createInstagramWebhookHandler(baseDeps(db)); // waitUntil/processDelivery stay unreachable

  const res = await handler(
    new Request("https://x/instagram-webhook", {
      method: "POST",
      headers: { "X-Hub-Signature-256": "sha256=deadbeef" },
      body: BODY,
    }),
  );

  assertEquals(res.status, 401);
  assertEquals(await res.text(), "");
  assertEquals(db.calls.length, 0, "an invalid signature must never touch the database");
});

Deno.test("POST sem eventos de comentário: 200, sem insert", async () => {
  const db = createSupabaseQueryMock();
  const handler = createInstagramWebhookHandler(baseDeps(db)); // waitUntil/processDelivery stay unreachable

  const body = JSON.stringify({ object: "instagram", entry: [] });
  const res = await handler(
    new Request("https://x/instagram-webhook", {
      method: "POST",
      headers: { "X-Hub-Signature-256": await sign(body) },
      body,
    }),
  );

  assertEquals(res.status, 200);
  assertEquals(await res.text(), "");
  assertEquals(db.calls.length, 0);
});

Deno.test("falha no insert -> 500 (Meta reentrega), sem processamento", async () => {
  const db = createSupabaseQueryMock();
  db.queue("instagram_webhook_events", "insert", { data: null, error: { message: "connection reset" } });
  const handler = createInstagramWebhookHandler(baseDeps(db)); // waitUntil/processDelivery stay unreachable

  const res = await handler(
    new Request("https://x/instagram-webhook", {
      method: "POST",
      headers: { "X-Hub-Signature-256": await sign(BODY) },
      body: BODY,
    }),
  );

  assertEquals(res.status, 500);
  assertEquals(await res.text(), "");
  assertEquals(callsFor(db, "instagram_webhook_events", "insert").length, 1, "the insert attempt itself must still run");
});

Deno.test("instagram-webhook: método não suportado (PUT) -> 405 sem tocar o banco", async () => {
  const db = createSupabaseQueryMock();
  const handler = createInstagramWebhookHandler(baseDeps(db));

  const res = await handler(new Request("https://x/instagram-webhook", { method: "PUT" }));

  assertEquals(res.status, 405);
  assertEquals(db.calls.length, 0);
});

Deno.test("instagram-webhook: JSON malformado com assinatura válida -> 200, sem insert", async () => {
  const db = createSupabaseQueryMock();
  const malformed = "{not json";
  const handler = createInstagramWebhookHandler(baseDeps(db));

  const res = await handler(
    new Request("https://x/instagram-webhook", {
      method: "POST",
      headers: { "X-Hub-Signature-256": await sign(malformed) },
      body: malformed,
    }),
  );

  assertEquals(res.status, 200);
  assertEquals(db.calls.length, 0);
});

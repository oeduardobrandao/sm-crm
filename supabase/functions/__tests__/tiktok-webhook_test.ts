// tiktok-webhook (Task B6) — durable-ack pattern tests (DI style, mirrors
// tiktok-publish-cron_test.ts's convention: business logic exercised via DI'd
// getFreshTikTokToken/tiktokFetch/confirmAndApplyPublishStatus/waitUntil against the shared
// supabaseMock). Two invariants get dedicated coverage: (1) the raw event insert is AWAITED
// before the 200 is sent — never ACK-then-lose; (2) processing runs strictly AFTER the 200, via
// the injected waitUntil, and every branch stamps processed_at on completion (even no-ops),
// leaving it NULL only on a genuine processing crash.
import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import type { QueryCall } from "../../../test/shared/supabaseMock.ts";
import { createTikTokWebhookHandler } from "../tiktok-webhook/handler.ts";
import type { TikTokWebhookDeps } from "../tiktok-webhook/handler.ts";
import {
  EVENT_AUTH_REMOVED,
  EVENT_NO_LONGER_PUBLICALY_AVAILABLE,
  EVENT_PUBLICLY_AVAILABLE,
  EVENT_PUBLISH_COMPLETE,
  EVENT_PUBLISH_FAILED,
} from "../_shared/tiktok.ts";

type Db = ReturnType<typeof createSupabaseQueryMock>;

const CLIENT_KEY = "client-key-123";

function callsFor(db: Db, table: string, operation: string) {
  return db.calls.filter((c: QueryCall) => c.table === table && c.operation === operation);
}

function unreachable(label: string) {
  return () => {
    throw new Error(`must not be called: ${label}`);
  };
}

function baseAccount(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "acct-1",
    username: "dktest",
    client_id: 101,
    authorization_status: "active",
    ...overrides,
  };
}

/** A post_targets row as the lookup selects it (P4: publish state lives on the destination). */
function ttTargetRow(postId: number, publishRef: string, tipo: string | null = "feed") {
  return { id: 7000 + postId, post_id: postId, publish_ref: publishRef, workflow_posts: { tipo } };
}

const NOW_ISO = "2026-07-18T12:00:00.000Z";

function webhookPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    client_key: CLIENT_KEY,
    event: EVENT_PUBLISH_COMPLETE,
    create_time: 1752000000,
    user_openid: "open-1",
    content: JSON.stringify({ publish_id: "pub-1" }),
    ...overrides,
  };
}

function webhookRequest(body: unknown, opts?: { method?: string }): Request {
  return new Request("https://example.test/tiktok-webhook", {
    method: opts?.method ?? "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function baseDeps(db: Db, overrides: Partial<TikTokWebhookDeps> = {}): TikTokWebhookDeps {
  return {
    buildCorsHeaders: () => ({}),
    createServiceDb: () => db as never,
    tiktokClientKey: CLIENT_KEY,
    waitUntil: (unreachable("waitUntil") as unknown) as TikTokWebhookDeps["waitUntil"],
    getFreshTikTokToken: (unreachable("getFreshTikTokToken") as unknown) as TikTokWebhookDeps["getFreshTikTokToken"],
    tiktokFetch: (unreachable("tiktokFetch") as unknown) as TikTokWebhookDeps["tiktokFetch"],
    confirmAndApplyPublishStatus: (unreachable(
      "confirmAndApplyPublishStatus",
    ) as unknown) as TikTokWebhookDeps["confirmAndApplyPublishStatus"],
    randomUUID: () => "evt-fixed-id",
    now: () => new Date("2026-07-18T12:00:00.000Z"),
    ...overrides,
  };
}

// ── (1) bad client_key -> 200, no insert, no db access at all ──────────────────

Deno.test("tiktok-webhook: wrong client_key returns 200 and touches no table", async () => {
  const db = createSupabaseQueryMock();
  const handler = createTikTokWebhookHandler(baseDeps(db));

  const response = await handler(webhookRequest(webhookPayload({ client_key: "wrong-key" })));

  assertEquals(response.status, 200);
  assertEquals(db.calls.length, 0, "a client_key mismatch must never touch the database");
});

Deno.test("tiktok-webhook: missing client_key returns 200 and touches no table", async () => {
  const db = createSupabaseQueryMock();
  const handler = createTikTokWebhookHandler(baseDeps(db));

  const response = await handler(webhookRequest(webhookPayload({ client_key: undefined })));

  assertEquals(response.status, 200);
  assertEquals(db.calls.length, 0);
});

// ── (2) unknown user_openid -> 200, no insert ───────────────────────────────────

Deno.test("tiktok-webhook: unknown user_openid returns 200 and never inserts the event", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_accounts", "select", { data: null, error: null });
  const handler = createTikTokWebhookHandler(baseDeps(db));

  const response = await handler(webhookRequest(webhookPayload({ user_openid: "no-such-account" })));

  assertEquals(response.status, 200);
  assertEquals(callsFor(db, "tiktok_webhook_events", "insert").length, 0);
});

// ── (3) happy path: the insert is AWAITED before the 200 is sent ───────────────

Deno.test("tiktok-webhook: the 200 response is only sent after the event insert resolves", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_accounts", "select", { data: baseAccount(), error: null });

  let insertResolved = false;
  db.queue("tiktok_webhook_events", "insert", async () => {
    // A microtask tick — if the handler built the 200 without awaiting this, `insertResolved`
    // would still be false by the time `handler()` returns below.
    await new Promise((resolve) => setTimeout(resolve, 0));
    insertResolved = true;
    return { data: null, error: null };
  });

  const waited: Promise<void>[] = [];
  const handler = createTikTokWebhookHandler(baseDeps(db, { waitUntil: (p) => waited.push(p) }));

  const response = await handler(webhookRequest(webhookPayload({ event: "some.unhandled.event" })));

  assertEquals(response.status, 200);
  assert(insertResolved, "the insert must have resolved BEFORE the 200 was returned");

  await Promise.all(waited); // drain background processing so nothing leaks into later tests
});

// ── (4) insert failure -> 500 ───────────────────────────────────────────────────

Deno.test("tiktok-webhook: event insert failure returns 500 so TikTok's 72h retry redelivers", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_accounts", "select", { data: baseAccount(), error: null });
  db.queue("tiktok_webhook_events", "insert", { data: null, error: { message: "connection reset" } });

  const handler = createTikTokWebhookHandler(baseDeps(db)); // waitUntil stays unreachable

  const response = await handler(webhookRequest(webhookPayload()));

  assertEquals(response.status, 500, "insert failure must surface as 5xx, never a swallowed 200");
});

// ── (5) processing runs via the injected waitUntil and stamps processed_at ─────

Deno.test("tiktok-webhook: processing runs via the injected waitUntil (not inline) and stamps processed_at", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_accounts", "select", { data: baseAccount(), error: null });
  db.queue("tiktok_webhook_events", "insert", { data: null, error: null });
  db.queue("tiktok_webhook_events", "update", { data: null, error: null });

  const waited: Promise<void>[] = [];
  const handler = createTikTokWebhookHandler(baseDeps(db, { waitUntil: (p) => waited.push(p) }));

  const response = await handler(webhookRequest(webhookPayload({ event: "some.unhandled.event" })));

  assertEquals(response.status, 200);
  assertEquals(waited.length, 1, "processing must be handed to waitUntil exactly once, not awaited inline");
  assertEquals(callsFor(db, "tiktok_webhook_events", "update").length, 0, "not stamped yet — waitUntil hasn't been drained");

  await Promise.all(waited);

  const stampCalls = callsFor(db, "tiktok_webhook_events", "update");
  assertEquals(stampCalls.length, 1);
  assert("processed_at" in (stampCalls[0].payload as Record<string, unknown>));
});

// ── (6) publicly_available: stores external_id/permalink on the destination ─────

Deno.test("tiktok-webhook: publicly_available stores external_id/permalink on the TikTok destination", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_accounts", "select", { data: baseAccount({ username: "dktest" }), error: null });
  db.queue("tiktok_webhook_events", "insert", { data: null, error: null });
  db.queue("post_targets", "select", { data: ttTargetRow(70, "pub-70", "carrossel"), error: null });
  db.queue("post_targets", "update", { data: null, error: null });
  db.queue("tiktok_webhook_events", "update", { data: null, error: null });

  const waited: Promise<void>[] = [];
  const handler = createTikTokWebhookHandler(baseDeps(db, { waitUntil: (p) => waited.push(p) }));

  const payload = webhookPayload({
    event: EVENT_PUBLICLY_AVAILABLE,
    content: JSON.stringify({ publish_id: "pub-70", post_id: "post-70" }),
  });
  await handler(webhookRequest(payload));
  await Promise.all(waited);

  const lookup = callsFor(db, "post_targets", "select")[0];
  assertEquals(lookup.selectArgs, [["id, post_id, publish_ref, workflow_posts(tipo)"]]);
  assertEquals(lookup.modifiers, [
    { method: "eq", args: ["platform", "tiktok"] },
    { method: "eq", args: ["publish_ref", "pub-70"] },
    { method: "order", args: ["id", { ascending: false }] },
    { method: "limit", args: [1] },
    { method: "maybeSingle", args: [] },
  ]);

  const updates = callsFor(db, "post_targets", "update");
  assertEquals(updates.length, 1);
  assertEquals(updates[0].payload, {
    external_id: "post-70",
    permalink: "https://www.tiktok.com/@dktest/photo/post-70",
    updated_at: NOW_ISO,
  });
  assertEquals(updates[0].modifiers, [{ method: "eq", args: ["id", 7070] }]);
  assertEquals(callsFor(db, "workflow_posts", "update").length, 0, "the frozen tiktok_* columns are never written");
});

Deno.test("tiktok-webhook: publicly_available redelivery writes the exact same fields again (idempotent, no error)", async () => {
  const db = createSupabaseQueryMock();
  const account = baseAccount({ username: "dktest" });
  db.queue("tiktok_accounts", "select", { data: account, error: null }, { data: account, error: null });
  db.queue("tiktok_webhook_events", "insert", { data: null, error: null }, { data: null, error: null });
  const row = ttTargetRow(70, "pub-70");
  db.queue("post_targets", "select", { data: row, error: null }, { data: row, error: null });
  db.queue("post_targets", "update", { data: null, error: null }, { data: null, error: null });
  db.queue("tiktok_webhook_events", "update", { data: null, error: null }, { data: null, error: null });

  const waited: Promise<void>[] = [];
  const handler = createTikTokWebhookHandler(baseDeps(db, { waitUntil: (p) => waited.push(p) }));

  const payload = webhookPayload({
    event: EVENT_PUBLICLY_AVAILABLE,
    content: JSON.stringify({ publish_id: "pub-70", post_id: "post-70" }),
  });

  const first = await handler(webhookRequest(payload));
  const second = await handler(webhookRequest(payload));
  await Promise.all(waited);

  assertEquals(first.status, 200);
  assertEquals(second.status, 200);
  const updates = callsFor(db, "post_targets", "update");
  assertEquals(updates.length, 2, "each delivery re-applies the update");
  assertEquals(updates[0].payload, updates[1].payload, "redelivery converges to the exact same state");
});

// ── (7) no_longer_publicaly_available: clears permalink, keeps external_id ──────

Deno.test("tiktok-webhook: no_longer_publicaly_available clears the permalink but keeps external_id", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_accounts", "select", { data: baseAccount(), error: null });
  db.queue("tiktok_webhook_events", "insert", { data: null, error: null });
  db.queue("post_targets", "select", { data: ttTargetRow(71, "pub-71"), error: null });
  db.queue("post_targets", "update", { data: null, error: null });
  db.queue("tiktok_webhook_events", "update", { data: null, error: null });

  const waited: Promise<void>[] = [];
  const handler = createTikTokWebhookHandler(baseDeps(db, { waitUntil: (p) => waited.push(p) }));

  const payload = webhookPayload({
    event: EVENT_NO_LONGER_PUBLICALY_AVAILABLE,
    content: JSON.stringify({ publish_id: "pub-71" }),
  });
  await handler(webhookRequest(payload));
  await Promise.all(waited);

  const updates = callsFor(db, "post_targets", "update");
  assertEquals(updates.length, 1);
  assertEquals(updates[0].payload, { permalink: null, updated_at: NOW_ISO }, "external_id must NOT be touched");
  assertEquals(updates[0].modifiers, [{ method: "eq", args: ["id", 7071] }]);
});

// ── (8) authorization.removed: revokes + audit logs ─────────────────────────────

Deno.test("tiktok-webhook: authorization.removed revokes the account and writes an audit log entry", async () => {
  const db = createSupabaseQueryMock();
  // id (the tiktok_accounts PK) is deliberately distinct from client_id (the CRM client id) so
  // this test catches a regression back to keying the audit row off client_id.
  db.queue("tiktok_accounts", "select", { data: baseAccount({ id: "acct-555", client_id: 101 }), error: null });
  db.queue("tiktok_webhook_events", "insert", { data: null, error: null });
  db.queue("tiktok_accounts", "update", { data: null, error: null });
  db.queue("clientes", "select", { data: { conta_id: "conta-abc" }, error: null });
  db.queue("audit_log", "insert", { data: null, error: null });
  db.queue("tiktok_webhook_events", "update", { data: null, error: null });

  const waited: Promise<void>[] = [];
  const handler = createTikTokWebhookHandler(baseDeps(db, { waitUntil: (p) => waited.push(p) }));

  const payload = webhookPayload({ event: EVENT_AUTH_REMOVED, content: "{}" });
  await handler(webhookRequest(payload));
  await Promise.all(waited);

  const acctUpdates = callsFor(db, "tiktok_accounts", "update");
  assertEquals(acctUpdates.length, 1);
  assertEquals(acctUpdates[0].payload, { authorization_status: "revoked" });

  const auditInserts = callsFor(db, "audit_log", "insert");
  assertEquals(auditInserts.length, 1);
  const auditPayload = auditInserts[0].payload as Record<string, unknown>;
  assertEquals(auditPayload.action, "tiktok-auth-removed");
  assertEquals(auditPayload.resource_type, "tiktok_account");
  assertEquals(auditPayload.resource_id, "acct-555", "resource_id must be the tiktok_accounts PK, not the CRM client_id");
  assertEquals(auditPayload.conta_id, "conta-abc");

  // The revoke write never downgrades a user-initiated disconnect that lands between the
  // account read and this update.
  assert(
    acctUpdates[0].modifiers.some(
      (m) => m.method === "neq" && m.args[0] === "authorization_status" && m.args[1] === "disconnected",
    ),
    "revoke update must be guarded with .neq('authorization_status', 'disconnected')",
  );
});

Deno.test("tiktok-webhook: authorization.removed after an in-app disconnect leaves the account disconnected", async () => {
  // Our own disconnect calls TikTok's /oauth/revoke/, and TikTok then echoes
  // authorization.removed a few seconds later. Flipping 'disconnected' to 'revoked' left the CRM
  // showing a "syncing" spinner forever (revoked row, last_synced_at null).
  const db = createSupabaseQueryMock();
  db.queue("tiktok_accounts", "select", {
    data: baseAccount({ id: "acct-555", client_id: 101, authorization_status: "disconnected" }),
    error: null,
  });
  db.queue("tiktok_webhook_events", "insert", { data: null, error: null });
  db.queue("tiktok_webhook_events", "update", { data: null, error: null });

  const waited: Promise<void>[] = [];
  const handler = createTikTokWebhookHandler(baseDeps(db, { waitUntil: (p) => waited.push(p) }));

  const payload = webhookPayload({ event: EVENT_AUTH_REMOVED, content: "{}" });
  await handler(webhookRequest(payload));
  await Promise.all(waited);

  assertEquals(callsFor(db, "tiktok_accounts", "update").length, 0);
  assertEquals(callsFor(db, "audit_log", "insert").length, 0);
  assertEquals(callsFor(db, "tiktok_webhook_events", "update").length, 1, "the event is still stamped processed");
});

// ── (9) publish.failed / publish.complete: re-confirm via the shared status ────
// resolution (spy) instead of mutating the destination directly ────────────────

Deno.test("tiktok-webhook: post.publish.failed re-confirms via confirmAndApplyPublishStatus with the destination", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_accounts", "select", { data: baseAccount(), error: null });
  db.queue("tiktok_webhook_events", "insert", { data: null, error: null });
  db.queue("post_targets", "select", { data: ttTargetRow(80, "pub-80", "reels"), error: null });
  db.queue("post_targets", "update", { data: { id: 7080 }, error: null }); // lock claim succeeds
  db.queue("tiktok_webhook_events", "update", { data: null, error: null });

  const confirmCalls: Array<{ post: unknown; accessToken: string }> = [];
  const waited: Promise<void>[] = [];
  const handler = createTikTokWebhookHandler(baseDeps(db, {
    waitUntil: (p) => waited.push(p),
    getFreshTikTokToken: async () => ({ accessToken: "fresh-tok", openId: "open-1" }),
    confirmAndApplyPublishStatus: (async (deps: { accessToken: string }, post: unknown) => {
      confirmCalls.push({ post, accessToken: deps.accessToken });
      return "failed";
    }) as unknown as TikTokWebhookDeps["confirmAndApplyPublishStatus"],
  }));

  const payload = webhookPayload({
    event: EVENT_PUBLISH_FAILED,
    content: JSON.stringify({ publish_id: "pub-80", reason: "video_pull_failed", publish_type: "VIDEO" }),
  });
  await handler(webhookRequest(payload));
  await Promise.all(waited);

  assertEquals(confirmCalls.length, 1);
  assertEquals(confirmCalls[0].accessToken, "fresh-tok");
  assertEquals(confirmCalls[0].post, {
    post_id: 80,
    target_id: 7080,
    publish_ref: "pub-80",
    tiktok_username: "dktest",
    tipo: "reels",
  });

  const lockUpdates = callsFor(db, "post_targets", "update");
  assertEquals(lockUpdates.length, 1, "the handler only claims the destination lock");
  assertEquals(lockUpdates[0].payload, { processing_at: NOW_ISO, updated_at: NOW_ISO });
  assertEquals(callsFor(db, "workflow_posts", "update").length, 0);
});

Deno.test("tiktok-webhook: post.publish.complete also re-confirms via confirmAndApplyPublishStatus", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_accounts", "select", { data: baseAccount(), error: null });
  db.queue("tiktok_webhook_events", "insert", { data: null, error: null });
  db.queue("post_targets", "select", { data: ttTargetRow(81, "pub-81"), error: null });
  db.queue("post_targets", "update", { data: { id: 7081 }, error: null });
  db.queue("tiktok_webhook_events", "update", { data: null, error: null });

  const confirmCalls: number[] = [];
  const waited: Promise<void>[] = [];
  const handler = createTikTokWebhookHandler(baseDeps(db, {
    waitUntil: (p) => waited.push(p),
    getFreshTikTokToken: async () => ({ accessToken: "tok", openId: "open-1" }),
    confirmAndApplyPublishStatus: (async (_deps: unknown, post: { post_id: number }) => {
      confirmCalls.push(post.post_id);
      return "published";
    }) as unknown as TikTokWebhookDeps["confirmAndApplyPublishStatus"],
  }));

  const payload = webhookPayload({
    event: EVENT_PUBLISH_COMPLETE,
    content: JSON.stringify({ publish_id: "pub-81" }),
  });
  await handler(webhookRequest(payload));
  await Promise.all(waited);

  assertEquals(confirmCalls, [81]);
});

Deno.test("tiktok-webhook: publish.failed for an unknown publish_id logs and no-ops (still stamps processed_at)", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_accounts", "select", { data: baseAccount(), error: null });
  db.queue("tiktok_webhook_events", "insert", { data: null, error: null });
  db.queue("post_targets", "select", { data: null, error: null }); // no matching destination
  db.queue("tiktok_webhook_events", "update", { data: null, error: null });

  const waited: Promise<void>[] = [];
  const handler = createTikTokWebhookHandler(baseDeps(db, { waitUntil: (p) => waited.push(p) }));

  const payload = webhookPayload({
    event: EVENT_PUBLISH_FAILED,
    content: JSON.stringify({ publish_id: "pub-missing" }),
  });
  await handler(webhookRequest(payload));
  await Promise.all(waited);

  assertEquals(callsFor(db, "tiktok_webhook_events", "update").length, 1, "an unresolvable publish_id is a logged no-op");
  assertEquals(callsFor(db, "post_targets", "update").length, 0);
});

// ── (9b) webhook/cron lock coordination: claim the destination's processing_at before ─
// re-confirming, so a mid-flight cron status-fetch can never race the webhook's write ─

Deno.test("tiktok-webhook: publish.complete cedes to the cron when the destination lock is held", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_accounts", "select", { data: baseAccount(), error: null });
  db.queue("tiktok_webhook_events", "insert", { data: null, error: null });
  db.queue("post_targets", "select", { data: ttTargetRow(90, "pub-90"), error: null });
  // maybeSingle() resolving to null data = the claim's .or() filter matched zero rows
  // (processing_at is fresh, the cron owns this destination).
  db.queue("post_targets", "update", { data: null, error: null });
  db.queue("tiktok_webhook_events", "update", { data: null, error: null });

  const waited: Promise<void>[] = [];
  const handler = createTikTokWebhookHandler(baseDeps(db, { waitUntil: (p) => waited.push(p) }));

  const payload = webhookPayload({
    event: EVENT_PUBLISH_COMPLETE,
    content: JSON.stringify({ publish_id: "pub-90" }),
  });
  const response = await handler(webhookRequest(payload));
  await Promise.all(waited);

  assertEquals(response.status, 200);
  const lock = callsFor(db, "post_targets", "update");
  assertEquals(lock.length, 1, "the claim attempt itself must still run");
  assertEquals(lock[0].modifiers, [
    { method: "eq", args: ["id", 7090] },
    { method: "or", args: ["processing_at.is.null,processing_at.lt.2026-07-18T11:50:00.000Z"] },
    { method: "maybeSingle", args: [] },
  ]);
  assertEquals(lock[0].selectArgs, [["id"]]);
  assertEquals(callsFor(db, "tiktok_webhook_events", "update").length, 1, "ceding is a normal no-op");
});

Deno.test("tiktok-webhook: publish.complete claims the free lock and proceeds to confirmAndApplyPublishStatus", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_accounts", "select", { data: baseAccount(), error: null });
  db.queue("tiktok_webhook_events", "insert", { data: null, error: null });
  db.queue("post_targets", "select", { data: ttTargetRow(91, "pub-91"), error: null });
  db.queue("post_targets", "update", { data: { id: 7091 }, error: null });
  db.queue("tiktok_webhook_events", "update", { data: null, error: null });

  const confirmCalls: number[] = [];
  const waited: Promise<void>[] = [];
  const handler = createTikTokWebhookHandler(baseDeps(db, {
    waitUntil: (p) => waited.push(p),
    getFreshTikTokToken: async () => ({ accessToken: "tok", openId: "open-1" }),
    confirmAndApplyPublishStatus: (async (_deps: unknown, post: { post_id: number }) => {
      confirmCalls.push(post.post_id);
      return "published";
    }) as unknown as TikTokWebhookDeps["confirmAndApplyPublishStatus"],
  }));

  const payload = webhookPayload({
    event: EVENT_PUBLISH_COMPLETE,
    content: JSON.stringify({ publish_id: "pub-91" }),
  });
  await handler(webhookRequest(payload));
  await Promise.all(waited);

  assertEquals(callsFor(db, "post_targets", "update").length, 1, "the claim update must have run");
  assertEquals(confirmCalls, [91], "winning the claim must lead to confirmAndApplyPublishStatus being called");
});

Deno.test("tiktok-webhook: a DB error while claiming the lock leaves processed_at unstamped and never throws out", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_accounts", "select", { data: baseAccount(), error: null });
  db.queue("tiktok_webhook_events", "insert", { data: null, error: null });
  db.queue("post_targets", "select", { data: ttTargetRow(92, "pub-92"), error: null });
  db.queue("post_targets", "update", { data: null, error: { message: "connection reset" } });

  const waited: Promise<void>[] = [];
  const handler = createTikTokWebhookHandler(baseDeps(db, { waitUntil: (p) => waited.push(p) }));

  const payload = webhookPayload({
    event: EVENT_PUBLISH_COMPLETE,
    content: JSON.stringify({ publish_id: "pub-92" }),
  });
  const response = await handler(webhookRequest(payload));
  await Promise.all(waited);

  assertEquals(response.status, 200);
  assertEquals(callsFor(db, "tiktok_webhook_events", "update").length, 0, "processed_at must stay NULL");
});

Deno.test("tiktok-webhook: a DB error on the destination lookup leaves processed_at unstamped", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_accounts", "select", { data: baseAccount(), error: null });
  db.queue("tiktok_webhook_events", "insert", { data: null, error: null });
  db.queue("post_targets", "select", { data: null, error: { message: "timeout" } });

  const waited: Promise<void>[] = [];
  const handler = createTikTokWebhookHandler(baseDeps(db, { waitUntil: (p) => waited.push(p) }));

  await handler(webhookRequest(webhookPayload({ content: JSON.stringify({ publish_id: "pub-93" }) })));
  await Promise.all(waited);

  assertEquals(callsFor(db, "tiktok_webhook_events", "update").length, 0);
});

// ── (10) unknown event type -> processed_at stamped, nothing else ──────────────

Deno.test("tiktok-webhook: an unrecognized event type is a no-op that still stamps processed_at", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_accounts", "select", { data: baseAccount(), error: null });
  db.queue("tiktok_webhook_events", "insert", { data: null, error: null });
  db.queue("tiktok_webhook_events", "update", { data: null, error: null });

  const waited: Promise<void>[] = [];
  const handler = createTikTokWebhookHandler(baseDeps(db, { waitUntil: (p) => waited.push(p) }));

  const payload = webhookPayload({ event: "post.publish.some_future_event" });
  await handler(webhookRequest(payload));
  await Promise.all(waited);

  assertEquals(callsFor(db, "workflow_posts", "select").length, 0);
  assertEquals(callsFor(db, "workflow_posts", "update").length, 0);
  assertEquals(callsFor(db, "tiktok_accounts", "update").length, 0);

  const stampCalls = callsFor(db, "tiktok_webhook_events", "update");
  assertEquals(stampCalls.length, 1);
  assert("processed_at" in (stampCalls[0].payload as Record<string, unknown>));
});

// ── extra: malformed JSON body / unsupported method ─────────────────────────────

Deno.test("tiktok-webhook: malformed JSON body returns 200 and touches no table", async () => {
  const db = createSupabaseQueryMock();
  const handler = createTikTokWebhookHandler(baseDeps(db));

  const response = await handler(
    new Request("https://example.test/tiktok-webhook", { method: "POST", body: "{not json" }),
  );

  assertEquals(response.status, 200);
  assertEquals(db.calls.length, 0);
});

Deno.test("tiktok-webhook: GET is rejected with 405 before any db access", async () => {
  const db = createSupabaseQueryMock();
  const handler = createTikTokWebhookHandler(baseDeps(db));

  const response = await handler(new Request("https://example.test/tiktok-webhook", { method: "GET" }));

  assertEquals(response.status, 405);
  assertEquals(db.calls.length, 0);
});

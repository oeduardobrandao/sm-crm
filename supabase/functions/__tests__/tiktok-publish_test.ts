// supabase/functions/__tests__/tiktok-publish_test.ts
//
// TikTok Phase B, Task B4: tiktok-publish edge function (creator-info, schedule, publish-now,
// cancel, retry). Mirrors instagram-publish-gate_test.ts's mocking style (createSupabaseQueryMock,
// per-table `.queue()` seeding in call order) but drives the TikTok/IG validators, the TikTok
// token helper, tiktokFetch, and buildTikTokMediaUrl entirely through the handler's DI seams —
// avoids real token crypto and global-fetch stubbing, and lets the publish-now poll loop
// (12 x 3s) run instantly under an injected no-op `sleep`.
//
// buildTikTokMediaUrl (_shared/tiktok-media-url.ts) replaced a raw R2 signGetUrl call
// (tiktok-media proxy fast-follow): TikTok's PULL_FROM_URL source needs a TikTok-verifiable URL
// prefix, which raw *.r2.cloudflarestorage.com presigned URLs can't satisfy.

import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import type { QueryCall } from "../../../test/shared/supabaseMock.ts";
import { createPublishHandler, type TikTokPublishDeps } from "../tiktok-publish/handler.ts";
import type { TikTokValidationResult } from "../_shared/tiktok-publish-utils.ts";
import type { ScheduleValidationResult } from "../_shared/instagram-publish-utils.ts";
import { buildTikTokMediaUrl, verifyTikTokMediaToken } from "../_shared/tiktok-media-url.ts";

Deno.env.set("TOKEN_ENCRYPTION_KEY", "test-tiktok-publish-key");
Deno.env.set("SUPABASE_URL", "https://supabase.example");
const MEDIA_URL_PREFIX = "https://supabase.example/functions/v1/tiktok-media/m/";

// ============================================================
// Helpers
// ============================================================

function callsFor(db: ReturnType<typeof createSupabaseQueryMock>, table: string, operation: string) {
  return db.calls.filter((c: QueryCall) => c.table === table && c.operation === operation);
}

function rpcCalls(db: ReturnType<typeof createSupabaseQueryMock>, name: string) {
  return db.calls.filter((c: QueryCall) => c.table === `rpc:${name}`);
}

function gateOn(db: ReturnType<typeof createSupabaseQueryMock>) {
  db.queueRpc("effective_plan_feature", { data: true, error: null }); // feature_post_scheduling
  db.queueRpc("effective_plan_feature", { data: true, error: null }); // feature_tiktok
}

function basePost(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    status: "aprovado_cliente",
    platform: "tiktok",
    tipo: "feed",
    tiktok_publish_status: null,
    tiktok_publish_error: null,
    tiktok_publish_retry_count: 0,
    tiktok_caption: "legenda tiktok",
    tiktok_title: null,
    tiktok_settings: { privacy_level: "SELF_ONLY" },
    ig_caption: null,
    ...overrides,
  };
}

function tiktokRequest(action: string, id: number, opts: { method?: string; body?: unknown; token?: string } = {}) {
  const { method = "POST", body, token = "t" } = opts;
  return new Request(`http://x/tiktok-publish/${action}/${id}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const okTikTokValidation = (overrides: Partial<TikTokValidationResult> = {}): TikTokValidationResult => ({
  ok: true,
  errors: [],
  media: [{
    id: 1,
    kind: "image",
    mime_type: "image/jpeg",
    size_bytes: 1000,
    width: 1080,
    height: 1080,
    duration_seconds: null,
    r2_key: "img/1.jpg",
    sort_order: 0,
  }],
  account: {
    id: "acct-1",
    encrypted_access_token: "enc-access",
    encrypted_refresh_token: "enc-refresh",
    tiktok_open_id: "open-1",
  },
  ...overrides,
});

function makeDeps(
  db: ReturnType<typeof createSupabaseQueryMock>,
  overrides: Partial<TikTokPublishDeps> = {},
): TikTokPublishDeps {
  return {
    buildCorsHeaders: () => ({}),
    createDb: () => db as never,
    createServiceDb: () => db as never,
    ...overrides,
  };
}

// Stateful tiktokFetch stub: routes by path, tracks calls, lets each test script the init /
// status-fetch / creator-info responses independently.
function stubTiktokFetch(opts: {
  init?: unknown;
  statusSequence?: unknown[];
  creatorInfo?: unknown;
} = {}) {
  const calls: Array<{ path: string; body: unknown }> = [];
  let statusIdx = 0;
  const fn = (path: string, init: RequestInit & { accessToken: string }) => {
    calls.push({ path, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (path === "/post/publish/video/init/" || path === "/post/publish/content/init/") {
      return Promise.resolve(opts.init ?? { publish_id: "pub-1" });
    }
    if (path === "/post/publish/status/fetch/") {
      const seq = opts.statusSequence ?? [{ status: "PUBLISH_COMPLETE" }];
      const result = seq[Math.min(statusIdx, seq.length - 1)];
      statusIdx++;
      return Promise.resolve(result);
    }
    if (path === "/post/publish/creator_info/query/") {
      return Promise.resolve(opts.creatorInfo ?? {});
    }
    return Promise.reject(new Error(`unexpected tiktokFetch path: ${path}`));
  };
  return { fn: fn as TikTokPublishDeps["tiktokFetch"], calls };
}

const noopSleep = () => Promise.resolve();

// ============================================================
// schedule
// ============================================================

Deno.test("tiktok-publish schedule: happy path (tiktok-only) transitions to agendado", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: basePost({ platform: "tiktok" }), error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);
  db.queue("workflow_posts", "update", { data: null, error: null }); // scheduled_at write
  db.queueRpc("record_post_status_change", { data: null, error: null });

  let tiktokCalled = 0;
  let igCalled = 0;
  const handler = createPublishHandler(makeDeps(db, {
    validateForTikTokScheduling: (() => {
      tiktokCalled++;
      return Promise.resolve(okTikTokValidation());
    }) as never,
    validateForScheduling: (() => {
      igCalled++;
      return Promise.resolve({ ok: true, errors: [] } as ScheduleValidationResult);
    }) as never,
  }));

  const res = await handler(tiktokRequest("schedule", 1, { body: { scheduled_at: "2030-01-01T12:00:00Z" } }));
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body, { ok: true, status: "agendado" });
  assertEquals(tiktokCalled, 1);
  assertEquals(igCalled, 0); // tiktok-only post must never run the IG validator

  const rpc = rpcCalls(db, "record_post_status_change");
  assertEquals(rpc.length, 1);
  const payload = rpc[0].payload as Record<string, unknown>;
  assertEquals(payload.p_new_status, "agendado");
  assertEquals((payload.p_fields as Record<string, unknown>).scheduled_at, "2030-01-01T12:00:00Z");

  const updates = callsFor(db, "workflow_posts", "update");
  assertEquals(updates.length, 1);
  assertEquals((updates[0].payload as Record<string, unknown>).scheduled_at, "2030-01-01T12:00:00Z");
});

Deno.test("tiktok-publish schedule: `both` platform runs BOTH validators", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: basePost({ platform: "both" }), error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);
  db.queue("workflow_posts", "update", { data: null, error: null });
  db.queueRpc("record_post_status_change", { data: null, error: null });

  const tiktokCalls: number[] = [];
  const igCalls: number[] = [];
  const handler = createPublishHandler(makeDeps(db, {
    validateForTikTokScheduling: ((_db: unknown, postId: number) => {
      tiktokCalls.push(postId);
      return Promise.resolve(okTikTokValidation());
    }) as never,
    validateForScheduling: ((_db: unknown, postId: number) => {
      igCalls.push(postId);
      return Promise.resolve({ ok: true, errors: [] } as ScheduleValidationResult);
    }) as never,
  }));

  const res = await handler(tiktokRequest("schedule", 1, { body: { scheduled_at: "2030-01-01T12:00:00Z" } }));
  assertEquals(res.status, 200);
  assertEquals(tiktokCalls, [1]);
  assertEquals(igCalls, [1]); // the IG validator MUST run for a `both` post
});

Deno.test("tiktok-publish schedule: 422 merges TikTok + IG validation errors into `details`", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: basePost({ platform: "both" }), error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);
  db.queue("workflow_posts", "update", { data: null, error: null });

  const handler = createPublishHandler(makeDeps(db, {
    validateForTikTokScheduling: (() =>
      Promise.resolve(okTikTokValidation({ ok: false, errors: ["Legenda do TikTok excede 2200 caracteres."] }))) as never,
    validateForScheduling: (() =>
      Promise.resolve({ ok: false, errors: ["Legenda do Instagram não definida."] } as ScheduleValidationResult)) as never,
  }));

  const res = await handler(tiktokRequest("schedule", 1, { body: { scheduled_at: "2030-01-01T12:00:00Z" } }));
  const body = await res.json();

  assertEquals(res.status, 422);
  assertEquals(body.error, "Validação falhou");
  assertEquals(body.details.includes("Legenda do TikTok excede 2200 caracteres."), true);
  assertEquals(body.details.includes("Legenda do Instagram não definida."), true);
});

Deno.test("tiktok-publish schedule: 422 validation failure restores prior scheduled_at", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", {
    data: basePost({ platform: "tiktok", scheduled_at: "2025-01-01T00:00:00Z" }),
    error: null,
  });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);
  db.queue("workflow_posts", "update", { data: null, error: null }); // candidate write
  db.queue("workflow_posts", "update", { data: null, error: null }); // restore write

  const handler = createPublishHandler(makeDeps(db, {
    validateForTikTokScheduling: (() =>
      Promise.resolve(okTikTokValidation({ ok: false, errors: ["Legenda do TikTok excede 2200 caracteres."] }))) as never,
  }));

  const res = await handler(tiktokRequest("schedule", 1, { body: { scheduled_at: "2030-01-01T12:00:00Z" } }));
  const body = await res.json();

  assertEquals(res.status, 422);
  assertEquals(body.error, "Validação falhou");

  const updates = callsFor(db, "workflow_posts", "update");
  assertEquals(updates.length, 2);
  assertEquals((updates[0].payload as Record<string, unknown>).scheduled_at, "2030-01-01T12:00:00Z"); // candidate
  assertEquals((updates[1].payload as Record<string, unknown>).scheduled_at, "2025-01-01T00:00:00Z"); // restored prior
});

Deno.test("tiktok-publish schedule: unaudited-mode gate error propagates as 422", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: basePost({ platform: "tiktok" }), error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);
  db.queue("workflow_posts", "update", { data: null, error: null });

  const UNAUDITED_MSG =
    "App TikTok em modo de teste: apenas publicação privada (SELF_ONLY) é permitida até a auditoria do TikTok";
  const handler = createPublishHandler(makeDeps(db, {
    validateForTikTokScheduling: (() =>
      Promise.resolve(okTikTokValidation({ ok: false, errors: [UNAUDITED_MSG] }))) as never,
  }));

  const res = await handler(tiktokRequest("schedule", 1, { body: { scheduled_at: "2030-01-01T12:00:00Z" } }));
  const body = await res.json();

  assertEquals(res.status, 422);
  assertEquals(body.details, [UNAUDITED_MSG]);
});

Deno.test("tiktok-publish schedule: infra-throw from validator -> 500 generic PT-BR, no raw DB text leaked", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: basePost({ platform: "tiktok" }), error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);
  db.queue("workflow_posts", "update", { data: null, error: null });

  const RAW_DB_TEXT = 'relation "workflow_posts_bogus" does not exist';
  const handler = createPublishHandler(makeDeps(db, {
    validateForTikTokScheduling: (() =>
      Promise.reject(new Error(`validateForTikTokScheduling: workflow_posts read failed: ${RAW_DB_TEXT}`))) as never,
  }));

  const res = await handler(tiktokRequest("schedule", 1, { body: { scheduled_at: "2030-01-01T12:00:00Z" } }));
  const rawBody = await res.text();

  assertEquals(res.status, 500);
  assertEquals(rawBody.includes(RAW_DB_TEXT), false);
  assertEquals(rawBody.includes("workflow_posts read failed"), false);
  const body = JSON.parse(rawBody);
  assertEquals(typeof body.error, "string");
});

Deno.test("tiktok-publish schedule: validator infra-throw restores prior scheduled_at, response unchanged", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", {
    data: basePost({ platform: "tiktok", scheduled_at: "2025-06-15T09:00:00Z" }),
    error: null,
  });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);
  db.queue("workflow_posts", "update", { data: null, error: null }); // candidate write
  db.queue("workflow_posts", "update", { data: null, error: null }); // restore write

  const RAW_DB_TEXT = 'relation "workflow_posts_bogus" does not exist';
  const handler = createPublishHandler(makeDeps(db, {
    validateForTikTokScheduling: (() =>
      Promise.reject(new Error(`validateForTikTokScheduling: workflow_posts read failed: ${RAW_DB_TEXT}`))) as never,
  }));

  const res = await handler(tiktokRequest("schedule", 1, { body: { scheduled_at: "2030-01-01T12:00:00Z" } }));
  const rawBody = await res.text();

  assertEquals(res.status, 500);
  assertEquals(rawBody.includes(RAW_DB_TEXT), false);
  const body = JSON.parse(rawBody);
  // Restore succeeding must NOT change the response — it stays the original generic PT-BR 500.
  assertEquals(body.error, "Erro ao validar post para agendamento no TikTok.");

  const updates = callsFor(db, "workflow_posts", "update");
  assertEquals(updates.length, 2);
  assertEquals((updates[0].payload as Record<string, unknown>).scheduled_at, "2030-01-01T12:00:00Z"); // candidate
  assertEquals((updates[1].payload as Record<string, unknown>).scheduled_at, "2025-06-15T09:00:00Z"); // restored prior
});

Deno.test("tiktok-publish schedule: IG-only post -> 400 telling caller to use instagram-publish", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: basePost({ platform: "instagram" }), error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);

  const handler = createPublishHandler(makeDeps(db));
  const res = await handler(tiktokRequest("schedule", 1, { body: { scheduled_at: "2030-01-01T12:00:00Z" } }));
  assertEquals(res.status, 400);
});

Deno.test("tiktok-publish: feature_tiktok OFF -> 403 feature_disabled (feature_post_scheduling ON)", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: basePost(), error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queueRpc("effective_plan_feature", { data: true, error: null }); // feature_post_scheduling ON
  db.queueRpc("effective_plan_feature", { data: false, error: null }); // feature_tiktok OFF

  const handler = createPublishHandler(makeDeps(db));
  const res = await handler(tiktokRequest("schedule", 1, { body: { scheduled_at: "2030-01-01T12:00:00Z" } }));
  const body = await res.json();
  assertEquals(res.status, 403);
  assertEquals(body, { error: "feature_disabled", feature: "feature_tiktok" });
});

// ============================================================
// retry
// ============================================================

Deno.test("tiktok-publish retry: succeeds with both feature flags OFF (retry is ungated)", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", {
    data: basePost({ platform: "tiktok", status: "falha_publicacao", tiktok_publish_status: "failed" }),
    error: null,
  });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queueRpc("effective_plan_feature", { data: false, error: null }); // feature_post_scheduling OFF
  db.queueRpc("effective_plan_feature", { data: false, error: null }); // feature_tiktok OFF
  db.queue("workflow_posts", "update", { data: null, error: null });
  db.queueRpc("record_post_status_change", { data: null, error: null });

  const handler = createPublishHandler(makeDeps(db));
  const res = await handler(tiktokRequest("retry", 1));
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body, { ok: true, status: "agendado" });
  // retry must never call the gate RPC — both queued "false" responses stay unconsumed. If the
  // gate were mistakenly re-applied, the first "false" would be consumed and this would 403.
  assertEquals(db.calls.filter((c: QueryCall) => c.table === "rpc:effective_plan_feature").length, 0);
});

Deno.test("tiktok-publish retry: resets ONLY TikTok fields, leaves IG columns untouched", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", {
    data: basePost({ platform: "both", status: "falha_publicacao", tiktok_publish_status: "failed" }),
    error: null,
  });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);
  db.queue("workflow_posts", "update", { data: null, error: null });
  db.queueRpc("record_post_status_change", { data: null, error: null });

  const handler = createPublishHandler(makeDeps(db));
  const res = await handler(tiktokRequest("retry", 1));
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body, { ok: true, status: "agendado" });

  const updates = callsFor(db, "workflow_posts", "update");
  assertEquals(updates.length, 1);
  const payload = updates[0].payload as Record<string, unknown>;
  assertEquals(payload, { tiktok_publish_status: null, tiktok_publish_error: null });
  assert(!("instagram_container_id" in payload), "retry must never touch IG columns");
  assert(!("publish_error" in payload), "retry must never touch IG columns");

  const rpc = rpcCalls(db, "record_post_status_change");
  assertEquals(rpc.length, 1);
  const rpcPayload = rpc[0].payload as Record<string, unknown>;
  assertEquals(rpcPayload.p_new_status, "agendado");
  assertEquals(rpcPayload.p_fields, {});
});

Deno.test("tiktok-publish retry: post.status falha_publicacao but tiktok_publish_status not 'failed' -> 422", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  // Simulates a `both` post whose IG side failed, not the TikTok side.
  db.queue("workflow_posts", "select", {
    data: basePost({ platform: "both", status: "falha_publicacao", tiktok_publish_status: null }),
    error: null,
  });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);

  const handler = createPublishHandler(makeDeps(db));
  const res = await handler(tiktokRequest("retry", 1));
  assertEquals(res.status, 422);
});

// ============================================================
// cancel
// ============================================================

Deno.test("tiktok-publish cancel: succeeds with both feature flags OFF (cancel is ungated)", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: basePost({ platform: "tiktok", status: "agendado" }), error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queueRpc("effective_plan_feature", { data: false, error: null }); // feature_post_scheduling OFF
  db.queueRpc("effective_plan_feature", { data: false, error: null }); // feature_tiktok OFF
  db.queue("workflow_posts", "update", { data: null, error: null });
  db.queueRpc("record_post_status_change", { data: null, error: null });

  const handler = createPublishHandler(makeDeps(db));
  const res = await handler(tiktokRequest("cancel", 1));
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body, { ok: true, status: "aprovado_cliente" });
  // cancel must never call the gate RPC — both queued "false" responses stay unconsumed. If the
  // gate were mistakenly re-applied, the first "false" would be consumed and this would 403.
  assertEquals(db.calls.filter((c: QueryCall) => c.table === "rpc:effective_plan_feature").length, 0);
});

Deno.test("tiktok-publish cancel: `both` clears BOTH platforms' handles", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: basePost({ platform: "both", status: "agendado" }), error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);
  db.queue("workflow_posts", "update", { data: null, error: null });
  db.queueRpc("record_post_status_change", { data: null, error: null });

  const handler = createPublishHandler(makeDeps(db));
  const res = await handler(tiktokRequest("cancel", 1));
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body, { ok: true, status: "aprovado_cliente" });

  const updates = callsFor(db, "workflow_posts", "update");
  assertEquals(updates.length, 1);
  assertEquals(updates[0].payload, {
    tiktok_publish_id: null,
    tiktok_publish_status: null,
    tiktok_publish_error: null,
    tiktok_publish_processing_at: null,
  });

  const rpc = rpcCalls(db, "record_post_status_change");
  assertEquals(rpc.length, 1);
  const rpcPayload = rpc[0].payload as Record<string, unknown>;
  assertEquals(rpcPayload.p_new_status, "aprovado_cliente");
  assertEquals(rpcPayload.p_fields, {
    instagram_container_id: null,
    publish_processing_at: null,
    publish_error: null,
  });
});

Deno.test("tiktok-publish cancel: tiktok-only post does NOT touch IG columns", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: basePost({ platform: "tiktok", status: "agendado" }), error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);
  db.queue("workflow_posts", "update", { data: null, error: null });
  db.queueRpc("record_post_status_change", { data: null, error: null });

  const handler = createPublishHandler(makeDeps(db));
  const res = await handler(tiktokRequest("cancel", 1));
  assertEquals(res.status, 200);

  const rpc = rpcCalls(db, "record_post_status_change");
  assertEquals((rpc[0].payload as Record<string, unknown>).p_fields, {});
});

// ============================================================
// creator-info
// ============================================================

Deno.test("tiktok-publish creator-info: mismatched ownership -> 403", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queue("clientes", "select", { data: { conta_id: "ws-OTHER" }, error: null });

  const handler = createPublishHandler(makeDeps(db));
  const res = await handler(tiktokRequest("creator-info", 5, { method: "GET" }));
  const body = await res.json();
  assertEquals(res.status, 403);
  assertEquals(body, { error: "Unauthorized" });
});

Deno.test("tiktok-publish creator-info: returns TikTok's fields verbatim with no-store, never cached", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queue("clientes", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);
  db.queue("tiktok_accounts", "select", { data: { id: "acct-1", authorization_status: "active" }, error: null });

  const creatorInfoPayload = {
    creator_nickname: "Dra. Marina",
    creator_avatar_url: "https://p16.tiktokcdn.com/avatar.jpg",
    privacy_level_options: ["SELF_ONLY"],
    comment_disabled: false,
    duet_disabled: true,
    stitch_disabled: true,
    max_video_post_duration_sec: 600,
  };
  const { fn: tiktokFetchStub } = stubTiktokFetch({ creatorInfo: creatorInfoPayload });

  const handler = createPublishHandler(makeDeps(db, {
    getFreshTikTokToken: (() => Promise.resolve({ accessToken: "tok", openId: "open-1" })) as never,
    tiktokFetch: tiktokFetchStub,
  }));

  const res = await handler(tiktokRequest("creator-info", 5, { method: "GET" }));
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body, creatorInfoPayload);
  assertEquals(res.headers.get("Cache-Control"), "no-store");
});

// ============================================================
// publish-now
// ============================================================

Deno.test("tiktok-publish publish-now: success calls mark_platform_published and returns postado", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: basePost({ platform: "tiktok", tipo: "feed" }), error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);
  db.queueRpc("record_post_status_change", { data: null, error: null }); // -> agendado + lock
  db.queue("workflow_posts", "update", { data: null, error: null }); // lock timestamp
  db.queue("workflow_posts", "update", { data: null, error: null }); // init: publish_id/status
  db.queue("tiktok_accounts", "select", { data: { username: "dramarina" }, error: null }); // username lookup
  db.queueRpc("mark_platform_published", { data: null, error: null });

  const { fn: tiktokFetchStub, calls: fetchCalls } = stubTiktokFetch({
    init: { publish_id: "pub-1" },
    statusSequence: [{ status: "PUBLISH_COMPLETE", publicaly_available_post_id: "7123456" }],
  });

  // Real buildTikTokMediaUrl (not a stub) so the init payload's photo_images URL can be pinned
  // to the tiktok-media proxy shape and round-tripped back to the linked file's r2_key below —
  // same pattern as tiktok-publish-cron_test.ts's init-phase payload-shape test.
  const handler = createPublishHandler(makeDeps(db, {
    validateForTikTokScheduling: (() => Promise.resolve(okTikTokValidation())) as never,
    getFreshTikTokToken: (() => Promise.resolve({ accessToken: "tok", openId: "open-1" })) as never,
    tiktokFetch: tiktokFetchStub,
    buildTikTokMediaUrl,
    sleep: noopSleep,
  }));

  const res = await handler(tiktokRequest("publish-now", 1));
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body, { ok: true, status: "postado" });
  assertEquals(fetchCalls.length, 2); // one init + exactly one status-fetch (terminal on first poll)

  const initCall = fetchCalls.find((c) => c.path === "/post/publish/content/init/");
  assert(initCall, "feed (photo) post must POST to /post/publish/content/init/");
  const initBody = initCall!.body as { source_info: { photo_images: string[] } };
  const photoUrl = initBody.source_info.photo_images[0];
  assert(photoUrl.startsWith(MEDIA_URL_PREFIX), `photo_images entry must be a tiktok-media proxy URL, got ${photoUrl}`);
  assertEquals(
    await verifyTikTokMediaToken(photoUrl.slice(MEDIA_URL_PREFIX.length)),
    "img/1.jpg",
    "the proxy token must resolve back to the validated media's r2_key",
  );

  const markCalls = rpcCalls(db, "mark_platform_published");
  assertEquals(markCalls.length, 1);
  const payload = markCalls[0].payload as Record<string, unknown>;
  assertEquals(payload.p_post_id, 1);
  assertEquals(payload.p_platform, "tiktok");
  assertEquals(payload.p_source, "workspace_user");
  const fields = payload.p_fields as Record<string, unknown>;
  assertEquals(fields.tiktok_post_id, "7123456");
  assertEquals(fields.tiktok_post_url, "https://www.tiktok.com/@dramarina/video/7123456");
  assert(typeof fields.published_at === "string" && !isNaN(Date.parse(fields.published_at as string)));
});

Deno.test("tiktok-publish publish-now: still-processing after 12 polls -> agendado response, lock cleared", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: basePost({ platform: "tiktok", tipo: "feed" }), error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);
  db.queueRpc("record_post_status_change", { data: null, error: null });
  db.queue("workflow_posts", "update", { data: null, error: null }); // lock timestamp
  db.queue("workflow_posts", "update", { data: null, error: null }); // init: publish_id/status
  db.queue("workflow_posts", "update", { data: null, error: null }); // clear lock (still-processing exit)

  const { fn: tiktokFetchStub, calls: fetchCalls } = stubTiktokFetch({
    init: { publish_id: "pub-1" },
    statusSequence: [{ status: "PROCESSING_UPLOAD" }], // repeats for every poll (stub clamps index)
  });

  const handler = createPublishHandler(makeDeps(db, {
    validateForTikTokScheduling: (() => Promise.resolve(okTikTokValidation())) as never,
    getFreshTikTokToken: (() => Promise.resolve({ accessToken: "tok", openId: "open-1" })) as never,
    tiktokFetch: tiktokFetchStub,
    buildTikTokMediaUrl: ((key: string) => Promise.resolve(`https://r2.example/${key}?sig=1`)) as never,
    sleep: noopSleep,
  }));

  const res = await handler(tiktokRequest("publish-now", 1));
  const body = await res.json();

  assertEquals(res.status, 200);
  assertEquals(body.ok, true);
  assertEquals(body.status, "agendado");
  assert(typeof body.message === "string" && body.message.length > 0);

  // init + 12 status-fetch polls
  const statusFetchCalls = fetchCalls.filter((c) => c.path === "/post/publish/status/fetch/");
  assertEquals(statusFetchCalls.length, 12);

  assertEquals(rpcCalls(db, "mark_platform_published").length, 0);

  const updates = callsFor(db, "workflow_posts", "update");
  assertEquals(updates.length, 3);
  assertEquals(updates[2].payload, { tiktok_publish_processing_at: null });
});

Deno.test("tiktok-publish publish-now: TikTok validation failure -> 422, no status/lock mutation", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: basePost({ platform: "tiktok" }), error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);

  const handler = createPublishHandler(makeDeps(db, {
    validateForTikTokScheduling: (() =>
      Promise.resolve(okTikTokValidation({ ok: false, errors: ["Post precisa de pelo menos uma mídia."] }))) as never,
  }));

  const res = await handler(tiktokRequest("publish-now", 1));
  const body = await res.json();
  assertEquals(res.status, 422);
  assertEquals(body.details, ["Post precisa de pelo menos uma mídia."]);
  assertEquals(rpcCalls(db, "record_post_status_change").length, 0);
});

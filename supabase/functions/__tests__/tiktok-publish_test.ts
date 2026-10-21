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
import { TikTokApiError } from "../_shared/tiktok.ts";

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

/** The TikTok destination embed (targets_state:post_targets(id, platform, status, processing_at)). */
function ttTarget(status = "pendente", extra: Record<string, unknown> = {}) {
  return [{ id: 501, platform: "tiktok", status, processing_at: null, ...extra }];
}

function basePost(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    status: "aprovado_cliente",
    platform: "tiktok",
    tipo: "feed",
    tiktok_caption: "legenda tiktok",
    tiktok_title: null,
    tiktok_settings: { privacy_level: "SELF_ONLY" },
    ig_caption: null,
    targets_state: ttTarget(),
    ...overrides,
  };
}

/** No P4 path writes workflow_posts' status or tiktok_* columns directly. */
function assertNoLegacyTikTokWrites(db: ReturnType<typeof createSupabaseQueryMock>) {
  for (const c of callsFor(db, "workflow_posts", "update")) {
    const keys = Object.keys(c.payload as Record<string, unknown>);
    assert(!keys.some((k) => k.startsWith("tiktok_")), `legacy tiktok_* write: ${keys.join(",")}`);
    assert(!keys.includes("status"), "status must move only inside the RPCs");
  }
  assertEquals(rpcCalls(db, "record_post_status_change").length, 0, "status moves only inside the RPCs");
  assertEquals(rpcCalls(db, "mark_platform_published").length, 0, "the legacy writer is not called");
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
    media_lost_at: null,
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

Deno.test("tiktok-publish: the post select embeds the TikTok destination, not the frozen columns", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: basePost({ platform: "instagram" }), error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);

  const handler = createPublishHandler(makeDeps(db));
  await handler(tiktokRequest("schedule", 1, { body: { scheduled_at: "2030-01-01T12:00:00Z" } }));
  const select = String(callsFor(db, "workflow_posts", "select")[0].selectArgs[0][0]);
  assert(select.includes("targets_state:post_targets(id, platform, status, processing_at)"), select);
  assert(!select.includes("tiktok_publish_"), select);
});

// processando always refuses; publicado refuses only when nothing else is left to publish
// (TikTok-only, or Instagram already published). See the `both` + publicado tests below.
for (const [platform, status, extra, message] of [
  ["tiktok", "processando", {}, "Já está publicando no TikTok."],
  ["both", "processando", {}, "Já está publicando no TikTok."],
  ["tiktok", "publicado", {}, "Já publicado no TikTok."],
  ["both", "publicado", { instagram_media_id: "ig-media-1" }, "Já publicado no TikTok."],
] as const) {
  Deno.test(`tiktok-publish schedule: ${platform} post, destination ${status}${"instagram_media_id" in extra ? ", Instagram published" : ""} -> 422, nothing written`, async () => {
    const db = createSupabaseQueryMock();
    db.withAuth({ id: "actor-1" });
    db.queue("workflow_posts", "select", {
      data: basePost({ platform, targets_state: ttTarget(status), ...extra }),
      error: null,
    });
    db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
    gateOn(db);

    const handler = createPublishHandler(makeDeps(db, {
      validateForTikTokScheduling: (() => {
        throw new Error("must not validate");
      }) as never,
    }));
    const res = await handler(tiktokRequest("schedule", 1, { body: { scheduled_at: "2030-01-01T12:00:00Z" } }));
    assertEquals(res.status, 422);
    assertEquals(await res.json(), { error: message });
    assertEquals(callsFor(db, "workflow_posts", "update").length, 0);
    assertEquals(rpcCalls(db, "record_post_status_change").length, 0);
  });
}

Deno.test("tiktok-publish schedule: `both` post, TikTok publicado, Instagram pending -> schedules for Instagram only", async () => {
  // The post went back to draft mid-publish after TikTok landed. Scheduling it again is how
  // Instagram goes out: init never re-claims a publicado destination, and the recompute
  // reaches postado when Instagram lands.
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", {
    data: basePost({
      platform: "both",
      instagram_media_id: null,
      targets_state: [...ttTarget("publicado"), { id: 502, platform: "instagram", status: "pendente", processing_at: null }],
    }),
    error: null,
  });
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
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true, status: "agendado" });
  assertEquals(tiktokCalled, 0); // TikTok already published: nothing left to validate there
  assertEquals(igCalled, 1);
  const rpc = rpcCalls(db, "record_post_status_change");
  assertEquals(rpc.length, 1);
  assertEquals((rpc[0].payload as Record<string, unknown>).p_new_status, "agendado");
});

Deno.test("tiktok-publish schedule: `both` post, TikTok publicado, Instagram validation fails -> 422 with IG details only", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", {
    data: basePost({ platform: "both", targets_state: ttTarget("publicado"), scheduled_at: "2025-01-01T00:00:00Z" }),
    error: null,
  });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);
  db.queue("workflow_posts", "update", { data: null, error: null }); // candidate write
  db.queue("workflow_posts", "update", { data: null, error: null }); // restore write

  const handler = createPublishHandler(makeDeps(db, {
    validateForTikTokScheduling: (() => {
      throw new Error("must not validate TikTok");
    }) as never,
    validateForScheduling: (() =>
      Promise.resolve({ ok: false, errors: ["Legenda do Instagram não definida."] } as ScheduleValidationResult)) as never,
  }));

  const res = await handler(tiktokRequest("schedule", 1, { body: { scheduled_at: "2030-01-01T12:00:00Z" } }));
  assertEquals(res.status, 422);
  assertEquals(await res.json(), { error: "Validação falhou", details: ["Legenda do Instagram não definida."] });
  assertEquals(rpcCalls(db, "record_post_status_change").length, 0);
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

Deno.test("tiktok-publish retry: succeeds with both feature flags OFF (retry is ungated) and re-queues the destination", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", {
    data: basePost({ platform: "tiktok", status: "falha_publicacao", targets_state: ttTarget("falha") }),
    error: null,
  });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queueRpc("effective_plan_feature", { data: false, error: null }); // feature_post_scheduling OFF
  db.queueRpc("effective_plan_feature", { data: false, error: null }); // feature_tiktok OFF
  db.queueRpc("requeue_target", { data: true, error: null });

  const handler = createPublishHandler(makeDeps(db));
  const res = await handler(tiktokRequest("retry", 1));

  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true, status: "agendado" });
  assertEquals(db.calls.filter((c: QueryCall) => c.table === "rpc:effective_plan_feature").length, 0);
  assertEquals(rpcCalls(db, "requeue_target").map((c) => c.payload), [
    { p_post_id: 1, p_platform: "tiktok", p_source: "workspace_user", p_actor: "actor-1" },
  ]);
  assertEquals(callsFor(db, "workflow_posts", "update").length, 0);
  assertNoLegacyTikTokWrites(db);
});

Deno.test("tiktok-publish retry: `both` post already back at agendado (IG retried first) still re-queues TikTok (bug 2)", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", {
    data: basePost({ platform: "both", status: "agendado", targets_state: ttTarget("falha") }),
    error: null,
  });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queueRpc("requeue_target", { data: true, error: null });

  const handler = createPublishHandler(makeDeps(db));
  const res = await handler(tiktokRequest("retry", 1));
  assertEquals(res.status, 200);
  assertEquals(rpcCalls(db, "requeue_target").length, 1);
});

Deno.test("tiktok-publish retry: `both` post with both sides failed re-queues only TikTok and leaves the post to the recompute", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", {
    data: basePost({ platform: "both", status: "falha_publicacao", targets_state: ttTarget("falha") }),
    error: null,
  });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queueRpc("requeue_target", { data: true, error: null });

  const handler = createPublishHandler(makeDeps(db));
  const res = await handler(tiktokRequest("retry", 1));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true, status: "agendado" });
  assertEquals(rpcCalls(db, "requeue_target").map((c) => c.payload), [
    { p_post_id: 1, p_platform: "tiktok", p_source: "workspace_user", p_actor: "actor-1" },
  ]);
  // The post stays in falha_publicacao (Instagram still failed); only requeue_target's
  // recompute may move it, never a direct write from the handler.
  assertEquals(callsFor(db, "workflow_posts", "update").length, 0);
  assertNoLegacyTikTokWrites(db);
});

Deno.test("tiktok-publish retry: destination not in falha (the IG side failed) -> 422, no RPC", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", {
    data: basePost({ platform: "both", status: "falha_publicacao", targets_state: ttTarget("pendente") }),
    error: null,
  });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });

  const handler = createPublishHandler(makeDeps(db));
  const res = await handler(tiktokRequest("retry", 1));
  assertEquals(res.status, 422);
  assertEquals(await res.json(), { error: "Apenas posts com falha no TikTok podem ser reenviados." });
  assertEquals(rpcCalls(db, "requeue_target").length, 0);
});

Deno.test("tiktok-publish retry: post outside publication -> 422, no RPC", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", {
    data: basePost({ status: "rascunho", targets_state: ttTarget("falha") }),
    error: null,
  });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });

  const handler = createPublishHandler(makeDeps(db));
  const res = await handler(tiktokRequest("retry", 1));
  assertEquals(res.status, 422);
  assertEquals(rpcCalls(db, "requeue_target").length, 0);
});

Deno.test("tiktok-publish retry: requeue_target declining (race) -> 422", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", {
    data: basePost({ status: "falha_publicacao", targets_state: ttTarget("falha") }),
    error: null,
  });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queueRpc("requeue_target", { data: false, error: null });

  const handler = createPublishHandler(makeDeps(db));
  const res = await handler(tiktokRequest("retry", 1));
  assertEquals(res.status, 422);
});

// ============================================================
// cancel
// ============================================================

Deno.test("tiktok-publish cancel: succeeds with both feature flags OFF (cancel is ungated) via cancel_target_publish", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: basePost({ platform: "both", status: "agendado" }), error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queueRpc("effective_plan_feature", { data: false, error: null });
  db.queueRpc("effective_plan_feature", { data: false, error: null });
  db.queueRpc("cancel_target_publish", { data: null, error: null });

  const handler = createPublishHandler(makeDeps(db));
  const res = await handler(tiktokRequest("cancel", 1));

  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true, status: "aprovado_cliente" });
  assertEquals(db.calls.filter((c: QueryCall) => c.table === "rpc:effective_plan_feature").length, 0);
  assertEquals(rpcCalls(db, "cancel_target_publish").map((c) => c.payload), [
    { p_post_id: 1, p_platform: "tiktok", p_source: "workspace_user", p_actor: "actor-1" },
  ]);
  assertEquals(callsFor(db, "workflow_posts", "update").length, 0, "the IG field clearing moved into the RPC");
  assertNoLegacyTikTokWrites(db);
});

Deno.test("tiktok-publish cancel: post not agendado -> 422, no RPC", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: basePost({ status: "aprovado_cliente" }), error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });

  const handler = createPublishHandler(makeDeps(db));
  const res = await handler(tiktokRequest("cancel", 1));
  assertEquals(res.status, 422);
  assertEquals(await res.json(), { error: "Apenas posts agendados podem ser cancelados." });
  assertEquals(rpcCalls(db, "cancel_target_publish").length, 0);
});

Deno.test("tiktok-publish cancel: destination publishing -> 422 pt-BR from the P0422 identifier", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: basePost({ status: "agendado" }), error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queueRpc("cancel_target_publish", { data: null, error: { code: "P0422", message: "target_publishing" } });

  const handler = createPublishHandler(makeDeps(db));
  const res = await handler(tiktokRequest("cancel", 1));
  assertEquals(res.status, 422);
  assertEquals(await res.json(), { error: "Já está publicando no TikTok." });
});

Deno.test("tiktok-publish cancel: an unexpected RPC error -> generic 500, no raw text", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: basePost({ status: "agendado" }), error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queueRpc("cancel_target_publish", { data: null, error: { code: "XX000", message: "private db detail" } });

  const handler = createPublishHandler(makeDeps(db));
  const res = await handler(tiktokRequest("cancel", 1));
  assertEquals(res.status, 500);
  assert(!JSON.stringify(await res.json()).includes("private db detail"));
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
  assertEquals(body, { ...creatorInfoPayload, can_post: true, app_audited: false });
  assertEquals(res.headers.get("Cache-Control"), "no-store");
});

for (const code of ["spam_risk_too_many_posts", "spam_risk_user_banned_from_posting", "reached_active_user_cap"]) {
  Deno.test(`tiktok-publish creator-info: ${code} -> 200 can_post false`, async () => {
    const db = createSupabaseQueryMock();
    db.withAuth({ id: "actor-1" });
    db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
    db.queue("clientes", "select", { data: { conta_id: "ws-1" }, error: null });
    gateOn(db);
    db.queue("tiktok_accounts", "select", { data: { id: "acct-1", authorization_status: "active" }, error: null });

    const handler = createPublishHandler(makeDeps(db, {
      getFreshTikTokToken: (() => Promise.resolve({ accessToken: "tok", openId: "open-1" })) as never,
      tiktokFetch: (() => Promise.reject(new TikTokApiError("blocked", code, false))) as never,
    }));
    const res = await handler(tiktokRequest("creator-info", 5, { method: "GET" }));
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { can_post: false, cannot_post_reason: code, app_audited: false });
    assertEquals(res.headers.get("Cache-Control"), "no-store");
  });
}

Deno.test("tiktok-publish creator-info: app_audited true when TIKTOK_APP_AUDITED=true", async () => {
  Deno.env.set("TIKTOK_APP_AUDITED", "true");
  try {
    const db = createSupabaseQueryMock();
    db.withAuth({ id: "actor-1" });
    db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
    db.queue("clientes", "select", { data: { conta_id: "ws-1" }, error: null });
    gateOn(db);
    db.queue("tiktok_accounts", "select", { data: { id: "acct-1", authorization_status: "active" }, error: null });
    const { fn } = stubTiktokFetch({ creatorInfo: { privacy_level_options: ["SELF_ONLY"] } });
    const handler = createPublishHandler(makeDeps(db, {
      getFreshTikTokToken: (() => Promise.resolve({ accessToken: "tok", openId: "open-1" })) as never,
      tiktokFetch: fn,
    }));
    const body = await (await handler(tiktokRequest("creator-info", 5, { method: "GET" }))).json();
    assertEquals(body.app_audited, true);
    assertEquals(body.can_post, true);
  } finally {
    Deno.env.delete("TIKTOK_APP_AUDITED");
  }
});

Deno.test("tiktok-publish creator-info: other TikTok errors stay 500 generic", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queue("clientes", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);
  db.queue("tiktok_accounts", "select", { data: { id: "acct-1", authorization_status: "active" }, error: null });
  const handler = createPublishHandler(makeDeps(db, {
    getFreshTikTokToken: (() => Promise.resolve({ accessToken: "tok", openId: "open-1" })) as never,
    tiktokFetch: (() => Promise.reject(new TikTokApiError("boom", "internal_error", false))) as never,
  }));
  const res = await handler(tiktokRequest("creator-info", 5, { method: "GET" }));
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "Erro ao consultar informações do criador no TikTok." });
});

// ============================================================
// publish-now
// ============================================================

function initWrites(db: ReturnType<typeof createSupabaseQueryMock>) {
  return callsFor(db, "post_targets", "update")
    .filter((c) => (c.payload as Record<string, unknown>).status === "processando");
}

function failedCalls(db: ReturnType<typeof createSupabaseQueryMock>) {
  return rpcCalls(db, "mark_target_failed").map((c) => c.payload as Record<string, unknown>);
}

Deno.test("tiktok-publish publish-now: success takes the destination lock, inits, and calls mark_target_published", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: basePost({ platform: "tiktok", tipo: "feed" }), error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);
  db.queueRpc("begin_target_publish", { data: true, error: null });
  db.queue("tiktok_accounts", "select", { data: { username: "dramarina" }, error: null });
  db.queueRpc("mark_target_published", { data: null, error: null });

  const { fn: tiktokFetchStub, calls: fetchCalls } = stubTiktokFetch({
    init: { publish_id: "pub-1" },
    statusSequence: [{ status: "PUBLISH_COMPLETE", publicaly_available_post_id: "7123456" }],
  });

  const handler = createPublishHandler(makeDeps(db, {
    validateForTikTokScheduling: (() => Promise.resolve(okTikTokValidation())) as never,
    getFreshTikTokToken: (() => Promise.resolve({ accessToken: "tok", openId: "open-1" })) as never,
    tiktokFetch: tiktokFetchStub,
    fetchCreatorCheck: (() => Promise.resolve({ kind: "skip" })) as never,
    buildTikTokMediaUrl,
    sleep: noopSleep,
  }));

  const res = await handler(tiktokRequest("publish-now", 1));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true, status: "postado" });
  assertEquals(fetchCalls.length, 2); // one init + exactly one status-fetch

  const initCall = fetchCalls.find((c) => c.path === "/post/publish/content/init/");
  assert(initCall, "feed (photo) post must POST to /post/publish/content/init/");
  const photoUrl = (initCall!.body as { source_info: { photo_images: string[] } }).source_info.photo_images[0];
  assert(photoUrl.startsWith(MEDIA_URL_PREFIX), `photo_images entry must be a tiktok-media proxy URL, got ${photoUrl}`);
  assertEquals(await verifyTikTokMediaToken(photoUrl.slice(MEDIA_URL_PREFIX.length)), "img/1.jpg");

  assertEquals(rpcCalls(db, "begin_target_publish").map((c) => c.payload), [
    { p_post_id: 1, p_platform: "tiktok", p_source: "workspace_user", p_actor: "actor-1" },
  ]);

  const inits = initWrites(db);
  assertEquals(inits.length, 1);
  const initPayload = inits[0].payload as Record<string, unknown>;
  assertEquals(initPayload.publish_ref, "pub-1");
  assert(typeof initPayload.updated_at === "string");
  assert(inits[0].modifiers.some((m) => m.method === "eq" && m.args[0] === "post_id" && m.args[1] === 1));
  assert(inits[0].modifiers.some((m) => m.method === "eq" && m.args[0] === "platform" && m.args[1] === "tiktok"));

  const marks = rpcCalls(db, "mark_target_published");
  assertEquals(marks.length, 1);
  const payload = marks[0].payload as Record<string, unknown>;
  assertEquals(payload.p_post_id, 1);
  assertEquals(payload.p_platform, "tiktok");
  assertEquals(payload.p_source, "workspace_user");
  assertEquals(payload.p_actor, "actor-1");
  const fields = payload.p_fields as Record<string, unknown>;
  assertEquals(fields.external_id, "7123456");
  assertEquals(fields.permalink, "https://www.tiktok.com/@dramarina/photo/7123456");
  assert(typeof fields.published_at === "string" && !isNaN(Date.parse(fields.published_at as string)));
  assertNoLegacyTikTokWrites(db);
});

Deno.test("tiktok-publish publish-now: a `both` post Instagram already moved to agendado still publishes (bug 1)", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: basePost({ platform: "both", status: "agendado" }), error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);
  db.queueRpc("begin_target_publish", { data: true, error: null });
  db.queue("tiktok_accounts", "select", { data: { username: "dramarina" }, error: null });

  const { fn } = stubTiktokFetch({ statusSequence: [{ status: "PUBLISH_COMPLETE" }] });
  const handler = createPublishHandler(makeDeps(db, {
    validateForTikTokScheduling: (() => Promise.resolve(okTikTokValidation())) as never,
    getFreshTikTokToken: (() => Promise.resolve({ accessToken: "tok", openId: "open-1" })) as never,
    tiktokFetch: fn,
    fetchCreatorCheck: (() => Promise.resolve({ kind: "skip" })) as never,
    buildTikTokMediaUrl,
    sleep: noopSleep,
  }));

  const res = await handler(tiktokRequest("publish-now", 1));
  assertEquals(res.status, 200);
  assertEquals(rpcCalls(db, "begin_target_publish").length, 1);
  assertEquals(rpcCalls(db, "mark_target_published").length, 1);
});

Deno.test("tiktok-publish publish-now: still-processing after 12 polls -> agendado response, destination lock released", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: basePost({ platform: "tiktok", tipo: "feed" }), error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);
  db.queueRpc("begin_target_publish", { data: true, error: null });

  const { fn: tiktokFetchStub, calls: fetchCalls } = stubTiktokFetch({
    init: { publish_id: "pub-1" },
    statusSequence: [{ status: "PROCESSING_UPLOAD" }],
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
  assertEquals(fetchCalls.filter((c) => c.path === "/post/publish/status/fetch/").length, 12);
  assertEquals(rpcCalls(db, "mark_target_published").length, 0);

  const updates = callsFor(db, "post_targets", "update");
  assertEquals(updates.length, 2, "init write + lock release");
  const release = updates[1].payload as Record<string, unknown>;
  assertEquals(Object.keys(release), ["processing_at", "updated_at"]);
  assertEquals(release.processing_at, null);
  assertNoLegacyTikTokWrites(db);
});

Deno.test("tiktok-publish publish-now: TikTok validation failure -> 422 before taking the lock", async () => {
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
  assertEquals(rpcCalls(db, "begin_target_publish").length, 0);
  assertEquals(rpcCalls(db, "mark_target_failed").length, 0);
});

Deno.test("tiktok-publish publish-now: lock held -> 409, never reaches TikTok", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: basePost(), error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);
  db.queueRpc("begin_target_publish", { data: false, error: null });

  const handler = createPublishHandler(makeDeps(db, {
    validateForTikTokScheduling: (() => Promise.resolve(okTikTokValidation())) as never,
    tiktokFetch: (() => {
      throw new Error("must not call TikTok");
    }) as never,
  }));

  const res = await handler(tiktokRequest("publish-now", 1));
  assertEquals(res.status, 409);
  assertEquals(await res.json(), { error: "Já está publicando no TikTok." });
  assertEquals(rpcCalls(db, "mark_target_failed").length, 0);
});

for (const [identifier, message] of [
  ["target_not_ready", "O envio anterior para o TikTok falhou. Use Reenviar para tentar de novo."],
  ["target_published", "Já publicado no TikTok."],
  ["post_not_publishable", "Post precisa estar aprovado pelo cliente para publicar."],
] as const) {
  Deno.test(`tiktok-publish publish-now: begin_target_publish refusal ${identifier} -> 422 pt-BR`, async () => {
    const db = createSupabaseQueryMock();
    db.withAuth({ id: "actor-1" });
    db.queue("workflow_posts", "select", { data: basePost(), error: null });
    db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
    gateOn(db);
    db.queueRpc("begin_target_publish", { data: null, error: { code: "P0422", message: identifier } });

    const handler = createPublishHandler(makeDeps(db, {
      validateForTikTokScheduling: (() => Promise.resolve(okTikTokValidation())) as never,
    }));
    const res = await handler(tiktokRequest("publish-now", 1));
    assertEquals(res.status, 422);
    assertEquals(await res.json(), { error: message });
  });
}

Deno.test("tiktok-publish publish-now: destination already processando (embed) -> 422 without the RPC", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", {
    data: basePost({ status: "agendado", targets_state: ttTarget("processando") }),
    error: null,
  });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);

  const handler = createPublishHandler(makeDeps(db));
  const res = await handler(tiktokRequest("publish-now", 1));
  assertEquals(res.status, 422);
  assertEquals(await res.json(), { error: "Já está publicando no TikTok." });
  assertEquals(rpcCalls(db, "begin_target_publish").length, 0);
});

Deno.test("tiktok-publish publish-now: post outside aprovado_cliente/agendado -> 422", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: basePost({ status: "rascunho" }), error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);

  const handler = createPublishHandler(makeDeps(db));
  const res = await handler(tiktokRequest("publish-now", 1));
  assertEquals(res.status, 422);
  assertEquals(await res.json(), { error: "Post precisa estar aprovado pelo cliente para publicar." });
  assertEquals(rpcCalls(db, "begin_target_publish").length, 0);
});

for (const outcome of ["replaced", "invalid", "read-error"] as const) {
  Deno.test(`tiktok-publish publish-now: media changes before claiming (${outcome})`, async () => {
    const db = createSupabaseQueryMock();
    db.withAuth({ id: "actor-1" });
    db.queue("workflow_posts", "select", { data: basePost(), error: null });
    db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
    gateOn(db);

    let publishingClaimed = false;
    // The replacement transaction wins the workflow_posts row lock after preflight
    // validation, immediately before begin_target_publish takes the destination lock.
    db.queueRpc("begin_target_publish", () => {
      publishingClaimed = true;
      return { data: true, error: null };
    });
    db.queue("tiktok_accounts", "select", { data: { username: "creator" }, error: null });

    const { fn: tiktokFetchStub, calls: fetchCalls } = stubTiktokFetch();
    const handler = createPublishHandler(makeDeps(db, {
      validateForTikTokScheduling: (() => {
        if (!publishingClaimed) return Promise.resolve(okTikTokValidation());
        if (outcome === "read-error") throw new Error("private database read details");
        if (outcome === "invalid") {
          return Promise.resolve(okTikTokValidation({
            ok: false,
            errors: ["Post precisa de pelo menos uma mídia."],
            media: [],
          }));
        }
        const replacement = okTikTokValidation();
        replacement.media![0].r2_key = "img/replacement.jpg";
        return Promise.resolve(replacement);
      }) as never,
      getFreshTikTokToken: (() => Promise.resolve({ accessToken: "tok", openId: "open-1" })) as never,
      tiktokFetch: tiktokFetchStub,
      buildTikTokMediaUrl,
      sleep: noopSleep,
    }));

    const res = await handler(tiktokRequest("publish-now", 1));
    const body = await res.json();
    if (outcome === "replaced") {
      assertEquals(res.status, 200);
      const init = fetchCalls.find((call) => call.path === "/post/publish/content/init/");
      assert(init);
      const photoUrl = (init.body as { source_info: { photo_images: string[] } }).source_info.photo_images[0];
      assertEquals(
        await verifyTikTokMediaToken(photoUrl.slice(MEDIA_URL_PREFIX.length)),
        "img/replacement.jpg",
        "TikTok must receive the replacement file, even though the old R2 object still exists",
      );
    } else {
      assertEquals(res.status, outcome === "invalid" ? 422 : 500);
      assertEquals(fetchCalls.length, 0, "invalid or unreadable replacement must never reach TikTok");
      if (outcome === "invalid") assertEquals(body.details, ["Post precisa de pelo menos uma mídia."]);
      assert(!JSON.stringify(body).includes("private database read details"));
      const failed = failedCalls(db);
      assertEquals(failed.length, 1);
      assertEquals(failed[0].p_retryable, true);
      assertEquals(failed[0].p_source, "workspace_user");
      assertEquals(failed[0].p_actor, "actor-1");
      assert(!String(failed[0].p_error).includes("private database read details"));
    }
    assertNoLegacyTikTokWrites(db);
  });
}

Deno.test("tiktok-publish publish-now: precheck failure -> 422 with pt-BR message, non-retryable, no init", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: basePost({ platform: "tiktok", tipo: "reels" }), error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);
  db.queueRpc("begin_target_publish", { data: true, error: null });

  const { fn, calls } = stubTiktokFetch();
  const handler = createPublishHandler(makeDeps(db, {
    validateForTikTokScheduling: (() => Promise.resolve(okTikTokValidation({
      media: [{ id: 1, kind: "video", mime_type: "video/mp4", size_bytes: 1, width: 1080, height: 1920,
        duration_seconds: 750, r2_key: "v.mp4", sort_order: 0, media_lost_at: null }],
    }))) as never,
    getFreshTikTokToken: (() => Promise.resolve({ accessToken: "tok", openId: "open-1" })) as never,
    tiktokFetch: fn,
    fetchCreatorCheck: (() => Promise.resolve({ kind: "ok", privacyLevelOptions: ["SELF_ONLY"], maxVideoPostDurationSec: 600 })) as never,
    buildTikTokMediaUrl,
    sleep: noopSleep,
  }));

  const res = await handler(tiktokRequest("publish-now", 1));
  assertEquals(res.status, 422);
  assertEquals(await res.json(), { error: "Este vídeo tem 750s. O máximo permitido para esta conta é 600s." });
  assertEquals(calls.filter((c) => c.path.endsWith("/init/")).length, 0);
  assertEquals(failedCalls(db), [{
    p_post_id: 1,
    p_platform: "tiktok",
    p_error: "Este vídeo tem 750s. O máximo permitido para esta conta é 600s.",
    p_error_code: null,
    p_retryable: false,
    p_source: "workspace_user",
    p_actor: "actor-1",
  }]);
  assertNoLegacyTikTokWrites(db);
});

Deno.test("tiktok-publish publish-now: mapped init error -> 422 pt-BR, non-retryable", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: basePost({ platform: "tiktok", tipo: "feed" }), error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);
  db.queueRpc("begin_target_publish", { data: true, error: null });

  const initCalls: string[] = [];
  const handler = createPublishHandler(makeDeps(db, {
    validateForTikTokScheduling: (() => Promise.resolve(okTikTokValidation())) as never,
    getFreshTikTokToken: (() => Promise.resolve({ accessToken: "tok", openId: "open-1" })) as never,
    tiktokFetch: ((path: string) => {
      initCalls.push(path);
      return Promise.reject(new TikTokApiError("unaudited", "unaudited_client_can_only_post_to_private_accounts", false));
    }) as never,
    fetchCreatorCheck: (() => Promise.resolve({ kind: "skip" })) as never,
    buildTikTokMediaUrl,
    sleep: noopSleep,
  }));

  const res = await handler(tiktokRequest("publish-now", 1));
  const mapped = "Em modo de teste, a conta do TikTok precisa estar privada. Altere no app do TikTok e tente novamente.";
  assertEquals(res.status, 422);
  assertEquals(await res.json(), { error: mapped });
  assertEquals(initCalls, ["/post/publish/content/init/"]);
  const failed = failedCalls(db);
  assertEquals(failed.length, 1);
  assertEquals(failed[0].p_error, mapped);
  assertEquals(failed[0].p_retryable, false);
});

Deno.test("tiktok-publish publish-now: unmapped init error stays retryable and returns the generic 500", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: basePost({ platform: "tiktok", tipo: "feed" }), error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  gateOn(db);
  db.queueRpc("begin_target_publish", { data: true, error: null });

  const handler = createPublishHandler(makeDeps(db, {
    validateForTikTokScheduling: (() => Promise.resolve(okTikTokValidation())) as never,
    getFreshTikTokToken: (() => Promise.resolve({ accessToken: "tok", openId: "open-1" })) as never,
    tiktokFetch: (() => Promise.reject(new Error("socket hang up"))) as never,
    fetchCreatorCheck: (() => Promise.resolve({ kind: "skip" })) as never,
    buildTikTokMediaUrl,
    sleep: noopSleep,
  }));

  const res = await handler(tiktokRequest("publish-now", 1));
  assertEquals(res.status, 500);
  const failed = failedCalls(db);
  assertEquals(failed.length, 1);
  assertEquals(failed[0].p_error, "socket hang up");
  assertEquals(failed[0].p_retryable, true);
  assertNoLegacyTikTokWrites(db);
});

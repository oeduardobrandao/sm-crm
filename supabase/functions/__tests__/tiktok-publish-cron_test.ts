// tiktok-publish-cron (Task B5, P4) — handler.ts's timingSafeEqual auth gate tested in isolation;
// core.ts's business logic tested via DI'd getFreshTikTokToken / tiktokFetch / buildTikTokMediaUrl /
// reportCronFailure against the shared supabaseMock. P4: the cron claims TikTok DESTINATIONS
// (claim_tiktok_targets_for_publishing), writes `post_targets` by target_id, and every transition
// that moves the post's status goes through a SECURITY DEFINER RPC (mark_target_failed,
// mark_target_published, requeue_target). No test here may see a workflow_posts write.
//
// buildTikTokMediaUrl: TikTok's PULL_FROM_URL source needs a TikTok-verifiable URL prefix, which
// raw *.r2.cloudflarestorage.com presigned URLs can't satisfy. Most tests stub it; test (c) uses
// the REAL shared implementation to pin the URL shape TikTok actually receives.
import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import type { QueryCall } from "../../../test/shared/supabaseMock.ts";
import { createTikTokPublishCronHandler } from "../tiktok-publish-cron/handler.ts";
import { runTikTokPublishCron, type TikTokPublishCronDeps } from "../tiktok-publish-cron/core.ts";
import { FIELD_PUBLIC_POST_ID, TikTokApiError } from "../_shared/tiktok.ts";
import { buildTikTokMediaUrl, verifyTikTokMediaToken } from "../_shared/tiktok-media-url.ts";

const timingSafeEqual = (a: string, b: string) => a === b;

Deno.env.set("TOKEN_ENCRYPTION_KEY", "test-tiktok-publish-cron-key");
Deno.env.set("SUPABASE_URL", "https://supabase.example");
const MEDIA_URL_PREFIX = "https://supabase.example/functions/v1/tiktok-media/m/";
const NOW = new Date("2026-10-13T12:00:00.000Z");
const NOW_ISO = NOW.toISOString();

type Db = ReturnType<typeof createSupabaseQueryMock>;

function callsFor(db: Db, table: string, operation: string) {
  return db.calls.filter((c: QueryCall) => c.table === table && c.operation === operation);
}

function rpcCalls(db: Db, name: string) {
  return db.calls.filter((c: QueryCall) => c.table === `rpc:${name}`);
}

function eqId(call: QueryCall): unknown {
  return call.modifiers.find((m) => m.method === "eq" && m.args[0] === "id")?.args[1];
}

/** No P4 code path writes workflow_posts directly any more. */
function assertNoWorkflowPostWrites(db: Db) {
  assertEquals(callsFor(db, "workflow_posts", "update").length, 0, "no direct workflow_posts write");
  assertEquals(rpcCalls(db, "record_post_status_change").length, 0, "status moves only inside the RPCs");
  assertEquals(rpcCalls(db, "claim_posts_for_tiktok_publishing").length, 0, "the old claim is never called");
}

// Matches claim_tiktok_targets_for_publishing's RETURNS TABLE (20261013000003).
// target_id defaults to 1000 + post_id so assertions can tell the two apart.
function claimedPost(overrides: Partial<Record<string, unknown>> = {}) {
  const postId = (overrides.post_id as number | undefined) ?? 1;
  return {
    post_id: postId,
    conta_id: "conta-1",
    cliente_id: 101,
    tipo: "feed",
    scheduled_at: new Date().toISOString(),
    caption: "legenda",
    tiktok_title: null,
    tiktok_settings: { privacy_level: "SELF_ONLY" },
    tiktok_username: "dktest",
    tiktok_account_id: "acct-1",
    target_id: 1000 + postId,
    publish_ref: null,
    retry_count: 0,
    ...overrides,
  };
}

/** Queues the three claim responses in call order (init, status, retry). */
function queueClaims(db: Db, init: unknown[], status: unknown[], retry: unknown[]) {
  db.queueRpc("claim_tiktok_targets_for_publishing", { data: init, error: null });
  db.queueRpc("claim_tiktok_targets_for_publishing", { data: status, error: null });
  db.queueRpc("claim_tiktok_targets_for_publishing", { data: retry, error: null });
}

function unreachable(label: string) {
  return () => {
    throw new Error(`must not be called: ${label}`);
  };
}

function baseDeps(db: Db, overrides: Partial<TikTokPublishCronDeps> = {}): TikTokPublishCronDeps {
  return {
    svc: db as never,
    getFreshTikTokToken: (unreachable("getFreshTikTokToken") as unknown) as TikTokPublishCronDeps["getFreshTikTokToken"],
    tiktokFetch: (unreachable("tiktokFetch") as unknown) as TikTokPublishCronDeps["tiktokFetch"],
    buildTikTokMediaUrl: (unreachable("buildTikTokMediaUrl") as unknown) as TikTokPublishCronDeps["buildTikTokMediaUrl"],
    reportCronFailure: async () => {},
    now: () => NOW,
    ...overrides,
  };
}

function failedPayload(postId: number, error: string, errorCode: string | null, retryable: boolean) {
  return {
    p_post_id: postId,
    p_platform: "tiktok",
    p_error: error,
    p_error_code: errorCode,
    p_retryable: retryable,
    p_source: "system",
    p_actor: null,
  };
}

// ── (a) auth gate rejects before any DB access ──────────────────────────────────

Deno.test("tiktok-publish-cron: missing x-cron-secret returns 401 before any DB access", async () => {
  const db = createSupabaseQueryMock();
  const handler = createTikTokPublishCronHandler({
    cronSecret: "segredo-cron",
    timingSafeEqual,
    run: async () => runTikTokPublishCron(baseDeps(db)),
  });

  const response = await handler(new Request("https://example.test/tiktok-publish-cron"));
  assertEquals(response.status, 401);
  assertEquals(db.calls.length, 0, "no query should run before the secret check");
});

Deno.test("tiktok-publish-cron: wrong x-cron-secret returns 401 before any DB access", async () => {
  const db = createSupabaseQueryMock();
  const handler = createTikTokPublishCronHandler({
    cronSecret: "segredo-cron",
    timingSafeEqual,
    run: async () => runTikTokPublishCron(baseDeps(db)),
  });

  const response = await handler(
    new Request("https://example.test/tiktok-publish-cron", { headers: { "x-cron-secret": "errado" } }),
  );
  assertEquals(response.status, 401);
  assertEquals(db.calls.length, 0, "no query should run before the secret check");
});

// ── (b) init phase: per-account cap + token-once-per-account ───────────────────

Deno.test("tiktok-publish-cron init phase: caps at 5 inits per account, releases overflow destination locks", async () => {
  const db = createSupabaseQueryMock();
  const sevenPosts = Array.from({ length: 7 }, (_, i) => claimedPost({ post_id: i + 1 }));
  queueClaims(db, sevenPosts, [], []);

  const tokenCalls: string[] = [];
  const initCalls: string[] = [];

  const response = await runTikTokPublishCron(baseDeps(db, {
    getFreshTikTokToken: async (_svc, accountId) => {
      tokenCalls.push(accountId);
      return { accessToken: "tok", openId: "open-1" };
    },
    tiktokFetch: async (path) => {
      initCalls.push(path);
      return { publish_id: `pub-${initCalls.length}` };
    },
    buildTikTokMediaUrl: async (key) => `https://signed.example/${key}`,
    fetchPostMedia: async () => [{ id: 1, kind: "image", r2_key: "img/1.jpg", sort_order: 0 }],
    fetchCreatorCheck: async () => ({ kind: "skip" }),
    fetchPrecheckMedia: async () => [{ kind: "image", duration_seconds: null, media_lost_at: null }],
  }));

  assertEquals(response.status, 200);
  assertEquals(rpcCalls(db, "claim_tiktok_targets_for_publishing").map((c) => c.payload), [
    { p_phase: "init", p_limit: 25 },
    { p_phase: "status", p_limit: 25 },
    { p_phase: "retry", p_limit: 10 },
  ]);
  assertEquals(tokenCalls, ["acct-1"], "token must be fetched exactly once for the whole account batch");
  assertEquals(initCalls.length, 5, "only 5 of the 7 claimed posts get an init call this run");

  const updates = callsFor(db, "post_targets", "update");
  assertEquals(updates.length, 7, "5 init writes + 2 overflow lock releases");

  const overflow = updates.filter((c) => !("status" in (c.payload as Record<string, unknown>)));
  assertEquals(overflow.map((c) => c.payload), [
    { processing_at: null, updated_at: NOW_ISO },
    { processing_at: null, updated_at: NOW_ISO },
  ]);
  assertEquals(overflow.map(eqId), [1006, 1007], "overflow releases the destinations, by target_id");

  const inited = updates.filter((c) => (c.payload as Record<string, unknown>).status === "processando");
  assertEquals(inited.length, 5);
  assertEquals(inited[0].payload, {
    status: "processando",
    publish_ref: "pub-1",
    processing_at: null,
    updated_at: NOW_ISO,
  });
  assertEquals(eqId(inited[0]), 1001);
  assertNoWorkflowPostWrites(db);
});

// ── (c) init phase: payload shape per tipo ──────────────────────────────────────

Deno.test("tiktok-publish-cron init phase: reels hits video/init with a video payload; carrossel hits content/init with a photo payload", async () => {
  const db = createSupabaseQueryMock();
  const videoPost = claimedPost({ post_id: 10, tipo: "reels", caption: "legenda video" });
  const carrosselPost = claimedPost({
    post_id: 11,
    tiktok_account_id: "acct-2",
    tipo: "carrossel",
    caption: "legenda carrossel",
  });
  queueClaims(db, [videoPost, carrosselPost], [], []);

  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];

  const response = await runTikTokPublishCron(baseDeps(db, {
    getFreshTikTokToken: async () => ({ accessToken: "tok", openId: "open-1" }),
    tiktokFetch: async (path, init) => {
      calls.push({ path, body: JSON.parse(String(init.body)) });
      return { publish_id: `pub-${calls.length}` };
    },
    buildTikTokMediaUrl,
    fetchPostMedia: async (_db, postId) =>
      postId === 10
        ? [{ id: 1, kind: "video", r2_key: "vid/1.mp4", sort_order: 0 }]
        : [
          { id: 2, kind: "image", r2_key: "img/1.jpg", sort_order: 0 },
          { id: 3, kind: "image", r2_key: "img/2.jpg", sort_order: 1 },
        ],
    fetchCreatorCheck: async () => ({ kind: "skip" }),
    fetchPrecheckMedia: async () => [{ kind: "image", duration_seconds: null, media_lost_at: null }],
  }));

  assertEquals(response.status, 200);
  assertEquals(calls.length, 2);

  const videoCall = calls.find((c) => c.path === "/post/publish/video/init/");
  assert(videoCall, "video (reels) post must POST to /post/publish/video/init/");
  const videoBody = videoCall!.body as { source_info: Record<string, unknown>; post_info: Record<string, unknown> };
  assertEquals(videoBody.source_info.source, "PULL_FROM_URL");
  const videoUrl = videoBody.source_info.video_url as string;
  assert(videoUrl.startsWith(MEDIA_URL_PREFIX), `video_url must be a tiktok-media proxy URL, got ${videoUrl}`);
  assertEquals(await verifyTikTokMediaToken(videoUrl.slice(MEDIA_URL_PREFIX.length)), "vid/1.mp4");
  assertEquals(videoBody.post_info.title, "legenda video");

  const photoCall = calls.find((c) => c.path === "/post/publish/content/init/");
  assert(photoCall, "carrossel post must POST to /post/publish/content/init/");
  const photoBody = photoCall!.body as {
    media_type: string;
    post_mode: string;
    source_info: Record<string, unknown>;
    post_info: Record<string, unknown>;
  };
  assertEquals(photoBody.media_type, "PHOTO");
  assertEquals(photoBody.post_mode, "DIRECT_POST");
  const photoUrls = photoBody.source_info.photo_images as string[];
  assertEquals(photoUrls.length, 2);
  for (const url of photoUrls) {
    assert(url.startsWith(MEDIA_URL_PREFIX), `photo_images entries must be tiktok-media proxy URLs, got ${url}`);
  }
  assertEquals(
    await Promise.all(photoUrls.map((u) => verifyTikTokMediaToken(u.slice(MEDIA_URL_PREFIX.length)))),
    ["img/1.jpg", "img/2.jpg"],
  );
  assertEquals(photoBody.post_info.description, "legenda carrossel");
});

// ── (d) init phase: precheck, mapped / unmapped errors, token errors ──────────

Deno.test("tiktok-publish-cron init phase: precheck failure -> non-retryable mark_target_failed, no init call", async () => {
  const db = createSupabaseQueryMock();
  queueClaims(db, [claimedPost({ post_id: 1, tipo: "reels" })], [], []);

  const fetchPaths: string[] = [];
  const response = await runTikTokPublishCron(baseDeps(db, {
    getFreshTikTokToken: async () => ({ accessToken: "tok", openId: "open-1" }),
    tiktokFetch: async (path) => {
      fetchPaths.push(path);
      return { publish_id: "pub-1" };
    },
    buildTikTokMediaUrl: async (key) => `https://signed.example/${key}`,
    fetchPostMedia: async () => [{ id: 1, kind: "video", r2_key: "vid/1.mp4", sort_order: 0 }],
    fetchCreatorCheck: async () => ({ kind: "cannot_post", code: "spam_risk_too_many_posts" }),
    fetchPrecheckMedia: async () => [{ kind: "video", duration_seconds: 10, media_lost_at: null }],
  }));

  assertEquals(response.status, 200);
  assertEquals(fetchPaths, [], "a precheck failure must never reach TikTok init");
  assertEquals(rpcCalls(db, "mark_target_failed").map((c) => c.payload), [
    failedPayload(1, "Esta conta atingiu o limite diário de publicações do TikTok. Tente novamente amanhã.", null, false),
  ]);
  assertEquals(callsFor(db, "post_targets", "update").length, 0);
  assertNoWorkflowPostWrites(db);
});

Deno.test("tiktok-publish-cron init phase: creator check runs once per account, with that account's token", async () => {
  const db = createSupabaseQueryMock();
  queueClaims(db, [
    claimedPost({ post_id: 1 }),
    claimedPost({ post_id: 2 }),
    claimedPost({ post_id: 3, tiktok_account_id: "acct-2" }),
  ], [], []);

  const checkedWith: string[] = [];
  const response = await runTikTokPublishCron(baseDeps(db, {
    getFreshTikTokToken: async (_svc, accountId) => ({ accessToken: `tok-${accountId}`, openId: "open-1" }),
    tiktokFetch: async () => ({ publish_id: "pub-x" }),
    buildTikTokMediaUrl: async (key) => `https://signed.example/${key}`,
    fetchPostMedia: async () => [{ id: 1, kind: "image", r2_key: "img/1.jpg", sort_order: 0 }],
    fetchCreatorCheck: async (_tiktokFetch, accessToken) => {
      checkedWith.push(accessToken);
      return { kind: "skip" };
    },
    fetchPrecheckMedia: async () => [{ kind: "image", duration_seconds: null, media_lost_at: null }],
  }));

  assertEquals(response.status, 200);
  assertEquals(checkedWith, ["tok-acct-1", "tok-acct-2"], "one creator_info call per account, never per post");
  const inited = callsFor(db, "post_targets", "update")
    .filter((c) => (c.payload as Record<string, unknown>).status === "processando");
  assertEquals(inited.map(eqId), [1001, 1002, 1003]);
});

Deno.test("tiktok-publish-cron init phase: mapped TikTok init error -> pt-BR message, non-retryable", async () => {
  const db = createSupabaseQueryMock();
  queueClaims(db, [claimedPost({ post_id: 1 })], [], []);

  const response = await runTikTokPublishCron(baseDeps(db, {
    getFreshTikTokToken: async () => ({ accessToken: "tok", openId: "open-1" }),
    tiktokFetch: async () => {
      throw new TikTokApiError("unaudited", "unaudited_client_can_only_post_to_private_accounts", false);
    },
    buildTikTokMediaUrl: async (key) => `https://signed.example/${key}`,
    fetchPostMedia: async () => [{ id: 1, kind: "image", r2_key: "img/1.jpg", sort_order: 0 }],
    fetchCreatorCheck: async () => ({ kind: "skip" }),
    fetchPrecheckMedia: async () => [{ kind: "image", duration_seconds: null, media_lost_at: null }],
  }));

  assertEquals(response.status, 200);
  assertEquals(rpcCalls(db, "mark_target_failed").map((c) => c.payload), [
    failedPayload(
      1,
      "Em modo de teste, a conta do TikTok precisa estar privada. Altere no app do TikTok e tente novamente.",
      null,
      false,
    ),
  ]);
  assertNoWorkflowPostWrites(db);
});

Deno.test("tiktok-publish-cron init phase: unmapped init error stays retryable with the raw message", async () => {
  const db = createSupabaseQueryMock();
  queueClaims(db, [claimedPost({ post_id: 1, retry_count: 1 })], [], []);

  const response = await runTikTokPublishCron(baseDeps(db, {
    getFreshTikTokToken: async () => ({ accessToken: "tok", openId: "open-1" }),
    tiktokFetch: async () => {
      throw new Error("network down");
    },
    buildTikTokMediaUrl: async (key) => `https://signed.example/${key}`,
    fetchPostMedia: async () => [{ id: 1, kind: "image", r2_key: "img/1.jpg", sort_order: 0 }],
    fetchCreatorCheck: async () => ({ kind: "skip" }),
    fetchPrecheckMedia: async () => [{ kind: "image", duration_seconds: null, media_lost_at: null }],
  }));

  assertEquals(response.status, 200);
  assertEquals(rpcCalls(db, "mark_target_failed").map((c) => c.payload), [
    failedPayload(1, "network down", null, true),
  ]);
});

Deno.test("tiktok-publish-cron init phase: TOKEN_INVALID from the creator check fails every post of the account, retryable, no init", async () => {
  const db = createSupabaseQueryMock();
  queueClaims(db, [claimedPost({ post_id: 1 }), claimedPost({ post_id: 2 })], [], []);

  const fetchPaths: string[] = [];
  const response = await runTikTokPublishCron(baseDeps(db, {
    getFreshTikTokToken: async () => ({ accessToken: "tok", openId: "open-1" }),
    tiktokFetch: async (path) => {
      fetchPaths.push(path);
      return { publish_id: "pub-x" };
    },
    buildTikTokMediaUrl: async (key) => `https://signed.example/${key}`,
    fetchPostMedia: async () => [{ id: 1, kind: "image", r2_key: "img/1.jpg", sort_order: 0 }],
    fetchCreatorCheck: async () => {
      throw new TikTokApiError("access token invalid", "TOKEN_INVALID", false);
    },
    fetchPrecheckMedia: async () => [{ kind: "image", duration_seconds: null, media_lost_at: null }],
  }));

  assertEquals(response.status, 200);
  assertEquals(fetchPaths, []);
  assertEquals(rpcCalls(db, "mark_target_failed").map((c) => c.payload), [
    failedPayload(1, "Erro ao obter token do TikTok: access token invalid", null, true),
    failedPayload(2, "Erro ao obter token do TikTok: access token invalid", null, true),
  ]);
});

// ── (e) status phase: PUBLISH_COMPLETE ──────────────────────────────────────────

Deno.test("tiktok-publish-cron status phase: PUBLISH_COMPLETE with a public id calls mark_target_published with a built permalink", async () => {
  const db = createSupabaseQueryMock();
  const post = claimedPost({ post_id: 30, publish_ref: "pub-30", tiktok_username: "dktest" });
  queueClaims(db, [], [post], []);

  const fetchBodies: unknown[] = [];
  const response = await runTikTokPublishCron(baseDeps(db, {
    getFreshTikTokToken: async () => ({ accessToken: "tok", openId: "open-1" }),
    tiktokFetch: async (_path, init) => {
      fetchBodies.push(JSON.parse(String(init.body)));
      return { status: "PUBLISH_COMPLETE", [FIELD_PUBLIC_POST_ID]: "7301234" };
    },
    buildTikTokMediaUrl: async () => "",
  }));

  assertEquals(response.status, 200);
  assertEquals(fetchBodies, [{ publish_id: "pub-30" }], "status fetch uses the destination's publish_ref");
  assertEquals(rpcCalls(db, "mark_target_published").map((c) => c.payload), [{
    p_post_id: 30,
    p_platform: "tiktok",
    p_fields: {
      external_id: "7301234",
      permalink: "https://www.tiktok.com/@dktest/photo/7301234",
      published_at: NOW_ISO,
    },
    p_source: "system",
    p_actor: null,
  }]);
  assertEquals(rpcCalls(db, "mark_platform_published").length, 0);
  assertNoWorkflowPostWrites(db);
});

Deno.test("tiktok-publish-cron status phase: a reels post keeps the /video/ URL", async () => {
  const db = createSupabaseQueryMock();
  const post = claimedPost({ post_id: 31, tipo: "reels", publish_ref: "pub-31", tiktok_username: "dktest" });
  queueClaims(db, [], [post], []);
  const response = await runTikTokPublishCron(baseDeps(db, {
    getFreshTikTokToken: async () => ({ accessToken: "tok", openId: "open-1" }),
    tiktokFetch: async () => ({ status: "PUBLISH_COMPLETE", [FIELD_PUBLIC_POST_ID]: "7301235" }),
    buildTikTokMediaUrl: async () => "",
  }));
  assertEquals(response.status, 200);
  const fields = (rpcCalls(db, "mark_target_published")[0].payload as Record<string, unknown>)
    .p_fields as Record<string, unknown>;
  assertEquals(fields.permalink, "https://www.tiktok.com/@dktest/video/7301235");
});

Deno.test("tiktok-publish-cron status phase: PUBLISH_COMPLETE without a public id omits external_id/permalink", async () => {
  const db = createSupabaseQueryMock();
  const post = claimedPost({ post_id: 32, publish_ref: "pub-32", tiktok_username: "dktest" });
  queueClaims(db, [], [post], []);

  const response = await runTikTokPublishCron(baseDeps(db, {
    getFreshTikTokToken: async () => ({ accessToken: "tok", openId: "open-1" }),
    tiktokFetch: async () => ({ status: "PUBLISH_COMPLETE" }),
    buildTikTokMediaUrl: async () => "",
  }));

  assertEquals(response.status, 200);
  const fields = (rpcCalls(db, "mark_target_published")[0].payload as Record<string, unknown>)
    .p_fields as Record<string, unknown>;
  assertEquals(fields, { published_at: NOW_ISO });
});

// ── (f) status phase: still processing ──────────────────────────────────────────

Deno.test("tiktok-publish-cron status phase: still processing only releases the destination lock", async () => {
  const db = createSupabaseQueryMock();
  const post = claimedPost({ post_id: 40, publish_ref: "pub-40" });
  queueClaims(db, [], [post], []);

  const response = await runTikTokPublishCron(baseDeps(db, {
    getFreshTikTokToken: async () => ({ accessToken: "tok", openId: "open-1" }),
    tiktokFetch: async () => ({ status: "PROCESSING_DOWNLOAD" }),
    buildTikTokMediaUrl: async () => "",
  }));

  assertEquals(response.status, 200);
  const updates = callsFor(db, "post_targets", "update");
  assertEquals(updates.map((c) => c.payload), [{ processing_at: null, updated_at: NOW_ISO }]);
  assertEquals(eqId(updates[0]), 1040);
  assertEquals(rpcCalls(db, "mark_target_published").length, 0);
  assertEquals(rpcCalls(db, "mark_target_failed").length, 0);
  assertNoWorkflowPostWrites(db);
});

// ── (g) status phase: FAILED retryable vs non-retryable reasons ────────────────

Deno.test("tiktok-publish-cron status phase: FAILED with video_pull_failed is retryable and carries the reason as error_code", async () => {
  const db = createSupabaseQueryMock();
  queueClaims(db, [], [claimedPost({ post_id: 50, publish_ref: "pub-50" })], []);

  const response = await runTikTokPublishCron(baseDeps(db, {
    getFreshTikTokToken: async () => ({ accessToken: "tok", openId: "open-1" }),
    tiktokFetch: async () => ({ status: "FAILED", fail_reason: "video_pull_failed" }),
    buildTikTokMediaUrl: async () => "",
  }));

  assertEquals(response.status, 200);
  assertEquals(rpcCalls(db, "mark_target_failed").map((c) => c.payload), [
    failedPayload(50, "Falha ao publicar no TikTok: video_pull_failed", "video_pull_failed", true),
  ]);
  assertNoWorkflowPostWrites(db);
});

Deno.test("tiktok-publish-cron status phase: FAILED with spam_risk_too_many_posts is non-retryable", async () => {
  const db = createSupabaseQueryMock();
  queueClaims(db, [], [claimedPost({ post_id: 51, publish_ref: "pub-51" })], []);

  const response = await runTikTokPublishCron(baseDeps(db, {
    getFreshTikTokToken: async () => ({ accessToken: "tok", openId: "open-1" }),
    tiktokFetch: async () => ({ status: "FAILED", fail_reason: "spam_risk_too_many_posts" }),
    buildTikTokMediaUrl: async () => "",
  }));

  assertEquals(response.status, 200);
  const payload = rpcCalls(db, "mark_target_failed")[0].payload as Record<string, unknown>;
  assertEquals(payload.p_retryable, false, "non-retryable reason exhausts the destination");
  assertEquals(payload.p_error_code, "spam_risk_too_many_posts");
});

Deno.test("tiktok-publish-cron status phase: a destination without publish_ref fails through mark_target_failed", async () => {
  const db = createSupabaseQueryMock();
  queueClaims(db, [], [claimedPost({ post_id: 52, publish_ref: null })], []);

  const response = await runTikTokPublishCron(baseDeps(db, {
    getFreshTikTokToken: async () => ({ accessToken: "tok", openId: "open-1" }),
    tiktokFetch: (unreachable("tiktokFetch") as unknown) as TikTokPublishCronDeps["tiktokFetch"],
    buildTikTokMediaUrl: async () => "",
  }));

  assertEquals(response.status, 200);
  assertEquals(rpcCalls(db, "mark_target_failed").map((c) => c.payload), [
    failedPayload(52, "Destino sem publish_id do TikTok para consultar status.", null, true),
  ]);
});

// ── (g2) mark_target_failed RPC error: logged, never thrown, no compensating writes ──

Deno.test("tiktok-publish-cron: a mark_target_failed RPC error does not throw and writes nothing else", async () => {
  const db = createSupabaseQueryMock();
  queueClaims(db, [], [claimedPost({ post_id: 53, publish_ref: "pub-53" })], []);
  db.queueRpc("mark_target_failed", { data: null, error: { message: "boom" } });

  const response = await runTikTokPublishCron(baseDeps(db, {
    getFreshTikTokToken: async () => ({ accessToken: "tok", openId: "open-1" }),
    tiktokFetch: async () => ({ status: "FAILED", fail_reason: "video_pull_failed" }),
    buildTikTokMediaUrl: async () => "",
  }));

  assertEquals(response.status, 200, "must not throw even though the RPC failed");
  assertEquals(rpcCalls(db, "mark_target_failed").length, 1);
  assertEquals(callsFor(db, "post_targets", "update").length, 0, "the stale-lock window re-claims it");
  assertNoWorkflowPostWrites(db);
});

// ── (h) retry phase: requeue_target ─────────────────────────────────────────────

Deno.test("tiktok-publish-cron retry phase: re-queues the destination through requeue_target", async () => {
  const db = createSupabaseQueryMock();
  queueClaims(db, [], [], [claimedPost({ post_id: 60, retry_count: 1 })]);
  db.queueRpc("requeue_target", { data: true, error: null });

  const response = await runTikTokPublishCron(baseDeps(db));

  assertEquals(response.status, 200);
  assertEquals(rpcCalls(db, "requeue_target").map((c) => c.payload), [
    { p_post_id: 60, p_platform: "tiktok", p_source: "system", p_actor: null },
  ]);
  assertEquals(callsFor(db, "post_targets", "update").length, 0);
  assertNoWorkflowPostWrites(db);
});

Deno.test("tiktok-publish-cron retry phase: a declined requeue (post moved away) releases the lock", async () => {
  const db = createSupabaseQueryMock();
  queueClaims(db, [], [], [claimedPost({ post_id: 61 })]);
  db.queueRpc("requeue_target", { data: false, error: null });

  const response = await runTikTokPublishCron(baseDeps(db));

  assertEquals(response.status, 200);
  const updates = callsFor(db, "post_targets", "update");
  assertEquals(updates.map((c) => c.payload), [{ processing_at: null, updated_at: NOW_ISO }]);
  assertEquals(eqId(updates[0]), 1061);
});

Deno.test("tiktok-publish-cron retry phase: a requeue_target error releases the lock and is reported", async () => {
  const db = createSupabaseQueryMock();
  queueClaims(db, [], [], [claimedPost({ post_id: 62 })]);
  db.queueRpc("requeue_target", { data: null, error: { message: "boom" } });

  const failures: unknown[] = [];
  const response = await runTikTokPublishCron(baseDeps(db, {
    reportCronFailure: async (_svc, _name, detail) => {
      failures.push(detail);
    },
  }));

  assertEquals(response.status, 200);
  assertEquals(eqId(callsFor(db, "post_targets", "update")[0]), 1062);
  assertEquals(failures.length, 1, "a failed retry counts toward the cron failure report");
});

// ── (i) outer failure path reports via reportCronFailure ───────────────────────

Deno.test("tiktok-publish-cron: a broken claim query aborts the run and is reported via reportCronFailure", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("claim_tiktok_targets_for_publishing", { data: null, error: { message: "connection reset" } });

  const failureCalls: Array<{ cronName: string; detail: unknown }> = [];

  const response = await runTikTokPublishCron(baseDeps(db, {
    reportCronFailure: async (_svc, cronName, detail) => {
      failureCalls.push({ cronName, detail });
    },
  }));

  assertEquals(response.status, 500);
  assertEquals(failureCalls.length, 1);
  assertEquals(failureCalls[0].cronName, "tiktok-publish-cron");
});

Deno.test("tiktok-publish-cron: no posts claimed in any phase returns 200 without reporting a failure", async () => {
  const db = createSupabaseQueryMock();
  queueClaims(db, [], [], []);

  const failureCalls: unknown[] = [];
  const response = await runTikTokPublishCron(baseDeps(db, {
    reportCronFailure: async () => {
      failureCalls.push(1);
    },
  }));

  assertEquals(response.status, 200);
  assertEquals(failureCalls.length, 0);
  assertNoWorkflowPostWrites(db);
});

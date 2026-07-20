// tiktok-publish-cron (Task B5) — mirrors tiktok-refresh-cron_test.ts's convention (handler.ts's
// timingSafeEqual auth gate tested in isolation, core.ts's business logic tested via DI'd
// getFreshTikTokToken / tiktokFetch / buildTikTokMediaUrl / reportCronFailure against the
// shared supabaseMock). fetchPostMedia/checkDesignReadiness are left to their REAL
// implementations (imported by core.ts from _shared/instagram-publish-utils.ts) in most tests —
// queued via `post_file_links`/`designs` responses on the mock db — except where a test only
// cares about downstream behavior, where they're overridden directly for brevity.
//
// buildTikTokMediaUrl replaced a raw R2 signGetUrl call (tiktok-media proxy fast-follow):
// TikTok's PULL_FROM_URL source needs a TikTok-verifiable URL prefix, which raw
// *.r2.cloudflarestorage.com presigned URLs can't satisfy. Most tests below stub it with a
// throwaway string (they only care that init/status flow correctly); test (c) uses the REAL
// shared implementation to pin the URL shape TikTok actually receives.
import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import type { QueryCall } from "../../../test/shared/supabaseMock.ts";
import { createTikTokPublishCronHandler } from "../tiktok-publish-cron/handler.ts";
import { runTikTokPublishCron, type TikTokPublishCronDeps } from "../tiktok-publish-cron/core.ts";
import { FIELD_PUBLIC_POST_ID } from "../_shared/tiktok.ts";
import { buildTikTokMediaUrl, verifyTikTokMediaToken } from "../_shared/tiktok-media-url.ts";

const timingSafeEqual = (a: string, b: string) => a === b;

Deno.env.set("TOKEN_ENCRYPTION_KEY", "test-tiktok-publish-cron-key");
Deno.env.set("SUPABASE_URL", "https://supabase.example");
const MEDIA_URL_PREFIX = "https://supabase.example/functions/v1/tiktok-media/m/";

type Db = ReturnType<typeof createSupabaseQueryMock>;

function callsFor(db: Db, table: string, operation: string) {
  return db.calls.filter((c: QueryCall) => c.table === table && c.operation === operation);
}

function rpcCalls(db: Db, name: string) {
  return db.calls.filter((c: QueryCall) => c.table === `rpc:${name}`);
}

// Matches claim_posts_for_tiktok_publishing's RETURNS TABLE shape (migration
// 20260719000001_tiktok_publishing.sql).
function claimedPost(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    post_id: 1,
    workflow_id: 1,
    tipo: "feed",
    scheduled_at: new Date().toISOString(),
    caption: "legenda",
    tiktok_title: null,
    tiktok_settings: { privacy_level: "SELF_ONLY" },
    tiktok_publish_id: null,
    tiktok_publish_retry_count: 0,
    encrypted_access_token: "enc-access",
    encrypted_refresh_token: "enc-refresh",
    access_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    tiktok_account_id: "acct-1",
    tiktok_open_id: "open-1",
    tiktok_username: "dktest",
    client_id: 101,
    ...overrides,
  };
}

/** Queues the three claim_posts_for_tiktok_publishing responses in call order (init, status,
 * retry) — runTikTokPublishCron always calls the RPC exactly once per phase, in that order. */
function queueClaims(db: Db, init: unknown[], status: unknown[], retry: unknown[]) {
  db.queueRpc("claim_posts_for_tiktok_publishing", { data: init, error: null });
  db.queueRpc("claim_posts_for_tiktok_publishing", { data: status, error: null });
  db.queueRpc("claim_posts_for_tiktok_publishing", { data: retry, error: null });
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
    ...overrides,
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

Deno.test("tiktok-publish-cron init phase: caps at 5 inits per account per run, releases overflow locks untouched", async () => {
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
    checkDesignReadiness: async () => ({ ready: true, design: null }),
  }));

  assertEquals(response.status, 200);
  assertEquals(tokenCalls, ["acct-1"], "token must be fetched exactly once for the whole account batch");
  assertEquals(initCalls.length, 5, "only 5 of the 7 claimed posts get an init call this run");

  const updateCalls = callsFor(db, "workflow_posts", "update");
  // 5 successful inits (publish_id/status write) + 2 overflow lock releases = 7.
  assertEquals(updateCalls.length, 7);

  const overflowUpdates = updateCalls.filter((c) => {
    const payload = c.payload as Record<string, unknown>;
    return payload.tiktok_publish_processing_at === null && !("tiktok_publish_status" in payload);
  });
  assertEquals(overflowUpdates.length, 2, "the 2 overflow posts must only have their lock cleared");

  const initedUpdates = updateCalls.filter((c) => (c.payload as Record<string, unknown>).tiktok_publish_status === "initiated");
  assertEquals(initedUpdates.length, 5);
});

// ── (c) init phase: payload shape per tipo ──────────────────────────────────────
//
// Uses the REAL buildTikTokMediaUrl (not a stub) so the assertions below pin the actual URL
// shape TikTok receives post-swap: `${SUPABASE_URL}/functions/v1/tiktok-media/m/{token}`, never
// a raw R2 presigned URL — and confirms each URL's token resolves back to the exact r2_key that
// was linked to the post, via verifyTikTokMediaToken (the tiktok-media function's own
// resolution step).

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
    checkDesignReadiness: async () => ({ ready: true, design: null }),
  }));

  assertEquals(response.status, 200);
  assertEquals(calls.length, 2);

  const videoCall = calls.find((c) => c.path === "/post/publish/video/init/");
  assert(videoCall, "video (reels) post must POST to /post/publish/video/init/");
  const videoBody = videoCall!.body as { source_info: Record<string, unknown>; post_info: Record<string, unknown> };
  assertEquals(videoBody.source_info.source, "PULL_FROM_URL");
  const videoUrl = videoBody.source_info.video_url as string;
  assert(videoUrl.startsWith(MEDIA_URL_PREFIX), `video_url must be a tiktok-media proxy URL, got ${videoUrl}`);
  assertEquals(
    await verifyTikTokMediaToken(videoUrl.slice(MEDIA_URL_PREFIX.length)),
    "vid/1.mp4",
    "the proxy token must resolve back to the linked video's r2_key",
  );
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
    "each proxy token must resolve back to its linked image's r2_key, in order",
  );
  assertEquals(photoBody.post_info.description, "legenda carrossel");
});

// ── (d) init phase: design-not-ready defers, never calls init ──────────────────

Deno.test("tiktok-publish-cron init phase: design still rendering defers the post (lock released, no init call, not a failure)", async () => {
  const db = createSupabaseQueryMock();
  const post = claimedPost({ post_id: 20 });
  queueClaims(db, [post], [], []);

  let initCalled = false;

  const response = await runTikTokPublishCron(baseDeps(db, {
    getFreshTikTokToken: async () => ({ accessToken: "tok", openId: "open-1" }),
    tiktokFetch: async () => {
      initCalled = true;
      return { publish_id: "pub-1" };
    },
    buildTikTokMediaUrl: async (key) => `https://signed.example/${key}`,
    checkDesignReadiness: async () => ({
      ready: false,
      design: { id: 1, rev: 1, render_status: "rendering", is_stale: false },
    }),
  }));

  assertEquals(response.status, 200);
  assertEquals(initCalled, false, "init must never be called while the design is still rendering");

  const updateCalls = callsFor(db, "workflow_posts", "update");
  assertEquals(updateCalls.length, 1);
  assertEquals(updateCalls[0].payload, { tiktok_publish_processing_at: null });

  assertEquals(rpcCalls(db, "record_post_status_change").length, 0, "a deferral is not a failure");
});

// ── (e) status phase: PUBLISH_COMPLETE ──────────────────────────────────────────

Deno.test("tiktok-publish-cron status phase: PUBLISH_COMPLETE with a public id calls mark_platform_published with a built tiktok_post_url", async () => {
  const db = createSupabaseQueryMock();
  const post = claimedPost({ post_id: 30, tiktok_publish_id: "pub-30", tiktok_username: "dktest" });
  queueClaims(db, [], [post], []);

  const response = await runTikTokPublishCron(baseDeps(db, {
    getFreshTikTokToken: async () => ({ accessToken: "tok", openId: "open-1" }),
    tiktokFetch: async () => ({ status: "PUBLISH_COMPLETE", [FIELD_PUBLIC_POST_ID]: "7301234" }),
    buildTikTokMediaUrl: async () => "",
    now: () => new Date("2026-07-18T12:00:00.000Z"),
  }));

  assertEquals(response.status, 200);
  const markCalls = rpcCalls(db, "mark_platform_published");
  assertEquals(markCalls.length, 1);
  const payload = markCalls[0].payload as Record<string, unknown>;
  assertEquals(payload.p_post_id, 30);
  assertEquals(payload.p_platform, "tiktok");
  const fields = payload.p_fields as Record<string, unknown>;
  assertEquals(fields.tiktok_post_id, "7301234");
  assertEquals(fields.tiktok_post_url, "https://www.tiktok.com/@dktest/video/7301234");
  assertEquals(fields.published_at, "2026-07-18T12:00:00.000Z");
});

Deno.test("tiktok-publish-cron status phase: PUBLISH_COMPLETE without a public id omits tiktok_post_id/tiktok_post_url", async () => {
  const db = createSupabaseQueryMock();
  const post = claimedPost({ post_id: 31, tiktok_publish_id: "pub-31", tiktok_username: "dktest" });
  queueClaims(db, [], [post], []);

  const response = await runTikTokPublishCron(baseDeps(db, {
    getFreshTikTokToken: async () => ({ accessToken: "tok", openId: "open-1" }),
    tiktokFetch: async () => ({ status: "PUBLISH_COMPLETE" }),
    buildTikTokMediaUrl: async () => "",
  }));

  assertEquals(response.status, 200);
  const markCalls = rpcCalls(db, "mark_platform_published");
  assertEquals(markCalls.length, 1);
  const fields = (markCalls[0].payload as Record<string, unknown>).p_fields as Record<string, unknown>;
  assert(!("tiktok_post_id" in fields), "no public id in the status response -> no tiktok_post_id field");
  assert(!("tiktok_post_url" in fields), "no public id -> no tiktok_post_url can be built");
  assert("published_at" in fields);
});

// ── (f) status phase: still processing ──────────────────────────────────────────

Deno.test("tiktok-publish-cron status phase: still processing sets tiktok_publish_status='processing' and clears the lock", async () => {
  const db = createSupabaseQueryMock();
  const post = claimedPost({ post_id: 40, tiktok_publish_id: "pub-40" });
  queueClaims(db, [], [post], []);

  const response = await runTikTokPublishCron(baseDeps(db, {
    getFreshTikTokToken: async () => ({ accessToken: "tok", openId: "open-1" }),
    tiktokFetch: async () => ({ status: "PROCESSING_DOWNLOAD" }),
    buildTikTokMediaUrl: async () => "",
  }));

  assertEquals(response.status, 200);
  const updateCalls = callsFor(db, "workflow_posts", "update");
  assertEquals(updateCalls.length, 1);
  assertEquals(updateCalls[0].payload, { tiktok_publish_status: "processing", tiktok_publish_processing_at: null });
  assertEquals(rpcCalls(db, "mark_platform_published").length, 0);
});

// ── (g) status phase: FAILED retryable vs non-retryable reasons ────────────────

Deno.test("tiktok-publish-cron status phase: FAILED with video_pull_failed is retryable (retry_count+1, stays under 3)", async () => {
  const db = createSupabaseQueryMock();
  const post = claimedPost({ post_id: 50, tiktok_publish_id: "pub-50", tiktok_publish_retry_count: 0 });
  queueClaims(db, [], [post], []);

  const response = await runTikTokPublishCron(baseDeps(db, {
    getFreshTikTokToken: async () => ({ accessToken: "tok", openId: "open-1" }),
    tiktokFetch: async () => ({ status: "FAILED", fail_reason: "video_pull_failed" }),
    buildTikTokMediaUrl: async () => "",
  }));

  assertEquals(response.status, 200);
  const updateCalls = callsFor(db, "workflow_posts", "update");
  assertEquals(updateCalls.length, 1);
  const payload = updateCalls[0].payload as Record<string, unknown>;
  assertEquals(payload.tiktok_publish_status, "failed");
  assertEquals(payload.tiktok_publish_retry_count, 1, "retryable reason increments by exactly one");
  assertEquals(payload.tiktok_publish_processing_at, null);

  const statusRpc = rpcCalls(db, "record_post_status_change");
  assertEquals(statusRpc.length, 1);
  assertEquals((statusRpc[0].payload as Record<string, unknown>).p_new_status, "falha_publicacao");
});

Deno.test("tiktok-publish-cron status phase: FAILED with spam_risk_too_many_posts is non-retryable (retry_count jumps to 3)", async () => {
  const db = createSupabaseQueryMock();
  const post = claimedPost({ post_id: 51, tiktok_publish_id: "pub-51", tiktok_publish_retry_count: 0 });
  queueClaims(db, [], [post], []);

  const response = await runTikTokPublishCron(baseDeps(db, {
    getFreshTikTokToken: async () => ({ accessToken: "tok", openId: "open-1" }),
    tiktokFetch: async () => ({ status: "FAILED", fail_reason: "spam_risk_too_many_posts" }),
    buildTikTokMediaUrl: async () => "",
  }));

  assertEquals(response.status, 200);
  const updateCalls = callsFor(db, "workflow_posts", "update");
  assertEquals(updateCalls.length, 1);
  const payload = updateCalls[0].payload as Record<string, unknown>;
  assertEquals(payload.tiktok_publish_retry_count, 3, "non-retryable reason skips straight to the retry ceiling");
});

// ── (g2) markTikTokFailed partial-write failures self-heal, never orphan ───────
//
// Both new tests drive markTikTokFailed via the status phase's FAILED branch (as (g) does).
// clearLock and the compensating status update reuse the SAME workflow_posts:update queue key
// as write (1) on the mock — queuing exactly one error response there lets write (1) consume it
// and leaves the queue empty (-> default success) for whichever best-effort write follows.

Deno.test("tiktok-publish-cron markTikTokFailed: write (1) failure skips the RPC, clears the lock, never throws", async () => {
  const db = createSupabaseQueryMock();
  const post = claimedPost({ post_id: 52, tiktok_publish_id: "pub-52", tiktok_publish_retry_count: 0 });
  queueClaims(db, [], [post], []);
  db.queue("workflow_posts", "update", { error: { message: "boom" } });

  const response = await runTikTokPublishCron(baseDeps(db, {
    getFreshTikTokToken: async () => ({ accessToken: "tok", openId: "open-1" }),
    tiktokFetch: async () => ({ status: "FAILED", fail_reason: "video_pull_failed" }),
    buildTikTokMediaUrl: async () => "",
  }));

  assertEquals(response.status, 200, "must not throw even though write (1) failed");

  const updateCalls = callsFor(db, "workflow_posts", "update");
  assertEquals(updateCalls.length, 2, "the failed write (1) attempt + the best-effort clearLock");
  assertEquals(
    updateCalls[1].payload,
    { tiktok_publish_processing_at: null },
    "clearLock is attempted after write (1) fails, releasing the post back to its claiming phase",
  );

  assertEquals(
    rpcCalls(db, "record_post_status_change").length,
    0,
    "record_post_status_change must NOT fire when write (1) itself failed — that would orphan the post",
  );
});

Deno.test("tiktok-publish-cron markTikTokFailed: write (1) ok, RPC failure runs a compensating status update", async () => {
  const db = createSupabaseQueryMock();
  const post = claimedPost({ post_id: 53, tiktok_publish_id: "pub-53", tiktok_publish_retry_count: 0 });
  queueClaims(db, [], [post], []);
  db.queueRpc("record_post_status_change", { error: { message: "boom" } });

  const response = await runTikTokPublishCron(baseDeps(db, {
    getFreshTikTokToken: async () => ({ accessToken: "tok", openId: "open-1" }),
    tiktokFetch: async () => ({ status: "FAILED", fail_reason: "video_pull_failed" }),
    buildTikTokMediaUrl: async () => "",
  }));

  assertEquals(response.status, 200, "must not throw even though the RPC failed");

  const updateCalls = callsFor(db, "workflow_posts", "update");
  assertEquals(updateCalls.length, 2, "write (1) succeeds + the compensating status update");
  assertEquals(
    (updateCalls[0].payload as Record<string, unknown>).tiktok_publish_status,
    "failed",
    "write (1) itself still succeeds",
  );
  assertEquals(
    updateCalls[1].payload,
    { status: "falha_publicacao" },
    "compensating write moves the card status directly since the RPC that normally does it failed",
  );
});

// ── (h) retry phase: pure state reset ───────────────────────────────────────────

Deno.test("tiktok-publish-cron retry phase: resets tiktok_publish_status/error and moves the card back to agendado", async () => {
  const db = createSupabaseQueryMock();
  const post = claimedPost({ post_id: 60, tiktok_publish_retry_count: 1 });
  queueClaims(db, [], [], [post]);

  const response = await runTikTokPublishCron(baseDeps(db)); // getFreshTikTokToken/tiktokFetch/buildTikTokMediaUrl unreachable

  assertEquals(response.status, 200);
  const updateCalls = callsFor(db, "workflow_posts", "update");
  assertEquals(updateCalls.length, 1);
  assertEquals(updateCalls[0].payload, {
    tiktok_publish_status: null,
    tiktok_publish_error: null,
    tiktok_publish_processing_at: null,
  });

  const statusRpc = rpcCalls(db, "record_post_status_change");
  assertEquals(statusRpc.length, 1);
  assertEquals((statusRpc[0].payload as Record<string, unknown>).p_new_status, "agendado");
});

// ── (i) outer failure path reports via reportCronFailure ───────────────────────

Deno.test("tiktok-publish-cron: a broken claim query aborts the run and is reported via reportCronFailure", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("claim_posts_for_tiktok_publishing", { data: null, error: { message: "connection reset" } });

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
});

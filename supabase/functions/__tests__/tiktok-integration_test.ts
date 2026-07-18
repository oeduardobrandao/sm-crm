// Handler-level tests for tiktok-integration, mirroring instagram-publish-gate_test.ts's
// DI style (createXHandler(deps) + createSupabaseQueryMock) plus the routed-fetch-stub
// convention from tiktok-shared_test.ts / tiktok-token-refresh_test.ts (globalThis.fetch is
// what _shared/tiktok.ts's tiktokFetch/getFreshTikTokToken actually call, so tests stub it
// directly rather than injecting a fetch dependency).
import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createTikTokIntegrationHandler } from "../tiktok-integration/handlers.ts";
import { refreshStoredPostMetrics } from "../tiktok-integration/import.ts";
import { createSignedState, toUrlSafeBase64 } from "../tiktok-integration/oauth-state.ts";
import { TIKTOK_API_BASE, decryptTikTokToken } from "../_shared/tiktok.ts";
import type { ThumbnailStorage } from "../_shared/tiktok-thumbnail-cache.ts";

Deno.env.set("TOKEN_ENCRYPTION_KEY", "test-tiktok-integration-key-32c");
Deno.env.set("TIKTOK_CLIENT_KEY", "test-client-key");
Deno.env.set("TIKTOK_CLIENT_SECRET", "test-client-secret");
Deno.env.set("OAUTH_REDIRECT_BASE", "https://app.example.com");

// ─── Fakes ──────────────────────────────────────────────────────────────────────────────

/** Minimal in-memory storage double — enough surface for both thumbnail and avatar caching. */
function makeStorage() {
  const uploads: { bucket: string; path: string; contentType: string }[] = [];
  const storage: ThumbnailStorage = {
    from(bucket: string) {
      return {
        // deno-lint-ignore no-explicit-any
        async upload(path: string, _body: any, opts: { contentType: string; upsert: boolean }) {
          uploads.push({ bucket, path, contentType: opts.contentType });
          return { error: null };
        },
        getPublicUrl(path: string) {
          return { data: { publicUrl: `https://proj.supabase.co/storage/v1/object/public/${bucket}/${path}` } };
        },
      };
    },
    async createBucket() {
      return {};
    },
  };
  return { storage, uploads };
}

/** Wires a query-mock + a storage fake into the DbClient shape handlers.ts expects. */
function makeDb(db: ReturnType<typeof createSupabaseQueryMock>, storage: ThumbnailStorage) {
  return {
    from: db.from.bind(db),
    rpc: db.rpc.bind(db),
    auth: db.auth,
    storage,
    // deno-lint-ignore no-explicit-any
  } as any;
}

function makeHandler(db: ReturnType<typeof createSupabaseQueryMock>, storage: ThumbnailStorage) {
  return createTikTokIntegrationHandler({
    buildCorsHeaders: () => ({}),
    createServiceDb: () => makeDb(db, storage),
  });
}

const DEFAULT_TOKEN_BODY = {
  open_id: "open-1",
  access_token: "access-tok-123",
  expires_in: 86400,
  refresh_token: "refresh-tok-456",
  refresh_expires_in: 31536000,
  scope: "user.info.basic,video.list",
};

const DEFAULT_PROFILE = {
  open_id: "open-1",
  username: "testuser",
  display_name: "Test User",
  avatar_url: "https://p16.tiktokcdn.com/avatar.jpg",
  follower_count: 100,
  following_count: 10,
  likes_count: 500,
  video_count: 5,
};

const DEFAULT_VIDEOS = [
  {
    id: "v1",
    create_time: 1700000000,
    cover_image_url: "https://p16.tiktokcdn.com/cover1.jpg",
    share_url: "https://tiktok.com/@testuser/video/v1",
    video_description: "desc",
    duration: 15,
    height: 1920,
    width: 1080,
    title: "t",
    embed_link: "https://tiktok.com/embed/v1",
    like_count: 1,
    comment_count: 2,
    share_count: 3,
    view_count: 4,
  },
];

/** Routes globalThis.fetch by URL prefix — token exchange / user.info / video.list / revoke
 * get canned TikTok envelopes; anything else (avatar or cover downloads) gets an image. */
function stubTikTokFetch(
  overrides: {
    tokenBody?: unknown;
    profile?: unknown;
    videos?: unknown[];
    hasMore?: boolean;
    /** Given a batch's requested video_ids, returns the `videos` array for /video/query/'s
     * envelope — defaults to echoing metrics back for every id (deterministic per numeric
     * suffix), so most tests get a sane default without wiring this up. */
    videoQueryMetrics?: (ids: string[]) => unknown[];
  } = {},
) {
  const original = globalThis.fetch;
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.startsWith(`${TIKTOK_API_BASE}/oauth/token/`)) {
      return Promise.resolve(new Response(JSON.stringify(overrides.tokenBody ?? DEFAULT_TOKEN_BODY), { status: 200 }));
    }
    if (url.startsWith(`${TIKTOK_API_BASE}/user/info/`)) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ data: { user: overrides.profile ?? DEFAULT_PROFILE }, error: { code: "ok", message: "", log_id: "1" } }),
          { status: 200 },
        ),
      );
    }
    if (url.startsWith(`${TIKTOK_API_BASE}/video/list/`)) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: { videos: overrides.videos ?? DEFAULT_VIDEOS, has_more: overrides.hasMore ?? false },
            error: { code: "ok", message: "", log_id: "2" },
          }),
          { status: 200 },
        ),
      );
    }
    if (url.startsWith(`${TIKTOK_API_BASE}/video/query/`)) {
      const ids = (init?.body ? JSON.parse(init.body as string) : {})?.filters?.video_ids ?? [];
      const videos = overrides.videoQueryMetrics
        ? overrides.videoQueryMetrics(ids)
        : ids.map((id: string) => {
          const n = parseInt(id.replace(/\D/g, ""), 10) || 1;
          return { id, like_count: n, comment_count: n * 2, share_count: n * 3, view_count: n * 10 };
        });
      return Promise.resolve(
        new Response(
          JSON.stringify({ data: { videos }, error: { code: "ok", message: "", log_id: "4" } }),
          { status: 200 },
        ),
      );
    }
    if (url.startsWith(`${TIKTOK_API_BASE}/oauth/revoke/`)) {
      return Promise.resolve(
        new Response(JSON.stringify({ data: {}, error: { code: "ok", message: "", log_id: "3" } }), { status: 200 }),
      );
    }
    // Anything else is an image download (avatar or video cover).
    return Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } }));
  }) as typeof fetch;
  return { restore: () => { globalThis.fetch = original; }, calls };
}

function authedRequest(path: string, method = "GET", token = "tok"): Request {
  return new Request(`http://x/tiktok-integration${path}`, {
    method,
    headers: { authorization: `Bearer ${token}` },
  });
}

// ─── (a) 401 without JWT ────────────────────────────────────────────────────────────────

Deno.test("tiktok-integration: /auth without JWT -> 401", async () => {
  const db = createSupabaseQueryMock();
  const { storage } = makeStorage();
  const handler = makeHandler(db, storage);
  const res = await handler(new Request("http://x/tiktok-integration/auth/5", { method: "GET" }));
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body, { error: true, message: "Não autorizado" });
});

Deno.test("tiktok-integration: /sync without JWT -> 401", async () => {
  const db = createSupabaseQueryMock();
  const { storage } = makeStorage();
  const handler = makeHandler(db, storage);
  const res = await handler(new Request("http://x/tiktok-integration/sync/5", { method: "POST" }));
  assertEquals(res.status, 401);
});

// ─── (b) cross-conta ownership -> 403, matching IG's exact shape ───────────────────────

Deno.test("tiktok-integration: /auth for a client in another conta -> 403 Unauthorized", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "user-1" });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queue("clientes", "select", { data: { conta_id: "ws-OTHER" }, error: null });
  const { storage } = makeStorage();
  const handler = makeHandler(db, storage);
  const res = await handler(authedRequest("/auth/5"));
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body, { error: true, message: "Unauthorized" });
});

// ─── (c) feature_tiktok=false -> 403 feature_disabled ──────────────────────────────────

Deno.test("tiktok-integration: /auth with feature_tiktok=false -> 403 feature_disabled", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "user-1" });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queue("clientes", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queueRpc("effective_plan_feature", { data: false, error: null });
  const { storage } = makeStorage();
  const handler = makeHandler(db, storage);
  const res = await handler(authedRequest("/auth/5"));
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body, { error: "feature_disabled", feature: "feature_tiktok" });
});

Deno.test("tiktok-integration: /auth with feature_tiktok=true returns an authorize url", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "user-1" });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queue("clientes", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queueRpc("effective_plan_feature", { data: true, error: null });
  db.queue("oauth_states", "delete", { data: null, error: null });
  db.queue("oauth_states", "insert", { data: null, error: null });
  const { storage } = makeStorage();
  const handler = makeHandler(db, storage);
  const res = await handler(authedRequest("/auth/5"));
  assertEquals(res.status, 200);
  const body = await res.json();
  assert(body.url.startsWith("https://www.tiktok.com/v2/auth/authorize/?client_key=test-client-key"));
  assert(body.url.includes("state="));
});

// ─── (d) bad state signature at /callback -> redirect with tt_error=1 ──────────────────

Deno.test("tiktok-integration: callback with bad state signature -> redirect with tt_error=1", async () => {
  const db = createSupabaseQueryMock();
  db.queue("oauth_states", "delete", { data: null, error: null });
  db.queue("oauth_states", "insert", { data: null, error: null });
  const validState = await createSignedState("5", "user-1", "ws-1", db);
  const [, validSig] = validState.split(".");
  // Same tampering technique as oauth-state_test.ts: swap the payload, keep the signature —
  // guarantees HMAC verification fails deterministically.
  const fakePayload = toUrlSafeBase64(
    btoa(JSON.stringify({ clientId: "999", userId: "hacker", contaId: "evil", provider: "tiktok", nonce: "x", iat: Date.now() })),
  );
  const tampered = `${fakePayload}.${validSig}`;

  const { storage } = makeStorage();
  const handler = makeHandler(db, storage);
  const res = await handler(
    new Request(`http://x/tiktok-integration/callback?code=abc123&state=${encodeURIComponent(tampered)}`, { method: "GET" }),
  );
  assertEquals(res.status, 302);
  const location = res.headers.get("location") ?? "";
  assert(location.includes("tt_error=1"), `expected tt_error=1 in redirect, got: ${location}`);
});

// ─── (e) callback happy path ────────────────────────────────────────────────────────────

Deno.test("tiktok-integration: callback happy path upserts BOTH encrypted tokens, inserts follower history, imports videos", async () => {
  const db = createSupabaseQueryMock();
  const { storage } = makeStorage();

  db.queue("oauth_states", "delete", { data: null, error: null });
  db.queue("oauth_states", "insert", { data: null, error: null });
  const state = await createSignedState("42", "user-1", "ws-1", db);

  // Handler-run queue, in the exact order handleCallback issues them.
  db.queue("oauth_states", "update", {
    data: { nonce: "x", client_id: 42, conta_id: "ws-1", provider: "tiktok" },
    error: null,
  });
  db.queue("tiktok_accounts", "upsert", { data: { id: "acct-uuid-1" }, error: null });
  db.queue("audit_log", "insert", { data: null, error: null });
  db.queue("tiktok_follower_history", "select", { data: null, error: null });
  db.queue("tiktok_follower_history", "upsert", { data: null, error: null });
  db.queue("tiktok_posts", "select", { data: [], error: null });
  db.queue("tiktok_posts", "upsert", { data: null, error: null });

  const f = stubTikTokFetch();
  const handler = makeHandler(db, storage);

  try {
    const res = await handler(
      new Request(`http://x/tiktok-integration/callback?code=abc123&state=${encodeURIComponent(state)}`, { method: "GET" }),
    );
    assertEquals(res.status, 302);
    assertEquals(res.headers.get("location"), "https://app.example.com/clientes/42");

    const upsertCall = db.calls.find((c) => c.table === "tiktok_accounts" && c.operation === "upsert");
    assert(upsertCall, "expected a tiktok_accounts upsert");
    const payload = upsertCall!.payload as Record<string, unknown>;

    assert(typeof payload.encrypted_access_token === "string" && (payload.encrypted_access_token as string).length > 0);
    assert(typeof payload.encrypted_refresh_token === "string" && (payload.encrypted_refresh_token as string).length > 0);
    assert(
      payload.encrypted_access_token !== payload.encrypted_refresh_token,
      "access and refresh tokens must be encrypted separately (different HKDF info)",
    );

    const decAccess = await decryptTikTokToken(payload.encrypted_access_token as string, "access");
    assertEquals(decAccess, "access-tok-123");
    const decRefresh = await decryptTikTokToken(payload.encrypted_refresh_token as string, "refresh");
    assertEquals(decRefresh, "refresh-tok-456");
    assertEquals(payload.client_id, "42");
    assertEquals(payload.tiktok_open_id, "open-1");
    assertEquals(payload.authorization_status, "active");

    const historyUpsert = db.calls.find((c) => c.table === "tiktok_follower_history" && c.operation === "upsert");
    assert(historyUpsert, "expected a tiktok_follower_history upsert (daily snapshot)");
    assertEquals((historyUpsert!.payload as Record<string, unknown>).tiktok_account_id, "acct-uuid-1");

    const postsUpsert = db.calls.find((c) => c.table === "tiktok_posts" && c.operation === "upsert");
    assert(postsUpsert, "expected a tiktok_posts upsert (video import)");
    const postsPayload = postsUpsert!.payload as Array<Record<string, unknown>>;
    assertEquals(postsPayload.length, 1);
    assertEquals(postsPayload[0].tiktok_video_id, "v1");
    assertEquals(postsPayload[0].tiktok_account_id, "acct-uuid-1");

    const tokenCall = f.calls.find((c) => c.url.startsWith(`${TIKTOK_API_BASE}/oauth/token/`));
    assert(tokenCall, "expected a token-exchange POST");
    const videoListCall = f.calls.find((c) => c.url.startsWith(`${TIKTOK_API_BASE}/video/list/`));
    assert(videoListCall, "expected a video.list POST for the initial import");
  } finally {
    f.restore();
  }
});

// ─── (f) /disconnect keeps the row, calls /v2/oauth/revoke/ ────────────────────────────

Deno.test("tiktok-integration: disconnect keeps the row with authorization_status='disconnected' and calls /v2/oauth/revoke/", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "user-1" });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queue("clientes", "select", { data: { conta_id: "ws-1" }, error: null });

  const { encryptTikTokToken } = await import("../_shared/tiktok.ts");
  const encAccess = await encryptTikTokToken("access-to-revoke", "access");
  db.queue("tiktok_accounts", "select", { data: { id: "acct-1", encrypted_access_token: encAccess }, error: null });
  db.queue("tiktok_posts", "delete", { data: null, error: null });
  db.queue("tiktok_accounts", "update", { data: null, error: null });

  const { storage } = makeStorage();
  const f = stubTikTokFetch();
  const handler = makeHandler(db, storage);

  try {
    const res = await handler(authedRequest("/disconnect/42", "POST"));
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body, { ok: true });

    const revokeCall = f.calls.find((c) => c.url.startsWith(`${TIKTOK_API_BASE}/oauth/revoke/`));
    assert(revokeCall, "expected a call to /v2/oauth/revoke/");

    const updateCall = db.calls.find((c) => c.table === "tiktok_accounts" && c.operation === "update");
    assert(updateCall, "expected the account row to be updated (kept), not deleted");
    const payload = updateCall!.payload as Record<string, unknown>;
    assertEquals(payload.authorization_status, "disconnected");
    assertEquals(payload.encrypted_access_token, null);

    const deleteCall = db.calls.find((c) => c.table === "tiktok_posts" && c.operation === "delete");
    assert(deleteCall, "expected tiktok_posts to be cleared for the account");
  } finally {
    f.restore();
  }
});

Deno.test("tiktok-integration: DELETE /disconnect also works (method alias)", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "user-1" });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queue("clientes", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queue("tiktok_accounts", "select", { data: null, error: null }); // no account connected
  const { storage } = makeStorage();
  const handler = makeHandler(db, storage);
  const res = await handler(authedRequest("/disconnect/42", "DELETE"));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { ok: true });
});

// ─── (g) /posts pagination math: Math.max(1, parseInt(pageStr) || 1) ───────────────────

Deno.test("tiktok-integration: /posts?page=abc falls back to page 1 (range 0..9)", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "user-1" });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queue("clientes", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queue("tiktok_accounts", "select", { data: { id: "acct-1" }, error: null });
  db.queue("tiktok_posts", "select", { data: [{ id: "p1" }], error: null, count: 1 });

  const { storage } = makeStorage();
  const handler = makeHandler(db, storage);
  const res = await handler(authedRequest("/posts/42?page=abc"));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { posts: [{ id: "p1" }], total: 1 });

  const postsSelect = db.calls.find((c) => c.table === "tiktok_posts" && c.operation === "select");
  const rangeModifier = postsSelect?.modifiers.find((m) => m.method === "range");
  assertEquals(rangeModifier?.args, [0, 9]);
});

Deno.test("tiktok-integration: /posts?page=0 clamps to page 1 (Math.max(1, ...))", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "user-1" });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queue("clientes", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queue("tiktok_accounts", "select", { data: { id: "acct-1" }, error: null });
  db.queue("tiktok_posts", "select", { data: [], error: null, count: 0 });

  const { storage } = makeStorage();
  const handler = makeHandler(db, storage);
  const res = await handler(authedRequest("/posts/42?page=0"));
  assertEquals(res.status, 200);

  const postsSelect = db.calls.find((c) => c.table === "tiktok_posts" && c.operation === "select");
  const rangeModifier = postsSelect?.modifiers.find((m) => m.method === "range");
  assertEquals(rangeModifier?.args, [0, 9]);
});

Deno.test("tiktok-integration: /posts?page=3 -> offset 20..29", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "user-1" });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queue("clientes", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queue("tiktok_accounts", "select", { data: { id: "acct-1" }, error: null });
  db.queue("tiktok_posts", "select", { data: [], error: null, count: 0 });

  const { storage } = makeStorage();
  const handler = makeHandler(db, storage);
  await handler(authedRequest("/posts/42?page=3"));

  const postsSelect = db.calls.find((c) => c.table === "tiktok_posts" && c.operation === "select");
  const rangeModifier = postsSelect?.modifiers.find((m) => m.method === "range");
  assertEquals(rangeModifier?.args, [20, 29]);
});

Deno.test("tiktok-integration: /posts for a client with no TikTok account -> 404", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "user-1" });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queue("clientes", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queue("tiktok_accounts", "select", { data: null, error: null });

  const { storage } = makeStorage();
  const handler = makeHandler(db, storage);
  const res = await handler(authedRequest("/posts/42"));
  assertEquals(res.status, 404);
});

// ─── /summary ────────────────────────────────────────────────────────────────────────

Deno.test("tiktok-integration: /summary with no connected account -> { exists: false }", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "user-1" });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queue("clientes", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queue("tiktok_accounts", "select", { data: null, error: null });

  const { storage } = makeStorage();
  const handler = makeHandler(db, storage);
  const res = await handler(authedRequest("/summary/42"));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { exists: false });
});

Deno.test("tiktok-integration: /summary returns account + last-30 follower_history", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "user-1" });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queue("clientes", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queue("tiktok_accounts", "select", {
    data: { id: "acct-1", authorization_status: "active", username: "u" },
    error: null,
  });
  db.queue("tiktok_follower_history", "select", {
    data: [{ date: "2026-07-16", follower_count: 99 }, { date: "2026-07-15", follower_count: 98 }],
    error: null,
  });

  const { storage } = makeStorage();
  const handler = makeHandler(db, storage);
  const res = await handler(authedRequest("/summary/42"));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.account, { id: "acct-1", authorization_status: "active", username: "u" });
  // reversed to chronological order, mirroring instagram-integration's summary route
  assertEquals(body.follower_history, [{ date: "2026-07-15", follower_count: 98 }, { date: "2026-07-16", follower_count: 99 }]);
});

// ─── (h) /sync also refreshes stored posts' metrics via video.query ────────────────────

Deno.test("tiktok-integration: /sync refreshes stored posts' metrics via video.query (batched <=20/call) and returns refreshed_posts", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "user-1" });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queue("clientes", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queueRpc("effective_plan_feature", { data: true, error: null });

  const { encryptTikTokToken } = await import("../_shared/tiktok.ts");
  const encAccess = await encryptTikTokToken("fresh-access-token", "access");
  const farFuture = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const accountRow = {
    id: "acct-1",
    client_id: "42",
    tiktok_open_id: "open-1",
    username: "olduser",
    display_name: "Old User",
    avatar_url: null,
    follower_count: 50,
    following_count: 5,
    likes_count: 200,
    video_count: 3,
    encrypted_access_token: encAccess,
    encrypted_refresh_token: null,
    access_token_expires_at: farFuture,
    refresh_token_expires_at: farFuture,
    authorization_status: "active",
  };
  // Two selects hit the SAME `tiktok_accounts:select` FIFO queue: handleSync's own account
  // lookup, then getFreshTikTokToken's internal freshness check.
  db.queue("tiktok_accounts", "select", { data: accountRow, error: null });
  db.queue("tiktok_accounts", "select", {
    data: {
      id: "acct-1",
      tiktok_open_id: "open-1",
      encrypted_access_token: encAccess,
      access_token_expires_at: farFuture,
    },
    error: null,
  });

  db.queue("tiktok_follower_history", "select", { data: null, error: null });
  db.queue("tiktok_accounts", "update", { data: null, error: null });
  db.queue("tiktok_follower_history", "upsert", { data: null, error: null });

  // importTikTokVideos: video.list -> DEFAULT_VIDEOS (1 video, "v1").
  db.queue("tiktok_posts", "select", { data: [], error: null });
  db.queue("tiktok_posts", "upsert", { data: null, error: null });

  // refreshStoredPostMetrics: 23 stored posts -> 2 batches (20 + 3).
  const storedIds = Array.from({ length: 23 }, (_, i) => `m${i + 1}`);
  db.queue("tiktok_posts", "select", { data: storedIds.map((id) => ({ tiktok_video_id: id })), error: null });
  db.queue("tiktok_posts", "update", ...Array.from({ length: 23 }, () => ({ data: null, error: null })));

  const { storage } = makeStorage();
  const f = stubTikTokFetch();
  const handler = makeHandler(db, storage);

  try {
    const res = await handler(authedRequest("/sync/42", "POST"));
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.ok, true);
    assertEquals(body.synced_posts, 1);
    assertEquals(body.refreshed_posts, 23);

    const queryCalls = f.calls.filter((c) => c.url.startsWith(`${TIKTOK_API_BASE}/video/query/`));
    assertEquals(queryCalls.length, 2, "expected 2 video.query batches for 23 stored ids");
    let totalIdsRequested = 0;
    for (const call of queryCalls) {
      assert(
        call.url.startsWith(`${TIKTOK_API_BASE}/video/query/?fields=id,like_count,comment_count,share_count,view_count`),
        `unexpected video.query URL/fields: ${call.url}`,
      );
      const reqBody = JSON.parse(call.init?.body as string);
      const ids = reqBody.filters.video_ids as string[];
      assert(ids.length <= 20, `batch had ${ids.length} ids, expected <=20`);
      totalIdsRequested += ids.length;
    }
    assertEquals(totalIdsRequested, 23);

    const m1Update = db.calls.find(
      (c) =>
        c.table === "tiktok_posts" &&
        c.operation === "update" &&
        c.modifiers.some((m) => m.method === "eq" && m.args[0] === "tiktok_video_id" && m.args[1] === "m1"),
    );
    assert(m1Update, "expected an update for the m1 stored post's metrics");
    const m1Payload = m1Update!.payload as Record<string, unknown>;
    assertEquals(m1Payload.likes, 1);
    assertEquals(m1Payload.comments, 2);
    assertEquals(m1Payload.shares, 3);
    assertEquals(m1Payload.views, 10);
    assert(typeof m1Payload.synced_at === "string" && m1Payload.synced_at.length > 0);
  } finally {
    f.restore();
  }
});

// ─── (i) refreshStoredPostMetrics: an omitted id is left untouched, not an error ───────

Deno.test("refreshStoredPostMetrics: video.query response omitting one requested id leaves that row untouched, updates the rest, no error", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_posts", "select", {
    data: [{ tiktok_video_id: "v1" }, { tiktok_video_id: "v2" }, { tiktok_video_id: "v3" }],
    error: null,
  });
  db.queue("tiktok_posts", "update", { data: null, error: null }, { data: null, error: null });

  const original = globalThis.fetch;
  globalThis.fetch = ((_url: string, _init?: RequestInit) => {
    // v2 is omitted from the response, simulating a deleted/private video.
    return Promise.resolve(
      new Response(
        JSON.stringify({
          data: {
            videos: [
              { id: "v1", like_count: 5, comment_count: 1, share_count: 0, view_count: 50 },
              { id: "v3", like_count: 9, comment_count: 2, share_count: 1, view_count: 90 },
            ],
          },
          error: { code: "ok", message: "", log_id: "vq" },
        }),
        { status: 200 },
      ),
    );
  }) as typeof fetch;

  try {
    // deno-lint-ignore no-explicit-any
    const updated = await refreshStoredPostMetrics({ svc: db as any }, "acct-1", "tok-abc");
    assertEquals(updated, 2);

    const updateCalls = db.calls.filter((c) => c.table === "tiktok_posts" && c.operation === "update");
    assertEquals(updateCalls.length, 2, "only v1 and v3 should have been updated");
    const updatedIds = updateCalls.map(
      (c) => c.modifiers.find((m) => m.method === "eq" && m.args[0] === "tiktok_video_id")?.args[1],
    );
    assert(updatedIds.includes("v1"));
    assert(updatedIds.includes("v3"));
    assert(!updatedIds.includes("v2"), "v2 was omitted from the video.query response and must NOT be updated");
  } finally {
    globalThis.fetch = original;
  }
});

// ─── (j) disconnect: tiktok_posts delete failing -> 500, no partial disconnect ─────────

Deno.test("tiktok-integration: disconnect returns 500 and does NOT blank tokens/change status when the tiktok_posts delete fails", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "user-1" });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queue("clientes", "select", { data: { conta_id: "ws-1" }, error: null });

  const { encryptTikTokToken } = await import("../_shared/tiktok.ts");
  const encAccess = await encryptTikTokToken("access-to-revoke", "access");
  db.queue("tiktok_accounts", "select", { data: { id: "acct-1", encrypted_access_token: encAccess }, error: null });
  db.queue("tiktok_posts", "delete", { data: null, error: { message: "boom" } });

  const { storage } = makeStorage();
  const f = stubTikTokFetch();
  const handler = makeHandler(db, storage);

  try {
    const res = await handler(authedRequest("/disconnect/42", "POST"));
    assertEquals(res.status, 500);
    const body = await res.json();
    assertEquals(body, { error: true, message: "Erro interno" });

    const updateCall = db.calls.find((c) => c.table === "tiktok_accounts" && c.operation === "update");
    assert(!updateCall, "tokens must NOT be blanked / status must NOT change when the posts delete fails");
  } finally {
    f.restore();
  }
});

import { assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { encryptText } from "../_shared/crypto.ts";
import { createHubDashboardHandler } from "../hub-dashboard/handler.ts";

const now = () => "2026-04-17T12:00:00.000Z";
const buildCorsHeaders = () => ({ "Access-Control-Allow-Origin": "https://hub.mesaas.com" });

function makeHandler(
  db: ReturnType<typeof createSupabaseQueryMock>,
  feature: (key: string) => Promise<boolean> = async () => false,
) {
  return createHubDashboardHandler({
    effectivePlanFeature: (_db, _ws, key) => feature(key),
    buildCorsHeaders,
    createDb: () => db as never,
    now,
    encryptionSecret: "test-secret",
    rateLimit: async () => true,
  });
}

function stubFetch(response: Record<string, unknown>, ok = true) {
  const original = globalThis.fetch;
  globalThis.fetch = ((_input: unknown) =>
    Promise.resolve(new Response(JSON.stringify(response), { status: ok ? 200 : 500 }))) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

Deno.test("hub-dashboard returns top posts with fresh thumbnails from Graph API", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queue("instagram_accounts", "select", {
    data: {
      id: "ig-acc-1",
      authorization_status: "active",
      token_expires_at: null,
      username: "clinica",
      created_at: "2025-01-01T00:00:00.000Z",
      encrypted_access_token: null,
      follower_count: 15300,
      following_count: 892,
      media_count: 42,
      reach_28d: 89000,
      impressions_28d: 120000,
      last_synced_at: "2026-04-17T10:00:00.000Z",
    },
    error: null,
  });
  db.queue("instagram_posts", "select", {
    data: [
      {
        instagram_post_id: "ig-post-1",
        thumbnail_url: "https://cdn.ig/expired.jpg",
        media_type: "IMAGE",
        permalink: "https://instagram.com/p/abc",
        posted_at: "2026-04-10T10:00:00.000Z",
        likes: 120,
        comments: 15,
        reach: 5000,
        impressions: 6000,
        saved: 80,
        shares: 25,
      },
      {
        instagram_post_id: "ig-post-2",
        thumbnail_url: null,
        media_type: "VIDEO",
        permalink: "https://instagram.com/p/def",
        posted_at: "2026-04-05T14:00:00.000Z",
        likes: 90,
        comments: 10,
        reach: 4000,
        impressions: 5000,
        saved: 50,
        shares: 15,
      },
    ],
    error: null,
  });
  db.queue("instagram_follower_history", "select", {
    data: [
      { date: "2026-03-18", follower_count: 14000 },
      { date: "2026-04-17", follower_count: 15300 },
    ],
    error: null,
  });
  db.queue("instagram_posts", "select", {
    data: [
      { posted_at: "2026-04-05T14:00:00.000Z", reach: 4000, impressions: 5000 },
      { posted_at: "2026-04-10T10:00:00.000Z", reach: 5000, impressions: 6000 },
    ],
    error: null,
  });

  const handler = makeHandler(db);
  const response = await handler(new Request("https://example.test/hub-dashboard?token=hub-123&period=30"));
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.topPosts.length, 2);
  assertEquals(body.topPosts[0].id, "ig-post-1");
  assertEquals(body.topPosts[0].engagementRate, 4.8);
  // No encrypted_access_token → keeps original thumbnail_url
  assertEquals(body.topPosts[0].thumbnailUrl, "https://cdn.ig/expired.jpg");
  assertEquals(body.topPosts[1].thumbnailUrl, null);
  assertEquals(body.followerHistory.length, 2);
  assertEquals(body.reachHistory.length, 2);
  assertEquals(body.account.followerCount, 15300);
  assertEquals(body.period, 30);
  assertEquals(body.tiktok, undefined);
});

Deno.test("hub-dashboard returns empty data when no Instagram account is linked", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queue("instagram_accounts", "select", { data: null, error: null });

  const handler = makeHandler(db);
  const response = await handler(new Request("https://example.test/hub-dashboard?token=hub-123"));
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.topPosts, []);
  assertEquals(body.followerHistory, []);
  assertEquals(body.reachHistory, []);
  assertEquals(body.account, null);
  assertEquals(body.period, 30);
});

Deno.test("hub-dashboard rejects missing token with 400", async () => {
  const handler = makeHandler(createSupabaseQueryMock());
  const response = await handler(new Request("https://example.test/hub-dashboard"));
  assertEquals(response.status, 400);
});

Deno.test("hub-dashboard returns 404 for invalid tokens", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: null, error: null });

  const handler = makeHandler(db);
  const response = await handler(new Request("https://example.test/hub-dashboard?token=expired"));
  assertEquals(response.status, 404);
});

Deno.test("hub-dashboard defaults period to 30 for an invalid value", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queue("instagram_accounts", "select", { data: null, error: null });

  const handler = makeHandler(db);
  const response = await handler(new Request("https://example.test/hub-dashboard?token=hub-123&period=999"));
  const body = await response.json();

  assertEquals(body.period, 30);
});

Deno.test("hub-dashboard handles CORS preflight", async () => {
  const handler = makeHandler(createSupabaseQueryMock());
  const response = await handler(new Request("https://example.test/hub-dashboard", { method: "OPTIONS" }));
  assertEquals(response.status, 200);
});

Deno.test("hub-dashboard rejects non-GET methods with 405", async () => {
  const handler = makeHandler(createSupabaseQueryMock());
  const response = await handler(new Request("https://example.test/hub-dashboard?token=hub-123", { method: "POST" }));
  assertEquals(response.status, 405);
});

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

function selectiveRateLimit(denyPrefix: string, calls: Array<{ key: string; max: number; windowSeconds: number }>) {
  return async (_db: unknown, key: string, max: number, windowSeconds: number) => {
    calls.push({ key, max, windowSeconds });
    return !key.startsWith(denyPrefix);
  };
}

Deno.test("hub-dashboard: invalid token with rateLimit denied returns 429, not 404", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: null, error: null });
  const calls: Array<{ key: string; max: number; windowSeconds: number }> = [];

  const handler = createHubDashboardHandler({
    effectivePlanFeature: async () => false,
    buildCorsHeaders,
    createDb: () => db as never,
    now,
    encryptionSecret: "test-secret",
    rateLimit: selectiveRateLimit("hub-badtoken:", calls),
  });
  const response = await handler(new Request("https://example.test/hub-dashboard?token=expired", {
    headers: { "x-forwarded-for": "1.2.3.4" },
  }));

  assertEquals(response.status, 429);
  const body = await response.json();
  assertEquals(body.error, "Muitas tentativas. Aguarde alguns minutos.");
  assertEquals(calls, [{ key: "hub-badtoken:1.2.3.4", max: 30, windowSeconds: 600 }]);
});

Deno.test("hub-dashboard: invalid token still 404s when the badtoken limit is not exceeded", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: null, error: null });

  const handler = makeHandler(db);
  const response = await handler(new Request("https://example.test/hub-dashboard?token=expired"));

  assertEquals(response.status, 404);
});

Deno.test("hub-dashboard: valid token over the hub-read budget returns 429", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  const calls: Array<{ key: string; max: number; windowSeconds: number }> = [];

  const handler = createHubDashboardHandler({
    effectivePlanFeature: async () => false,
    buildCorsHeaders,
    createDb: () => db as never,
    now,
    encryptionSecret: "test-secret",
    rateLimit: selectiveRateLimit("hub-read:", calls),
  });
  const response = await handler(new Request("https://example.test/hub-dashboard?token=hub-123"));

  assertEquals(response.status, 429);
  assertEquals(calls, [{ key: "hub-read:conta-1:14", max: 300, windowSeconds: 300 }]);
});

Deno.test("hub-dashboard gracefully handles Graph API failure", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queue("instagram_accounts", "select", {
    data: {
      id: "ig-acc-1",
      authorization_status: "active",
      token_expires_at: null,
      username: "clinica",
      created_at: "2025-01-01T00:00:00.000Z",
      encrypted_access_token: "some-encrypted-value",
      follower_count: 1000,
      following_count: 100,
      media_count: 10,
      reach_28d: 5000,
      impressions_28d: 7000,
      last_synced_at: "2026-04-17T10:00:00.000Z",
    },
    error: null,
  });
  db.queue("instagram_posts", "select", {
    data: [{
      instagram_post_id: "ig-post-1",
      thumbnail_url: "https://cdn.ig/old.jpg",
      media_type: "IMAGE",
      permalink: "https://instagram.com/p/abc",
      posted_at: "2026-04-10T10:00:00.000Z",
      likes: 10, comments: 2, reach: 100, impressions: 150, saved: 5, shares: 1,
    }],
    error: null,
  });
  db.queue("instagram_follower_history", "select", { data: [], error: null });
  db.queue("instagram_posts", "select", { data: [], error: null });

  // decryptText will throw on invalid encrypted data → catch block keeps original URLs
  const restore = stubFetch({}, false);
  try {
    const handler = makeHandler(db);
    const response = await handler(new Request("https://example.test/hub-dashboard?token=hub-123&period=30"));
    const body = await response.json();

    assertEquals(response.status, 200);
    assertEquals(body.topPosts[0].thumbnailUrl, "https://cdn.ig/old.jpg");
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Connected accounts summary
// ---------------------------------------------------------------------------

const HUB_TOKEN = { data: { cliente_id: 14, conta_id: "conta-1", is_active: true }, error: null };
type Mock = ReturnType<typeof createSupabaseQueryMock>;

function igRow(over: Record<string, unknown> = {}) {
  return {
    id: "ig-acc-1",
    encrypted_access_token: null,
    follower_count: 15300,
    following_count: 892,
    media_count: 42,
    reach_28d: 89000,
    impressions_28d: 120000,
    last_synced_at: "2026-04-17T10:00:00.000Z",
    authorization_status: "active",
    token_expires_at: null,
    username: "clinica",
    created_at: "2025-01-01T00:00:00.000Z",
    ...over,
  };
}

const ttRow = (over: Record<string, unknown> = {}) => ({
  id: "tt-acc-1",
  client_id: 14,
  username: "clinica_tt",
  display_name: "Clinica",
  avatar_url: null,
  follower_count: 4000,
  likes_count: 9000,
  video_count: 12,
  authorization_status: "active",
  last_synced_at: "2026-04-17T09:00:00.000Z",
  ...over,
});

const callsTo = (db: Mock, table: string) => db.calls.filter((c) => c.table === table);

function queueInstagramEmpty(db: Mock, row = igRow()) {
  db.queue("instagram_accounts", "select", { data: row, error: null });
  db.queue("instagram_posts", "select", { data: [], error: null });
  db.queue("instagram_follower_history", "select", { data: [], error: null });
  db.queue("instagram_posts", "select", { data: [], error: null });
}

const get = (h: (r: Request) => Promise<Response>) => h(new Request("https://example.test/hub-dashboard?token=hub-123"));

Deno.test("hub-dashboard: accounts lists a connected Instagram account with its 30-day change", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", HUB_TOKEN);
  db.queue("instagram_accounts", "select", { data: igRow(), error: null });
  db.queue("instagram_posts", "select", { data: [], error: null });
  db.queue("instagram_follower_history", "select", {
    data: [
      { date: "2026-03-18", follower_count: 14000 },
      { date: "2026-04-17", follower_count: 15300 },
    ],
    error: null,
  });
  db.queue("instagram_posts", "select", { data: [], error: null });

  const body = await (await get(makeHandler(db))).json();

  assertEquals(body.platform, "instagram");
  assertEquals(body.accounts, [{
    platform: "instagram",
    state: "connected",
    username: "clinica",
    followerCount: 15300,
    followersDelta: { value: 1300, since: "2026-03-18", fullWindow: true },
    lastSyncedAt: "2026-04-17T10:00:00.000Z",
    instagram: { reach28d: 89000, impressions28d: 120000, mediaCount: 42 },
  }]);
});

Deno.test("hub-dashboard: a disconnected Instagram row answers like no account", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", HUB_TOKEN);
  db.queue("instagram_accounts", "select", { data: igRow({ authorization_status: "disconnected" }), error: null });

  const body = await (await get(makeHandler(db))).json();

  assertEquals(body.account, null);
  assertEquals(body.accounts, []);
  assertEquals(callsTo(db, "instagram_posts").length, 0);
});

Deno.test("hub-dashboard: an Instagram account that needs reconnection keeps its detail and skips the Graph call", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", HUB_TOKEN);
  db.queue("instagram_accounts", "select", {
    data: igRow({ authorization_status: "expired", encrypted_access_token: "enc" }),
    error: null,
  });
  db.queue("instagram_posts", "select", {
    data: [{
      instagram_post_id: "ig-post-1",
      thumbnail_url: "https://cdn.ig/old.jpg",
      media_type: "IMAGE",
      permalink: "https://instagram.com/p/abc",
      posted_at: "2026-04-10T10:00:00.000Z",
      likes: 10, comments: 2, reach: 100, impressions: 150, saved: 5, shares: 1,
    }],
    error: null,
  });
  db.queue("instagram_follower_history", "select", { data: [], error: null });
  db.queue("instagram_posts", "select", { data: [], error: null });

  const original = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (() => {
    fetchCalls++;
    return Promise.resolve(new Response("{}"));
  }) as typeof fetch;
  try {
    const body = await (await get(makeHandler(db))).json();
    assertEquals(body.accounts[0].state, "needs_reconnect");
    assertEquals(body.topPosts.length, 1);
    assertEquals(fetchCalls, 0);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("hub-dashboard: Instagram change ignores history before the connection date", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", HUB_TOKEN);
  db.queue("instagram_accounts", "select", { data: igRow({ created_at: "2026-04-10T08:00:00.000Z" }), error: null });
  db.queue("instagram_posts", "select", { data: [], error: null });
  db.queue("instagram_follower_history", "select", {
    data: [
      { date: "2026-03-20", follower_count: 100 },
      { date: "2026-04-10", follower_count: 15000 },
      { date: "2026-04-17", follower_count: 15100 },
    ],
    error: null,
  });
  db.queue("instagram_posts", "select", { data: [], error: null });

  const body = await (await get(makeHandler(db))).json();

  assertEquals(body.accounts[0].followersDelta, { value: 100, since: "2026-04-10", fullWindow: false });
});

function queueTikTok(db: Mock, row = ttRow()) {
  db.queue("tiktok_accounts", "select", { data: row, error: null });
  db.queue("tiktok_posts", "select", {
    data: [
      { tiktok_video_id: "v1", posted_at: "2026-04-15T15:00:00.000Z", views: 1200, likes: 10, comments: 1, shares: 0 },
      { tiktok_video_id: "v2", posted_at: "2026-04-01T15:00:00.000Z", views: 800, likes: 5, comments: 0, shares: 0 },
    ],
    error: null,
  });
  db.queue("tiktok_follower_history", "select", {
    data: [
      { date: "2026-03-20", follower_count: 3800, source: "sync" },
      { date: "2026-04-16", follower_count: 4000, source: "sync" },
    ],
    error: null,
  });
}

Deno.test("hub-dashboard: TikTok account appears when the workspace has feature_tiktok", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", HUB_TOKEN);
  queueInstagramEmpty(db);
  queueTikTok(db);

  const asked: string[] = [];
  const body = await (await get(makeHandler(db, async (key) => {
    asked.push(key);
    return key === "feature_tiktok";
  }))).json();

  assertEquals(asked, ["feature_tiktok"]);
  assertEquals(body.accounts.map((a: { platform: string }) => a.platform), ["instagram", "tiktok"]);
  assertEquals(body.accounts[1], {
    platform: "tiktok",
    state: "connected",
    username: "clinica_tt",
    followerCount: 4000,
    followersDelta: { value: 200, since: "2026-03-20", fullWindow: true },
    lastSyncedAt: "2026-04-17T09:00:00.000Z",
    tiktok: { views30d: 2000, likesTotal: 9000, videoCount: 12 },
  });
});

Deno.test("hub-dashboard: TikTok is hidden without feature_tiktok and when the entitlement lookup throws", async () => {
  const lookups: Array<(key: string) => Promise<boolean>> = [
    async () => false,
    async () => {
      throw new Error("rpc down");
    },
  ];
  for (const feature of lookups) {
    const db = createSupabaseQueryMock();
    db.queue("client_hub_tokens", "select", HUB_TOKEN);
    queueInstagramEmpty(db);
    queueTikTok(db);

    const response = await get(makeHandler(db, feature));
    const body = await response.json();

    assertEquals(response.status, 200);
    assertEquals(body.accounts.map((a: { platform: string }) => a.platform), ["instagram"]);
    assertEquals(callsTo(db, "tiktok_posts").length, 0);
  }
});

Deno.test("hub-dashboard: a disconnected TikTok row is not shown and costs no entitlement lookup", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", HUB_TOKEN);
  db.queue("instagram_accounts", "select", { data: null, error: null });
  db.queue("tiktok_accounts", "select", { data: ttRow({ authorization_status: "disconnected" }), error: null });

  let lookups = 0;
  const body = await (await get(makeHandler(db, async () => {
    lookups++;
    return true;
  }))).json();

  assertEquals(body.accounts, []);
  assertEquals(lookups, 0);
});

Deno.test("hub-dashboard: the TikTok account select never names a token column", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", HUB_TOKEN);
  db.queue("instagram_accounts", "select", { data: null, error: null });
  queueTikTok(db);

  await get(makeHandler(db, async () => true));

  const calls = callsTo(db, "tiktok_accounts");
  assertEquals(calls.length, 1);
  const args = JSON.stringify(calls[0].selectArgs);
  assertEquals(args.includes("encrypted_access_token"), false);
  assertEquals(args.includes("encrypted_refresh_token"), false);
});

Deno.test("hub-dashboard: accounts is an empty array when nothing is connected", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", HUB_TOKEN);
  db.queue("instagram_accounts", "select", { data: null, error: null });
  db.queue("tiktok_accounts", "select", { data: null, error: null });

  const body = await (await get(makeHandler(db, async () => true))).json();

  assertEquals(body.accounts, []);
  assertEquals(body.platform, "instagram");
});

// ---------------------------------------------------------------------------
// platform parameter and TikTok detail
// ---------------------------------------------------------------------------

function queueTikTokDetail(db: Mock, row = ttRow()) {
  db.queue("tiktok_accounts", "select", { data: row, error: null });
  db.queue("tiktok_posts", "select", {
    data: [
      { tiktok_video_id: "v-old", posted_at: "2026-04-01T15:00:00.000Z", views: 500, likes: 5, comments: 0, shares: 0,
        title: null, video_description: null, duration: 12, share_url: null, cover_image_url: null },
      { tiktok_video_id: "v-new", posted_at: "2026-04-15T15:00:00.000Z", views: 1200, likes: 60, comments: 12, shares: 12,
        title: null, video_description: null, duration: 30, share_url: "https://t/v", cover_image_url: "https://c/v" },
      { tiktok_video_id: "v-90", posted_at: "2026-02-15T15:00:00.000Z", views: 9000, likes: 0, comments: 0, shares: 0,
        title: null, video_description: null, duration: 5, share_url: null, cover_image_url: null },
    ],
    error: null,
  });
  db.queue("tiktok_follower_history", "select", {
    data: [
      { date: "2026-02-20", follower_count: 3000, source: "sync" },
      { date: "2026-03-25", follower_count: 3800, source: "sync" },
      { date: "2026-04-16", follower_count: 4000, source: "sync" },
    ],
    error: null,
  });
}

const tiktokOn = async (key: string) => key === "feature_tiktok";
const getP = (h: (r: Request) => Promise<Response>, qs: string) =>
  h(new Request(`https://example.test/hub-dashboard?token=hub-123${qs}`));

Deno.test("hub-dashboard: platform=tiktok returns the tiktok block and empty Instagram keys", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", HUB_TOKEN);
  db.queue("instagram_accounts", "select", { data: igRow({ encrypted_access_token: "enc" }), error: null });
  db.queue("instagram_follower_history", "select", { data: [], error: null });
  queueTikTokDetail(db);

  const original = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (() => {
    fetchCalls++;
    return Promise.resolve(new Response("{}"));
  }) as typeof fetch;
  try {
    const body = await (await getP(makeHandler(db, tiktokOn), "&platform=tiktok&period=90")).json();
    assertEquals(body.platform, "tiktok");
    assertEquals([body.topPosts, body.followerHistory, body.reachHistory, body.account], [[], [], [], null]);
    assertEquals(body.tiktok.topVideos.map((v: { id: string }) => v.id), ["v-90", "v-new", "v-old"]);
    assertEquals(body.tiktok.topVideos[1].engagementRate, 7);
    assertEquals(body.tiktok.viewsHistory, [
      { date: "2026-02-15", views: 9000 },
      { date: "2026-04-01", views: 500 },
      { date: "2026-04-15", views: 1200 },
    ]);
    assertEquals(body.tiktok.followerHistory[0], { date: "2026-02-20", followerCount: 3000 });
    assertEquals(body.accounts.map((a: { platform: string }) => a.platform), ["instagram", "tiktok"]);
    assertEquals(callsTo(db, "instagram_posts").length, 0);
    assertEquals(callsTo(db, "tiktok_posts").length, 1);
    assertEquals(callsTo(db, "tiktok_follower_history").length, 1);
    assertEquals(fetchCalls, 0);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("hub-dashboard: a TikTok-only client gets TikTok detail without sending platform", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", HUB_TOKEN);
  db.queue("instagram_accounts", "select", { data: null, error: null });
  queueTikTokDetail(db);

  // period=90 so the fixture's 60-day-old video is inside the (mock-ignored) window
  const body = await (await getP(makeHandler(db, tiktokOn), "&period=90")).json();

  assertEquals(body.platform, "tiktok");
  assertEquals(body.account, null);
  assertEquals(body.accounts.map((a: { platform: string }) => a.platform), ["tiktok"]);
  assertEquals(body.tiktok.topVideos.length, 3);
});

Deno.test("hub-dashboard: a TikTok card shows on the disconnected-Instagram path", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", HUB_TOKEN);
  db.queue("instagram_accounts", "select", { data: igRow({ authorization_status: "disconnected" }), error: null });
  queueTikTokDetail(db);

  const body = await (await getP(makeHandler(db, tiktokOn), "&platform=instagram")).json();

  assertEquals(body.platform, "instagram");
  assertEquals(body.accounts.map((a: { platform: string }) => a.platform), ["tiktok"]);
  assertEquals(body.tiktok, undefined);
});

Deno.test("hub-dashboard: platform=tiktok without a TikTok card answers 200 with no tiktok block", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", HUB_TOKEN);
  db.queue("instagram_accounts", "select", { data: igRow(), error: null });
  db.queue("instagram_follower_history", "select", { data: [], error: null });
  db.queue("tiktok_accounts", "select", { data: null, error: null });

  const response = await getP(makeHandler(db, tiktokOn), "&platform=tiktok");
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.platform, "tiktok");
  assertEquals(body.tiktok, undefined);
  assertEquals(body.accounts.map((a: { platform: string }) => a.platform), ["instagram"]);
});

Deno.test("hub-dashboard: with period=90 the TikTok summary still uses 30 days", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", HUB_TOKEN);
  db.queue("instagram_accounts", "select", { data: null, error: null });
  queueTikTokDetail(db);

  const body = await (await getP(makeHandler(db, tiktokOn), "&period=90")).json();

  assertEquals(body.accounts[0].tiktok.views30d, 1700);
  assertEquals(body.accounts[0].followersDelta, { value: 200, since: "2026-03-25", fullWindow: false });
  assertEquals(body.tiktok.topVideos.length, 3);
});

Deno.test("hub-dashboard: a TikTok that needs reconnection still returns its stored history", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", HUB_TOKEN);
  db.queue("instagram_accounts", "select", { data: null, error: null });
  queueTikTokDetail(db, ttRow({ authorization_status: "expired" }));

  const body = await (await getP(makeHandler(db, tiktokOn), "&period=90")).json();

  assertEquals(body.accounts[0].state, "needs_reconnect");
  assertEquals(body.tiktok.topVideos.length, 3);
});

Deno.test("hub-dashboard: a throwing TikTok loader is swallowed and Instagram stays intact", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", HUB_TOKEN);
  queueInstagramEmpty(db);
  db.queue("tiktok_accounts", "select", { data: ttRow(), error: null });
  db.queue("tiktok_posts", "select", { data: null, error: { message: "boom" } });
  db.queue("tiktok_follower_history", "select", { data: [], error: null });

  const origErr = console.error;
  const logged: unknown[][] = [];
  console.error = (...a: unknown[]) => void logged.push(a);
  try {
    const response = await get(makeHandler(db, tiktokOn));
    const body = await response.json();
    assertEquals(response.status, 200);
    assertEquals(body.accounts.map((a: { platform: string }) => a.platform), ["instagram"]);
    assertEquals(body.account.followerCount, 15300);
    assertEquals(logged.length, 1);
  } finally {
    console.error = origErr;
  }
});

Deno.test("hub-dashboard: an unknown platform value falls back to the default", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", HUB_TOKEN);
  queueInstagramEmpty(db);

  const body = await (await getP(makeHandler(db), "&platform=youtube")).json();
  assertEquals(body.platform, "instagram");
});

Deno.test("hub-dashboard: the Graph call carries a timeout signal and a timeout keeps stored thumbnails", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", HUB_TOKEN);
  db.queue("instagram_accounts", "select", {
    data: igRow({ encrypted_access_token: await encryptText("tok", "test-secret", "instagram-access-token") }),
    error: null,
  });
  db.queue("instagram_posts", "select", {
    data: [{
      instagram_post_id: "ig-post-1",
      thumbnail_url: "https://cdn.ig/old.jpg",
      media_type: "IMAGE",
      permalink: "https://instagram.com/p/abc",
      posted_at: "2026-04-10T10:00:00.000Z",
      likes: 10, comments: 2, reach: 100, impressions: 150, saved: 5, shares: 1,
    }],
    error: null,
  });
  db.queue("instagram_follower_history", "select", { data: [], error: null });
  db.queue("instagram_posts", "select", { data: [], error: null });

  const original = globalThis.fetch;
  let init: RequestInit | undefined;
  globalThis.fetch = ((_input: unknown, i?: RequestInit) => {
    init = i;
    return Promise.reject(new DOMException("timed out", "TimeoutError"));
  }) as typeof fetch;
  try {
    const response = await get(makeHandler(db));
    const body = await response.json();
    assertEquals(response.status, 200);
    assertEquals(body.topPosts[0].thumbnailUrl, "https://cdn.ig/old.jpg");
    assertEquals(init?.signal instanceof AbortSignal, true);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("hub-dashboard: platform=tiktok&period=90 queries TikTok videos from a 90-day lower bound", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", HUB_TOKEN);
  db.queue("instagram_accounts", "select", { data: null, error: null });
  queueTikTokDetail(db);

  await getP(makeHandler(db, tiktokOn), "&platform=tiktok&period=90");

  const gte = callsTo(db, "tiktok_posts")[0].modifiers.find((m) => m.method === "gte");
  // now 2026-04-17 (SP) minus 89 days = 2026-01-18, opening at the SP midnight
  assertEquals(gte?.args, ["posted_at", "2026-01-18T03:00:00.000Z"]);
});

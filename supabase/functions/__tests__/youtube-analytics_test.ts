// youtube-analytics (Phase 2 Task 10): read routes, DI'd like tiktok-analytics_test.ts. The shared
// supabaseMock ignores filters and hands back queued rows per `table:operation`, in call order,
// so tenant scoping and window clipping are asserted on the recorded modifiers.
import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock, type QueryCall } from "../../../test/shared/supabaseMock.ts";
import { createYouTubeAnalyticsHandler } from "../youtube-analytics/handlers.ts";
import { YT_KPI_IDS } from "../_shared/youtube-analytics/kpis.ts";

type Mock = ReturnType<typeof createSupabaseQueryMock>;

// 05:00 PDT on 2026-10-30 (LA today = 2026-10-30).
const NOW = new Date("2026-10-30T12:00:00.000Z");

const CHANNEL = {
  id: "ych-1",
  client_id: 42,
  channel_id: "UC123",
  title: "Dra. Ana",
  handle: "@draana",
  avatar_url: "https://yt.example/a.jpg",
  subscriber_count: 1000,
  authorization_status: "active",
  revoked_at: null,
  last_synced_at: "2026-10-30T09:35:00.000Z",
  data_through: "2026-10-27",
  content_type_through: "2026-10-27",
  traffic_through: "2026-10-27",
  videos_through: "2026-10-27",
};

function daily(day: string, contentType: string, over: Record<string, unknown> = {}) {
  return {
    day,
    content_type: contentType,
    views: 100,
    engaged_views: 80,
    estimated_minutes_watched: 50,
    likes: 10,
    comments: 2,
    shares: 1,
    subscribers_gained: 5,
    subscribers_lost: 1,
    average_view_duration_s: 30,
    ...over,
  };
}

function video(id: string, publishedAt: string, isShort: boolean, over: Record<string, unknown> = {}) {
  return {
    video_id: id,
    title: `t-${id}`,
    published_at: publishedAt,
    is_short: isShort,
    thumbnail_url: `https://i.ytimg.com/vi/${id}/hq.jpg`,
    ...over,
  };
}

function videoDay(id: string, day: string, views: number, over: Record<string, unknown> = {}) {
  return {
    video_id: id,
    day,
    views,
    engaged_views: views,
    likes: 1,
    comments: 1,
    subscribers_gained: 0,
    average_view_duration_s: 20,
    average_view_percentage: 50,
    ...over,
  };
}

function makeHandler(db: Mock, overrides: Record<string, unknown> = {}) {
  return createYouTubeAnalyticsHandler({
    buildCorsHeaders: () => ({}),
    // deno-lint-ignore no-explicit-any
    createServiceDb: () => db as any,
    now: () => NOW,
    ...overrides,
  });
}

function get(path: string, token: string | null = "tok") {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request(`https://proj.supabase.co/functions/v1/youtube-analytics${path}`, { headers });
}

/** Signed-in caller, active workspace ws-B (legacy conta_id points elsewhere), member of ws-B. */
function signedIn(db: Mock, { member = true }: { member?: boolean } = {}) {
  db.withAuth({ id: "user-1" });
  db.queue("profiles", "select", { data: { active_workspace_id: "ws-B", conta_id: "ws-A" } });
  db.queue("workspace_members", "select", { data: member ? { user_id: "user-1" } : null });
}

function ownedClient(db: Mock) {
  db.queue("clientes", "select", { data: { id: 42, nome: "Ana" } });
}

function connected(db: Mock, over: Record<string, unknown> = {}) {
  signedIn(db);
  ownedClient(db);
  db.queue("youtube_channels", "select", { data: { ...CHANNEL, ...over } });
}

const callsTo = (db: Mock, table: string): QueryCall[] => db.calls.filter((c) => c.table === table);
const mods = (c: QueryCall, method: string) => c.modifiers.filter((m) => m.method === method).map((m) => m.args);
const hasEq = (c: QueryCall, col: string, val: unknown) => mods(c, "eq").some(([k, v]) => k === col && v === val);
const featureCalls = (db: Mock) =>
  db.calls.filter((c) => c.table === "rpc:effective_plan_feature").map((c) => (c.payload as { feature_key: string }).feature_key);

/** Every history read carries the workspace and the channel. */
function assertScoped(db: Mock, table: string) {
  const calls = callsTo(db, table);
  assert(calls.length > 0, `no ${table} read`);
  for (const c of calls) {
    assert(hasEq(c, "conta_id", "ws-B"), `${table} missing conta_id`);
    assert(hasEq(c, "channel_id", "UC123"), `${table} missing channel_id`);
  }
}

async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = original;
  }
}

// ── auth / tenant ─────────────────────────────────────────────────────────────

Deno.test("youtube-analytics: OPTIONS answers the preflight", async () => {
  const db = createSupabaseQueryMock();
  const res = await makeHandler(db)(new Request("https://proj.supabase.co/functions/v1/youtube-analytics/overview/42", { method: "OPTIONS" }));
  assertEquals(res.status, 200);
  assertEquals(db.calls.length, 0);
});

Deno.test("youtube-analytics: 401 without bearer token", async () => {
  const db = createSupabaseQueryMock();
  const res = await makeHandler(db)(get("/overview/42", null));
  assertEquals(res.status, 401);
  assertEquals(db.calls.length, 0);
});

Deno.test("youtube-analytics: 401 when getUser rejects the token", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth(null, { message: "bad jwt" });
  const res = await makeHandler(db)(get("/overview/42"));
  assertEquals(res.status, 401);
  assertEquals(callsTo(db, "profiles").length, 0);
});

Deno.test("youtube-analytics: uses active_workspace_id, not profiles.conta_id", async () => {
  const db = createSupabaseQueryMock();
  connected(db);
  await makeHandler(db)(get("/overview/42"));
  const [membership] = callsTo(db, "workspace_members");
  assert(hasEq(membership, "workspace_id", "ws-B"));
  const [client] = callsTo(db, "clientes");
  assert(hasEq(client, "conta_id", "ws-B"), "client lookup must be scoped to the active workspace");
  const [channel] = callsTo(db, "youtube_channels");
  assert(hasEq(channel, "conta_id", "ws-B"), "channel lookup must be scoped to the active workspace");
  assert(hasEq(channel, "client_id", 42));
});

Deno.test("youtube-analytics: caller who is not a workspace member is rejected (tenant.ts answers 401)", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db, { member: false });
  const res = await makeHandler(db)(get("/overview/42"));
  assertEquals(res.status, 401);
  assertEquals(callsTo(db, "clientes").length, 0);
});

Deno.test("youtube-analytics: no active workspace is rejected before the membership read", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "user-1" });
  db.queue("profiles", "select", { data: { active_workspace_id: null, conta_id: "ws-A" } });
  const res = await makeHandler(db)(get("/overview/42"));
  assertEquals(res.status, 401);
  assertEquals(callsTo(db, "workspace_members").length, 0);
});

Deno.test("youtube-analytics: 429 past the per-workspace rate limit", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  const keys: unknown[] = [];
  const res = await makeHandler(db, {
    checkRateLimit: (_db: unknown, key: string, max: number, win: number) => {
      keys.push([key, max, win]);
      return Promise.resolve(false);
    },
  })(get("/overview/42"));
  assertEquals(res.status, 429);
  assertEquals(keys, [["youtube-analytics:ws-B", 120, 60]]);
  assertEquals(callsTo(db, "clientes").length, 0);
});

Deno.test("youtube-analytics: a foreign client is 403 before any plan flag is read", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  db.queue("clientes", "select", { data: null }); // filtered out by conta_id = ws-B
  db.queueRpc("effective_plan_feature", { data: false });
  const res = await makeHandler(db)(get("/overview/42"));
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "Unauthorized" });
  assertEquals(featureCalls(db), []);
  assertEquals(callsTo(db, "youtube_channels").length, 0);
});

// ── feature gates ─────────────────────────────────────────────────────────────

Deno.test("youtube-analytics: 403 feature_disabled when feature_youtube is off", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  ownedClient(db);
  db.queueRpc("effective_plan_feature", { data: false });
  const res = await makeHandler(db)(get("/overview/42"));
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "feature_disabled", feature: "feature_youtube" });
  assertEquals(callsTo(db, "youtube_channels").length, 0);
});

Deno.test("youtube-analytics: 403 feature_disabled when feature_analytics_reports is off", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  ownedClient(db);
  db.queueRpc("effective_plan_feature", { data: true }, { data: false });
  const res = await makeHandler(db)(get("/videos/42"));
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "feature_disabled", feature: "feature_analytics_reports" });
  assertEquals(featureCalls(db), ["feature_youtube", "feature_analytics_reports"]);
  assertEquals(callsTo(db, "youtube_channels").length, 0);
});

Deno.test("youtube-analytics: every route checks exactly the two flags", async () => {
  for (const route of ["overview", "daily", "traffic", "demographics", "videos", "top-shorts"]) {
    const db = createSupabaseQueryMock();
    connected(db);
    const res = await makeHandler(db)(get(`/${route}/42`));
    assertEquals(res.status, 200, route);
    assertEquals(featureCalls(db), ["feature_youtube", "feature_analytics_reports"], route);
  }
});

// ── input validation / connection ─────────────────────────────────────────────

Deno.test("youtube-analytics: 400 on an invalid client id", async () => {
  for (const id of ["abc", "0", "-1", "1.5"]) {
    const db = createSupabaseQueryMock();
    signedIn(db);
    const res = await makeHandler(db)(get(`/overview/${id}`));
    assertEquals(res.status, 400, id);
    assertEquals(await res.json(), { error: "invalid_client_id" });
    assertEquals(callsTo(db, "clientes").length, 0);
  }
});

Deno.test("youtube-analytics: 400 invalid_window on bad days or ranges", async () => {
  for (
    const q of [
      "days=30",
      "days=0",
      "days=abc",
      "start=2026-10-28&end=2026-10-01",
      "start=2026-10-01",
      "start=2025-01-01&end=2026-10-01",
    ]
  ) {
    const db = createSupabaseQueryMock();
    signedIn(db);
    const res = await makeHandler(db)(get(`/daily/42?${q}`));
    assertEquals(res.status, 400, q);
    assertEquals(await res.json(), { error: "invalid_window" }, q);
    assertEquals(callsTo(db, "clientes").length, 0);
  }
});

Deno.test("youtube-analytics: 400 invalid_type on an unknown content type", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  const res = await makeHandler(db)(get("/overview/42?type=live"));
  assertEquals(res.status, 400);
  assertEquals(await res.json(), { error: "invalid_type" });
  assertEquals(callsTo(db, "clientes").length, 0);
});

Deno.test("youtube-analytics: 400 invalid_sort on an unknown sort", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  const res = await makeHandler(db)(get("/videos/42?sort=comments"));
  assertEquals(res.status, 400);
  assertEquals(await res.json(), { error: "invalid_sort" });
  assertEquals(callsTo(db, "clientes").length, 0);
});

Deno.test("youtube-analytics: 404 not_connected when the client has no channel row", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  ownedClient(db);
  db.queue("youtube_channels", "select", { data: null });
  const res = await makeHandler(db)(get("/overview/42"));
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "not_connected" });
});

Deno.test("youtube-analytics: never selects token columns and never reads google_connections", async () => {
  for (const route of ["overview", "daily", "traffic", "demographics", "videos", "top-shorts"]) {
    const db = createSupabaseQueryMock();
    connected(db);
    await makeHandler(db)(get(`/${route}/42`));
    assertEquals(callsTo(db, "google_connections").length, 0, route);
    for (const c of db.calls) {
      for (const args of c.selectArgs) {
        const cols = String(args[0] ?? "");
        assert(!cols.includes("token"), `${route} ${c.table}: ${cols}`);
        assert(!cols.includes("*"), `${route} ${c.table}: ${cols}`);
      }
    }
  }
});

Deno.test("youtube-analytics: a failed read is a generic 500 with no detail", async () => {
  const db = createSupabaseQueryMock();
  connected(db);
  db.queue("youtube_channel_daily", "select", { data: null, error: { message: "relation secret detail", code: "42P01" } });
  const res = await quietly(() => makeHandler(db)(get("/overview/42")));
  assertEquals(res.status, 500);
  const text = await res.text();
  assertEquals(JSON.parse(text), { error: "Internal server error" });
  assert(!text.includes("secret") && !text.includes("42P01"), text);
});

Deno.test("youtube-analytics: unknown route is a 404", async () => {
  for (const path of ["/nope", "/nope/42", "/ai-analysis/42"]) {
    const db = createSupabaseQueryMock();
    signedIn(db);
    const res = await makeHandler(db)(get(path));
    assertEquals(res.status, 404, path);
    assertEquals(await res.json(), { error: "not_found" });
  }
});

Deno.test("youtube-analytics: POST to a read route is a 404", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  const res = await makeHandler(db)(
    new Request("https://proj.supabase.co/functions/v1/youtube-analytics/overview/42", {
      method: "POST",
      headers: { Authorization: "Bearer tok" },
    }),
  );
  assertEquals(res.status, 404);
});

// ── overview ──────────────────────────────────────────────────────────────────

Deno.test("youtube-analytics: overview ?days=28 ends at data_through and compares with the 28 days before", async () => {
  const db = createSupabaseQueryMock();
  connected(db);
  db.queue("youtube_channel_daily", "select", {
    data: [
      // previous window
      daily("2026-09-10", "all", { views: 50 }),
      // current window
      daily("2026-10-26", "all", { views: 100, average_view_duration_s: 30 }),
      daily("2026-10-27", "all", { views: 300, average_view_duration_s: 10, subscribers_gained: 10, subscribers_lost: 4 }),
      daily("2026-10-27", "long", { views: 300 }),
    ],
  });
  const res = await makeHandler(db)(get("/overview/42?days=28"));
  assertEquals(res.status, 200);
  const body = await res.json();

  assertEquals(body.window, { start: "2026-09-30", end: "2026-10-27", prevStart: "2026-09-02", prevEnd: "2026-09-29" });
  assertEquals(body.channel, {
    title: "Dra. Ana",
    handle: "@draana",
    avatarUrl: "https://yt.example/a.jpg",
    subscriberCount: 1000,
    authorizationStatus: "active",
    lastSyncedAt: "2026-10-30T09:35:00.000Z",
    dataThrough: "2026-10-27",
    contentTypeThrough: "2026-10-27",
    trafficThrough: "2026-10-27",
  });
  assertEquals(body.kpis.views, { value: 400, prev: 50 });
  assertEquals(body.kpis.avg_view_duration_s.value, 15);
  assertEquals(body.kpis.net_subscribers.value, 10);
  assertEquals(body.kpis.net_subscribers.gained, 15);
  assertEquals(body.kpis.net_subscribers.lost, 5);
  assertEquals(body.kpis.subscribers, { value: 1000, prev: 990 });
  assertEquals(Object.keys(body.kpis).sort(), [...YT_KPI_IDS].sort());
  // A channel with no Shorts: zeros on the split, not "sem dados".
  assertEquals(body.split.views, { shorts: 0, long: 300 });

  // One read of [prevStart, end], scoped to the workspace and channel.
  const [read] = callsTo(db, "youtube_channel_daily");
  assertEquals(mods(read, "gte"), [["day", "2026-09-02"]]);
  assertEquals(mods(read, "lte"), [["day", "2026-10-27"]]);
  assertScoped(db, "youtube_channel_daily");
});

Deno.test("youtube-analytics: overview defaults to 28 days and type=all", async () => {
  const db = createSupabaseQueryMock();
  connected(db);
  const res = await makeHandler(db)(get("/overview/42"));
  const body = await res.json();
  assertEquals(body.window.start, "2026-09-30");
  assertEquals(body.window.end, "2026-10-27");
  // No rows in the previous window (before the backfill): no comparison.
  assertEquals(body.kpis.views, { value: 0, prev: null });
});

Deno.test("youtube-analytics: overview type=shorts sums the shorts rows; subscribers still uses 'all'", async () => {
  const db = createSupabaseQueryMock();
  connected(db);
  db.queue("youtube_channel_daily", "select", {
    data: [
      daily("2026-09-10", "all"),
      daily("2026-10-27", "all", { views: 500, subscribers_gained: 7, subscribers_lost: 2 }),
      daily("2026-10-27", "shorts", { views: 200, subscribers_gained: null, subscribers_lost: null }),
      daily("2026-10-27", "long", { views: 300 }),
    ],
  });
  const body = await (await makeHandler(db)(get("/overview/42?type=shorts"))).json();
  assertEquals(body.kpis.views, { value: 200, prev: 0 });
  assertEquals(body.kpis.net_subscribers.value, null);
  assertEquals(body.kpis.subscribers, { value: 1000, prev: 995 });
  assertEquals(body.split.views, { shorts: 200, long: 300 });
});

Deno.test("youtube-analytics: overview split stops at content_type_through", async () => {
  const db = createSupabaseQueryMock();
  connected(db, { content_type_through: "2026-10-25" });
  db.queue("youtube_channel_daily", "select", {
    data: [
      daily("2026-10-25", "shorts", { views: 10 }),
      daily("2026-10-26", "shorts", { views: 999 }),
      daily("2026-10-25", "long", { views: 20 }),
    ],
  });
  const body = await (await makeHandler(db)(get("/overview/42?days=7"))).json();
  assertEquals(body.split.views, { shorts: 10, long: 20 });
  assertEquals(body.channel.contentTypeThrough, "2026-10-25");
});

Deno.test("youtube-analytics: overview ?start&end is clipped to data_through", async () => {
  const db = createSupabaseQueryMock();
  connected(db);
  const body = await (await makeHandler(db)(get("/overview/42?start=2026-10-01&end=2026-10-30"))).json();
  assertEquals(body.window, { start: "2026-10-01", end: "2026-10-27", prevStart: "2026-09-04", prevEnd: "2026-09-30" });
});

Deno.test("youtube-analytics: before the first sync the overview is 200 with every KPI null", async () => {
  const db = createSupabaseQueryMock();
  connected(db, { data_through: null, content_type_through: null, traffic_through: null, videos_through: null, last_synced_at: null });
  const res = await makeHandler(db)(get("/overview/42?days=28"));
  assertEquals(res.status, 200);
  const body = await res.json();
  // Window anchored at the LA today, never null.
  assertEquals(body.window, { start: "2026-10-03", end: "2026-10-30", prevStart: "2026-09-05", prevEnd: "2026-10-02" });
  assertEquals(Object.keys(body.kpis).sort(), [...YT_KPI_IDS].sort());
  for (const id of YT_KPI_IDS) {
    assertEquals(body.kpis[id].value, null, id);
    assertEquals(body.kpis[id].prev, null, id);
  }
  assertEquals(body.split, { views: { shorts: 0, long: 0 }, minutes: { shorts: 0, long: 0 }, likes: { shorts: 0, long: 0 } });
  assertEquals(body.channel.dataThrough, null);
  assertEquals(callsTo(db, "youtube_channel_daily").length, 0);
});

Deno.test("youtube-analytics: a revoked, purged channel returns 200 with authorizationStatus revoked and null KPIs", async () => {
  const db = createSupabaseQueryMock();
  connected(db, {
    authorization_status: "revoked",
    revoked_at: "2026-10-29T00:00:00.000Z",
    avatar_url: null,
    subscriber_count: null,
    data_through: null,
    content_type_through: null,
    traffic_through: null,
    videos_through: null,
  });
  const res = await makeHandler(db)(get("/overview/42"));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.channel.authorizationStatus, "revoked");
  assertEquals(body.channel.title, "Dra. Ana");
  for (const id of YT_KPI_IDS) assertEquals(body.kpis[id].value, null, id);

  for (const [route, key] of [["daily", "daily"], ["traffic", "traffic"], ["videos", "videos"], ["top-shorts", "shorts"]]) {
    const db2 = createSupabaseQueryMock();
    connected(db2, { authorization_status: "revoked", data_through: null, content_type_through: null, traffic_through: null });
    const r = await makeHandler(db2)(get(`/${route}/42`));
    assertEquals(r.status, 200, route);
    assertEquals(await r.json(), { [key]: [] }, route);
  }
});

Deno.test("youtube-analytics: a range entirely after data_through returns null KPIs", async () => {
  const db = createSupabaseQueryMock();
  connected(db);
  const body = await (await makeHandler(db)(get("/overview/42?start=2026-10-28&end=2026-10-30"))).json();
  assertEquals(body.window, { start: "2026-10-28", end: "2026-10-30", prevStart: "2026-10-25", prevEnd: "2026-10-27" });
  assertEquals(body.kpis.views, { value: null, prev: null });
  assertEquals(callsTo(db, "youtube_channel_daily").length, 0);
});

// ── daily ─────────────────────────────────────────────────────────────────────

Deno.test("youtube-analytics: daily is one point per day, zero-filled, with the split up to content_type_through", async () => {
  const db = createSupabaseQueryMock();
  connected(db, { content_type_through: "2026-10-26" });
  db.queue("youtube_channel_daily", "select", {
    data: [
      daily("2026-10-21", "all", { views: 40 }),
      daily("2026-10-21", "long", { views: 40 }),
      daily("2026-10-27", "all", { views: 70, likes: null }),
      daily("2026-10-27", "shorts", { views: 70 }),
    ],
  });
  const res = await makeHandler(db)(get("/daily/42?days=7"));
  assertEquals(res.status, 200);
  const { daily: points } = await res.json();
  assertEquals(points.map((p: { date: string }) => p.date), [
    "2026-10-21",
    "2026-10-22",
    "2026-10-23",
    "2026-10-24",
    "2026-10-25",
    "2026-10-26",
    "2026-10-27",
  ]);
  assertEquals(points[0], {
    date: "2026-10-21",
    views: 40,
    engagedViews: 80,
    watchMinutes: 50,
    likes: 10,
    comments: 2,
    shares: 1,
    subscribersGained: 5,
    subscribersLost: 1,
    shortsViews: 0,
    longViews: 40,
  });
  // A day the report omitted counts as zero.
  assertEquals(points[1].views, 0);
  assertEquals(points[1].likes, 0);
  assertEquals(points[1].shortsViews, 0);
  // Past content_type_through the split is unknown: left out.
  assertEquals(points[6].views, 70);
  assertEquals(points[6].likes, null);
  assertEquals("shortsViews" in points[6], false);
  assertEquals("longViews" in points[6], false);

  const [read] = callsTo(db, "youtube_channel_daily");
  assertEquals(mods(read, "gte"), [["day", "2026-10-21"]]);
  assertEquals(mods(read, "lte"), [["day", "2026-10-27"]]);
  assertScoped(db, "youtube_channel_daily");
});

Deno.test("youtube-analytics: daily type=long reads the long rows", async () => {
  const db = createSupabaseQueryMock();
  connected(db);
  db.queue("youtube_channel_daily", "select", {
    data: [daily("2026-10-27", "all", { views: 70 }), daily("2026-10-27", "long", { views: 30, likes: null })],
  });
  const { daily: points } = await (await makeHandler(db)(get("/daily/42?days=7&type=long"))).json();
  assertEquals(points[6].views, 30);
  assertEquals(points[6].likes, null);
  assertEquals(points[0].views, 0);
});

// ── traffic / demographics ────────────────────────────────────────────────────

Deno.test("youtube-analytics: traffic sums views per source over the window, clipped to traffic_through", async () => {
  const db = createSupabaseQueryMock();
  connected(db, { traffic_through: "2026-10-25" });
  db.queue("youtube_traffic_daily", "select", {
    data: [
      { day: "2026-10-24", source_type: "YT_SEARCH", views: 10 },
      { day: "2026-10-25", source_type: "SHORTS", views: 40 },
      { day: "2026-10-25", source_type: "YT_SEARCH", views: 15 },
      { day: "2026-10-25", source_type: "EXT_URL", views: null },
    ],
  });
  const res = await makeHandler(db)(get("/traffic/42?days=7"));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    traffic: [
      { sourceType: "SHORTS", views: 40 },
      { sourceType: "YT_SEARCH", views: 25 },
      { sourceType: "EXT_URL", views: 0 },
    ],
  });
  const [read] = callsTo(db, "youtube_traffic_daily");
  assertEquals(mods(read, "gte"), [["day", "2026-10-21"]]);
  assertEquals(mods(read, "lte"), [["day", "2026-10-25"]]);
  assertScoped(db, "youtube_traffic_daily");
});

Deno.test("youtube-analytics: traffic with no traffic watermark is empty and reads nothing", async () => {
  const db = createSupabaseQueryMock();
  connected(db, { traffic_through: null });
  assertEquals(await (await makeHandler(db)(get("/traffic/42"))).json(), { traffic: [] });
  assertEquals(callsTo(db, "youtube_traffic_daily").length, 0);
});

Deno.test("youtube-analytics: demographics returns the latest 28-day snapshot", async () => {
  const db = createSupabaseQueryMock();
  connected(db);
  db.queue(
    "youtube_demographics",
    "select",
    { data: [{ window_end: "2026-10-27" }] },
    {
      data: [
        { age_group: "age25-34", gender: "female", viewer_pct: "41.5" },
        { age_group: "age35-44", gender: "male", viewer_pct: 12 },
      ],
    },
  );
  const res = await makeHandler(db)(get("/demographics/42"));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    rows: [
      { ageGroup: "age25-34", gender: "female", viewerPct: 41.5 },
      { ageGroup: "age35-44", gender: "male", viewerPct: 12 },
    ],
  });
  const [latest, rows] = callsTo(db, "youtube_demographics");
  assertEquals(mods(latest, "order"), [["window_end", { ascending: false }]]);
  assert(hasEq(rows, "window_end", "2026-10-27"));
  assertScoped(db, "youtube_demographics");
});

Deno.test("youtube-analytics: demographics with no snapshot is empty", async () => {
  const db = createSupabaseQueryMock();
  connected(db);
  db.queue("youtube_demographics", "select", { data: [] });
  assertEquals(await (await makeHandler(db)(get("/demographics/42"))).json(), { rows: [] });
  assertEquals(callsTo(db, "youtube_demographics").length, 1);
});

// ── videos / top shorts ───────────────────────────────────────────────────────

Deno.test("youtube-analytics: videos lists the videos published in the window with window sums, by views", async () => {
  const db = createSupabaseQueryMock();
  connected(db);
  db.queue("youtube_videos", "select", {
    data: [
      video("a", "2026-10-25T15:00:00.000Z", true),
      video("b", "2026-10-22T15:00:00.000Z", false),
      video("c", "2026-10-26T15:00:00.000Z", false),
    ],
  });
  db.queue("youtube_video_daily", "select", {
    data: [
      videoDay("a", "2026-10-25", 100, { average_view_percentage: 80 }),
      videoDay("a", "2026-10-26", 300, { average_view_percentage: 40, likes: 9 }),
      videoDay("b", "2026-10-23", 1000),
      // A video published outside the window: ignored.
      videoDay("zzz", "2026-10-26", 5000),
    ],
  });
  const res = await makeHandler(db)(get("/videos/42?days=7"));
  assertEquals(res.status, 200);
  const { videos } = await res.json();
  assertEquals(videos.map((v: { videoId: string }) => v.videoId), ["b", "a", "c"]);
  assertEquals(videos[1], {
    videoId: "a",
    title: "t-a",
    isShort: true,
    publishedAt: "2026-10-25T15:00:00.000Z",
    thumbnailUrl: "https://i.ytimg.com/vi/a/hq.jpg",
    views: 400,
    engagedViews: 400,
    avgViewDurationS: 20,
    avgViewPct: 50,
    likes: 10,
    comments: 2,
    subscribersGained: 0,
  });
  // No daily rows yet: zeros, unknown averages.
  assertEquals(videos[2].views, 0);
  assertEquals(videos[2].avgViewPct, null);

  // "Publicados no período": published_at in [LA midnight of start, LA midnight after end).
  const [list] = callsTo(db, "youtube_videos");
  assertEquals(mods(list, "gte"), [["published_at", "2026-10-21T07:00:00.000Z"]]);
  assertEquals(mods(list, "lt"), [["published_at", "2026-10-28T07:00:00.000Z"]]);
  const [days] = callsTo(db, "youtube_video_daily");
  assertEquals(mods(days, "gte"), [["day", "2026-10-21"]]);
  assertEquals(mods(days, "lte"), [["day", "2026-10-27"]]);
  assertEquals(mods(days, "in"), []);
  assertScoped(db, "youtube_videos");
  assertScoped(db, "youtube_video_daily");
});

Deno.test("youtube-analytics: videos sort=published_at and sort=likes", async () => {
  const setup = () => {
    const db = createSupabaseQueryMock();
    connected(db);
    db.queue("youtube_videos", "select", {
      data: [
        video("old", "2026-10-21T15:00:00.000Z", false),
        video("new", "2026-10-27T15:00:00.000Z", false),
        video("mid", "2026-10-24T15:00:00.000Z", false),
      ],
    });
    db.queue("youtube_video_daily", "select", {
      data: [
        videoDay("old", "2026-10-22", 900, { likes: 1 }),
        videoDay("mid", "2026-10-25", 10, { likes: 50 }),
        videoDay("new", "2026-10-27", 100, { likes: 5 }),
      ],
    });
    return db;
  };
  const byDate = await (await makeHandler(setup())(get("/videos/42?days=7&sort=published_at"))).json();
  assertEquals(byDate.videos.map((v: { videoId: string }) => v.videoId), ["new", "mid", "old"]);
  const byLikes = await (await makeHandler(setup())(get("/videos/42?days=7&sort=likes"))).json();
  assertEquals(byLikes.videos.map((v: { videoId: string }) => v.videoId), ["mid", "new", "old"]);
});

Deno.test("youtube-analytics: top-shorts is the top 5 Shorts by window views", async () => {
  const db = createSupabaseQueryMock();
  connected(db);
  const ids = ["s1", "s2", "s3", "s4", "s5", "s6", "s7"];
  db.queue("youtube_videos", "select", {
    data: ids.map((id) => video(id, "2026-08-01T15:00:00.000Z", true)),
  });
  db.queue("youtube_video_daily", "select", {
    data: [
      ...ids.slice(0, 6).map((id, i) => videoDay(id, "2026-10-26", (i + 1) * 100, { average_view_percentage: 60 + i })),
      videoDay("s7", "2026-10-26", 0),
      // A long video: never a Short.
      videoDay("long-1", "2026-10-26", 99999),
    ],
  });
  const res = await makeHandler(db)(get("/top-shorts/42?days=28"));
  assertEquals(res.status, 200);
  const { shorts } = await res.json();
  assertEquals(shorts.map((v: { videoId: string }) => v.videoId), ["s6", "s5", "s4", "s3", "s2"]);
  assertEquals(shorts[0].views, 600);
  assertEquals(shorts[0].avgViewPct, 65);
  assertEquals(shorts[0].isShort, true);

  const [list] = callsTo(db, "youtube_videos");
  assert(hasEq(list, "is_short", true));
  assertScoped(db, "youtube_videos");
  assertScoped(db, "youtube_video_daily");
});

// tiktok-analytics (Task A4): data routes, DI'd like tiktok-integration_test.ts. The shared
// supabaseMock ignores filters and hands back queued rows per `table:operation`, in call order,
// so window clipping is asserted on the recorded modifiers rather than on the data.
import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock, type QueryCall } from "../../../test/shared/supabaseMock.ts";
import { createTikTokAnalyticsHandler } from "../tiktok-analytics/handlers.ts";
import { loadVideosInWindow } from "../_shared/tiktok-analytics/queries.ts";
import { buildAccountPrompts, buildPortfolioPrompts, callGemini } from "../tiktok-analytics/ai.ts";

type Mock = ReturnType<typeof createSupabaseQueryMock>;

// SP 12:00 on 2026-10-28.
const NOW = new Date("2026-10-28T15:00:00.000Z");

const ACCOUNT = {
  id: "acc-1",
  client_id: 42,
  username: "dra.ana",
  display_name: "Dra. Ana",
  avatar_url: "https://cdn.example/a.jpg",
  follower_count: 1250,
  likes_count: 7777,
  video_count: 10,
  authorization_status: "active",
  last_synced_at: "2026-10-28T10:00:00.000Z",
};

function video(id: string, views: number, likes: number, comments: number, shares: number, postedAt = "2026-10-10T15:00:00.000Z") {
  return {
    tiktok_video_id: id,
    posted_at: postedAt,
    views,
    likes,
    comments,
    shares,
    title: `t-${id}`,
    video_description: null,
    duration: 30,
    share_url: `https://tiktok.com/v/${id}`,
    cover_image_url: null,
  };
}

function makeHandler(db: Mock, overrides: Record<string, unknown> = {}) {
  return createTikTokAnalyticsHandler({
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
  return new Request(`https://proj.supabase.co/functions/v1/tiktok-analytics${path}`, { headers });
}

/** Signed-in caller, active workspace ws-B (legacy conta_id points elsewhere), member of ws-B. */
function signedIn(db: Mock, { member = true }: { member?: boolean } = {}) {
  db.withAuth({ id: "user-1" });
  db.queue("profiles", "select", { data: { active_workspace_id: "ws-B", conta_id: "ws-A" } });
  db.queue("workspace_members", "select", { data: member ? { user_id: "user-1" } : null });
}

function ownedClient(db: Mock, contaId = "ws-B") {
  db.queue("clientes", "select", { data: { id: 42, conta_id: contaId } });
}

const callsTo = (db: Mock, table: string): QueryCall[] => db.calls.filter((c) => c.table === table);
const mods = (c: QueryCall, method: string) => c.modifiers.filter((m) => m.method === method).map((m) => m.args);
const featureCalls = (db: Mock) =>
  db.calls.filter((c) => c.table === "rpc:effective_plan_feature").map((c) => (c.payload as { feature_key: string }).feature_key);

// ── auth / tenant ─────────────────────────────────────────────────────────────

Deno.test("tiktok-analytics: 401 without bearer token", async () => {
  const db = createSupabaseQueryMock();
  const res = await makeHandler(db)(get("/overview/42", null));
  assertEquals(res.status, 401);
  assertEquals(await res.json(), { error: "Unauthorized" });
  assertEquals(db.calls.length, 0);
});

Deno.test("tiktok-analytics: 401 when getUser rejects the token", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth(null, { message: "bad jwt" });
  const res = await makeHandler(db)(get("/overview/42"));
  assertEquals(res.status, 401);
});

Deno.test("tiktok-analytics: uses active_workspace_id, not profiles.conta_id", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  ownedClient(db, "ws-A"); // the client belongs to the legacy conta_id, not the active workspace
  const res = await makeHandler(db)(get("/overview/42"));
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "Unauthorized" });
  const [membership] = callsTo(db, "workspace_members");
  assert(mods(membership, "eq").some(([col, val]) => col === "workspace_id" && val === "ws-B"));
  assertEquals(callsTo(db, "tiktok_accounts").length, 0);
});

Deno.test("tiktok-analytics: 403 when the caller is not a workspace member", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db, { member: false });
  const res = await makeHandler(db)(get("/overview/42"));
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "Unauthorized" });
  assertEquals(callsTo(db, "clientes").length, 0);
});

Deno.test("tiktok-analytics: 403 when there is no active workspace", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "user-1" });
  db.queue("profiles", "select", { data: { active_workspace_id: null, conta_id: "ws-A" } });
  const res = await makeHandler(db)(get("/overview/42"));
  assertEquals(res.status, 403);
  assertEquals(callsTo(db, "workspace_members").length, 0);
});

Deno.test("tiktok-analytics: 429 past the per-workspace rate limit", async () => {
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
  assertEquals(keys, [["tiktok-analytics:ws-B", 120, 60]]);
  assertEquals(callsTo(db, "clientes").length, 0);
});

// ── feature gates ─────────────────────────────────────────────────────────────

Deno.test("tiktok-analytics: 403 feature_disabled when feature_tiktok is off", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  ownedClient(db);
  db.queueRpc("effective_plan_feature", { data: false });
  const res = await makeHandler(db)(get("/overview/42"));
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "feature_disabled", feature: "feature_tiktok" });
  assertEquals(callsTo(db, "tiktok_accounts").length, 0);
});

Deno.test("tiktok-analytics: 403 feature_disabled when feature_analytics_reports is off", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  ownedClient(db);
  db.queueRpc("effective_plan_feature", { data: true }, { data: false });
  const res = await makeHandler(db)(get("/overview/42"));
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "feature_disabled", feature: "feature_analytics_reports" });
  assertEquals(featureCalls(db), ["feature_tiktok", "feature_analytics_reports"]);
});

Deno.test("tiktok-analytics: best-times requires feature_best_times", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  ownedClient(db);
  db.queueRpc("effective_plan_feature", { data: true }, { data: true }, { data: false });
  const res = await makeHandler(db)(get("/best-times/42"));
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "feature_disabled", feature: "feature_best_times" });
  assertEquals(featureCalls(db), ["feature_tiktok", "feature_analytics_reports", "feature_best_times"]);
});

Deno.test("tiktok-analytics: overview checks only the two base flags", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  ownedClient(db);
  db.queue("tiktok_accounts", "select", { data: ACCOUNT });
  const res = await makeHandler(db)(get("/overview/42"));
  assertEquals(res.status, 200);
  assertEquals(featureCalls(db), ["feature_tiktok", "feature_analytics_reports"]);
});

// ── input validation / connection ─────────────────────────────────────────────

Deno.test("tiktok-analytics: 400 on a non-numeric client id", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  const res = await makeHandler(db)(get("/overview/abc"));
  assertEquals(res.status, 400);
  assertEquals(callsTo(db, "clientes").length, 0);
});

Deno.test("tiktok-analytics: overview rejects start after end with 400", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  const res = await makeHandler(db)(get("/overview/42?start=2026-10-28&end=2026-10-01"));
  assertEquals(res.status, 400);
  assertEquals(callsTo(db, "clientes").length, 0);
});

Deno.test("tiktok-analytics: 400 when only one end of the range is given", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  const res = await makeHandler(db)(get("/overview/42?start=2026-10-01"));
  assertEquals(res.status, 400);
});

Deno.test("tiktok-analytics: 400 on days out of range or not an integer", async () => {
  for (const days of ["0", "731", "1.5", "abc", "-3"]) {
    const db = createSupabaseQueryMock();
    signedIn(db);
    const res = await makeHandler(db)(get(`/overview/42?days=${days}`));
    assertEquals(res.status, 400, `days=${days}`);
  }
  const db = createSupabaseQueryMock();
  signedIn(db);
  const res = await makeHandler(db)(get("/portfolio?days=366"));
  assertEquals(res.status, 400);
});

Deno.test("tiktok-analytics: 404 not_connected for a disconnected account", async () => {
  for (const status of ["disconnected", "revoked"]) {
    const db = createSupabaseQueryMock();
    signedIn(db);
    ownedClient(db);
    db.queue("tiktok_accounts", "select", { data: { ...ACCOUNT, authorization_status: status } });
    const res = await makeHandler(db)(get("/overview/42"));
    assertEquals(res.status, 404, status);
    assertEquals(await res.json(), { error: "not_connected" });
  }
});

Deno.test("tiktok-analytics: 404 not_connected when the client has no account", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  ownedClient(db);
  db.queue("tiktok_accounts", "select", { data: null });
  const res = await makeHandler(db)(get("/follower-history/42"));
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "not_connected" });
});

Deno.test("tiktok-analytics: expired account still returns data with its status", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  ownedClient(db);
  db.queue("tiktok_accounts", "select", { data: { ...ACCOUNT, authorization_status: "expired" } });
  const res = await makeHandler(db)(get("/overview/42"));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).account.authorization_status, "expired");
});

Deno.test("tiktok-analytics: never selects token columns", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  ownedClient(db);
  db.queue("tiktok_accounts", "select", { data: ACCOUNT });
  await makeHandler(db)(get("/overview/42"));

  const db2 = createSupabaseQueryMock();
  signedIn(db2);
  db2.queue("clientes", "select", { data: [{ id: 42, nome: "Ana", especialidade: "Derma" }] });
  db2.queue("tiktok_accounts", "select", { data: [ACCOUNT] });
  await makeHandler(db2)(get("/portfolio"));

  const selects = [...callsTo(db, "tiktok_accounts"), ...callsTo(db2, "tiktok_accounts")];
  assertEquals(selects.length, 2);
  for (const c of selects) {
    const cols = String(c.selectArgs[0][0]);
    assert(!cols.includes("token"), cols);
    assert(!cols.includes("*"), cols);
  }
});

// ── overview ──────────────────────────────────────────────────────────────────

Deno.test("tiktok-analytics: overview returns kpis computed over the window", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  ownedClient(db);
  db.queue("tiktok_accounts", "select", { data: ACCOUNT });
  // Order matters: window videos, previous-window videos, window history, previous history.
  db.queue(
    "tiktok_posts",
    "select",
    { data: [video("a", 1000, 50, 10, 40), video("b", 0, 0, 0, 0)] },
    { data: [video("p", 500, 20, 5, 25, "2026-09-10T15:00:00.000Z")] },
  );
  db.queue(
    "tiktok_follower_history",
    "select",
    {
      data: [
        { date: "2026-10-01", follower_count: 1000, source: "api" },
        { date: "2026-10-15", follower_count: 1100, source: "api" },
        { date: "2026-10-28", follower_count: 1200, source: "api" },
      ],
    },
    {
      data: [
        { date: "2026-09-03", follower_count: 900, source: "api" },
        { date: "2026-09-30", follower_count: 980, source: "manual" },
      ],
    },
  );

  const res = await makeHandler(db)(get("/overview/42?start=2026-10-01&end=2026-10-28"));
  assertEquals(res.status, 200);
  const body = await res.json();

  assertEquals(body.window, { start: "2026-10-01", end: "2026-10-28", prevStart: "2026-09-03", prevEnd: "2026-09-30" });
  assertEquals(body.kpis.followers_gained.value, 200);
  assertEquals(body.kpis.followers_gained.prev, 80);
  // A point exists on SP today, so it wins over the live follower_count.
  assertEquals(body.kpis.followers_total.value, 1200);
  assertEquals(body.kpis.views, { value: 1000, unit: "count", prev: null });
  assertEquals(body.kpis.engagement_rate.value, 10);
  assertEquals(body.kpis.engagement_rate.prev, 10);
  assertEquals(body.kpis.posts_count, { value: 2, unit: "count", prev: 1 });
  assertEquals(body.kpis.likes_total.value, 7777);
  assertEquals(body.account, {
    username: "dra.ana",
    display_name: "Dra. Ana",
    avatar_url: "https://cdn.example/a.jpg",
    authorization_status: "active",
    last_synced_at: "2026-10-28T10:00:00.000Z",
    follower_count: 1250,
  });

  // São Paulo boundaries: [start 00:00 SP, end+1 00:00 SP) for posted_at, inclusive dates for history.
  const [win, prev] = callsTo(db, "tiktok_posts");
  assertEquals(mods(win, "gte"), [["posted_at", "2026-10-01T03:00:00.000Z"]]);
  assertEquals(mods(win, "lt"), [["posted_at", "2026-10-29T03:00:00.000Z"]]);
  assertEquals(mods(prev, "gte"), [["posted_at", "2026-09-03T03:00:00.000Z"]]);
  assertEquals(mods(prev, "lt"), [["posted_at", "2026-10-01T03:00:00.000Z"]]);
  assert(mods(win, "eq").some(([c, v]) => c === "tiktok_account_id" && v === "acc-1"));
  const [hist] = callsTo(db, "tiktok_follower_history");
  assertEquals(mods(hist, "gte"), [["date", "2026-10-01"]]);
  assertEquals(mods(hist, "lte"), [["date", "2026-10-28"]]);
});

Deno.test("tiktok-analytics: overview uses the live follower count when SP today has no point yet", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  ownedClient(db);
  db.queue("tiktok_accounts", "select", { data: ACCOUNT });
  db.queue("tiktok_posts", "select", { data: [] }, { data: [] });
  db.queue("tiktok_follower_history", "select", {
    data: [
      { date: "2026-10-01", follower_count: 1000, source: "api" },
      { date: "2026-10-27", follower_count: 1200, source: "api" },
    ],
  });
  const res = await makeHandler(db)(get("/overview/42?days=28"));
  const body = await res.json();
  assertEquals(body.window.end, "2026-10-28");
  assertEquals(body.kpis.followers_total.value, 1250);
});

Deno.test("tiktok-analytics: overview defaults to the last 30 SP days", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  ownedClient(db);
  db.queue("tiktok_accounts", "select", { data: ACCOUNT });
  const res = await makeHandler(db)(get("/overview/42"));
  const body = await res.json();
  assertEquals(body.window.start, "2026-09-29");
  assertEquals(body.window.end, "2026-10-28");
});

// ── follower-history / posts-analytics / best-times ───────────────────────────

Deno.test("tiktok-analytics: follower-history returns the window series", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  ownedClient(db);
  db.queue("tiktok_accounts", "select", { data: ACCOUNT });
  const rows = [
    { date: "2026-10-27", follower_count: 1190, source: "api" },
    { date: "2026-10-28", follower_count: 1200, source: "manual" },
  ];
  db.queue("tiktok_follower_history", "select", { data: rows });
  const res = await makeHandler(db)(get("/follower-history/42?days=7"));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { history: rows });
  const [hist] = callsTo(db, "tiktok_follower_history");
  assertEquals(mods(hist, "gte"), [["date", "2026-10-22"]]);
  assertEquals(mods(hist, "lte"), [["date", "2026-10-28"]]);
});

Deno.test("tiktok-analytics: posts-analytics sorts by engagement_rate desc and caps at 500", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  ownedClient(db);
  db.queue("tiktok_accounts", "select", { data: ACCOUNT });
  const rows = Array.from({ length: 501 }, (_, i) => video(`v${i}`, 1000, i, 0, 0));
  rows.push(video("zero-views", 0, 99, 0, 0)); // null rate sorts last
  db.queue("tiktok_posts", "select", { data: rows });

  const res = await makeHandler(db)(get("/posts-analytics/42?sort=engagement_rate&days=90"));
  assertEquals(res.status, 200);
  const { posts } = await res.json();
  assertEquals(posts.length, 500);
  assertEquals(posts[0].tiktok_video_id, "v500");
  assertEquals(posts[0].engagement_rate, 50);
  assertEquals(posts[499].tiktok_video_id, "v1");
  assert(!posts.some((p: { tiktok_video_id: string }) => p.tiktok_video_id === "zero-views"));
});

Deno.test("tiktok-analytics: posts-analytics defaults to views and rejects an unknown sort", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  ownedClient(db);
  db.queue("tiktok_accounts", "select", { data: ACCOUNT });
  db.queue("tiktok_posts", "select", {
    data: [video("low", 10, 1, 0, 0), video("high", 900, 1, 0, 0), video("mid", 100, 1, 0, 0)],
  });
  const res = await makeHandler(db)(get("/posts-analytics/42"));
  const { posts } = await res.json();
  assertEquals(posts.map((p: { tiktok_video_id: string }) => p.tiktok_video_id), ["high", "mid", "low"]);

  const db2 = createSupabaseQueryMock();
  signedIn(db2);
  const bad = await makeHandler(db2)(get("/posts-analytics/42?sort=saves"));
  assertEquals(bad.status, 400);
});

Deno.test("tiktok-analytics: best-times buckets the last 90 SP days with the views rate", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  ownedClient(db);
  db.queue("tiktok_accounts", "select", { data: ACCOUNT });
  // 2026-10-12 is a Monday; 15:00Z = 12:00 in São Paulo.
  db.queue("tiktok_posts", "select", { data: [video("a", 200, 10, 5, 5, "2026-10-12T15:00:00.000Z")] });
  const res = await makeHandler(db)(get("/best-times/42"));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.totalPosts, 1);
  assertEquals(body.heatmap[0][12], 10);
  assertEquals(body.timezone, "America/Sao_Paulo");
  const [posts] = callsTo(db, "tiktok_posts");
  assertEquals(mods(posts, "gte"), [["posted_at", "2026-07-31T03:00:00.000Z"]]);
  assertEquals(mods(posts, "lt"), [["posted_at", "2026-10-29T03:00:00.000Z"]]);
});

// ── portfolio ─────────────────────────────────────────────────────────────────

function queuePortfolio(db: Mock) {
  db.queue("clientes", "select", {
    data: [
      { id: 42, nome: "Ana", especialidade: "Derma" },
      { id: 43, nome: "Bia", especialidade: null },
      { id: 44, nome: "Caio", especialidade: "Orto" },
    ],
  });
  db.queue("tiktok_accounts", "select", {
    data: [
      ACCOUNT,
      { ...ACCOUNT, id: "acc-2", client_id: 43, username: "bia", follower_count: 300, authorization_status: "expired" },
      { ...ACCOUNT, id: "acc-3", client_id: 44, username: "caio", authorization_status: "disconnected" },
    ],
  });
  db.queue("tiktok_posts", "select", {
    data: [
      { ...video("old-a", 1000, 80, 10, 10, "2026-10-20T15:00:00.000Z"), tiktok_account_id: "acc-1" },
      { ...video("fresh", 5, 0, 0, 0, "2026-10-27T15:00:00.000Z"), tiktok_account_id: "acc-1" }, // 24h old
      { ...video("old-b", 50, 5, 0, 0, "2026-10-05T15:00:00.000Z"), tiktok_account_id: "acc-2" },
    ],
  }, { data: [{ posted_at: "2026-10-27T15:00:00.000Z" }] }, { data: [{ posted_at: "2026-10-05T15:00:00.000Z" }] });
  db.queue("tiktok_follower_history", "select", {
    data: [
      { tiktok_account_id: "acc-1", date: "2026-10-01", follower_count: 1000 },
      { tiktok_account_id: "acc-1", date: "2026-10-28", follower_count: 1250 },
      { tiktok_account_id: "acc-2", date: "2026-10-28", follower_count: 300 },
    ],
  });
}

Deno.test("tiktok-analytics: portfolio only includes clients of the active workspace", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  queuePortfolio(db);
  const res = await makeHandler(db)(get("/portfolio"));
  assertEquals(res.status, 200);
  const body = await res.json();

  const [clientes] = callsTo(db, "clientes");
  assert(mods(clientes, "eq").some(([c, v]) => c === "conta_id" && v === "ws-B"));
  const [accounts] = callsTo(db, "tiktok_accounts");
  assertEquals(mods(accounts, "in"), [["client_id", [42, 43, 44]]]);
  const [posts] = callsTo(db, "tiktok_posts");
  assertEquals(mods(posts, "in"), [["tiktok_account_id", ["acc-1", "acc-2"]]]);

  assertEquals(body.window.start, "2026-10-01"); // default 28 days
  assertEquals(body.accounts.map((a: { client_id: number }) => a.client_id), [42, 43]);
  const ana = body.accounts[0];
  assertEquals(ana, {
    client_id: 42,
    client_name: "Ana",
    especialidade: "Derma",
    username: "dra.ana",
    avatar_url: "https://cdn.example/a.jpg",
    authorization_status: "active",
    follower_count: 1250,
    followers_gained: 250,
    views: 1005,
    engagement_rate: (100 / 1005) * 100,
    posts_count: 2,
    last_posted_at: "2026-10-27T15:00:00.000Z",
  });
  assertEquals(body.accounts[1].followers_gained, null); // one point is not a delta
  assertEquals(body.totals, {
    accounts: 2,
    followers: 1550,
    views: 1055,
    engagement_rate: (105 / 1055) * 100,
    posts_count: 3,
  });
  assertEquals(body.topVideos.map((v: { tiktok_video_id: string }) => v.tiktok_video_id), ["old-a", "old-b", "fresh"]);
  assertEquals(body.topVideos[0].client_name, "Ana");
  assertEquals(body.topVideos[0].engagement_rate, 10);
});

Deno.test("tiktok-analytics: portfolio bottomVideos excludes videos younger than 48h", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  queuePortfolio(db);
  const body = await (await makeHandler(db)(get("/portfolio"))).json();
  assertEquals(body.bottomVideos.map((v: { tiktok_video_id: string }) => v.tiktok_video_id), ["old-b", "old-a"]);
});

Deno.test("tiktok-analytics: portfolio videos lists every window video, most viewed first", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  queuePortfolio(db);
  const body = await (await makeHandler(db)(get("/portfolio"))).json();
  // Unlike bottomVideos, the full list keeps videos younger than 48h.
  assertEquals(body.videos.map((v: { tiktok_video_id: string }) => v.tiktok_video_id), ["old-a", "old-b", "fresh"]);
});

Deno.test("tiktok-analytics: portfolio with no connected accounts is empty, not an error", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  db.queue("clientes", "select", { data: [] });
  const res = await makeHandler(db)(get("/portfolio?days=7"));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.accounts, []);
  assertEquals(body.totals, { accounts: 0, followers: 0, views: 0, engagement_rate: null, posts_count: 0 });
  assertEquals(callsTo(db, "tiktok_accounts").length, 0);
});

Deno.test("tiktok-analytics: portfolio last_posted_at is the newest stored video, even outside the window", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  db.queue("clientes", "select", { data: [{ id: 42, nome: "Ana", especialidade: "Derma" }, { id: 43, nome: "Bia", especialidade: null }] });
  db.queue("tiktok_accounts", "select", { data: [ACCOUNT, { ...ACCOUNT, id: "acc-2", client_id: 43 }] });
  db.queue(
    "tiktok_posts",
    "select",
    { data: [] }, // nothing posted in the 7-day window
    { data: [{ posted_at: "2026-08-02T15:00:00.000Z" }] }, // acc-1: older video
    { data: [] }, // acc-2: no stored video at all
  );
  const body = await (await makeHandler(db)(get("/portfolio?days=7"))).json();
  assertEquals(body.accounts.map((a: { last_posted_at: string | null }) => a.last_posted_at), ["2026-08-02T15:00:00.000Z", null]);
  assertEquals(body.accounts[0].posts_count, 0);
  const lastPostReads = callsTo(db, "tiktok_posts").filter((c) => mods(c, "limit").length > 0);
  assertEquals(lastPostReads.length, 2);
  assertEquals(mods(lastPostReads[0], "eq"), [["tiktok_account_id", "acc-1"]]);
  assertEquals(mods(lastPostReads[0], "order"), [["posted_at", { ascending: false }]]);
  assertEquals(mods(lastPostReads[0], "limit"), [[1]]);
  assertEquals(mods(lastPostReads[0], "gte").length, 0); // not clipped to the window
});

Deno.test("tiktok-analytics: portfolio rejects start/end with 400", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  const res = await makeHandler(db)(get("/portfolio?start=2026-10-01&end=2026-10-28"));
  assertEquals(res.status, 400);
  assertEquals(callsTo(db, "clientes").length, 0);
});

// ── error paths ───────────────────────────────────────────────────────────────

Deno.test("tiktok-analytics: a failed read is a generic 500 with no detail", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  ownedClient(db);
  db.queue("tiktok_accounts", "select", { data: ACCOUNT });
  db.queue("tiktok_posts", "select", { data: null, error: { message: "relation tiktok_posts secret detail", code: "42P01" } });
  const originalError = console.error;
  console.error = () => {};
  try {
    const res = await makeHandler(db)(get("/posts-analytics/42"));
    assertEquals(res.status, 500);
    const text = await res.text();
    assertEquals(JSON.parse(text), { error: "Internal server error" });
    assert(!text.includes("secret") && !text.includes("42P01"), text);
  } finally {
    console.error = originalError;
  }
});

Deno.test("tiktok-analytics: a foreign client is 403 before any plan flag is read", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  ownedClient(db, "ws-other");
  db.queueRpc("effective_plan_feature", { data: false });
  const res = await makeHandler(db)(get("/overview/42"));
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "Unauthorized" });
  assertEquals(featureCalls(db), []);
});

// ── queries ───────────────────────────────────────────────────────────────────

Deno.test("tiktok-analytics queries: loadVideosInWindow pages past PostgREST's 1000-row cap", async () => {
  const db = createSupabaseQueryMock();
  db.queue(
    "tiktok_posts",
    "select",
    { data: Array.from({ length: 1000 }, (_, i) => video(`a${i}`, 1, 0, 0, 0)) },
    { data: [video("last", 1, 0, 0, 0)] },
  );
  // deno-lint-ignore no-explicit-any
  const rows = await loadVideosInWindow(db as any, "acc-1", "2026-01-01", "2026-10-28");
  assertEquals(rows.length, 1001);
  assertEquals(callsTo(db, "tiktok_posts").map((c) => mods(c, "range")[0]), [[0, 999], [1000, 1999]]);
});

Deno.test("tiktok-analytics: unknown route is a 404", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  const res = await makeHandler(db)(get("/nope"));
  assertEquals(res.status, 404);
});

// ── AI routes (Task A5) ───────────────────────────────────────────────────────

function post(path: string, body: unknown = {}, token: string | null = "tok") {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request(`https://proj.supabase.co/functions/v1/tiktok-analytics${path}`, {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

type FetchCall = { url: string; init: RequestInit };

function fakeGemini(responder: () => Response) {
  const calls: FetchCall[] = [];
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return Promise.resolve(responder());
  }) as typeof fetch;
  return { impl, calls };
}

const geminiOk = (text: string) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });

const ANALYSIS = { healthScore: { score: 70 }, actionPlan: [] };

/** Everything an account AI call reads, queued in call order. */
function queueAccountAi(db: Mock) {
  signedIn(db);
  ownedClient(db);
  db.queueRpc("effective_plan_feature", { data: true }, { data: true }, { data: true });
  db.queue("tiktok_accounts", "select", { data: ACCOUNT });
  db.queue("clientes", "select", { data: { nome: "Dra. Ana", especialidade: "Dermatologia" } });
  db.queue("tiktok_posts", "select", { data: [video("a", 200, 10, 5, 5), video("b", 50, 1, 0, 0)] });
  db.queue("tiktok_follower_history", "select", {
    data: [{ date: "2026-10-01", follower_count: 1000, source: "api" }, { date: "2026-10-28", follower_count: 1250, source: "api" }],
  });
}

Deno.test("tiktok-analytics: ai-analysis requires feature_instagram_ai", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  ownedClient(db);
  db.queueRpc("effective_plan_feature", { data: true }, { data: true }, { data: false });
  const gemini = fakeGemini(() => geminiOk("{}"));
  const res = await makeHandler(db, { fetch: gemini.impl, geminiKey: "k" })(post("/ai-analysis/42", { days: 30 }));
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "feature_disabled", feature: "feature_instagram_ai" });
  assertEquals(featureCalls(db), ["feature_tiktok", "feature_analytics_reports", "feature_instagram_ai"]);
  assertEquals(gemini.calls.length, 0);
});

Deno.test("tiktok-analytics: ai-analysis-portfolio requires feature_instagram_ai", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  db.queueRpc("effective_plan_feature", { data: true }, { data: true }, { data: false });
  const res = await makeHandler(db, { geminiKey: "k" })(post("/ai-analysis-portfolio", {}));
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "feature_disabled", feature: "feature_instagram_ai" });
});

Deno.test("tiktok-analytics: ai-analysis shares the ig-ai rate key", async () => {
  const db = createSupabaseQueryMock();
  queueAccountAi(db);
  const gemini = fakeGemini(() => geminiOk(JSON.stringify(ANALYSIS)));
  const rateCalls: unknown[] = [];
  const res = await makeHandler(db, {
    fetch: gemini.impl,
    geminiKey: "k",
    checkRateLimit: (_db: unknown, key: string, max: number, win: number) => {
      rateCalls.push([key, max, win]);
      return Promise.resolve(true);
    },
  })(post("/ai-analysis/42", { days: 30 }));
  assertEquals(res.status, 200);
  assert(rateCalls.some((c) => JSON.stringify(c) === JSON.stringify(["ig-ai:ws-B", 10, 3600])));
});

Deno.test("tiktok-analytics: ai-analysis answers 429 with the rate-limit body when the ig-ai budget is spent", async () => {
  const db = createSupabaseQueryMock();
  queueAccountAi(db);
  const gemini = fakeGemini(() => geminiOk("{}"));
  const res = await makeHandler(db, {
    fetch: gemini.impl,
    geminiKey: "k",
    checkRateLimit: (_db: unknown, key: string) => Promise.resolve(!key.startsWith("ig-ai:")),
  })(post("/ai-analysis/42", { days: 30 }));
  assertEquals(res.status, 429);
  assertEquals(await res.json(), { error: "Rate limit exceeded" });
  assertEquals(gemini.calls.length, 0);
});

Deno.test("tiktok-analytics: ai-analysis without GEMINI key returns error analysis, no fetch", async () => {
  const db = createSupabaseQueryMock();
  queueAccountAi(db);
  const gemini = fakeGemini(() => geminiOk("{}"));
  const res = await makeHandler(db, { fetch: gemini.impl, geminiKey: "" })(post("/ai-analysis/42", { days: 30 }));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).analysis, { error: true, raw: "ai_unavailable" });
  assertEquals(gemini.calls.length, 0);
});

Deno.test("tiktok-analytics: ai-analysis sends the prompt to Gemini and returns the parsed analysis", async () => {
  const db = createSupabaseQueryMock();
  queueAccountAi(db);
  const gemini = fakeGemini(() => geminiOk("```json\n" + JSON.stringify(ANALYSIS) + "\n```"));
  const res = await makeHandler(db, { fetch: gemini.impl, geminiKey: "secret-key" })(post("/ai-analysis/42", { days: 14 }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.analysis, ANALYSIS);
  assert(typeof body.generatedAt === "string" && !isNaN(Date.parse(body.generatedAt)));

  assertEquals(gemini.calls.length, 1);
  const [{ url, init }] = gemini.calls;
  assert(url.includes("gemini-2.5-flash:generateContent"));
  assert(!url.includes("secret-key"));
  assertEquals((init.headers as Record<string, string>)["x-goog-api-key"], "secret-key");
  const sent = JSON.parse(init.body as string);
  assertEquals(sent.generationConfig, { temperature: 0.3, maxOutputTokens: 8192, responseMimeType: "application/json" });
  assert(sent.contents[0].parts[0].text.includes("@dra.ana"));
  assert(sent.contents[0].parts[0].text.includes("ÚLTIMOS 14 DIAS"));
  // Window is the 14 SP days ending today.
  const [posts] = callsTo(db, "tiktok_posts");
  assertEquals(mods(posts, "gte"), [["posted_at", "2026-10-15T03:00:00.000Z"]]);
});

Deno.test("tiktok-analytics: ai-analysis defaults to 30 days and rejects an invalid days with 400", async () => {
  const db = createSupabaseQueryMock();
  queueAccountAi(db);
  const gemini = fakeGemini(() => geminiOk(JSON.stringify(ANALYSIS)));
  const res = await makeHandler(db, { fetch: gemini.impl, geminiKey: "k" })(post("/ai-analysis/42", {}));
  assertEquals(res.status, 200);
  assert(JSON.parse(gemini.calls[0].init.body as string).contents[0].parts[0].text.includes("ÚLTIMOS 30 DIAS"));

  for (const days of [0, 366, 1.5, "abc", -3]) {
    const bad = createSupabaseQueryMock();
    signedIn(bad);
    const r = await makeHandler(bad, { fetch: gemini.impl, geminiKey: "k" })(post("/ai-analysis/42", { days }));
    assertEquals(r.status, 400, `days=${days}`);
    assertEquals(callsTo(bad, "clientes").length, 0);
  }
});

Deno.test("tiktok-analytics: ai-analysis keeps another workspace's client out", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  ownedClient(db, "ws-A");
  const gemini = fakeGemini(() => geminiOk("{}"));
  const res = await makeHandler(db, { fetch: gemini.impl, geminiKey: "k" })(post("/ai-analysis/42", {}));
  assertEquals(res.status, 403);
  assertEquals(gemini.calls.length, 0);
});

Deno.test("tiktok-analytics: ai-analysis is 404 for a client without a connected account", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  ownedClient(db);
  db.queueRpc("effective_plan_feature", { data: true }, { data: true }, { data: true });
  db.queue("tiktok_accounts", "select", { data: { ...ACCOUNT, authorization_status: "revoked" } });
  const res = await makeHandler(db, { geminiKey: "k" })(post("/ai-analysis/42", {}));
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "not_connected" });
});

Deno.test("tiktok-analytics: gemini non-200 does not leak the upstream message", async () => {
  const db = createSupabaseQueryMock();
  queueAccountAi(db);
  const gemini = fakeGemini(() =>
    new Response(JSON.stringify({ error: { message: "API key not valid: AIza-UPSTREAM-SECRET" } }), { status: 400 })
  );
  const res = await makeHandler(db, { fetch: gemini.impl, geminiKey: "k" })(post("/ai-analysis/42", {}));
  assertEquals(res.status, 200);
  const text = await res.text();
  assert(!text.includes("UPSTREAM"));
  assert(!text.includes("API key"));
  assertEquals(JSON.parse(text).analysis, { error: true, raw: "ai_failed" });
});

Deno.test("tiktok-analytics: a Gemini network failure does not leak either", async () => {
  const out = await callGemini(
    (() => Promise.reject(new Error("connect ECONNREFUSED 10.0.0.1"))) as typeof fetch,
    "k",
    { system: "s", user: "u" },
  );
  assertEquals(out, { error: true, raw: "ai_failed" });
});

Deno.test("tiktok-analytics: callGemini falls back like Instagram on unparseable output", async () => {
  const wrapped = await callGemini(fakeGemini(() => geminiOk('Aqui está: {"a": 1} fim')).impl, "k", { system: "s", user: "u" });
  assertEquals(wrapped, { a: 1 });
  const junk = await callGemini(fakeGemini(() => geminiOk("not json")).impl, "k", { system: "s", user: "u" });
  assertEquals(junk, { error: true, raw: "not json" });
  const empty = await callGemini(fakeGemini(() => geminiOk("")).impl, "k", { system: "s", user: "u" });
  assertEquals(empty, { error: true, raw: "Empty AI response" });
});

const FORBIDDEN_METRICS = [/alcance/i, /salvamento/i, /reach/i, /\bsaves?\b/i, /salvos?\b/i, /demogr/i, /impress/i, /retenção/i, /tempo de exibição/i, /descrições/i];

Deno.test("tiktok-analytics: account prompt mentions vídeos and never 'alcance' or 'salvamentos'", () => {
  const { system, user } = buildAccountPrompts({
    username: "dra.ana",
    clientName: "Dra. Ana",
    specialty: null,
    days: 30,
    followers: 1250,
    history: [],
    videos: [
      { ...video("a", 200, 10, 5, 5), title: "Título A", duration: 20 },
      { ...video("b", 0, 0, 0, 0), title: null, duration: null },
    ],
  });
  const all = `${system}\n${user}`;
  assert(all.includes("vídeos"));
  assert(all.includes("por visualização"));
  for (const re of FORBIDDEN_METRICS) assert(!re.test(all), `prompt mentions ${re}`);
  assert(user.includes("Histórico de seguidores: INDISPONÍVEL"), "no history: flagged unavailable");
  assert(user.includes("especialidade não informada"));
  assert(user.includes('"engajamentoPorVisualizacao":"10.00%"'));
  assert(user.includes('"engajamentoPorVisualizacao":"sem dados"'));
});

Deno.test("tiktok-analytics: account prompt caps the video list at 50 by views and lists history oldest first", () => {
  const videos = Array.from({ length: 60 }, (_, i) => ({ ...video(`v${i}`, i, 0, 0, 0), title: `t${i}`, duration: 10 }));
  const { user } = buildAccountPrompts({
    username: "u",
    clientName: "C",
    specialty: "Derma",
    days: 7,
    followers: 10,
    history: [{ date: "2026-10-02", follower_count: 12 }, { date: "2026-10-01", follower_count: 10 }],
    videos,
  });
  assert(user.includes('"visualizacoes":59'));
  assert(!user.includes('"visualizacoes":9,'));
  assert(user.indexOf("2026-10-01") < user.indexOf("2026-10-02"));
  assert(!user.includes("Histórico de seguidores: INDISPONÍVEL"));
});

Deno.test("tiktok-analytics: portfolio prompt speaks of engagement per view and drops unavailable metrics", () => {
  const { system, user } = buildPortfolioPrompts({
    days: 28,
    accounts: [{
      client_id: 42,
      client_name: "Ana",
      especialidade: "Derma",
      username: "dra.ana",
      avatar_url: null,
      authorization_status: "active",
      follower_count: 1250,
      followers_gained: null,
      views: 1005,
      engagement_rate: 9.95,
      posts_count: 2,
      last_posted_at: "2026-10-27T15:00:00.000Z",
    }],
  });
  const all = `${system}\n${user}`;
  assert(all.includes("por visualização"));
  for (const re of FORBIDDEN_METRICS) assert(!re.test(all), `prompt mentions ${re}`);
  assert(user.includes('"lastVideo": "2026-10-27"'));
  assert(user.includes('"followerDelta": null'));
  assert(user.includes('"engagementPerView": "9.95%"'));
  assert(user.includes("1 contas TikTok") || user.includes("1 contas"));
});

Deno.test("tiktok-analytics: ai-analysis-portfolio returns the analysis for the workspace's connected accounts", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  db.queueRpc("effective_plan_feature", { data: true }, { data: true }, { data: true });
  queuePortfolio(db);
  const gemini = fakeGemini(() => geminiOk(JSON.stringify({ portfolioHealth: { score: 60 } })));
  const rateCalls: unknown[] = [];
  const res = await makeHandler(db, {
    fetch: gemini.impl,
    geminiKey: "k",
    checkRateLimit: (_db: unknown, key: string, max: number, win: number) => {
      rateCalls.push([key, max, win]);
      return Promise.resolve(true);
    },
  })(post("/ai-analysis-portfolio", { days: 28 }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.analysis, { portfolioHealth: { score: 60 } });
  assert(typeof body.generatedAt === "string");
  assert(rateCalls.some((c) => JSON.stringify(c) === JSON.stringify(["ig-ai:ws-B", 10, 3600])));
  assertEquals(featureCalls(db), ["feature_tiktok", "feature_analytics_reports", "feature_instagram_ai"]);
  const prompt = JSON.parse(gemini.calls[0].init.body as string).contents[0].parts[0].text as string;
  assert(prompt.includes("dra.ana"));
  assert(prompt.includes("2 contas TikTok"));
  assert(!prompt.includes('"username": "caio"'), "disconnected accounts stay out");
});

Deno.test("tiktok-analytics: ai-analysis-portfolio without a body defaults to 28 days", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  db.queueRpc("effective_plan_feature", { data: true }, { data: true }, { data: true });
  queuePortfolio(db);
  const gemini = fakeGemini(() => geminiOk(JSON.stringify({ portfolioHealth: { score: 1 } })));
  const res = await makeHandler(db, { fetch: gemini.impl, geminiKey: "k" })(post("/ai-analysis-portfolio", undefined));
  assertEquals(res.status, 200);
  const [posts] = callsTo(db, "tiktok_posts");
  assertEquals(mods(posts, "gte"), [["posted_at", "2026-10-01T03:00:00.000Z"]]);
});

Deno.test("tiktok-analytics: ai-analysis-portfolio with no connected account spends no budget and calls no model", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  db.queueRpc("effective_plan_feature", { data: true }, { data: true }, { data: true });
  db.queue("clientes", "select", { data: [{ id: 42, nome: "Ana", especialidade: null }] });
  db.queue("tiktok_accounts", "select", { data: [] });
  const gemini = fakeGemini(() => geminiOk("{}"));
  const rateKeys: string[] = [];
  const res = await makeHandler(db, {
    fetch: gemini.impl,
    geminiKey: "k",
    checkRateLimit: (_db: unknown, key: string) => {
      rateKeys.push(key);
      return Promise.resolve(true);
    },
  })(post("/ai-analysis-portfolio", {}));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).analysis, { error: true, raw: "Nenhuma conta TikTok conectada" });
  assertEquals(gemini.calls.length, 0);
  assert(!rateKeys.some((k) => k.startsWith("ig-ai:")));
});

Deno.test("tiktok-analytics: ai-analysis-portfolio without GEMINI key returns error analysis, no fetch", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  db.queueRpc("effective_plan_feature", { data: true }, { data: true }, { data: true });
  const gemini = fakeGemini(() => geminiOk("{}"));
  const res = await makeHandler(db, { fetch: gemini.impl })(post("/ai-analysis-portfolio", {}));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).analysis, { error: true, raw: "ai_unavailable" });
  assertEquals(gemini.calls.length, 0);
});

Deno.test("tiktok-analytics: ai routes are POST-only", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  const res = await makeHandler(db, { geminiKey: "k" })(get("/ai-analysis/42"));
  assertEquals(res.status, 404);
});

const MARKET_RANGE = /\d+(?:[.,]\d+)?\s*-\s*\d+(?:[.,]\d+)?\s*%/;

Deno.test("tiktok-analytics: system prompts carry no market benchmark, only the own-baseline rule", () => {
  const account = buildAccountPrompts({
    username: "u", clientName: "C", specialty: null, days: 30, followers: 1, history: [],
    videos: [{ ...video("a", 100, 5, 0, 0), title: "t", duration: 10 }],
  });
  const portfolio = buildPortfolioPrompts({ days: 28, accounts: [] });
  for (const { system } of [account, portfolio]) {
    assert(!MARKET_RANGE.test(system), "no percentage range in the system prompt");
    assert(!/\bmédia\b.*\d+%/.test(system), "no invented example averages");
    assert(system.includes("REFERÊNCIA DE COMPARAÇÃO:"));
    assert(system.includes("Não existe benchmark oficial de mercado"));
    assert(system.includes("hipótese, não como fato"));
  }
});

Deno.test("tiktok-analytics: account prompt passes the median and mean engagement per view", () => {
  const { user } = buildAccountPrompts({
    username: "u", clientName: "C", specialty: null, days: 30, followers: 1, history: [],
    videos: [
      { ...video("a", 100, 10, 0, 0), title: "a", duration: 10 }, // 10%
      { ...video("b", 100, 20, 0, 0), title: "b", duration: 10 }, // 20%
      { ...video("c", 100, 60, 0, 0), title: "c", duration: 10 }, // 60%
      { ...video("d", 0, 0, 0, 0), title: "d", duration: 10 }, // no views: left out
    ],
  });
  assert(user.includes("Mediana do engajamento por visualização dos vídeos da conta no período (referência de comparação): 20.00%"));
  assert(user.includes("Média do engajamento por visualização dos vídeos da conta no período: 30.00%"));
});

Deno.test("tiktok-analytics: portfolio prompt passes the cross-account median", () => {
  const row = (name: string, rate: number | null) => ({
    client_id: 1, client_name: name, especialidade: null, username: name, avatar_url: null,
    authorization_status: "active", follower_count: 1, followers_gained: null, views: 1, engagement_rate: rate,
    posts_count: 1, last_posted_at: null,
  });
  const { user } = buildPortfolioPrompts({ days: 28, accounts: [row("a", 2), row("b", 10), row("c", null), row("d", 4)] });
  assert(user.includes("Mediana do engajamento por visualização entre as contas (referência de comparação): 4.00%"));
});

Deno.test("tiktok-analytics: over 50 videos the prompt also lists the 5 lowest by views", () => {
  const videos = Array.from({ length: 60 }, (_, i) => ({ ...video(`v${i}`, 1000 + i, 1, 0, 0), title: `titulo-${i}`, duration: 10 }));
  const { user } = buildAccountPrompts({ username: "u", clientName: "C", specialty: null, days: 30, followers: 1, history: [], videos });
  const [top, lowest] = user.split("MENOS visualizações do período");
  assert(lowest !== undefined, "lowest block present");
  for (let i = 0; i < 5; i++) assert(lowest.includes(`titulo-${i}"`), `lowest has titulo-${i}`);
  assert(!lowest.includes('titulo-5"'));
  assert(!top.includes('titulo-0"'), "the weakest are not in the top-50 list");

  const small = buildAccountPrompts({ username: "u", clientName: "C", specialty: null, days: 30, followers: 1, history: [], videos: videos.slice(0, 10) });
  assert(!small.user.includes("MENOS visualizações do período"));
});

Deno.test("tiktok-analytics: ai-analysis without GEMINI key debits no ig-ai budget", async () => {
  const db = createSupabaseQueryMock();
  queueAccountAi(db);
  const rateKeys: string[] = [];
  const res = await makeHandler(db, {
    geminiKey: "",
    checkRateLimit: (_db: unknown, key: string) => {
      rateKeys.push(key);
      return Promise.resolve(true);
    },
  })(post("/ai-analysis/42", {}));
  assertEquals((await res.json()).analysis, { error: true, raw: "ai_unavailable" });
  assert(!rateKeys.some((k) => k.startsWith("ig-ai:")));
});

Deno.test("tiktok-analytics: ai-analysis with zero videos in the window debits no budget and calls no model", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  ownedClient(db);
  db.queueRpc("effective_plan_feature", { data: true }, { data: true }, { data: true });
  db.queue("tiktok_accounts", "select", { data: ACCOUNT });
  db.queue("clientes", "select", { data: { nome: "Dra. Ana", especialidade: null } });
  db.queue("tiktok_posts", "select", { data: [] });
  db.queue("tiktok_follower_history", "select", { data: [] });
  const gemini = fakeGemini(() => geminiOk("{}"));
  const rateKeys: string[] = [];
  const res = await makeHandler(db, {
    fetch: gemini.impl,
    geminiKey: "k",
    checkRateLimit: (_db: unknown, key: string) => {
      rateKeys.push(key);
      return Promise.resolve(true);
    },
  })(post("/ai-analysis/42", {}));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).analysis, { error: true, raw: "Nenhum vídeo no período" });
  assertEquals(gemini.calls.length, 0);
  assert(!rateKeys.some((k) => k.startsWith("ig-ai:")));
});

Deno.test("tiktok-analytics: AI routes answer 403 when feature_tiktok is off", async () => {
  const account = createSupabaseQueryMock();
  signedIn(account);
  ownedClient(account);
  account.queueRpc("effective_plan_feature", { data: false });
  const gemini = fakeGemini(() => geminiOk("{}"));
  const a = await makeHandler(account, { fetch: gemini.impl, geminiKey: "k" })(post("/ai-analysis/42", {}));
  assertEquals(a.status, 403);
  assertEquals(await a.json(), { error: "feature_disabled", feature: "feature_tiktok" });

  const portfolio = createSupabaseQueryMock();
  signedIn(portfolio);
  portfolio.queueRpc("effective_plan_feature", { data: false });
  const p = await makeHandler(portfolio, { fetch: gemini.impl, geminiKey: "k" })(post("/ai-analysis-portfolio", {}));
  assertEquals(p.status, 403);
  assertEquals(await p.json(), { error: "feature_disabled", feature: "feature_tiktok" });
  assertEquals(gemini.calls.length, 0);
});

// gbp-analytics (Phase 2 Task 11): Google Meu Negócio read routes, DI'd like tiktok-analytics_test.ts.
// The shared supabaseMock ignores filters and hands back queued rows per `table:operation`, in call
// order, so window clipping and tenant keys are asserted on the recorded modifiers.
import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock, type QueryCall } from "../../../test/shared/supabaseMock.ts";
import { createGbpAnalyticsHandler } from "../gbp-analytics/handlers.ts";

type Mock = ReturnType<typeof createSupabaseQueryMock>;

// SP 12:00 on 2026-10-30.
const NOW = new Date("2026-10-30T15:00:00.000Z");

const U1_ID = "11111111-1111-4111-8111-111111111111";
const U2_ID = "22222222-2222-4222-8222-222222222222";
const FOREIGN_ID = "99999999-9999-4999-8999-999999999999";

const U1 = {
  id: U1_ID,
  location_name: "locations/1",
  title: "Clínica Centro",
  status: "active",
  maps_uri: "https://maps.google.com/?cid=1",
  data_through: "2026-10-27",
  average_rating: 4.5,
  total_review_count: 440,
};
const U2 = {
  id: U2_ID,
  location_name: "locations/2",
  title: "Clínica Sul",
  status: "active",
  maps_uri: null,
  data_through: "2026-10-25",
  average_rating: 5.0,
  total_review_count: 10,
};

function metrics(location_name: string, day: string, over: Record<string, number> = {}) {
  return {
    location_name,
    day,
    business_impressions_desktop_maps: 0,
    business_impressions_desktop_search: 0,
    business_impressions_mobile_maps: 0,
    business_impressions_mobile_search: 0,
    call_clicks: 0,
    business_direction_requests: 0,
    website_clicks: 0,
    messaging_clicks: 0,
    business_bookings: 0,
    business_food_menu_clicks: 0,
    ...over,
  };
}

function makeHandler(db: Mock, overrides: Record<string, unknown> = {}) {
  return createGbpAnalyticsHandler({
    buildCorsHeaders: () => ({}),
    // deno-lint-ignore no-explicit-any
    createServiceDb: () => db as any,
    now: () => NOW,
    ...overrides,
  });
}

function get(path: string, token: string | null = "tok", method = "GET") {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request(`https://proj.supabase.co/functions/v1/gbp-analytics${path}`, { headers, method });
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

function units(db: Mock, rows: unknown[] = [U1, U2]) {
  db.queue("gbp_locations", "select", { data: rows });
}

/** Signed in, owned client, both flags on (mock default), and the client's units. */
function ready(db: Mock, rows: unknown[] = [U1, U2]) {
  signedIn(db);
  ownedClient(db);
  units(db, rows);
}

const callsTo = (db: Mock, table: string): QueryCall[] => db.calls.filter((c) => c.table === table);
const mods = (c: QueryCall, method: string) => c.modifiers.filter((m) => m.method === method).map((m) => m.args);
const hasMod = (c: QueryCall, method: string, col: string, val: unknown) =>
  mods(c, method).some(([k, v]) => k === col && JSON.stringify(v) === JSON.stringify(val));
const featureCalls = (db: Mock) =>
  db.calls.filter((c) => c.table === "rpc:effective_plan_feature").map((c) => (c.payload as { feature_key: string }).feature_key);
const HISTORY_TABLES = ["gbp_metrics_daily", "gbp_rating_daily", "gbp_reviews", "gbp_search_keywords_monthly"];

// ── auth / tenant ─────────────────────────────────────────────────────────────

Deno.test("gbp-analytics: 401 without bearer token", async () => {
  const db = createSupabaseQueryMock();
  const res = await makeHandler(db)(get("/overview/42", null));
  assertEquals(res.status, 401);
  assertEquals(db.calls.length, 0);
});

Deno.test("gbp-analytics: 401 when getUser rejects the token", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth(null, { message: "bad jwt" });
  const res = await makeHandler(db)(get("/overview/42"));
  assertEquals(res.status, 401);
  assertEquals(callsTo(db, "profiles").length, 0);
});

Deno.test("gbp-analytics: uses active_workspace_id, not profiles.conta_id", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  ownedClient(db, "ws-A"); // the client belongs to the legacy conta_id, not the active workspace
  const res = await makeHandler(db)(get("/overview/42"));
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "Unauthorized" });
  const [membership] = callsTo(db, "workspace_members");
  assert(hasMod(membership, "eq", "workspace_id", "ws-B"));
  const [client] = callsTo(db, "clientes");
  assert(hasMod(client, "eq", "conta_id", "ws-B"));
  assertEquals(callsTo(db, "gbp_locations").length, 0);
});

Deno.test("gbp-analytics: a non-member is refused by the shared tenant check (401)", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db, { member: false });
  const res = await makeHandler(db)(get("/overview/42"));
  assertEquals(res.status, 401);
  assertEquals(callsTo(db, "clientes").length, 0);
});

Deno.test("gbp-analytics: no active workspace is refused before the membership read", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "user-1" });
  db.queue("profiles", "select", { data: { active_workspace_id: null, conta_id: "ws-A" } });
  const res = await makeHandler(db)(get("/overview/42"));
  assertEquals(res.status, 401);
  assertEquals(callsTo(db, "workspace_members").length, 0);
});

Deno.test("gbp-analytics: 429 past the per-workspace rate limit", async () => {
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
  assertEquals(keys, [["gbp-analytics:ws-B", 120, 60]]);
  assertEquals(callsTo(db, "clientes").length, 0);
});

// ── feature gates ─────────────────────────────────────────────────────────────

Deno.test("gbp-analytics: 403 feature_disabled when feature_google_business is off", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  ownedClient(db);
  db.queueRpc("effective_plan_feature", { data: false });
  const res = await makeHandler(db)(get("/overview/42"));
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "feature_disabled", feature: "feature_google_business" });
  assertEquals(callsTo(db, "gbp_locations").length, 0);
});

Deno.test("gbp-analytics: 403 feature_disabled when feature_analytics_reports is off", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  ownedClient(db);
  db.queueRpc("effective_plan_feature", { data: true }, { data: false });
  const res = await makeHandler(db)(get("/reviews/42"));
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "feature_disabled", feature: "feature_analytics_reports" });
  assertEquals(featureCalls(db), ["feature_google_business", "feature_analytics_reports"]);
  assertEquals(callsTo(db, "gbp_locations").length, 0);
});

Deno.test("gbp-analytics: a foreign client is 403 before any plan flag is read", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  db.queue("clientes", "select", { data: null }); // filtered out by conta_id
  db.queueRpc("effective_plan_feature", { data: false });
  const res = await makeHandler(db)(get("/units/42"));
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "Unauthorized" });
  assertEquals(featureCalls(db), []);
});

// ── input validation / connection ─────────────────────────────────────────────

Deno.test("gbp-analytics: 400 on a non-numeric or non-positive client id", async () => {
  for (const id of ["abc", "0", "1e3"]) {
    const db = createSupabaseQueryMock();
    signedIn(db);
    const res = await makeHandler(db)(get(`/overview/${id}`));
    assertEquals(res.status, 400, id);
    assertEquals(callsTo(db, "clientes").length, 0);
  }
});

Deno.test("gbp-analytics: 400 on an invalid window, before any client read", async () => {
  const bad = [
    "/overview/42?days=28",
    "/overview/42?days=abc",
    "/daily/42?days=0",
    "/surfaces/42?start=2026-10-28&end=2026-10-01",
    "/overview/42?start=2026-10-01",
    "/units/42?start=2024-01-01&end=2026-10-01",
  ];
  for (const path of bad) {
    const db = createSupabaseQueryMock();
    signedIn(db);
    const res = await makeHandler(db)(get(path));
    assertEquals(res.status, 400, path);
    assertEquals(await res.json(), { error: "invalid_window" });
    assertEquals(callsTo(db, "clientes").length, 0);
  }
});

Deno.test("gbp-analytics: 400 on an invalid location, filter or month", async () => {
  const cases: [string, string][] = [
    ["/overview/42?location=locations/1", "invalid_location"],
    ["/reviews/42?location=nope", "invalid_location"],
    ["/reviews/42?filter=old", "invalid_filter"],
    ["/keywords/42?month=2026-13", "invalid_month"],
    ["/keywords/42?month=2026-10", "invalid_month"], // the current SP month is not closed
    ["/keywords/42?month=2026-9", "invalid_month"],
  ];
  for (const [path, error] of cases) {
    const db = createSupabaseQueryMock();
    signedIn(db);
    const res = await makeHandler(db)(get(path));
    assertEquals(res.status, 400, path);
    assertEquals(await res.json(), { error }, path);
    assertEquals(callsTo(db, "clientes").length, 0);
  }
});

Deno.test("gbp-analytics: 404 not_connected when the client has no active or revoked unit", async () => {
  const db = createSupabaseQueryMock();
  ready(db, []);
  const res = await makeHandler(db)(get("/overview/42"));
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "not_connected" });
  const [loc] = callsTo(db, "gbp_locations");
  assert(hasMod(loc, "eq", "conta_id", "ws-B"));
  assert(hasMod(loc, "eq", "client_id", 42));
  assert(hasMod(loc, "in", "status", ["active", "revoked"]));
  assertEquals(featureCalls(db), ["feature_google_business", "feature_analytics_reports"]);
});

Deno.test("gbp-analytics: a location uuid outside the client is 404", async () => {
  const db = createSupabaseQueryMock();
  ready(db);
  const res = await makeHandler(db)(get(`/overview/42?location=${FOREIGN_ID}`));
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "not_connected" });
  for (const t of HISTORY_TABLES) assertEquals(callsTo(db, t).length, 0, t);
});

Deno.test("gbp-analytics: never selects token columns or *", async () => {
  const db = createSupabaseQueryMock();
  ready(db);
  await makeHandler(db)(get("/overview/42"));
  const selects = db.calls.filter((c) => c.operation === "select" && !c.table.startsWith("rpc:"));
  assert(selects.some((c) => c.table === "gbp_locations"));
  for (const c of selects) {
    const cols = String(c.selectArgs[0]?.[0] ?? "");
    assert(!cols.includes("token"), `${c.table}: ${cols}`);
    assert(!cols.includes("*"), `${c.table}: ${cols}`);
  }
});

Deno.test("gbp-analytics: a failed read is a generic 500 with no detail", async () => {
  const db = createSupabaseQueryMock();
  ready(db);
  db.queue("gbp_metrics_daily", "select", { data: null, error: { message: "relation gbp secret detail", code: "42P01" } });
  const originalError = console.error;
  console.error = () => {};
  try {
    const res = await makeHandler(db)(get("/overview/42"));
    assertEquals(res.status, 500);
    const text = await res.text();
    assertEquals(JSON.parse(text), { error: "Internal server error" });
    assert(!text.includes("secret") && !text.includes("42P01"), text);
  } finally {
    console.error = originalError;
  }
});

Deno.test("gbp-analytics: unknown route or method is a 404", async () => {
  for (const [path, method] of [["/nope", "GET"], ["/overview/42/extra", "GET"], ["/overview/42", "POST"]]) {
    const db = createSupabaseQueryMock();
    signedIn(db);
    const res = await makeHandler(db)(get(path, "tok", method));
    assertEquals(res.status, 404, `${method} ${path}`);
    assertEquals(callsTo(db, "clientes").length, 0);
  }
});

Deno.test("gbp-analytics: OPTIONS answers the preflight with the CORS headers", async () => {
  const db = createSupabaseQueryMock();
  const res = await makeHandler(db, { buildCorsHeaders: () => ({ "Access-Control-Allow-Origin": "https://app.test" }) })(
    get("/overview/42", null, "OPTIONS"),
  );
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "https://app.test");
  assertEquals(db.calls.length, 0);
});

// ── overview ──────────────────────────────────────────────────────────────────

Deno.test("gbp-analytics: 'Todas as unidades' ends its window on the earliest data_through", async () => {
  const db = createSupabaseQueryMock();
  ready(db); // data_through 10-27 and 10-25
  db.queue("gbp_metrics_daily", "select", {
    data: [
      metrics("locations/1", "2026-10-25", { business_impressions_mobile_maps: 10, call_clicks: 2 }),
      metrics("locations/2", "2026-10-19", { business_impressions_desktop_search: 6, call_clicks: 1 }),
      metrics("locations/2", "2026-10-15", { call_clicks: 7 }), // previous window
    ],
  });
  const res = await makeHandler(db)(get("/overview/42?days=7&location=all"));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.dataThrough, "2026-10-25");
  assertEquals(body.window, { start: "2026-10-19", end: "2026-10-25", prevStart: "2026-10-12", prevEnd: "2026-10-18" });
  assertEquals(body.kpis.profile_views, { value: 16, prev: 0 });
  assertEquals(body.kpis.calls, { value: 3, prev: 7 });

  const [m] = callsTo(db, "gbp_metrics_daily");
  assert(hasMod(m, "eq", "conta_id", "ws-B"));
  assert(hasMod(m, "in", "location_name", ["locations/1", "locations/2"]));
  assert(hasMod(m, "gte", "day", "2026-10-12"));
  assert(hasMod(m, "lte", "day", "2026-10-25"));
});

Deno.test("gbp-analytics: a revoked unit's frozen data_through does not hold 'Todas' back, but its rows still count", async () => {
  const db = createSupabaseQueryMock();
  ready(db, [U1, { ...U2, status: "revoked", data_through: "2026-10-20" }]); // active 10-27, revoked 10-20
  db.queue("gbp_metrics_daily", "select", {
    data: [
      metrics("locations/1", "2026-10-27", { call_clicks: 2 }),
      metrics("locations/2", "2026-10-21", { call_clicks: 5 }),
    ],
  });
  const res = await makeHandler(db)(get("/overview/42?days=7"));
  const body = await res.json();
  assertEquals(body.dataThrough, "2026-10-27");
  assertEquals(body.window.end, "2026-10-27");
  assertEquals(body.kpis.calls, { value: 7, prev: 0 });
  const [m] = callsTo(db, "gbp_metrics_daily");
  assert(hasMod(m, "in", "location_name", ["locations/1", "locations/2"]));

  // Every unit revoked: the earliest watermark.
  const db2 = createSupabaseQueryMock();
  ready(db2, [{ ...U1, status: "revoked" }, { ...U2, status: "revoked", data_through: "2026-10-20" }]);
  const body2 = await (await makeHandler(db2)(get("/overview/42?days=7"))).json();
  assertEquals(body2.window.end, "2026-10-20");
});

Deno.test("gbp-analytics: one unit selected uses its own data_through and only its rows", async () => {
  const db = createSupabaseQueryMock();
  ready(db);
  const res = await makeHandler(db)(get(`/overview/42?days=7&location=${U1_ID}`));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.dataThrough, "2026-10-27");
  assertEquals(body.window.end, "2026-10-27");
  for (const t of ["gbp_metrics_daily", "gbp_rating_daily"]) {
    const [c] = callsTo(db, t);
    assert(hasMod(c, "in", "location_name", ["locations/1"]), t);
    assert(hasMod(c, "eq", "conta_id", "ws-B"), t);
  }
});

Deno.test("gbp-analytics: a range end is clipped to data_through", async () => {
  const db = createSupabaseQueryMock();
  ready(db);
  const res = await makeHandler(db)(get("/overview/42?start=2026-10-21&end=2026-10-30"));
  const body = await res.json();
  assertEquals(body.window, { start: "2026-10-21", end: "2026-10-25", prevStart: "2026-10-16", prevEnd: "2026-10-20" });
});

Deno.test("gbp-analytics: overview weights the rating by review count across two units", async () => {
  const db = createSupabaseQueryMock();
  ready(db);
  db.queue("gbp_rating_daily", "select", {
    data: [
      { location_name: "locations/1", day: "2026-10-10", average_rating: 4.0, total_review_count: 100 },
      { location_name: "locations/2", day: "2026-10-10", average_rating: 5.0, total_review_count: 100 },
      { location_name: "locations/1", day: "2026-10-24", average_rating: 4.0, total_review_count: 300 },
      { location_name: "locations/2", day: "2026-10-25", average_rating: 5.0, total_review_count: 100 },
    ],
  });
  const res = await makeHandler(db)(get("/overview/42?days=7"));
  const body = await res.json();
  assertEquals(body.kpis.avg_rating, { value: 4.25, prev: 4.5 });
  assertEquals(body.kpis.new_reviews.value, 200);
  const [r] = callsTo(db, "gbp_rating_daily");
  assert(hasMod(r, "eq", "conta_id", "ws-B"));
  assert(hasMod(r, "lte", "day", "2026-10-25"));
});

Deno.test("gbp-analytics: before the first sync the overview has a window and every KPI null", async () => {
  const db = createSupabaseQueryMock();
  ready(db, [{ ...U1, data_through: null }, { ...U2, data_through: null }]);
  const res = await makeHandler(db)(get("/overview/42?days=30"));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.dataThrough, null);
  assert(body.window && typeof body.window.start === "string" && typeof body.window.prevEnd === "string");
  assertEquals(Object.keys(body.kpis), [
    "profile_views",
    "calls",
    "directions",
    "website_clicks",
    "messages",
    "bookings",
    "avg_rating",
    "new_reviews",
  ]);
  for (const id of Object.keys(body.kpis)) assertEquals(body.kpis[id], { value: null, prev: null }, id);
  for (const t of HISTORY_TABLES) assertEquals(callsTo(db, t).length, 0, t);
});

Deno.test("gbp-analytics: a revoked unit's data is still returned", async () => {
  const db = createSupabaseQueryMock();
  ready(db, [{ ...U1, status: "revoked" }]);
  db.queue("gbp_metrics_daily", "select", { data: [metrics("locations/1", "2026-10-27", { website_clicks: 8 })] });
  const res = await makeHandler(db)(get("/overview/42?days=7"));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.kpis.website_clicks, { value: 8, prev: 0 });
});

// ── daily / surfaces ──────────────────────────────────────────────────────────

Deno.test("gbp-analytics: daily returns one point per window day, zeros where the API omitted the day", async () => {
  const db = createSupabaseQueryMock();
  ready(db);
  db.queue("gbp_metrics_daily", "select", {
    data: [
      metrics("locations/1", "2026-10-19", { call_clicks: 1, business_impressions_desktop_maps: 4 }),
      metrics("locations/2", "2026-10-19", { call_clicks: 2 }),
      metrics("locations/1", "2026-10-25", { business_bookings: 3 }),
    ],
  });
  const res = await makeHandler(db)(get("/daily/42?days=7"));
  assertEquals(res.status, 200);
  const { daily } = await res.json();
  assertEquals(daily.length, 7);
  assertEquals(daily[0], {
    date: "2026-10-19",
    profileViews: 4,
    calls: 3,
    directions: 0,
    websiteClicks: 0,
    messages: 0,
    bookings: 0,
  });
  assertEquals(daily[6].date, "2026-10-25");
  assertEquals(daily[6].bookings, 3);
  assertEquals(daily[3].calls, 0);
  const [m] = callsTo(db, "gbp_metrics_daily");
  assert(hasMod(m, "gte", "day", "2026-10-19"));
});

Deno.test("gbp-analytics: daily before the first sync is empty", async () => {
  const db = createSupabaseQueryMock();
  ready(db, [{ ...U1, data_through: null }]);
  const res = await makeHandler(db)(get("/daily/42"));
  assertEquals(await res.json(), { daily: [] });
});

Deno.test("gbp-analytics: surfaces returns the four impression sums with percentages", async () => {
  const db = createSupabaseQueryMock();
  ready(db);
  db.queue("gbp_metrics_daily", "select", {
    data: [
      metrics("locations/1", "2026-10-20", {
        business_impressions_desktop_maps: 10,
        business_impressions_desktop_search: 20,
        business_impressions_mobile_maps: 30,
        business_impressions_mobile_search: 40,
      }),
    ],
  });
  const res = await makeHandler(db)(get("/surfaces/42?days=7"));
  assertEquals(await res.json(), {
    surfaces: [
      { surface: "desktop_maps", value: 10, pct: 10 },
      { surface: "desktop_search", value: 20, pct: 20 },
      { surface: "mobile_maps", value: 30, pct: 30 },
      { surface: "mobile_search", value: 40, pct: 40 },
    ],
  });
});

// ── keywords ──────────────────────────────────────────────────────────────────

Deno.test("gbp-analytics: keywords default to the latest closed month and list closed months only", async () => {
  const db = createSupabaseQueryMock();
  ready(db);
  db.queue(
    "gbp_search_keywords_monthly",
    "select",
    { data: [{ month: "2026-09-01" }, { month: "2026-09-01" }, { month: "2026-08-01" }] },
    {
      data: [
        { location_name: "locations/1", keyword: "dentista", value: 40, threshold: null },
        { location_name: "locations/2", keyword: "dentista", value: 5, threshold: null },
        { location_name: "locations/1", keyword: "implante", value: null, threshold: 15 },
      ],
    },
  );
  const res = await makeHandler(db)(get("/keywords/42"));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    month: "2026-09",
    months: ["2026-09", "2026-08"],
    keywords: [
      { keyword: "dentista", value: 45, threshold: null },
      { keyword: "implante", value: null, threshold: 15 },
    ],
  });
  const [monthsCall, rowsCall] = callsTo(db, "gbp_search_keywords_monthly");
  assert(hasMod(monthsCall, "eq", "conta_id", "ws-B"));
  assert(hasMod(monthsCall, "lt", "month", "2026-10-01"));
  assert(hasMod(monthsCall, "gte", "month", "2025-04-01")); // 18 months back
  assert(hasMod(rowsCall, "eq", "conta_id", "ws-B"));
  assert(hasMod(rowsCall, "eq", "month", "2026-09-01"));
  assert(hasMod(rowsCall, "in", "location_name", ["locations/1", "locations/2"]));
});

Deno.test("gbp-analytics: keywords for a requested closed month; none stored is empty", async () => {
  const db = createSupabaseQueryMock();
  ready(db);
  db.queue("gbp_search_keywords_monthly", "select", { data: [{ month: "2026-09-01" }] }, { data: [] });
  const res = await makeHandler(db)(get("/keywords/42?month=2026-07"));
  assertEquals(await res.json(), { month: "2026-07", months: ["2026-09"], keywords: [] });
  const [, rowsCall] = callsTo(db, "gbp_search_keywords_monthly");
  assert(hasMod(rowsCall, "eq", "month", "2026-07-01"));

  const db2 = createSupabaseQueryMock();
  ready(db2);
  const res2 = await makeHandler(db2)(get("/keywords/42"));
  assertEquals(await res2.json(), { month: null, months: [], keywords: [] });
  assertEquals(callsTo(db2, "gbp_search_keywords_monthly").length, 1);
});

// ── reviews ───────────────────────────────────────────────────────────────────

Deno.test("gbp-analytics: reviews are the newest 50 with the unit's title and Maps link", async () => {
  const db = createSupabaseQueryMock();
  ready(db);
  db.queue("gbp_reviews", "select", {
    data: [
      {
        location_name: "locations/2",
        reviewer_name: "Maria",
        star_rating: 5,
        comment: "Ótimo",
        create_time: "2026-10-28T12:00:00+00:00",
        has_reply: true,
      },
      {
        location_name: "locations/1",
        reviewer_name: null,
        star_rating: 2,
        comment: null,
        create_time: "2026-10-27T12:00:00+00:00",
        has_reply: false,
      },
    ],
  });
  const res = await makeHandler(db)(get("/reviews/42"));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    reviews: [
      {
        reviewer: "Maria",
        rating: 5,
        comment: "Ótimo",
        unitTitle: "Clínica Sul",
        unitMapsUri: null,
        createTime: "2026-10-28T12:00:00+00:00",
        hasReply: true,
      },
      {
        reviewer: null,
        rating: 2,
        comment: null,
        unitTitle: "Clínica Centro",
        unitMapsUri: "https://maps.google.com/?cid=1",
        createTime: "2026-10-27T12:00:00+00:00",
        hasReply: false,
      },
    ],
  });
  const [r] = callsTo(db, "gbp_reviews");
  assert(hasMod(r, "eq", "conta_id", "ws-B"));
  assert(hasMod(r, "in", "location_name", ["locations/1", "locations/2"]));
  assertEquals(mods(r, "limit"), [[50]]);
  assertEquals(mods(r, "order")[0], ["create_time", { ascending: false, nullsFirst: false }]);
  assertEquals(mods(r, "eq").filter(([k]) => k === "has_reply").length, 0);
});

Deno.test("gbp-analytics: review filters: unanswered is has_reply false, low is 3 stars or less", async () => {
  const db = createSupabaseQueryMock();
  ready(db);
  await makeHandler(db)(get("/reviews/42?filter=unanswered"));
  const [u] = callsTo(db, "gbp_reviews");
  assert(hasMod(u, "eq", "has_reply", false));

  const db2 = createSupabaseQueryMock();
  ready(db2);
  await makeHandler(db2)(get(`/reviews/42?filter=low&location=${U2_ID}`));
  const [l] = callsTo(db2, "gbp_reviews");
  assert(hasMod(l, "lte", "star_rating", 3));
  assert(hasMod(l, "in", "location_name", ["locations/2"]));
});

// ── rating distribution ───────────────────────────────────────────────────────

Deno.test("gbp-analytics: rating distribution is partial when only 200 of 440 reviews are stored", async () => {
  const db = createSupabaseQueryMock();
  ready(db, [U1]); // total_review_count 440
  db.queue("gbp_reviews", "select", {
    data: [
      ...Array.from({ length: 150 }, () => ({ location_name: "locations/1", star_rating: 5 })),
      ...Array.from({ length: 50 }, () => ({ location_name: "locations/1", star_rating: 3 })),
    ],
  });
  const res = await makeHandler(db)(get("/rating-distribution/42"));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    counts: { "1": 0, "2": 0, "3": 50, "4": 0, "5": 150 },
    storedTotal: 200,
    total: 440,
    partial: true,
  });
  const [r] = callsTo(db, "gbp_reviews");
  assert(hasMod(r, "eq", "conta_id", "ws-B"));
});

// ── units ─────────────────────────────────────────────────────────────────────

Deno.test("gbp-analytics: units returns each unit's window sums, rating and review count", async () => {
  const db = createSupabaseQueryMock();
  // Active U1 (10-27) sets the window; the revoked U2's frozen 10-25 does not hold it back.
  ready(db, [U1, { ...U2, status: "revoked" }]);
  db.queue("gbp_metrics_daily", "select", {
    data: [
      metrics("locations/1", "2026-10-26", { business_impressions_mobile_search: 7, call_clicks: 1 }),
      metrics("locations/2", "2026-10-21", { website_clicks: 2, messaging_clicks: 3 }),
      metrics("locations/1", "2026-10-20", { call_clicks: 100 }), // before the window
    ],
  });
  const res = await makeHandler(db)(get(`/units/42?days=7&location=${U1_ID}`));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    units: [
      {
        id: U1_ID,
        title: "Clínica Centro",
        status: "active",
        profileViews: 7,
        calls: 1,
        directions: 0,
        websiteClicks: 0,
        messages: 0,
        bookings: 0,
        avgRating: 4.5,
        totalReviewCount: 440,
      },
      {
        id: U2_ID,
        title: "Clínica Sul",
        status: "revoked",
        profileViews: 0,
        calls: 0,
        directions: 0,
        websiteClicks: 2,
        messages: 3,
        bookings: 0,
        avgRating: 5,
        totalReviewCount: 10,
      },
    ],
  });
  const [m] = callsTo(db, "gbp_metrics_daily");
  assert(hasMod(m, "in", "location_name", ["locations/1", "locations/2"]));
  assert(hasMod(m, "gte", "day", "2026-10-21"));
  assert(hasMod(m, "lte", "day", "2026-10-27"));
});

// ── tenant keys on every history read ─────────────────────────────────────────

Deno.test("gbp-analytics: every history read is keyed by the workspace's conta_id", async () => {
  const routes = ["/overview/42", "/daily/42", "/surfaces/42", "/reviews/42", "/rating-distribution/42", "/units/42"];
  for (const path of routes) {
    const db = createSupabaseQueryMock();
    ready(db);
    const res = await makeHandler(db)(get(path));
    assertEquals(res.status, 200, path);
    const reads = db.calls.filter((c) => HISTORY_TABLES.includes(c.table));
    assert(reads.length > 0, path);
    for (const c of reads) assert(hasMod(c, "eq", "conta_id", "ws-B"), `${path} ${c.table}`);
  }
});

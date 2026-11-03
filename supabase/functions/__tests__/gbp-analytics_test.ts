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
  }, { data: [] }, { data: [{ day: "2026-10-01" }] }); // read, its closing page, then the coverage read
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
  // Coverage read: any selected unit's row on or before prevStart.
  const cover = callsTo(db, "gbp_metrics_daily").at(-1)!;
  assert(hasMod(cover, "eq", "conta_id", "ws-B"));
  assert(hasMod(cover, "in", "location_name", ["locations/1", "locations/2"]));
  assert(hasMod(cover, "lte", "day", "2026-10-12"));
  assertEquals(mods(cover, "limit"), [[1]]);
});

Deno.test("gbp-analytics: a previous window the data only half covers has no comparison (I-2)", async () => {
  const db = createSupabaseQueryMock();
  ready(db);
  // The earliest row is 2026-10-15, inside the previous window [2026-10-12, 2026-10-18].
  db.queue(
    "gbp_metrics_daily",
    "select",
    { data: [metrics("locations/1", "2026-10-15", { call_clicks: 7 }), metrics("locations/1", "2026-10-25", { call_clicks: 2 })] },
    { data: [] },
    { data: [] }, // coverage: nothing on or before 2026-10-12
  );
  const body = await (await makeHandler(db)(get("/overview/42?days=7"))).json();
  assertEquals(body.kpis.calls, { value: 2, prev: null });
  assertEquals(body.kpis.profile_views, { value: 0, prev: null });
});

Deno.test("gbp-analytics: a revoked unit's frozen data_through does not hold 'Todas' back, but its rows still count", async () => {
  const db = createSupabaseQueryMock();
  ready(db, [U1, { ...U2, status: "revoked", data_through: "2026-10-20" }]); // active 10-27, revoked 10-20
  db.queue("gbp_metrics_daily", "select", {
    data: [
      metrics("locations/1", "2026-10-27", { call_clicks: 2 }),
      metrics("locations/2", "2026-10-21", { call_clicks: 5 }),
    ],
  }, { data: [] }, { data: [{ day: "2026-10-01" }] });
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
  db.queue(
    "gbp_metrics_daily",
    "select",
    { data: [metrics("locations/1", "2026-10-27", { website_clicks: 8 })] },
    { data: [] },
    { data: [{ day: "2026-10-01" }] },
  );
  const res = await makeHandler(db)(get("/overview/42?days=7"));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.kpis.website_clicks, { value: 8, prev: 0 });
});

Deno.test("gbp-analytics: history reads page past PostgREST's 1000-row cap until an empty page", async () => {
  const db = createSupabaseQueryMock();
  ready(db);
  db.queue(
    "gbp_metrics_daily",
    "select",
    { data: Array.from({ length: 1000 }, () => metrics("locations/1", "2026-10-25", { call_clicks: 1 })) },
    { data: Array.from({ length: 5 }, () => metrics("locations/2", "2026-10-24", { call_clicks: 2 })) },
    { data: [] },
    { data: [{ day: "2026-10-01" }] },
  );
  const res = await makeHandler(db)(get("/overview/42?days=7"));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).kpis.calls, { value: 1010, prev: 0 });
  const paged = callsTo(db, "gbp_metrics_daily").filter((c) => mods(c, "range").length > 0);
  assertEquals(paged.map((c) => mods(c, "range")[0]), [[0, 999], [1000, 1999], [1005, 2004]]);
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

/** The 18 closed months before SP 2026-10, newest first: one month probe each, in this order. */
const CANDIDATE_MONTHS = Array.from({ length: 18 }, (_, i) => new Date(Date.UTC(2026, 8 - i, 1)).toISOString().slice(0, 7));

function keywordProbes(db: Mock, present: string[]) {
  db.queue(
    "gbp_search_keywords_monthly",
    "select",
    ...CANDIDATE_MONTHS.map((m) => ({ data: present.includes(m) ? [{ month: `${m}-01` }] : [] })),
  );
}

const probeCalls = (db: Mock) => callsTo(db, "gbp_search_keywords_monthly").filter((c) => mods(c, "limit").length > 0);
const keywordRowCalls = (db: Mock) => callsTo(db, "gbp_search_keywords_monthly").filter((c) => mods(c, "limit").length === 0);

Deno.test("gbp-analytics: keywords default to the latest closed month and list closed months only", async () => {
  const db = createSupabaseQueryMock();
  ready(db);
  keywordProbes(db, ["2026-09", "2026-08"]);
  db.queue("gbp_search_keywords_monthly", "select", {
    data: [
      { location_name: "locations/1", keyword: "dentista", value: 40, threshold: null },
      { location_name: "locations/2", keyword: "dentista", value: 5, threshold: null },
      { location_name: "locations/1", keyword: "implante", value: null, threshold: 15 },
    ],
  });
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
  // One limit(1) probe per closed month, 2026-09 back to 2025-04; never the current month.
  const probes = probeCalls(db);
  assertEquals(probes.length, 18);
  assertEquals(
    probes.map((c) => mods(c, "eq").find(([k]) => k === "month")?.[1]).sort(),
    CANDIDATE_MONTHS.map((m) => `${m}-01`).sort(),
  );
  for (const c of probes) {
    assert(hasMod(c, "eq", "conta_id", "ws-B"));
    assert(hasMod(c, "in", "location_name", ["locations/1", "locations/2"]));
    assertEquals(mods(c, "limit"), [[1]]);
  }
  const [rowsCall] = keywordRowCalls(db);
  assert(hasMod(rowsCall, "eq", "conta_id", "ws-B"));
  assert(hasMod(rowsCall, "eq", "month", "2026-09-01"));
  assert(hasMod(rowsCall, "in", "location_name", ["locations/1", "locations/2"]));
});

Deno.test("gbp-analytics: keywords for a requested closed month; none stored is empty", async () => {
  const db = createSupabaseQueryMock();
  ready(db);
  keywordProbes(db, ["2026-09"]);
  const res = await makeHandler(db)(get("/keywords/42?month=2026-07"));
  assertEquals(await res.json(), { month: "2026-07", months: ["2026-09"], keywords: [] });
  const [rowsCall] = keywordRowCalls(db);
  assert(hasMod(rowsCall, "eq", "month", "2026-07-01"));

  const db2 = createSupabaseQueryMock();
  ready(db2);
  const res2 = await makeHandler(db2)(get("/keywords/42"));
  assertEquals(await res2.json(), { month: null, months: [], keywords: [] });
  assertEquals(keywordRowCalls(db2).length, 0);
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

// ── portfolio ─────────────────────────────────────────────────────────────────
// Read order (fixed in buildGbpPortfolio): clientes -> gbp_locations -> metrics, ratings and
// reviews in parallel. Each is paged, so the mock's default empty select closes each read.
// No list of ids rides a whole-workspace query string: gbp_locations is read by tenant + status
// and the history by tenant + dates, each filtered in code. Only `?client=` keeps `in location_name`.

const FRESH = "2026-10-30T10:00:00.000Z"; // 5 h before NOW
const STALE = "2026-10-27T15:00:00.000Z"; // 72 h before NOW
const PU1 = { ...U1, client_id: 42, last_synced_at: FRESH };
const PU2 = { ...U2, client_id: 43, last_synced_at: FRESH };
const CLIENTS = [
  { id: 42, nome: "Dra. Ana", especialidade: "Odontologia" },
  { id: 43, nome: "Dr. Beto", especialidade: "" },
];

function portfolioReady(db: Mock, clients: unknown[] = CLIENTS, rows: unknown[] = [PU1, PU2]) {
  signedIn(db);
  db.queue("clientes", "select", { data: clients });
  db.queue("gbp_locations", "select", { data: rows });
}

/** Every day of [start, start + count - 1]. */
const daysFrom = (start: string, count: number) =>
  Array.from({ length: count }, (_, i) => new Date(Date.parse(`${start}T00:00:00.000Z`) + i * 86400000).toISOString().slice(0, 10));

Deno.test("portfolio: 403 feature_disabled when a plan flag is off, before any read", async () => {
  const db = createSupabaseQueryMock();
  signedIn(db);
  db.queueRpc("effective_plan_feature", { data: false });
  const res = await makeHandler(db)(get("/portfolio"));
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "feature_disabled", feature: "feature_google_business" });
  assertEquals(callsTo(db, "clientes").length, 0);

  const db2 = createSupabaseQueryMock();
  signedIn(db2);
  db2.queueRpc("effective_plan_feature", { data: true }, { data: false });
  const res2 = await makeHandler(db2)(get("/portfolio"));
  assertEquals(res2.status, 403);
  assertEquals(await res2.json(), { error: "feature_disabled", feature: "feature_analytics_reports" });
  assertEquals(callsTo(db2, "clientes").length, 0);
});

Deno.test("portfolio: 400 invalid_window on days=28 and invalid_client_id on a bad client", async () => {
  const cases: [string, string][] = [
    ["/portfolio?days=28", "invalid_window"],
    ["/portfolio?start=2026-10-01&end=2026-10-10", "invalid_window"], // days only
    ["/portfolio?client=abc", "invalid_client_id"],
    ["/portfolio?client=0", "invalid_client_id"],
    ["/portfolio?client=", "invalid_client_id"],
  ];
  for (const [path, error] of cases) {
    const db = createSupabaseQueryMock();
    signedIn(db);
    const res = await makeHandler(db)(get(path));
    assertEquals(res.status, 400, path);
    assertEquals(await res.json(), { error }, path);
    assertEquals(featureCalls(db), [], path);
    assertEquals(callsTo(db, "clientes").length, 0, path);
  }
});

Deno.test("portfolio: reads active clients of the tenant only, and their counted units", async () => {
  const db = createSupabaseQueryMock();
  portfolioReady(db, [CLIENTS[0]], [PU1]);
  const res = await makeHandler(db)(get("/portfolio?client=42"));
  assertEquals(res.status, 200);
  const [client] = callsTo(db, "clientes");
  assert(hasMod(client, "eq", "conta_id", "ws-B"));
  assert(hasMod(client, "eq", "status", "ativo"));
  assert(hasMod(client, "eq", "id", 42));
  const [loc] = callsTo(db, "gbp_locations");
  assert(hasMod(loc, "eq", "conta_id", "ws-B"));
  assertEquals(mods(loc, "in"), [["status", ["active", "revoked"]]]); // active clients filtered in code
  assert(hasMod(loc, "in", "status", ["active", "revoked"]));
  assert(hasMod(loc, "eq", "client_id", 42)); // one client: narrow the unit read
  assertEquals(mods(loc, "order"), [
    ["client_id", { ascending: true }],
    ["created_at", { ascending: true }],
    ["id", { ascending: true }],
  ]);
  assertEquals(featureCalls(db), ["feature_google_business", "feature_analytics_reports"]);
  for (const c of db.calls.filter((c) => c.operation === "select" && !c.table.startsWith("rpc:"))) {
    const cols = String(c.selectArgs[0]?.[0] ?? "");
    assert(!cols.includes("token") && !cols.includes("*"), `${c.table}: ${cols}`);
  }
  for (const c of db.calls.filter((c) => HISTORY_TABLES.includes(c.table))) {
    assert(hasMod(c, "eq", "conta_id", "ws-B"), c.table);
  }
});

Deno.test("portfolio: empty when no client or no unit", async () => {
  for (const [clients, rows] of [[[], []], [CLIENTS, []]] as [unknown[], unknown[]][]) {
    const db = createSupabaseQueryMock();
    portfolioReady(db, clients, rows);
    const res = await makeHandler(db)(get("/portfolio"));
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(Object.keys(body), ["window", "dataThrough", "kpis", "units", "reviewsAttention"]);
    assertEquals(body.units, []);
    assertEquals(body.reviewsAttention, []);
    assertEquals(body.dataThrough, null);
    assertEquals(body.kpis.units, 0);
    assertEquals(body.kpis.revokedUnits, 0);
    assertEquals(body.kpis.actions, { value: null, prev: null });
    assert(typeof body.window.start === "string");
    if (clients.length === 0) assertEquals(callsTo(db, "gbp_locations").length, 0);
    for (const t of HISTORY_TABLES) assertEquals(callsTo(db, t).length, 0, t);
  }
});

Deno.test("portfolio: foreign client id yields the empty portfolio", async () => {
  const db = createSupabaseQueryMock();
  portfolioReady(db, [], [PU1]); // the tenant-keyed clientes read finds nothing
  const res = await makeHandler(db)(get("/portfolio?client=999"));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.units, []);
  const [client] = callsTo(db, "clientes");
  assert(hasMod(client, "eq", "conta_id", "ws-B"));
  assert(hasMod(client, "eq", "id", 999));
  assertEquals(callsTo(db, "gbp_locations").length, 0);
  for (const t of HISTORY_TABLES) assertEquals(callsTo(db, t).length, 0, t);
});

Deno.test("portfolio: before the first sync the units are listed with zeros and no metric is read", async () => {
  const db = createSupabaseQueryMock();
  portfolioReady(db, CLIENTS, [{ ...PU1, data_through: null }, { ...PU2, data_through: null }]);
  const body = await (await makeHandler(db)(get("/portfolio"))).json();
  assertEquals(body.dataThrough, null);
  assertEquals(body.units.length, 2);
  assertEquals(body.units[0].actions, 0);
  assertEquals(body.units[0].prevProfileViews, null);
  assertEquals(body.units[0].avgRating, 4.5); // gbp_locations fallback: no snapshot read
  assertEquals(body.kpis.units, 2);
  assertEquals(body.kpis.profileViews, { value: null, prev: null });
  for (const t of ["gbp_metrics_daily", "gbp_rating_daily"]) assertEquals(callsTo(db, t).length, 0, t);
});

Deno.test("portfolio: attention reviews do not wait for the metrics window", async () => {
  const db = createSupabaseQueryMock();
  portfolioReady(db, CLIENTS, [{ ...PU1, data_through: null }]);
  db.queue("gbp_reviews", "select", {
    data: [{ location_name: "locations/1", reviewer_name: "Ana", star_rating: 2, comment: "Fila", create_time: "2026-10-29T12:00:00+00:00" }],
  });
  const body = await (await makeHandler(db)(get("/portfolio?days=7"))).json();
  assertEquals(body.dataThrough, null);
  assertEquals(body.reviewsAttention.map((r: { unitId: string; starRating: number }) => [r.unitId, r.starRating]), [[U1_ID, 2]]);
  const [r] = callsTo(db, "gbp_reviews");
  assert(hasMod(r, "gte", "create_time", "2026-10-24T03:00:00.000Z")); // SP 2026-10-30 - 6 days
});

Deno.test("portfolio: sums KPIs and per-unit rows over the shared window", async () => {
  const db = createSupabaseQueryMock();
  portfolioReady(db); // fresh 10-27 and 10-25: the window ends on 10-25
  // days=30: [2026-09-26, 2026-10-25], previous [2026-08-27, 2026-09-25].
  db.queue("gbp_metrics_daily", "select", {
    data: [
      metrics("locations/1", "2026-08-27", { call_clicks: 4 }), // on prevStart: U1 covered
      ...daysFrom("2026-09-26", 30).map((d) => metrics("locations/1", d, { call_clicks: 1, business_direction_requests: 1 })),
      metrics("locations/2", "2026-10-20", { business_impressions_mobile_maps: 10, website_clicks: 3, messaging_clicks: 2 }),
    ],
  });
  const res = await makeHandler(db)(get("/portfolio?days=30"));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.dataThrough, "2026-10-25");
  assertEquals(body.window, { start: "2026-09-26", end: "2026-10-25", prevStart: "2026-08-27", prevEnd: "2026-09-25" });
  assertEquals(body.kpis.units, 2);
  assertEquals(body.kpis.revokedUnits, 0);
  assertEquals(body.kpis.actions, { value: 65, prev: 4 });
  assertEquals(body.kpis.profileViews, { value: 10, prev: 0 });

  const [u1, u2] = body.units;
  assertEquals(u1, {
    id: U1_ID,
    clientId: 42,
    clientName: "Dra. Ana",
    especialidade: "Odontologia",
    title: "Clínica Centro",
    status: "active",
    mapsUri: "https://maps.google.com/?cid=1",
    lastSyncedAt: FRESH,
    stale: false,
    profileViews: 0,
    prevProfileViews: 0,
    calls: 30,
    directions: 30,
    websiteClicks: 0,
    messages: 0,
    bookings: 0,
    actions: 60,
    avgRating: 4.5,
    reviewCount: 440,
    newReviews: null,
  });
  assertEquals(u2.clientName, "Dr. Beto");
  assertEquals(u2.especialidade, null); // '' is no specialty
  assertEquals(u2.profileViews, 10);
  assertEquals(u2.actions, 5);

  const [m] = callsTo(db, "gbp_metrics_daily");
  assert(hasMod(m, "eq", "conta_id", "ws-B"));
  assertEquals(mods(m, "in"), []); // whole workspace: tenant + dates, units kept in code
  assert(hasMod(m, "gte", "day", "2026-08-27"));
  assert(hasMod(m, "lte", "day", "2026-10-25"));
  assertEquals(mods(m, "order"), [["location_name", { ascending: true }], ["day", { ascending: true }]]);
});

Deno.test("portfolio: whole workspace keeps only the listed units' rows, in code", async () => {
  const db = createSupabaseQueryMock();
  // Client 99 is not active: its unit is dropped, and locations/9 (its, or a disconnected unit's
  // history) comes back from the tenant-wide reads without counting anywhere.
  portfolioReady(db, CLIENTS, [PU1, PU2, { ...PU2, id: "u-99", client_id: 99, location_name: "locations/9", data_through: "2026-10-01" }]);
  db.queue("gbp_metrics_daily", "select", {
    data: [
      metrics("locations/1", "2026-10-20", { call_clicks: 2 }),
      metrics("locations/9", "2026-10-20", { call_clicks: 500, business_impressions_desktop_maps: 500 }),
    ],
  });
  db.queue("gbp_rating_daily", "select", {
    data: [
      { location_name: "locations/1", day: "2026-10-20", average_rating: 4.0, total_review_count: 100 },
      { location_name: "locations/9", day: "2026-10-20", average_rating: 1.0, total_review_count: 9000 },
    ],
  });
  db.queue("gbp_reviews", "select", {
    data: [
      { location_name: "locations/9", reviewer_name: "X", star_rating: 1, comment: null, create_time: "2026-10-29T12:00:00+00:00" },
      { location_name: "locations/1", reviewer_name: "Y", star_rating: 2, comment: null, create_time: "2026-10-28T12:00:00+00:00" },
    ],
  });
  const body = await (await makeHandler(db)(get("/portfolio?days=30"))).json();
  assertEquals(body.units.map((u: { id: string }) => u.id), [U1_ID, U2_ID]);
  assertEquals(body.kpis.units, 2);
  assertEquals(body.kpis.actions.value, 2);
  assertEquals(body.kpis.profileViews.value, 0);
  assertEquals(body.kpis.avgRating.value, 4);
  assertEquals(body.reviewsAttention.map((r: { reviewerName: string }) => r.reviewerName), ["Y"]);
  for (const t of ["gbp_metrics_daily", "gbp_rating_daily", "gbp_reviews"]) {
    for (const c of callsTo(db, t)) {
      assert(hasMod(c, "eq", "conta_id", "ws-B"), t);
      assertEquals(mods(c, "in"), [], t);
    }
  }
});

Deno.test("portfolio: a client filter keeps in location_name on every history read", async () => {
  const db = createSupabaseQueryMock();
  portfolioReady(db, [CLIENTS[0]], [PU1, PU2]); // PU2 belongs to client 43: dropped in code
  const body = await (await makeHandler(db)(get("/portfolio?client=42&days=30"))).json();
  assertEquals(body.units.map((u: { id: string }) => u.id), [U1_ID]);
  for (const t of ["gbp_metrics_daily", "gbp_rating_daily", "gbp_reviews"]) {
    const calls = callsTo(db, t);
    assert(calls.length > 0, t);
    for (const c of calls) {
      assert(hasMod(c, "eq", "conta_id", "ws-B"), t);
      assert(hasMod(c, "in", "location_name", ["locations/1"]), t);
    }
  }
});

Deno.test("portfolio: per-unit prevProfileViews null when the unit has no row on prevStart", async () => {
  const db = createSupabaseQueryMock();
  portfolioReady(db);
  db.queue("gbp_metrics_daily", "select", {
    data: [
      metrics("locations/1", "2026-08-28", { business_impressions_desktop_maps: 9 }), // the day after prevStart
      metrics("locations/1", "2026-10-01", { business_impressions_desktop_maps: 3 }),
      metrics("locations/2", "2026-08-27", { business_impressions_desktop_maps: 2 }), // on prevStart
    ],
  });
  const body = await (await makeHandler(db)(get("/portfolio?days=30"))).json();
  assertEquals(body.units[0].profileViews, 3);
  assertEquals(body.units[0].prevProfileViews, null);
  assertEquals(body.units[1].prevProfileViews, 2);
  // Some unit is covered on prevStart, so the portfolio keeps its comparison.
  assertEquals(body.kpis.profileViews, { value: 3, prev: 11 });

  const db2 = createSupabaseQueryMock();
  portfolioReady(db2);
  db2.queue("gbp_metrics_daily", "select", { data: [metrics("locations/1", "2026-08-28", { call_clicks: 1 })] });
  const body2 = await (await makeHandler(db2)(get("/portfolio?days=30"))).json();
  assertEquals(body2.kpis.actions, { value: 0, prev: null });
  assertEquals(body2.kpis.profileViews.prev, null);
});

Deno.test("portfolio: avgRating uses the window-end snapshot, falls back to gbp_locations", async () => {
  const db = createSupabaseQueryMock();
  portfolioReady(db); // window [2026-09-26, 2026-10-25]
  db.queue("gbp_rating_daily", "select", {
    data: [
      { location_name: "locations/1", day: "2026-09-20", average_rating: 4.2, total_review_count: 90 },
      { location_name: "locations/1", day: "2026-10-20", average_rating: "4.0", total_review_count: 100 },
      { location_name: "locations/1", day: "2026-10-26", average_rating: 3.0, total_review_count: 200 }, // after the end
    ],
  });
  const body = await (await makeHandler(db)(get("/portfolio?days=30"))).json();
  const [u1, u2] = body.units;
  assertEquals([u1.avgRating, u1.reviewCount, u1.newReviews], [4, 100, 10]);
  assertEquals([u2.avgRating, u2.reviewCount, u2.newReviews], [5, 10, null]); // no snapshot: gbp_locations
  assertEquals(body.kpis.avgRating, { value: 4, prev: 4.2 });
  assertEquals(body.kpis.newReviews.value, 10);
  const [r] = callsTo(db, "gbp_rating_daily");
  assert(hasMod(r, "eq", "conta_id", "ws-B"));
  assert(hasMod(r, "lte", "day", "2026-10-25"));
});

Deno.test("portfolio: a stale unit is flagged and does not move the window end", async () => {
  const db = createSupabaseQueryMock();
  portfolioReady(db, CLIENTS, [PU1, { ...PU2, data_through: "2026-10-20", last_synced_at: STALE }]);
  db.queue("gbp_metrics_daily", "select", {
    data: [
      metrics("locations/1", "2026-10-27", { call_clicks: 2 }),
      metrics("locations/2", "2026-10-15", { call_clicks: 5 }),
    ],
  });
  const body = await (await makeHandler(db)(get("/portfolio?days=30"))).json();
  assertEquals(body.dataThrough, "2026-10-27");
  assertEquals(body.window.end, "2026-10-27");
  assertEquals(body.units.map((u: { stale: boolean }) => u.stale), [false, true]);
  assertEquals(body.units[1].lastSyncedAt, STALE);
  assertEquals(body.units[1].calls, 5); // still counted with what it has stored
  assertEquals(body.kpis.actions.value, 7);
});

Deno.test("portfolio: a revoked unit is counted apart and never stale", async () => {
  const db = createSupabaseQueryMock();
  portfolioReady(db, CLIENTS, [PU1, { ...PU2, status: "revoked", last_synced_at: STALE }]);
  const body = await (await makeHandler(db)(get("/portfolio"))).json();
  assertEquals(body.kpis.units, 2);
  assertEquals(body.kpis.revokedUnits, 1);
  assertEquals(body.units[1].status, "revoked");
  assertEquals(body.units[1].stale, false);
});

Deno.test("portfolio: reviewsAttention filters <=3 stars, unanswered, from SP today - N + 1, newest first", async () => {
  const db = createSupabaseQueryMock();
  portfolioReady(db);
  db.queue("gbp_reviews", "select", {
    data: [
      { location_name: "locations/2", reviewer_name: "Maria", star_rating: 1, comment: "Demorou", create_time: "2026-10-29T12:00:00+00:00" },
      { location_name: "locations/1", reviewer_name: null, star_rating: 3, comment: null, create_time: "2026-10-02T12:00:00+00:00" },
    ],
  });
  const res = await makeHandler(db)(get("/portfolio?days=30"));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).reviewsAttention, [
    {
      unitId: U2_ID,
      clientId: 43,
      unitTitle: "Clínica Sul",
      mapsUri: null,
      reviewerName: "Maria",
      starRating: 1,
      comment: "Demorou",
      createTime: "2026-10-29T12:00:00+00:00",
    },
    {
      unitId: U1_ID,
      clientId: 42,
      unitTitle: "Clínica Centro",
      mapsUri: "https://maps.google.com/?cid=1",
      reviewerName: null,
      starRating: 3,
      comment: null,
      createTime: "2026-10-02T12:00:00+00:00",
    },
  ]);
  const [r] = callsTo(db, "gbp_reviews");
  assert(hasMod(r, "eq", "conta_id", "ws-B"));
  assertEquals(mods(r, "in"), []); // whole workspace: units kept in code
  assert(hasMod(r, "lte", "star_rating", 3));
  assert(hasMod(r, "eq", "has_reply", false));
  // SP 2026-10-30 - 29 days = 2026-10-01, midnight in São Paulo (UTC-3).
  assert(hasMod(r, "gte", "create_time", "2026-10-01T03:00:00.000Z"));
  assertEquals(mods(r, "order"), [
    ["create_time", { ascending: false, nullsFirst: false }],
    ["location_name", { ascending: true }],
    ["review_id", { ascending: true }],
  ]);
  assert(mods(r, "range").length > 0);
});

Deno.test("portfolio: 100 units × 90 days paged", async () => {
  const db = createSupabaseQueryMock();
  const many = Array.from({ length: 100 }, (_, i) => ({
    ...PU1,
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    location_name: `locations/${String(i).padStart(3, "0")}`,
  }));
  portfolioReady(db, [CLIENTS[0]], many);
  // days=90 at data_through 10-27: [2026-07-30, 2026-10-27], previous from 2026-05-01: 180 days per unit.
  const days = daysFrom("2026-05-01", 180);
  const rows = many.flatMap((u) => days.map((d) => metrics(u.location_name, d, { call_clicks: 1 })));
  assertEquals(rows.length, 18000);
  db.queue("gbp_metrics_daily", "select", ...Array.from({ length: 18 }, (_, p) => ({ data: rows.slice(p * 1000, p * 1000 + 1000) })));
  const res = await makeHandler(db)(get("/portfolio?days=90"));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.units.length, 100);
  assertEquals(body.window, { start: "2026-07-30", end: "2026-10-27", prevStart: "2026-05-01", prevEnd: "2026-07-29" });
  assertEquals(body.kpis.actions, { value: 9000, prev: 9000 });
  assert(body.units.every((u: { calls: number; prevProfileViews: number | null }) => u.calls === 90 && u.prevProfileViews === 0));
  assertEquals(callsTo(db, "gbp_metrics_daily").length, 19); // 18 pages and the empty closing one
});

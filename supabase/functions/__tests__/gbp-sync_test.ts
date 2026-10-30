// _shared/gbp-sync.ts: one Google Meu Negócio location (spec §5.2, plan Task 8). The shared
// supabaseMock stands in for the database and a fake `api` (same shape as _shared/gbp-api.ts)
// for Google; every dependency a test does not expect to run throws "must not be called".
import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock, type QueryCall } from "../../../test/shared/supabaseMock.ts";
import { type GbpLocationRow, type GbpSyncDeps, syncGbpLocation } from "../_shared/gbp-sync.ts";
import * as realApi from "../_shared/gbp-api.ts";
import type { GbpDayMetrics, GbpKeywordRow, GbpLocationInfo, GbpReview, GbpReviewsPage } from "../_shared/gbp-api.ts";
import { GoogleApiError } from "../_shared/google.ts";

type Db = ReturnType<typeof createSupabaseQueryMock>;

// 15:00 UTC = 12:00 in São Paulo: today 2026-10-30, yesterday 2026-10-29.
const NOW = new Date("2026-10-30T15:00:00Z");

function location(overrides: Partial<GbpLocationRow> = {}): GbpLocationRow {
  return {
    id: "loc-1",
    conta_id: "ws-A",
    client_id: 101,
    connection_id: "conn-1",
    account_name: "accounts/1",
    location_name: "locations/9",
    title: "Loja antiga",
    has_voice_of_merchant: false,
    average_rating: 4.5,
    total_review_count: 10,
    status: "active",
    data_through: "2026-10-20",
    last_synced_at: null,
    last_sync_attempt_at: null,
    maps_uri: null,
    ...overrides,
  };
}

function zeroDay(): GbpDayMetrics {
  return {
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
  };
}

function metricsMap(entries: Record<string, Partial<GbpDayMetrics>>): Map<string, GbpDayMetrics> {
  const map = new Map<string, GbpDayMetrics>();
  for (const [day, values] of Object.entries(entries)) map.set(day, { ...zeroDay(), ...values });
  return map;
}

function review(id: string, updateTime: string, overrides: Partial<GbpReview> = {}): GbpReview {
  return {
    reviewId: id,
    reviewerName: `Pessoa ${id}`,
    starRating: 5,
    comment: "Muito bom",
    createTime: updateTime,
    updateTime,
    hasReply: false,
    ...overrides,
  };
}

function page(reviews: GbpReview[], extra: Partial<GbpReviewsPage> = {}): GbpReviewsPage {
  return { reviews, averageRating: 4.6, totalReviewCount: 12, nextPageToken: null, ...extra };
}

interface ApiLog {
  daily: Array<{ token: string; location: string; range: { start: string; end: string } }>;
  keywords: string[];
  reviews: Array<{ account: string; location: string; pageToken?: string }>;
  location: number;
}

function fakeApi(overrides: Partial<GbpSyncDeps["api"]> = {}) {
  const log: ApiLog = { daily: [], keywords: [], reviews: [], location: 0 };
  const api: GbpSyncDeps["api"] = {
    ...realApi,
    fetchDailyMetrics: async (token, loc, range) => {
      log.daily.push({ token, location: loc, range });
      return new Map();
    },
    fetchMonthlyKeywords: async (_token, _loc, month): Promise<GbpKeywordRow[]> => {
      log.keywords.push(month);
      return [];
    },
    listReviews: async (_token, account, loc, opts = {}) => {
      log.reviews.push({ account, location: loc, pageToken: opts.pageToken });
      return page([]);
    },
    getLocation: async (): Promise<GbpLocationInfo> => {
      log.location += 1;
      return { title: "Loja nova", hasVoiceOfMerchant: true, mapsUri: "https://maps.google.com/?cid=9" };
    },
    ...overrides,
  };
  return { api, log };
}

/** Every guarded `gbp_locations` update answers "one row matched" (the unit is still active). */
function activeGuards(db: Db, n = 40) {
  db.queue("gbp_locations", "update", ...Array.from({ length: n }, () => ({ data: [{ id: "loc-1" }] })));
}

function deps(db: Db, api: GbpSyncDeps["api"], overrides: Partial<GbpSyncDeps> = {}) {
  const sleeps: number[] = [];
  const tokenCalls: string[] = [];
  const d: GbpSyncDeps = {
    svc: db as never,
    api,
    getFreshGoogleToken: async (_svc, connectionId) => {
      tokenCalls.push(connectionId);
      return "tok-live";
    },
    now: () => NOW,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...overrides,
  };
  return { deps: d, sleeps, tokenCalls };
}

const writeOps = new Set(["insert", "update", "upsert", "delete"]);
const writes = (db: Db) => db.calls.filter((c) => writeOps.has(c.operation));
const upsertsOf = (db: Db, table: string) => db.calls.filter((c) => c.table === table && c.operation === "upsert");
const locationUpdates = (db: Db) => db.calls.filter((c) => c.table === "gbp_locations" && c.operation === "update");
const eqArg = (call: QueryCall, column: string) => call.modifiers.find((m) => m.method === "eq" && m.args[0] === column)?.args[1];

// ── Step 1: daily metrics ───────────────────────────────────────────────────────

Deno.test("gbp-sync: omitted days are written as zeros and nothing after data_through is written (RF4)", async () => {
  const db = createSupabaseQueryMock();
  activeGuards(db);
  const { api, log } = fakeApi({
    fetchDailyMetrics: async (_t, _l, range) => {
      log.daily.push({ token: _t, location: _l, range });
      // Sparse on purpose: 2026-10-14 is missing entirely; the latest day with data is 10-27.
      return metricsMap({
        "2026-10-13": { call_clicks: 1 },
        "2026-10-20": { website_clicks: 4 },
        "2026-10-27": { business_impressions_mobile_maps: 9 },
      });
    },
  });
  const { deps: d } = deps(db, api);

  const out = await syncGbpLocation(d, location(), { now: NOW });
  assertEquals(out, { status: "synced", backfill: false });

  // Rewrite window: [data_through - 7, yesterday].
  assertEquals(log.daily, [{ token: "tok-live", location: "locations/9", range: { start: "2026-10-13", end: "2026-10-29" } }]);

  const [metricsUpsert] = upsertsOf(db, "gbp_metrics_daily");
  const rows = metricsUpsert.payload as Array<Record<string, unknown>>;
  // computed = 10-27 - 2 = 10-25 → days 10-13 .. 10-25, nothing later.
  assertEquals(rows.map((r) => r.day), [
    "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19",
    "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25",
  ]);
  const omitted = rows.find((r) => r.day === "2026-10-14")!;
  for (const key of Object.keys(zeroDay())) assertEquals(omitted[key], 0, `omitted day ${key}`);
  assertEquals(rows.find((r) => r.day === "2026-10-20")!.website_clicks, 4);
  assertEquals(metricsUpsert.options, { onConflict: "conta_id,location_name,day" });

  const throughUpdate = locationUpdates(db).find((c) => (c.payload as Record<string, unknown>).data_through !== undefined);
  assertEquals((throughUpdate!.payload as Record<string, unknown>).data_through, "2026-10-25");
});

Deno.test("gbp-sync: the history upsert lands before data_through advances", async () => {
  const db = createSupabaseQueryMock();
  activeGuards(db);
  const { api } = fakeApi({
    fetchDailyMetrics: async () => metricsMap({ "2026-10-27": { call_clicks: 2 } }),
  });
  await syncGbpLocation(deps(db, api).deps, location(), { now: NOW });

  const upsertIdx = db.calls.findIndex((c) => c.table === "gbp_metrics_daily" && c.operation === "upsert");
  const throughIdx = db.calls.findIndex(
    (c) => c.table === "gbp_locations" && c.operation === "update" && (c.payload as Record<string, unknown>).data_through,
  );
  const guardIdx = db.calls.findIndex((c) => c.table === "gbp_locations" && c.operation === "update");
  assert(guardIdx < upsertIdx, "a guarded unit update must precede the history write");
  assert(upsertIdx < throughIdx, "data_through advances only after its rows are stored");
});

Deno.test("gbp-sync: a dormant location (no dated values) advances data_through to yesterday - 2 (I4)", async () => {
  const db = createSupabaseQueryMock();
  activeGuards(db);
  const { api } = fakeApi({ fetchDailyMetrics: async () => new Map() });
  await syncGbpLocation(deps(db, api).deps, location({ data_through: "2026-10-20" }), { now: NOW });

  const rows = upsertsOf(db, "gbp_metrics_daily")[0].payload as Array<Record<string, unknown>>;
  assertEquals(rows[rows.length - 1].day, "2026-10-27");
  assert(rows.every((r) => r.call_clicks === 0));
  const through = locationUpdates(db).map((c) => (c.payload as Record<string, unknown>).data_through).filter(Boolean);
  assertEquals(through, ["2026-10-27"]);
});

Deno.test("gbp-sync: data_through never moves backwards when the latest data is older than the stored value (I4)", async () => {
  const db = createSupabaseQueryMock();
  activeGuards(db);
  const { api } = fakeApi({
    // Latest day with any metric is 10-20 → computed 10-18, below the stored 10-27.
    fetchDailyMetrics: async () => metricsMap({ "2026-10-20": { call_clicks: 1 } }),
  });
  await syncGbpLocation(deps(db, api).deps, location({ data_through: "2026-10-27" }), { now: NOW });

  const rows = upsertsOf(db, "gbp_metrics_daily")[0].payload as Array<Record<string, unknown>>;
  assertEquals(rows[0].day, "2026-10-20");
  assertEquals(rows[rows.length - 1].day, "2026-10-27");
  const through = locationUpdates(db).map((c) => (c.payload as Record<string, unknown>).data_through).filter(Boolean);
  assertEquals(through, ["2026-10-27"]);
});

Deno.test("gbp-sync: backfill falls back from 548 to 365 days on a 400 'range not allowed'", async () => {
  const db = createSupabaseQueryMock();
  activeGuards(db);
  const ranges: Array<{ start: string; end: string }> = [];
  const { api, log } = fakeApi({
    fetchDailyMetrics: async (_t, _l, range) => {
      ranges.push(range);
      if (ranges.length === 1) throw new GoogleApiError("UPSTREAM", 400, "Invalid date range", false);
      return metricsMap({ "2026-10-27": { call_clicks: 1 } });
    },
  });
  const out = await syncGbpLocation(deps(db, api).deps, location({ data_through: null }), { now: NOW });

  assertEquals(out, { status: "synced", backfill: true });
  assertEquals(ranges, [
    { start: "2025-04-30", end: "2026-10-29" },
    { start: "2025-10-30", end: "2026-10-29" },
  ]);
  const rows = upsertsOf(db, "gbp_metrics_daily").flatMap((c) => c.payload as Array<Record<string, unknown>>);
  assertEquals(rows[0].day, "2025-10-30");
  assertEquals(rows[rows.length - 1].day, "2026-10-25");
  // Backfill keywords: the 18 closed months, newest first.
  assertEquals(log.keywords.length, 18);
  assertEquals(log.keywords[0], "2026-09");
  assertEquals(log.keywords[17], "2025-04");
});

Deno.test("gbp-sync: a 400 outside a backfill is a failure, not a fallback", async () => {
  const db = createSupabaseQueryMock();
  activeGuards(db);
  const { api } = fakeApi({
    fetchDailyMetrics: async () => {
      throw new GoogleApiError("UPSTREAM", 400, "bad", false);
    },
  });
  let threw = false;
  try {
    await syncGbpLocation(deps(db, api).deps, location(), { now: NOW });
  } catch (err) {
    threw = err instanceof GoogleApiError && err.status === 400;
  }
  assert(threw, "expected the 400 to propagate");
  assertEquals(writes(db).length, 0);
});

// ── Step 2: keywords ────────────────────────────────────────────────────────────

Deno.test("gbp-sync: keywords refresh the last 2 closed months with one single-month call each (I9)", async () => {
  const db = createSupabaseQueryMock();
  activeGuards(db);
  const urls: string[] = [];
  const recordingFetch = (url: string) => {
    urls.push(url);
    const month = new URL(url).searchParams.get("monthlyRange.start_month.month");
    return Promise.resolve({
      searchKeywordsCounts: month === "9"
        ? [
          { searchKeyword: "padaria", insightsValue: { value: "120" } },
          { searchKeyword: "pão de queijo", insightsValue: { threshold: "15" } },
        ]
        : [],
    });
  };
  const { api } = fakeApi({
    fetchMonthlyKeywords: (token, loc, month) => realApi.fetchMonthlyKeywords(token, loc, month, recordingFetch),
  });
  await syncGbpLocation(deps(db, api).deps, location(), { now: NOW });

  assertEquals(urls.length, 2);
  const months = urls.map((u) => {
    const p = new URL(u).searchParams;
    assertEquals(p.get("monthlyRange.start_month.year"), p.get("monthlyRange.end_month.year"));
    assertEquals(p.get("monthlyRange.start_month.month"), p.get("monthlyRange.end_month.month"));
    return `${p.get("monthlyRange.start_month.year")}-${p.get("monthlyRange.start_month.month")}`;
  });
  assertEquals(months, ["2026-9", "2026-8"]);

  const kw = upsertsOf(db, "gbp_search_keywords_monthly");
  assertEquals(kw.length, 1, "an empty month writes nothing");
  assertEquals(kw[0].payload, [
    { conta_id: "ws-A", location_name: "locations/9", month: "2026-09-01", keyword: "padaria", value: 120, threshold: null },
    { conta_id: "ws-A", location_name: "locations/9", month: "2026-09-01", keyword: "pão de queijo", value: null, threshold: 15 },
  ]);
  assertEquals(kw[0].options, { onConflict: "conta_id,location_name,month,keyword" });
});

Deno.test("gbp-sync: a backfill stops the keyword months at the first 400 and keeps going", async () => {
  const db = createSupabaseQueryMock();
  activeGuards(db);
  const asked: string[] = [];
  const { api, log } = fakeApi({
    fetchDailyMetrics: async () => new Map(),
    fetchMonthlyKeywords: async (_t, _l, month) => {
      asked.push(month);
      if (month === "2025-06") throw new GoogleApiError("UPSTREAM", 400, "too old", false);
      return [{ month, keyword: "padaria", value: 1 }];
    },
  });
  const out = await syncGbpLocation(deps(db, api).deps, location({ data_through: null }), { now: NOW });

  assertEquals(out.status, "synced");
  assertEquals(asked[asked.length - 1], "2025-06");
  assertEquals(asked.length, 16);
  assertEquals(upsertsOf(db, "gbp_search_keywords_monthly").length, 15);
  assertEquals(log.location, 1, "the later steps still run");
});

// ── Step 3: reviews ─────────────────────────────────────────────────────────────

Deno.test("gbp-sync: the review walk stops at a known review whose update_time is unchanged", async () => {
  const db = createSupabaseQueryMock();
  activeGuards(db);
  db.queue("gbp_reviews", "select", {
    data: [
      { review_id: "r-edited", update_time: "2026-10-01T10:00:00+00:00" },
      { review_id: "r-known", update_time: "2026-09-01T10:00:00+00:00" },
    ],
  });
  const { api, log } = fakeApi({
    listReviews: async (_t, account, loc, opts = {}) => {
      log.reviews.push({ account, location: loc, pageToken: opts.pageToken });
      return page(
        [
          review("r-new", "2026-10-28T10:00:00.123Z"),
          review("r-edited", "2026-10-27T10:00:00Z"),
          review("r-known", "2026-09-01T10:00:00Z"),
          review("r-older", "2026-08-01T10:00:00Z"),
        ],
        { nextPageToken: "page-2" },
      );
    },
  });
  await syncGbpLocation(deps(db, api).deps, location(), { now: NOW });

  assertEquals(log.reviews, [{ account: "accounts/1", location: "locations/9", pageToken: undefined }]);
  const upserted = upsertsOf(db, "gbp_reviews")[0].payload as Array<Record<string, unknown>>;
  assertEquals(upserted.map((r) => r.review_id), ["r-new", "r-edited"]);
  assertEquals(upserted[0], {
    conta_id: "ws-A",
    location_name: "locations/9",
    review_id: "r-new",
    reviewer_name: "Pessoa r-new",
    star_rating: 5,
    comment: "Muito bom",
    create_time: "2026-10-28T10:00:00.123Z",
    update_time: "2026-10-28T10:00:00.123Z",
    has_reply: false,
  });
  assertEquals(upsertsOf(db, "gbp_reviews")[0].options, { onConflict: "conta_id,location_name,review_id" });
});

Deno.test("gbp-sync: the review walk follows nextPageToken until a known review appears", async () => {
  const db = createSupabaseQueryMock();
  activeGuards(db);
  db.queue("gbp_reviews", "select", { data: [{ review_id: "r-known", update_time: "2026-09-01T10:00:00Z" }] });
  const pages = [
    page([review("r-1", "2026-10-28T10:00:00Z")], { nextPageToken: "p2" }),
    page([review("r-2", "2026-10-20T10:00:00Z"), review("r-known", "2026-09-01T10:00:00Z")], { nextPageToken: "p3" }),
  ];
  const { api, log } = fakeApi({
    listReviews: async (_t, account, loc, opts = {}) => {
      log.reviews.push({ account, location: loc, pageToken: opts.pageToken });
      return pages.shift()!;
    },
  });
  await syncGbpLocation(deps(db, api).deps, location(), { now: NOW });

  assertEquals(log.reviews.map((r) => r.pageToken), [undefined, "p2"]);
  const upserted = upsertsOf(db, "gbp_reviews")[0].payload as Array<Record<string, unknown>>;
  assertEquals(upserted.map((r) => r.review_id), ["r-1", "r-2"]);
});

Deno.test("gbp-sync: rows beyond the newest 200 reviews are pruned", async () => {
  const db = createSupabaseQueryMock();
  activeGuards(db);
  // 200 stored reviews, r-000 newest … r-199 oldest.
  const stored = Array.from({ length: 200 }, (_, i) => ({
    review_id: `r-${String(i).padStart(3, "0")}`,
    update_time: new Date(Date.UTC(2026, 8, 1) - i * 3600_000).toISOString(),
  }));
  db.queue("gbp_reviews", "select", { data: stored });
  const { api } = fakeApi({
    listReviews: async () =>
      page([
        review("n-1", "2026-10-28T10:00:00Z"),
        review("n-2", "2026-10-27T10:00:00Z"),
        review("n-3", "2026-10-26T10:00:00Z"),
        review("r-000", stored[0].update_time),
      ]),
  });
  await syncGbpLocation(deps(db, api).deps, location(), { now: NOW });

  const prune = db.calls.find((c) => c.table === "gbp_reviews" && c.operation === "delete");
  assert(prune, "expected a prune delete");
  assertEquals(eqArg(prune!, "conta_id"), "ws-A");
  assertEquals(eqArg(prune!, "location_name"), "locations/9");
  const inMod = prune!.modifiers.find((m) => m.method === "in");
  assertEquals(inMod!.args, ["review_id", ["r-197", "r-198", "r-199"]]);
});

Deno.test("gbp-sync: no prune when 200 or fewer reviews are stored", async () => {
  const db = createSupabaseQueryMock();
  activeGuards(db);
  db.queue("gbp_reviews", "select", { data: [] });
  const { api } = fakeApi({ listReviews: async () => page([review("n-1", "2026-10-28T10:00:00Z")]) });
  await syncGbpLocation(deps(db, api).deps, location(), { now: NOW });
  assertEquals(db.calls.filter((c) => c.table === "gbp_reviews" && c.operation === "delete").length, 0);
});

Deno.test("gbp-sync: today's rating row and the cached totals come from the reviews response", async () => {
  const db = createSupabaseQueryMock();
  activeGuards(db);
  const { api } = fakeApi({
    listReviews: async () => page([], { averageRating: 4.66, totalReviewCount: 37 }),
  });
  await syncGbpLocation(deps(db, api).deps, location(), { now: NOW });

  const rating = upsertsOf(db, "gbp_rating_daily");
  assertEquals(rating.length, 1);
  assertEquals(rating[0].payload, {
    conta_id: "ws-A",
    location_name: "locations/9",
    day: "2026-10-30",
    average_rating: 4.7,
    total_review_count: 37,
  });
  assertEquals(rating[0].options, { onConflict: "conta_id,location_name,day" });
  const cache = locationUpdates(db).find((c) => (c.payload as Record<string, unknown>).total_review_count !== undefined);
  assertEquals(cache!.payload, { average_rating: 4.7, total_review_count: 37 });
  assertEquals(upsertsOf(db, "gbp_reviews").length, 0, "no reviews, no review upsert");
});

// ── Steps 4 and 5: location refresh and finish ─────────────────────────────────

Deno.test("gbp-sync: the location refresh writes title, voice of merchant, maps link and last_synced_at", async () => {
  const db = createSupabaseQueryMock();
  activeGuards(db);
  const { api } = fakeApi();
  await syncGbpLocation(deps(db, api).deps, location(), { now: NOW });

  const updates = locationUpdates(db);
  const last = updates[updates.length - 1];
  assertEquals(last.payload, {
    title: "Loja nova",
    has_voice_of_merchant: true,
    maps_uri: "https://maps.google.com/?cid=9",
    last_synced_at: NOW.toISOString(),
  });
  assertEquals(eqArg(last, "id"), "loc-1");
  assertEquals(eqArg(last, "status"), "active");
});

Deno.test("gbp-sync: a location deleted at Google (404) is skipped, not failed", async () => {
  const db = createSupabaseQueryMock();
  activeGuards(db);
  const { api } = fakeApi({
    getLocation: async () => {
      throw new GoogleApiError("NOT_FOUND", 404, "not found", false);
    },
  });
  const out = await syncGbpLocation(deps(db, api).deps, location(), { now: NOW });
  assertEquals(out.status, "skipped");
  assert(!locationUpdates(db).some((c) => (c.payload as Record<string, unknown>).last_synced_at));
});

// ── Outcomes ────────────────────────────────────────────────────────────────────

Deno.test("gbp-sync: NOT_APPROVED returns not_approved with no writes (RF1)", async () => {
  const db = createSupabaseQueryMock();
  activeGuards(db);
  const { api } = fakeApi({
    fetchDailyMetrics: async () => {
      throw new GoogleApiError("NOT_APPROVED", 403, "quota 0", false);
    },
  });
  const out = await syncGbpLocation(deps(db, api).deps, location(), { now: NOW });
  assertEquals(out, { status: "not_approved", backfill: false });
  assertEquals(writes(db).length, 0);
});

Deno.test("gbp-sync: QUOTA_EXCEEDED keeps what was written and returns quota_skipped without last_synced_at", async () => {
  const db = createSupabaseQueryMock();
  activeGuards(db);
  const { api } = fakeApi({
    fetchDailyMetrics: async () => metricsMap({ "2026-10-27": { call_clicks: 1 } }),
    fetchMonthlyKeywords: async () => {
      throw new GoogleApiError("QUOTA_EXCEEDED", 429, "per-minute", false);
    },
    listReviews: async () => {
      throw new Error("must not be called");
    },
  });
  const out = await syncGbpLocation(deps(db, api).deps, location(), { now: NOW });
  assertEquals(out.status, "quota_skipped");
  assertEquals(upsertsOf(db, "gbp_metrics_daily").length, 1);
  assert(!locationUpdates(db).some((c) => (c.payload as Record<string, unknown>).last_synced_at));
});

Deno.test("gbp-sync: RATE_LIMITED retries after 1 s, 2 s and 4 s, then succeeds", async () => {
  const db = createSupabaseQueryMock();
  activeGuards(db);
  let attempts = 0;
  const { api } = fakeApi({
    fetchDailyMetrics: async () => {
      attempts++;
      if (attempts <= 3) throw new GoogleApiError("RATE_LIMITED", 429, "slow down");
      return new Map();
    },
  });
  const { deps: d, sleeps } = deps(db, api);
  const out = await syncGbpLocation(d, location(), { now: NOW });
  assertEquals(out.status, "synced");
  assertEquals(sleeps, [1000, 2000, 4000]);
});

Deno.test("gbp-sync: RATE_LIMITED a fourth time throws", async () => {
  const db = createSupabaseQueryMock();
  activeGuards(db);
  const { api } = fakeApi({
    fetchDailyMetrics: async () => {
      throw new GoogleApiError("RATE_LIMITED", 429, "slow down");
    },
  });
  const { deps: d, sleeps } = deps(db, api);
  let code = "";
  try {
    await syncGbpLocation(d, location(), { now: NOW });
  } catch (err) {
    code = (err as GoogleApiError).code;
  }
  assertEquals(code, "RATE_LIMITED");
  assertEquals(sleeps, [1000, 2000, 4000]);
  assertEquals(writes(db).length, 0);
});

Deno.test("gbp-sync: token REVOKED is revoked, TOKEN_INVALID and NOT_FOUND are skipped, with no API call", async () => {
  for (const [code, expected] of [["REVOKED", "revoked"], ["TOKEN_INVALID", "skipped"], ["NOT_FOUND", "skipped"]] as const) {
    const db = createSupabaseQueryMock();
    const { api, log } = fakeApi();
    const { deps: d } = deps(db, api, {
      getFreshGoogleToken: async () => {
        throw new GoogleApiError(code, 401, code, false);
      },
    });
    const out = await syncGbpLocation(d, location(), { now: NOW });
    assertEquals(out.status, expected, code);
    assertEquals(log.daily.length, 0);
    assertEquals(writes(db).length, 0);
  }
});

Deno.test("gbp-sync: a location without a connection is skipped before any token call", async () => {
  const db = createSupabaseQueryMock();
  const { api } = fakeApi();
  const { deps: d, tokenCalls } = deps(db, api);
  const out = await syncGbpLocation(d, location({ connection_id: null }), { now: NOW });
  assertEquals(out.status, "skipped");
  assertEquals(tokenCalls.length, 0);
});

Deno.test("gbp-sync: a unit revoked mid-run (guard matches 0 rows) stops with revoked and writes no history (C2)", async () => {
  const db = createSupabaseQueryMock();
  db.queue("gbp_locations", "update", { data: [] });
  const { api } = fakeApi({ fetchDailyMetrics: async () => metricsMap({ "2026-10-27": { call_clicks: 1 } }) });
  const out = await syncGbpLocation(deps(db, api).deps, location(), { now: NOW });
  assertEquals(out.status, "revoked");
  const historyWrites = writes(db).filter((c) => c.table !== "gbp_locations");
  assertEquals(historyWrites.length, 0);
  assertEquals(locationUpdates(db).length, 1);
});

Deno.test("gbp-sync: a guard that matches 0 rows before the review write stops the run", async () => {
  const db = createSupabaseQueryMock();
  // Step 1: guard + data_through; step 2: no keyword rows; step 3: the cache guard misses.
  db.queue("gbp_locations", "update", { data: [{ id: "loc-1" }] }, { data: [{ id: "loc-1" }] }, { data: [] });
  const { api } = fakeApi({
    listReviews: async () => page([review("n-1", "2026-10-28T10:00:00Z")]),
    getLocation: async () => {
      throw new Error("must not be called");
    },
  });
  const out = await syncGbpLocation(deps(db, api).deps, location(), { now: NOW });
  assertEquals(out.status, "revoked");
  assertEquals(upsertsOf(db, "gbp_reviews").length, 0);
  assertEquals(upsertsOf(db, "gbp_rating_daily").length, 0);
});

// ── Tenant keys (Review Focus 3) ────────────────────────────────────────────────

Deno.test("gbp-sync: every gbp_* history read, write and delete carries the location's conta_id (RF3)", async () => {
  const db = createSupabaseQueryMock();
  activeGuards(db);
  const stored = Array.from({ length: 201 }, (_, i) => ({
    review_id: `r-${i}`,
    update_time: new Date(Date.UTC(2026, 8, 1) - i * 3600_000).toISOString(),
  }));
  db.queue("gbp_reviews", "select", { data: stored });
  const { api } = fakeApi({
    fetchDailyMetrics: async () => metricsMap({ "2026-10-27": { call_clicks: 1 } }),
    fetchMonthlyKeywords: async (_t, _l, month) => [{ month, keyword: "padaria", value: 3 }],
    listReviews: async () => page([review("n-1", "2026-10-28T10:00:00Z")]),
  });
  await syncGbpLocation(deps(db, api).deps, location({ conta_id: "ws-B" }), { now: NOW });

  const history = db.calls.filter((c) => c.table.startsWith("gbp_") && c.table !== "gbp_locations");
  const tables = new Set(history.map((c) => c.table));
  for (const t of ["gbp_metrics_daily", "gbp_search_keywords_monthly", "gbp_reviews", "gbp_rating_daily"]) {
    assert(tables.has(t), `expected a ${t} call`);
  }
  for (const call of history) {
    if (call.operation === "upsert") {
      const rows = Array.isArray(call.payload) ? call.payload : [call.payload];
      for (const row of rows as Array<Record<string, unknown>>) {
        assertEquals(row.conta_id, "ws-B", `${call.table} upsert row`);
        assertEquals(row.location_name, "locations/9", `${call.table} upsert row`);
      }
    } else {
      assertEquals(eqArg(call, "conta_id"), "ws-B", `${call.table} ${call.operation}`);
      assertEquals(eqArg(call, "location_name"), "locations/9", `${call.table} ${call.operation}`);
    }
  }
  for (const call of locationUpdates(db)) {
    assertEquals(eqArg(call, "id"), "loc-1");
    assertEquals(eqArg(call, "conta_id"), "ws-B");
    assertEquals(eqArg(call, "status"), "active");
  }
});

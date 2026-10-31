import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  aggregateKeywords,
  computeGbpKpis,
  dailySeries,
  emptyGbpKpis,
  GBP_KPI_IDS,
  type GbpMetricsRow,
  type GbpRatingRow,
  ratingDistribution,
  surfaceBreakdown,
  sumMetrics,
} from "./kpis.ts";

const W = { start: "2026-10-21", end: "2026-10-25", prevStart: "2026-10-16", prevEnd: "2026-10-20" };

function metrics(location_name: string, day: string, over: Partial<GbpMetricsRow> = {}): GbpMetricsRow {
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

const rating = (location_name: string, day: string, average_rating: number | null, total_review_count: number | null): GbpRatingRow => ({
  location_name,
  day,
  average_rating,
  total_review_count,
});

Deno.test("emptyGbpKpis has every KPI id as { value: null, prev: null }", () => {
  const k = emptyGbpKpis();
  assertEquals(Object.keys(k), [...GBP_KPI_IDS]);
  for (const id of GBP_KPI_IDS) assertEquals(k[id], { value: null, prev: null });
});

Deno.test("profile_views sums the four impression surfaces over the window", () => {
  const rows = [
    metrics("L1", "2026-10-21", {
      business_impressions_desktop_maps: 1,
      business_impressions_desktop_search: 2,
      business_impressions_mobile_maps: 3,
      business_impressions_mobile_search: 4,
    }),
    metrics("L2", "2026-10-25", { business_impressions_mobile_search: 10 }),
    // Previous window.
    metrics("L1", "2026-10-16", { business_impressions_desktop_maps: 5 }),
    // Outside both windows: never counted.
    metrics("L1", "2026-10-26", { business_impressions_desktop_maps: 1000 }),
  ];
  const k = computeGbpKpis({ metrics: rows, ratings: [], locationNames: ["L1", "L2"], window: W, prevCovered: true });
  assertEquals(k.profile_views, { value: 20, prev: 5 });
});

Deno.test("action KPIs sum their own metric; the food-menu column feeds none of them", () => {
  const rows = [
    metrics("L1", "2026-10-22", {
      call_clicks: 3,
      business_direction_requests: 4,
      website_clicks: 5,
      messaging_clicks: 6,
      business_bookings: 7,
      business_food_menu_clicks: 99,
    }),
    metrics("L1", "2026-10-23", { call_clicks: 1 }),
    metrics("L1", "2026-10-17", { call_clicks: 2, website_clicks: 9 }),
  ];
  const k = computeGbpKpis({ metrics: rows, ratings: [], locationNames: ["L1"], window: W, prevCovered: true });
  assertEquals(k.calls, { value: 4, prev: 2 });
  assertEquals(k.directions, { value: 4, prev: 0 });
  assertEquals(k.website_clicks, { value: 5, prev: 9 });
  assertEquals(k.messages, { value: 6, prev: 0 });
  assertEquals(k.bookings, { value: 7, prev: 0 });
});

Deno.test("a previous window the data only partly covers has no comparison: action prev is null", () => {
  // The unit's data starts on 2026-10-18, inside the previous window [2026-10-16, 2026-10-20].
  const rows = [metrics("L1", "2026-10-18", { call_clicks: 2 }), metrics("L1", "2026-10-22", { call_clicks: 3 })];
  const ratings = [rating("L1", "2026-10-10", 4.0, 10), rating("L1", "2026-10-20", 4.0, 14), rating("L1", "2026-10-25", 4.0, 20)];
  const k = computeGbpKpis({ metrics: rows, ratings, locationNames: ["L1"], window: W, prevCovered: false });
  assertEquals(k.calls, { value: 3, prev: null });
  assertEquals(k.profile_views, { value: 0, prev: null });
  // Rating cards read point-in-time snapshots, not window sums: unaffected.
  assertEquals(k.avg_rating, { value: 4.0, prev: 4.0 });
  assertEquals(k.new_reviews, { value: 6, prev: 4 });
});

Deno.test("avg_rating is weighted by review count across units", () => {
  const ratings = [
    rating("L1", "2026-10-20", 4.0, 100),
    rating("L2", "2026-10-19", 5.0, 100),
    // The latest row on or before the window end wins.
    rating("L1", "2026-10-24", 4.0, 300),
    rating("L2", "2026-10-25", 5.0, 100),
    // After the window end: ignored.
    rating("L1", "2026-10-26", 1.0, 999),
  ];
  const k = computeGbpKpis({ metrics: [], ratings, locationNames: ["L1", "L2"], window: W, prevCovered: true });
  // (4.0 * 300 + 5.0 * 100) / 400 = 4.25; prev (before the window start) = (4 * 100 + 5 * 100) / 200 = 4.5.
  assertEquals(k.avg_rating, { value: 4.25, prev: 4.5 });
  // Δ total_review_count: (300 + 100) - (100 + 100).
  assertEquals(k.new_reviews.value, 200);
});

Deno.test("avg_rating with no rating row before the window start gives prev null", () => {
  const ratings = [rating("L1", "2026-10-21", 4.5, 40), rating("L1", "2026-10-25", 4.6, 44)];
  const k = computeGbpKpis({ metrics: [], ratings, locationNames: ["L1"], window: W, prevCovered: true });
  assertEquals(k.avg_rating, { value: 4.6, prev: null });
  assertEquals(k.new_reviews, { value: null, prev: null });
});

Deno.test("new_reviews: Δ against the row before the window start; prev uses the window before that", () => {
  const ratings = [
    rating("L1", "2026-10-10", 4.0, 10), // on or before prevStart - 1 (2026-10-15)
    rating("L1", "2026-10-20", 4.0, 14), // on or before prevEnd
    rating("L1", "2026-10-25", 4.0, 20), // on or before end
  ];
  const k = computeGbpKpis({ metrics: [], ratings, locationNames: ["L1"], window: W, prevCovered: true });
  assertEquals(k.new_reviews, { value: 6, prev: 4 });
});

Deno.test("new_reviews sums the units that have both rows; a unit without a baseline is left out", () => {
  const ratings = [
    rating("L1", "2026-10-20", 4.0, 14),
    rating("L1", "2026-10-25", 4.0, 20),
    rating("L2", "2026-10-25", 5.0, 3), // linked inside the window: no row before the start
  ];
  const k = computeGbpKpis({ metrics: [], ratings, locationNames: ["L1", "L2"], window: W, prevCovered: true });
  assertEquals(k.new_reviews.value, 6);
  // The rating still averages both units at the window end.
  assertEquals(k.avg_rating.value, (4.0 * 20 + 5.0 * 3) / 23);
});

Deno.test("new_reviews is null only when no selected unit has both rows", () => {
  const ratings = [rating("L1", "2026-10-25", 4.0, 20), rating("L2", "2026-10-24", 5.0, 3)];
  const k = computeGbpKpis({ metrics: [], ratings, locationNames: ["L1", "L2"], window: W, prevCovered: true });
  assertEquals(k.new_reviews, { value: null, prev: null });
});

Deno.test("avg_rating is null when no unit has a rating row by the window end", () => {
  const k = computeGbpKpis({ metrics: [], ratings: [], locationNames: ["L1"], window: W, prevCovered: true });
  assertEquals(k.avg_rating, { value: null, prev: null });
});

Deno.test("sumMetrics with no rows is all zeros (sparse data, not 'sem dados')", () => {
  const t = sumMetrics([], W.start, W.end);
  assertEquals(t.profileViews, 0);
  assertEquals(t.calls, 0);
  assertEquals(t.surfaces, { desktop_maps: 0, desktop_search: 0, mobile_maps: 0, mobile_search: 0 });
});

Deno.test("dailySeries fills every window day, summing units, zero where the API left the day out", () => {
  const rows = [
    metrics("L1", "2026-10-21", { call_clicks: 1, business_impressions_mobile_maps: 2 }),
    metrics("L2", "2026-10-21", { call_clicks: 2, business_impressions_desktop_search: 3 }),
    metrics("L1", "2026-10-23", { website_clicks: 4 }),
    metrics("L1", "2026-10-26", { call_clicks: 50 }),
  ];
  const s = dailySeries(rows, W.start, W.end);
  assertEquals(s.map((p) => p.date), ["2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
  assertEquals(s[0], {
    date: "2026-10-21",
    profileViews: 5,
    calls: 3,
    directions: 0,
    websiteClicks: 0,
    messages: 0,
    bookings: 0,
  });
  assertEquals(s[1].calls, 0);
  assertEquals(s[2].websiteClicks, 4);
});

Deno.test("surfaceBreakdown gives each surface with its share; zero total is 0%, never NaN", () => {
  const t = sumMetrics(
    [metrics("L1", "2026-10-21", {
      business_impressions_desktop_maps: 1,
      business_impressions_desktop_search: 1,
      business_impressions_mobile_maps: 1,
      business_impressions_mobile_search: 0,
    })],
    W.start,
    W.end,
  );
  assertEquals(surfaceBreakdown(t), [
    { surface: "desktop_maps", value: 1, pct: 33.3 },
    { surface: "desktop_search", value: 1, pct: 33.3 },
    { surface: "mobile_maps", value: 1, pct: 33.3 },
    { surface: "mobile_search", value: 0, pct: 0 },
  ]);
  assertEquals(surfaceBreakdown(sumMetrics([], W.start, W.end)).map((r) => r.pct), [0, 0, 0, 0]);
});

Deno.test("ratingDistribution: partial when only 200 of 440 reviews are stored", () => {
  const stars = [
    ...Array.from({ length: 120 }, () => ({ location_name: "L1", star_rating: 5 })),
    ...Array.from({ length: 50 }, () => ({ location_name: "L1", star_rating: 4 })),
    ...Array.from({ length: 30 }, () => ({ location_name: "L1", star_rating: 1 })),
  ];
  assertEquals(ratingDistribution(stars, [{ location_name: "L1", total_review_count: 440 }]), {
    counts: { "1": 30, "2": 0, "3": 0, "4": 50, "5": 120 },
    storedTotal: 200,
    total: 440,
    partial: true,
  });
});

Deno.test("ratingDistribution: complete set is not partial; a unit without a count uses its stored reviews", () => {
  const stars = [{ location_name: "L1", star_rating: 3 }, { location_name: "L2", star_rating: 2 }];
  assertEquals(
    ratingDistribution(stars, [{ location_name: "L1", total_review_count: 1 }, { location_name: "L2", total_review_count: null }]),
    { counts: { "1": 0, "2": 1, "3": 1, "4": 0, "5": 0 }, storedTotal: 2, total: 2, partial: false },
  );
});

Deno.test("aggregateKeywords sums exact values across units; any threshold makes the row a 'menos de' bound", () => {
  const rows = [
    { location_name: "L1", keyword: "dentista", value: 40, threshold: null },
    { location_name: "L2", keyword: "dentista", value: 10, threshold: null },
    { location_name: "L1", keyword: "clareamento", value: 12, threshold: null },
    { location_name: "L2", keyword: "clareamento", value: null, threshold: 15 },
    { location_name: "L1", keyword: "implante", value: null, threshold: 15 },
    { location_name: "L1", keyword: "aparelho", value: 27, threshold: null },
  ];
  assertEquals(aggregateKeywords(rows), [
    { keyword: "dentista", value: 50, threshold: null },
    // An exact 27 ranks above "menos de 27".
    { keyword: "aparelho", value: 27, threshold: null },
    { keyword: "clareamento", value: null, threshold: 27 },
    { keyword: "implante", value: null, threshold: 15 },
  ]);
});

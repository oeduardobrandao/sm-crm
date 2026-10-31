// _shared/gbp-api.ts: Business Profile Performance / v4 reviews / Business Information client.
// A fake `fetchJson` captures URLs and replays documented response shapes (no network).
import { assert, assertEquals } from "./assert.ts";
import {
  fetchDailyMetrics,
  fetchMonthlyKeywords,
  GBP_DAILY_METRICS,
  getLocation,
  listReviews,
} from "../_shared/gbp-api.ts";

type Call = { url: string; token: string };

function fakeFetch(responses: unknown[]) {
  const calls: Call[] = [];
  const fetchJson = (url: string, token: string) => {
    calls.push({ url, token });
    const next = responses.shift();
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next ?? null);
  };
  return { calls, fetchJson };
}

const d = (year: number, month: number, day: number) => ({ year, month, day });

Deno.test("fetchDailyMetrics: asks for the ten spec metrics with snake_case dailyRange params", async () => {
  const { calls, fetchJson } = fakeFetch([{ multiDailyMetricTimeSeries: [] }]);
  await fetchDailyMetrics("tok", "locations/123", { start: "2026-10-01", end: "2026-10-03" }, fetchJson);

  assertEquals(calls.length, 1);
  assertEquals(calls[0].token, "tok");
  const url = new URL(calls[0].url);
  assertEquals(
    `${url.origin}${url.pathname}`,
    "https://businessprofileperformance.googleapis.com/v1/locations/123:fetchMultiDailyMetricsTimeSeries",
  );
  assertEquals(url.searchParams.getAll("dailyMetrics"), [
    "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
    "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
    "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
    "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
    "CALL_CLICKS",
    "BUSINESS_DIRECTION_REQUESTS",
    "WEBSITE_CLICKS",
    "MESSAGING_CLICKS",
    "BUSINESS_BOOKINGS",
    "BUSINESS_FOOD_MENU_CLICKS",
  ]);
  assertEquals(GBP_DAILY_METRICS.length, 10);
  assertEquals(url.searchParams.get("dailyRange.start_date.year"), "2026");
  assertEquals(url.searchParams.get("dailyRange.start_date.month"), "10");
  assertEquals(url.searchParams.get("dailyRange.start_date.day"), "1");
  assertEquals(url.searchParams.get("dailyRange.end_date.year"), "2026");
  assertEquals(url.searchParams.get("dailyRange.end_date.month"), "10");
  assertEquals(url.searchParams.get("dailyRange.end_date.day"), "3");
});

Deno.test("fetchDailyMetrics: a day the API omits is 0 for every metric, an absent value is 0", async () => {
  const { fetchJson } = fakeFetch([
    {
      multiDailyMetricTimeSeries: [
        {
          dailyMetricTimeSeries: [
            {
              dailyMetric: "CALL_CLICKS",
              timeSeries: {
                datedValues: [
                  { date: d(2026, 10, 1), value: "4" },
                  // value absent = zero; 10-02 missing entirely; 10-03 present
                  { date: d(2026, 10, 3) },
                ],
              },
            },
            {
              dailyMetric: "WEBSITE_CLICKS",
              timeSeries: { datedValues: [{ date: d(2026, 10, 3), value: "7" }] },
            },
          ],
        },
      ],
    },
  ]);
  const { days, latestServedDay } = await fetchDailyMetrics(
    "t",
    "locations/1",
    { start: "2026-10-01", end: "2026-10-03" },
    fetchJson,
  );

  // 10-03 counts as served although its CALL_CLICKS entry has no value.
  assertEquals(latestServedDay, "2026-10-03");
  assertEquals([...days.keys()], ["2026-10-01", "2026-10-02", "2026-10-03"]);
  assertEquals(days.get("2026-10-01")?.call_clicks, 4);
  assertEquals(days.get("2026-10-01")?.website_clicks, 0);
  assertEquals(days.get("2026-10-03")?.call_clicks, 0);
  assertEquals(days.get("2026-10-03")?.website_clicks, 7);
  const missing = days.get("2026-10-02")!;
  assertEquals(Object.keys(missing).length, 10);
  for (const value of Object.values(missing)) assertEquals(value, 0);
});

Deno.test("fetchDailyMetrics: maps each metric to its lower snake case key, ignoring unknown and sub-entity series", async () => {
  const { fetchJson } = fakeFetch([
    {
      multiDailyMetricTimeSeries: [
        {
          dailyMetricTimeSeries: [
            ...GBP_DAILY_METRICS.map((metric, i) => ({
              dailyMetric: metric,
              timeSeries: { datedValues: [{ date: d(2026, 10, 1), value: String(i + 1) }] },
            })),
            { dailyMetric: "BUSINESS_CONVERSATIONS", timeSeries: { datedValues: [{ date: d(2026, 10, 1), value: "99" }] } },
            {
              dailyMetric: "CALL_CLICKS",
              dailySubEntityType: { dayOfWeek: "MONDAY" },
              timeSeries: { datedValues: [{ date: d(2026, 10, 1), value: "500" }] },
            },
          ],
        },
      ],
    },
  ]);
  const { days } = await fetchDailyMetrics("t", "locations/1", { start: "2026-10-01", end: "2026-10-01" }, fetchJson);
  assertEquals(days.get("2026-10-01"), {
    business_impressions_desktop_maps: 1,
    business_impressions_desktop_search: 2,
    business_impressions_mobile_maps: 3,
    business_impressions_mobile_search: 4,
    call_clicks: 5,
    business_direction_requests: 6,
    website_clicks: 7,
    messaging_clicks: 8,
    business_bookings: 9,
    business_food_menu_clicks: 10,
  });
});

Deno.test("fetchDailyMetrics: an empty body still yields every requested day at 0; days outside the range are ignored", async () => {
  const { fetchJson } = fakeFetch([
    null,
    {
      multiDailyMetricTimeSeries: [
        {
          dailyMetricTimeSeries: [
            { dailyMetric: "CALL_CLICKS", timeSeries: { datedValues: [{ date: d(2026, 9, 30), value: "3" }] } },
          ],
        },
      ],
    },
  ]);
  const empty = await fetchDailyMetrics("t", "locations/1", { start: "2026-10-30", end: "2026-11-01" }, fetchJson);
  assertEquals([...empty.days.keys()], ["2026-10-30", "2026-10-31", "2026-11-01"]);
  assertEquals(empty.latestServedDay, null);
  const stray = await fetchDailyMetrics("t", "locations/1", { start: "2026-10-01", end: "2026-10-01" }, fetchJson);
  assertEquals([...stray.days.keys()], ["2026-10-01"]);
  assertEquals(stray.days.get("2026-10-01")?.call_clicks, 0);
  assertEquals(stray.latestServedDay, null, "a day outside the range is not a served day");
});

Deno.test("fetchDailyMetrics: latestServedDay counts value-less entries and breakdown series, not zero-filled days", async () => {
  const { fetchJson } = fakeFetch([
    {
      multiDailyMetricTimeSeries: [
        {
          dailyMetricTimeSeries: [
            // A quiet location: every served entry has no value (= zero).
            { dailyMetric: "CALL_CLICKS", timeSeries: { datedValues: [{ date: d(2026, 10, 1) }, { date: d(2026, 10, 2) }] } },
            {
              dailyMetric: "WEBSITE_CLICKS",
              dailySubEntityType: { dayOfWeek: "FRIDAY" },
              timeSeries: { datedValues: [{ date: d(2026, 10, 3) }] },
            },
          ],
        },
      ],
    },
  ]);
  const { days, latestServedDay } = await fetchDailyMetrics(
    "t",
    "locations/1",
    { start: "2026-10-01", end: "2026-10-05" },
    fetchJson,
  );
  assertEquals(latestServedDay, "2026-10-03");
  assertEquals(days.size, 5);
  for (const metrics of days.values()) assertEquals(metrics.website_clicks, 0);
});

Deno.test("fetchMonthlyKeywords: one month per call, value and threshold parsed from int64 strings", async () => {
  const { calls, fetchJson } = fakeFetch([
    {
      searchKeywordsCounts: [
        { searchKeyword: "dentista perto", insightsValue: { value: "120" } },
        { searchKeyword: "clareamento", insightsValue: { threshold: "15" } },
      ],
    },
  ]);
  const rows = await fetchMonthlyKeywords("tok", "locations/123", "2026-09", fetchJson);

  assertEquals(rows, [
    { month: "2026-09", keyword: "dentista perto", value: 120 },
    { month: "2026-09", keyword: "clareamento", threshold: 15 },
  ]);
  const url = new URL(calls[0].url);
  assertEquals(
    `${url.origin}${url.pathname}`,
    "https://businessprofileperformance.googleapis.com/v1/locations/123/searchkeywords/impressions/monthly",
  );
  assertEquals(url.searchParams.get("monthlyRange.start_month.year"), "2026");
  assertEquals(url.searchParams.get("monthlyRange.start_month.month"), "9");
  assertEquals(url.searchParams.get("monthlyRange.end_month.year"), "2026");
  assertEquals(url.searchParams.get("monthlyRange.end_month.month"), "9");
  assertEquals(url.searchParams.get("pageSize"), "100");
  assertEquals(url.searchParams.has("pageToken"), false);
});

Deno.test("fetchMonthlyKeywords: follows nextPageToken until it is absent", async () => {
  const { calls, fetchJson } = fakeFetch([
    { searchKeywordsCounts: [{ searchKeyword: "a", insightsValue: { value: "1" } }], nextPageToken: "p2" },
    { searchKeywordsCounts: [{ searchKeyword: "b", insightsValue: { value: "2" } }], nextPageToken: "p3" },
    { searchKeywordsCounts: [{ searchKeyword: "c", insightsValue: { threshold: "5" } }] },
  ]);
  const rows = await fetchMonthlyKeywords("t", "locations/1", "2026-10", fetchJson);

  assertEquals(rows.map((r) => r.keyword), ["a", "b", "c"]);
  assertEquals(calls.length, 3);
  assertEquals(new URL(calls[1].url).searchParams.get("pageToken"), "p2");
  assertEquals(new URL(calls[2].url).searchParams.get("pageToken"), "p3");
});

Deno.test("fetchMonthlyKeywords: rejects a malformed month before any call; skips entries with no usable value", async () => {
  const { calls, fetchJson } = fakeFetch([
    {
      searchKeywordsCounts: [
        { searchKeyword: "ok", insightsValue: { value: "3" } },
        { searchKeyword: "no value", insightsValue: {} },
        { insightsValue: { value: "9" } },
      ],
    },
  ]);
  let threw = false;
  try {
    await fetchMonthlyKeywords("t", "locations/1", "2026-13", fetchJson);
  } catch {
    threw = true;
  }
  assert(threw);
  assertEquals(calls.length, 0);

  const rows = await fetchMonthlyKeywords("t", "locations/1", "2026-10", fetchJson);
  assertEquals(rows, [{ month: "2026-10", keyword: "ok", value: 3 }]);
});

Deno.test("listReviews: maps FOUR to 4, hasReply from reviewReply, and returns the summary and page token", async () => {
  const { calls, fetchJson } = fakeFetch([
    {
      reviews: [
        {
          reviewId: "r1",
          reviewer: { displayName: "Maria" },
          starRating: "FOUR",
          comment: "Ótimo atendimento",
          createTime: "2026-10-01T10:00:00Z",
          updateTime: "2026-10-02T10:00:00Z",
          reviewReply: { comment: "Obrigado!", updateTime: "2026-10-03T10:00:00Z" },
        },
        {
          reviewId: "r2",
          reviewer: { displayName: "A Google user", isAnonymous: true },
          starRating: "ONE",
          createTime: "2026-09-01T10:00:00Z",
          updateTime: "2026-09-01T10:00:00Z",
        },
      ],
      averageRating: 4.5,
      totalReviewCount: 12,
      nextPageToken: "next",
    },
  ]);
  const page = await listReviews("tok", "accounts/9", "locations/123", { pageToken: "cur" }, fetchJson);

  assertEquals(page.averageRating, 4.5);
  assertEquals(page.totalReviewCount, 12);
  assertEquals(page.nextPageToken, "next");
  assertEquals(page.reviews, [
    {
      reviewId: "r1",
      reviewerName: "Maria",
      starRating: 4,
      comment: "Ótimo atendimento",
      createTime: "2026-10-01T10:00:00Z",
      updateTime: "2026-10-02T10:00:00Z",
      hasReply: true,
    },
    {
      reviewId: "r2",
      reviewerName: null,
      starRating: 1,
      comment: null,
      createTime: "2026-09-01T10:00:00Z",
      updateTime: "2026-09-01T10:00:00Z",
      hasReply: false,
    },
  ]);

  const url = new URL(calls[0].url);
  assertEquals(`${url.origin}${url.pathname}`, "https://mybusiness.googleapis.com/v4/accounts/9/locations/123/reviews");
  assertEquals(url.searchParams.get("orderBy"), "updateTime desc");
  assertEquals(url.searchParams.get("pageSize"), "50");
  assertEquals(url.searchParams.get("pageToken"), "cur");
});

Deno.test("listReviews: maps ONE..FIVE, drops unrated reviews, null summary and token when absent", async () => {
  const mk = (id: string, starRating: string) => ({
    reviewId: id,
    starRating,
    createTime: "2026-10-01T00:00:00Z",
    updateTime: "2026-10-01T00:00:00Z",
  });
  const { calls, fetchJson } = fakeFetch([
    { reviews: [mk("a", "ONE"), mk("b", "TWO"), mk("c", "THREE"), mk("d", "FOUR"), mk("e", "FIVE"), mk("f", "STAR_RATING_UNSPECIFIED")] },
    {},
  ]);
  const page = await listReviews("t", "accounts/9", "locations/1", {}, fetchJson);
  assertEquals(page.reviews.map((r) => r.starRating), [1, 2, 3, 4, 5]);
  assertEquals(page.averageRating, null);
  assertEquals(page.totalReviewCount, null);
  assertEquals(page.nextPageToken, null);
  assertEquals(new URL(calls[0].url).searchParams.has("pageToken"), false);

  const empty = await listReviews("t", "accounts/9", "locations/1", {}, fetchJson);
  assertEquals(empty.reviews, []);
});

Deno.test("getLocation: title, voice of merchant and mapsUri from metadata", async () => {
  const { calls, fetchJson } = fakeFetch([
    { name: "locations/123", title: "Clínica Sorriso", metadata: { hasVoiceOfMerchant: true, mapsUri: "https://maps.google.com/?cid=1" } },
    { title: "Sem metadata" },
  ]);
  const loc = await getLocation("tok", "locations/123", fetchJson);
  assertEquals(loc, { title: "Clínica Sorriso", hasVoiceOfMerchant: true, mapsUri: "https://maps.google.com/?cid=1" });
  const url = new URL(calls[0].url);
  assertEquals(`${url.origin}${url.pathname}`, "https://mybusinessbusinessinformation.googleapis.com/v1/locations/123");
  assertEquals(url.searchParams.get("readMask"), "title,metadata");

  assertEquals(await getLocation("tok", "locations/9", fetchJson), {
    title: "Sem metadata",
    hasVoiceOfMerchant: false,
    mapsUri: null,
  });
});

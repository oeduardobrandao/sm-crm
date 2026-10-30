import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  aggregateVideoDaily,
  computeYtKpis,
  computeYtSplit,
  emptyYtKpis,
  sumMetric,
  weightedAverage,
  YT_KPI_IDS,
  type YtChannelDailyRow,
  type YtKpiInput,
} from "./kpis.ts";

function row(day: string, over: Partial<YtChannelDailyRow> = {}): YtChannelDailyRow {
  return {
    day,
    content_type: "all",
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

function input(over: Partial<YtKpiInput> = {}): YtKpiInput {
  const current = [row("2026-10-26"), row("2026-10-27", { views: 300, average_view_duration_s: 10 })];
  const prev = [row("2026-10-24", { views: 50 })];
  return { current, prev, prevCovered: true, allCurrent: current, allPrev: prev, subscriberCount: 1000, ...over };
}

Deno.test("returns every KPI id", () => {
  assertEquals(Object.keys(computeYtKpis(input())).sort(), [...YT_KPI_IDS].sort());
});

Deno.test("avg_view_duration_s is the view-weighted mean of the daily averages", () => {
  // (30*100 + 10*300) / 400 = 15; the plain mean would be 20.
  const k = computeYtKpis(input()).avg_view_duration_s;
  assertEquals(k.value, 15);
  assertEquals(k.prev, 30);
});

Deno.test("weighted mean skips rows missing either side and is null on zero views", () => {
  assertEquals(
    weightedAverage([row("a", { views: 100, average_view_duration_s: 20 }), row("b", { views: null, average_view_duration_s: 99 }), row("c", { views: 50, average_view_duration_s: null })], "average_view_duration_s"),
    20,
  );
  assertEquals(weightedAverage([row("a", { views: 0 })], "average_view_duration_s"), null);
  assertEquals(weightedAverage([], "average_view_duration_s"), null);
});

Deno.test("net_subscribers is sum gained minus sum lost over the 'all' rows, with both exposed", () => {
  const k = computeYtKpis(input({
    allCurrent: [row("d1", { subscribers_gained: 10, subscribers_lost: 3 }), row("d2", { subscribers_gained: 4, subscribers_lost: 6 })],
  })).net_subscribers;
  assertEquals(k.value, 5);
  assertEquals(k.gained, 14);
  assertEquals(k.lost, 9);
  assertEquals(k.prev, 4);
});

Deno.test("subscribers is the current count; prev is the count before the window's net change", () => {
  // Net over the 'all' rows of the window: (5-1)*2 = 8.
  assertEquals(computeYtKpis(input()).subscribers, { value: 1000, prev: 992 });
});

Deno.test("subscribers and net_subscribers use the 'all' rows whatever the selected type", () => {
  const shorts = [row("2026-10-27", { content_type: "shorts", subscribers_gained: null, subscribers_lost: null, views: 7 })];
  const k = computeYtKpis(input({ current: shorts, prev: shorts }));
  assertEquals(k.subscribers, { value: 1000, prev: 992 });
  // Google does not split subscriber metrics: the channel-wide net is shown.
  assertEquals(k.net_subscribers.value, 8);
  assertEquals(k.net_subscribers.prev, 4);
  assertEquals(k.views.value, 7);
});

Deno.test("current null (no split data in the window): the type's KPIs are null, subscriber KPIs are not", () => {
  const k = computeYtKpis(input({ current: null, prev: [] }));
  for (const id of ["views", "engaged_views", "watch_minutes", "avg_view_duration_s", "likes", "shares", "comments"] as const) {
    assertEquals(k[id], { value: null, prev: null }, id);
  }
  assertEquals(k.subscribers, { value: 1000, prev: 992 });
  assertEquals(k.net_subscribers.value, 8);
});

Deno.test("prevCovered false nulls the type's prev; subscriber prev follows the 'all' previous window", () => {
  const k = computeYtKpis(input({ prevCovered: false }));
  assertEquals(k.views, { value: 400, prev: null });
  assertEquals(k.net_subscribers.prev, 4);
});

Deno.test("subscribers is null when the channel count is unknown", () => {
  assertEquals(computeYtKpis(input({ subscriberCount: null })).subscribers, { value: null, prev: null });
});

Deno.test("sums: views, engaged views, minutes, likes, shares, comments", () => {
  const k = computeYtKpis(input());
  assertEquals(k.views, { value: 400, prev: 50 });
  assertEquals(k.engaged_views, { value: 160, prev: 80 });
  assertEquals(k.watch_minutes, { value: 100, prev: 50 });
  assertEquals(k.likes, { value: 20, prev: 10 });
  assertEquals(k.shares, { value: 2, prev: 1 });
  assertEquals(k.comments, { value: 4, prev: 2 });
});

Deno.test("sumMetric: no rows is 0, rows with the metric null on every row is null, partial nulls sum the rest", () => {
  assertEquals(sumMetric([], "views"), 0);
  assertEquals(sumMetric([row("a", { likes: null }), row("b", { likes: null })], "likes"), null);
  assertEquals(sumMetric([row("a", { likes: null }), row("b", { likes: 7 })], "likes"), 7);
});

Deno.test("a channel with no Shorts: type=shorts KPIs are 0, not null", () => {
  const k = computeYtKpis(input({ current: [], prev: [] }));
  assertEquals(k.views.value, 0);
  assertEquals(k.views.prev, 0);
  assertEquals(k.likes.value, 0);
  assertEquals(k.avg_view_duration_s.value, null);
});

Deno.test("previous window with no 'all' rows (before the backfill) has every prev null", () => {
  const k = computeYtKpis(input({ prev: [], allPrev: [], prevCovered: false }));
  for (const id of YT_KPI_IDS) {
    if (id === "subscribers") continue; // its prev comes from the current window's net change
    assertEquals(k[id].prev, null, id);
  }
  assertEquals(k.views.value, 400);
});

Deno.test("emptyYtKpis: every KPI present with value and prev null", () => {
  const k = emptyYtKpis();
  assertEquals(Object.keys(k).sort(), [...YT_KPI_IDS].sort());
  for (const id of YT_KPI_IDS) {
    assertEquals(k[id].value, null, id);
    assertEquals(k[id].prev, null, id);
  }
});

Deno.test("computeYtSplit: a channel with no Shorts gives zeros for shorts", () => {
  const rows = [
    row("2026-10-26", { content_type: "long", views: 70, estimated_minutes_watched: 40, likes: 6 }),
    row("2026-10-27", { content_type: "long", views: 30, estimated_minutes_watched: 10, likes: null }),
    row("2026-10-27", { content_type: "all", views: 999 }),
    row("2026-10-27", { content_type: "live", views: 5 }),
  ];
  assertEquals(computeYtSplit(rows), {
    views: { shorts: 0, long: 100 },
    minutes: { shorts: 0, long: 50 },
    likes: { shorts: 0, long: 6 },
  });
});

Deno.test("computeYtSplit: no rows is all zeros", () => {
  assertEquals(computeYtSplit([]), {
    views: { shorts: 0, long: 0 },
    minutes: { shorts: 0, long: 0 },
    likes: { shorts: 0, long: 0 },
  });
});

Deno.test("aggregateVideoDaily sums per video and weights the averages by views", () => {
  const agg = aggregateVideoDaily([
    {
      video_id: "a",
      day: "2026-10-26",
      views: 100,
      engaged_views: 90,
      likes: 5,
      comments: 1,
      subscribers_gained: 2,
      average_view_duration_s: 20,
      average_view_percentage: 80,
    },
    {
      video_id: "a",
      day: "2026-10-27",
      views: 300,
      engaged_views: null,
      likes: null,
      comments: 3,
      subscribers_gained: 0,
      average_view_duration_s: 40,
      average_view_percentage: 40,
    },
    {
      video_id: "b",
      day: "2026-10-27",
      views: 0,
      engaged_views: null,
      likes: null,
      comments: null,
      subscribers_gained: null,
      average_view_duration_s: null,
      average_view_percentage: null,
    },
  ]);
  assertEquals(agg.get("a"), {
    views: 400,
    engagedViews: 90,
    avgViewDurationS: 35,
    avgViewPct: 50,
    likes: 5,
    comments: 4,
    subscribersGained: 2,
  });
  assertEquals(agg.get("b"), {
    views: 0,
    engagedViews: null,
    avgViewDurationS: null,
    avgViewPct: null,
    likes: 0,
    comments: 0,
    subscribersGained: 0,
  });
});

Deno.test("numeric columns returned as strings are read as numbers", () => {
  // PostgREST may return numeric as a string.
  const k = computeYtKpis(input({
    current: [row("d", { average_view_duration_s: "12.5" as unknown as number, views: 10 })],
  }));
  assertEquals(k.avg_view_duration_s.value, 12.5);
});

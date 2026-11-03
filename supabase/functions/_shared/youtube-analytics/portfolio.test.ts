import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { computeYtKpis, type YtChannelDailyRow } from "./kpis.ts";
import type { YouTubeChannelRow } from "./queries.ts";
import type { YtWindow } from "./window.ts";
import { channelPortfolioRow } from "./portfolio.ts";

const W: YtWindow = { start: "2026-10-21", end: "2026-10-27", prevStart: "2026-10-14", prevEnd: "2026-10-20" };

const CHANNEL: YouTubeChannelRow & { client_id: number } = {
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

function row(day: string, contentType: string, over: Partial<YtChannelDailyRow> = {}): YtChannelDailyRow {
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

const ALL_ROWS = [
  row("2026-10-20", "all", { views: 9999 }), // before the window: ignored
  row("2026-10-21", "all", { views: 100, average_view_duration_s: 30 }),
  row("2026-10-25", "all", { views: 300, average_view_duration_s: 10, subscribers_gained: 7, subscribers_lost: 2 }),
  row("2026-10-27", "all", { views: 50, estimated_minutes_watched: "20" as unknown as number }),
];

Deno.test("channelPortfolioRow: all-type metrics equal computeYtKpis over the window", () => {
  const inWindow = ALL_ROWS.filter((r) => r.day >= W.start && r.day <= W.end);
  const kpis = computeYtKpis({
    current: inWindow,
    prev: [],
    prevCovered: false,
    allCurrent: inWindow,
    allPrev: [],
    allPrevCovered: false,
    subscriberCount: 1000,
  });
  const out = channelPortfolioRow(CHANNEL, "Ana", ALL_ROWS, W, true);
  assertEquals(out.metrics.views, kpis.views.value);
  assertEquals(out.metrics.views, 450);
  assertEquals(out.metrics.watchMinutes, kpis.watch_minutes.value);
  assertEquals(out.metrics.watchMinutes, 120);
  assertEquals(out.metrics.avgViewDurationS, kpis.avg_view_duration_s.value);
  assertEquals(out.metrics.netSubscribers, kpis.net_subscribers.value);
  assertEquals(out.metrics.netSubscribers, 4 + 5 + 4);
});

Deno.test("channelPortfolioRow: channel fields, built field by field", () => {
  const out = channelPortfolioRow({ ...CHANNEL, subscriber_count: "1234" as unknown as number }, "Ana", ALL_ROWS, W, true);
  assertEquals(Object.keys(out).sort(), [
    "authorizationStatus",
    "avatarUrl",
    "clientId",
    "clientName",
    "handle",
    "lastSyncedAt",
    "metrics",
    "subscriberCount",
    "title",
    "window",
  ]);
  assertEquals(out.clientId, 42);
  assertEquals(out.clientName, "Ana");
  assertEquals(out.title, "Dra. Ana");
  assertEquals(out.handle, "@draana");
  assertEquals(out.avatarUrl, "https://yt.example/a.jpg");
  assertEquals(out.subscriberCount, 1234);
  assertEquals(out.authorizationStatus, "active");
  assertEquals(out.lastSyncedAt, "2026-10-30T09:35:00.000Z");
  assertEquals(out.window, W);
  assertEquals(Object.keys(out.metrics).sort(), ["avgViewDurationS", "netSubscribers", "shortsShare", "views", "watchMinutes"]);
});

Deno.test("channelPortfolioRow: shortsShare is shorts / (shorts + long) clipped to content_type_through", () => {
  const rows = [
    ...ALL_ROWS,
    row("2026-10-20", "shorts", { views: 5000 }), // before the window
    row("2026-10-21", "shorts", { views: 30 }),
    row("2026-10-21", "long", { views: 70 }),
    row("2026-10-24", "shorts", { views: 90 }),
    row("2026-10-24", "long", { views: 10 }),
    row("2026-10-26", "shorts", { views: 800 }), // after content_type_through
  ];
  const out = channelPortfolioRow({ ...CHANNEL, content_type_through: "2026-10-25" }, "Ana", rows, W, true);
  assertEquals(out.metrics.shortsShare, 120 / 200);
  // Unclipped, the late Shorts row counts.
  const full = channelPortfolioRow(CHANNEL, "Ana", rows, W, true);
  assertEquals(full.metrics.shortsShare, 920 / 1000);
});

Deno.test("channelPortfolioRow: shortsShare null without split data in the window", () => {
  const rows = [...ALL_ROWS, row("2026-10-21", "shorts", { views: 30 }), row("2026-10-21", "long", { views: 70 })];
  assertEquals(channelPortfolioRow({ ...CHANNEL, content_type_through: null }, "Ana", rows, W, true).metrics.shortsShare, null);
  assertEquals(
    channelPortfolioRow({ ...CHANNEL, content_type_through: "2026-10-20" }, "Ana", rows, W, true).metrics.shortsShare,
    null,
  );
});

Deno.test("channelPortfolioRow: shortsShare null when shorts + long views are 0", () => {
  const rows = [...ALL_ROWS, row("2026-10-21", "shorts", { views: 0 }), row("2026-10-21", "long", { views: null })];
  assertEquals(channelPortfolioRow(CHANNEL, "Ana", rows, W, true).metrics.shortsShare, null);
  assertEquals(channelPortfolioRow(CHANNEL, "Ana", ALL_ROWS, W, true).metrics.shortsShare, null);
});

Deno.test("channelPortfolioRow: hasData false nulls every metric and the window", () => {
  const out = channelPortfolioRow(
    { ...CHANNEL, authorization_status: "revoked", data_through: null, content_type_through: null },
    "Ana",
    [],
    W,
    false,
  );
  assertEquals(out.window, null);
  assertEquals(out.authorizationStatus, "revoked");
  assertEquals(out.metrics, { netSubscribers: null, views: null, watchMinutes: null, avgViewDurationS: null, shortsShare: null });
  // Rows passed anyway are not read.
  assertEquals(channelPortfolioRow(CHANNEL, "Ana", ALL_ROWS, W, false).metrics.views, null);
  assertEquals(channelPortfolioRow(CHANNEL, "Ana", ALL_ROWS, null, true).metrics.views, null);
});

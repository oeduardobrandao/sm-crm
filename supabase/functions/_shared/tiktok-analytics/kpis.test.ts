import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  computeTikTokKpis,
  type FollowerPoint,
  TIKTOK_KPI_IDS,
  type TikTokKpiInput,
  type TikTokVideoRow,
  videoEngagementRate,
} from "./kpis.ts";

const video = (views: number, likes: number, comments: number, shares: number, id = "v"): TikTokVideoRow => ({
  tiktok_video_id: id,
  posted_at: "2026-10-10T15:00:00Z",
  views,
  likes,
  comments,
  shares,
});

const history: FollowerPoint[] = [
  { date: "2026-10-01", follower_count: 1000 },
  { date: "2026-10-15", follower_count: 1100 },
  { date: "2026-10-28", follower_count: 1200 },
];
const prevHistory: FollowerPoint[] = [
  { date: "2026-09-01", follower_count: 900 },
  { date: "2026-09-30", follower_count: 980 },
];

function input(over: Partial<TikTokKpiInput> = {}): TikTokKpiInput {
  return {
    videos: [video(1000, 50, 10, 40, "a"), video(0, 0, 0, 0, "b")],
    prevVideos: [video(500, 20, 5, 25, "p")],
    history,
    prevHistory,
    currentFollowers: null,
    windowEndsToday: false,
    likesTotal: 7777,
    ...over,
  };
}

Deno.test("returns every KPI id", () => {
  assertEquals(Object.keys(computeTikTokKpis(input())).sort(), [...TIKTOK_KPI_IDS].sort());
});

Deno.test("followers_total: last point in the window, compared with the first", () => {
  assertEquals(computeTikTokKpis(input()).followers_total, { value: 1200, unit: "count", prev: 1000 });
});

Deno.test("followers_gained: last minus first in the window, vs the previous window", () => {
  const k = computeTikTokKpis(input()).followers_gained;
  assertEquals(k.value, 200);
  assertEquals(k.prev, 80);
  assertEquals(k.unit, "count");
});

Deno.test("follower history is read sorted by date whatever the input order", () => {
  const k = computeTikTokKpis(input({ history: [history[2], history[0], history[1]] }));
  assertEquals(k.followers_total.value, 1200);
  assertEquals(k.followers_gained.value, 200);
});

Deno.test("views is the sum of current views, with no comparison", () => {
  assertEquals(computeTikTokKpis(input()).views, { value: 1000, unit: "count", prev: null });
});

Deno.test("engagement_rate is (likes+comments+shares)/views*100, prev computed from prevVideos", () => {
  const k = computeTikTokKpis(input()).engagement_rate;
  assertEquals(k.value, 10);
  assertEquals(k.unit, "pct");
  assertEquals(k.prev, 10); // (20+5+25)/500*100
});

Deno.test("posts_count counts videos; prev is the previous window count", () => {
  assertEquals(computeTikTokKpis(input()).posts_count, { value: 2, unit: "count", prev: 1 });
});

Deno.test("likes, comments, shares and likes_total never carry a comparison", () => {
  const k = computeTikTokKpis(input());
  assertEquals(k.likes, { value: 50, unit: "count", prev: null });
  assertEquals(k.comments, { value: 10, unit: "count", prev: null });
  assertEquals(k.shares, { value: 40, unit: "count", prev: null });
  assertEquals(k.likes_total, { value: 7777, unit: "count", prev: null });
});

Deno.test("one follower point in the window: gained is null, no comparison", () => {
  const k = computeTikTokKpis(input({ history: [history[2]] }));
  assertEquals(k.followers_gained.value, null);
  assertEquals(k.followers_gained.prev, null);
  assertEquals(k.followers_total.value, 1200);
  assertEquals(k.followers_total.prev, null);
});

Deno.test("no follower points and not ending today: followers_total is null", () => {
  const k = computeTikTokKpis(input({ history: [], currentFollowers: 1300 }));
  assertEquals(k.followers_total.value, null);
  assertEquals(k.followers_total.prev, null);
  assertEquals(k.followers_gained.value, null);
});

Deno.test("no previous follower points: followers_gained prev is null", () => {
  const k = computeTikTokKpis(input({ prevHistory: [] }));
  assertEquals(k.followers_gained.value, 200);
  assertEquals(k.followers_gained.prev, null);
});

Deno.test("one previous follower point is not enough for a previous delta", () => {
  assertEquals(computeTikTokKpis(input({ prevHistory: [prevHistory[0]] })).followers_gained.prev, null);
});

Deno.test("zero videos in the window: engagement null, views 0, posts_count 0", () => {
  const k = computeTikTokKpis(input({ videos: [] }));
  assertEquals(k.engagement_rate.value, null);
  assertEquals(k.engagement_rate.prev, null);
  assertEquals(k.views.value, 0);
  assertEquals(k.posts_count.value, 0);
});

Deno.test("videos with zero total views: engagement null, not 0", () => {
  assertEquals(computeTikTokKpis(input({ videos: [video(0, 0, 0, 0)] })).engagement_rate.value, null);
});

Deno.test("zero videos in the previous window: posts_count and engagement prev are null", () => {
  const k = computeTikTokKpis(input({ prevVideos: [] }));
  assertEquals(k.posts_count.prev, null);
  assertEquals(k.engagement_rate.prev, null);
});

Deno.test("previous window with videos but zero views compares posts_count normally", () => {
  const k = computeTikTokKpis(input({ prevVideos: [video(0, 0, 0, 0)] }));
  assertEquals(k.posts_count.prev, 1);
  assertEquals(k.engagement_rate.prev, null);
});

Deno.test("window ending today with no point today uses currentFollowers for followers_total", () => {
  const k = computeTikTokKpis(input({
    history: history.slice(0, 2),
    currentFollowers: 1250,
    windowEndsToday: true,
  }));
  assertEquals(k.followers_total.value, 1250);
  assertEquals(k.followers_total.prev, 1000);
});

Deno.test("currentFollowers is ignored when the window does not end today", () => {
  assertEquals(computeTikTokKpis(input({ currentFollowers: 9999 })).followers_total.value, 1200);
});

Deno.test("null counts are treated as 0 in the sums", () => {
  const v: TikTokVideoRow = { tiktok_video_id: "n", posted_at: null, views: null, likes: null, comments: null, shares: null };
  const k = computeTikTokKpis(input({ videos: [v] }));
  assertEquals(k.views.value, 0);
  assertEquals(k.likes.value, 0);
  assertEquals(k.engagement_rate.value, null);
});

Deno.test("null likesTotal stays null", () => {
  assertEquals(computeTikTokKpis(input({ likesTotal: null })).likes_total.value, null);
});

Deno.test("videoEngagementRate", () => {
  assertEquals(videoEngagementRate(video(1000, 50, 10, 40)), 10);
  assertEquals(videoEngagementRate(video(0, 5, 5, 5)), null);
  assertEquals(
    videoEngagementRate({ tiktok_video_id: "x", posted_at: null, views: null, likes: 1, comments: 1, shares: 1 }),
    null,
  );
  assertEquals(
    videoEngagementRate({ tiktok_video_id: "x", posted_at: null, views: 200, likes: null, comments: 2, shares: null }),
    1,
  );
});

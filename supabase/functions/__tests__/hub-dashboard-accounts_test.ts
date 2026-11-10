import { assertEquals } from "./assert.ts";
import { followersDelta, instagramState, tiktokState } from "../hub-dashboard/accounts.ts";
import { resolvePlatform, topVideos, viewsHistory } from "../hub-dashboard/tiktok-detail.ts";
import type { TikTokVideoDetailRow } from "../_shared/tiktok-analytics/queries.ts";

const NOW = "2026-11-10T12:00:00.000Z";

Deno.test("instagramState: disconnected wins over an expired token (epoch 0)", () => {
  assertEquals(
    instagramState({ authorization_status: "disconnected", token_expires_at: "1970-01-01T00:00:00.000Z" }, NOW),
    null,
  );
});

Deno.test("instagramState: revoked and expired need reconnection", () => {
  assertEquals(instagramState({ authorization_status: "revoked", token_expires_at: null }, NOW), "needs_reconnect");
  assertEquals(instagramState({ authorization_status: "expired", token_expires_at: null }, NOW), "needs_reconnect");
});

Deno.test("instagramState: active with a past token needs reconnection; null or future token is connected", () => {
  assertEquals(
    instagramState({ authorization_status: "active", token_expires_at: "2026-11-09T00:00:00.000Z" }, NOW),
    "needs_reconnect",
  );
  assertEquals(instagramState({ authorization_status: "active", token_expires_at: null }, NOW), "connected");
  assertEquals(
    instagramState({ authorization_status: "active", token_expires_at: "2026-12-01T00:00:00.000Z" }, NOW),
    "connected",
  );
});

Deno.test("tiktokState: active, revoked/expired, disconnected", () => {
  assertEquals(tiktokState({ authorization_status: "active" }), "connected");
  assertEquals(tiktokState({ authorization_status: "expired" }), "needs_reconnect");
  assertEquals(tiktokState({ authorization_status: "revoked" }), "needs_reconnect");
  assertEquals(tiktokState({ authorization_status: "disconnected" }), null);
});

Deno.test("followersDelta: full window", () => {
  const d = followersDelta(
    [{ date: "2026-10-12", follower_count: 12168 }, { date: "2026-11-10", follower_count: 12480 }],
    "2026-10-11",
  );
  assertEquals(d, { value: 312, since: "2026-10-12", fullWindow: true });
});

Deno.test("followersDelta: history starts later", () => {
  const d = followersDelta(
    [{ date: "2026-10-30", follower_count: 3822 }, { date: "2026-11-09", follower_count: 3906 }],
    "2026-10-12",
  );
  assertEquals(d, { value: 84, since: "2026-10-30", fullWindow: false });
});

Deno.test("followersDelta: unsorted input, a loss, one point, points before minDate", () => {
  assertEquals(
    followersDelta(
      [{ date: "2026-11-09", follower_count: 90 }, { date: "2026-10-12", follower_count: 100 }],
      "2026-10-11",
    )?.value,
    -10,
  );
  assertEquals(followersDelta([{ date: "2026-11-09", follower_count: 90 }], "2026-10-11"), null);
  // connected 2026-11-01: the two earlier points are reconstructed and must not count
  const d = followersDelta(
    [
      { date: "2026-10-15", follower_count: 10 },
      { date: "2026-10-20", follower_count: 50 },
      { date: "2026-11-01", follower_count: 100 },
      { date: "2026-11-10", follower_count: 105 },
    ],
    "2026-10-11",
    "2026-11-01",
  );
  assertEquals(d, { value: 5, since: "2026-11-01", fullWindow: false });
});

Deno.test("followersDelta: points with a null count are dropped before the two-point check", () => {
  const pts = [
    { date: "2026-10-12", follower_count: null },
    { date: "2026-10-20", follower_count: 100 },
    { date: "2026-11-10", follower_count: null },
  ] as unknown as { date: string; follower_count: number }[];
  assertEquals(followersDelta(pts, "2026-10-11"), null);
  const d = followersDelta([...pts, { date: "2026-11-09", follower_count: 130 }], "2026-10-11");
  assertEquals(d, { value: 30, since: "2026-10-20", fullWindow: false });
});

Deno.test("resolvePlatform: explicit value wins; missing or unknown takes the first card; none means instagram", () => {
  assertEquals(resolvePlatform("tiktok", [{ platform: "instagram" }]), "tiktok");
  assertEquals(resolvePlatform(null, [{ platform: "tiktok" }]), "tiktok");
  assertEquals(resolvePlatform("youtube", [{ platform: "instagram" }, { platform: "tiktok" }]), "instagram");
  assertEquals(resolvePlatform(null, []), "instagram");
});

const vid = (id: string, posted_at: string | null, views: number, over: Partial<TikTokVideoDetailRow> = {}) =>
  ({
    tiktok_video_id: id, posted_at, views, likes: 0, comments: 0, shares: 0,
    title: null, video_description: null, duration: null, share_url: null, cover_image_url: null, ...over,
  }) as TikTokVideoDetailRow;

Deno.test("topVideos: ranks by views, drops zero-view videos, caps at five, rounds engagement to one decimal", () => {
  const rows = [
    vid("a", "2026-11-01T15:00:00Z", 676, { likes: 40, comments: 6, shares: 4, duration: 21, share_url: "https://t/a", cover_image_url: "https://c/a" }),
    vid("b", "2026-11-02T15:00:00Z", 100),
    vid("c", "2026-11-03T15:00:00Z", 300),
    vid("d", "2026-11-04T15:00:00Z", 200),
    vid("e", "2026-11-05T15:00:00Z", 50),
    vid("f", "2026-11-06T15:00:00Z", 10),
    vid("z", "2026-11-07T15:00:00Z", 0),
  ];
  const out = topVideos(rows);
  assertEquals(out.map((v) => v.id), ["a", "c", "d", "b", "e"]);
  assertEquals(out[0], {
    id: "a", coverUrl: "https://c/a", shareUrl: "https://t/a", postedAt: "2026-11-01T15:00:00Z",
    durationSeconds: 21, views: 676, likes: 40, comments: 6, shares: 4, engagementRate: 7.4,
  });
});

Deno.test("topVideos: ties go to the newest; null cover, share_url and duration pass through as null", () => {
  const out = topVideos([vid("old", "2026-11-01T15:00:00Z", 10), vid("new", "2026-11-05T15:00:00Z", 10)]);
  assertEquals(out.map((v) => v.id), ["new", "old"]);
  assertEquals([out[0].coverUrl, out[0].shareUrl, out[0].durationSeconds], [null, null, null]);
});

Deno.test("viewsHistory: sums per São Paulo day", () => {
  const out = viewsHistory([
    vid("a", "2026-11-10T01:30:00Z", 5), // 2026-11-09 in São Paulo
    vid("b", "2026-11-09T20:00:00Z", 7),
    vid("c", "2026-11-10T12:00:00Z", 3),
    vid("d", null, 99),
  ]);
  assertEquals(out, [{ date: "2026-11-09", views: 12 }, { date: "2026-11-10", views: 3 }]);
});

// _shared/youtube-sync.ts (Phase 2 Task 7): the per-channel YouTube sync shared by
// youtube-sync-cron and the manual sync route. The DB is the shared query mock; the YouTube API
// and the token path are injected fakes, and every fake the test does not set up throws
// "must not be called" so a step that runs when it should not fails loudly.
import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock, type QueryCall } from "../../../test/shared/supabaseMock.ts";
import { GoogleApiError } from "../_shared/google.ts";
import {
  syncYouTubeChannel,
  type YoutubeApi,
  type YoutubeChannelRow,
  type YoutubeSyncDeps,
} from "../_shared/youtube-sync.ts";
import type { YtChannel, YtVideo } from "../_shared/youtube-api.ts";

type Db = ReturnType<typeof createSupabaseQueryMock>;

// 2026-10-30 12:00 UTC = 05:00 Pacific on 2026-10-30, so Pacific today is 2026-10-30.
const NOW = new Date("2026-10-30T12:00:00Z");
const TODAY = "2026-10-30";
const YESTERDAY = "2026-10-29";
const CONTA = "conta-a";

function trap(name: string) {
  return () => {
    throw new Error(`${name} must not be called`);
  };
}

function channelRow(overrides: Partial<YoutubeChannelRow> = {}): YoutubeChannelRow {
  return {
    id: "ch-1",
    conta_id: CONTA,
    client_id: 10,
    connection_id: "conn-1",
    channel_id: "UC1",
    title: "Canal",
    handle: "@canal",
    avatar_url: "https://img/a.png",
    uploads_playlist_id: "UU1",
    subscriber_count: 100,
    view_count: 1000,
    video_count: 10,
    authorization_status: "active",
    last_synced_at: null,
    last_sync_attempt_at: null,
    data_through: "2026-10-28",
    content_type_through: "2026-10-28",
    traffic_through: "2026-10-28",
    videos_through: "2026-10-28",
    ...overrides,
  };
}

function ytChannel(overrides: Partial<YtChannel> = {}): YtChannel {
  return {
    id: "UC1",
    title: "Canal novo",
    handle: "@canal",
    avatarUrl: "https://img/b.png",
    uploadsPlaylistId: "UU1",
    subscriberCount: 120,
    viewCount: 2000,
    videoCount: 11,
    ...overrides,
  };
}

function ytVideo(id: string, overrides: Partial<YtVideo> = {}): YtVideo {
  return {
    id,
    title: `Vídeo ${id}`,
    publishedAt: "2026-10-20T10:00:00Z",
    thumbnailUrl: `https://img/${id}.jpg`,
    durationS: 40,
    isShortByDuration: true,
    liveBroadcastContent: "none",
    viewCount: 5,
    likeCount: 1,
    commentCount: 0,
    ...overrides,
  };
}

/** Every API call is a trap unless the test overrides it. `calls` records the order. */
function fakeApi(overrides: Partial<Record<keyof YoutubeApi, unknown>> = {}) {
  const calls: string[] = [];
  const base: Record<string, unknown> = {
    getMyChannel: trap("getMyChannel"),
    listUploads: trap("listUploads"),
    getVideos: trap("getVideos"),
    channelDaily: trap("channelDaily"),
    trafficDaily: trap("trafficDaily"),
    demographics: trap("demographics"),
    videoDaily: trap("videoDaily"),
    videoContentTypes: trap("videoContentTypes"),
    ...overrides,
  };
  const api: Record<string, unknown> = {};
  for (const [name, fn] of Object.entries(base)) {
    api[name] = (...args: unknown[]) => {
      calls.push(name);
      return (fn as (...a: unknown[]) => unknown)(...args);
    };
  }
  return { api: api as unknown as YoutubeApi, calls };
}

/** A quiet happy path: same channel, no uploads, no stored videos, every report empty. */
function quietApi(overrides: Partial<Record<keyof YoutubeApi, unknown>> = {}) {
  return fakeApi({
    getMyChannel: async () => ytChannel(),
    listUploads: async () => ({ videoIds: [], nextPageToken: null }),
    getVideos: async () => [],
    channelDaily: async () => [],
    trafficDaily: async () => [],
    demographics: async () => [],
    videoDaily: async () => [],
    videoContentTypes: async () => new Map(),
    ...overrides,
  });
}

/** The write guard needs `data: [{ id }]` from every youtube_channels update. */
function queueGuardPass(db: Db, n = 200, id = "ch-1") {
  for (let i = 0; i < n; i++) db.queue("youtube_channels", "update", { data: [{ id }] });
}

function deps(db: Db, api: YoutubeApi, token: () => Promise<string> = async () => "tok"): YoutubeSyncDeps {
  return { svc: db as never, api, getFreshGoogleToken: token, now: () => NOW };
}

function channelUpdates(db: Db): Record<string, unknown>[] {
  return db.calls
    .filter((c) => c.table === "youtube_channels" && c.operation === "update")
    .map((c) => c.payload as Record<string, unknown>);
}

function lastValue(db: Db, key: string): unknown {
  const withKey = channelUpdates(db).filter((p) => key in p);
  return withKey.length ? withKey[withKey.length - 1][key] : undefined;
}

function historyCalls(db: Db): QueryCall[] {
  return db.calls.filter((c) => c.table.startsWith("youtube_") && c.table !== "youtube_channels");
}

const run = (d: YoutubeSyncDeps, ch: YoutubeChannelRow, maxVideoReports = 40) =>
  syncYouTubeChannel(d, ch, { now: NOW, maxVideoReports });

// ── outcomes from the token path ────────────────────────────────────────────────

Deno.test("youtube-sync: REVOKED from the token path returns revoked with no API or DB call", async () => {
  const db = createSupabaseQueryMock();
  const { api, calls } = fakeApi();
  const outcome = await run(deps(db, api, async () => {
    throw new GoogleApiError("REVOKED", 400, "revoked", false);
  }), channelRow());
  assertEquals(outcome.status, "revoked");
  assertEquals(outcome.connectionRevoked, true);
  assertEquals(calls.length, 0);
  assertEquals(db.calls.length, 0);
});

Deno.test("youtube-sync: TOKEN_INVALID (no refresh token) returns skipped, no writes (I2)", async () => {
  const db = createSupabaseQueryMock();
  const { api, calls } = fakeApi();
  const outcome = await run(deps(db, api, async () => {
    throw new GoogleApiError("TOKEN_INVALID", 401, "no refresh token", false);
  }), channelRow());
  assertEquals(outcome.status, "skipped");
  assertEquals(calls.length, 0);
  assertEquals(db.calls.length, 0);
});

Deno.test("youtube-sync: an unexpected token error propagates (counted as failed by the caller)", async () => {
  const db = createSupabaseQueryMock();
  const { api } = fakeApi();
  let threw = false;
  try {
    await run(deps(db, api, async () => {
      throw new GoogleApiError("UPSTREAM", 500, "boom");
    }), channelRow());
  } catch {
    threw = true;
  }
  assert(threw, "an UPSTREAM token failure must throw");
});

// ── step 2: channel info ────────────────────────────────────────────────────────

Deno.test("youtube-sync: refreshes title/handle/avatar/counts; hidden subscriber count keeps the stored value", async () => {
  const db = createSupabaseQueryMock();
  queueGuardPass(db);
  const { api } = quietApi({ getMyChannel: async () => ytChannel({ subscriberCount: null }) });
  const outcome = await run(deps(db, api), channelRow());
  assertEquals(outcome.status, "synced");
  const info = channelUpdates(db).find((p) => "title" in p)!;
  assertEquals(info.title, "Canal novo");
  assertEquals(info.avatar_url, "https://img/b.png");
  assertEquals(info.view_count, 2000);
  assertEquals(info.video_count, 11);
  assert(!("subscriber_count" in info), "a hidden subscriber count must not overwrite the stored value");
});

Deno.test("youtube-sync: channel-id mismatch returns mismatch and writes nothing", async () => {
  const db = createSupabaseQueryMock();
  queueGuardPass(db);
  const { api, calls } = fakeApi({ getMyChannel: async () => ytChannel({ id: "UC-other" }) });
  const outcome = await run(deps(db, api), channelRow());
  assertEquals(outcome.status, "mismatch");
  assertEquals(outcome.connectionRevoked, undefined);
  assertEquals(calls, ["getMyChannel"]);
  assertEquals(db.calls.length, 0);
});

Deno.test("youtube-sync: QUOTA_EXCEEDED on getMyChannel skips to analytics and returns quota_skipped (Review Focus 1)", async () => {
  const db = createSupabaseQueryMock();
  queueGuardPass(db);
  const { api, calls } = quietApi({
    getMyChannel: async () => {
      throw new GoogleApiError("QUOTA_EXCEEDED", 403, "quota");
    },
  });
  const outcome = await run(deps(db, api), channelRow());
  assertEquals(outcome.status, "quota_skipped");
  assert(!calls.includes("listUploads") && !calls.includes("getVideos"), "step 3 must be skipped");
  assert(calls.includes("channelDaily"), "analytics (step 4) still runs");
  for (const p of channelUpdates(db)) {
    assert(!("last_synced_at" in p), "quota_skipped must not set last_synced_at");
    assert(!("authorization_status" in p), "quota must never write a status");
  }
});

Deno.test("youtube-sync: a transient 429 is retried after 1 s, 2 s and 4 s, then the run completes", async () => {
  const db = createSupabaseQueryMock();
  queueGuardPass(db);
  let attempts = 0;
  const { api } = quietApi({
    getMyChannel: async () => {
      if (++attempts <= 3) throw new GoogleApiError("RATE_LIMITED", 429, "slow down");
      return ytChannel();
    },
  });
  const sleeps: number[] = [];
  const outcome = await run({ ...deps(db, api), sleep: async (ms: number) => void sleeps.push(ms) }, channelRow());
  assertEquals(outcome.status, "synced");
  assertEquals(sleeps, [1000, 2000, 4000]);
});

Deno.test("youtube-sync: a persistent 429 ends as quota_skipped after the retries, without last_synced_at (I-3)", async () => {
  const db = createSupabaseQueryMock();
  queueGuardPass(db);
  const { api, calls } = quietApi({
    channelDaily: async () => {
      throw new GoogleApiError("RATE_LIMITED", 429, "per-minute");
    },
  });
  const sleeps: number[] = [];
  const outcome = await run({ ...deps(db, api), sleep: async (ms: number) => void sleeps.push(ms) }, channelRow());
  assertEquals(outcome.status, "quota_skipped");
  assertEquals(sleeps, [1000, 2000, 4000]);
  assertEquals(calls.filter((c) => c === "channelDaily").length, 4);
  assertEquals(lastValue(db, "last_synced_at"), undefined);
  assert(!calls.includes("trafficDaily"), "the remaining Analytics calls are skipped");
});

// ── step 3: videos ──────────────────────────────────────────────────────────────

Deno.test("youtube-sync: a video missing from getVideos is deleted together with its daily rows", async () => {
  const db = createSupabaseQueryMock();
  queueGuardPass(db);
  // listUploads page: v-new (unknown), v-old (known) -> stop paging.
  db.queue("youtube_videos", "select", { data: [{ video_id: "v-old" }] }); // known ids on the page
  db.queue("youtube_videos", "select", { data: [{ video_id: "v-old", is_short: true }, { video_id: "v-gone", is_short: false }] }); // 90 days
  db.queue("youtube_videos", "select", { data: [] }); // 200 most recent
  db.queue("youtube_videos", "select", { data: [] }); // rotating batch
  db.queue("youtube_videos", "select", { data: [] }); // per-video lag (step 4)
  const requested: string[][] = [];
  const { api } = quietApi({
    listUploads: async () => ({ videoIds: ["v-new", "v-old"], nextPageToken: "next" }),
    getVideos: async (_t: string, ids: string[]) => {
      requested.push(ids);
      return [ytVideo("v-new"), ytVideo("v-old")];
    },
  });
  const outcome = await run(deps(db, api), channelRow());
  assertEquals(outcome.status, "synced");
  assertEquals(requested, [["v-new", "v-old", "v-gone"]]);

  const deletes = db.calls.filter((c) => c.operation === "delete" && c.table !== "youtube_demographics");
  assertEquals(deletes.map((c) => c.table), ["youtube_video_daily", "youtube_videos"]);
  for (const d of deletes) {
    assert(d.modifiers.some((m) => m.method === "in" && JSON.stringify(m.args) === JSON.stringify(["video_id", ["v-gone"]])));
  }
  const upsert = db.calls.find((c) => c.table === "youtube_videos" && c.operation === "upsert")!;
  assertEquals((upsert.payload as { video_id: string }[]).map((r) => r.video_id), ["v-new", "v-old"]);
});

Deno.test("youtube-sync: only ids requested in this run are deleted (an unrequested stored video survives)", async () => {
  const db = createSupabaseQueryMock();
  queueGuardPass(db);
  db.queue("youtube_videos", "select", { data: [{ video_id: "v-1" }] });
  const { api } = quietApi({
    listUploads: async () => ({ videoIds: ["v-1"], nextPageToken: null }),
    getVideos: async () => [ytVideo("v-1")],
  });
  await run(deps(db, api), channelRow());
  const deletes = db.calls.filter((c) => c.operation === "delete" && c.table !== "youtube_demographics");
  assertEquals(deletes.length, 0);
});

Deno.test("youtube-sync: is_short comes from the content-type report, live and zero-duration are not shorts", async () => {
  const db = createSupabaseQueryMock();
  queueGuardPass(db);
  db.queue("youtube_videos", "select", { data: [] }); // none known
  const { api } = quietApi({
    listUploads: async () => ({ videoIds: ["a", "b", "c", "d"], nextPageToken: null }),
    videoContentTypes: async () => new Map([["a", "long"], ["b", "shorts"]]),
    getVideos: async () => [
      ytVideo("a", { durationS: 30, isShortByDuration: true }), // report says long
      ytVideo("b", { durationS: 900, isShortByDuration: false }), // report says shorts
      ytVideo("c", { durationS: 0, isShortByDuration: true, liveBroadcastContent: "upcoming" }),
      ytVideo("d", { durationS: 60, isShortByDuration: true }), // not in the map -> duration
    ],
  });
  await run(deps(db, api), channelRow());
  const upsert = db.calls.find((c) => c.table === "youtube_videos" && c.operation === "upsert")!;
  const byId = Object.fromEntries((upsert.payload as { video_id: string; is_short: boolean }[]).map((r) => [r.video_id, r.is_short]));
  assertEquals(byId, { a: false, b: true, c: false, d: true });
});

Deno.test("youtube-sync: the content-type report is not refreshed twice a day (last_synced_at < 20 h)", async () => {
  const db = createSupabaseQueryMock();
  queueGuardPass(db);
  db.queue("youtube_videos", "select", { data: [] });
  const { api, calls } = quietApi({
    listUploads: async () => ({ videoIds: ["x"], nextPageToken: null }),
    getVideos: async () => [ytVideo("x")],
  });
  await run(deps(db, api), channelRow({ last_synced_at: "2026-10-30T08:00:00Z" }));
  assert(!calls.includes("videoContentTypes"));
});

Deno.test("youtube-sync: backfill stops listing uploads at 1,000 ids", async () => {
  const db = createSupabaseQueryMock();
  queueGuardPass(db);
  let page = 0;
  const { api, calls } = quietApi({
    listUploads: async () => {
      page++;
      return { videoIds: Array.from({ length: 50 }, (_, i) => `p${page}-${i}`), nextPageToken: "more" };
    },
    getVideos: async (_t: string, ids: string[]) => ids.map((id) => ytVideo(id)),
  });
  await run(deps(db, api), channelRow({ data_through: null }));
  assertEquals(calls.filter((c) => c === "listUploads").length, 20);
  const asked = calls.filter((c) => c === "getVideos").length;
  assertEquals(asked, 20, "1,000 ids in chunks of 50");
});

Deno.test("youtube-sync: a 404 on the uploads playlist (channel with no uploads) is not an error", async () => {
  const db = createSupabaseQueryMock();
  queueGuardPass(db);
  const { api } = quietApi({
    listUploads: async () => {
      throw new GoogleApiError("NOT_FOUND", 404, "playlistNotFound", false);
    },
  });
  const outcome = await run(deps(db, api), channelRow());
  assertEquals(outcome.status, "synced");
});

// ── step 4: analytics ───────────────────────────────────────────────────────────

Deno.test("youtube-sync: backfill window starts 365 days back when data_through is null", async () => {
  const db = createSupabaseQueryMock();
  queueGuardPass(db);
  const ranges: { start: string; end: string }[] = [];
  const { api } = quietApi({
    channelDaily: async (_t: string, range: { start: string; end: string }) => {
      ranges.push(range);
      return [];
    },
  });
  const outcome = await run(deps(db, api), channelRow({ data_through: null, content_type_through: null }));
  assertEquals(outcome.backfill, true);
  assertEquals(ranges[0], { start: "2025-10-30", end: YESTERDAY });
  // No row returned: data_through stays null and no split watermark can be derived.
  assertEquals(lastValue(db, "data_through"), undefined);
});

Deno.test("youtube-sync: incremental window is [data_through - 7, yesterday]", async () => {
  const db = createSupabaseQueryMock();
  queueGuardPass(db);
  const ranges: { start: string; end: string }[] = [];
  const { api } = quietApi({
    channelDaily: async (_t: string, range: { start: string; end: string }) => {
      ranges.push(range);
      return [];
    },
  });
  const outcome = await run(deps(db, api), channelRow({ data_through: "2026-10-20" }));
  assertEquals(outcome.backfill, false);
  assertEquals(ranges[0], { start: "2026-10-13", end: YESTERDAY });
});

Deno.test("youtube-sync: data_through advances to the last returned day; 'all' rows store content_type 'all' and nulls as returned", async () => {
  const db = createSupabaseQueryMock();
  queueGuardPass(db);
  const { api } = quietApi({
    channelDaily: async (_t: string, _r: unknown, byType: boolean) =>
      byType ? [] : [
        { day: "2026-10-28", contentType: null, views: 10, engagedViews: null, estimatedMinutesWatched: 3, likes: 1, comments: 0, shares: 0, subscribersGained: 1, subscribersLost: 0, averageViewDuration: 20 },
        { day: "2026-10-29", contentType: null, views: 11, engagedViews: 5, estimatedMinutesWatched: 4, likes: 2, comments: 0, shares: 0, subscribersGained: 0, subscribersLost: 0, averageViewDuration: 21 },
      ],
  });
  await run(deps(db, api), channelRow());
  assertEquals(lastValue(db, "data_through"), "2026-10-29");
  const upsert = db.calls.find((c) => c.table === "youtube_channel_daily" && c.operation === "upsert")!;
  const rows = upsert.payload as Record<string, unknown>[];
  assertEquals(rows.map((r) => r.content_type), ["all", "all"]);
  assertEquals(rows[0].engaged_views, null);
  assertEquals(rows[0].average_view_duration_s, 20);
});

Deno.test("youtube-sync: data_through never moves backwards", async () => {
  const db = createSupabaseQueryMock();
  queueGuardPass(db);
  const { api } = quietApi({
    channelDaily: async (_t: string, _r: unknown, byType: boolean) =>
      byType ? [] : [{ day: "2026-10-25", contentType: null, views: 1, engagedViews: 1, estimatedMinutesWatched: 1, likes: 0, comments: 0, shares: 0, subscribersGained: 0, subscribersLost: 0, averageViewDuration: 1 }],
  });
  await run(deps(db, api), channelRow({ data_through: "2026-10-28" }));
  const dt = lastValue(db, "data_through");
  assert(dt === undefined || dt === "2026-10-28", `data_through must not regress, got ${dt}`);
});

Deno.test("youtube-sync: no Shorts: a successful content-type call with zero rows still sets content_type_through", async () => {
  const db = createSupabaseQueryMock();
  queueGuardPass(db);
  const { api } = quietApi({
    channelDaily: async (_t: string, _r: unknown, byType: boolean) =>
      byType ? [] : [{ day: YESTERDAY, contentType: null, views: 1, engagedViews: 1, estimatedMinutesWatched: 1, likes: 0, comments: 0, shares: 0, subscribersGained: 0, subscribersLost: 0, averageViewDuration: 1 }],
  });
  await run(deps(db, api), channelRow({ content_type_through: "2026-10-01" }));
  assertEquals(lastValue(db, "content_type_through"), YESTERDAY);
  assertEquals(lastValue(db, "traffic_through"), YESTERDAY);
});

Deno.test("youtube-sync: a 400 on the content-type split is 'no split': no content_type_through, the rest continues", async () => {
  const db = createSupabaseQueryMock();
  queueGuardPass(db);
  const { api, calls } = quietApi({
    channelDaily: async (_t: string, _r: unknown, byType: boolean) => {
      if (byType) throw new GoogleApiError("UPSTREAM", 400, "unsupported dimension", false);
      return [{ day: YESTERDAY, contentType: null, views: 1, engagedViews: 1, estimatedMinutesWatched: 1, likes: 0, comments: 0, shares: 0, subscribersGained: 0, subscribersLost: 0, averageViewDuration: 1 }];
    },
  });
  const outcome = await run(deps(db, api), channelRow());
  assertEquals(outcome.status, "synced");
  assertEquals(lastValue(db, "content_type_through"), undefined);
  assertEquals(lastValue(db, "data_through"), YESTERDAY);
  assert(calls.includes("trafficDaily"));
});

Deno.test("youtube-sync: QUOTA_EXCEEDED mid-analytics keeps data_through, leaves traffic_through, no last_synced_at (Review Focus 1)", async () => {
  const db = createSupabaseQueryMock();
  queueGuardPass(db);
  const { api, calls } = quietApi({
    channelDaily: async (_t: string, _r: unknown, byType: boolean) => {
      if (byType) throw new GoogleApiError("QUOTA_EXCEEDED", 429, "RESOURCE_EXHAUSTED");
      return [{ day: YESTERDAY, contentType: null, views: 1, engagedViews: 1, estimatedMinutesWatched: 1, likes: 0, comments: 0, shares: 0, subscribersGained: 0, subscribersLost: 0, averageViewDuration: 1 }];
    },
  });
  const outcome = await run(deps(db, api), channelRow());
  assertEquals(outcome.status, "quota_skipped");
  assertEquals(lastValue(db, "data_through"), YESTERDAY);
  assertEquals(lastValue(db, "traffic_through"), undefined);
  assertEquals(lastValue(db, "last_synced_at"), undefined);
  assert(!calls.includes("trafficDaily") && !calls.includes("demographics") && !calls.includes("videoDaily"));
});

Deno.test("youtube-sync: demographics replace the channel's snapshot (delete, then upsert on the PK with window_end = yesterday)", async () => {
  const db = createSupabaseQueryMock();
  queueGuardPass(db);
  const ranges: unknown[] = [];
  const { api } = quietApi({
    demographics: async (_t: string, range: unknown) => {
      ranges.push(range);
      return [{ ageGroup: "age18-24", gender: "female", viewerPercentage: 40.5 }];
    },
  });
  await run(deps(db, api), channelRow());
  assertEquals(ranges, [{ start: "2026-10-02", end: YESTERDAY }]);
  const ops = db.calls.filter((c) => c.table === "youtube_demographics").map((c) => c.operation);
  assertEquals(ops, ["delete", "upsert"]);
  const insert = db.calls.find((c) => c.table === "youtube_demographics" && c.operation === "upsert")!;
  assertEquals((insert.options as { onConflict: string }).onConflict, "conta_id,channel_id,window_end,age_group,gender");
  assertEquals(insert.payload, [{ conta_id: CONTA, channel_id: "UC1", window_end: YESTERDAY, age_group: "age18-24", gender: "female", viewer_pct: 40.5 }]);
});

Deno.test("youtube-sync: video cap: with 41 lagging videos 40 reports run, one waits, videos_through not set", async () => {
  const db = createSupabaseQueryMock();
  queueGuardPass(db);
  // Step 3 reads (no uploads -> 3 stored-set reads + 2 head counts), then the lag read for step 4.
  db.queue("youtube_videos", "select", { data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] });
  const lagging = Array.from({ length: 41 }, (_, i) => ({ video_id: `v${i}`, daily_through: null, published_at: "2026-10-01T00:00:00Z" }));
  db.queue("youtube_videos", "select", { data: lagging });
  let reports = 0;
  const { api } = quietApi({
    channelDaily: async (_t: string, _r: unknown, byType: boolean) =>
      byType ? [] : [{ day: YESTERDAY, contentType: null, views: 1, engagedViews: 1, estimatedMinutesWatched: 1, likes: 0, comments: 0, shares: 0, subscribersGained: 0, subscribersLost: 0, averageViewDuration: 1 }],
    videoDaily: async () => {
      reports++;
      return [{ day: YESTERDAY, views: 1, engagedViews: 1, likes: 0, comments: 0, shares: 0, subscribersGained: 0, averageViewDuration: 3, averageViewPercentage: 50 }];
    },
  });
  const outcome = await run(deps(db, api), channelRow({ videos_through: "2026-10-01" }));
  assertEquals(outcome.status, "synced");
  assertEquals(reports, 40);
  assertEquals(lastValue(db, "videos_through"), undefined);
  const advanced = db.calls.filter((c) => c.table === "youtube_videos" && c.operation === "update");
  assertEquals(advanced.length, 40);
  assertEquals((advanced[0].payload as { daily_through: string }).daily_through, YESTERDAY);
});

Deno.test("youtube-sync: videos_through is set when no video lags", async () => {
  const db = createSupabaseQueryMock();
  queueGuardPass(db);
  db.queue("youtube_videos", "select", { data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] });
  db.queue("youtube_videos", "select", { data: [{ video_id: "v1", daily_through: YESTERDAY, published_at: "2026-10-01T00:00:00Z" }] });
  const { api, calls } = quietApi({
    channelDaily: async (_t: string, _r: unknown, byType: boolean) =>
      byType ? [] : [{ day: YESTERDAY, contentType: null, views: 1, engagedViews: 1, estimatedMinutesWatched: 1, likes: 0, comments: 0, shares: 0, subscribersGained: 0, subscribersLost: 0, averageViewDuration: 1 }],
  });
  await run(deps(db, api), channelRow());
  assert(!calls.includes("videoDaily"));
  assertEquals(lastValue(db, "videos_through"), YESTERDAY);
});

// ── step 5 + write guard ────────────────────────────────────────────────────────

Deno.test("youtube-sync: a full run sets last_synced_at, and every channel update is guarded on authorization_status = 'active'", async () => {
  const db = createSupabaseQueryMock();
  queueGuardPass(db);
  const { api } = quietApi();
  const outcome = await run(deps(db, api), channelRow());
  assertEquals(outcome.status, "synced");
  assertEquals(lastValue(db, "last_synced_at"), NOW.toISOString());
  for (const c of db.calls.filter((c) => c.table === "youtube_channels" && c.operation === "update")) {
    assert(c.modifiers.some((m) => m.method === "eq" && m.args[0] === "authorization_status" && m.args[1] === "active"));
    assert(c.modifiers.some((m) => m.method === "eq" && m.args[0] === "id" && m.args[1] === "ch-1"));
  }
});

Deno.test("youtube-sync: mid-run revoke (C2): guarded update returns 0 rows -> revoked, no history row written", async () => {
  const db = createSupabaseQueryMock();
  db.queue("youtube_channels", "update", { data: [] }); // the first guarded write after the token fetch
  const { api } = quietApi();
  const outcome = await run(deps(db, api), channelRow());
  assertEquals(outcome.status, "revoked");
  assertEquals(outcome.connectionRevoked, undefined, "a unit guard miss is not a connection revoke");
  assertEquals(historyCalls(db).filter((c) => c.operation !== "select").length, 0);
  assertEquals(channelUpdates(db).length, 1);
});

Deno.test("youtube-sync: mid-run revoke during analytics stops before the history upsert", async () => {
  const db = createSupabaseQueryMock();
  // step 2 guard ok, step 3 (no uploads, nothing to write) -> analytics: guard fails.
  db.queue("youtube_channels", "update", { data: [{ id: "ch-1" }] }, { data: [] });
  const { api } = quietApi({
    channelDaily: async () => [{ day: YESTERDAY, contentType: null, views: 1, engagedViews: 1, estimatedMinutesWatched: 1, likes: 0, comments: 0, shares: 0, subscribersGained: 0, subscribersLost: 0, averageViewDuration: 1 }],
  });
  const outcome = await run(deps(db, api), channelRow());
  assertEquals(outcome.status, "revoked");
  assertEquals(db.calls.filter((c) => c.table === "youtube_channel_daily").length, 0);
});

// ── Review Focus 3: tenant keys ─────────────────────────────────────────────────

Deno.test("youtube-sync: every history read, upsert, insert and delete carries the channel's conta_id (Review Focus 3)", async () => {
  const db = createSupabaseQueryMock();
  queueGuardPass(db);
  db.queue("youtube_videos", "select", { data: [{ video_id: "v-old" }] });
  db.queue("youtube_videos", "select", { data: [{ video_id: "v-gone", is_short: false }] }, { data: [] }, { data: [] });
  db.queue("youtube_videos", "select", { data: [], count: 2 }, { data: [], count: 0 }); // shorts / long head counts
  db.queue("youtube_videos", "select", { data: [{ video_id: "v-new", daily_through: null, published_at: "2026-10-20T00:00:00Z" }] });
  const dayRow = { day: YESTERDAY, contentType: null, views: 1, engagedViews: 1, estimatedMinutesWatched: 1, likes: 0, comments: 0, shares: 0, subscribersGained: 0, subscribersLost: 0, averageViewDuration: 1 };
  const { api } = quietApi({
    listUploads: async () => ({ videoIds: ["v-new", "v-old"], nextPageToken: null }),
    getVideos: async () => [ytVideo("v-new"), ytVideo("v-old")],
    channelDaily: async (_t: string, _r: unknown, byType: boolean) => byType ? [{ ...dayRow, contentType: "shorts" }] : [dayRow],
    trafficDaily: async () => [{ day: YESTERDAY, source: "SHORTS", views: 3 }],
    demographics: async () => [{ ageGroup: "age25-34", gender: "male", viewerPercentage: 10 }],
    videoDaily: async () => [{ day: YESTERDAY, views: 1, engagedViews: 1, likes: 0, comments: 0, shares: 0, subscribersGained: 0, averageViewDuration: 3, averageViewPercentage: 50 }],
  });
  const outcome = await run(deps(db, api), channelRow({ conta_id: "conta-b" }));
  assertEquals(outcome.status, "synced");

  const history = historyCalls(db);
  const tables = new Set(history.map((c) => `${c.table}:${c.operation}`));
  for (const expected of [
    "youtube_videos:select", "youtube_videos:upsert", "youtube_videos:delete", "youtube_videos:update",
    "youtube_video_daily:delete", "youtube_video_daily:upsert", "youtube_channel_daily:upsert",
    "youtube_traffic_daily:upsert", "youtube_demographics:delete", "youtube_demographics:upsert",
  ]) {
    assert(tables.has(expected), `expected a ${expected} call`);
  }
  for (const c of history) {
    if (c.operation === "upsert" || c.operation === "insert") {
      const rows = Array.isArray(c.payload) ? c.payload : [c.payload];
      for (const r of rows as Record<string, unknown>[]) {
        assertEquals(r.conta_id, "conta-b", `${c.table} ${c.operation} row without the tenant`);
        assertEquals(r.channel_id, "UC1");
      }
      if (c.operation === "upsert") {
        assert(String((c.options as { onConflict?: string })?.onConflict ?? "").startsWith("conta_id,"), `${c.table} upsert must conflict on the tenant key`);
      }
    } else {
      assert(
        c.modifiers.some((m) => m.method === "eq" && m.args[0] === "conta_id" && m.args[1] === "conta-b"),
        `${c.table} ${c.operation} without eq(conta_id)`,
      );
    }
  }
});

Deno.test("youtube-sync: Pacific dates: 2026-10-31 03:00 UTC is still 2026-10-30 in Los Angeles", async () => {
  const db = createSupabaseQueryMock();
  queueGuardPass(db);
  const ranges: { start: string; end: string }[] = [];
  const { api } = quietApi({
    channelDaily: async (_t: string, range: { start: string; end: string }) => {
      ranges.push(range);
      return [];
    },
  });
  await syncYouTubeChannel(
    { svc: db as never, api, getFreshGoogleToken: async () => "tok", now: () => NOW },
    channelRow(),
    { now: new Date("2026-10-31T03:00:00Z"), maxVideoReports: 40 },
  );
  assertEquals(ranges[0].end, YESTERDAY);
  assertEquals(TODAY, "2026-10-30");
});

// ── review follow-ups ───────────────────────────────────────────────────────────

Deno.test("youtube-sync: a stored is_short wins over the duration fallback even when the report ran and lacks the id", async () => {
  const db = createSupabaseQueryMock();
  queueGuardPass(db);
  db.queue("youtube_videos", "select", { data: [] }); // known ids: none (listUploads is empty anyway)
  db.queue("youtube_videos", "select", { data: [{ video_id: "v1", is_short: false }] }); // 90 days
  const { api, calls } = quietApi({
    getVideos: async () => [ytVideo("v1", { durationS: 60, isShortByDuration: true })],
    videoContentTypes: async () => new Map([["other", "shorts"]]),
  });
  await run(deps(db, api), channelRow());
  assert(calls.includes("videoContentTypes"), "the report ran this time");
  const upsert = db.calls.find((c) => c.table === "youtube_videos" && c.operation === "upsert")!;
  assertEquals((upsert.payload as { is_short: boolean }[])[0].is_short, false);
});

Deno.test("youtube-sync: duration fallback only when nothing is stored; live stays not-short over a stored true", async () => {
  const db = createSupabaseQueryMock();
  queueGuardPass(db);
  db.queue("youtube_videos", "select", { data: [{ video_id: "live", is_short: true }, { video_id: "fresh", is_short: null }] });
  const { api } = quietApi({
    getVideos: async () => [
      ytVideo("live", { durationS: 0, isShortByDuration: true, liveBroadcastContent: "live" }),
      ytVideo("fresh", { durationS: 60, isShortByDuration: true }),
    ],
    videoContentTypes: async () => null,
  });
  await run(deps(db, api), channelRow());
  const upsert = db.calls.find((c) => c.table === "youtube_videos" && c.operation === "upsert")!;
  const byId = Object.fromEntries((upsert.payload as { video_id: string; is_short: boolean }[]).map((r) => [r.video_id, r.is_short]));
  assertEquals(byId, { live: false, fresh: true });
});

Deno.test("youtube-sync: uploads paging stops at the page cap even when pages repeat ids", async () => {
  const db = createSupabaseQueryMock();
  queueGuardPass(db);
  const { api, calls } = quietApi({
    listUploads: async () => ({ videoIds: ["same"], nextPageToken: "again" }),
    getVideos: async () => [ytVideo("same")],
  });
  await run(deps(db, api), channelRow());
  assertEquals(calls.filter((c) => c === "listUploads").length, 25);
});

Deno.test("youtube-sync: the 90-day stored-videos reads are ordered newest first and bounded", async () => {
  const db = createSupabaseQueryMock();
  queueGuardPass(db);
  const { api } = quietApi();
  await run(deps(db, api), channelRow());
  const windowReads = db.calls.filter((c) =>
    c.table === "youtube_videos" && c.operation === "select" && c.modifiers.some((m) => m.method === "gte")
  );
  assertEquals(windowReads.length, 2, "step 3 refresh set + step 4 lag read");
  for (const c of windowReads) {
    assert(c.modifiers.some((m) => m.method === "order" && m.args[0] === "published_at" && (m.args[1] as { ascending: boolean }).ascending === false));
    assert(c.modifiers.some((m) => m.method === "limit" && m.args[0] === 1000));
  }
});

const ALL_ROW = { day: YESTERDAY, contentType: null, views: 1, engagedViews: 1, estimatedMinutesWatched: 1, likes: 0, comments: 0, shares: 0, subscribersGained: 0, subscribersLost: 0, averageViewDuration: 1 };
const VIDEO_ROW = { day: YESTERDAY, views: 1, engagedViews: 1, likes: 0, comments: 0, shares: 0, subscribersGained: 0, averageViewDuration: 3, averageViewPercentage: 50 };

function queueLagRead(db: Db, rows: unknown[]) {
  // 3 refresh-set reads + 2 head counts (no uploads), then the step-4 lag read.
  db.queue("youtube_videos", "select", { data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: rows });
}

Deno.test("youtube-sync: a 404 on one video's report leaves that video behind and the channel still syncs", async () => {
  const db = createSupabaseQueryMock();
  queueGuardPass(db);
  queueLagRead(db, [
    { video_id: "bad", daily_through: null, published_at: "2026-10-20T00:00:00Z" },
    { video_id: "ok", daily_through: null, published_at: "2026-10-19T00:00:00Z" },
  ]);
  const { api } = quietApi({
    channelDaily: async (_t: string, _r: unknown, byType: boolean) => byType ? [] : [ALL_ROW],
    videoDaily: async (_t: string, id: string) => {
      if (id === "bad") throw new GoogleApiError("NOT_FOUND", 404, "gone", false);
      return [VIDEO_ROW];
    },
  });
  const outcome = await run(deps(db, api), channelRow());
  assertEquals(outcome.status, "synced");
  const advanced = db.calls.filter((c) => c.table === "youtube_videos" && c.operation === "update");
  assertEquals(advanced.map((c) => c.modifiers.find((m) => m.args[0] === "video_id")!.args[1]), ["ok"]);
  assertEquals(lastValue(db, "videos_through"), undefined, "the rejected video is still uncovered");
});

Deno.test("youtube-sync: a 5xx on one video's report still fails the channel", async () => {
  const db = createSupabaseQueryMock();
  queueGuardPass(db);
  queueLagRead(db, [{ video_id: "v", daily_through: null, published_at: "2026-10-20T00:00:00Z" }]);
  const { api } = quietApi({
    channelDaily: async (_t: string, _r: unknown, byType: boolean) => byType ? [] : [ALL_ROW],
    videoDaily: async () => {
      throw new GoogleApiError("UPSTREAM", 503, "unavailable");
    },
  });
  let threw = false;
  try {
    await run(deps(db, api), channelRow());
  } catch {
    threw = true;
  }
  assert(threw);
});

Deno.test("youtube-sync: videos_through = oldest daily_through over in-window videos, capped at data_through", async () => {
  const db = createSupabaseQueryMock();
  queueGuardPass(db);
  queueLagRead(db, [
    { video_id: "never", daily_through: null, published_at: "2026-10-20T00:00:00Z" },
    { video_id: "behind", daily_through: "2026-10-20", published_at: "2026-10-01T00:00:00Z" },
  ]);
  const reported: string[] = [];
  const { api } = quietApi({
    channelDaily: async (_t: string, _r: unknown, byType: boolean) => byType ? [] : [ALL_ROW],
    videoDaily: async (_t: string, id: string) => {
      reported.push(id);
      return [VIDEO_ROW];
    },
  });
  // Cap 1: only the never-reported video runs; "behind" waits at 2026-10-20.
  await run(deps(db, api), channelRow({ videos_through: null }), 1);
  assertEquals(reported, ["never"]);
  assertEquals(lastValue(db, "videos_through"), "2026-10-20");
});

Deno.test("youtube-sync: an uncovered (never-reported) in-window video keeps videos_through unchanged", async () => {
  const db = createSupabaseQueryMock();
  queueGuardPass(db);
  queueLagRead(db, [
    { video_id: "a", daily_through: null, published_at: "2026-10-20T00:00:00Z" },
    { video_id: "b", daily_through: null, published_at: "2026-10-19T00:00:00Z" },
  ]);
  const { api } = quietApi({
    channelDaily: async (_t: string, _r: unknown, byType: boolean) => byType ? [] : [ALL_ROW],
    videoDaily: async () => [VIDEO_ROW],
  });
  await run(deps(db, api), channelRow(), 1);
  assertEquals(lastValue(db, "videos_through"), undefined);
});

Deno.test("youtube-sync: shorts_count / long_count come from tenant-scoped head counts, written behind the guard", async () => {
  const db = createSupabaseQueryMock();
  queueGuardPass(db);
  db.queue("youtube_videos", "select", { data: [] }, { data: [] }, { data: [] }, { data: [], count: 7 }, { data: [], count: 3 });
  const { api } = quietApi();
  await run(deps(db, api), channelRow());
  const counts = db.calls.filter((c) => c.table === "youtube_videos" && c.selectArgs.some((a) => (a[1] as { head?: boolean })?.head === true));
  assertEquals(counts.length, 2);
  for (const c of counts) {
    assert(c.modifiers.some((m) => m.method === "eq" && m.args[0] === "conta_id" && m.args[1] === CONTA));
    assert(c.modifiers.some((m) => m.method === "eq" && m.args[0] === "channel_id" && m.args[1] === "UC1"));
  }
  assertEquals(counts.map((c) => c.modifiers.find((m) => m.args[0] === "is_short")!.args[1]), [true, false]);
  const write = db.calls.find((c) => c.table === "youtube_channels" && c.operation === "update" && "shorts_count" in (c.payload as object))!;
  assertEquals(write.payload && { s: (write.payload as Record<string, unknown>).shorts_count, l: (write.payload as Record<string, unknown>).long_count }, { s: 7, l: 3 });
  assert(write.modifiers.some((m) => m.method === "eq" && m.args[0] === "authorization_status" && m.args[1] === "active"));
});

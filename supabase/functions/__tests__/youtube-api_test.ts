// _shared/youtube-api.ts: YouTube Data v3 + Analytics v2 client. Every function takes an injected
// fetchJson (googleFetch in production), so these tests assert the URL each call builds and how
// the canned response is parsed. Analytics rows are always matched to columns by name.
import { assert, assertEquals } from "./assert.ts";
import { GoogleApiError } from "../_shared/google.ts";
import {
  channelDaily,
  demographics,
  getMyChannel,
  getVideos,
  listUploads,
  parseIsoDuration,
  trafficDaily,
  videoContentTypes,
  videoDaily,
} from "../_shared/youtube-api.ts";

type Call = { url: URL; token: string };

function fakeFetch(responses: unknown | unknown[]) {
  const calls: Call[] = [];
  const queue = Array.isArray(responses) ? [...responses] : [responses];
  const fetchJson = (url: string, token: string): Promise<unknown> => {
    calls.push({ url: new URL(url), token });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next);
  };
  return { fetchJson, calls };
}

const RANGE = { start: "2026-10-01", end: "2026-10-03" };

const headers = (...names: string[]) => names.map((name) => ({ name, columnType: "METRIC", dataType: "INTEGER" }));

// --- parseIsoDuration ---

Deno.test("parseIsoDuration handles PT1M5S, hours, days and empty durations", () => {
  assertEquals(parseIsoDuration("PT1M5S"), 65);
  assertEquals(parseIsoDuration("PT45S"), 45);
  assertEquals(parseIsoDuration("PT1H2M3S"), 3723);
  assertEquals(parseIsoDuration("PT10M"), 600);
  assertEquals(parseIsoDuration("P1DT1S"), 86401);
  assertEquals(parseIsoDuration("P0D"), 0);
  assertEquals(parseIsoDuration("garbage"), 0);
  assertEquals(parseIsoDuration(undefined), 0);
});

// --- getMyChannel ---

Deno.test("getMyChannel requests mine=true with the three parts and parses the first item", async () => {
  const { fetchJson, calls } = fakeFetch({
    items: [
      {
        id: "UC123",
        snippet: { title: "Canal", customUrl: "@canal", thumbnails: { default: { url: "https://img/a.jpg" } } },
        statistics: { subscriberCount: "1200", viewCount: "99000", videoCount: "42" },
        contentDetails: { relatedPlaylists: { uploads: "UU123" } },
      },
    ],
  });
  const channel = await getMyChannel("tok", fetchJson);
  assertEquals(channel, {
    id: "UC123",
    title: "Canal",
    handle: "@canal",
    avatarUrl: "https://img/a.jpg",
    uploadsPlaylistId: "UU123",
    subscriberCount: 1200,
    viewCount: 99000,
    videoCount: 42,
  });
  assertEquals(calls.length, 1);
  assertEquals(calls[0].token, "tok");
  assertEquals(calls[0].url.origin + calls[0].url.pathname, "https://www.googleapis.com/youtube/v3/channels");
  assertEquals(calls[0].url.searchParams.get("mine"), "true");
  assertEquals(calls[0].url.searchParams.get("part"), "snippet,statistics,contentDetails");
});

Deno.test("getMyChannel returns null on empty items and on an empty body", async () => {
  assertEquals(await getMyChannel("t", fakeFetch({ items: [] }).fetchJson), null);
  assertEquals(await getMyChannel("t", fakeFetch({}).fetchJson), null);
  assertEquals(await getMyChannel("t", fakeFetch(null).fetchJson), null);
});

Deno.test("getMyChannel maps hidden subscriber count and missing fields to null", async () => {
  const { fetchJson } = fakeFetch({
    items: [{ id: "UC1", statistics: { hiddenSubscriberCount: true, subscriberCount: "0", viewCount: "5" } }],
  });
  const channel = await getMyChannel("t", fetchJson);
  assertEquals(channel?.subscriberCount, null);
  assertEquals(channel?.viewCount, 5);
  assertEquals(channel?.videoCount, null);
  assertEquals(channel?.title, null);
  assertEquals(channel?.uploadsPlaylistId, null);
});

// --- listUploads ---

Deno.test("listUploads pages 50 at a time and returns the next page token", async () => {
  const { fetchJson, calls } = fakeFetch({
    items: [{ contentDetails: { videoId: "v1" } }, { contentDetails: { videoId: "v2" } }, { contentDetails: {} }],
    nextPageToken: "NEXT",
  });
  const page = await listUploads("tok", "UU123", { pageToken: "PREV" }, fetchJson);
  assertEquals(page, { videoIds: ["v1", "v2"], nextPageToken: "NEXT" });
  const { url } = calls[0];
  assertEquals(url.origin + url.pathname, "https://www.googleapis.com/youtube/v3/playlistItems");
  assertEquals(url.searchParams.get("playlistId"), "UU123");
  assertEquals(url.searchParams.get("maxResults"), "50");
  assertEquals(url.searchParams.get("part"), "contentDetails");
  assertEquals(url.searchParams.get("pageToken"), "PREV");
});

Deno.test("listUploads omits pageToken on the first page and ends with a null token", async () => {
  const { fetchJson, calls } = fakeFetch({ items: [{ contentDetails: { videoId: "v1" } }] });
  const page = await listUploads("tok", "UU1", {}, fetchJson);
  assertEquals(page, { videoIds: ["v1"], nextPageToken: null });
  assertEquals(calls[0].url.searchParams.has("pageToken"), false);
});

// --- getVideos ---

Deno.test("getVideos requests the three parts, joins ids and parses duration and the short flag", async () => {
  const { fetchJson, calls } = fakeFetch({
    items: [
      {
        id: "a",
        snippet: {
          title: "Curto",
          publishedAt: "2026-10-01T10:00:00Z",
          thumbnails: { medium: { url: "https://img/m.jpg" }, default: { url: "https://img/d.jpg" } },
          liveBroadcastContent: "none",
        },
        contentDetails: { duration: "PT59S" },
        statistics: { viewCount: "10", likeCount: "2", commentCount: "1" },
      },
      {
        id: "b",
        snippet: { title: "Longo", publishedAt: "2026-10-02T10:00:00Z" },
        contentDetails: { duration: "PT3M1S" },
        statistics: { viewCount: "7" },
      },
      {
        id: "c",
        snippet: { title: "Limite", publishedAt: "2026-10-03T10:00:00Z" },
        contentDetails: { duration: "PT3M" },
        statistics: {},
      },
    ],
  });
  const videos = await getVideos("tok", ["a", "b", "c"], fetchJson);
  const { url } = calls[0];
  assertEquals(url.origin + url.pathname, "https://www.googleapis.com/youtube/v3/videos");
  assertEquals(url.searchParams.get("id"), "a,b,c");
  assertEquals(url.searchParams.get("part"), "snippet,contentDetails,statistics");
  assertEquals(videos.length, 3);
  assertEquals(videos[0], {
    id: "a",
    title: "Curto",
    publishedAt: "2026-10-01T10:00:00Z",
    thumbnailUrl: "https://img/m.jpg",
    durationS: 59,
    isShortByDuration: true,
    liveBroadcastContent: "none",
    viewCount: 10,
    likeCount: 2,
    commentCount: 1,
  });
  assertEquals(videos[1].durationS, 181);
  assertEquals(videos[1].isShortByDuration, false);
  assertEquals(videos[1].likeCount, null);
  assertEquals(videos[2].durationS, 180);
  assertEquals(videos[2].isShortByDuration, true);
});

Deno.test("getVideos refuses more than 50 ids and skips the call for none", async () => {
  const { fetchJson, calls } = fakeFetch({ items: [] });
  assertEquals(await getVideos("t", [], fetchJson), []);
  assertEquals(calls.length, 0);
  const ids = Array.from({ length: 51 }, (_, i) => `v${i}`);
  let threw = false;
  try {
    await getVideos("t", ids, fetchJson);
  } catch {
    threw = true;
  }
  assert(threw, "51 ids must be refused");
  assertEquals(calls.length, 0);
});

// --- channelDaily ---

Deno.test("channelDaily (all) builds the Analytics URL and parses by column name, not position", async () => {
  const { fetchJson, calls } = fakeFetch({
    // Deliberately shuffled relative to the request order.
    columnHeaders: [
      ...headers("subscribersLost", "views"),
      { name: "day", columnType: "DIMENSION", dataType: "STRING" },
      ...headers(
        "likes",
        "estimatedMinutesWatched",
        "engagedViews",
        "shares",
        "comments",
        "averageViewDuration",
        "subscribersGained",
      ),
    ],
    rows: [[1, 100, "2026-10-01", 7, 300, 80, 3, 5, 55.5, 9]],
  });
  const rows = await channelDaily("tok", RANGE, false, fetchJson);
  assertEquals(rows, [
    {
      day: "2026-10-01",
      contentType: null,
      views: 100,
      engagedViews: 80,
      estimatedMinutesWatched: 300,
      likes: 7,
      comments: 5,
      shares: 3,
      subscribersGained: 9,
      subscribersLost: 1,
      averageViewDuration: 55.5,
    },
  ]);
  const { url } = calls[0];
  assertEquals(url.origin + url.pathname, "https://youtubeanalytics.googleapis.com/v2/reports");
  assertEquals(url.searchParams.get("ids"), "channel==MINE");
  assertEquals(url.searchParams.get("startDate"), "2026-10-01");
  assertEquals(url.searchParams.get("endDate"), "2026-10-03");
  assertEquals(url.searchParams.get("dimensions"), "day");
  assertEquals(url.searchParams.get("sort"), "day");
  assertEquals(
    url.searchParams.get("metrics"),
    "views,engagedViews,estimatedMinutesWatched,likes,comments,shares,subscribersGained,subscribersLost,averageViewDuration",
  );
});

Deno.test("channelDaily by content type maps SHORTS/VIDEO_ON_DEMAND/LIVE_STREAM and drops unknown values", async () => {
  const { fetchJson, calls } = fakeFetch({
    columnHeaders: [
      { name: "day", columnType: "DIMENSION", dataType: "STRING" },
      { name: "creatorContentType", columnType: "DIMENSION", dataType: "STRING" },
      ...headers("views"),
    ],
    rows: [
      ["2026-10-01", "SHORTS", 10],
      ["2026-10-01", "VIDEO_ON_DEMAND", 20],
      ["2026-10-01", "LIVE_STREAM", 30],
      ["2026-10-01", "STORY", 40],
      ["2026-10-01", "CREATOR_CONTENT_TYPE_UNSPECIFIED", 50],
    ],
  });
  const rows = await channelDaily("tok", RANGE, true, fetchJson);
  assertEquals(
    rows.map((r) => [r.contentType, r.views]),
    [
      ["shorts", 10],
      ["long", 20],
      ["live", 30],
    ],
  );
  // A metric the response did not return is null, not 0.
  assertEquals(rows[0].engagedViews, null);
  assertEquals(calls[0].url.searchParams.get("dimensions"), "day,creatorContentType");
});

Deno.test("channelDaily returns [] when the report has no rows, and propagates API errors", async () => {
  assertEquals(await channelDaily("t", RANGE, false, fakeFetch({ columnHeaders: headers("views") }).fetchJson), []);
  assertEquals(await channelDaily("t", RANGE, false, fakeFetch(null).fetchJson), []);
  const err = new GoogleApiError("RATE_LIMITED", 429);
  let caught: unknown = null;
  try {
    await channelDaily("t", RANGE, false, fakeFetch(err).fetchJson);
  } catch (e) {
    caught = e;
  }
  assert(caught === err, "errors from fetchJson propagate untouched");
});

// --- trafficDaily / demographics / videoDaily ---

Deno.test("trafficDaily uses day,insightTrafficSourceType with views and parses by name", async () => {
  const { fetchJson, calls } = fakeFetch({
    columnHeaders: [
      { name: "insightTrafficSourceType", columnType: "DIMENSION", dataType: "STRING" },
      ...headers("views"),
      { name: "day", columnType: "DIMENSION", dataType: "STRING" },
    ],
    rows: [
      ["YT_SEARCH", 12, "2026-10-02"],
      ["SHORTS", 30, "2026-10-02"],
    ],
  });
  const rows = await trafficDaily("tok", RANGE, fetchJson);
  assertEquals(rows, [
    { day: "2026-10-02", source: "YT_SEARCH", views: 12 },
    { day: "2026-10-02", source: "SHORTS", views: 30 },
  ]);
  const { url } = calls[0];
  assertEquals(url.searchParams.get("dimensions"), "day,insightTrafficSourceType");
  assertEquals(url.searchParams.get("metrics"), "views");
  assertEquals(url.searchParams.get("ids"), "channel==MINE");
});

Deno.test("demographics uses ageGroup,gender with viewerPercentage", async () => {
  const { fetchJson, calls } = fakeFetch({
    columnHeaders: [
      { name: "gender", columnType: "DIMENSION", dataType: "STRING" },
      { name: "ageGroup", columnType: "DIMENSION", dataType: "STRING" },
      ...headers("viewerPercentage"),
    ],
    rows: [
      ["female", "age25-34", 41.5],
      ["male", "age18-24", 12],
    ],
  });
  const rows = await demographics("tok", RANGE, fetchJson);
  assertEquals(rows, [
    { ageGroup: "age25-34", gender: "female", viewerPercentage: 41.5 },
    { ageGroup: "age18-24", gender: "male", viewerPercentage: 12 },
  ]);
  const { url } = calls[0];
  assertEquals(url.searchParams.get("dimensions"), "ageGroup,gender");
  assertEquals(url.searchParams.get("metrics"), "viewerPercentage");
});

Deno.test("videoDaily filters by video and requests the per-video metrics", async () => {
  const { fetchJson, calls } = fakeFetch({
    columnHeaders: [
      ...headers("averageViewPercentage", "views"),
      { name: "day", columnType: "DIMENSION", dataType: "STRING" },
      ...headers("engagedViews", "likes", "comments", "shares", "subscribersGained", "averageViewDuration"),
    ],
    rows: [[88.2, 50, "2026-10-01", 40, 5, 2, 1, 3, 17]],
  });
  const rows = await videoDaily("tok", "vid1", RANGE, fetchJson);
  assertEquals(rows, [
    {
      day: "2026-10-01",
      views: 50,
      engagedViews: 40,
      likes: 5,
      comments: 2,
      shares: 1,
      subscribersGained: 3,
      averageViewDuration: 17,
      averageViewPercentage: 88.2,
    },
  ]);
  const { url } = calls[0];
  assertEquals(url.searchParams.get("filters"), "video==vid1");
  assertEquals(url.searchParams.get("dimensions"), "day");
  assertEquals(
    url.searchParams.get("metrics"),
    "views,engagedViews,likes,comments,shares,subscribersGained,averageViewDuration,averageViewPercentage",
  );
});

// --- videoContentTypes ---

Deno.test("videoContentTypes uses the Top videos report: sort=-views, maxResults=200, no filters", async () => {
  const { fetchJson, calls } = fakeFetch({
    columnHeaders: [
      ...headers("views"),
      { name: "creatorContentType", columnType: "DIMENSION", dataType: "STRING" },
      { name: "video", columnType: "DIMENSION", dataType: "STRING" },
    ],
    rows: [
      [900, "SHORTS", "v1"],
      [500, "VIDEO_ON_DEMAND", "v2"],
      [100, "LIVE_STREAM", "v3"],
      [50, "WHATEVER", "v4"],
    ],
  });
  const map = await videoContentTypes("tok", { start: "2019-01-01", end: "2026-10-29" }, fetchJson);
  assert(map instanceof Map);
  assertEquals(
    [...map.entries()],
    [
      ["v1", "shorts"],
      ["v2", "long"],
      ["v3", "live"],
    ],
  );
  const { url } = calls[0];
  assertEquals(url.searchParams.get("dimensions"), "video,creatorContentType");
  assertEquals(url.searchParams.get("metrics"), "views");
  assertEquals(url.searchParams.get("sort"), "-views");
  assertEquals(url.searchParams.get("maxResults"), "200");
  assertEquals(url.searchParams.get("startDate"), "2019-01-01");
  assertEquals(url.searchParams.get("endDate"), "2026-10-29");
  assertEquals(url.searchParams.has("filters"), false);
});

Deno.test("videoContentTypes is best-effort: null on a 400, other errors propagate", async () => {
  const bad = new GoogleApiError("UPSTREAM", 400, "bad request", false);
  assertEquals(await videoContentTypes("t", RANGE, fakeFetch(bad).fetchJson), null);

  const server = new GoogleApiError("UPSTREAM", 503);
  let caught: unknown = null;
  try {
    await videoContentTypes("t", RANGE, fakeFetch(server).fetchJson);
  } catch (e) {
    caught = e;
  }
  assert(caught === server, "a 5xx is not swallowed");

  const forbidden = new GoogleApiError("FORBIDDEN", 403);
  caught = null;
  try {
    await videoContentTypes("t", RANGE, fakeFetch(forbidden).fetchJson);
  } catch (e) {
    caught = e;
  }
  assert(caught === forbidden, "a 403 is not swallowed");
});

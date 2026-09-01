import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ingestStories } from "../story-ingest.ts";

function mockFetch(responses: Record<string, unknown>): typeof fetch {
  return ((url: string | URL | Request) => {
    const u = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
    for (const [pattern, body] of Object.entries(responses)) {
      if (u.includes(pattern)) {
        return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
      }
    }
    return Promise.resolve(new Response("{}", { status: 404 }));
  }) as typeof fetch;
}

const ACCOUNT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function mockDb(upserted: unknown[]) {
  return {
    from: () => ({
      upsert: (rows: unknown) => {
        upserted.push(rows);
        return { error: null };
      },
    }),
    // deno-lint-ignore no-explicit-any
  } as any;
}

Deno.test("ingestStories returns daily aggregates from active stories", async () => {
  const storyTimestamp = "2026-09-01T10:00:00+0000";
  const storyId = "17901234567890";

  const fetchFn = mockFetch({
    "me/stories": {
      data: [{
        id: storyId,
        media_type: "IMAGE",
        thumbnail_url: "https://example.com/thumb.jpg",
        timestamp: storyTimestamp,
      }],
    },
    [`${storyId}/insights`]: {
      data: [
        { name: "reach", values: [{ value: 500 }] },
        { name: "impressions", values: [{ value: 800 }] },
        { name: "replies", values: [{ value: 3 }] },
        { name: "taps_forward", values: [{ value: 200 }] },
        { name: "taps_back", values: [{ value: 50 }] },
        { name: "exits", values: [{ value: 100 }] },
        { name: "shares", values: [{ value: 10 }] },
      ],
    },
  });

  const upserted: unknown[] = [];

  const result = await ingestStories({
    fetchFn,
    accountId: ACCOUNT_ID,
    accessToken: "fake-token",
    db: mockDb(upserted),
    cacheThumb: (_accountId, _mediaId, url) => Promise.resolve(url),
  });

  assertEquals(result.length, 1);
  assertEquals(result[0].snapshot_date, "2026-09-01");
  assertEquals(result[0].stories_count_day, 1);
  assertEquals(result[0].stories_reach_day, 500);
  assertEquals(result[0].stories_impressions_day, 800);
  assertEquals(result[0].stories_replies_day, 3);
  assertEquals(result[0].stories_taps_forward_day, 200);
  assertEquals(result[0].stories_taps_back_day, 50);
  assertEquals(result[0].stories_exits_day, 100);

  // The individual story row was upserted with the shares metric included.
  assertEquals(upserted.length, 1);
  // deno-lint-ignore no-explicit-any
  const rows = upserted[0] as any[];
  assertEquals(rows.length, 1);
  assertEquals(rows[0].instagram_account_id, ACCOUNT_ID);
  assertEquals(rows[0].instagram_media_id, storyId);
  assertEquals(rows[0].shares, 10);
});

Deno.test("ingestStories returns empty on me/stories failure", async () => {
  const fetchFn = mockFetch({
    "me/stories": { error: { message: "token expired", code: 190 } },
  });
  const upserted: unknown[] = [];

  const result = await ingestStories({
    fetchFn,
    accountId: ACCOUNT_ID,
    accessToken: "fake-token",
    db: mockDb(upserted),
    cacheThumb: (_a, _b, url) => Promise.resolve(url),
  });

  assertEquals(result, []);
  assertEquals(upserted.length, 0);
});

Deno.test("ingestStories retries without shares on share-related error", async () => {
  const storyId = "17901234567891";
  let callCount = 0;

  const fetchFn = ((url: string | URL | Request) => {
    const u = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
    if (u.includes("me/stories")) {
      return Promise.resolve(new Response(JSON.stringify({
        data: [{ id: storyId, media_type: "IMAGE", thumbnail_url: null, timestamp: "2026-09-01T10:00:00+0000" }],
      }), { status: 200 }));
    }
    if (u.includes(`${storyId}/insights`)) {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(new Response(JSON.stringify({
          error: { message: "Cannot read property 'share' of undefined" },
        }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({
        data: [
          { name: "reach", values: [{ value: 100 }] },
          { name: "impressions", values: [{ value: 200 }] },
          { name: "replies", values: [{ value: 0 }] },
          { name: "taps_forward", values: [{ value: 50 }] },
          { name: "taps_back", values: [{ value: 10 }] },
          { name: "exits", values: [{ value: 30 }] },
        ],
      }), { status: 200 }));
    }
    return Promise.resolve(new Response("{}", { status: 404 }));
  }) as typeof fetch;

  const upserted: unknown[] = [];

  const result = await ingestStories({
    fetchFn,
    accountId: ACCOUNT_ID,
    accessToken: "fake-token",
    db: mockDb(upserted),
    cacheThumb: (_a, _b, url) => Promise.resolve(url),
  });

  assertEquals(callCount, 2);
  assertEquals(result.length, 1);
  assertEquals(result[0].stories_reach_day, 100);

  // Retried row still gets upserted, with shares left null (not fetched).
  // deno-lint-ignore no-explicit-any
  const rows = upserted[0] as any[];
  assertEquals(rows.length, 1);
  assertEquals(rows[0].shares, null);
});

Deno.test("ingestStories excludes stories with no insight data from upsert and daily aggregates", async () => {
  const storyIdOk = "17900000000001";
  const storyIdFails = "17900000000002";

  const fetchFn = mockFetch({
    "me/stories": {
      data: [
        { id: storyIdOk, media_type: "IMAGE", thumbnail_url: null, timestamp: "2026-09-01T09:00:00+0000" },
        { id: storyIdFails, media_type: "IMAGE", thumbnail_url: null, timestamp: "2026-09-01T11:00:00+0000" },
      ],
    },
    [`${storyIdOk}/insights`]: {
      data: [
        { name: "reach", values: [{ value: 60 }] },
        { name: "impressions", values: [{ value: 90 }] },
        { name: "replies", values: [{ value: 1 }] },
        { name: "taps_forward", values: [{ value: 5 }] },
        { name: "taps_back", values: [{ value: 2 }] },
        { name: "exits", values: [{ value: 3 }] },
        { name: "shares", values: [{ value: 0 }] },
      ],
    },
    // storyIdFails/insights is intentionally absent from `responses`, so
    // mockFetch falls through to its 404-with-"{}" default — simulating a
    // transient per-story insight failure that never populates any metric.
  });

  const upserted: unknown[] = [];

  const result = await ingestStories({
    fetchFn,
    accountId: ACCOUNT_ID,
    accessToken: "fake-token",
    db: mockDb(upserted),
    cacheThumb: (_a, _b, url) => Promise.resolve(url),
  });

  // Only the story with actual data was upserted -- the failed one must not
  // overwrite any existing row with nulls.
  assertEquals(upserted.length, 1);
  // deno-lint-ignore no-explicit-any
  const rows = upserted[0] as any[];
  assertEquals(rows.length, 1);
  assertEquals(rows[0].instagram_media_id, storyIdOk);

  // The daily aggregate counts only the story we have data for, not a
  // fabricated zero for the failed one.
  assertEquals(result.length, 1);
  assertEquals(result[0].stories_count_day, 1);
  assertEquals(result[0].stories_reach_day, 60);
});

Deno.test("ingestStories caches ephemeral Instagram CDN thumbnails via cacheThumb", async () => {
  const storyId = "17900000000099";
  const cdnUrl = "https://scontent.cdninstagram.com/v/story-thumb.jpg";
  const cachedUrl = "https://storage.example.com/cached/story-thumb.jpg";

  const fetchFn = mockFetch({
    "me/stories": {
      data: [{ id: storyId, media_type: "IMAGE", thumbnail_url: cdnUrl, timestamp: "2026-09-01T12:00:00+0000" }],
    },
    [`${storyId}/insights`]: {
      data: [
        { name: "reach", values: [{ value: 10 }] },
        { name: "impressions", values: [{ value: 20 }] },
      ],
    },
  });

  const cacheCalls: Array<[string, string, string]> = [];
  const upserted: unknown[] = [];

  await ingestStories({
    fetchFn,
    accountId: ACCOUNT_ID,
    accessToken: "fake-token",
    db: mockDb(upserted),
    cacheThumb: (accId, mediaId, url) => {
      cacheCalls.push([accId, mediaId, url]);
      return Promise.resolve(cachedUrl);
    },
  });

  assertEquals(cacheCalls.length, 1);
  assertEquals(cacheCalls[0], [ACCOUNT_ID, storyId, cdnUrl]);

  // deno-lint-ignore no-explicit-any
  const rows = upserted[0] as any[];
  assertEquals(rows[0].thumbnail_url, cachedUrl);
});

Deno.test("ingestStories does not call cacheThumb for already-stable thumbnail URLs", async () => {
  const storyId = "17900000000100";
  const stableUrl = "https://example.com/already-cached.jpg";

  const fetchFn = mockFetch({
    "me/stories": {
      data: [{ id: storyId, media_type: "IMAGE", thumbnail_url: stableUrl, timestamp: "2026-09-01T12:00:00+0000" }],
    },
    [`${storyId}/insights`]: {
      data: [{ name: "reach", values: [{ value: 5 }] }],
    },
  });

  let cacheCallCount = 0;
  const upserted: unknown[] = [];

  await ingestStories({
    fetchFn,
    accountId: ACCOUNT_ID,
    accessToken: "fake-token",
    db: mockDb(upserted),
    cacheThumb: (_a, _b, url) => {
      cacheCallCount++;
      return Promise.resolve(url);
    },
  });

  assertEquals(cacheCallCount, 0);
  // deno-lint-ignore no-explicit-any
  const rows = upserted[0] as any[];
  assertEquals(rows[0].thumbnail_url, stableUrl);
});

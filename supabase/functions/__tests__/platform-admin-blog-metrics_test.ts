import { assert, assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { handleBlogMetrics, handleBlogPostMetrics } from "../platform-admin/blog-metrics.ts";

const H = { "Content-Type": "application/json" };

// The handlers log the raw rpc error internally; keep that out of the test output.
async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = original;
  }
}
// Empty Search Console side, for the tests that only care about views.
function queueNoSearch(db: ReturnType<typeof createSupabaseQueryMock>) {
  db.queueRpc("blog_search_stats", { data: [] });
  db.queue("blog_index_status", "select", { data: [] });
  db.queue("blog_search_runs", "select", { data: null });
}
function queueNoSeries(db: ReturnType<typeof createSupabaseQueryMock>) {
  db.queueRpc("blog_search_series", { data: [] });
  db.queue("blog_search_daily", "select", { data: null });
}
// 2026-10-27 15:00 em São Paulo (UTC-3).
const NOW = new Date("2026-10-27T18:00:00Z");

Deno.test("blog-metrics: coerces bigint strings and keys by slug", async () => {
  const db = createSupabaseQueryMock();
  queueNoSearch(db);
  db.queueRpc("blog_view_stats", {
    data: [
      { slug: "post-a", views_7d: "3", views_30d: "12", views_total: "210" },
      { slug: "post-b", views_7d: 0, views_30d: 1, views_total: 5 },
    ],
  });
  const res = await handleBlogMetrics(db as never, H);
  assertEquals(res.status, 200);
  assertEquals(await readJson(res), {
    gsc_updated_at: null,
    posts: {
      "post-a": { views_7d: 3, views_30d: 12, views_total: 210, search: null, index: null },
      "post-b": { views_7d: 0, views_30d: 1, views_total: 5, search: null, index: null },
    },
  });
  assert(db.calls.some((c) => c.table === "rpc:blog_view_stats"), "rpc not called");
});

Deno.test("blog-metrics: slugs without views are absent, null data is empty", async () => {
  const db = createSupabaseQueryMock();
  queueNoSearch(db);
  db.queueRpc("blog_view_stats", { data: null });
  const res = await handleBlogMetrics(db as never, H);
  assertEquals(await readJson(res), { gsc_updated_at: null, posts: {} });
});

Deno.test("blog-metrics: junk numbers become 0", async () => {
  const db = createSupabaseQueryMock();
  queueNoSearch(db);
  db.queueRpc("blog_view_stats", {
    data: [{ slug: "x", views_7d: "abc", views_30d: null, views_total: -4 }],
  });
  const body = await readJson(await handleBlogMetrics(db as never, H));
  assertEquals(body.posts.x, { views_7d: 0, views_30d: 0, views_total: 0, search: null, index: null });
});

Deno.test("blog-metrics: rpc error is a generic 500", async () => {
  const db = createSupabaseQueryMock();
  queueNoSearch(db);
  db.queueRpc("blog_view_stats", { data: null, error: { message: "secret detail" } });
  const res = await quietly(() => handleBlogMetrics(db as never, H));
  assertEquals(res.status, 500);
  const text = JSON.stringify(await readJson(res));
  assert(!text.includes("secret detail"), "leaked the raw error");
});

Deno.test("blog-post-metrics: zero-fills São Paulo days ending today", async () => {
  const db = createSupabaseQueryMock();
  queueNoSeries(db);
  db.queueRpc("blog_view_daily", { data: [{ day: "2026-10-25", views: "7" }] });
  const res = await handleBlogPostMetrics(db as never, { slug: "post-a", days: 3 }, H, NOW);
  assertEquals(res.status, 200);
  assertEquals(await readJson(res), {
    views: [
      { day: "2026-10-25", views: 7 },
      { day: "2026-10-26", views: 0 },
      { day: "2026-10-27", views: 0 },
    ],
    search: [],
  });
  const call = db.calls.find((c) => c.table === "rpc:blog_view_daily");
  assert(call, "rpc not called");
  assertEquals(call.payload, { p_slug: "post-a", p_days: 3 });
});

Deno.test("blog-post-metrics: today is the São Paulo date, not the UTC date", async () => {
  const db = createSupabaseQueryMock();
  queueNoSeries(db);
  db.queueRpc("blog_view_daily", { data: [] });
  // 01:00 UTC on the 28th is still the 27th in São Paulo.
  const res = await handleBlogPostMetrics(
    db as never,
    { slug: "post-a", days: 2 },
    H,
    new Date("2026-10-28T01:00:00Z"),
  );
  const body = await readJson(res);
  assertEquals(body.views.map((v: { day: string }) => v.day), ["2026-10-26", "2026-10-27"]);
});

Deno.test("blog-post-metrics: ignores the partial oldest day the rolling window returns", async () => {
  const db = createSupabaseQueryMock();
  queueNoSeries(db);
  db.queueRpc("blog_view_daily", {
    data: [
      { day: "2026-10-24", views: "9" }, // one day older than the 3-day range
      { day: "2026-10-27", views: 2 },
    ],
  });
  const body = await readJson(
    await handleBlogPostMetrics(db as never, { slug: "post-a", days: 3 }, H, NOW),
  );
  assertEquals(body.views.length, 3);
  assertEquals(body.views, [
    { day: "2026-10-25", views: 0 },
    { day: "2026-10-26", views: 0 },
    { day: "2026-10-27", views: 2 },
  ]);
});

Deno.test("blog-post-metrics: days defaults to 90 and is clamped to 1-365", async () => {
  const lens: number[] = [];
  for (const days of [undefined, 0, -5, 1000, 2.9, "7" as unknown as number]) {
    const db = createSupabaseQueryMock();
    queueNoSeries(db);
    db.queueRpc("blog_view_daily", { data: [] });
    const res = await handleBlogPostMetrics(db as never, { slug: "p", days }, H, NOW);
    lens.push((await readJson(res)).views.length);
  }
  assertEquals(lens, [90, 1, 1, 365, 2, 90]);
});

Deno.test("blog-post-metrics: invalid slug is a 400 and never hits the db", async () => {
  for (const slug of ["", "Bad Slug", "a/b", "x".repeat(121), undefined, 5]) {
    const db = createSupabaseQueryMock();
    const res = await handleBlogPostMetrics(db as never, { slug: slug as never }, H, NOW);
    assertEquals(res.status, 400);
    assertEquals(db.calls.length, 0);
  }
});

Deno.test("blog-post-metrics: rpc error is a generic 500", async () => {
  const db = createSupabaseQueryMock();
  queueNoSeries(db);
  db.queueRpc("blog_view_daily", { data: null, error: { message: "secret detail" } });
  const res = await quietly(() => handleBlogPostMetrics(db as never, { slug: "post-a" }, H, NOW));
  assertEquals(res.status, 500);
  assert(!JSON.stringify(await readJson(res)).includes("secret detail"));
});

const INSPECT = "https://search.google.com/search-console/inspect?resource_id=x";

Deno.test("blog-metrics: fills search, index and gsc_updated_at, and keeps slugs with no views", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("blog_view_stats", {
    data: [{ slug: "post-a", views_7d: 1, views_30d: 2, views_total: 3 }],
  });
  db.queueRpc("blog_search_stats", {
    data: [
      { slug: "post-a", clicks: "38", impressions: "900", ctr: "0.042", position: "12.4" },
      { slug: "so-google", clicks: 2, impressions: 0, ctr: 0, position: null },
    ],
  });
  db.queue("blog_index_status", "select", {
    data: [
      {
        slug: "post-a",
        verdict: "PASS",
        coverage_state: "Submitted and indexed",
        last_crawl_time: "2026-10-25T10:00:00Z",
        inspection_link: INSPECT,
        checked_at: "2026-10-27T03:00:00Z",
      },
      {
        slug: "so-indice",
        verdict: null,
        coverage_state: null,
        last_crawl_time: null,
        inspection_link: "https://evil.example.com/x",
        checked_at: "2026-10-27T03:00:00Z",
      },
    ],
  });
  db.queue("blog_search_runs", "select", { data: { finished_at: "2026-10-27T03:05:00Z" } });

  const res = await handleBlogMetrics(db as never, H);
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.gsc_updated_at, "2026-10-27T03:05:00Z");
  assertEquals(body.posts["post-a"], {
    views_7d: 1,
    views_30d: 2,
    views_total: 3,
    search: { clicks: 38, impressions: 900, ctr: 0.042, position: 12.4 },
    index: {
      verdict: "PASS",
      coverage_state: "Submitted and indexed",
      last_crawl_time: "2026-10-25T10:00:00Z",
      inspection_link: INSPECT,
      checked_at: "2026-10-27T03:00:00Z",
    },
  });
  // Search Console data without a single view still appears, with zero views.
  assertEquals(body.posts["so-google"], {
    views_7d: 0,
    views_30d: 0,
    views_total: 0,
    search: { clicks: 2, impressions: 0, ctr: 0, position: null },
    index: null,
  });
  // A link that is not a Google URL never reaches the Admin.
  assertEquals(body.posts["so-indice"].views_total, 0);
  assertEquals(body.posts["so-indice"].index.inspection_link, null);

  const stats = db.calls.find((c) => c.table === "rpc:blog_search_stats");
  assertEquals(stats?.payload, { p_days: 28 });
  const run = db.calls.find((c) => c.table === "blog_search_runs");
  assert(run?.modifiers.some((m) => m.method === "eq" && m.args[0] === "ok" && m.args[1] === true));
});

Deno.test("blog-metrics: a search rpc error is a generic 500", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("blog_view_stats", { data: [] });
  db.queueRpc("blog_search_stats", { data: null, error: { message: "secret detail" } });
  const res = await quietly(() => handleBlogMetrics(db as never, H));
  assertEquals(res.status, 500);
  assert(!JSON.stringify(await readJson(res)).includes("secret detail"));
});

Deno.test("blog-post-metrics: zero-fills the Google days ending at the latest stored day", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("blog_view_daily", { data: [] });
  db.queueRpc("blog_search_series", {
    data: [
      { day: "2026-10-23", clicks: 4, impressions: 80 },
      { day: "2026-10-25", clicks: "1", impressions: "30" },
    ],
  });
  db.queue("blog_search_daily", "select", { data: { day: "2026-10-25" } });
  const body = await readJson(
    await handleBlogPostMetrics(db as never, { slug: "post-a", days: 4 }, H, NOW),
  );
  // Ends at 10-25 (the latest Google day), not at today (10-27).
  assertEquals(body.search, [
    { day: "2026-10-22", clicks: 0, impressions: 0 },
    { day: "2026-10-23", clicks: 4, impressions: 80 },
    { day: "2026-10-24", clicks: 0, impressions: 0 },
    { day: "2026-10-25", clicks: 1, impressions: 30 },
  ]);
  assertEquals(body.views.length, 4);
  const call = db.calls.find((c) => c.table === "rpc:blog_search_series");
  assertEquals(call?.payload, { p_slug: "post-a", p_days: 4 });
});

Deno.test("blog-post-metrics: an empty blog_search_daily gives an empty search series", async () => {
  const db = createSupabaseQueryMock();
  queueNoSeries(db);
  db.queueRpc("blog_view_daily", { data: [] });
  const body = await readJson(
    await handleBlogPostMetrics(db as never, { slug: "post-a", days: 3 }, H, NOW),
  );
  assertEquals(body.search, []);
  assertEquals(body.views.length, 3);
});

Deno.test("blog-post-metrics: a search rpc error is a generic 500", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("blog_view_daily", { data: [] });
  db.queueRpc("blog_search_series", { data: null, error: { message: "secret detail" } });
  db.queue("blog_search_daily", "select", { data: null });
  const res = await quietly(() => handleBlogPostMetrics(db as never, { slug: "post-a" }, H, NOW));
  assertEquals(res.status, 500);
  assert(!JSON.stringify(await readJson(res)).includes("secret detail"));
});

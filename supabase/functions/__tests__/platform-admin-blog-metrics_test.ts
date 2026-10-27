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
// 2026-10-27 15:00 em São Paulo (UTC-3).
const NOW = new Date("2026-10-27T18:00:00Z");

Deno.test("blog-metrics: coerces bigint strings and keys by slug", async () => {
  const db = createSupabaseQueryMock();
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
  db.queueRpc("blog_view_stats", { data: null });
  const res = await handleBlogMetrics(db as never, H);
  assertEquals(await readJson(res), { gsc_updated_at: null, posts: {} });
});

Deno.test("blog-metrics: junk numbers become 0", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("blog_view_stats", {
    data: [{ slug: "x", views_7d: "abc", views_30d: null, views_total: -4 }],
  });
  const body = await readJson(await handleBlogMetrics(db as never, H));
  assertEquals(body.posts.x, { views_7d: 0, views_30d: 0, views_total: 0, search: null, index: null });
});

Deno.test("blog-metrics: rpc error is a generic 500", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("blog_view_stats", { data: null, error: { message: "secret detail" } });
  const res = await quietly(() => handleBlogMetrics(db as never, H));
  assertEquals(res.status, 500);
  const text = JSON.stringify(await readJson(res));
  assert(!text.includes("secret detail"), "leaked the raw error");
});

Deno.test("blog-post-metrics: zero-fills São Paulo days ending today", async () => {
  const db = createSupabaseQueryMock();
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
  db.queueRpc("blog_view_daily", { data: null, error: { message: "secret detail" } });
  const res = await quietly(() => handleBlogPostMetrics(db as never, { slug: "post-a" }, H, NOW));
  assertEquals(res.status, 500);
  assert(!JSON.stringify(await readJson(res)).includes("secret detail"));
});

import { assert, assertEquals } from "./assert.ts";
import {
  aggregateRows,
  backfillChunks,
  backfillHorizon,
  GSC_SCOPE,
  INDEX_LINK_RE,
  pacificYesterday,
  pickInspectionTargets,
  refreshWindow,
  slugFromPageUrl,
} from "../blog-search-console-cron/logic.ts";

Deno.test("constants", () => {
  assertEquals(GSC_SCOPE, "https://www.googleapis.com/auth/webmasters.readonly");
  assert(INDEX_LINK_RE.test("https://search.google.com/search-console/inspect?x=1"));
  assert(!INDEX_LINK_RE.test("http://search.google.com/x"));
  assert(!INDEX_LINK_RE.test("https://evil.com/https://search.google.com/"));
});

Deno.test("slugFromPageUrl maps both hosts, trailing slash, query and fragment", () => {
  assertEquals(slugFromPageUrl("https://mesaas.com.br/blog/x"), "x");
  assertEquals(slugFromPageUrl("https://www.mesaas.com.br/blog/x/"), "x");
  assertEquals(slugFromPageUrl("https://mesaas.com.br/blog/x?utm_source=a#frag"), "x");
  assertEquals(slugFromPageUrl("https://mesaas.com.br/blog/x#h2"), "x");
  assertEquals(slugFromPageUrl("https://www.mesaas.com.br/blog/x?utm_source=a"), "x");
  assertEquals(slugFromPageUrl("https://www.mesaas.com.br/blog/como-vender-2026"), "como-vender-2026");
});

Deno.test("slugFromPageUrl rejects everything else", () => {
  for (const u of [
    "https://mesaas.com.br/blog",
    "https://mesaas.com.br/blog/",
    "https://evil.com/blog/x",
    "https://mesaas.com.br.evil.com/blog/x",
    "https://mesaas.com.br/blog/X%20Y",
    "https://mesaas.com.br/blog/X",
    "https://mesaas.com.br/blog/a/b",
    "https://mesaas.com.br/outro/x",
    "https://mesaas.com.br:8443/blog/x",
    "https://mesaas.com.br/blog/" + "a".repeat(121),
    "ftp://mesaas.com.br/blog/x",
    "/blog/x",
    "not a url",
    "",
  ]) {
    assertEquals(slugFromPageUrl(u), null, u);
  }
});

Deno.test("aggregateRows folds hosts into one (slug, day) with impression-weighted position", () => {
  const out = aggregateRows([
    { keys: ["2026-10-20", "https://mesaas.com.br/blog/x"], clicks: 3, impressions: 100, position: 2 },
    { keys: ["2026-10-20", "https://www.mesaas.com.br/blog/x/"], clicks: 1, impressions: 300, position: 6 },
    { keys: ["2026-10-21", "https://mesaas.com.br/blog/x"], clicks: 0, impressions: 10, position: 9 },
    { keys: ["2026-10-20", "https://mesaas.com.br/blog"], clicks: 99, impressions: 99, position: 1 },
    { keys: ["2026-10-20", "https://mesaas.com.br/blog/"], clicks: 99, impressions: 99, position: 1 },
    { keys: ["2026-10-20", "https://evil.com/blog/y"], clicks: 99, impressions: 99, position: 1 },
  ]);
  assertEquals(out, [
    { slug: "x", day: "2026-10-20", clicks: 4, impressions: 400, position: 5 },
    { slug: "x", day: "2026-10-21", clicks: 0, impressions: 10, position: 9 },
  ]);
});

Deno.test("aggregateRows folds the host, query and fragment variants of one post into a single row", () => {
  const out = aggregateRows([
    { keys: ["2026-10-20", "https://mesaas.com.br/blog/x"], clicks: 1, impressions: 100, position: 2 },
    { keys: ["2026-10-20", "https://www.mesaas.com.br/blog/x?utm_source=a"], clicks: 2, impressions: 100, position: 4 },
    { keys: ["2026-10-20", "https://mesaas.com.br/blog/x#h2"], clicks: 4, impressions: 200, position: 6 },
  ]);
  assertEquals(out, [{ slug: "x", day: "2026-10-20", clicks: 7, impressions: 400, position: 4.5 }]);
});

Deno.test("aggregateRows falls back to the plain average when impressions sum to zero", () => {
  const out = aggregateRows([
    { keys: ["2026-10-20", "https://mesaas.com.br/blog/z"], clicks: 0, impressions: 0, position: 4 },
    { keys: ["2026-10-20", "https://www.mesaas.com.br/blog/z"], clicks: 0, impressions: 0, position: 8 },
  ]);
  assertEquals(out, [{ slug: "z", day: "2026-10-20", clicks: 0, impressions: 0, position: 6 }]);
  assertEquals(aggregateRows([]), []);
});

Deno.test("pacificYesterday uses America/Los_Angeles, not UTC", () => {
  // 03:00Z on the 27th is still the 26th in Pacific (UTC-7), so yesterday is the 25th.
  assertEquals(pacificYesterday(new Date("2026-10-27T03:00:00Z")), "2026-10-25");
  assertEquals(pacificYesterday(new Date("2026-10-27T12:00:00Z")), "2026-10-26");
  // Across the November DST end (PDT -> PST) and a month boundary.
  assertEquals(pacificYesterday(new Date("2026-11-01T07:30:00Z")), "2026-10-31");
  assertEquals(pacificYesterday(new Date("2026-03-01T12:00:00Z")), "2026-02-28");
});

Deno.test("refreshWindow is 10 days ending Pacific yesterday", () => {
  assertEquals(refreshWindow(new Date("2026-10-27T12:00:00Z")), { from: "2026-10-17", to: "2026-10-26" });
  assertEquals(refreshWindow(new Date("2026-03-05T12:00:00Z")), { from: "2026-02-23", to: "2026-03-04" });
});

Deno.test("backfillHorizon is Pacific today minus 486 days", () => {
  assertEquals(backfillHorizon(new Date("2026-10-27T12:00:00Z")), "2025-06-28");
  // 03:00Z is still the 26th in Pacific.
  assertEquals(backfillHorizon(new Date("2026-10-27T03:00:00Z")), "2025-06-27");
});

Deno.test("backfillChunks walks 30-day chunks newest first", () => {
  const chunks = backfillChunks("2026-10-17", "2025-06-28");
  assertEquals(chunks, [
    { from: "2026-09-17", to: "2026-10-16" },
    { from: "2026-08-18", to: "2026-09-16" },
    { from: "2026-07-19", to: "2026-08-17" },
    { from: "2026-06-19", to: "2026-07-18" },
  ]);
  assertEquals(backfillChunks("2026-10-17", "2025-06-28", 2).length, 2);
});

Deno.test("backfillChunks clips at the horizon and then returns nothing", () => {
  const horizon = "2025-06-28";
  assertEquals(backfillChunks("2025-07-10", horizon), [{ from: "2025-06-28", to: "2025-07-09" }]);
  assertEquals(backfillChunks("2025-07-28", horizon), [
    { from: "2025-06-28", to: "2025-07-27" },
  ]);
  assertEquals(backfillChunks("2025-08-05", horizon), [
    { from: "2025-07-06", to: "2025-08-04" },
    { from: "2025-06-28", to: "2025-07-05" },
  ]);
  // The cursor lands on the horizon after the clipped chunk: done.
  assertEquals(backfillChunks(horizon, horizon), []);
  assertEquals(backfillChunks("2025-06-01", horizon), []);
});

Deno.test("pickInspectionTargets: recent posts first, then never checked, then oldest checked", () => {
  const now = new Date("2026-10-27T12:00:00Z");
  const live = [
    { slug: "old-fresh-check", date: "2026-01-01" },
    { slug: "new", date: "2026-10-26" },
    { slug: "never", date: "2026-02-01" },
    { slug: "old-stale-check", date: null },
  ];
  const checked = {
    "old-fresh-check": "2026-10-26T00:00:00Z",
    new: "2026-10-27T00:00:00Z",
    "old-stale-check": "2026-09-01T00:00:00Z",
  };
  assertEquals(pickInspectionTargets(live, checked, now, 2), ["new", "never"]);
  assertEquals(pickInspectionTargets(live, checked, now), ["new", "never", "old-stale-check", "old-fresh-check"]);
});

Deno.test("pickInspectionTargets compares checked_at as instants, not strings", () => {
  const now = new Date("2026-10-27T12:00:00Z");
  const live = [
    { slug: "a", date: null },
    { slug: "b", date: null },
  ];
  // a = 08:00Z and b = 09:00Z, but as strings "…T10:00:00+02:00" sorts after "…T09:00:00Z".
  const checked = { a: "2026-10-01T10:00:00+02:00", b: "2026-10-01T09:00:00Z" };
  assertEquals(pickInspectionTargets(live, checked, now), ["a", "b"]);
});

Deno.test("pickInspectionTargets dedupes, ignores unknown checked slugs and honours the cap", () => {
  const now = new Date("2026-10-27T12:00:00Z");
  const live = [
    { slug: "a", date: "2026-10-25" },
    { slug: "a", date: "2026-10-25" },
    { slug: "b", date: "2026-10-20" },
  ];
  assertEquals(pickInspectionTargets(live, { gone: "2020-01-01T00:00:00Z" }, now), ["a", "b"]);
  assertEquals(pickInspectionTargets(live, {}, now, 1), ["a"]);
  assertEquals(pickInspectionTargets(live, {}, now, 0), []);
  const many = Array.from({ length: 300 }, (_, i) => ({ slug: `p${i}`, date: null }));
  assertEquals(pickInspectionTargets(many, {}, now).length, 150);
  // A 7-day-old post gets no priority boost: it sorts by checked_at behind the fresh one.
  assertEquals(
    pickInspectionTargets([{ slug: "b", date: "2026-10-20" }, { slug: "c", date: "2026-10-27" }], { b: "2026-10-01T00:00:00Z" }, now),
    ["c", "b"],
  );
});

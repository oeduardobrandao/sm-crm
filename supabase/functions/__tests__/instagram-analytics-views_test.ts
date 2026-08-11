import { assert, assertEquals } from "./assert.ts";
import {
  parseViewsRange,
  chunkRange,
  fetchViewsTotal,
  sumViewsRange,
} from "../instagram-analytics/views.ts";

const DAY = 86400;
// Fixed "now": 2026-08-11T00:00:00Z, a stable reference for window math.
const NOW = Date.parse("2026-08-11T00:00:00Z") / 1000;

const params = (q: Record<string, string>) => new URLSearchParams(q);

const okFetch = (value: number) =>
  ((_u: string | URL | Request, _i?: RequestInit) =>
    Promise.resolve({
      json: () =>
        Promise.resolve({ data: [{ name: "views", total_value: { value } }] }),
    } as Response)) as typeof fetch;

Deno.test("views: rejects days and start/end together, and neither", () => {
  assertEquals(
    parseViewsRange(params({ days: "30", start: "2026-07-01", end: "2026-07-31" }), NOW).ok,
    false,
  );
  assertEquals(parseViewsRange(params({}), NOW).ok, false);
  assertEquals(parseViewsRange(params({ start: "2026-07-01" }), NOW).ok, false);
});

Deno.test("views: days mode builds [now-30d, now) with adjacent previous window", () => {
  const r = parseViewsRange(params({ days: "30" }), NOW);
  assert(r.ok);
  assertEquals(r.range.until, NOW);
  assertEquals(r.range.since, NOW - 30 * DAY);
  assertEquals(r.range.partial, false);
  assertEquals(r.range.prev, { since: NOW - 60 * DAY, until: NOW - 30 * DAY });
});

Deno.test("views: days=90 fits the window but previous does not", () => {
  const r = parseViewsRange(params({ days: "90" }), NOW);
  assert(r.ok);
  assertEquals(r.range.since, NOW - 90 * DAY);
  assertEquals(r.range.partial, false);
  assertEquals(r.range.prev, null);
});

Deno.test("views: days=365 clamps to 90d, partial, no previous", () => {
  const r = parseViewsRange(params({ days: "365" }), NOW);
  assert(r.ok);
  assertEquals(r.range.since, NOW - 90 * DAY);
  assertEquals(r.range.partial, true);
  assertEquals(r.range.prev, null);
});

Deno.test("views: invalid days values are rejected", () => {
  for (const d of ["0", "731", "abc", "-5"]) {
    assertEquals(parseViewsRange(params({ days: d }), NOW).ok, false, `days=${d}`);
  }
});

Deno.test("views: range mode is inclusive on both calendar days", () => {
  // July 2026: since = Jul 1 00:00Z, until = Aug 1 00:00Z (end day included).
  const r = parseViewsRange(params({ start: "2026-07-01", end: "2026-07-31" }), NOW);
  assert(r.ok);
  assertEquals(r.range.since, Date.parse("2026-07-01T00:00:00Z") / 1000);
  assertEquals(r.range.until, Date.parse("2026-08-01T00:00:00Z") / 1000);
  assertEquals(r.range.partial, false);
  // Previous window: same 31-day length immediately before.
  assertEquals(r.range.prev, {
    since: Date.parse("2026-07-01T00:00:00Z") / 1000 - 31 * DAY,
    until: Date.parse("2026-07-01T00:00:00Z") / 1000,
  });
});

Deno.test("views: reversed range, future start, malformed dates are rejected", () => {
  assertEquals(parseViewsRange(params({ start: "2026-07-31", end: "2026-07-01" }), NOW).ok, false);
  assertEquals(parseViewsRange(params({ start: "2026-09-01", end: "2026-09-10" }), NOW).ok, false);
  assertEquals(parseViewsRange(params({ start: "07/01/2026", end: "2026-07-31" }), NOW).ok, false);
});

Deno.test("views: range entirely older than 90 days is rejected", () => {
  assertEquals(parseViewsRange(params({ start: "2026-01-01", end: "2026-02-01" }), NOW).ok, false);
});

Deno.test("views: chunkRange splits 90 days into three 30-day chunks with shared boundaries", () => {
  const chunks = chunkRange(NOW - 90 * DAY, NOW);
  assertEquals(chunks.length, 3);
  assertEquals(chunks[0], { since: NOW - 90 * DAY, until: NOW - 60 * DAY });
  assertEquals(chunks[1], { since: NOW - 60 * DAY, until: NOW - 30 * DAY });
  assertEquals(chunks[2], { since: NOW - 30 * DAY, until: NOW });
});

Deno.test("views: chunkRange keeps a short range as one chunk", () => {
  assertEquals(chunkRange(NOW - 7 * DAY, NOW), [{ since: NOW - 7 * DAY, until: NOW }]);
});

Deno.test("views: fetchViewsTotal sums the views total_value", async () => {
  assertEquals(await fetchViewsTotal(okFetch(1234), "tok", NOW - DAY, NOW), 1234);
});

Deno.test("views: fetchViewsTotal throws TOKEN_EXPIRED on Graph code 190", async () => {
  const expired = ((_u: string | URL | Request, _i?: RequestInit) =>
    Promise.resolve({
      json: () => Promise.resolve({ error: { code: 190, message: "expired" } }),
    } as Response)) as typeof fetch;
  let thrown: unknown = null;
  try {
    await fetchViewsTotal(expired, "tok", NOW - DAY, NOW);
  } catch (e) {
    thrown = e;
  }
  assertEquals((thrown as { code?: string })?.code, "TOKEN_EXPIRED");
});

Deno.test("views: sumViewsRange adds chunk totals", async () => {
  // 90 days = 3 chunks of 500 each.
  assertEquals(await sumViewsRange(okFetch(500), "tok", NOW - 90 * DAY, NOW), 1500);
});

Deno.test("views: sumViewsRange rejects when any chunk fails", async () => {
  let call = 0;
  const flaky = ((_u: string | URL | Request, _i?: RequestInit) => {
    call++;
    if (call === 2) {
      return Promise.resolve({
        json: () => Promise.resolve({ error: { code: 4, message: "rate limited" } }),
      } as Response);
    }
    return Promise.resolve({
      json: () => Promise.resolve({ data: [{ name: "views", total_value: { value: 500 } }] }),
    } as Response);
  }) as typeof fetch;
  let rejected = false;
  try {
    await sumViewsRange(flaky, "tok", NOW - 90 * DAY, NOW);
  } catch {
    rejected = true;
  }
  assertEquals(rejected, true);
});

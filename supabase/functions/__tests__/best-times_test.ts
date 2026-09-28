import { assert, assertEquals } from "./assert.ts";
import {
  bestTimesFromPosts,
  type BestTimesPost,
  isCurrentBestTimes,
  resolveBestTimes,
} from "../_shared/best-times.ts";

function post(posted_at: string, likes: number, reach: number): BestTimesPost {
  return { posted_at, likes, comments: 0, saved: 0, shares: 0, reach };
}

Deno.test("bestTimesFromPosts buckets on the São Paulo clock, not UTC", () => {
  // Wednesday 21:00 UTC = Wednesday 18:00 in São Paulo.
  const grid = bestTimesFromPosts([post("2026-09-30T21:00:00Z", 10, 100)]);
  assertEquals(grid.counts[2][18], 1);
  assertEquals(grid.counts[2][21], 0);
  assertEquals(grid.heatmap[2][18], 10);
  assertEquals(grid.topSlots, [{ day: 2, hour: 18, value: 10, postCount: 1 }]);
  assertEquals(grid.timezone, "America/Sao_Paulo");
});

Deno.test("bestTimesFromPosts moves an early-UTC post to the previous São Paulo weekday", () => {
  // Wednesday 01:30 UTC = Tuesday 22:30 in São Paulo.
  const grid = bestTimesFromPosts([post("2026-09-30T01:30:00Z", 5, 100)]);
  assertEquals(grid.counts[1][22], 1);
});

Deno.test("bestTimesFromPosts averages per slot and ranks the top 3", () => {
  const grid = bestTimesFromPosts([
    post("2026-09-30T21:00:00Z", 10, 100), // Wed 18h: 10%
    post("2026-10-07T21:00:00Z", 20, 100), // Wed 18h: 20% -> avg 15
    post("2026-10-01T15:00:00Z", 30, 100), // Thu 12h: 30%
    post("2026-10-02T12:00:00Z", 5, 100), // Fri 9h: 5%
    post("2026-10-03T12:00:00Z", 1, 100), // Sat 9h: 1%
    post("2026-10-03T13:00:00Z", 0, 0), // Sat 10h: no reach -> 0
  ]);
  assertEquals(grid.totalPosts, 6);
  assertEquals(grid.heatmap[2][18], 15);
  assertEquals(grid.topSlots.map((s) => [s.day, s.hour]), [[3, 12], [2, 18], [4, 9]]);
});

Deno.test("isCurrentBestTimes rejects legacy rows without the São Paulo marker", () => {
  assert(isCurrentBestTimes(bestTimesFromPosts([])));
  assert(!isCurrentBestTimes({ heatmap: [], counts: [] }));
  assert(!isCurrentBestTimes({ timezone: "UTC" }));
  assert(!isCurrentBestTimes(null));
});

function fakeDb(opts: { posts?: BestTimesPost[]; postsError?: unknown } = {}) {
  const calls = { select: 0, upserts: [] as unknown[] };
  const db = {
    from(table: string) {
      if (table === "instagram_analytics_cache") {
        return {
          upsert(row: unknown) {
            calls.upserts.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }
      calls.select++;
      const chain = {
        select: () => chain,
        eq: () => chain,
        gte: () => Promise.resolve({ data: opts.posts ?? [], error: opts.postsError ?? null }),
      };
      return chain;
    },
  };
  return { db, calls };
}

Deno.test("resolveBestTimes serves a current row without touching the database", async () => {
  const { db, calls } = fakeDb();
  const cached = bestTimesFromPosts([post("2026-09-30T21:00:00Z", 10, 100)]);
  assertEquals(await resolveBestTimes(db, 7, cached, "[t]"), cached);
  assertEquals(calls.select, 0);
  assertEquals(calls.upserts.length, 0);
});

Deno.test("resolveBestTimes recomputes and rewrites a legacy or missing row", async () => {
  for (const cached of [{ heatmap: [], counts: [] }, undefined]) {
    const { db, calls } = fakeDb({ posts: [post("2026-09-30T21:00:00Z", 10, 100)] });
    const fresh = await resolveBestTimes(db, 7, cached, "[t]");
    assertEquals(fresh?.counts[2][18], 1);
    assertEquals(calls.upserts.length, 1);
    const row = calls.upserts[0] as { instagram_account_id: number; cache_key: string };
    assertEquals([row.instagram_account_id, row.cache_key], [7, "best_times"]);
  }
});

Deno.test("resolveBestTimes degrades to null on a query error", async () => {
  const { db, calls } = fakeDb({ postsError: { message: "boom" } });
  assertEquals(await resolveBestTimes(db, 7, undefined, "[t]"), null);
  assertEquals(calls.upserts.length, 0);
});

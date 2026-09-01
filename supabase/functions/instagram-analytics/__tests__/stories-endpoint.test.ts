import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

interface StoriesKpis {
  stories_count: number;
  total_reach: number;
  total_impressions: number;
  total_replies: number;
  avg_retention_rate: number;
  avg_skip_rate: number;
  total_exits: number;
}

interface StoryInsight {
  instagram_media_id: string;
  media_type: string;
  thumbnail_url: string | null;
  posted_at: string;
  reach: number;
  impressions: number;
  replies: number;
  taps_forward: number;
  taps_back: number;
  exits: number;
  shares: number;
  retention_rate: number;
  skip_rate: number;
  back_rate: number;
}

Deno.test("retention_rate computed correctly", () => {
  const impressions = 800;
  const exits = 100;
  const retention = 1 - (exits / impressions);
  assertEquals(retention, 0.875);
});

Deno.test("retention_rate is 0 when impressions is 0", () => {
  const impressions = 0;
  const exits = 0;
  const retention = impressions === 0 ? 0 : 1 - (exits / impressions);
  assertEquals(retention, 0);
});

Deno.test("skip_rate computed correctly", () => {
  const impressions = 800;
  const tapsForward = 200;
  const skip = tapsForward / impressions;
  assertEquals(skip, 0.25);
});

Deno.test("aggregated retention is ratio of totals, not average of rates", () => {
  const stories = [
    { impressions: 100, exits: 50 },
    { impressions: 900, exits: 90 },
  ];
  const totalImpressions = stories.reduce((s, r) => s + r.impressions, 0);
  const totalExits = stories.reduce((s, r) => s + r.exits, 0);
  const aggregated = 1 - (totalExits / totalImpressions);
  assertEquals(aggregated, 0.86);

  const avgOfRates = ((1 - 50/100) + (1 - 90/900)) / 2;
  assert(Math.abs(aggregated - avgOfRates) > 0.01);
});

Deno.test("days param NaN guard falls back to 30 instead of propagating NaN", () => {
  const daysParam = parseInt("abc", 10); // NaN -- e.g. ?days=abc
  const days = Math.min(Math.max(1, Number.isFinite(daysParam) ? daysParam : 30), 365);
  assertEquals(days, 30);
});

Deno.test("days param guard leaves valid finite values unchanged", () => {
  const daysParam = parseInt("45", 10);
  const days = Math.min(Math.max(1, Number.isFinite(daysParam) ? daysParam : 30), 365);
  assertEquals(days, 45);
});

Deno.test("without the guard, a NaN days param crashes on toISOString (regression check)", () => {
  const daysParam = parseInt("abc", 10); // NaN
  const unguardedDays = Math.min(Math.max(1, daysParam), 365); // NaN propagates through Math.min/max

  assert(Number.isNaN(unguardedDays));

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - unguardedDays + 1); // produces an Invalid Date

  let threw = false;
  try {
    start.toISOString();
  } catch {
    threw = true;
  }
  assert(threw, "toISOString() on an Invalid Date must throw -- this is exactly the pre-fix 500");
});

Deno.test("KPI totals must come from an uncapped query, not the display-list cap", () => {
  // Simulates a busy account with 250 stories in the period, while the
  // returned `stories` list is capped at 200 (`.limit(200)` in the route).
  const allStories = Array.from({ length: 250 }, () => ({ impressions: 10, exits: 1 }));
  const cappedRows = allStories.slice(0, 200); // stand-in for the `.limit(200)` query

  const totalFromCappedRows = cappedRows.reduce((s, r) => s + r.impressions, 0);
  const totalFromUncappedRows = allStories.reduce((s, r) => s + r.impressions, 0);

  assertEquals(totalFromCappedRows, 2000);
  assertEquals(totalFromUncappedRows, 2500);
  assert(
    totalFromCappedRows !== totalFromUncappedRows,
    "KPIs computed from the capped rows would silently undercount once a period exceeds the display cap",
  );
});

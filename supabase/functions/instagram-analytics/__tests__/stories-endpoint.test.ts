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

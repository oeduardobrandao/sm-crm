import { assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { buildFallbackSummary } from "./fallback.ts";
import type { ReportData } from "./types.ts";

const fixture: ReportData = {
  handle: "@drajuliana",
  specialty: "Dermatologia",
  period: "Maio 2026",
  kpis: {
    followers_gained: { id: "followers_gained", value: 347, unit: "count" },
    engagement_rate: { id: "engagement_rate", value: 4.2, unit: "pct" },
    reach: { id: "reach", value: 45200, unit: "count" },
    profile_views: { id: "profile_views", value: 1200, unit: "count" },
    website_clicks: { id: "website_clicks", value: 89, unit: "count" },
    saves: { id: "saves", value: 1800, unit: "count" },
    posts_count: { id: "posts_count", value: 18, unit: "count" },
  },
  kpi_deltas: { followers_pct_change: 12.4, engagement_pct_change: -0.3, reach_pct_change: 8.1 },
  top_posts: [{ type: "reel", reach: 12400, engagement: 6.8, saves: 340, caption_preview: "5 dicas para..." }],
  content_breakdown: {
    reels: { count: 6, avg_reach: 8200, avg_engagement: 5.1 },
    carousels: { count: 8, avg_reach: 4100, avg_engagement: 3.8 },
    images: { count: 4, avg_reach: 2800, avg_engagement: 2.9 },
  },
  audience: null,
  best_times: [],
  tags_performance: [],
  follower_trend: [],
};

Deno.test("buildFallbackSummary returns bullet-point summary", () => {
  const summary = buildFallbackSummary(fixture);
  assertStringIncludes(summary, "347");
  assertStringIncludes(summary, "45.200");
  assertStringIncludes(summary, "4,2%");
  assertStringIncludes(summary, "18");
});

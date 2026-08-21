import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { snapshotToReportData } from "./ai-input.ts";
import type { ReportDocSnapshot } from "./snapshot.ts";

const snap: ReportDocSnapshot = {
  version: 1,
  period: { month: "2026-07", label: "Julho de 2026", start: "2026-07-01T00:00:00.000Z", endExclusive: "2026-08-01T00:00:00.000Z" },
  account: { handle: "dra.x", specialty: "Dermato" },
  branding: { workspace_name: "DK", logo_url: null, splash_url: null, accent_color: "#000" },
  kpis: {
    followers_gained: { value: 10, unit: "count", prev: 5 },
    followers_total: { value: 1000, unit: "count", prev: null },
    reach: { value: 500, unit: "count", prev: null },
    engagement_rate: { value: 4.2, unit: "pct", prev: null },
    saves: { value: 3, unit: "count", prev: null },
    posts_count: { value: 7, unit: "count", prev: null },
    profile_views: { value: null, unit: "count", prev: null },
    website_clicks: { value: null, unit: "count", prev: null },
  },
  follower_trend: [{ date: "2026-07-01", count: 990 }],
  content_breakdown: { reels: { count: 3, avg_reach: 100, avg_engagement: 10 } },
  top_posts: [{ type: "reel", reach: 100, likes: 5, comments: 1, saves: 2, caption_preview: "c", date: null, permalink: null, thumbnail_url: "https://x/y.jpg" }],
  audience: null,
  best_times: [],
  tags_performance: [],
};

Deno.test("snapshotToReportData traduz período, kpis e posts sem thumbnails", () => {
  const rd = snapshotToReportData(snap);
  assertEquals(rd.report_month, "2026-07");
  assertEquals(rd.handle, "dra.x");
  assertEquals(rd.kpis.followers_gained.value, 10);
  assertEquals(rd.kpis.followers_gained.prev, 5);
  // KPI sem valor (null) fica de fora do prompt em vez de virar 0 falso.
  assert(!("profile_views" in rd.kpis));
  assertEquals(rd.top_posts[0].engagement, 8); // likes+comments+saves
  assert(!("thumbnail_base64" in rd.top_posts[0]));
});

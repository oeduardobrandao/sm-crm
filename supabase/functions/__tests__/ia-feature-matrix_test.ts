import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { featureForPath } from "../_shared/feature-guard.ts";

Deno.test("featureForPath maps IA routes to flags", () => {
  assertEquals(featureForPath("GET", "/demographics/12"), "feature_audience_demographics");
  assertEquals(featureForPath("GET", "/best-times/12"), "feature_best_times");
  assertEquals(featureForPath("POST", "/ai-analysis/12"), "feature_instagram_ai");
  assertEquals(featureForPath("POST", "/ai-analysis-portfolio"), "feature_instagram_ai");
  assertEquals(featureForPath("POST", "/generate-report/12"), "feature_analytics_reports");
  assertEquals(featureForPath("GET", "/reports/12"), "feature_analytics_reports");
  assertEquals(featureForPath("GET", "/report-download/9"), "feature_analytics_reports");
  assertEquals(featureForPath("POST", "/send-report-email"), "feature_analytics_reports");
  assertEquals(featureForPath("POST", "/tags"), "feature_post_tagging");
  assertEquals(featureForPath("DELETE", "/tags/5"), "feature_post_tagging");
  assertEquals(featureForPath("POST", "/posts/abc/tags"), "feature_post_tagging");
  assertEquals(featureForPath("GET", "/overview/12"), "feature_instagram");
  assertEquals(featureForPath("GET", "/portfolio"), "feature_instagram");
});

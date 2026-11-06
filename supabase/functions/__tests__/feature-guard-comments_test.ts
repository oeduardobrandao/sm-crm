import { assertEquals } from "./assert.ts";
import { featureForPath } from "../_shared/feature-guard.ts";

Deno.test("featureForPath liga comentários e análise de comentários à flag própria", () => {
  const flag = "feature_instagram_comments_ai";
  assertEquals(featureForPath("GET", "/post-comments/12/179"), flag);
  assertEquals(featureForPath("POST", "/comments-analysis/12/179"), flag);
  assertEquals(featureForPath("POST", "/comments-analysis-account/12"), flag);
  assertEquals(featureForPath("GET", "/comments-analysis-account/12"), flag);
});

Deno.test("featureForPath mantém ai-analysis na flag de IA existente", () => {
  assertEquals(featureForPath("POST", "/ai-analysis/12"), "feature_instagram_ai");
});

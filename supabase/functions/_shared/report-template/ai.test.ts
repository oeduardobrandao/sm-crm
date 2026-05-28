import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { buildAIPrompt, validateAIOutput } from "./ai.ts";
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

Deno.test("buildAIPrompt includes system role and data payload", () => {
  const { systemPrompt, userPrompt } = buildAIPrompt(fixture);
  assertEquals(systemPrompt.includes("social media analytics specialist"), true);
  assertEquals(systemPrompt.includes("pt-BR"), true);
  assertEquals(systemPrompt.includes("ONLY use numbers from the provided data"), true);
  assertEquals(userPrompt.includes("@drajuliana"), true);
  assertEquals(userPrompt.includes("Maio 2026"), true);
});

Deno.test("validateAIOutput accepts valid output", () => {
  const valid = {
    executive_summary: "Este mês o perfil apresentou crescimento de 12% em seguidores.",
    detailed_analysis: "A análise detalhada mostra que os Reels tiveram melhor desempenho, com alcance médio de 8.200. O engajamento geral ficou em 4,2%, uma leve queda de 0,3% em relação ao período anterior.",
    recommendations: [
      { title: "Aumentar Reels", description: "Reels tiveram 40% mais alcance", priority: "high", based_on_metric: "reach" },
      { title: "Melhorar legendas", description: "Legendas mais longas geram mais saves", priority: "medium", based_on_metric: "saves" },
      { title: "Postar às terças 19h", description: "Melhor horário identificado", priority: "low", based_on_metric: "engagement_rate" },
    ],
    suggested_goals: [
      { metric: "followers_gained", target: "5000 seguidores", rationale: "Crescimento de 12% mantido" },
      { metric: "reach", target: "50.000 alcance", rationale: "Tendência de alta de 8%" },
    ],
  };
  const result = validateAIOutput(valid);
  assertEquals(result.valid, true);
});

Deno.test("validateAIOutput rejects missing fields", () => {
  const invalid = { executive_summary: "text" };
  const result = validateAIOutput(invalid);
  assertEquals(result.valid, false);
});

Deno.test("validateAIOutput rejects too-short executive_summary", () => {
  const invalid = {
    executive_summary: "Curto",
    detailed_analysis: "A".repeat(200),
    recommendations: [
      { title: "A", description: "B", priority: "high", based_on_metric: "reach" },
      { title: "C", description: "D", priority: "medium", based_on_metric: "saves" },
      { title: "E", description: "F", priority: "low", based_on_metric: "reach" },
    ],
    suggested_goals: [
      { metric: "reach", target: "50k", rationale: "reason" },
      { metric: "saves", target: "2k", rationale: "reason" },
    ],
  };
  const result = validateAIOutput(invalid);
  assertEquals(result.valid, false);
});

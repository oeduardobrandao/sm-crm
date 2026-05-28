import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { renderReport } from "./render.ts";
import type { AIOutput, ReportData, WorkspaceBranding } from "./types.ts";

const branding: WorkspaceBranding = {
  logo_base64: null,
  workspace_name: "Agência Teste",
  primary_color: "#eab308",
  secondary_color: "#1a1e26",
  accent_color: "#3ecf8e",
  font_family: "DM Sans",
  theme: "dark",
};

const data: ReportData = {
  handle: "@drajuliana",
  specialty: "Dermatologia",
  period: "Maio 2026",
  kpis: {
    followers_gained: { id: "followers_gained", value: 347, unit: "count" },
    engagement_rate: { id: "engagement_rate", value: 4.2, unit: "pct" },
    reach: { id: "reach", value: 45200, unit: "count" },
    saves: { id: "saves", value: 1800, unit: "count" },
    posts_count: { id: "posts_count", value: 18, unit: "count" },
    profile_views: { id: "profile_views", value: 1200, unit: "count" },
    website_clicks: { id: "website_clicks", value: 89, unit: "count" },
  },
  kpi_deltas: {
    followers_pct_change: 12.4,
    engagement_pct_change: -0.3,
    reach_pct_change: 8.1,
  },
  top_posts: [
    {
      type: "reel",
      reach: 12400,
      engagement: 6.8,
      saves: 340,
      likes: 980,
      comments: 42,
      caption_preview: "5 dicas para...",
    },
  ],
  content_breakdown: {
    reels: { count: 6, avg_reach: 8200, avg_engagement: 5.1 },
  },
  audience: null,
  best_times: [],
  tags_performance: [],
  follower_trend: [],
};

Deno.test("renderReport produces valid HTML document", () => {
  const html = renderReport({ data, branding, aiOutput: null });
  assertStringIncludes(html, "<!DOCTYPE html>");
  assertStringIncludes(html, "</html>");
});

Deno.test("renderReport escapes user data in output", () => {
  const xssData = { ...data, handle: '<script>alert("xss")</script>' };
  const html = renderReport({ data: xssData, branding, aiOutput: null });
  assertEquals(html.includes("<script>alert"), false);
  assertStringIncludes(html, "&lt;script&gt;");
});

Deno.test("renderReport injects branding CSS variables", () => {
  const html = renderReport({ data, branding, aiOutput: null });
  assertStringIncludes(html, "--primary: #eab308");
  assertStringIncludes(html, "--secondary: #1a1e26");
  assertStringIncludes(html, "--accent: #3ecf8e");
});

Deno.test("renderReport includes AI output when provided", () => {
  const ai: AIOutput = {
    executive_summary: "Este mês foi excelente para o perfil.",
    detailed_analysis:
      "Análise detalhada do desempenho mensal com todos os dados.",
    recommendations: [
      {
        title: "Mais Reels",
        description: "Reels performaram melhor",
        priority: "high",
        based_on_metric: "reach",
      },
    ],
    suggested_goals: [
      { metric: "reach", target: "50k", rationale: "crescimento" },
    ],
  };
  const html = renderReport({ data, branding, aiOutput: ai });
  assertStringIncludes(html, "Este mês foi excelente para o perfil.");
});

Deno.test("renderReport uses fallback when aiOutput is null", () => {
  const html = renderReport({ data, branding, aiOutput: null });
  assertStringIncludes(html, "347");
  assertStringIncludes(html, "svg");
});

Deno.test("renderReport omits demographics section when audience is null", () => {
  const html = renderReport({
    data: { ...data, audience: null },
    branding,
    aiOutput: null,
  });
  assertEquals(html.includes("Demografia"), false);
});

Deno.test("renderReport omits tags section when tags_performance is empty", () => {
  const html = renderReport({
    data: { ...data, tags_performance: [] },
    branding,
    aiOutput: null,
  });
  assertEquals(html.includes("Performance por Tópico"), false);
});

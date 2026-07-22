import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { renderReport } from "./render.ts";
import type { AIOutput, ReportData, WorkspaceBranding } from "./types.ts";

const branding: WorkspaceBranding = {
  logo_base64: null,
  splash_base64: null,
  workspace_name: "Agência Teste",
  accent_color: "#7C2D12",
  // v1 fields still present until Task 7:
  primary_color: "#7C2D12",
  secondary_color: "#1a1e26",
  font_family: "DM Sans",
  theme: "light",
};

function makeData(): ReportData {
  return {
    handle: "@drajuliana",
    specialty: "Dermatologia",
    period: "Junho 2026",
    report_month: "2026-06",
    kpis: {
      followers_gained: { id: "followers_gained", value: 347, unit: "count", prev: 310 },
      engagement_rate: { id: "engagement_rate", value: 4.2, unit: "pct", prev: 4.3 },
      reach: { id: "reach", value: 45200, unit: "count", prev: 35100 },
      saves: { id: "saves", value: 1800, unit: "count", prev: 1275 },
      posts_count: { id: "posts_count", value: 18, unit: "count", prev: 18 },
      profile_views: { id: "profile_views", value: 1200, unit: "count" },
      website_clicks: { id: "website_clicks", value: 89, unit: "count", prev: 91 },
    },
    kpi_deltas: {
      followers_pct_change: 12.4,
      engagement_pct_change: -0.3,
      reach_pct_change: 28.9,
      saves_pct_change: 41.2,
    },
    top_posts: Array.from({ length: 12 }, (_, i) => ({
      type: (["reel", "carousel", "image"] as const)[i % 3],
      reach: 12400 - i * 800,
      engagement: 6.8 - i * 0.3,
      saves: 220 - i * 10,
      likes: 900 - i * 40,
      comments: 40 - i,
      caption_preview: `Post número ${i + 1} sobre skincare`,
      thumbnail_base64: null,
    })),
    content_breakdown: {
      reels: { count: 6, avg_reach: 9800, avg_engagement: 0.058 },
      carousels: { count: 8, avg_reach: 5200, avg_engagement: 0.047 },
      images: { count: 4, avg_reach: 2100, avg_engagement: 0.031 },
    },
    audience: {
      gender_split: { female: 71.2, male: 28.8 },
      top_age_ranges: [{ range: "25-34", pct: 41.0 }],
      top_cities: [{ name: "Fortaleza", pct: 38.2 }],
      top_countries: [{ name: "Brasil", pct: 95.1 }],
    },
    best_times: [
      { day: "qua", hour: 19, avg_engagement: 6.3 },
      { day: "qui", hour: 20, avg_engagement: 5.8 },
      { day: "seg", hour: 19, avg_engagement: 5.2 },
    ],
    tags_performance: [{ tag: "Melasma", avg_engagement: 6.1, avg_reach: 18300, count: 4 }],
    follower_trend: Array.from({ length: 30 }, (_, i) => ({
      date: `2026-06-${String(i + 1).padStart(2, "0")}`,
      count: 24000 + i * 12,
    })),
  };
}

const ai: AIOutput = {
  executive_summary: "Resumo executivo de teste.",
  detailed_analysis: "Análise detalhada (não renderizada).",
  recommendations: [
    { title: "Dobrar Reels", description: "Porque sim.", priority: "high" },
    { title: "Rever imagens", description: "Rendem pouco.", priority: "medium" },
  ],
  suggested_goals: [
    { metric: "Alcance", target: "50 mil", rationale: "Continuidade." },
  ],
};

Deno.test("renders v2 skeleton: fonts, accent vars, no v1 yellow, no emoji, no leftover placeholders", () => {
  const html = renderReport({ data: makeData(), branding, aiOutput: ai });
  assertStringIncludes(html, "font-family: 'Fraunces'");
  assertStringIncludes(html, "--acc: #7C2D12");
  assertEquals(html.includes("#eab308"), false);
  assertEquals(/\p{Extended_Pictographic}/u.test(html), false);
  assertEquals(/{{[A-Z_#/]+}}/.test(html), false);
});

Deno.test("prev values render as previous-month notes; cover teaser carries baseline", () => {
  const html = renderReport({ data: makeData(), branding, aiOutput: ai });
  assertStringIncludes(html, "maio: 35,1"); // reach prev, pt-BR compact
  assertStringIncludes(html, "maio: 310");
});

Deno.test("AI page renders recommendations, goals, priorities", () => {
  const html = renderReport({ data: makeData(), branding, aiOutput: ai });
  assertStringIncludes(html, "Dobrar Reels");
  assertStringIncludes(html, "Prioridade alta");
  assertStringIncludes(html, "50 mil");
  assertEquals(html.includes("Análise detalhada"), false); // detailed_analysis not rendered
});

Deno.test("no AI → plan page dropped and pages renumber", () => {
  const html = renderReport({ data: makeData(), branding, aiOutput: null });
  assertEquals(html.includes("Recomendações"), false);
  assertStringIncludes(html, "2 / 5"); // 5 pages total without the plan page
});

Deno.test("no audience → audience page dropped", () => {
  const data = makeData();
  data.audience = null;
  data.best_times = [];
  const html = renderReport({ data, branding, aiOutput: ai });
  assertEquals(html.includes("Quem é a sua audiência"), false);
});

Deno.test("splash art embedded when present, absent otherwise", () => {
  const withSplash = renderReport({
    data: makeData(),
    branding: { ...branding, splash_base64: "data:image/jpeg;base64,AAAA" },
    aiOutput: ai,
  });
  assertStringIncludes(withSplash, 'class="cover-art"');
  const without = renderReport({ data: makeData(), branding, aiOutput: ai });
  assertEquals(without.includes('class="cover-art"'), false);
});

Deno.test("format colors present as dots; heatmap uses ramp", () => {
  const html = renderReport({ data: makeData(), branding, aiOutput: ai });
  assertStringIncludes(html, "#D97706");
  assertStringIncludes(html, "#0D9488");
  assertStringIncludes(html, "#A21CAF");
  assertStringIncludes(html, "#8F5306"); // darkest ramp step (1º chip / hottest cell)
});

Deno.test("posts 7+ render as list rows", () => {
  const html = renderReport({ data: makeData(), branding, aiOutput: ai });
  assertStringIncludes(html, 'class="post-rest"');
  assertStringIncludes(html, "Post número 12");
});

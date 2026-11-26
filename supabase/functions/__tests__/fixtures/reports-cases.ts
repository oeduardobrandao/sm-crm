/** Inputs for the report pt-unchanged fixtures (fixtures/reports-pt.json). */
import type { AIOutput, ReportData, WorkspaceBranding } from "../../_shared/report-template/types.ts";

export const BRANDING: WorkspaceBranding = {
  logo_base64: "data:image/png;base64,AAAA",
  splash_base64: null,
  workspace_name: `Agência <Lume> & "Cia"`,
  accent_color: "#7C2D12",
};

function trend(month: string, days: number, start: number, step: number) {
  return Array.from({ length: days }, (_, i) => ({
    date: `${month}-${String(i + 1).padStart(2, "0")}`,
    count: start + i * step + (i === 9 ? 400 : 0),
  }));
}

export function richData(month = "2026-06", period = "Junho 2026"): ReportData {
  return {
    handle: "@drajuliana",
    specialty: "Dermatologia",
    period,
    report_month: month,
    kpis: {
      followers_gained: { id: "followers_gained", value: 347, unit: "count", prev: 310 },
      engagement_rate: { id: "engagement_rate", value: 4.2, unit: "pct", prev: 4.3 },
      reach: { id: "reach", value: 45200, unit: "count", prev: 35100 },
      saves: { id: "saves", value: 1800, unit: "count", prev: 1275 },
      posts_count: { id: "posts_count", value: 18, unit: "count", prev: 18 },
      profile_views: { id: "profile_views", value: 1200000, unit: "count" },
      website_clicks: { id: "website_clicks", value: 89, unit: "count", prev: 91 },
    },
    kpi_deltas: {
      followers_pct_change: 12.4,
      engagement_pct_change: -0.3,
      reach_pct_change: 28.9,
      saves_pct_change: 41.2,
      profile_views_pct_change: 0,
      website_clicks_pct_change: -2.2,
    },
    top_posts: Array.from({ length: 14 }, (_, i) => ({
      type: (["reel", "carousel", "image"] as const)[i % 3],
      reach: 12400 - i * 800,
      engagement: 6.8 - i * 0.3,
      saves: 220 - i * 10,
      likes: 1900 - i * 40,
      comments: 40 - i,
      caption_preview: `Post <${i + 1}> sobre skincare`,
      thumbnail_base64: null,
    })),
    content_breakdown: {
      reels: { count: 6, avg_reach: 9800, avg_engagement: 0.058 },
      carousels: { count: 8, avg_reach: 5200, avg_engagement: 0.047 },
      images: { count: 1, avg_reach: 2100, avg_engagement: 0.031 },
    },
    audience: {
      gender_split: { female: 71.2, male: 28.8 },
      top_age_ranges: [
        { range: "13-17", pct: 2 }, { range: "18-24", pct: 15 }, { range: "25-34", pct: 41 },
        { range: "35-44", pct: 22 }, { range: "45-54", pct: 12 }, { range: "55-64", pct: 5 },
        { range: "65+", pct: 3 },
      ],
      top_cities: ["Fortaleza", "São Paulo", "Recife", "Natal", "Salvador", "Belém"].map((name, i) => ({ name, pct: 30 - i * 4 })),
      top_countries: [{ name: "Brasil", pct: 95.1 }, { name: "Portugal", pct: 2 }, { name: "EUA", pct: 1 }, { name: "Chile", pct: 0.5 }],
    },
    best_times: [
      { day: "qua", hour: 19, avg_engagement: 6.3 },
      { day: "qui", hour: 20, avg_engagement: 5.8 },
      { day: "seg", hour: 19, avg_engagement: 5.2 },
      { day: "sab", hour: 10, avg_engagement: 4.1 },
      { day: "dom", hour: 7, avg_engagement: 9 },
    ],
    tags_performance: ["Melasma", "Acne", "Botox", "Peeling"].map((tag, i) => ({
      tag, avg_engagement: 6.1 - i, avg_reach: 18300 - i * 3000, count: 4 + i,
    })),
    follower_trend: trend(month, 30, 24000, 12),
  };
}

export function sparseData(): ReportData {
  return {
    handle: "@x",
    specialty: "",
    period: "Janeiro 2027",
    report_month: "2027-01",
    kpis: {
      followers_gained: { id: "followers_gained", value: -120, unit: "count" },
      reach: { id: "reach", value: 310, unit: "count" },
      posts_count: { id: "posts_count", value: 1, unit: "count" },
    },
    kpi_deltas: {},
    top_posts: [{ type: "reel", reach: 310, engagement: 2.5, saves: 1, likes: 20, comments: 1, caption_preview: "unico", thumbnail_base64: null }],
    content_breakdown: { reels: { count: 1, avg_reach: 310, avg_engagement: 0.02 } },
    audience: null,
    best_times: [],
    tags_performance: [],
    follower_trend: [],
  };
}

export function flatData(): ReportData {
  const d = richData("2026-12", "Dezembro 2026");
  d.kpis.followers_gained = { id: "followers_gained", value: 0, unit: "count", prev: 0 };
  d.kpi_deltas = { followers_pct_change: 0 };
  d.follower_trend = trend("2026-12", 5, 100, 0);
  d.audience = { gender_split: { female: 10, male: 90 }, top_age_ranges: [{ range: "18-24", pct: 50 }], top_cities: [{ name: "Rio", pct: 10 }], top_countries: [] };
  return d;
}

export const AI_RICH: AIOutput = {
  executive_summary: "Primeiro parágrafo <b>.\n\nSegundo parágrafo.",
  detailed_analysis: "x",
  recommendations: [
    { title: "Dobrar Reels", description: "Porque sim.", priority: "high" },
    { title: "Rever imagens", description: "Rendem pouco.", priority: "medium" },
    { title: "Testar horários", description: "Noite.", priority: "low" },
  ],
  suggested_goals: [
    { metric: "Alcance", target: "50 mil", rationale: "Continuidade." },
    { metric: "Salvamentos", target: "2.000", rationale: "Tendência." },
  ],
};
export const AI_ONE: AIOutput = {
  executive_summary: "  ",
  detailed_analysis: "x",
  recommendations: [{ title: "Uma só", description: "Desc.", priority: "high" }],
  suggested_goals: [],
};

export type RenderCase = { name: string; data: () => ReportData; ai: AIOutput | null };
export const RENDER_CASES: RenderCase[] = [
  { name: "rich-ai", data: () => richData(), ai: AI_RICH },
  { name: "rich-noai", data: () => richData("2026-01", "Janeiro 2026"), ai: null },
  { name: "sparse-noai", data: sparseData, ai: null },
  { name: "sparse-one-reco", data: sparseData, ai: AI_ONE },
  { name: "flat-ai", data: flatData, ai: AI_RICH },
];

export const FALLBACK_CASES: Record<string, () => ReportData> = {
  rich: () => richData(),
  sparse: sparseData,
  flat: flatData,
};

export const CHART_LABELS = Array.from({ length: 30 }, (_, i) => `2026-06-${String(i + 1).padStart(2, "0")}`);
export const CHART_YEAR = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}-01`);

// --- block reports (report-docs) -------------------------------------------
import type { KpiEntry, ReportKpiId } from "../../_shared/report-docs/kpis.ts";

const e = (value: number | null, unit: "count" | "pct" = "count"): KpiEntry => ({ value, unit, prev: null });
export const IG_KPIS_FULL = {
  followers_gained: e(10), followers_total: e(null), reach: e(1234567), views: e(null),
  engagement_rate: e(3.25, "pct"), saves: e(5), posts_count: e(8), profile_views: e(null),
  website_clicks: e(null), follows: e(null),
} as unknown as Record<ReportKpiId, KpiEntry>;
export const IG_KPIS_NEG = {
  ...IG_KPIS_FULL, followers_gained: e(-7), posts_count: e(1),
} as unknown as Record<ReportKpiId, KpiEntry>;
export const IG_KPIS_EMPTY = Object.fromEntries(
  Object.keys(IG_KPIS_FULL).map((k) => [k, e(null)]),
) as unknown as Record<ReportKpiId, KpiEntry>;

export const TT_KPIS = {
  followers_total: e(100), followers_gained: e(12), views: e(34567), engagement_rate: e(4.56, "pct"),
  likes: e(1), comments: e(2), shares: e(3), posts_count: e(1), likes_total: e(9),
};
export const TT_KPIS_NEG = { ...TT_KPIS, followers_gained: e(-3), posts_count: e(5) };
export const GBP_KPIS = {
  profile_views: { value: 1200 }, calls: { value: 1 }, directions: { value: 3 }, website_clicks: { value: 40 },
  messages: { value: null }, bookings: { value: null }, avg_rating: { value: 4.5 }, new_reviews: { value: 2 },
};

export const GOALS = [
  { metric: "reach", target: "7000", rationale: "r1" },
  { metric: "views", target: "60000", rationale: "r2" },
  { metric: "engagement_rate", target: "11.5%", rationale: "r3" },
  { metric: "alcance nos reels", target: "+10%", rationale: "r4" },
  { metric: "tiktok_followers_gained", target: "500", rationale: "r5" },
  { metric: "tiktok_unknown", target: "5", rationale: "r6" },
  { metric: "gbp_calls", target: "30", rationale: "r7" },
  { metric: "gbp_unknown", target: "x", rationale: "r8" },
];

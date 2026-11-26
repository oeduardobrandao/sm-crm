import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { buildAIPrompt } from "./ai.ts";
import type { ReportData } from "./types.ts";

const fixture: ReportData = {
  handle: "@drajuliana",
  specialty: "Dermatologia",
  period: "Maio 2026",
  report_month: "2026-05",
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
  top_posts: [{ type: "reel", reach: 12400, engagement: 6.8, saves: 340, likes: 890, comments: 45, caption_preview: "5 dicas para..." }],
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
const tiktokData: NonNullable<ReportData["tiktok"]> = {
  handle: "dra.tt",
  kpis: {
    followers_total: 500, followers_gained: 20, views: 1000, engagement_rate: 5.7, likes: 50,
    comments: 5, shares: 2, posts_count: 1, likes_total: null,
  },
  kpis_previous_month: { engagement_rate: 4.1 },
  top_videos: [{ caption: "Vídeo sobre pele", views: 1000, likes: 50, comments: 5, shares: 2, date: null }],
};
const googleData: NonNullable<ReportData["google"]> = {
  units: 2,
  window: { start: "2026-05-01", end: "2026-05-31", compared_with_days: 31 },
  kpis: {
    profile_views: 1000, calls: 40, directions: 30, website_clicks: 12, messages: 2, bookings: null,
    avg_rating: 4.8, new_reviews: 5,
  },
  kpis_previous_period: { profile_views: 900 },
  surfaces: [{ surface: "mobile_search", pct: 60 }],
  top_keywords: [{ keyword: "dermatologista", people: 80, at_most: null }],
  rating_distribution: null,
};

const sha = async (s: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))))
    .map((b) => b.toString(16).padStart(2, "0")).join("");

// Hashes capturados do prompt ANTES da mudança de idioma (código sem edição).
const PT_BASELINE: Record<string, { data: ReportData; opts?: { extraGuidance: string }; system: string; user: string }> = {
  ig: { data: fixture, system: "bb1e6aba68cc3998df07e8a488364700df21a58f5f8ad9f24c1af64f1026f40e", user: "fb2c26a05f1b2e789deb604fd81f1a740622f603234246cdceb7e24b922652ee" },
  ig_guided: { data: fixture, opts: { extraGuidance: "G" }, system: "766dbb324e0ddfeef99ba15b3e32ebee3905f8abecdcf487499cb52778b523c7", user: "fb2c26a05f1b2e789deb604fd81f1a740622f603234246cdceb7e24b922652ee" },
  tt: { data: { ...fixture, tiktok: tiktokData }, system: "ad51375d6e4f0c13479651d0029de105ebcd57ca561439e2191cb11e28b8ad65", user: "34590e655c7d90fbddf2956c19082638f554bae6e46a31815369507d5d17b93b" },
  tt_only: { data: { ...fixture, instagram_connected: false, tiktok: tiktokData }, system: "d8f6484149cb9746326bddc0b5f880042e73e8a8ab101be415e5f1983c706335", user: "7ad54463198ce88632e925b3465fc65ad7799cc4769d88e576468bb8cfd56b2e" },
  g_only: { data: { ...fixture, instagram_connected: false, google: googleData }, system: "15d733a8fc88ddda6eebdc122fc84ba9efcb178670a8ba4b4700c18240350083", user: "85167541cd8668214e13f6372b0669c8fd418c4b1489c8a9059d42be84c930c8" },
  all: { data: { ...fixture, tiktok: tiktokData, google: googleData }, system: "22b6ee43375dbddcb0d543c9643406be354d045ce52f9ddda0c3124c6eef617d", user: "e5bdd3f84a7c39de8f9232c3d20e408a03b07d836fda58a7ec3254bb8f294bf4" },
};

Deno.test("pt prompt unchanged: every variant hashes to the pre-change prompt", async () => {
  for (const [name, c] of Object.entries(PT_BASELINE)) {
    const p = buildAIPrompt(c.data, "pt", c.opts);
    assertEquals(await sha(p.systemPrompt), c.system, `${name} system`);
    assertEquals(await sha(p.userPrompt), c.user, `${name} user`);
  }
});

Deno.test("en prompt asks for English", () => {
  const { systemPrompt } = buildAIPrompt(fixture, "en");
  assertStringIncludes(systemPrompt, "Write in US English.");
  // A instrução de idioma em português não pode sobrar: duas ordens em conflito.
  assert(!systemPrompt.includes("Brazilian Portuguese"));
  assert(!systemPrompt.includes("pt-BR"));
});

Deno.test("en prompt: platform rules carry no Portuguese terms to quote", () => {
  const all = buildAIPrompt({ ...fixture, tiktok: tiktokData, google: googleData }, "en");
  for (const pt of [
    "engajamento por visualização", "visualizações do perfil", "no período anterior", "no mês anterior",
    "Meu Negócio", "NEGÓCIO", "menos de N pessoas", "Ligar, Rotas",
  ]) {
    assert(!all.systemPrompt.includes(pt), `system still has "${pt}"`);
    assert(!all.userPrompt.includes(pt), `user still has "${pt}"`);
  }
  assertStringIncludes(all.systemPrompt, '"engagement per view"');
  assertStringIncludes(all.systemPrompt, "GOOGLE BUSINESS PROFILE DATA RULES");
  assertStringIncludes(all.userPrompt, "Google Business Profile profile data");
  const gOnly = buildAIPrompt({ ...fixture, instagram_connected: false, google: googleData }, "en");
  assertStringIncludes(gOnly.userPrompt, "Google Business Profile profile data");
});

Deno.test("en prompt keeps the metric ids and JSON contract", () => {
  const pt = buildAIPrompt(fixture, "pt").systemPrompt;
  const en = buildAIPrompt(fixture, "en").systemPrompt;
  assertEquals(en.replace("LANGUAGE: Write in US English. All text, including labels and section headers, must be in US English.", ""),
    pt.replace("a Brazilian social media agency", "a social media agency").replace(/LANGUAGE: Write entirely in Brazilian Portuguese \(pt-BR\)\. All text, including labels and section headers, must be in pt-BR\./, ""));
});

Deno.test("en prompt does not rewrite the client's own data in the user prompt", () => {
  const data = { ...fixture, top_posts: [{ ...fixture.top_posts[0], caption_preview: "no mês anterior" }] };
  assertStringIncludes(buildAIPrompt(data, "en").userPrompt, "no mês anterior");
});

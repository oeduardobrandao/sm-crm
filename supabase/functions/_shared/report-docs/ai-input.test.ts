import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { prefixTikTokGoalMetrics, snapshotToReportData } from "./ai-input.ts";
import type { ReportDocSnapshot } from "./snapshot.ts";

const snap: ReportDocSnapshot = {
  version: 1,
  period: {
    month: "2026-07", label: "Julho de 2026", start: "2026-07-01T00:00:00.000Z",
    endExclusive: "2026-08-01T00:00:00.000Z", effectiveEnd: "2026-07-31T00:00:00.000Z",
  },
  account: { handle: "dra.x", specialty: "Dermato" },
  branding: { workspace_name: "DK", logo_url: null, splash_url: null, accent_color: "#000" },
  kpis: {
    followers_gained: { value: 10, unit: "count", prev: 5 },
    followers_total: { value: 1000, unit: "count", prev: null },
    reach: { value: 500, unit: "count", prev: null },
    views: { value: 800, unit: "count", prev: null },
    engagement_rate: { value: 4.2, unit: "pct", prev: null },
    saves: { value: 3, unit: "count", prev: null },
    posts_count: { value: 7, unit: "count", prev: null },
    profile_views: { value: null, unit: "count", prev: null },
    website_clicks: { value: null, unit: "count", prev: null },
    follows: { value: null, unit: "count", prev: null },
  },
  follower_trend: [{ date: "2026-07-01", count: 990 }],
  content_breakdown: { reels: { count: 3, avg_reach: 100, avg_engagement: 10, avg_views: 150 } },
  top_posts: [{ type: "reel", views: 150, reach: 100, likes: 5, comments: 1, saves: 2, shares: 3, caption_preview: "c", date: null, permalink: null, thumbnail_url: "https://x/y.jpg" }],
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
  assertEquals(rd.top_posts[0].engagement, 11); // likes+comments+saves+shares
  assert(!("thumbnail_base64" in rd.top_posts[0]));
});

Deno.test("snapshotToReportData: sem comparison no snapshot (ausente ou null) -> comparison null no payload", () => {
  assertEquals(snapshotToReportData(snap).comparison, null);
  assertEquals(snapshotToReportData({ ...snap, comparison: null }).comparison, null);
});

Deno.test("snapshotToReportData: comparison sem outlier -> presente, SEM instrução (note ausente)", () => {
  const rd = snapshotToReportData({
    ...snap,
    comparison: { prev_outlier: false, prev_top_share: 0.3 },
  });
  assertEquals(rd.comparison?.prev_outlier, false);
  assertEquals(rd.comparison?.prev_top_share, 0.3);
  assert(!("note" in (rd.comparison ?? {})));
});

Deno.test("snapshotToReportData: outlier true -> comparison ganha instrução pt-BR com o percentual", () => {
  const rd = snapshotToReportData({
    ...snap,
    comparison: { prev_outlier: true, prev_top_share: 0.734 },
  });
  assertEquals(rd.comparison?.prev_outlier, true);
  assertEquals(rd.comparison?.prev_top_share, 0.734);
  assert(rd.comparison?.note?.includes("73%"));
  assert(rd.comparison?.note?.includes("fora da curva"));
  // Regra da casa: nunca em-dash em texto de usuário.
  assert(!rd.comparison?.note?.includes("—"));
});

// ─── TikTok (spec 2026-10-28 §B3) ────────────────────────────────────────────────────

const tiktok: NonNullable<ReportDocSnapshot["tiktok"]> = {
  account: { handle: "dra.tt", display_name: "Dra TT", avatar_url: null },
  kpis: {
    followers_total: { value: 500, unit: "count", prev: 480 },
    followers_gained: { value: 20, unit: "count", prev: 10 },
    views: { value: 1000, unit: "count", prev: null },
    engagement_rate: { value: 5.7, unit: "pct", prev: 4.1 },
    likes: { value: 50, unit: "count", prev: null },
    comments: { value: 5, unit: "count", prev: null },
    shares: { value: 2, unit: "count", prev: null },
    posts_count: { value: 1, unit: "count", prev: 3 },
    likes_total: { value: null, unit: "count", prev: null },
  },
  follower_trend: [{ date: "2026-07-01", count: 480 }],
  best_times: [],
  top_posts: [{
    video_id: "v1", views: 1000, likes: 50, comments: 5, shares: 2, caption_preview: "Vídeo",
    date: "2026-07-10T15:00:00Z", permalink: "https://www.tiktok.com/@dra.tt/video/v1",
    thumbnail_url: "https://s.example/v1.jpg",
  }],
};

Deno.test("snapshotToReportData: snapshot só Instagram não ganha chave tiktok nem marcador de ausência", () => {
  // buildAIPrompt serializa o objeto inteiro: uma chave a mais mudaria o prompt de hoje.
  for (const s of [snap, { ...snap, instagram_connected: true }, { ...snap, tiktok: null }]) {
    const rd = snapshotToReportData(s);
    assert(!("tiktok" in rd));
    assert(!("instagram_connected" in rd));
  }
});

Deno.test("snapshotToReportData: seção TikTok vira tiktok com kpis numéricos e vídeos sem mídia", () => {
  const rd = snapshotToReportData({ ...snap, tiktok });
  assertEquals(rd.tiktok?.handle, "dra.tt");
  assertEquals(rd.tiktok?.kpis.views, 1000);
  assertEquals(rd.tiktok?.kpis.engagement_rate, 5.7);
  // KPI sem dado fica null explícito (o prompt explica que null = sem dados).
  assertEquals(rd.tiktok?.kpis.likes_total, null);
  // Comparação só onde o snapshot tem prev: somas (views, curtidas...) nunca têm.
  assertEquals(rd.tiktok?.kpis_previous_month, {
    followers_total: 480, followers_gained: 10, engagement_rate: 4.1, posts_count: 3,
  });
  assertEquals(rd.tiktok?.top_videos, [
    { caption: "Vídeo", views: 1000, likes: 50, comments: 5, shares: 2, date: "2026-07-10T15:00:00Z" },
  ]);
  assert(!JSON.stringify(rd.tiktok).includes("s.example"));
  assert(!("instagram_connected" in rd));
});

Deno.test("snapshotToReportData: instagram_connected false marca o Instagram ausente", () => {
  const rd = snapshotToReportData({ ...snap, instagram_connected: false, tiktok });
  assertEquals(rd.instagram_connected, false);
  assertEquals(rd.tiktok?.handle, "dra.tt");
});

Deno.test("snapshotToReportData: platforms restringe a narrativa às plataformas escolhidas", () => {
  const both = { ...snap, tiktok };
  // Só Instagram escolhido: o TikTok carregado fica fora da IA.
  const ig = snapshotToReportData(both, ["instagram"]);
  assert(!("tiktok" in ig));
  assert(!("instagram_connected" in ig));
  // Só TikTok escolhido com as duas conectadas: Instagram ausente para a IA.
  const tt = snapshotToReportData(both, ["tiktok"]);
  assertEquals(tt.instagram_connected, false);
  assertEquals(tt.tiktok?.handle, "dra.tt");
});

Deno.test("snapshotToReportData: comparação TikTok só para os KPIs da lista comparável", () => {
  // Uma soma com prev (snapshot malformado ou regra futura) nunca vira comparação para a IA.
  const rd = snapshotToReportData({
    ...snap,
    tiktok: { ...tiktok, kpis: { ...tiktok.kpis, views: { value: 1000, unit: "count", prev: 900 } } },
  });
  assert(!("views" in (rd.tiktok?.kpis_previous_month ?? {})));
  assertEquals(rd.tiktok?.kpis_previous_month.engagement_rate, 4.1);
});

Deno.test("prefixTikTokGoalMetrics: id TikTok sem prefixo ganha tiktok_; o resto passa igual", () => {
  const out = prefixTikTokGoalMetrics({
    executive_summary: "s", detailed_analysis: "d",
    recommendations: [
      { title: "a", description: "a", priority: "high", based_on_metric: "views" },
      { title: "b", description: "b", priority: "low", based_on_metric: "tiktok_likes" },
      { title: "c", description: "c", priority: "low" },
    ],
    suggested_goals: [
      { metric: "views", target: "1", rationale: "r" },
      { metric: "likes_total", target: "1", rationale: "r" },
      { metric: "tiktok_shares", target: "1", rationale: "r" },
      { metric: "texto livre", target: "1", rationale: "r" },
    ],
  });
  assertEquals(out.suggested_goals.map((g) => g.metric), ["tiktok_views", "tiktok_likes_total", "tiktok_shares", "texto livre"]);
  assertEquals(out.recommendations.map((r) => r.based_on_metric), ["tiktok_views", "tiktok_likes", undefined]);
  assert(!("based_on_metric" in out.recommendations[2]));
});

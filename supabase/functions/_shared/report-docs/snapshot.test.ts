import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { assembleSnapshot } from "./snapshot.ts";

Deno.test("assembleSnapshot monta o documento congelado", () => {
  const snap = assembleSnapshot({
    month: "2026-07",
    nowIso: "2026-08-15T00:00:00.000Z", // mês já fechado (não é o que este teste cobre)
    prevMonthPosts: null,
    account: { handle: "dra.exemplo", specialty: "Dermatologia · São Paulo" },
    branding: { workspace_name: "DK", logo_url: null, splash_url: null, accent_color: "#123456" },
    kpiSources: {
      // Task 10 re-wires real sources: accountMonth/accountPrevMonth chegam
      // vazios aqui de propósito -- este teste cobre a montagem do snapshot,
      // não a busca de métricas de conta.
      accountMonth: null, accountPrevMonth: null,
      followersClose: null, followersPrevClose: null,
      followerHistory: [{ follower_count: 900 }],
      allPosts: [{ reach: 100, likes: 10, comments: 1, saved: 2, shares: 0 }],
      prevMonthPostsCount: null,
    },
    followerTrend: [{ date: "2026-07-01", count: 900 }],
    posts: [{
      media_type: "REEL", impressions: 250, reach: 100, likes: 10, comments: 1, saved: 2,
      shares: 4,
      caption: "Legenda grande demais".repeat(20), posted_at: "2026-07-10T12:00:00Z",
      permalink: "https://instagram.com/p/x", thumbnail_url: "https://cdninstagram.com/x.jpg",
    }],
    stableThumbnails: new Map(),
    audience: null,
    bestTimes: [],
    tagsPerformance: [],
  });
  assertEquals(snap.version, 1);
  assertEquals(snap.period.month, "2026-07");
  assertEquals(snap.period.label, "Julho de 2026");
  // reach agora vem de AccountTotals (accountMonth), não da soma de posts;
  // sem accountMonth nesta fixture, o card se omite (Task 10 re-wires real sources).
  assertEquals(snap.kpis.reach.value, null);
  assertEquals(snap.top_posts.length, 1);
  assertEquals(snap.top_posts[0].type, "reel");
  // shares flui de SnapshotPostRow pra SnapshotTopPost (não fica de fora, como
  // acontecia antes do fix de paridade com o engagement agregado).
  assertEquals(snap.top_posts[0].shares, 4);
  // URL efêmera do CDN NUNCA entra no snapshot (spec §5).
  assertEquals(snap.top_posts[0].thumbnail_url, null);
  assert(snap.top_posts[0].caption_preview.length <= 140);
  assertEquals(snap.content_breakdown.reels?.count, 1);
  // Engagement rate: (10 + 1 + 2 + 4) / 100 = 0.17
  assertEquals(snap.content_breakdown.reels?.avg_engagement, 0.17);
  // Views fluem por post (impressions) e como média do formato.
  assertEquals(snap.top_posts[0].views, 250);
  assertEquals(snap.content_breakdown.reels?.avg_views, 250);
});

Deno.test("top posts ordenam por views desc; empate de views decide por reach", () => {
  const post = (impressions: number | null, reach: number, caption: string) => ({
    media_type: "IMAGE", impressions, reach, likes: 0, comments: 0, saved: 0, shares: 0,
    caption, posted_at: null, permalink: null, thumbnail_url: null,
  });
  const snap = assembleSnapshot({
    month: "2026-07",
    nowIso: "2026-08-15T00:00:00.000Z", // mês já fechado (não é o que este teste cobre)
    prevMonthPosts: null,
    account: { handle: "h", specialty: "" },
    branding: { workspace_name: "W", logo_url: null, splash_url: null, accent_color: "#000" },
    kpiSources: {
      accountMonth: null, accountPrevMonth: null,
      followersClose: null, followersPrevClose: null,
      followerHistory: [], allPosts: [], prevMonthPostsCount: null,
    },
    followerTrend: [],
    // Reach mandaria "c" primeiro; views mandam "a". Empate 100 ("b" vs "c"):
    // reach decide. Posts sem impressions (null, dado não sincronizado)
    // degradam para a ordem por reach.
    posts: [post(100, 10, "b"), post(500, 1, "a"), post(100, 99, "c"), post(null, 50, "d")],
    stableThumbnails: new Map(),
    audience: null, bestTimes: [], tagsPerformance: [],
  });
  assertEquals(snap.top_posts.map((p) => p.caption_preview), ["a", "c", "b", "d"]);
  assertEquals(snap.top_posts.map((p) => p.views), [500, 100, 100, 0]);
});

Deno.test("thumbnail estável (mapa) entra; carousel e image mapeiam certo", () => {
  const snap = assembleSnapshot({
    month: "2026-07",
    nowIso: "2026-08-15T00:00:00.000Z", // mês já fechado (não é o que este teste cobre)
    prevMonthPosts: null,
    account: { handle: "h", specialty: "" },
    branding: { workspace_name: "W", logo_url: null, splash_url: null, accent_color: "#000" },
    kpiSources: {
      accountMonth: null, accountPrevMonth: null,
      followersClose: null, followersPrevClose: null,
      followerHistory: [], allPosts: [], prevMonthPostsCount: null,
    },
    followerTrend: [],
    posts: [
      { media_type: "CAROUSEL_ALBUM", impressions: 9, reach: 5, likes: 0, comments: 0, saved: 0, shares: 0, caption: "a", posted_at: null, permalink: null, thumbnail_url: "https://cdninstagram.com/a.jpg" },
      { media_type: "IMAGE", impressions: 4, reach: 3, likes: 0, comments: 0, saved: 0, shares: 0, caption: "b", posted_at: null, permalink: null, thumbnail_url: "https://supabase.co/storage/v1/object/public/instagram-posts/1/b.jpg" },
    ],
    stableThumbnails: new Map([["https://cdninstagram.com/a.jpg", "https://supabase.co/storage/cached-a.jpg"]]),
    audience: null, bestTimes: [], tagsPerformance: [],
  });
  assertEquals(snap.top_posts[0].type, "carousel");
  assertEquals(snap.top_posts[0].thumbnail_url, "https://supabase.co/storage/cached-a.jpg");
  assertEquals(snap.top_posts[1].type, "image");
  // Já estável (não é host do IG): passa direto.
  assert(snap.top_posts[1].thumbnail_url!.includes("instagram-posts/1/b.jpg"));
});

Deno.test("aceita branding.hub_theme opcional sem quebrar o assembleSnapshot", () => {
  const snap = assembleSnapshot({
    month: "2026-08",
    nowIso: "2026-09-15T00:00:00.000Z", // mês já fechado (não é o que este teste cobre)
    prevMonthPosts: null,
    account: { handle: "x", specialty: "" },
    branding: {
      workspace_name: "W", logo_url: null, splash_url: null, accent_color: "#000",
      hub_theme: {
        surface: "warm", font_display: "sora", font_body: "manrope",
        radius: "pill", card_style: "outline",
      },
    },
    kpiSources: {
      accountMonth: null, accountPrevMonth: null,
      followersClose: null, followersPrevClose: null,
      followerHistory: [], allPosts: [], prevMonthPostsCount: null,
    },
    followerTrend: [],
    posts: [],
    stableThumbnails: new Map(),
    audience: null,
    bestTimes: [],
    tagsPerformance: [],
  });
  assertEquals(snap.branding.hub_theme?.surface, "warm");
  assertEquals(snap.branding.hub_theme?.card_style, "outline");
});

Deno.test("assembleSnapshot repassa profile_picture_url e client_name do account", () => {
  const snap = assembleSnapshot({
    month: "2026-07",
    nowIso: "2026-08-15T00:00:00.000Z", // mês já fechado (não é o que este teste cobre)
    prevMonthPosts: null,
    account: {
      handle: "dra.exemplo", specialty: "Dermatologia",
      profile_picture_url: "https://x/avatar.jpg", client_name: "Dra. Exemplo",
    },
    branding: { workspace_name: "DK", logo_url: null, splash_url: null, accent_color: "#123456" },
    kpiSources: {
      accountMonth: null, accountPrevMonth: null,
      followersClose: null, followersPrevClose: null,
      followerHistory: [], allPosts: [], prevMonthPostsCount: null,
    },
    followerTrend: [],
    posts: [],
    stableThumbnails: new Map(),
    audience: null,
    bestTimes: [],
    tagsPerformance: [],
  });
  assertEquals(snap.account.profile_picture_url, "https://x/avatar.jpg");
  assertEquals(snap.account.client_name, "Dra. Exemplo");
});

Deno.test("assembleSnapshot: account sem profile_picture_url/client_name continua válido (compat)", () => {
  const snap = assembleSnapshot({
    month: "2026-07",
    nowIso: "2026-08-15T00:00:00.000Z", // mês já fechado (não é o que este teste cobre)
    prevMonthPosts: null,
    account: { handle: "h", specialty: "" },
    branding: { workspace_name: "W", logo_url: null, splash_url: null, accent_color: "#000" },
    kpiSources: {
      accountMonth: null, accountPrevMonth: null,
      followersClose: null, followersPrevClose: null,
      followerHistory: [], allPosts: [], prevMonthPostsCount: null,
    },
    followerTrend: [],
    posts: [],
    stableThumbnails: new Map(),
    audience: null,
    bestTimes: [],
    tagsPerformance: [],
  });
  assertEquals(snap.account.profile_picture_url, undefined);
  assertEquals(snap.account.client_name, undefined);
});

// deno-lint-ignore no-explicit-any
function baseInput(overrides: Record<string, any> = {}): any {
  return {
    month: "2026-07",
    nowIso: "2026-08-15T00:00:00.000Z",
    prevMonthPosts: null,
    account: { handle: "h", specialty: "" },
    branding: { workspace_name: "W", logo_url: null, splash_url: null, accent_color: "#000" },
    kpiSources: {
      accountMonth: null, accountPrevMonth: null,
      followersClose: null, followersPrevClose: null,
      followerHistory: [], allPosts: [], prevMonthPostsCount: null,
    },
    followerTrend: [],
    posts: [],
    stableThumbnails: new Map(),
    audience: null,
    bestTimes: [],
    tagsPerformance: [],
    ...overrides,
  };
}

Deno.test("period.effectiveEnd: mês fechado -> último dia do mês (endExclusive - 1 dia)", () => {
  const snap = assembleSnapshot(baseInput({
    month: "2026-07",
    nowIso: "2026-09-01T10:00:00.000Z", // geração bem depois de julho ter fechado
  }));
  assertEquals(snap.period.effectiveEnd, "2026-07-31T00:00:00.000Z");
});

Deno.test("period.effectiveEnd: mês corrente -> o dia da geração, nunca o mês inteiro", () => {
  const snap = assembleSnapshot(baseInput({
    month: "2026-08",
    nowIso: "2026-08-15T12:30:00.000Z", // geração NO MEIO de agosto
  }));
  assertEquals(snap.period.effectiveEnd, "2026-08-15T12:30:00.000Z");
});

Deno.test("period.effectiveEnd: geração exatamente no último dia do mês corrente", () => {
  const snap = assembleSnapshot(baseInput({
    month: "2026-08",
    nowIso: "2026-08-31T09:00:00.000Z",
  }));
  // now (31/ago 09:00) ainda cai ANTES do "último dia" calculado às 00:00 --
  // min() escolhe o último dia (00:00), mesmo dia calendário.
  assertEquals(snap.period.effectiveEnd, "2026-08-31T00:00:00.000Z");
});

Deno.test("comparison: null quando o mês anterior não tem posts (vazio ou fonte indisponível)", () => {
  assertEquals(assembleSnapshot(baseInput({ prevMonthPosts: null })).comparison, null);
  assertEquals(assembleSnapshot(baseInput({ prevMonthPosts: [] })).comparison, null);
});

Deno.test("comparison: post único > 50% da soma de views -> outlier true", () => {
  const snap = assembleSnapshot(baseInput({
    prevMonthPosts: [
      { views: 600, reach: 100 },
      { views: 200, reach: 100 },
      { views: 200, reach: 100 },
    ],
  }));
  // 600 / 1000 = 0.6 (views); reach empatado (100/300 = 0.33) -- views vence.
  assertEquals(snap.comparison?.prev_outlier, true);
  assertEquals(snap.comparison?.prev_top_share, 0.6);
});

Deno.test("comparison: post único > 50% da soma de REACH (mesmo com views equilibradas) -> outlier true", () => {
  const snap = assembleSnapshot(baseInput({
    prevMonthPosts: [
      { views: 100, reach: 900 },
      { views: 100, reach: 50 },
      { views: 100, reach: 50 },
    ],
  }));
  assertEquals(snap.comparison?.prev_outlier, true);
  assertEquals(snap.comparison?.prev_top_share, 0.9);
});

Deno.test("comparison: fronteira exata de 50% NÃO é outlier (estritamente >50%)", () => {
  const snap = assembleSnapshot(baseInput({
    prevMonthPosts: [
      { views: 500, reach: 0 },
      { views: 500, reach: 0 },
    ],
  }));
  assertEquals(snap.comparison?.prev_top_share, 0.5);
  assertEquals(snap.comparison?.prev_outlier, false);
});

Deno.test("comparison: 1 ponto acima de 50% já vira outlier", () => {
  const snap = assembleSnapshot(baseInput({
    prevMonthPosts: [
      { views: 501, reach: 0 },
      { views: 499, reach: 0 },
    ],
  }));
  assertEquals(snap.comparison?.prev_top_share, 0.501);
  assertEquals(snap.comparison?.prev_outlier, true);
});

Deno.test("comparison: distribuição equilibrada -> outlier false, top_share reflete o maior post", () => {
  const snap = assembleSnapshot(baseInput({
    prevMonthPosts: [
      { views: 100, reach: 100 },
      { views: 100, reach: 100 },
      { views: 100, reach: 100 },
      { views: 100, reach: 100 },
    ],
  }));
  assertEquals(snap.comparison?.prev_outlier, false);
  assertEquals(snap.comparison?.prev_top_share, 0.25);
});

Deno.test("comparison: views/reach nulos no post degradam para 0, sem quebrar o cálculo", () => {
  const snap = assembleSnapshot(baseInput({
    prevMonthPosts: [
      { views: null, reach: null },
      { views: 300, reach: null },
    ],
  }));
  assertEquals(snap.comparison?.prev_top_share, 1); // um único post soma tudo
  assertEquals(snap.comparison?.prev_outlier, true);
});

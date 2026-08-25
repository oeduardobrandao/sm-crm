import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { assembleSnapshot } from "./snapshot.ts";

Deno.test("assembleSnapshot monta o documento congelado", () => {
  const snap = assembleSnapshot({
    month: "2026-07",
    account: { handle: "dra.exemplo", specialty: "Dermatologia · São Paulo" },
    branding: { workspace_name: "DK", logo_url: null, splash_url: null, accent_color: "#123456" },
    kpiSources: {
      allPosts: [{ reach: 100, likes: 10, comments: 1, saved: 2, shares: 0 }],
      prevMonthPosts: [],
      currSnapshot: null, prevSnapshot: null, prevPrevSnapshot: null,
      followerHistory: [{ follower_count: 900 }],
      accountViews: null,
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
  assertEquals(snap.kpis.reach.value, 100);
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
    account: { handle: "h", specialty: "" },
    branding: { workspace_name: "W", logo_url: null, splash_url: null, accent_color: "#000" },
    kpiSources: {
      allPosts: [], prevMonthPosts: null, currSnapshot: null, prevSnapshot: null,
      prevPrevSnapshot: null, followerHistory: [], accountViews: null,
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
    account: { handle: "h", specialty: "" },
    branding: { workspace_name: "W", logo_url: null, splash_url: null, accent_color: "#000" },
    kpiSources: {
      allPosts: [], prevMonthPosts: null, currSnapshot: null, prevSnapshot: null,
      prevPrevSnapshot: null, followerHistory: [], accountViews: null,
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
    account: { handle: "x", specialty: "" },
    branding: {
      workspace_name: "W", logo_url: null, splash_url: null, accent_color: "#000",
      hub_theme: {
        surface: "warm", font_display: "sora", font_body: "manrope",
        radius: "pill", card_style: "outline",
      },
    },
    kpiSources: {
      allPosts: [], prevMonthPosts: null, currSnapshot: null, prevSnapshot: null,
      prevPrevSnapshot: null, followerHistory: [], accountViews: null,
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
    account: {
      handle: "dra.exemplo", specialty: "Dermatologia",
      profile_picture_url: "https://x/avatar.jpg", client_name: "Dra. Exemplo",
    },
    branding: { workspace_name: "DK", logo_url: null, splash_url: null, accent_color: "#123456" },
    kpiSources: {
      allPosts: [], prevMonthPosts: null, currSnapshot: null, prevSnapshot: null,
      prevPrevSnapshot: null, followerHistory: [], accountViews: null,
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
    account: { handle: "h", specialty: "" },
    branding: { workspace_name: "W", logo_url: null, splash_url: null, accent_color: "#000" },
    kpiSources: {
      allPosts: [], prevMonthPosts: null, currSnapshot: null, prevSnapshot: null,
      prevPrevSnapshot: null, followerHistory: [], accountViews: null,
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

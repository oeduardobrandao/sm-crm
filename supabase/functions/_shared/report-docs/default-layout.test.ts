import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { buildDefaultLayout } from "./default-layout.ts";
import { blockPlatform, validateLayout } from "./layout.ts";

const seqId = () => { let n = 0; return () => `b${++n}`; };

Deno.test("layout padrão completo passa no validador e começa com capa", () => {
  const l = buildDefaultLayout({ hasAi: true, hasAudience: true, hasBestTimes: true, hasTags: true, makeId: seqId() });
  assert(validateLayout(l).ok);
  assertEquals(l.blocks[0].type, "cover");
  assertEquals(l.blocks[1].type, "ai_summary");
  const types = l.blocks.map((b) => b.type);
  assert(types.includes("top_posts"));
  assert(types.includes("audience_gender"));
  assert(types.includes("ai_recommendations"));
  // Views (2026-08) fecham a linha de terços com visitas ao perfil e cliques.
  assert(types.includes("kpi_views"));
  for (const t of ["kpi_views", "kpi_profile_views", "kpi_website_clicks"] as const) {
    assertEquals(l.blocks.find((b) => b.type === t)?.size, "third");
  }
});

Deno.test("sem audiência/horários/tags/IA os blocos correspondentes somem", () => {
  const l = buildDefaultLayout({ hasAi: false, hasAudience: false, hasBestTimes: false, hasTags: false, makeId: seqId() });
  const types = l.blocks.map((b) => b.type);
  assert(!types.includes("audience_gender"));
  assert(!types.includes("chart_best_times"));
  assert(!types.includes("tags_table"));
  assert(!types.includes("ai_recommendations"));
  assert(!types.includes("ai_goals"));
  assert(types.includes("ai_summary")); // sempre presente: recebe fallback
  assert(validateLayout(l).ok);
});

Deno.test("ids são únicos", () => {
  const l = buildDefaultLayout({ hasAi: true, hasAudience: true, hasBestTimes: true, hasTags: true, makeId: seqId() });
  assertEquals(new Set(l.blocks.map((b) => b.id)).size, l.blocks.length);
});

// ─── Plataformas (spec 2026-10-28 §B1/§B3) ──────────────────────────────────────────

const FULL = { hasAi: true, hasAudience: true, hasBestTimes: true, hasTags: true } as const;

// Ordem de hoje, congelada: o relatório só Instagram não pode mudar com o TikTok.
const IG_TYPES = [
  "cover", "ai_summary",
  "section_header", "kpi_followers_gained", "kpi_followers_total", "kpi_engagement_rate",
  "kpi_reach", "kpi_saves", "kpi_posts_count",
  "section_header", "chart_followers", "chart_formats", "kpi_views", "kpi_profile_views",
  "kpi_website_clicks",
  "section_header", "top_posts", "tags_table",
  "section_header", "audience_gender", "audience_age", "audience_cities", "audience_countries",
  "chart_best_times",
  "section_header", "ai_recommendations", "ai_goals",
];

const TT_SECTION = [
  { type: "section_header", size: "full", config: { title: "TikTok" } },
  { type: "tiktok_kpi_followers_gained", size: "third" },
  { type: "tiktok_kpi_followers_total", size: "third" },
  { type: "tiktok_kpi_engagement_rate", size: "third" },
  { type: "tiktok_kpi_views", size: "third" },
  { type: "tiktok_kpi_likes", size: "third" },
  { type: "tiktok_kpi_posts_count", size: "third" },
  { type: "tiktok_chart_followers", size: "full" },
  { type: "tiktok_top_posts", size: "full", config: { count: 6 } },
  { type: "tiktok_chart_best_times", size: "full" },
];

const shape = (blocks: { type: string; size: string; config?: Record<string, unknown> }[]) =>
  blocks.map((b) => (b.config ? { type: b.type, size: b.size, config: b.config } : { type: b.type, size: b.size }));

Deno.test("default layout instagram only is unchanged", () => {
  const explicit = buildDefaultLayout({ ...FULL, platforms: ["instagram"], hasTikTokBestTimes: true, makeId: seqId() });
  assertEquals(explicit.blocks.map((b) => b.type), IG_TYPES);
  // Sem platforms (template do sistema no CRM): o mesmo layout só Instagram.
  const omitted = buildDefaultLayout({ ...FULL, makeId: seqId() });
  assertEquals(omitted, explicit);
});

Deno.test("default layout both appends TikTok section before Próximos passos", () => {
  const l = buildDefaultLayout({ ...FULL, platforms: ["instagram", "tiktok"], hasTikTokBestTimes: true, makeId: seqId() });
  assert(validateLayout(l).ok);
  const nextSteps = l.blocks.findIndex((b) => b.type === "section_header" && b.config?.title === "Próximos passos");
  const ttStart = nextSteps - TT_SECTION.length;
  // Instagram inteiro antes, na ordem de hoje; TikTok logo antes de "Próximos passos".
  assertEquals(l.blocks.slice(0, ttStart).map((b) => b.type), IG_TYPES.slice(0, IG_TYPES.length - 3));
  assertEquals(shape(l.blocks.slice(ttStart, nextSteps)), TT_SECTION);
  assertEquals(l.blocks.slice(nextSteps).map((b) => b.type), ["section_header", "ai_recommendations", "ai_goals"]);
});

Deno.test("default layout both without AI ends with the TikTok section", () => {
  const l = buildDefaultLayout({ ...FULL, hasAi: false, platforms: ["instagram", "tiktok"], hasTikTokBestTimes: true, makeId: seqId() });
  assertEquals(shape(l.blocks.slice(-TT_SECTION.length)), TT_SECTION);
});

Deno.test("default layout without TikTok best times drops only that chart", () => {
  const l = buildDefaultLayout({ ...FULL, platforms: ["instagram", "tiktok"], hasTikTokBestTimes: false, makeId: seqId() });
  const types = l.blocks.map((b) => b.type);
  assert(!types.includes("tiktok_chart_best_times"));
  assert(types.includes("tiktok_top_posts"));
  // O horário do Instagram não depende do TikTok.
  assert(types.includes("chart_best_times"));
});

Deno.test("default layout tiktok only has no Instagram data blocks", () => {
  const l = buildDefaultLayout({ ...FULL, platforms: ["tiktok"], hasTikTokBestTimes: true, makeId: seqId() });
  assert(validateLayout(l).ok);
  assertEquals(shape(l.blocks), [
    { type: "cover", size: "full" },
    { type: "ai_summary", size: "full" },
    ...TT_SECTION,
    { type: "section_header", size: "full", config: { title: "Próximos passos" } },
    { type: "ai_recommendations", size: "full" },
    { type: "ai_goals", size: "full" },
  ]);
  for (const b of l.blocks) assert(blockPlatform(b.type) !== "instagram", b.type);
});

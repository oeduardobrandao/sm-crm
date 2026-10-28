import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { buildDefaultLayout, NEXT_STEPS_TITLE, platformSectionBlocks } from "./default-layout.ts";
import { blockPlatform, validateLayout } from "./layout.ts";
import { sectionizeLayout, toSections } from "./sections.ts";

const seqId = () => { let n = 0; return () => `b${++n}`; };

Deno.test("layout padrão completo passa no validador e começa com capa", () => {
  const l = buildDefaultLayout({ hasAi: true, hasAudience: true, hasBestTimes: true, hasTags: true, makeId: seqId() });
  assert(validateLayout(l).ok);
  // Seção Geral de abertura: capa e resumo.
  assertEquals(l.blocks[0], { id: "b1", type: "section", size: "full" });
  assertEquals(l.blocks[1].type, "cover");
  assertEquals(l.blocks[2].type, "ai_summary");
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

// ─── Seções por plataforma (spec 2026-10-28-report-platform-sections §Generation) ─────

const FULL = { hasAi: true, hasAudience: true, hasBestTimes: true, hasTags: true } as const;

// Blocos da seção Instagram: os de hoje, os quatro section_header viram subtítulos.
const IG_TYPES = [
  "section_header", "kpi_followers_gained", "kpi_followers_total", "kpi_engagement_rate",
  "kpi_reach", "kpi_saves", "kpi_posts_count",
  "section_header", "chart_followers", "chart_formats", "kpi_views", "kpi_profile_views",
  "kpi_website_clicks",
  "section_header", "top_posts", "tags_table",
  "section_header", "audience_gender", "audience_age", "audience_cities", "audience_countries",
  "chart_best_times",
];

// Seção TikTok: sem o section_header "TikTok" (o título da seção já diz).
const TT_SECTION = [
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

const GERAL = { type: "section", size: "full" };
const IG_MARKER = { type: "section", size: "full", config: { platform: "instagram" } };
const TT_MARKER = { type: "section", size: "full", config: { platform: "tiktok" } };
const NEXT_STEPS = [
  { type: "section", size: "full", config: { title: "Próximos passos" } },
  { type: "section_header", size: "full", config: { title: "Próximos passos" } },
  { type: "ai_recommendations", size: "full" },
  { type: "ai_goals", size: "full" },
];
const OPENING = [GERAL, { type: "cover", size: "full" }, { type: "ai_summary", size: "full" }];

const shape = (blocks: { type: string; size: string; config?: Record<string, unknown> }[]) =>
  blocks.map((b) => (b.config ? { type: b.type, size: b.size, config: b.config } : { type: b.type, size: b.size }));
const igShape = () => shape(platformSectionBlocks("instagram", { ...FULL }, seqId()));

/** Canônico = valida e sectionizeLayout devolve a mesma referência. */
function assertCanonical(l: Parameters<typeof sectionizeLayout>[0]) {
  const v = validateLayout(l);
  assert(v.ok, v.ok ? "" : v.error);
  assert(sectionizeLayout(l) === l, "layout gerado deveria já estar na forma canônica");
}

Deno.test("default layout instagram only: Geral, Instagram section, Próximos passos", () => {
  const explicit = buildDefaultLayout({ ...FULL, platforms: ["instagram"], hasTikTokBestTimes: true, makeId: seqId() });
  assertCanonical(explicit);
  assertEquals(shape(explicit.blocks), [...OPENING, IG_MARKER, ...igShape(), ...NEXT_STEPS]);
  assertEquals(igShape().map((b) => b.type), IG_TYPES);
  assertEquals(toSections(explicit).map((s) => s.kind), ["general", "instagram", "general"]);
  // Heading da plataforma visível: nada de hideHeader no padrão do sistema.
  assert(!explicit.blocks.some((b) => b.config?.hideHeader !== undefined));
  // Sem platforms (template do sistema no CRM): o mesmo layout só Instagram.
  const omitted = buildDefaultLayout({ ...FULL, makeId: seqId() });
  assertEquals(omitted, explicit);
});

Deno.test("default layout both: Instagram then TikTok, then Próximos passos", () => {
  const l = buildDefaultLayout({ ...FULL, platforms: ["instagram", "tiktok"], hasTikTokBestTimes: true, makeId: seqId() });
  assertCanonical(l);
  assertEquals(shape(l.blocks), [...OPENING, IG_MARKER, ...igShape(), TT_MARKER, ...TT_SECTION, ...NEXT_STEPS]);
  assertEquals(toSections(l).map((s) => s.kind), ["general", "instagram", "tiktok", "general"]);
});

Deno.test("default layout both without AI ends with the TikTok section", () => {
  const l = buildDefaultLayout({ ...FULL, hasAi: false, platforms: ["instagram", "tiktok"], hasTikTokBestTimes: true, makeId: seqId() });
  assertCanonical(l);
  assertEquals(shape(l.blocks), [...OPENING, IG_MARKER, ...igShape(), TT_MARKER, ...TT_SECTION]);
  assert(!l.blocks.some((b) => b.config?.title === NEXT_STEPS_TITLE));
});

Deno.test("default layout without TikTok best times drops only that chart", () => {
  const l = buildDefaultLayout({ ...FULL, platforms: ["instagram", "tiktok"], hasTikTokBestTimes: false, makeId: seqId() });
  const types = l.blocks.map((b) => b.type);
  assert(!types.includes("tiktok_chart_best_times"));
  assert(types.includes("tiktok_top_posts"));
  // O horário do Instagram não depende do TikTok.
  assert(types.includes("chart_best_times"));
  assertCanonical(l);
});

Deno.test("default layout tiktok only has no Instagram data blocks", () => {
  const l = buildDefaultLayout({ ...FULL, platforms: ["tiktok"], hasTikTokBestTimes: true, makeId: seqId() });
  assertCanonical(l);
  assertEquals(shape(l.blocks), [...OPENING, TT_MARKER, ...TT_SECTION, ...NEXT_STEPS]);
  for (const b of l.blocks) assert(blockPlatform(b.type) !== "instagram", b.type);
});

Deno.test("default layout tiktok only without AI: Geral then TikTok, nothing after", () => {
  const l = buildDefaultLayout({ ...FULL, hasAi: false, platforms: ["tiktok"], hasTikTokBestTimes: false, makeId: seqId() });
  assertCanonical(l);
  assertEquals(shape(l.blocks), [...OPENING, TT_MARKER, ...TT_SECTION.filter((b) => b.type !== "tiktok_chart_best_times")]);
});

Deno.test("the TikTok section has no section_header titled TikTok", () => {
  for (const platforms of [["tiktok"], ["instagram", "tiktok"]] as const) {
    const l = buildDefaultLayout({ ...FULL, platforms, hasTikTokBestTimes: true, makeId: seqId() });
    assert(!l.blocks.some((b) => b.type === "section_header" && b.config?.title === "TikTok"));
  }
  const blocks = platformSectionBlocks("tiktok", { ...FULL, hasTikTokBestTimes: true }, seqId());
  assertEquals(shape(blocks), TT_SECTION);
});

Deno.test("platformSectionBlocks: content only (no marker), ids from makeId, the same blocks as the default", () => {
  for (const p of ["instagram", "tiktok"] as const) {
    const blocks = platformSectionBlocks(p, { ...FULL, hasTikTokBestTimes: true }, seqId());
    assert(!blocks.some((b) => b.type === "section"));
    assertEquals(blocks.map((b) => b.id), blocks.map((_, i) => `b${i + 1}`));
    for (const b of blocks) assert([p, null].includes(blockPlatform(b.type)), b.type);
    const l = buildDefaultLayout({ ...FULL, platforms: [p], hasTikTokBestTimes: true, makeId: seqId() });
    const section = toSections(l).find((s) => s.kind === p);
    assertEquals(shape(section!.blocks), shape(blocks));
  }
  // Default de makeId: uuids únicos.
  const a = platformSectionBlocks("instagram", { ...FULL });
  assertEquals(new Set(a.map((b) => b.id)).size, a.length);
});

Deno.test("default layout without any platform: Geral and Próximos passos only, still valid", () => {
  const l = buildDefaultLayout({ ...FULL, platforms: [], makeId: seqId() });
  assertCanonical(l);
  assertEquals(shape(l.blocks), [...OPENING, ...NEXT_STEPS]);
});

Deno.test("marker ids come from makeId in document order", () => {
  const l = buildDefaultLayout({ ...FULL, platforms: ["instagram", "tiktok"], hasTikTokBestTimes: true, makeId: seqId() });
  assertEquals(l.blocks.map((b) => b.id), l.blocks.map((_, i) => `b${i + 1}`));
});

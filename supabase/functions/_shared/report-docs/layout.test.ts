import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  BLOCK_TYPES,
  blockPlatform,
  LAYOUT_VERSION,
  normalizeCoverSize,
  type ReportLayout,
  sanitizeLayoutForTemplate,
  validateLayout,
} from "./layout.ts";
import { TIKTOK_KPI_IDS } from "../tiktok-analytics/kpis.ts";

const block = (over: Record<string, unknown> = {}) => ({
  id: "b1", type: "text", size: "full", ...over,
});
const layout = (blocks: unknown[]) => ({ version: LAYOUT_VERSION, blocks });

Deno.test("validateLayout aceita layout mínimo válido", () => {
  const r = validateLayout(layout([block()]));
  assert(r.ok);
  assertEquals(r.layout.blocks.length, 1);
});

Deno.test("validateLayout rejeita não-objeto, version errada e blocks ausente", () => {
  assert(!validateLayout(null).ok);
  assert(!validateLayout([]).ok);
  assert(!validateLayout({ version: 99, blocks: [] }).ok);
  assert(!validateLayout({ version: LAYOUT_VERSION }).ok);
});

Deno.test("validateLayout rejeita bloco com tipo desconhecido, size inválido e id vazio", () => {
  assert(!validateLayout(layout([block({ type: "nope" })])).ok);
  assert(!validateLayout(layout([block({ size: "xl" })])).ok);
  assert(!validateLayout(layout([block({ id: "" })])).ok);
});

Deno.test("validateLayout: text só em blocos textuais; count do top_posts entre 1 e 12", () => {
  assert(validateLayout(layout([block({ type: "ai_summary", text: { type: "doc" } })])).ok);
  assert(!validateLayout(layout([block({ type: "kpi_reach", size: "third", text: {} })])).ok);
  assert(validateLayout(layout([block({ type: "top_posts", config: { count: 6 } })])).ok);
  assert(!validateLayout(layout([block({ type: "top_posts", config: { count: 0 } })])).ok);
  assert(!validateLayout(layout([block({ type: "top_posts", config: { count: 13 } })])).ok);
});

Deno.test("validateLayout rejeita mais de 200 blocos e ids duplicados", () => {
  const many = Array.from({ length: 201 }, (_, i) => block({ id: `b${i}` }));
  assert(!validateLayout(layout(many)).ok);
  assert(!validateLayout(layout([block({ id: "x" }), block({ id: "x" })])).ok);
});

Deno.test("catálogo tem os 41 tipos (28 + 13 tiktok_* de 2026-10-28)", () => {
  assertEquals(BLOCK_TYPES.length, 41);
  assert((BLOCK_TYPES as readonly string[]).includes("image"));
  assert((BLOCK_TYPES as readonly string[]).includes("kpi_follows"));
});

Deno.test("validateLayout: accent opcional precisa ser hex #rrggbb", () => {
  assert(validateLayout({ version: LAYOUT_VERSION, accent: "#9f1239", blocks: [block()] }).ok);
  assert(!validateLayout({ version: LAYOUT_VERSION, accent: "vermelho", blocks: [block()] }).ok);
  assert(!validateLayout({ version: LAYOUT_VERSION, accent: "#fff", blocks: [block()] }).ok);
});

Deno.test("theme e fonts: enums estritos; ausencia ok", () => {
  const base = { version: LAYOUT_VERSION, blocks: [] };
  assert(validateLayout(base).ok);
  assert(validateLayout({ ...base, theme: "clean" }).ok);
  assert(validateLayout({ ...base, theme: "editorial", fonts: "fraunces" }).ok);
  assert(validateLayout({ ...base, fonts: "system" }).ok);
  assert(!validateLayout({ ...base, theme: "dark" }).ok);
  assert(!validateLayout({ ...base, theme: 1 }).ok);
  assert(!validateLayout({ ...base, fonts: "comic-sans" }).ok);
  assert(!validateLayout({ ...base, fonts: "" }).ok);
});

Deno.test("validateLayout: cover deve ser size full", () => {
  const cover = (over: Record<string, unknown> = {}) => block({ type: "cover", ...over });
  assert(validateLayout(layout([cover()])).ok);
  assert(!validateLayout(layout([cover({ size: "third" })])).ok);
  assert(!validateLayout(layout([cover({ size: "half" })])).ok);
});

Deno.test("validateLayout: cover.config.color precisa ser hex #rrggbb", () => {
  const cover = (config: Record<string, unknown>) => block({ type: "cover", config });
  assert(validateLayout(layout([cover({ color: "#0f766e" })])).ok);
  assert(!validateLayout(layout([cover({ color: "vermelho" })])).ok);
  assert(!validateLayout(layout([cover({ color: "#fff" })])).ok);
});

Deno.test("validateLayout: cover.config.logoSize entre 20 e 68", () => {
  const cover = (config: Record<string, unknown>) => block({ type: "cover", config });
  assert(validateLayout(layout([cover({ logoSize: 20 })])).ok);
  assert(validateLayout(layout([cover({ logoSize: 68 })])).ok);
  assert(!validateLayout(layout([cover({ logoSize: 19 })])).ok);
  assert(!validateLayout(layout([cover({ logoSize: 69 })])).ok);
  assert(!validateLayout(layout([cover({ logoSize: 40.5 })])).ok);
});

Deno.test("normalizeCoverSize: corrige um cover com size != full para full", () => {
  const l = layout([block({ type: "cover", size: "third" })]) as ReportLayout;
  const next = normalizeCoverSize(l);
  assertEquals(next.blocks[0].size, "full");
});

Deno.test("normalizeCoverSize: cover já full ou sem cover -- mesma referência (no-op)", () => {
  const withFullCover = layout([block({ type: "cover", size: "full" })]) as ReportLayout;
  assertEquals(normalizeCoverSize(withFullCover), withFullCover);
  const withoutCover = layout([block({ type: "kpi_reach", size: "third" })]) as ReportLayout;
  assertEquals(normalizeCoverSize(withoutCover), withoutCover);
});

const img = (config?: Record<string, unknown>) =>
  block({ id: "i1", type: "image", size: "full", ...(config ? { config } : {}) });

Deno.test("validateLayout: bloco image vazio e preenchido válidos", () => {
  assert(validateLayout(layout([img()])).ok);
  assert(validateLayout(layout([img({
    file_id: 42, width: 1600, height: 900, ratio: "16:9", fit: "cover",
    focal: { x: 0.5, y: 0 }, caption: "Legenda", alt: "Descrição",
  })])).ok);
});

Deno.test("validateLayout: image rejeita src, r2_key e enums inválidos", () => {
  assert(!validateLayout(layout([img({ src: "https://x" })])).ok);
  assert(!validateLayout(layout([img({ r2_key: "contas/x/files/a.png" })])).ok);
  assert(!validateLayout(layout([img({ ratio: "5:4" })])).ok);
  assert(!validateLayout(layout([img({ fit: "stretch" })])).ok);
  assert(!validateLayout(layout([img({ focal: { x: 0.3, y: 0 } })])).ok);
  assert(!validateLayout(layout([img({ focal: "center" })])).ok);
});

Deno.test("validateLayout: image exige file_id inteiro positivo com width/height", () => {
  assert(!validateLayout(layout([img({ file_id: 0, width: 1, height: 1 })])).ok);
  assert(!validateLayout(layout([img({ file_id: 1.5, width: 1, height: 1 })])).ok);
  assert(!validateLayout(layout([img({ file_id: 3 })])).ok);
  assert(!validateLayout(layout([img({ file_id: 3, width: 0, height: 10 })])).ok);
  assert(!validateLayout(layout([img({ file_id: 3, width: 1_000_000, height: 10 })])).ok);
});

Deno.test("validateLayout: image limita caption e alt", () => {
  assert(validateLayout(layout([img({ caption: "a".repeat(200), alt: "b".repeat(300) })])).ok);
  assert(!validateLayout(layout([img({ caption: "a".repeat(201) })])).ok);
  assert(!validateLayout(layout([img({ alt: "b".repeat(301) })])).ok);
  assert(!validateLayout(layout([img({ caption: 5 })])).ok);
});

Deno.test("sanitizeLayoutForTemplate: tira texto de IA e o conteúdo da imagem", () => {
  const input: ReportLayout = {
    version: LAYOUT_VERSION,
    blocks: [
      { id: "a", type: "ai_summary", size: "full", text: { type: "doc" } },
      { id: "t", type: "text", size: "full", text: { type: "doc" } },
      {
        id: "i", type: "image", size: "half",
        config: { file_id: 9, width: 10, height: 20, ratio: "4:5", fit: "contain",
          focal: { x: 0, y: 1 }, caption: "c", alt: "a" },
      },
    ],
  };
  const out = sanitizeLayoutForTemplate(input);
  assertEquals(out.blocks[0], { id: "a", type: "ai_summary", size: "full" });
  assertEquals(out.blocks[1], input.blocks[1]);
  assertEquals(out.blocks[2], {
    id: "i", type: "image", size: "half",
    config: { ratio: "4:5", fit: "contain", focal: { x: 0, y: 1 } },
  });
  assert(validateLayout(out).ok);
});

const TIKTOK_TYPES = [
  "tiktok_kpi_followers_total", "tiktok_kpi_followers_gained", "tiktok_kpi_views",
  "tiktok_kpi_engagement_rate", "tiktok_kpi_likes", "tiktok_kpi_comments",
  "tiktok_kpi_shares", "tiktok_kpi_posts_count", "tiktok_kpi_likes_total",
  "tiktok_chart_followers", "tiktok_chart_best_times", "tiktok_top_posts",
  "tiktok_post_list",
];

Deno.test("validateLayout aceita todos os tipos tiktok_*", () => {
  for (const type of TIKTOK_TYPES) {
    assert(validateLayout(layout([block({ type })])).ok, type);
  }
  assertEquals(
    TIKTOK_TYPES.every((t) => (BLOCK_TYPES as readonly string[]).includes(t)),
    true,
  );
});

Deno.test("tiktok_top_posts/tiktok_post_list: count fora de 1..12 é rejeitado", () => {
  for (const type of ["tiktok_top_posts", "tiktok_post_list"]) {
    assert(validateLayout(layout([block({ type, config: { count: 6 } })])).ok);
    assert(!validateLayout(layout([block({ type, config: { count: 0 } })])).ok);
    assert(!validateLayout(layout([block({ type, config: { count: 13 } })])).ok);
  }
});

Deno.test("blockPlatform: prefixo tiktok_ = tiktok, métricas = instagram, neutros = null", () => {
  assertEquals(blockPlatform("tiktok_kpi_views"), "tiktok");
  assertEquals(blockPlatform("tiktok_top_posts"), "tiktok");
  assertEquals(blockPlatform("kpi_views"), "instagram");
  assertEquals(blockPlatform("top_posts"), "instagram");
  assertEquals(blockPlatform("audience_gender"), "instagram");
  for (const t of ["cover", "section_header", "divider", "text", "ai_summary",
    "ai_recommendations", "ai_goals", "image"]) {
    assertEquals(blockPlatform(t), null, t);
  }
});

// Pin da partição: todo tipo de BLOCK_TYPES cai em exatamente uma plataforma, e o conjunto
// Instagram está escrito por nome. Um tipo novo sem prefixo tiktok_ e fora dos neutros vira
// Instagram em silêncio; este teste força a decisão explícita.
Deno.test("blockPlatform: partição de BLOCK_TYPES fixada por nome", () => {
  const INSTAGRAM = [
    "kpi_followers_gained", "kpi_followers_total", "kpi_reach", "kpi_views",
    "kpi_engagement_rate", "kpi_saves", "kpi_posts_count", "kpi_profile_views",
    "kpi_website_clicks", "kpi_follows",
    "chart_followers", "chart_formats", "chart_best_times",
    "audience_gender", "audience_age", "audience_cities", "audience_countries",
    "top_posts", "post_list", "tags_table",
  ];
  const NEUTRAL = [
    "cover", "section_header", "divider", "text", "ai_summary", "ai_recommendations",
    "ai_goals", "image",
  ];
  const by = { instagram: [] as string[], tiktok: [] as string[], neutral: [] as string[] };
  for (const t of BLOCK_TYPES) {
    const p = blockPlatform(t);
    (p === null ? by.neutral : by[p]).push(t);
  }
  assertEquals([...by.instagram].sort(), [...INSTAGRAM].sort());
  assertEquals([...by.neutral].sort(), [...NEUTRAL].sort());
  assertEquals([...by.tiktok].sort(), [...TIKTOK_TYPES].sort());
  assertEquals(by.instagram.length + by.tiktok.length + by.neutral.length, BLOCK_TYPES.length);
});

Deno.test("BLOCK_TYPES: tiktok_kpi_* espelha TIKTOK_KPI_IDS nos dois sentidos", () => {
  const fromTypes = BLOCK_TYPES.filter((t) => t.startsWith("tiktok_kpi_")).sort();
  const fromIds = TIKTOK_KPI_IDS.map((id) => "tiktok_kpi_" + id).sort();
  assertEquals(fromTypes, fromIds);
});

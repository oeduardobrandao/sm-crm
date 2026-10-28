import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  addMissingPlatformSections, dropUnselectedPlatformBlocks, narrativePlatforms,
} from "./platform-filter.ts";
import { buildDefaultLayout } from "./default-layout.ts";
import { blockPlatform, MAX_BLOCKS, sanitizeLayoutForTemplate, validateLayout, type ReportLayout } from "./layout.ts";

const layout: ReportLayout = {
  version: 1,
  theme: "editorial",
  blocks: [
    { id: "c", type: "cover", size: "full" },
    { id: "s", type: "ai_summary", size: "full", text: { type: "doc", content: [] } },
    { id: "h1", type: "section_header", size: "full", config: { title: "Instagram" } },
    { id: "k1", type: "kpi_reach", size: "third" },
    { id: "h2", type: "section_header", size: "full", config: { title: "TikTok" } },
    { id: "t1", type: "tiktok_kpi_views", size: "third" },
    { id: "t2", type: "tiktok_top_posts", size: "full", config: { count: 4 } },
    { id: "h3", type: "section_header", size: "full", config: { title: "Extras" } },
    { id: "d", type: "divider", size: "full" },
    { id: "i", type: "image", size: "half", config: { ratio: "4:5" } },
    { id: "x", type: "text", size: "full", text: { type: "doc", content: [] } },
    { id: "p", type: "top_posts", size: "full", config: { count: 6 } },
    { id: "h4", type: "section_header", size: "full", config: { title: "Notas da equipe" } },
  ],
} as ReportLayout;

const ids = (l: ReportLayout) => l.blocks.map((b) => b.id);

Deno.test("dropUnselectedPlatformBlocks keeps neutral blocks and drops headers left empty by the filter", () => {
  // h1 só tinha Instagram: some com ele. h3 perdeu `p` mas segue com divisor/imagem/texto.
  // h4 já era vazio no modelo (o filtro não tirou nada dele): fica.
  assertEquals(ids(dropUnselectedPlatformBlocks(layout, ["tiktok"])), ["c", "s", "h2", "t1", "t2", "h3", "d", "i", "x", "h4"]);
  assertEquals(ids(dropUnselectedPlatformBlocks(layout, ["instagram"])), ["c", "s", "h1", "k1", "h3", "d", "i", "x", "p", "h4"]);
});

Deno.test("dropUnselectedPlatformBlocks: a dropped header takes the dividers left under it", () => {
  const l = {
    version: 1,
    blocks: [
      { id: "h", type: "section_header", size: "full", config: { title: "Instagram" } },
      { id: "k", type: "kpi_reach", size: "third" },
      { id: "d", type: "divider", size: "full" },
      { id: "h2", type: "section_header", size: "full", config: { title: "TikTok" } },
      { id: "t", type: "tiktok_kpi_views", size: "third" },
    ],
  } as ReportLayout;
  assertEquals(ids(dropUnselectedPlatformBlocks(l, ["tiktok"])), ["h2", "t"]);
  // Divisor sob um título que fica (ou que o filtro não tirou) não é tocado.
  assertEquals(ids(dropUnselectedPlatformBlocks(l, ["instagram"])), ["h", "k", "d"]);
});

Deno.test("dropUnselectedPlatformBlocks with every platform returns the same blocks", () => {
  assertEquals(dropUnselectedPlatformBlocks(layout, ["instagram", "tiktok"]), layout);
});

Deno.test("dropUnselectedPlatformBlocks keeps the layout fields and leaves blocks untouched", () => {
  const out = dropUnselectedPlatformBlocks(layout, ["tiktok"]);
  assertEquals(out.version, 1);
  assertEquals((out as { theme?: string }).theme, "editorial");
  // Config/text dos blocos que ficam passam como vieram (nada de reescrever o template).
  assertEquals(out.blocks.find((b) => b.id === "t2"), layout.blocks.find((b) => b.id === "t2"));
  // Não muta a entrada.
  assertEquals(layout.blocks.length, 13);
});

// Modelo como o CRM semeia (buildSystemDefaultLayout): só Instagram, com "Próximos passos".
const seeded = () =>
  sanitizeLayoutForTemplate(buildDefaultLayout({ hasAi: true, hasAudience: true, hasBestTimes: true, hasTags: true }));
const SECTION_OPTS = { hasAudience: true, hasBestTimes: true, hasTags: true, hasTikTokBestTimes: true };
const TT_TYPES = [
  "section_header", "tiktok_kpi_followers_gained", "tiktok_kpi_followers_total", "tiktok_kpi_engagement_rate",
  "tiktok_kpi_views", "tiktok_kpi_likes", "tiktok_kpi_posts_count", "tiktok_chart_followers", "tiktok_top_posts",
  "tiktok_chart_best_times",
];
const titleIdx = (l: ReportLayout, title: string) =>
  l.blocks.findIndex((b) => b.type === "section_header" && b.config?.title === title);

Deno.test("seeded Instagram template + TikTok-only: TikTok section, no orphan Instagram headers", () => {
  const filtered = dropUnselectedPlatformBlocks(seeded(), ["tiktok"]);
  const out = addMissingPlatformSections(filtered, ["tiktok"], { instagram: false, tiktok: true }, SECTION_OPTS);
  assert(validateLayout(out).ok);
  const headers = out.blocks.filter((b) => b.type === "section_header").map((b) => b.config?.title);
  assertEquals(headers, ["TikTok", "Próximos passos"]);
  const next = titleIdx(out, "Próximos passos");
  assertEquals(out.blocks.slice(next - TT_TYPES.length, next).map((b) => b.type), TT_TYPES);
  assert(!out.blocks.some((b) => blockPlatform(b.type) === "instagram"));
  assertEquals(out.blocks.slice(0, 2).map((b) => b.type), ["cover", "ai_summary"]);
});

Deno.test("seeded Instagram template + both: Instagram blocks kept, TikTok appended before Próximos passos", () => {
  const tpl = seeded();
  const filtered = dropUnselectedPlatformBlocks(tpl, ["instagram", "tiktok"]);
  const out = addMissingPlatformSections(filtered, ["instagram", "tiktok"], { instagram: true, tiktok: true }, SECTION_OPTS);
  const next = titleIdx(out, "Próximos passos");
  assertEquals(out.blocks.slice(0, next - TT_TYPES.length), tpl.blocks.slice(0, titleIdx(tpl, "Próximos passos")));
  assertEquals(out.blocks.slice(next - TT_TYPES.length, next).map((b) => b.type), TT_TYPES);
  assertEquals(out.blocks.slice(next), tpl.blocks.slice(titleIdx(tpl, "Próximos passos")));
});

Deno.test("addMissingPlatformSections: never touches a platform the template already covers", () => {
  const tpl = { version: 1, blocks: [{ id: "t", type: "tiktok_kpi_views", size: "third" }] } as ReportLayout;
  const out = addMissingPlatformSections(tpl, ["tiktok"], { instagram: false, tiktok: true }, SECTION_OPTS);
  assertEquals(out, tpl);
});

Deno.test("addMissingPlatformSections: no data for the platform, nothing appended; no Próximos passos, appended at the end", () => {
  const tpl = { version: 1, blocks: [{ id: "c", type: "cover", size: "full" }] } as ReportLayout;
  assertEquals(addMissingPlatformSections(tpl, ["tiktok"], { instagram: true, tiktok: false }, SECTION_OPTS), tpl);
  const out = addMissingPlatformSections(tpl, ["tiktok"], { instagram: true, tiktok: true }, SECTION_OPTS);
  assertEquals(out.blocks.map((b) => b.type), ["cover", ...TT_TYPES]);
  assertEquals(new Set(out.blocks.map((b) => b.id)).size, out.blocks.length);
});

Deno.test("addMissingPlatformSections: never pushes a template past MAX_BLOCKS", () => {
  const tpl = {
    version: 1,
    blocks: Array.from({ length: MAX_BLOCKS - 3 }, (_, i) => ({ id: `k${i}`, type: "kpi_reach", size: "third" })),
  } as ReportLayout;
  assertEquals(addMissingPlatformSections(tpl, ["instagram", "tiktok"], { instagram: true, tiktok: true }, SECTION_OPTS), tpl);
});

const neutralTemplate = (n: number) =>
  ({
    version: 1,
    blocks: Array.from({ length: n }, (_, i) => ({ id: `x${i}`, type: "text", size: "full" })),
  }) as ReportLayout;
const IG_SECTION_LEN = 22;
const TT_SECTION_LEN = 10;

Deno.test("addMissingPlatformSections: the cap is decided per section, Instagram first", () => {
  const skipped: string[] = [];
  const onCapSkip = (p: string) => skipped.push(p);
  // Cabe o Instagram (22), não cabe mais o TikTok (10).
  const a = addMissingPlatformSections(
    neutralTemplate(MAX_BLOCKS - IG_SECTION_LEN - 3), ["instagram", "tiktok"], { instagram: true, tiktok: true },
    SECTION_OPTS, { onCapSkip },
  );
  assertEquals(a.blocks.length, MAX_BLOCKS - 3);
  assert(a.blocks.some((b) => blockPlatform(b.type) === "instagram"));
  assert(!a.blocks.some((b) => blockPlatform(b.type) === "tiktok"));
  assertEquals(skipped, ["tiktok"]);
  // Não cabe o Instagram, mas o TikTok cabe: entra só o TikTok.
  skipped.length = 0;
  const b = addMissingPlatformSections(
    neutralTemplate(MAX_BLOCKS - TT_SECTION_LEN - 5), ["instagram", "tiktok"], { instagram: true, tiktok: true },
    SECTION_OPTS, { onCapSkip },
  );
  assertEquals(b.blocks.length, MAX_BLOCKS - 5);
  assert(!b.blocks.some((x) => blockPlatform(x.type) === "instagram"));
  assert(b.blocks.some((x) => blockPlatform(x.type) === "tiktok"));
  assertEquals(skipped, ["instagram"]);
  assert(validateLayout(b).ok);
});

Deno.test("narrativePlatforms: the final layout's platforms within the selection", () => {
  const igOnly = { version: 1, blocks: [{ id: "k", type: "kpi_reach", size: "third" }] } as ReportLayout;
  // Selecionou as duas, mas o layout final só tem Instagram: a narrativa fala só do Instagram.
  assertEquals(narrativePlatforms(igOnly, ["instagram", "tiktok"]), ["instagram"]);
  assertEquals(narrativePlatforms(layout, ["tiktok"]), ["tiktok"]);
  // Sem nenhum bloco de plataforma: cai na seleção.
  const neutral = { version: 1, blocks: [{ id: "c", type: "cover", size: "full" }] } as ReportLayout;
  assertEquals(narrativePlatforms(neutral, ["instagram", "tiktok"]), ["instagram", "tiktok"]);
});

import { assert, assertEquals, assertStrictEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  type LayoutPlatform, narrativePlatforms, selectPlatformSections, showAllPlatformHeadings,
} from "./platform-filter.ts";
import { buildDefaultLayout, NEXT_STEPS_TITLE, platformSectionBlocks } from "./default-layout.ts";
import {
  blockPlatform, type BlockType, LAYOUT_VERSION, MAX_BLOCKS, MAX_SECTIONS, type ReportBlock, type ReportLayout,
  sanitizeLayoutForTemplate, validateLayout,
} from "./layout.ts";
import { contentBlockCount, sectionizeLayout, toSections } from "./sections.ts";

type Fixture = { name: string; valid: boolean; layout: ReportLayout };
const FIXTURES: Fixture[] = JSON.parse(
  await Deno.readTextFile(new URL("../../../tests/fixtures/report_section_layouts.json", import.meta.url)),
);
const fixture = (name: string): ReportLayout => {
  const f = FIXTURES.find((x) => x.name === name);
  if (!f) throw new Error(`fixture not found: ${name}`);
  return structuredClone(f.layout);
};
// O modelo padrão que os workspaces têm salvo hoje (legado, só Instagram, com "Próximos passos").
const LEGACY_SEEDED = () => fixture("legacy: default Instagram layout");

const counter = (prefix = "n") => {
  let n = 0;
  return () => `${prefix}${++n}`;
};
const B = (id: string, type: BlockType, size: ReportBlock["size"] = "third", config?: Record<string, unknown>): ReportBlock =>
  config ? { id, type, size, config } : { id, type, size };
const H = (id: string, title = id) => B(id, "section_header", "full", { title });
const S = (id: string, config?: Record<string, unknown>): ReportBlock =>
  config ? { id, type: "section", size: "full", config } : { id, type: "section", size: "full" };
const L = (blocks: ReportBlock[]): ReportLayout => ({ version: LAYOUT_VERSION, blocks });

const SECTION_OPTS = { hasAudience: true, hasBestTimes: true, hasTags: true, hasTikTokBestTimes: true };
const ALL_DATA = () => true;
const shape = (blocks: ReportBlock[]) =>
  blocks.map((b) => (b.config ? { type: b.type, size: b.size, config: b.config } : { type: b.type, size: b.size }));
const kinds = (l: ReportLayout) => toSections(l).map((s) => s.kind);
const ids = (l: ReportLayout) => l.blocks.map((b) => b.id);

function select(
  layout: ReportLayout,
  selected: LayoutPlatform[],
  extra: { hasData?: (p: LayoutPlatform) => boolean; onCapSkip?: (p: LayoutPlatform) => void } = {},
): ReportLayout {
  const out = selectPlatformSections(layout, selected, {
    hasData: extra.hasData ?? ALL_DATA,
    sectionOpts: SECTION_OPTS,
    makeId: counter(),
    onCapSkip: extra.onCapSkip,
  });
  // Toda saída é canônica: valida e já está na forma que sectionizeLayout devolveria.
  const v = validateLayout(out);
  assert(v.ok, v.ok ? "" : v.error);
  assertStrictEquals(sectionizeLayout(out), out);
  return out;
}

// ─── selectPlatformSections ──────────────────────────────────────────────────────────

Deno.test("legacy Instagram template + TikTok only: Instagram section dropped, TikTok default where it was", () => {
  const tpl = LEGACY_SEEDED();
  const out = select(tpl, ["tiktok"]);
  assertEquals(kinds(out), ["general", "tiktok", "general"]);
  const [opening, tiktok, nextSteps] = toSections(out);
  assertEquals(opening.blocks.map((b) => b.id), ["cover", "ai_summary"]);
  // A seção acrescentada: marcador visível (sem hideHeader), conteúdo = platformSectionBlocks.
  assertEquals(tiktok.marker.config, { platform: "tiktok" });
  assertEquals(shape(tiktok.blocks), shape(platformSectionBlocks("tiktok", SECTION_OPTS)));
  // "Próximos passos" segue como o modelo salvou, com o section_header dele.
  assertEquals(nextSteps.blocks.map((b) => b.id), ["h_proximos", "ai_recommendations", "ai_goals"]);
  assert(!out.blocks.some((b) => blockPlatform(b.type) === "instagram"));
  for (const t of ["Métricas principais", "Crescimento e formatos", "Publicações", "Audiência"]) {
    assert(!out.blocks.some((b) => b.config?.title === t), t);
  }
});

Deno.test("legacy Instagram template + both: Instagram kept as saved, TikTok right after it", () => {
  const tpl = LEGACY_SEEDED();
  const out = select(tpl, ["instagram", "tiktok"]);
  assertEquals(kinds(out), ["general", "instagram", "tiktok", "general"]);
  const [, ig, tt, next] = toSections(out);
  // Conversão de legado: o Instagram fica com hideHeader (o modelo não muda aqui).
  assertEquals(ig.marker.config, { platform: "instagram", hideHeader: true });
  const igIds = tpl.blocks.filter((b) => b.id !== "cover" && b.id !== "ai_summary" &&
    !["h_proximos", "ai_recommendations", "ai_goals"].includes(b.id)).map((b) => b.id);
  assertEquals(ig.blocks.map((b) => b.id), igIds);
  assertEquals(tt.marker.config, { platform: "tiktok" });
  assertEquals(next.blocks[0].config?.title, NEXT_STEPS_TITLE);
  // Todo bloco do modelo segue lá, na ordem.
  const contentIds = out.blocks.filter((b) => b.type !== "section").map((b) => b.id);
  assertEquals(contentIds.filter((id) => tpl.blocks.some((b) => b.id === id)), ids(tpl));
});

Deno.test("template with no platform section + both selected: unchanged except sectionized", () => {
  const neutral = L([B("c", "cover", "full"), B("s", "ai_summary", "full"), B("x", "text", "full"), H("h")]);
  const out = select(neutral, ["instagram", "tiktok"]);
  assertEquals(out, sectionizeLayout(neutral, counter()));
  assertEquals(kinds(out), ["general"]);
  // Já seccionado e sem plataforma: a mesma coisa, nada acrescentado.
  const sectioned = L([S("g"), B("c", "cover", "full"), S("g2", { title: "Notas" }), B("x", "text", "full")]);
  assertEquals(select(sectioned, ["instagram", "tiktok"]), sectioned);
});

Deno.test("a deselected platform's section goes whole: sub-headings, text and dividers with it", () => {
  const tpl = L([
    S("g"), B("c", "cover", "full"),
    S("ig", { platform: "instagram", title: "Insta" }), H("h1"), B("x1", "text", "full"), B("k", "kpi_reach"),
    B("d", "divider", "full"),
    S("tt", { platform: "tiktok" }), H("h2"), B("t", "tiktok_kpi_views"),
    S("g2", { title: "Fim" }), B("x2", "text", "full"),
  ]);
  const out = select(tpl, ["tiktok"]);
  assertEquals(ids(out), ["g", "c", "tt", "h2", "t", "g2", "x2"]);
  // Os blocos que ficam são os mesmos objetos (nada reescrito).
  assertStrictEquals(out.blocks[3], tpl.blocks[8]);
  assertEquals(ids(select(tpl, ["instagram"])), ["g", "c", "ig", "h1", "x1", "k", "d", "g2", "x2"]);
});

Deno.test("a covered platform is never rewritten; layout fields are kept", () => {
  const tpl: ReportLayout = {
    version: 1, accent: "#9f1239", theme: "editorial",
    blocks: [S("g"), S("tt", { platform: "tiktok", title: "Vídeos" }), B("t", "tiktok_top_posts", "full", { count: 3 })],
  } as ReportLayout;
  const out = select(tpl, ["tiktok"]);
  assertEquals(out, tpl);
  assertEquals(out.accent, "#9f1239");
});

Deno.test("a selected platform without data: its section is dropped and none is appended", () => {
  const tpl = L([S("g"), B("c", "cover", "full"), S("ig", { platform: "instagram" }), B("k", "kpi_reach")]);
  const out = select(tpl, ["instagram", "tiktok"], { hasData: (p) => p === "tiktok" });
  assertEquals(kinds(out), ["general", "tiktok"]);
  const none = select(tpl, ["instagram", "tiktok"], { hasData: () => false });
  assertEquals(ids(none), ["g", "c"]);
});

Deno.test("the insertion point is the template's last platform section, even when it was dropped", () => {
  const tpl = L([
    S("g1"), B("c", "cover", "full"),
    S("ig", { platform: "instagram" }), B("k", "kpi_reach"),
    S("g2", { title: "Meio" }), B("x", "text", "full"),
    S("tt", { platform: "tiktok" }), B("t", "tiktok_kpi_views"),
    S("g3", { title: "Fim" }), B("y", "text", "full"),
  ]);
  // TikTok desmarcado: sai; nada a acrescentar.
  assertEquals(ids(select(tpl, ["instagram"])), ["g1", "c", "ig", "k", "g2", "x", "g3", "y"]);
  // Só Instagram no modelo, TikTok escolhido: entra logo depois do Instagram, antes de "Meio".
  const igOnly = L([S("g1"), B("c", "cover", "full"), S("ig", { platform: "instagram" }), B("k", "kpi_reach"),
    S("g2", { title: "Meio" }), B("x", "text", "full")]);
  const out = select(igOnly, ["instagram", "tiktok"]);
  assertEquals(kinds(out), ["general", "instagram", "tiktok", "general"]);
  // Instagram desmarcado e TikTok faltando: o TikTok ocupa a vaga do Instagram.
  const swapped = select(igOnly, ["tiktok"]);
  assertEquals(kinds(swapped), ["general", "tiktok", "general"]);
  assertEquals(toSections(swapped)[2].marker.id, "g2");
});

Deno.test("a missing section goes right after the last platform section; marker id from makeId", () => {
  const tpl = L([S("g"), S("tt", { platform: "tiktok" }), B("t", "tiktok_kpi_views")]);
  // TikTok desmarcado sai; o Instagram entra na vaga dele.
  const out = select(tpl, ["instagram"]);
  assertEquals(kinds(out), ["general", "instagram"]);
  assertEquals(out.blocks[1], { id: "n1", type: "section", size: "full", config: { platform: "instagram" } });
  // TikTok coberto (uma seção vazia também conta): o Instagram entra depois dele.
  const both = select(L([S("g"), S("tt", { platform: "tiktok" }), S("g2", { title: "Fim" })]), ["instagram", "tiktok"]);
  assertEquals(kinds(both), ["general", "tiktok", "instagram", "general"]);
});

Deno.test("empty legacy template stays empty", () => {
  assertEquals(select(L([]), ["instagram", "tiktok"]).blocks, []);
});

const IG_SECTION_LEN = platformSectionBlocks("instagram", SECTION_OPTS).length;
// Modelo com `contentCount` blocos de conteúdo e só a seção TikTok: falta o Instagram.
const tiktokTemplateWith = (contentCount: number) =>
  L([
    S("g"), ...Array.from({ length: contentCount - 1 }, (_, i) => B(`x${i}`, "text", "full")),
    S("tt", { platform: "tiktok" }), B("t", "tiktok_kpi_views"),
  ]);

Deno.test("cap: a section that would pass MAX_BLOCKS is skipped with onCapSkip", () => {
  const skipped: LayoutPlatform[] = [];
  // Não cabe por um bloco.
  const tpl = tiktokTemplateWith(MAX_BLOCKS - IG_SECTION_LEN + 1);
  const out = select(tpl, ["instagram", "tiktok"], { onCapSkip: (p) => skipped.push(p) });
  assertEquals(skipped, ["instagram"]);
  assertEquals(out, tpl);
  // Cabe exatamente: entra, sem aviso. Os marcadores não contam no teto.
  skipped.length = 0;
  const out2 = select(tiktokTemplateWith(MAX_BLOCKS - IG_SECTION_LEN), ["instagram", "tiktok"], {
    onCapSkip: (p) => skipped.push(p),
  });
  assertEquals(skipped, []);
  assertEquals(contentBlockCount(out2), MAX_BLOCKS);
  assertEquals(kinds(out2), ["general", "tiktok", "instagram"]);
});

Deno.test("cap: the room of a dropped section counts", () => {
  const skipped: LayoutPlatform[] = [];
  const ttLen = platformSectionBlocks("tiktok", SECTION_OPTS).length;
  // Cheio (200) com o Instagram ocupando exatamente o tamanho da seção TikTok: desmarcado o
  // Instagram, o TikTok cabe no espaço que ele deixou.
  const tpl = L([
    S("g"), ...Array.from({ length: MAX_BLOCKS - ttLen }, (_, i) => B(`x${i}`, "text", "full")),
    S("ig", { platform: "instagram" }), ...Array.from({ length: ttLen }, (_, i) => B(`k${i}`, "kpi_reach")),
  ]);
  assertEquals(contentBlockCount(tpl), MAX_BLOCKS);
  const out = select(tpl, ["tiktok"], { onCapSkip: (p) => skipped.push(p) });
  assertEquals(skipped, []);
  assertEquals(kinds(out), ["general", "tiktok"]);
  assertEquals(contentBlockCount(out), MAX_BLOCKS);
});

Deno.test("cap: never past MAX_SECTIONS", () => {
  const skipped: LayoutPlatform[] = [];
  const gerais = Array.from({ length: MAX_SECTIONS - 1 }, (_, i) => S(`g${i}`, { title: `G${i}` }));
  const tpl = L([...gerais, S("ig", { platform: "instagram" }), B("k", "kpi_reach")]);
  const out = select(tpl, ["instagram", "tiktok"], { onCapSkip: (p) => skipped.push(p) });
  assertEquals(skipped, ["tiktok"]);
  assertEquals(out, tpl);
  // Com o Instagram desmarcado sobra vaga: o TikTok entra no lugar dele.
  skipped.length = 0;
  const swapped = select(tpl, ["tiktok"], { onCapSkip: (p) => skipped.push(p) });
  assertEquals(skipped, []);
  assertEquals(toSections(swapped).length, MAX_SECTIONS);
});

Deno.test("legacy mixed template keeps every block of the selected platforms and validates", () => {
  const tpl = L([
    B("c", "cover", "full"), B("s", "ai_summary", "full"),
    H("h1", "Instagram"), B("k1", "kpi_reach"),
    H("h2", "TikTok"), B("t1", "tiktok_kpi_views"), B("t2", "tiktok_top_posts", "full", { count: 4 }),
    H("h3", "Extras"), B("d", "divider", "full"), B("x", "text", "full"),
  ]);
  const out = select(tpl, ["instagram", "tiktok"]);
  const kept = out.blocks.filter((b) => b.type !== "section").map((b) => b.id);
  assertEquals(kept, ids(tpl));
});

// ─── showAllPlatformHeadings ─────────────────────────────────────────────────────────

Deno.test("showAllPlatformHeadings: converted legacy template + appended TikTok shows both headings", () => {
  const out = showAllPlatformHeadings(select(LEGACY_SEEDED(), ["instagram", "tiktok"]));
  const markers = toSections(out).filter((s) => s.kind !== "general").map((s) => s.marker.config);
  assertEquals(markers, [{ platform: "instagram" }, { platform: "tiktok" }]);
  assert(validateLayout(out).ok);
});

Deno.test("showAllPlatformHeadings: clears hideHeader on every platform section, keeps titles and ids", () => {
  const l = L([S("g"), S("ig", { platform: "instagram", title: "Insta", hideHeader: true }), B("k", "kpi_reach"),
    S("tt", { platform: "tiktok", hideHeader: true })]);
  const out = showAllPlatformHeadings(l);
  assertEquals(out.blocks[1], S("ig", { platform: "instagram", title: "Insta" }));
  assertEquals(out.blocks[3], S("tt", { platform: "tiktok" }));
  assertStrictEquals(out.blocks[2], l.blocks[2]);
  assertEquals(l.blocks[1].config?.hideHeader, true); // não muta a entrada
});

Deno.test("showAllPlatformHeadings: one platform section, or nothing hidden, returns the same reference", () => {
  const one = L([S("g"), S("ig", { platform: "instagram", hideHeader: true }), B("k", "kpi_reach")]);
  assertStrictEquals(showAllPlatformHeadings(one), one);
  const shown = L([S("ig", { platform: "instagram" }), S("tt", { platform: "tiktok" })]);
  assertStrictEquals(showAllPlatformHeadings(shown), shown);
});

// ─── narrativePlatforms ──────────────────────────────────────────────────────────────

Deno.test("narrativePlatforms: the final layout's platform sections within the selection", () => {
  const igOnly = L([B("k", "kpi_reach")]);
  // Selecionou as duas, mas o layout final só tem Instagram: a narrativa fala só do Instagram.
  assertEquals(narrativePlatforms(igOnly, ["instagram", "tiktok"]), ["instagram"]);
  const both = buildDefaultLayout({ hasAi: true, hasAudience: true, hasBestTimes: true, hasTags: true, platforms: ["instagram", "tiktok"] });
  assertEquals(narrativePlatforms(both, ["tiktok"]), ["tiktok"]);
  assertEquals(narrativePlatforms(both, ["instagram", "tiktok"]), ["instagram", "tiktok"]);
  // Sem nenhuma seção de plataforma: cai na seleção.
  const neutral = L([S("g"), B("c", "cover", "full")]);
  assertEquals(narrativePlatforms(neutral, ["instagram", "tiktok"]), ["instagram", "tiktok"]);
});

Deno.test("sanitized seeded system template (sectioned) + TikTok only: TikTok takes the Instagram slot", () => {
  const tpl = sanitizeLayoutForTemplate(
    buildDefaultLayout({ hasAi: true, hasAudience: true, hasBestTimes: true, hasTags: true }),
  );
  const out = select(tpl, ["tiktok"]);
  assertEquals(kinds(out), ["general", "tiktok", "general"]);
  assertEquals(toSections(out)[2].marker.config, { title: NEXT_STEPS_TITLE });
});

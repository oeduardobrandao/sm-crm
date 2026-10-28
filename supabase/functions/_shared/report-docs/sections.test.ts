import {
  assert,
  assertEquals,
  assertStrictEquals,
  assertThrows,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  BLOCK_SIZES,
  BLOCK_TYPES,
  type BlockType,
  LAYOUT_VERSION,
  MAX_SECTIONS,
  type ReportBlock,
  type ReportLayout,
  TEXT_BLOCK_TYPES,
  validateLayout,
} from "./layout.ts";
import {
  contentBlockCount,
  fromSections,
  isSectioned,
  isSectionMarker,
  makeSectionMarker,
  sectionizeLayout,
  sectionKindOf,
  sectionOfBlock,
  sectionPlatforms,
  toSections,
} from "./sections.ts";

interface SectionFixture {
  name: string;
  valid: boolean;
  layout: ReportLayout;
}
const FIXTURES: SectionFixture[] = JSON.parse(
  await Deno.readTextFile(
    new URL("../../../tests/fixtures/report_section_layouts.json", import.meta.url),
  ),
);
const fixture = (name: string): ReportLayout => {
  const f = FIXTURES.find((x) => x.name === name);
  if (!f) throw new Error(`fixture not found: ${name}`);
  return f.layout;
};
// Cópia literal do buildDefaultLayout de antes das seções (todas as flags ligadas, só
// Instagram): o default muda na Task 3, este fixture não.
const LEGACY_DEFAULT = fixture("legacy: default Instagram layout");
const CANONICAL_DEFAULT = fixture("canonical: default (Geral, Instagram, TikTok, Geral)");

const counter = (prefix = "syn") => {
  let n = 0;
  return () => `${prefix}${++n}`;
};
const B = (id: string, type: BlockType, size: ReportBlock["size"] = "third", config?: Record<string, unknown>): ReportBlock =>
  config ? { id, type, size, config } : { id, type, size };
const H = (id: string, title = id) => B(id, "section_header", "full", { title });
const T = (id: string) => B(id, "text", "full");
const S = (id: string, config?: Record<string, unknown>): ReportBlock =>
  config ? { id, type: "section", size: "full", config } : { id, type: "section", size: "full" };
const L = (blocks: ReportBlock[]): ReportLayout => ({ version: LAYOUT_VERSION, blocks });

const kinds = (layout: ReportLayout) => toSections(layout, counter()).map((s) => s.kind);
const ids = (bs: ReportBlock[]) => bs.map((b) => b.id);
const contentIds = (layout: ReportLayout) =>
  ids(layout.blocks.filter((b) => !isSectionMarker(b)));

// ---------- legado ----------

Deno.test("toSections: layout padrão legado vira Geral, Instagram, Geral sem perder bloco", () => {
  const sections = toSections(LEGACY_DEFAULT, counter());
  assertEquals(sections.map((s) => s.kind), ["general", "instagram", "general"]);
  assert(sections.every((s) => s.synthesized));
  assertEquals(sections[1].marker.config, { platform: "instagram", hideHeader: true });
  // Geral inferida: sem título e sem config.
  assertEquals("config" in sections[0].marker, false);
  assertEquals("config" in sections[2].marker, false);
  assertEquals(ids(sections[0].blocks), ["cover", "ai_summary"]);
  assertEquals(sections[1].blocks[0].id, "h_metricas");
  assertEquals(ids(sections[2].blocks), ["h_proximos", "ai_recommendations", "ai_goals"]);
  assertEquals(sections.flatMap((s) => ids(s.blocks)), ids(LEGACY_DEFAULT.blocks));
  assertEquals(sections.map((s) => s.marker.id), ["syn1", "syn2", "syn3"]);
});

Deno.test("toSections: trecho neutro entre dois trechos Instagram entra na seção Instagram", () => {
  const layout = L([H("h1"), B("r", "kpi_reach"), H("h2"), T("t"), H("h3"), B("s", "kpi_saves")]);
  const sections = toSections(layout, counter());
  assertEquals(sections.map((s) => s.kind), ["instagram"]);
  assertEquals(ids(sections[0].blocks), ["h1", "r", "h2", "t", "h3", "s"]);
});

Deno.test("toSections: trecho neutro entre Instagram e TikTok vira Geral", () => {
  const layout = L([H("h1"), B("r", "kpi_reach"), H("h2"), T("t"), H("h3"), B("v", "tiktok_kpi_views")]);
  const sections = toSections(layout, counter());
  assertEquals(sections.map((s) => s.kind), ["instagram", "general", "tiktok"]);
  assertEquals(sections.map((s) => ids(s.blocks)), [["h1", "r"], ["h2", "t"], ["h3", "v"]]);
  assertEquals(sections[2].marker.config, { platform: "tiktok", hideHeader: true });
});

Deno.test("toSections: trecho misto quebra onde a plataforma muda", () => {
  const layout = L([
    H("h"), B("r", "kpi_reach"), T("t"), B("v", "tiktok_kpi_views"), B("l", "tiktok_kpi_likes"),
  ]);
  const sections = toSections(layout, counter());
  assertEquals(sections.map((s) => s.kind), ["instagram", "tiktok"]);
  assertEquals(sections.map((s) => ids(s.blocks)), [["h", "r", "t"], ["v", "l"]]);
});

Deno.test("toSections: cover e text em lugares estranhos ficam na ordem e validam", () => {
  const layout = L([
    B("r1", "kpi_reach"), B("c1", "cover", "full"), T("t1"), B("r2", "kpi_saves"),
    H("h"), B("c2", "cover", "full"), T("t2"), H("h2"), B("r3", "kpi_views"),
  ]);
  const sections = toSections(layout, counter());
  assertEquals(sections.map((s) => s.kind), ["instagram"]);
  assertEquals(sections.flatMap((s) => ids(s.blocks)), ids(layout.blocks));
  assert(validateLayout(sectionizeLayout(layout, counter())).ok);
});

Deno.test("toSections: Instagram, TikTok, Instagram funde a segunda Instagram na primeira", () => {
  const layout = L([
    T("t0"), H("h1"), B("r", "kpi_reach"), H("h2"), B("v", "tiktok_kpi_views"), H("h3"),
    B("s", "kpi_saves"), H("h4"), T("t4"),
  ]);
  const sections = toSections(layout, counter());
  assertEquals(sections.map((s) => s.kind), ["general", "instagram", "tiktok", "general"]);
  assertEquals(ids(sections[1].blocks), ["h1", "r", "h3", "s"]);
  assert(validateLayout(fromSections(sections, layout)).ok);
});

Deno.test("toSections: layout legado vazio não ganha seção", () => {
  const empty = L([]);
  assertEquals(toSections(empty, counter()), []);
  assertStrictEquals(sectionizeLayout(empty, counter()), empty);
});

// ---------- reparo de layout seccionado inválido ----------

Deno.test("reparo: bloco antes do primeiro marcador vai para uma Geral inicial", () => {
  const layout = L([T("t"), B("r", "kpi_reach"), S("ig", { platform: "instagram" }), B("s", "kpi_saves")]);
  const sections = toSections(layout, counter());
  assertEquals(sections.map((s) => s.kind), ["general", "instagram"]);
  assert(sections[0].synthesized);
  assert(!sections[1].synthesized);
  assertEquals(ids(sections[0].blocks), ["t"]);
  // o bloco de plataforma da Geral inicial vai para o fim da seção dele
  assertEquals(ids(sections[1].blocks), ["s", "r"]);
  assert(validateLayout(fromSections(sections, layout)).ok);
});

Deno.test("reparo: Geral inicial que ficaria vazia não é criada", () => {
  const layout = L([B("r", "kpi_reach"), S("ig", { platform: "instagram" })]);
  const sections = toSections(layout, counter());
  assertEquals(sections.map((s) => s.kind), ["instagram"]);
  assertEquals(ids(sections[0].blocks), ["r"]);
});

Deno.test("reparo: tiktok_kpi_views na seção Instagram vai para o fim da seção TikTok", () => {
  const layout = L([
    S("ig", { platform: "instagram" }), B("v", "tiktok_kpi_views"), B("r", "kpi_reach"),
    S("tt", { platform: "tiktok" }), B("l", "tiktok_kpi_likes"), S("g"), T("t"),
  ]);
  const sections = toSections(layout, counter());
  assertEquals(sections.map((s) => s.marker.id), ["ig", "tt", "g"]);
  assertEquals(ids(sections[0].blocks), ["r"]);
  assertEquals(ids(sections[1].blocks), ["l", "v"]);
});

Deno.test("reparo: seção TikTok ausente é criada logo depois da última seção de plataforma", () => {
  const layout = L([
    S("g0"), T("t0"), S("ig", { platform: "instagram" }), B("v", "tiktok_kpi_views"),
    B("r", "kpi_reach"), S("g"), T("t"),
  ]);
  const sections = toSections(layout, counter());
  assertEquals(sections.map((s) => s.kind), ["general", "instagram", "tiktok", "general"]);
  assertEquals(sections[2].marker.id, "syn1");
  assert(sections[2].synthesized);
  // seção criada no reparo mostra o título (layout já é do modelo novo)
  assertEquals(sections[2].marker.config, { platform: "tiktok" });
  assertEquals(ids(sections[2].blocks), ["v"]);
  assert(validateLayout(fromSections(sections, layout)).ok);
});

Deno.test("reparo: sem nenhuma seção de plataforma, a criada vai para o fim", () => {
  const layout = L([S("g"), B("r", "kpi_reach"), T("t"), S("g2"), T("t2")]);
  const sections = toSections(layout, counter());
  assertEquals(sections.map((s) => s.kind), ["general", "general", "instagram"]);
  assertEquals(ids(sections[2].blocks), ["r"]);
});

Deno.test("reparo: segunda seção Instagram funde na primeira", () => {
  const layout = L([
    S("ig1", { platform: "instagram", title: "Instagram" }), B("a", "kpi_reach"), S("g"), T("t"),
    S("ig2", { platform: "instagram" }), B("b", "kpi_saves"), T("t2"),
  ]);
  const sections = toSections(layout, counter());
  assertEquals(sections.map((s) => s.marker.id), ["ig1", "g"]);
  assertEquals(ids(sections[0].blocks), ["a", "b", "t2"]);
  assertEquals(ids(sections[1].blocks), ["t"]);
});

Deno.test("reparo: marcador malformado é normalizado mantendo o id", () => {
  const bad = {
    id: "m", type: "section", size: "half", text: { type: "doc" },
    config: { platform: "youtube", title: "  " + "x".repeat(90), hideHeader: true, color: "#fff" },
  } as unknown as ReportBlock;
  const layout = L([bad, T("t")]);
  const sections = toSections(layout, counter());
  assertEquals(sections.length, 1);
  assertEquals(sections[0].kind, "general");
  assert(!sections[0].synthesized);
  assertEquals(sections[0].marker, {
    id: "m", type: "section", size: "full", config: { title: "x".repeat(80) },
  });
  assert(validateLayout(fromSections(sections, layout)).ok);
});

Deno.test("reparo: mais de MAX_SECTIONS seções fundem Gerais vizinhas até caber", () => {
  const blocks: ReportBlock[] = [];
  for (let i = 0; i < 20; i++) blocks.push(S(`g${i}`), T(`t${i}`));
  const layout = L(blocks);
  const out = sectionizeLayout(layout, counter());
  assert(validateLayout(out).ok);
  assertEquals(out.blocks.filter(isSectionMarker).length, MAX_SECTIONS);
  assertEquals([...contentIds(out)].sort(), [...contentIds(layout)].sort());
});

// ---------- ida e volta, referência ----------

Deno.test("sectionizeLayout devolve a MESMA referência para layout canônico", () => {
  const canon = FIXTURES.filter((f) => f.valid && isSectioned(f.layout));
  assert(canon.length >= 8);
  for (const f of canon) {
    assertStrictEquals(sectionizeLayout(f.layout, counter()), f.layout, f.name);
    assertEquals(fromSections(toSections(f.layout, counter()), f.layout), f.layout, f.name);
  }
});

Deno.test("fromSections mantém accent, theme e fonts", () => {
  const out = fromSections(toSections(CANONICAL_DEFAULT), CANONICAL_DEFAULT);
  assertEquals(out.accent, "#9f1239");
  assertEquals(out.theme, "editorial");
  assertEquals(out.fonts, "fraunces");
  assertEquals(out.version, LAYOUT_VERSION);
});

Deno.test("sectionizeLayout de legado é canônico, determinístico e estável", () => {
  const a = sectionizeLayout(LEGACY_DEFAULT, counter());
  const b = sectionizeLayout(LEGACY_DEFAULT, counter());
  assertEquals(a, b);
  assert(validateLayout(a).ok);
  assert(isSectioned(a));
  assertStrictEquals(sectionizeLayout(a, counter()), a);
  assertEquals(contentIds(a), ids(LEGACY_DEFAULT.blocks));
});

Deno.test("toSections: makeId que só devolve ids existentes lança erro", () => {
  assertThrows(() => toSections(LEGACY_DEFAULT, () => "cover"), Error, "makeId");
});

Deno.test("sectionizeLayout: seccionado acima do teto de conteúdo volta como a mesma referência", () => {
  const blocks: ReportBlock[] = [S("g")];
  for (let i = 0; i < 201; i++) blocks.push(T(`t${i}`));
  const over = L(blocks);
  assert(!validateLayout(over).ok);
  assertStrictEquals(sectionizeLayout(over, counter()), over);
});

Deno.test("sectionOfBlock e sectionPlatforms repassam makeId", () => {
  assertEquals(sectionOfBlock(LEGACY_DEFAULT, "ig_reach", counter("k"))?.marker.id, "k2");
  let calls = 0;
  assertEquals(sectionPlatforms(LEGACY_DEFAULT, () => `p${++calls}`), ["instagram"]);
  assertEquals(calls, 3);
});

Deno.test("toSections: id sintetizado que colide com um id existente é descartado", () => {
  const ids_ = ["cover", "ai_summary", "fresh1", "fresh2", "fresh3"];
  let i = 0;
  const sections = toSections(LEGACY_DEFAULT, () => ids_[i++]);
  assertEquals(sections.map((s) => s.marker.id), ["fresh1", "fresh2", "fresh3"]);
});

// ---------- helpers ----------

Deno.test("contentBlockCount ignora marcadores; sectionPlatforms na ordem", () => {
  assertEquals(contentBlockCount(CANONICAL_DEFAULT), CANONICAL_DEFAULT.blocks.length - 4);
  assertEquals(contentBlockCount(LEGACY_DEFAULT), LEGACY_DEFAULT.blocks.length);
  assertEquals(sectionPlatforms(CANONICAL_DEFAULT), ["instagram", "tiktok"]);
  assertEquals(sectionPlatforms(LEGACY_DEFAULT), ["instagram"]);
  assertEquals(sectionPlatforms(L([T("t")])), []);
});

Deno.test("sectionOfBlock acha a seção de um bloco ou de um marcador", () => {
  assertEquals(sectionOfBlock(CANONICAL_DEFAULT, "tt_views")?.marker.id, "s_tiktok");
  assertEquals(sectionOfBlock(CANONICAL_DEFAULT, "s_instagram")?.kind, "instagram");
  assertEquals(sectionOfBlock(CANONICAL_DEFAULT, "nope"), undefined);
  assertEquals(sectionOfBlock(LEGACY_DEFAULT, "ig_reach")?.kind, "instagram");
});

Deno.test("isSectioned, isSectionMarker, sectionKindOf", () => {
  assert(isSectioned(CANONICAL_DEFAULT));
  assert(!isSectioned(LEGACY_DEFAULT));
  assert(isSectionMarker(S("x")));
  assert(!isSectionMarker(T("x")));
  assertEquals(sectionKindOf(S("x")), "general");
  assertEquals(sectionKindOf(S("x", { platform: "tiktok" })), "tiktok");
  assertEquals(sectionKindOf(S("x", { platform: "youtube" })), "general");
});

Deno.test("makeSectionMarker: chaves ausentes são omitidas; hideHeader só em plataforma", () => {
  assertEquals(makeSectionMarker("general", { id: "a" }), { id: "a", type: "section", size: "full" });
  assertEquals(makeSectionMarker("general", { id: "a", hideHeader: true }), {
    id: "a", type: "section", size: "full",
  });
  assertEquals(makeSectionMarker("instagram", { id: "b", hideHeader: true, title: "  Meu IG  " }), {
    id: "b", type: "section", size: "full",
    config: { platform: "instagram", title: "Meu IG", hideHeader: true },
  });
  assertEquals(makeSectionMarker("tiktok", { id: "c", title: "   " }).config, { platform: "tiktok" });
  // trim só ASCII: \t e \n saem, U+00A0 fica (o validador conta igual)
  assertEquals(makeSectionMarker("general", { id: "d", title: "\t Resumo \n" }).config, { title: "Resumo" });
  assertEquals(makeSectionMarker("general", { id: "e", title: "\u00a0Resumo\u00a0" }).config, {
    title: "\u00a0Resumo\u00a0",
  });
  const nbsp = makeSectionMarker("general", { id: "f", title: "\u00a0" + "x".repeat(90) });
  assert(validateLayout(L([nbsp])).ok);
  assert(typeof makeSectionMarker("general").id === "string");
  assert(validateLayout(L([makeSectionMarker("tiktok", { title: "x".repeat(200) })])).ok);
});

// ---------- propriedade ----------

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

Deno.test("propriedade: 300 layouts legados aleatórios viram canônicos válidos sem perder id", () => {
  const rand = mulberry32(20261028);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const types = BLOCK_TYPES.filter((t) => t !== "section");
  for (let n = 0; n < 300; n++) {
    const len = Math.floor(rand() * 61);
    const blocks: ReportBlock[] = [];
    for (let i = 0; i < len; i++) {
      // pesos: mais section_header e cover para exercitar trechos e capas soltas
      const r = rand();
      const type: BlockType = r < 0.15 ? "section_header" : r < 0.22 ? "cover" : pick(types);
      const b: ReportBlock = { id: `L${n}_${i}`, type, size: type === "cover" ? "full" : pick(BLOCK_SIZES) };
      if (TEXT_BLOCK_TYPES.includes(type) && rand() < 0.5) b.text = { type: "doc" };
      blocks.push(b);
    }
    const legacy = L(blocks);
    assert(validateLayout(legacy).ok, `gerado inválido #${n}`);
    const out = sectionizeLayout(legacy, counter(`m${n}_`));
    const r = validateLayout(out);
    assert(r.ok, `#${n}: ${r.ok ? "" : r.error}`);
    assertEquals([...contentIds(out)].sort(), ids(blocks).sort(), `#${n}`);
    assertEquals(out.blocks.length - contentIds(out).length <= MAX_SECTIONS, true);
    // o canônico é ponto fixo
    assertStrictEquals(sectionizeLayout(out, counter()), out);
  }
});

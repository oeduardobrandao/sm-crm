// Seções do relatório (spec docs/superpowers/specs/2026-10-28-report-platform-sections-design.md
// §Model). TS PURO: importado pela edge function (Deno) E pelo pacote React (Vite/tsc).
//
// O layout segue um array plano; um bloco `section` abre uma seção e todo bloco pertence ao
// marcador anterior mais próximo. Ninguém percorre o array cru atrás de seções: este módulo é o
// dono da estrutura. Leitura tolerante (toSections nunca perde um bloco de conteúdo); a escrita
// é validada por validateLayout (layout.ts) e pelo trigger validate_report_layout().
import {
  blockPlatform,
  codePointLength,
  MAX_SECTIONS,
  type ReportBlock,
  type ReportLayout,
  SECTION_TITLE_MAX,
  sectionStructureError,
  trimSectionTitle,
} from "./layout.ts";

export type SectionKind = "general" | "instagram" | "tiktok";
export type SectionPlatform = Exclude<SectionKind, "general">;
const PLATFORM_ORDER: readonly SectionPlatform[] = ["instagram", "tiktok"];

export interface ReportSection {
  /** O bloco `section`. Sintetizado (id novo via makeId) quando o layout não o tinha. */
  marker: ReportBlock;
  kind: SectionKind;
  /** Blocos de conteúdo da seção, na ordem do layout (sem o marcador). */
  blocks: ReportBlock[];
  /** true = o marcador foi criado pela conversão de legado ou pelo reparo, não estava salvo. */
  synthesized: boolean;
}

export function isSectionMarker(b: ReportBlock): boolean {
  return b.type === "section";
}

/** Tipo da seção pelo marcador. Plataforma desconhecida ou ausente = Geral. */
export function sectionKindOf(marker: ReportBlock): SectionKind {
  const p = marker.config?.platform;
  return p === "instagram" || p === "tiktok" ? p : "general";
}

/** Trim ASCII (o mesmo do validador) + corte em SECTION_TITLE_MAX code points; vazio = sem
 * título. */
function cleanTitle(title: string): string | undefined {
  const trimmed = trimSectionTitle(title);
  if (trimmed.length === 0) return undefined;
  if (codePointLength(trimmed) <= SECTION_TITLE_MAX) return trimmed;
  return trimSectionTitle([...trimmed].slice(0, SECTION_TITLE_MAX).join(""));
}

/** Marcador no formato exato que o validador aceita: chaves ausentes são omitidas (nada de
 * `false` ou `""`), `hideHeader` só em seção de plataforma, título com trim ASCII e cortado. */
export function makeSectionMarker(
  kind: SectionKind,
  opts: { id?: string; title?: string; hideHeader?: true } = {},
): ReportBlock {
  const config: Record<string, unknown> = {};
  if (kind !== "general") config.platform = kind;
  const title = opts.title === undefined ? undefined : cleanTitle(opts.title);
  if (title !== undefined) config.title = title;
  if (kind !== "general" && opts.hideHeader === true) config.hideHeader = true;
  const id = opts.id ?? crypto.randomUUID();
  return Object.keys(config).length > 0
    ? { id, type: "section", size: "full", config }
    : { id, type: "section", size: "full" };
}

/** Marcador salvo: a mesma referência se o formato é válido; senão um marcador limpo com o
 * mesmo id (o que der para aproveitar de plataforma, título e hideHeader). */
function normalizeMarker(b: ReportBlock): ReportBlock {
  if (sectionStructureError([b]) === null) return b;
  const cfg = b.config ?? {};
  return makeSectionMarker(sectionKindOf(b), {
    id: b.id,
    title: typeof cfg.title === "string" ? cfg.title : undefined,
    hideHeader: cfg.hideHeader === true ? true : undefined,
  });
}

export function isSectioned(layout: ReportLayout): boolean {
  return layout.blocks.some(isSectionMarker);
}

/** Blocos de conteúdo (marcadores `section` fora); é o que MAX_BLOCKS limita. */
export function contentBlockCount(layout: ReportLayout): number {
  let n = 0;
  for (const b of layout.blocks) if (!isSectionMarker(b)) n++;
  return n;
}

interface Group {
  kind: SectionKind;
  /** null = sintetizar no fim. */
  marker: ReportBlock | null;
  blocks: ReportBlock[];
  /** Só para marcador sintetizado: seção inferida de legado esconde o título. */
  hideHeader: boolean;
}

/** Legado (sem `section`), spec §Reading: corta em cada section_header, classifica cada trecho
 * pelos seus blocos de plataforma (trecho misto quebra onde a plataforma muda; os neutros entre
 * as duas ficam com a anterior), um trecho neutro entre dois da mesma plataforma entra nela, os
 * demais neutros viram Geral, e trechos vizinhos do mesmo tipo se juntam.
 * Trecho que NÃO começa com section_header (só o inicial) separa o prefixo neutro (os neutros
 * antes do primeiro bloco de plataforma) num trecho neutro próprio: capa e resumo de um modelo
 * que perdeu o "Métricas principais" não podem cair dentro da seção Instagram (sairiam junto
 * com ela numa geração só TikTok). Trecho com section_header mantém o título e o prefixo com o
 * conteúdo de plataforma, porque o título é o cabeçalho desse conteúdo. */
function inferLegacy(blocks: readonly ReportBlock[]): Group[] {
  const segments: ReportBlock[][] = [];
  for (const b of blocks) {
    if (b.type === "section_header" || segments.length === 0) segments.push([b]);
    else segments[segments.length - 1].push(b);
  }

  const pieces: { platform: SectionPlatform | null; blocks: ReportBlock[] }[] = [];
  for (const segment of segments) {
    let seg = segment;
    if (seg[0].type !== "section_header") {
      const firstPlatform = seg.findIndex((b) => blockPlatform(b.type) !== null);
      if (firstPlatform > 0) {
        pieces.push({ platform: null, blocks: seg.slice(0, firstPlatform) });
        seg = seg.slice(firstPlatform);
      }
    }
    let cur: { platform: SectionPlatform | null; blocks: ReportBlock[] } = {
      platform: null,
      blocks: [],
    };
    for (const b of seg) {
      const p = blockPlatform(b.type);
      if (p !== null && cur.platform !== null && p !== cur.platform) {
        pieces.push(cur);
        cur = { platform: p, blocks: [b] };
      } else {
        if (p !== null) cur.platform = p;
        cur.blocks.push(b);
      }
    }
    pieces.push(cur);
  }

  const kinds: SectionKind[] = pieces.map((p) => p.platform ?? "general");
  for (let i = 0; i < pieces.length; i++) {
    if (pieces[i].platform !== null) continue;
    let j = i;
    while (j + 1 < pieces.length && pieces[j + 1].platform === null) j++;
    const prev = i > 0 ? pieces[i - 1].platform : null;
    const next = j + 1 < pieces.length ? pieces[j + 1].platform : null;
    const kind: SectionKind = prev !== null && prev === next ? prev : "general";
    for (let k = i; k <= j; k++) kinds[k] = kind;
    i = j;
  }

  const groups: Group[] = [];
  pieces.forEach((piece, i) => {
    const last = groups[groups.length - 1];
    if (last && last.kind === kinds[i]) last.blocks.push(...piece.blocks);
    else {
      groups.push({
        kind: kinds[i],
        marker: null,
        blocks: [...piece.blocks],
        hideHeader: kinds[i] !== "general",
      });
    }
  });
  return groups;
}

/** Layout com marcadores: um grupo por marcador; o que vem antes do primeiro vai para uma
 * Geral sintetizada na frente. Os reparos ficam para repairGroups. */
function readSectioned(blocks: readonly ReportBlock[]): Group[] {
  const groups: Group[] = [{ kind: "general", marker: null, blocks: [], hideHeader: false }];
  for (const b of blocks) {
    if (isSectionMarker(b)) {
      const marker = normalizeMarker(b);
      groups.push({ kind: sectionKindOf(marker), marker, blocks: [], hideHeader: false });
    } else groups[groups.length - 1].blocks.push(b);
  }
  return groups;
}

/** Reparos (spec §Reading): bloco de plataforma fora da sua seção vai para o fim dela (criada
 * logo depois da última seção de plataforma, ou no fim, se faltar); segunda seção da mesma
 * plataforma funde na primeira; Geral sintetizada vazia some; Gerais sintetizadas vizinhas se
 * juntam; acima de MAX_SECTIONS, Gerais vizinhas fundem (a de trás na da frente). Nessa fusão
 * fica o marcador da primeira (id e título dela; o da de trás some, a menos que a primeira
 * seja sintetizada, aí herda o marcador salvo da de trás). */
function repairGroups(input: Group[]): Group[] {
  const moved: Record<SectionPlatform, ReportBlock[]> = { instagram: [], tiktok: [] };
  for (const g of input) {
    const keep: ReportBlock[] = [];
    for (const b of g.blocks) {
      const p = blockPlatform(b.type);
      if (p !== null && p !== g.kind) moved[p].push(b);
      else keep.push(b);
    }
    g.blocks = keep;
  }

  let groups: Group[] = [];
  for (const g of input) {
    if (g.kind !== "general") {
      const home = groups.find((h) => h.kind === g.kind);
      if (home) {
        home.blocks.push(...g.blocks);
        continue;
      }
    }
    groups.push(g);
  }

  for (const p of PLATFORM_ORDER) {
    if (moved[p].length === 0) continue;
    let home = groups.find((g) => g.kind === p);
    if (!home) {
      home = { kind: p, marker: null, blocks: [], hideHeader: false };
      let lastPlatform = -1;
      groups.forEach((g, i) => {
        if (g.kind !== "general") lastPlatform = i;
      });
      groups.splice(lastPlatform === -1 ? groups.length : lastPlatform + 1, 0, home);
    }
    home.blocks.push(...moved[p]);
  }

  groups = groups.filter((g) => g.marker !== null || g.blocks.length > 0);

  const merged: Group[] = [];
  for (const g of groups) {
    const last = merged[merged.length - 1];
    if (
      last && last.kind === "general" && g.kind === "general" &&
      last.marker === null && g.marker === null
    ) last.blocks.push(...g.blocks);
    else merged.push(g);
  }

  while (merged.length > MAX_SECTIONS) {
    let i = merged.length - 1;
    while (i > 0 && !(merged[i].kind === "general" && merged[i - 1].kind === "general")) i--;
    if (i === 0) break; // inalcançável: no máximo 2 seções de plataforma
    const [later] = merged.splice(i, 1);
    const earlier = merged[i - 1];
    earlier.blocks.push(...later.blocks);
    if (earlier.marker === null) earlier.marker = later.marker;
  }
  return merged;
}

/** Layout -> seções. Legado é inferido, seccionado inválido é reparado (spec §Reading); todo
 * bloco de conteúdo sobrevive. `makeId` é a única fonte de ids sintetizados (um contador dá
 * saída determinística); um id já usado no layout é descartado e pedido de novo, e 100
 * colisões seguidas lançam erro (nunca devolve um id repetido). Layout vazio dá []. */
export function toSections(
  layout: ReportLayout,
  makeId: () => string = () => crypto.randomUUID(),
): ReportSection[] {
  const used = new Set(layout.blocks.map((b) => b.id));
  const freshId = (): string => {
    for (let tries = 0; tries <= 100; tries++) {
      const id = makeId();
      if (!used.has(id)) {
        used.add(id);
        return id;
      }
    }
    throw new Error("toSections: makeId keeps returning ids already in the layout");
  };
  const groups = repairGroups(
    isSectioned(layout) ? readSectioned(layout.blocks) : inferLegacy(layout.blocks),
  );
  return groups.map((g) => ({
    marker: g.marker ??
      makeSectionMarker(g.kind, g.hideHeader ? { id: freshId(), hideHeader: true } : { id: freshId() }),
    kind: g.kind,
    blocks: g.blocks,
    synthesized: g.marker === null,
  }));
}

/** Seções -> layout (inverso de toSections). Mantém version/accent/theme/fonts de `base`. */
export function fromSections(sections: ReportSection[], base: ReportLayout): ReportLayout {
  return { ...base, blocks: sections.flatMap((s) => [s.marker, ...s.blocks]) };
}

/** Forma canônica. Devolve a MESMA referência quando o layout já é canônico (o autosave do
 * editor compara com ===) e para o layout legado vazio. "Canônico" aqui olha só o que o reparo
 * conserta (forma do marcador, regras 1 a 3, teto de seções): um layout seccionado acima do
 * teto de conteúdo volta igual, porque seccionar de novo não o deixaria válido. */
export function sectionizeLayout(
  layout: ReportLayout,
  makeId?: () => string,
): ReportLayout {
  if (isSectioned(layout)) {
    if (sectionStructureError(layout.blocks, { contentCap: false }) === null) return layout;
  } else if (layout.blocks.length === 0) return layout;
  return fromSections(toSections(layout, makeId), layout);
}

/** Seção que contém o bloco (ou cujo marcador tem esse id). */
export function sectionOfBlock(
  layout: ReportLayout,
  blockId: string,
  makeId?: () => string,
): ReportSection | undefined {
  return toSections(layout, makeId).find(
    (s) => s.marker.id === blockId || s.blocks.some((b) => b.id === blockId),
  );
}

/** Plataformas com seção, na ordem do relatório (legado via toSections). */
export function sectionPlatforms(
  layout: ReportLayout,
  makeId?: () => string,
): SectionPlatform[] {
  const out: SectionPlatform[] = [];
  for (const s of toSections(layout, makeId)) if (s.kind !== "general") out.push(s.kind);
  return out;
}

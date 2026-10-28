// Operações puras de edição do layout do relatório de blocos. Imutáveis; id
// inexistente devolve a MESMA referência (o autosave usa igualdade referencial
// para saber se algo mudou). Todo output é válido por construção; o gate
// validateLayout roda no save (useLayoutAutosave), não aqui.
//
// Seções (spec 2026-10-28-report-platform-sections §Editor): as ops supõem o
// layout canônico (o editor trabalha sobre sectionizeLayout do salvo) e nunca
// produzem um que quebre as regras: o que quebraria (plataforma errada na
// seção, plataforma repetida, MAX_SECTIONS, MAX_BLOCKS, marcador tratado como
// bloco) devolve a MESMA referência. Um marcador `section` só muda pelas ops de
// seção; as de bloco o ignoram.
import type {
  BlockSize,
  BlockType,
  ReportBlock,
  ReportFontId,
  ReportLayout,
  ReportSection,
  ReportThemeId,
  SectionKind,
} from '@mesaas/report-blocks/types';
import {
  BLOCK_TYPES,
  blockPlatform,
  contentBlockCount,
  fromSections,
  isSectioned,
  isSectionMarker,
  isValidSectionTitle,
  makeSectionMarker,
  MAX_BLOCKS,
  MAX_SECTIONS,
  sectionKindOf,
  TEXT_BLOCK_TYPES,
  toSections,
} from '@mesaas/report-blocks/types';

export const SIZE_ORDER: readonly BlockSize[] = ['third', 'half', 'full'];

const DEFAULT_SIZE: Partial<Record<BlockType, BlockSize>> = {
  kpi_followers_gained: 'third',
  kpi_followers_total: 'third',
  kpi_reach: 'third',
  kpi_views: 'third',
  kpi_engagement_rate: 'third',
  kpi_saves: 'third',
  kpi_posts_count: 'third',
  kpi_profile_views: 'third',
  kpi_website_clicks: 'third',
  kpi_follows: 'third',
  audience_gender: 'half',
  audience_age: 'half',
  audience_cities: 'half',
  audience_countries: 'half',
};
// KPIs do TikTok entram como third, igual ao layout padrão da geração.
for (const t of BLOCK_TYPES) if (t.startsWith('tiktok_kpi_')) DEFAULT_SIZE[t] = 'third';

const EMPTY_TEXT_DOC = { type: 'doc', content: [{ type: 'paragraph', content: [] }] };

/** Índice do marcador `section` que abre a seção do bloco em `idx` (o mais
 * próximo antes dele); -1 = nenhum (layout legado, ou antes do primeiro). */
function ownerMarkerIndex(blocks: readonly ReportBlock[], idx: number): number {
  for (let i = idx - 1; i >= 0; i--) if (isSectionMarker(blocks[i])) return i;
  return -1;
}

/** Índice do bloco `id` desde que NÃO seja um marcador de seção; -1 senão. */
function contentIndex(layout: ReportLayout, id: string): number {
  const idx = layout.blocks.findIndex((b) => b.id === id);
  return idx >= 0 && !isSectionMarker(layout.blocks[idx]) ? idx : -1;
}

/** Reordena dentro da seção. Alvo em outra seção, ou marcador de qualquer lado
 * = MESMA referência (seções se movem com moveSection/reorderSections). */
export function moveBlock(layout: ReportLayout, activeId: string, overId: string): ReportLayout {
  const from = contentIndex(layout, activeId);
  const to = contentIndex(layout, overId);
  if (from < 0 || to < 0 || from === to) return layout;
  if (ownerMarkerIndex(layout.blocks, from) !== ownerMarkerIndex(layout.blocks, to)) return layout;
  const blocks = [...layout.blocks];
  const [moved] = blocks.splice(from, 1);
  blocks.splice(to, 0, moved);
  return { ...layout, blocks };
}

export function resizeBlock(layout: ReportLayout, id: string, delta: 1 | -1): ReportLayout {
  const idx = contentIndex(layout, id);
  // Capa é sempre full (como em setBlockSize).
  if (idx < 0 || layout.blocks[idx].type === 'cover') return layout;
  const current = SIZE_ORDER.indexOf(layout.blocks[idx].size);
  const next = Math.min(Math.max(current + delta, 0), SIZE_ORDER.length - 1);
  if (next === current) return layout;
  const blocks = [...layout.blocks];
  blocks[idx] = { ...blocks[idx], size: SIZE_ORDER[next] };
  return { ...layout, blocks };
}

/** Largura direta (o "Usar meia largura" do bloco de imagem). Capa é sempre
 * full; mesmo valor, id inexistente ou capa = MESMA referência. */
export function setBlockSize(layout: ReportLayout, id: string, size: BlockSize): ReportLayout {
  const idx = contentIndex(layout, id);
  if (idx < 0) return layout;
  const b = layout.blocks[idx];
  if (b.type === 'cover' || b.size === size) return layout;
  const blocks = [...layout.blocks];
  blocks[idx] = { ...b, size };
  return { ...layout, blocks };
}

/** Exclui um bloco de conteúdo. Marcador de seção = MESMA referência (só
 * removeSection o tira, junto com os blocos dele). */
export function removeBlock(layout: ReportLayout, id: string): ReportLayout {
  const idx = contentIndex(layout, id);
  if (idx < 0) return layout;
  return { ...layout, blocks: layout.blocks.filter((_, i) => i !== idx) };
}

/** Desfaz uma exclusão: reinsere o bloco na posição de origem (clampada).
 * Id já presente = no-op com a MESMA referência (contrato do autosave). Em
 * layout seccionado, uma posição que poria o bloco antes da primeira seção ou
 * numa seção de outra plataforma (o layout mudou entre excluir e desfazer)
 * também é no-op, assim como MAX_BLOCKS já atingido. Layout vazio (o bloco era
 * o último e a seção dele saiu depois): o bloco volta numa seção nova, Geral se
 * neutro, da plataforma dele se de plataforma, para o resultado seguir
 * canônico. Legado não vazio mantém o splice puro (o editor nunca o produz: o
 * layout chega por sectionizeLayout). */
export function restoreBlock(
  layout: ReportLayout,
  block: ReportBlock,
  index: number,
  makeId: () => string = () => crypto.randomUUID(),
): ReportLayout {
  if (isSectionMarker(block) || layout.blocks.some((b) => b.id === block.id)) return layout;
  // Excluir no limite, inserir outro e desfazer daria MAX_BLOCKS + 1 (o autosave recusa).
  if (contentBlockCount(layout) >= MAX_BLOCKS) return layout;
  if (layout.blocks.length === 0) {
    const kind: SectionKind = blockPlatform(block.type) ?? 'general';
    return fromSections(
      [
        {
          marker: makeSectionMarker(kind, { id: makeId() }),
          kind,
          blocks: [block],
          synthesized: false,
        },
      ],
      layout,
    );
  }
  const at = Math.min(Math.max(index, 0), layout.blocks.length);
  if (isSectioned(layout)) {
    const owner = ownerMarkerIndex(layout.blocks, at);
    if (owner < 0 || !accepts(sectionKindOf(layout.blocks[owner]), block.type)) return layout;
  }
  const blocks = [...layout.blocks];
  blocks.splice(at, 0, block);
  return { ...layout, blocks };
}

/** Seção do tipo `kind` aceita o bloco: neutro em qualquer uma, de plataforma
 * só na da mesma plataforma; marcador nunca é conteúdo. */
function accepts(kind: SectionKind, type: BlockType): boolean {
  if (type === 'section') return false;
  const p = blockPlatform(type);
  return p === null || p === kind;
}

function newBlock(type: BlockType, id: string): ReportBlock {
  const block: ReportBlock = { id, type, size: DEFAULT_SIZE[type] ?? 'full' };
  if (type === 'top_posts') block.config = { count: 6 };
  if (type === 'post_list') block.config = { count: 12 };
  if (type === 'section_header') block.config = { title: 'Novo subtítulo' };
  if (TEXT_BLOCK_TYPES.includes(type)) block.text = structuredClone(EMPTY_TEXT_DOC);
  return block;
}

function findSection(sections: ReportSection[], sectionId: string): number {
  return sections.findIndex((s) => s.marker.id === sectionId);
}

/** Insere um bloco novo na seção `sectionId`, na posição `position` entre os
 * blocos dela (clampada; ausente = fim). Seção inexistente, tipo que a seção
 * não aceita, `section` ou MAX_BLOCKS atingido = MESMA referência. */
export function insertBlockInSection(
  layout: ReportLayout,
  sectionId: string,
  type: BlockType,
  position?: number,
  makeId: () => string = () => crypto.randomUUID(),
): ReportLayout {
  if (contentBlockCount(layout) >= MAX_BLOCKS) return layout;
  const sections = toSections(layout);
  const si = findSection(sections, sectionId);
  if (si < 0 || !accepts(sections[si].kind, type)) return layout;
  const blocks = [...sections[si].blocks];
  const at =
    position === undefined ? blocks.length : Math.min(Math.max(position, 0), blocks.length);
  blocks.splice(at, 0, newBlock(type, makeId()));
  const next = [...sections];
  next[si] = { ...sections[si], blocks };
  return fromSections(next, layout);
}

/** Insere no fim do relatório. Legado: fim do array. Seccionado: fim da última
 * seção que aceita o tipo; nenhuma aceita (ou MAX_BLOCKS) = MESMA referência. */
export function insertBlock(
  layout: ReportLayout,
  type: BlockType,
  makeId: () => string = () => crypto.randomUUID(),
): { layout: ReportLayout; newId: string } {
  const newId = makeId();
  if (!isSectioned(layout)) {
    if (type === 'section' || contentBlockCount(layout) >= MAX_BLOCKS) return { layout, newId };
    return { layout: { ...layout, blocks: [...layout.blocks, newBlock(type, newId)] }, newId };
  }
  const target = [...toSections(layout)].reverse().find((s) => accepts(s.kind, type));
  if (!target) return { layout, newId };
  return {
    layout: insertBlockInSection(layout, target.marker.id, type, undefined, () => newId),
    newId,
  };
}

/** Adiciona uma seção depois de `afterSectionId` (null = depois da última),
 * com marcador de título visível e os `blocks` dados (os padrões da plataforma,
 * ou nenhum para Geral). Plataforma já presente, âncora inexistente,
 * MAX_SECTIONS, MAX_BLOCKS, ou bloco que a seção não aceita / id repetido =
 * MESMA referência. */
export function addSection(
  layout: ReportLayout,
  kind: SectionKind,
  afterSectionId: string | null,
  blocks: ReportBlock[] = [],
  makeId: () => string = () => crypto.randomUUID(),
): ReportLayout {
  const sections = toSections(layout);
  if (kind !== 'general' && sections.some((s) => s.kind === kind)) return layout;
  if (sections.length >= MAX_SECTIONS) return layout;
  if (!fitsBlocks(layout, kind, blocks)) return layout;
  const after =
    afterSectionId === null ? sections.length - 1 : findSection(sections, afterSectionId);
  if (afterSectionId !== null && after < 0) return layout;
  const section: ReportSection = {
    marker: makeSectionMarker(kind, { id: makeId() }),
    kind,
    blocks: [...blocks],
    synthesized: false,
  };
  const next = [...sections];
  next.splice(after + 1, 0, section);
  return fromSections(next, layout);
}

/** Os blocos cabem numa seção `kind` deste layout: todos aceitos, ids únicos e
 * ausentes do layout, e MAX_BLOCKS não estoura. */
function fitsBlocks(layout: ReportLayout, kind: SectionKind, blocks: ReportBlock[]): boolean {
  if (contentBlockCount(layout) + blocks.length > MAX_BLOCKS) return false;
  const used = new Set(layout.blocks.map((b) => b.id));
  for (const b of blocks) {
    if (!accepts(kind, b.type) || used.has(b.id)) return false;
    used.add(b.id);
  }
  return true;
}

/** Remove a seção inteira (marcador + blocos). Para desfazer, o chamador guarda
 * antes `toSections(layout)[i]` e o índice `i` e chama restoreSection. Id
 * inexistente = MESMA referência. */
export function removeSection(layout: ReportLayout, sectionId: string): ReportLayout {
  const sections = toSections(layout);
  const si = findSection(sections, sectionId);
  if (si < 0) return layout;
  return fromSections(
    sections.filter((_, i) => i !== si),
    layout,
  );
}

/** Desfaz removeSection: reinsere a seção (mesmo marcador, mesmos blocos) no
 * índice de seção `index` (clampado). Algum id já presente, plataforma já
 * presente ou limite estourado = MESMA referência. */
export function restoreSection(
  layout: ReportLayout,
  section: ReportSection,
  index: number,
): ReportLayout {
  if (!isSectionMarker(section.marker)) return layout;
  const sections = toSections(layout);
  const kind = sectionKindOf(section.marker);
  if (kind !== 'general' && sections.some((s) => s.kind === kind)) return layout;
  if (sections.length >= MAX_SECTIONS) return layout;
  if (layout.blocks.some((b) => b.id === section.marker.id)) return layout;
  if (!fitsBlocks(layout, kind, section.blocks)) return layout;
  const next = [...sections];
  next.splice(Math.min(Math.max(index, 0), next.length), 0, {
    ...section,
    kind,
    synthesized: false,
  });
  return fromSections(next, layout);
}

/** Troca a seção com a vizinha (menu Mover para cima/baixo). Borda ou id
 * inexistente = MESMA referência. */
export function moveSection(layout: ReportLayout, sectionId: string, delta: 1 | -1): ReportLayout {
  const sections = toSections(layout);
  const from = findSection(sections, sectionId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= sections.length) return layout;
  const next = [...sections];
  [next[from], next[to]] = [next[to], next[from]];
  return fromSections(next, layout);
}

/** Arrastar a seção `activeSectionId` para a posição de `overSectionId`
 * (semântica do arrayMove do dnd-kit, como moveBlock). Mesma seção ou id
 * inexistente = MESMA referência. */
export function reorderSections(
  layout: ReportLayout,
  activeSectionId: string,
  overSectionId: string,
): ReportLayout {
  const sections = toSections(layout);
  const from = findSection(sections, activeSectionId);
  const to = findSection(sections, overSectionId);
  if (from < 0 || to < 0 || from === to) return layout;
  const next = [...sections];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return fromSections(next, layout);
}

/** Fim de um arraste no canvas ou nas camadas. Marcador ativo = seção: o alvo
 * vira a seção dona dele (o closestCenter costuma cair num bloco dentro do
 * frame, não no frame), e as seções reordenam. Bloco ativo = moveBlock, que já
 * recusa outra seção e marcador. Nada a fazer = MESMA referência. */
export function resolveDragEnd(
  layout: ReportLayout,
  activeId: string,
  overId: string,
): ReportLayout {
  if (activeId === overId) return layout;
  const active = layout.blocks.find((b) => b.id === activeId);
  if (!active) return layout;
  if (!isSectionMarker(active)) return moveBlock(layout, activeId, overId);
  const idx = layout.blocks.findIndex((b) => b.id === overId);
  if (idx < 0) return layout;
  const owner = isSectionMarker(layout.blocks[idx]) ? idx : ownerMarkerIndex(layout.blocks, idx);
  if (owner < 0) return layout;
  return reorderSections(layout, activeId, layout.blocks[owner].id);
}

/** Título e "Ocultar título" da seção. `title`: trim; `""`/`null` remove a
 * chave; acima de SECTION_TITLE_MAX = rejeitado (MESMA referência).
 * `hideHeader`: true só em seção de plataforma (Geral = rejeitado), false
 * remove a chave. Chave ausente no patch = mantém. Nada muda = MESMA
 * referência. */
export function updateSectionConfig(
  layout: ReportLayout,
  sectionId: string,
  patch: { title?: string | null; hideHeader?: boolean },
): ReportLayout {
  const idx = layout.blocks.findIndex((b) => b.id === sectionId);
  const marker = layout.blocks[idx];
  if (!marker || !isSectionMarker(marker)) return layout;
  const kind = sectionKindOf(marker);
  const curTitle = typeof marker.config?.title === 'string' ? marker.config.title : undefined;
  const curHide = marker.config?.hideHeader === true;

  let title = curTitle;
  if (patch.title !== undefined) {
    const trimmed = (patch.title ?? '').trim();
    if (trimmed === '') title = undefined;
    else if (!isValidSectionTitle(trimmed)) return layout;
    else title = trimmed;
  }
  let hide = curHide;
  if (patch.hideHeader !== undefined) {
    if (patch.hideHeader && kind === 'general') return layout;
    hide = patch.hideHeader;
  }
  if (title === curTitle && hide === curHide) return layout;

  const blocks = [...layout.blocks];
  blocks[idx] = makeSectionMarker(kind, {
    id: marker.id,
    ...(title !== undefined ? { title } : {}),
    ...(hide ? { hideHeader: true as const } : {}),
  });
  return { ...layout, blocks };
}

/** Merge raso no config do bloco (título/subtítulo do cabeçalho de seção,
 * count dos widgets de posts). Id inexistente ou marcador de seção = MESMA
 * referência (o marcador muda por updateSectionConfig). */
export function updateBlockConfig(
  layout: ReportLayout,
  id: string,
  patch: Record<string, unknown>,
): ReportLayout {
  const idx = contentIndex(layout, id);
  if (idx < 0) return layout;
  const blocks = [...layout.blocks];
  blocks[idx] = { ...blocks[idx], config: { ...blocks[idx].config, ...patch } };
  return { ...layout, blocks };
}

export function updateBlockText(layout: ReportLayout, id: string, text: unknown): ReportLayout {
  const idx = contentIndex(layout, id);
  if (idx < 0) return layout;
  const blocks = [...layout.blocks];
  blocks[idx] = { ...blocks[idx], text };
  return { ...layout, blocks };
}

const HEX8_RE = /^#[0-9a-fA-F]{8}$/;
const HEX6_RE = /^#[0-9a-fA-F]{6}$/;

// Blindagem defensiva: o ColorPicker compartilhado tem allowAlpha (default
// true) e um clique num swatch "recente" salvo por outra tela (Estúdio) pode
// injetar #rrggbbaa aqui mesmo com allowAlpha={false} nesta página. Um accent
// que falha o validateLayout estrito de #rrggbb nunca deve ENTRAR no layout —
// o autosave descarta o pending sem retry, e toda edição seguinte falharia
// até reload (achado C2).
export function setLayoutAccent(layout: ReportLayout, accent: string | undefined): ReportLayout {
  if (accent === undefined) {
    const { accent: _drop, ...rest } = layout;
    return rest as ReportLayout;
  }
  const normalized = HEX8_RE.test(accent) ? accent.slice(0, 7) : accent;
  if (!HEX6_RE.test(normalized)) return layout;
  return { ...layout, accent: normalized };
}

/** Tema visual do relatório. `undefined` REMOVE a chave (modo herdado — só
 * accent aplicado). Mesmo valor devolve a MESMA referência (contrato do
 * autosave: só persiste quando algo de fato mudou). */
export function setLayoutTheme(
  layout: ReportLayout,
  theme: ReportThemeId | undefined,
): ReportLayout {
  if (layout.theme === theme) return layout;
  if (theme === undefined) {
    const { theme: _drop, ...rest } = layout;
    return rest as ReportLayout;
  }
  return { ...layout, theme };
}

/** Dupla de fontes do relatório. Mesma semântica de setLayoutTheme:
 * `undefined` remove a chave (herda a fonte da página), mesmo valor = MESMA
 * referência. */
export function setLayoutFonts(
  layout: ReportLayout,
  fonts: ReportFontId | undefined,
): ReportLayout {
  if (layout.fonts === fonts) return layout;
  if (fonts === undefined) {
    const { fonts: _drop, ...rest } = layout;
    return rest as ReportLayout;
  }
  return { ...layout, fonts };
}

export const COVER_LOGO_MIN = 20;
export const COVER_LOGO_MAX = 68;
export const COVER_LOGO_DEFAULT = 36;
const COVER_LOGO_STEP = 8;

/** Cor de fundo própria da capa (bloco `cover`): mesma blindagem hex8->hex6 de
 * setLayoutAccent (achado C2) acima, só que por bloco em vez de por layout.
 * `undefined` produz o patch que remove a chave (herda o accent do relatório). Cor
 * inválida devolve patch vazio -- o chamador deve tratar `{}` como "nada a
 * fazer" e pular o onConfigChange. */
export function normalizeCoverColorPatch(color: string | undefined): Record<string, unknown> {
  if (color === undefined) return { color: undefined };
  const normalized = HEX8_RE.test(color) ? color.slice(0, 7) : color;
  if (!HEX6_RE.test(normalized)) return {};
  return { color: normalized };
}

/** Próximo logoSize da capa dado o atual (ausente = COVER_LOGO_DEFAULT), clamped a
 * [COVER_LOGO_MIN, COVER_LOGO_MAX] em passos de COVER_LOGO_STEP px. */
export function stepCoverLogoSize(current: number | undefined, delta: 1 | -1): number {
  const base = typeof current === 'number' ? current : COVER_LOGO_DEFAULT;
  return Math.min(Math.max(base + delta * COVER_LOGO_STEP, COVER_LOGO_MIN), COVER_LOGO_MAX);
}

// Implementação real vive no arquivo compartilhado Deno+frontend (mesmo lugar
// que validateLayout): a geração de relatório a partir de template roda em
// Deno e precisa da MESMA função (achado de review externo 2026-08-25). Todo
// chamador existente aqui continua importando de './layoutOps' -- este
// re-export mantém isso funcionando sem tocar em nenhum call site.
export { normalizeCoverSize } from '@mesaas/report-blocks/types';

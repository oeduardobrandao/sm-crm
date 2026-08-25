// Operações puras de edição do layout do relatório de blocos. Imutáveis; id
// inexistente devolve a MESMA referência (o autosave usa igualdade referencial
// para saber se algo mudou). Todo output é válido por construção; o gate
// validateLayout roda no save (useLayoutAutosave), não aqui.
import type {
  BlockSize,
  BlockType,
  ReportBlock,
  ReportFontId,
  ReportLayout,
  ReportThemeId,
} from '@mesaas/report-blocks/types';
import { TEXT_BLOCK_TYPES } from '@mesaas/report-blocks/types';

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
  audience_gender: 'half',
  audience_age: 'half',
  audience_cities: 'half',
  audience_countries: 'half',
};

const EMPTY_TEXT_DOC = { type: 'doc', content: [{ type: 'paragraph', content: [] }] };

export function moveBlock(layout: ReportLayout, activeId: string, overId: string): ReportLayout {
  const from = layout.blocks.findIndex((b) => b.id === activeId);
  const to = layout.blocks.findIndex((b) => b.id === overId);
  if (from < 0 || to < 0 || from === to) return layout;
  const blocks = [...layout.blocks];
  const [moved] = blocks.splice(from, 1);
  blocks.splice(to, 0, moved);
  return { ...layout, blocks };
}

export function resizeBlock(layout: ReportLayout, id: string, delta: 1 | -1): ReportLayout {
  const idx = layout.blocks.findIndex((b) => b.id === id);
  if (idx < 0) return layout;
  const current = SIZE_ORDER.indexOf(layout.blocks[idx].size);
  const next = Math.min(Math.max(current + delta, 0), SIZE_ORDER.length - 1);
  if (next === current) return layout;
  const blocks = [...layout.blocks];
  blocks[idx] = { ...blocks[idx], size: SIZE_ORDER[next] };
  return { ...layout, blocks };
}

export function removeBlock(layout: ReportLayout, id: string): ReportLayout {
  const blocks = layout.blocks.filter((b) => b.id !== id);
  if (blocks.length === layout.blocks.length) return layout;
  return { ...layout, blocks };
}

/** Desfaz uma exclusão: reinsere o bloco na posição de origem (clampada).
 * Id já presente = no-op com a MESMA referência (contrato do autosave). */
export function restoreBlock(
  layout: ReportLayout,
  block: ReportBlock,
  index: number,
): ReportLayout {
  if (layout.blocks.some((b) => b.id === block.id)) return layout;
  const blocks = [...layout.blocks];
  blocks.splice(Math.min(Math.max(index, 0), blocks.length), 0, block);
  return { ...layout, blocks };
}

/** Insere um bloco novo na POSIÇÃO dada (clampada ao array). Usado pelos
 * pontos de inserção do painel de camadas; insertBlock delega para cá. */
export function insertBlockAt(
  layout: ReportLayout,
  type: BlockType,
  index: number,
  makeId: () => string = () => crypto.randomUUID(),
): { layout: ReportLayout; newId: string } {
  const newId = makeId();
  const block: ReportBlock = { id: newId, type, size: DEFAULT_SIZE[type] ?? 'full' };
  if (type === 'top_posts') block.config = { count: 6 };
  if (type === 'post_list') block.config = { count: 12 };
  if (type === 'section_header') block.config = { title: 'Nova seção' };
  if (TEXT_BLOCK_TYPES.includes(type)) block.text = structuredClone(EMPTY_TEXT_DOC);
  const blocks = [...layout.blocks];
  blocks.splice(Math.min(Math.max(index, 0), blocks.length), 0, block);
  return { layout: { ...layout, blocks }, newId };
}

export function insertBlock(
  layout: ReportLayout,
  type: BlockType,
  makeId: () => string = () => crypto.randomUUID(),
): { layout: ReportLayout; newId: string } {
  return insertBlockAt(layout, type, layout.blocks.length, makeId);
}

/** Merge raso no config do bloco (título/subtítulo do cabeçalho de seção,
 * count dos widgets de posts). Id inexistente = MESMA referência. */
export function updateBlockConfig(
  layout: ReportLayout,
  id: string,
  patch: Record<string, unknown>,
): ReportLayout {
  const idx = layout.blocks.findIndex((b) => b.id === id);
  if (idx < 0) return layout;
  const blocks = [...layout.blocks];
  blocks[idx] = { ...blocks[idx], config: { ...blocks[idx].config, ...patch } };
  return { ...layout, blocks };
}

export function updateBlockText(layout: ReportLayout, id: string, text: unknown): ReportLayout {
  const idx = layout.blocks.findIndex((b) => b.id === id);
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

/** Corrige qualquer bloco cover com size != full para full -- defesa contra um
 * documento cujo layout persistido tenha ficado com um valor antigo/inválido
 * (achado de review externo 2026-08-25): sem isso, o autosave trava pra sempre na
 * primeira edição seguinte, porque validateLayout rejeita o layout inteiro e não
 * há retry para esse caso. Mesma referência se nada precisar mudar. */
export function normalizeCoverSize(layout: ReportLayout): ReportLayout {
  let changed = false;
  const blocks = layout.blocks.map((b) => {
    if (b.type === 'cover' && b.size !== 'full') {
      changed = true;
      return { ...b, size: 'full' as const };
    }
    return b;
  });
  return changed ? { ...layout, blocks } : layout;
}

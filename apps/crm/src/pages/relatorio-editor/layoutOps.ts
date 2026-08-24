// Operações puras de edição do layout do relatório de blocos. Imutáveis; id
// inexistente devolve a MESMA referência (o autosave usa igualdade referencial
// para saber se algo mudou). Todo output é válido por construção; o gate
// validateLayout roda no save (useLayoutAutosave), não aqui.
import type { BlockSize, BlockType, ReportBlock, ReportLayout } from '@mesaas/report-blocks/types';
import { TEXT_BLOCK_TYPES } from '@mesaas/report-blocks/types';

export const SIZE_ORDER: readonly BlockSize[] = ['third', 'half', 'full'];

const DEFAULT_SIZE: Partial<Record<BlockType, BlockSize>> = {
  kpi_followers_gained: 'third',
  kpi_followers_total: 'third',
  kpi_reach: 'third',
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

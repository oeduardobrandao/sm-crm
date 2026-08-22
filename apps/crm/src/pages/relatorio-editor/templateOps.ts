// Semântica de template (spec §4): layout sem dados. Blocos text guardam o
// conteúdo do autor; blocos ai_* são regenerados por relatório, então o texto
// deles NUNCA viaja no template. Puras e imutáveis, como layoutOps.
import type { BlockType, ReportBlock, ReportLayout } from '@mesaas/report-blocks/types';

const AI_TYPES: ReadonlySet<BlockType> = new Set(['ai_summary', 'ai_recommendations', 'ai_goals']);

export function stripAiTextForTemplate(layout: ReportLayout): ReportLayout {
  return {
    ...layout,
    blocks: layout.blocks.map((b) => {
      if (!AI_TYPES.has(b.type) || b.text === undefined) return b;
      const { text: _drop, ...rest } = b;
      return rest as ReportBlock;
    }),
  };
}

/** Aplica um template a um relatório existente: substituição completa do
 * layout. Blocos ai_* do template herdam o texto do PRIMEIRO bloco do mesmo
 * tipo com texto no layout atual; sem correspondente, o bloco sai (não há
 * conteúdo para mostrar e a IA não roda de novo aqui). */
export function applyTemplateLayout(template: ReportLayout, current: ReportLayout): ReportLayout {
  const blocks: ReportBlock[] = [];
  for (const b of template.blocks) {
    if (!AI_TYPES.has(b.type)) {
      blocks.push(b);
      continue;
    }
    const source = current.blocks.find((c) => c.type === b.type && c.text !== undefined);
    if (!source) continue;
    blocks.push({ ...b, text: source.text });
  }
  return { ...template, blocks };
}

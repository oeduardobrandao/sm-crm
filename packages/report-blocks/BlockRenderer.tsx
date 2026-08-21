// Renderer do documento de blocos: layout + snapshot -> grid. Widget de tipo
// desconhecido ou sem dados rende null (spec §4/§7). Nada de '@/' aqui: este
// pacote é compartilhado CRM+Hub (bug documentado em packages/ui/index.ts).
import type { FC } from 'react';
import type { BlockType, ReportBlock, ReportDocSnapshot, ReportLayout } from './types';
import { resolveAccent } from '../../supabase/functions/_shared/report-template/theme';
import { CoverBlock } from './blocks/CoverBlock';
import { SectionHeaderBlock } from './blocks/SectionHeaderBlock';
import { DividerBlock } from './blocks/DividerBlock';
import { TextBlock } from './blocks/TextBlock';

export interface BlockProps {
  block: ReportBlock;
  snapshot: ReportDocSnapshot;
}

export const BLOCK_COMPONENTS: Partial<Record<BlockType, FC<BlockProps>>> = {
  cover: CoverBlock,
  section_header: SectionHeaderBlock,
  divider: DividerBlock,
  text: TextBlock,
  ai_summary: TextBlock,
  ai_recommendations: TextBlock,
  ai_goals: TextBlock,
  // Tasks 7-8 registram os demais widgets aqui.
};

const SIZE_CLASS = { third: 'rb-third', half: 'rb-half', full: 'rb-full' } as const;

export interface BlockRendererProps {
  layout: ReportLayout;
  snapshot: ReportDocSnapshot;
  mode: 'view' | 'print';
}

export function BlockRenderer({ layout, snapshot, mode }: BlockRendererProps) {
  // Override por relatório/template (layout.accent) com fallback na marca do
  // workspace congelada no snapshot; resolveAccent trata inválido/claro demais.
  const { acc } = resolveAccent(layout.accent ?? snapshot.branding.accent_color);
  return (
    <div className={`rb-grid rb-mode-${mode}`} style={{ ['--rb-accent' as string]: acc }}>
      {layout.blocks.map((block) => {
        const Component = BLOCK_COMPONENTS[block.type];
        if (!Component) return null;
        const node = <Component block={block} snapshot={snapshot} />;
        if (node === null) return null;
        return (
          <div
            key={block.id}
            data-block-id={block.id}
            className={SIZE_CLASS[block.size] ?? 'rb-full'}
          >
            {node}
          </div>
        );
      })}
    </div>
  );
}

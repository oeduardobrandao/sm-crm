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
import { KpiCardBlock } from './blocks/KpiCardBlock';
import { FollowerChartBlock } from './blocks/FollowerChartBlock';
import { FormatCardsBlock } from './blocks/FormatCardsBlock';
import { AudienceGenderBlock } from './blocks/AudienceGenderBlock';
import { AudienceAgeBlock } from './blocks/AudienceAgeBlock';
import { AudienceCitiesBlock } from './blocks/AudienceCitiesBlock';
import { AudienceCountriesBlock } from './blocks/AudienceCountriesBlock';
import { BestTimesBlock } from './blocks/BestTimesBlock';
import { TopPostsBlock } from './blocks/TopPostsBlock';
import { PostListBlock } from './blocks/PostListBlock';
import { TagsTableBlock } from './blocks/TagsTableBlock';

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
  kpi_followers_gained: KpiCardBlock,
  kpi_followers_total: KpiCardBlock,
  kpi_reach: KpiCardBlock,
  kpi_engagement_rate: KpiCardBlock,
  kpi_saves: KpiCardBlock,
  kpi_posts_count: KpiCardBlock,
  kpi_profile_views: KpiCardBlock,
  kpi_website_clicks: KpiCardBlock,
  chart_followers: FollowerChartBlock,
  chart_formats: FormatCardsBlock,
  audience_gender: AudienceGenderBlock,
  audience_age: AudienceAgeBlock,
  audience_cities: AudienceCitiesBlock,
  audience_countries: AudienceCountriesBlock,
  chart_best_times: BestTimesBlock,
  top_posts: TopPostsBlock,
  post_list: PostListBlock,
  tags_table: TagsTableBlock,
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
  const { acc, accFg } = resolveAccent(layout.accent ?? snapshot.branding.accent_color);
  return (
    <div
      className={`rb-grid rb-mode-${mode}`}
      style={{ ['--rb-accent' as string]: acc, ['--rb-accent-fg' as string]: accFg }}
    >
      {layout.blocks.map((block) => {
        const Component = BLOCK_COMPONENTS[block.type];
        if (!Component) return null;
        // Widget sem dados renderiza null; a célula vazia colapsa via
        // [data-block-id]:empty no styles.css (JSX sempre gera um elemento
        // aqui, então checar o retorno do componente não teria efeito).
        return (
          <div
            key={block.id}
            data-block-id={block.id}
            className={SIZE_CLASS[block.size] ?? 'rb-full'}
          >
            <Component block={block} snapshot={snapshot} />
          </div>
        );
      })}
    </div>
  );
}

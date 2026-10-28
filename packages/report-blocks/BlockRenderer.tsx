// Renderer do documento de blocos: layout + snapshot -> grid. Widget de tipo
// desconhecido ou sem dados rende null (spec §4/§7). Nada de '@/' aqui: este
// pacote é compartilhado CRM+Hub (bug documentado em packages/ui/index.ts).
import type { CSSProperties, FC } from 'react';
import type { BlockType, ReportBlock, ReportDocSnapshot, ReportLayout } from './types';
import { toSections } from './types';
import { resolveReportTheme } from './theme';
import { ReportFonts } from './ReportFonts';
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
import { ImageBlock } from './blocks/ImageBlock';
import { PlatformSectionHeading } from './blocks/PlatformSectionHeading';
import { instagramAbsent, layoutPlatforms, tiktokBlockView, type ReportPlatform } from './platform';
import { sectionVisibleInView } from './data-presence';

export interface BlockProps {
  block: ReportBlock;
  snapshot: ReportDocSnapshot;
  /** 'tiktok' quando o bloco é um tiktok_* renderizado pela visão de
   * snapshot.tiktok (ver withTikTok). Ausente = Instagram/neutro. */
  platform?: ReportPlatform;
  /** Plataformas do layout (layoutPlatforms), calculadas uma vez pelo
   * renderer; a capa deriva kicker e handle delas. Ausente = Instagram. */
  layoutPlatforms?: ReportPlatform[];
}

// Bloco TikTok = componente Instagram + visão do snapshot montada de
// snapshot.tiktok. Criados no escopo do módulo para a identidade do componente
// ser estável (EditorCanvas também os renderiza no DragOverlay).
function withTikTok(Base: FC<BlockProps>): FC<BlockProps> {
  function TikTokBlock(props: BlockProps) {
    const v = tiktokBlockView(props.block, props.snapshot);
    return v ? <Base {...props} block={v.block} snapshot={v.snapshot} platform="tiktok" /> : null;
  }
  TikTokBlock.displayName = `TikTok(${Base.displayName ?? Base.name})`;
  return TikTokBlock;
}
const TikTokKpiCard = withTikTok(KpiCardBlock);

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
  kpi_views: KpiCardBlock,
  kpi_engagement_rate: KpiCardBlock,
  kpi_saves: KpiCardBlock,
  kpi_posts_count: KpiCardBlock,
  kpi_profile_views: KpiCardBlock,
  kpi_website_clicks: KpiCardBlock,
  kpi_follows: KpiCardBlock,
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
  image: ImageBlock,
  tiktok_kpi_followers_total: TikTokKpiCard,
  tiktok_kpi_followers_gained: TikTokKpiCard,
  tiktok_kpi_views: TikTokKpiCard,
  tiktok_kpi_engagement_rate: TikTokKpiCard,
  tiktok_kpi_likes: TikTokKpiCard,
  tiktok_kpi_comments: TikTokKpiCard,
  tiktok_kpi_shares: TikTokKpiCard,
  tiktok_kpi_posts_count: TikTokKpiCard,
  tiktok_kpi_likes_total: TikTokKpiCard,
  tiktok_chart_followers: withTikTok(FollowerChartBlock),
  tiktok_chart_best_times: withTikTok(BestTimesBlock),
  tiktok_top_posts: withTikTok(TopPostsBlock),
  tiktok_post_list: withTikTok(PostListBlock),
};

export const SIZE_CLASS = { third: 'rb-third', half: 'rb-half', full: 'rb-full' } as const;

export interface BlockRendererProps {
  layout: ReportLayout;
  snapshot: ReportDocSnapshot;
  mode: 'view' | 'print';
}

export function BlockRenderer({ layout, snapshot, mode }: BlockRendererProps) {
  // Tema/fontes/accent do documento: fonte única, compartilhada com o editor
  // (EditorCanvas) e o print. Modo herdado emite só accent (byte-idêntico).
  const theme = resolveReportTheme(layout, snapshot);
  const platforms = layoutPlatforms(layout);
  // Ids dos marcadores sintetizados (legado, reparo) vêm de um contador por render: estáveis
  // entre renders, então as keys do React não mudam a cada atualização.
  let synth = 0;
  const sections = toSections(layout, () => `synth-${++synth}`);

  function renderBlock(block: ReportBlock) {
    // hasOwnProperty (não Object.hasOwn: fora do lib target ES2021 do
    // tsconfig) evita que um block.type tipo "__proto__" ou
    // "constructor" resolva para um valor herdado de Object.prototype
    // (truthy, mas não um componente) e derrube o React ao renderizar.
    const Component = Object.prototype.hasOwnProperty.call(BLOCK_COMPONENTS, block.type)
      ? BLOCK_COMPONENTS[block.type]
      : undefined;
    if (!Component) return null;
    // Widget sem dados renderiza null; a célula vazia colapsa via
    // [data-block-id]:empty no styles.css (JSX sempre gera um elemento
    // aqui, então checar o retorno do componente não teria efeito).
    return (
      <div
        key={block.id}
        data-block-id={block.id}
        className={block.type === 'cover' ? 'rb-full' : (SIZE_CLASS[block.size] ?? 'rb-full')}
      >
        {instagramAbsent(block.type, snapshot) ? null : (
          <Component block={block} snapshot={snapshot} layoutPlatforms={platforms} />
        )}
      </div>
    );
  }

  return (
    <>
      <ReportFonts layout={layout} snapshot={snapshot} />
      <div
        className={`rb-grid rb-mode-${mode}${theme.themeClass ? ` ${theme.themeClass}` : ''}`}
        style={theme.vars as CSSProperties}
      >
        {/* Seções sem wrapper (spec 2026-10-28 seções §Rendering): título e blocos são
            filhos diretos do mesmo .rb-grid, então a fronteira de seção no meio de uma
            linha empacota igual à lista plana, e o legado (toda seção com hideHeader)
            sai com o DOM de antes. View e print têm a mesma regra de omissão. */}
        {sections.flatMap((section) => {
          if (!sectionVisibleInView(section, snapshot)) return [];
          const showHeading =
            section.kind !== 'general' && section.marker.config?.hideHeader !== true;
          return [
            showHeading ? (
              <PlatformSectionHeading
                key={`section:${section.marker.id}`}
                section={section}
                snapshot={snapshot}
              />
            ) : null,
            ...section.blocks.map(renderBlock),
          ];
        })}
      </div>
    </>
  );
}

// Catálogo do drawer "Adicionar widget": label pt-BR e categoria por tipo.
// Fonte única para o editor do CRM; a ordem dentro do array é a ordem do drawer.
import type { BlockType } from './types';
import { TIKTOK_KPI_LABELS_PT, type ReportPlatform } from './platform';

export type WidgetCategory =
  | 'Números'
  | 'Gráficos'
  | 'Audiência'
  | 'Conteúdo'
  | 'Texto'
  | 'Mídia'
  | 'Estrutura';

export const WIDGET_CATEGORIES: readonly WidgetCategory[] = [
  'Números',
  'Gráficos',
  'Audiência',
  'Conteúdo',
  'Texto',
  'Mídia',
  'Estrutura',
];

export interface WidgetCatalogEntry {
  type: BlockType;
  label: string;
  category: WidgetCategory;
  /** Plataforma do dado (= blockPlatform(type)); null = neutro (texto, mídia,
   * estrutura), disponível em qualquer relatório. */
  platform: ReportPlatform | null;
}

export const WIDGET_CATALOG: readonly WidgetCatalogEntry[] = [
  {
    type: 'kpi_followers_gained',
    label: 'Novos seguidores',
    category: 'Números',
    platform: 'instagram',
  },
  {
    type: 'kpi_follows',
    label: 'Seguidores conquistados',
    category: 'Números',
    platform: 'instagram',
  },
  {
    type: 'kpi_followers_total',
    label: 'Seguidores totais',
    category: 'Números',
    platform: 'instagram',
  },
  { type: 'kpi_reach', label: 'Alcance', category: 'Números', platform: 'instagram' },
  { type: 'kpi_views', label: 'Visualizações', category: 'Números', platform: 'instagram' },
  {
    type: 'kpi_engagement_rate',
    label: 'Taxa de engajamento',
    category: 'Números',
    platform: 'instagram',
  },
  { type: 'kpi_saves', label: 'Salvamentos', category: 'Números', platform: 'instagram' },
  { type: 'kpi_posts_count', label: 'Publicações', category: 'Números', platform: 'instagram' },
  {
    type: 'kpi_profile_views',
    label: 'Visitas ao perfil',
    category: 'Números',
    platform: 'instagram',
  },
  {
    type: 'kpi_website_clicks',
    label: 'Cliques no link',
    category: 'Números',
    platform: 'instagram',
  },
  {
    type: 'chart_followers',
    label: 'Evolução de seguidores',
    category: 'Gráficos',
    platform: 'instagram',
  },
  {
    type: 'chart_formats',
    label: 'Desempenho por formato',
    category: 'Gráficos',
    platform: 'instagram',
  },
  {
    type: 'chart_best_times',
    label: 'Melhores horários',
    category: 'Gráficos',
    platform: 'instagram',
  },
  { type: 'audience_gender', label: 'Gênero', category: 'Audiência', platform: 'instagram' },
  { type: 'audience_age', label: 'Faixa etária', category: 'Audiência', platform: 'instagram' },
  { type: 'audience_cities', label: 'Cidades', category: 'Audiência', platform: 'instagram' },
  { type: 'audience_countries', label: 'Países', category: 'Audiência', platform: 'instagram' },
  { type: 'top_posts', label: 'Top publicações', category: 'Conteúdo', platform: 'instagram' },
  { type: 'post_list', label: 'Lista de publicações', category: 'Conteúdo', platform: 'instagram' },
  {
    type: 'tags_table',
    label: 'Performance por tópico',
    category: 'Conteúdo',
    platform: 'instagram',
  },
  // TikTok (spec 2026-10-28 §B2): o drawer filtra por platform.
  {
    type: 'tiktok_kpi_followers_gained',
    label: TIKTOK_KPI_LABELS_PT.followers_gained,
    category: 'Números',
    platform: 'tiktok',
  },
  {
    type: 'tiktok_kpi_followers_total',
    label: TIKTOK_KPI_LABELS_PT.followers_total,
    category: 'Números',
    platform: 'tiktok',
  },
  {
    type: 'tiktok_kpi_views',
    label: TIKTOK_KPI_LABELS_PT.views,
    category: 'Números',
    platform: 'tiktok',
  },
  {
    type: 'tiktok_kpi_engagement_rate',
    label: TIKTOK_KPI_LABELS_PT.engagement_rate,
    category: 'Números',
    platform: 'tiktok',
  },
  {
    type: 'tiktok_kpi_likes',
    label: TIKTOK_KPI_LABELS_PT.likes,
    category: 'Números',
    platform: 'tiktok',
  },
  {
    type: 'tiktok_kpi_comments',
    label: TIKTOK_KPI_LABELS_PT.comments,
    category: 'Números',
    platform: 'tiktok',
  },
  {
    type: 'tiktok_kpi_shares',
    label: TIKTOK_KPI_LABELS_PT.shares,
    category: 'Números',
    platform: 'tiktok',
  },
  {
    type: 'tiktok_kpi_posts_count',
    label: TIKTOK_KPI_LABELS_PT.posts_count,
    category: 'Números',
    platform: 'tiktok',
  },
  {
    type: 'tiktok_kpi_likes_total',
    label: TIKTOK_KPI_LABELS_PT.likes_total,
    category: 'Números',
    platform: 'tiktok',
  },
  {
    type: 'tiktok_chart_followers',
    label: 'Crescimento de seguidores',
    category: 'Gráficos',
    platform: 'tiktok',
  },
  {
    type: 'tiktok_chart_best_times',
    label: 'Melhor horário para postar',
    category: 'Gráficos',
    platform: 'tiktok',
  },
  {
    type: 'tiktok_top_posts',
    label: 'Vídeos em destaque',
    category: 'Conteúdo',
    platform: 'tiktok',
  },
  { type: 'tiktok_post_list', label: 'Lista de vídeos', category: 'Conteúdo', platform: 'tiktok' },
  { type: 'text', label: 'Texto livre', category: 'Texto', platform: null },
  { type: 'ai_summary', label: 'Resumo do mês', category: 'Texto', platform: null },
  { type: 'ai_recommendations', label: 'Recomendações', category: 'Texto', platform: null },
  { type: 'ai_goals', label: 'Metas', category: 'Texto', platform: null },
  { type: 'image', label: 'Imagem', category: 'Mídia', platform: null },
  { type: 'cover', label: 'Capa', category: 'Estrutura', platform: null },
  // "Subtítulo": a seção (por plataforma) é o capítulo; o section_header fica dentro dela.
  { type: 'section_header', label: 'Subtítulo', category: 'Estrutura', platform: null },
  { type: 'divider', label: 'Divisor de página', category: 'Estrutura', platform: null },
];

// Catálogo do drawer "Adicionar widget": label pt-BR e categoria por tipo.
// Fonte única para o editor do CRM; a ordem dentro do array é a ordem do drawer.
import type { BlockType } from './types';

export type WidgetCategory =
  | 'Números'
  | 'Gráficos'
  | 'Audiência'
  | 'Conteúdo'
  | 'Texto'
  | 'Estrutura';

export const WIDGET_CATEGORIES: readonly WidgetCategory[] = [
  'Números',
  'Gráficos',
  'Audiência',
  'Conteúdo',
  'Texto',
  'Estrutura',
];

export interface WidgetCatalogEntry {
  type: BlockType;
  label: string;
  category: WidgetCategory;
}

export const WIDGET_CATALOG: readonly WidgetCatalogEntry[] = [
  { type: 'kpi_followers_gained', label: 'Novos seguidores', category: 'Números' },
  { type: 'kpi_followers_total', label: 'Seguidores totais', category: 'Números' },
  { type: 'kpi_reach', label: 'Alcance', category: 'Números' },
  { type: 'kpi_engagement_rate', label: 'Taxa de engajamento', category: 'Números' },
  { type: 'kpi_saves', label: 'Salvamentos', category: 'Números' },
  { type: 'kpi_posts_count', label: 'Publicações', category: 'Números' },
  { type: 'kpi_profile_views', label: 'Visitas ao perfil', category: 'Números' },
  { type: 'kpi_website_clicks', label: 'Cliques no link', category: 'Números' },
  { type: 'chart_followers', label: 'Evolução de seguidores', category: 'Gráficos' },
  { type: 'chart_formats', label: 'Desempenho por formato', category: 'Gráficos' },
  { type: 'chart_best_times', label: 'Melhores horários', category: 'Gráficos' },
  { type: 'audience_gender', label: 'Gênero', category: 'Audiência' },
  { type: 'audience_age', label: 'Faixa etária', category: 'Audiência' },
  { type: 'audience_cities', label: 'Cidades', category: 'Audiência' },
  { type: 'audience_countries', label: 'Países', category: 'Audiência' },
  { type: 'top_posts', label: 'Top publicações', category: 'Conteúdo' },
  { type: 'post_list', label: 'Lista de publicações', category: 'Conteúdo' },
  { type: 'tags_table', label: 'Performance por tópico', category: 'Conteúdo' },
  { type: 'text', label: 'Texto livre', category: 'Texto' },
  { type: 'ai_summary', label: 'Resumo do mês', category: 'Texto' },
  { type: 'ai_recommendations', label: 'Recomendações', category: 'Texto' },
  { type: 'ai_goals', label: 'Metas', category: 'Texto' },
  { type: 'cover', label: 'Capa', category: 'Estrutura' },
  { type: 'section_header', label: 'Cabeçalho de seção', category: 'Estrutura' },
  { type: 'divider', label: 'Divisor de página', category: 'Estrutura' },
];

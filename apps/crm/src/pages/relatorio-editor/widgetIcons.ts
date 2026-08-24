// Ícone por tipo de bloco, usado no painel de camadas e no drawer de widgets.
// Mora no CRM (não no pacote compartilhado): o Hub/print não usa catálogo e o
// pacote fica sem dependência de ícones. Tipo desconhecido cai num ícone
// genérico (mesma tolerância dos renderers).
import {
  Bookmark,
  ChartColumn,
  ChartLine,
  ChartPie,
  Clock,
  Eye,
  Globe,
  Heading,
  Heart,
  Image,
  Images,
  Lightbulb,
  List,
  MapPin,
  MousePointerClick,
  Play,
  SeparatorHorizontal,
  Shapes,
  Sparkles,
  Tags,
  Target,
  Trophy,
  Type,
  UserPlus,
  Users,
  UserSearch,
  type LucideIcon,
} from 'lucide-react';
import type { BlockType } from '@mesaas/report-blocks/types';

export const WIDGET_ICONS: Record<BlockType, LucideIcon> = {
  cover: Image,
  section_header: Heading,
  divider: SeparatorHorizontal,
  text: Type,
  ai_summary: Sparkles,
  ai_recommendations: Lightbulb,
  ai_goals: Target,
  kpi_followers_gained: UserPlus,
  kpi_followers_total: Users,
  kpi_reach: Eye,
  // Play espelha o card "Visualizações" da página de Analytics.
  kpi_views: Play,
  kpi_engagement_rate: Heart,
  kpi_saves: Bookmark,
  kpi_posts_count: Images,
  kpi_profile_views: UserSearch,
  kpi_website_clicks: MousePointerClick,
  chart_followers: ChartLine,
  chart_formats: ChartColumn,
  chart_best_times: Clock,
  audience_gender: ChartPie,
  audience_age: ChartColumn,
  audience_cities: MapPin,
  audience_countries: Globe,
  top_posts: Trophy,
  post_list: List,
  tags_table: Tags,
};

export const FALLBACK_WIDGET_ICON: LucideIcon = Shapes;

export function widgetIcon(type: string): LucideIcon {
  return (WIDGET_ICONS as Record<string, LucideIcon>)[type] ?? FALLBACK_WIDGET_ICON;
}

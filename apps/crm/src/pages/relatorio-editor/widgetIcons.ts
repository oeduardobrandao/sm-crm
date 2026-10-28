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
  FileImage,
  Globe,
  Heading,
  Heart,
  Image,
  Images,
  Lightbulb,
  List,
  MapPin,
  MessageCircle,
  MousePointerClick,
  Play,
  SeparatorHorizontal,
  Shapes,
  Share2,
  Sparkles,
  Tags,
  Target,
  Trophy,
  Type,
  UserPlus,
  UserRoundPlus,
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
  kpi_follows: UserRoundPlus,
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
  image: FileImage,
  // TikTok: mesmos ícones dos equivalentes do Instagram (B4 refina o catálogo).
  tiktok_kpi_followers_total: Users,
  tiktok_kpi_followers_gained: UserPlus,
  tiktok_kpi_views: Play,
  tiktok_kpi_engagement_rate: Heart,
  tiktok_kpi_likes: Heart,
  tiktok_kpi_comments: MessageCircle,
  tiktok_kpi_shares: Share2,
  tiktok_kpi_posts_count: Images,
  tiktok_kpi_likes_total: Heart,
  tiktok_chart_followers: ChartLine,
  tiktok_chart_best_times: Clock,
  tiktok_top_posts: Trophy,
  tiktok_post_list: List,
};

export const FALLBACK_WIDGET_ICON: LucideIcon = Shapes;

export function widgetIcon(type: string): LucideIcon {
  return (WIDGET_ICONS as Record<string, LucideIcon>)[type] ?? FALLBACK_WIDGET_ICON;
}

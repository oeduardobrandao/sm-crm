export interface KpiValue {
  id: string;
  value: number;
  unit: "count" | "pct";
}

export interface KpiDeltas {
  followers_pct_change?: number;
  engagement_pct_change?: number;
  reach_pct_change?: number;
  saves_pct_change?: number;
  profile_views_pct_change?: number;
  website_clicks_pct_change?: number;
}

export interface TopPost {
  type: "reel" | "carousel" | "image";
  reach: number;
  engagement: number;
  saves: number;
  likes: number;
  comments: number;
  caption_preview: string;
  date?: string;
  thumbnail_base64?: string | null;
  permalink?: string;
}

export interface ContentBreakdown {
  reels?: { count: number; avg_reach: number; avg_engagement: number };
  carousels?: { count: number; avg_reach: number; avg_engagement: number };
  images?: { count: number; avg_reach: number; avg_engagement: number };
}

export interface AudienceData {
  gender_split: { female: number; male: number };
  top_cities: { name: string; pct: number }[];
  top_age_ranges: { range: string; pct: number }[];
  top_countries?: { name: string; pct: number }[];
}

export interface BestTimeSlot {
  day: string;
  hour: number;
  avg_engagement: number;
}

export interface TagPerformance {
  tag: string;
  avg_engagement: number;
  avg_reach: number;
  count: number;
}

export interface FollowerTrendPoint {
  date: string;
  count: number;
}

export interface ReportData {
  handle: string;
  specialty: string;
  period: string;
  kpis: Record<string, KpiValue>;
  kpi_deltas: KpiDeltas;
  top_posts: TopPost[];
  content_breakdown: ContentBreakdown;
  audience: AudienceData | null;
  best_times: BestTimeSlot[];
  tags_performance: TagPerformance[];
  follower_trend: FollowerTrendPoint[];
}

export interface Recommendation {
  title: string;
  description: string;
  priority: "high" | "medium" | "low";
  based_on_metric?: string;
}

export interface SuggestedGoal {
  metric: string;
  target: string;
  rationale: string;
}

export interface AIOutput {
  executive_summary: string;
  detailed_analysis: string;
  recommendations: Recommendation[];
  suggested_goals: SuggestedGoal[];
}

export interface WorkspaceBranding {
  logo_base64: string | null;
  workspace_name: string;
  primary_color: string;
  secondary_color: string;
  accent_color: string;
  font_family: string;
  theme: "dark" | "light";
}

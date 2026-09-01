export interface KpiValue {
  id: string;
  value: number;
  unit: "count" | "pct";
  prev?: number | null; // previous month's raw value, same unit
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
  /** Views do post. Opcional e aditivo: só o pipeline de blocos preenche; o
   * gerador legado nunca seta e segue byte-idêntico. */
  views?: number;
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

/** Sinalização de outlier do mês ANTERIOR (report-docs/snapshot.ts
 * `comparison`), pra narrativa não tratar quedas pós-viral como fracasso.
 * `note` só existe quando `prev_outlier` é true -- uma instrução curta em
 * pt-BR embutida nos DADOS (o modelo já lê tudo isto como JSON no
 * userPrompt; não depende do system prompt saber sobre este campo). */
export interface ReportDataComparison {
  prev_outlier: boolean;
  prev_top_share: number;
  note?: string;
}

export interface ReportData {
  handle: string;
  specialty: string;
  period: string;
  report_month: string; // "YYYY-MM" — drives previous-month labels
  kpis: Record<string, KpiValue>;
  kpi_deltas: KpiDeltas;
  top_posts: TopPost[];
  content_breakdown: ContentBreakdown;
  audience: AudienceData | null;
  best_times: BestTimeSlot[];
  tags_performance: TagPerformance[];
  follower_trend: FollowerTrendPoint[];
  /** Opcional e aditivo: só o pipeline de blocos preenche (ai-input.ts); o
   * gerador legado nunca seta e segue byte-idêntico. null = mês anterior
   * sem outlier detectável (sem posts, ou nenhum post dominante). */
  comparison?: ReportDataComparison | null;
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
  splash_base64: string | null;
  workspace_name: string;
  accent_color: string;
}

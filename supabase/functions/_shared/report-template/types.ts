import type { TikTokKpiId } from "../tiktok-analytics/kpis.ts";
import type { GbpKpiId, GbpSurface } from "../gbp-analytics/kpis.ts";

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
  /** Opcional e aditivo (spec 2026-10-28 §B3): só o pipeline de blocos seta, e só com
   * `false` (relatório sem Instagram). Ausente = Instagram presente, o prompt de hoje. */
  instagram_connected?: boolean;
  /** Opcional e aditivo: seção TikTok do relatório de blocos. Ausente = sem TikTok. */
  tiktok?: ReportDataTikTok;
  /** Opcional e aditivo: seção Google Meu Negócio do relatório de blocos. Ausente = sem GMN. */
  google?: ReportDataGoogle;
}

/** Dados do Google Meu Negócio para a IA (spec 2026-11-04-gmn-report-section). Nunca nome de
 * quem avaliou nem texto de avaliação: só números, superfícies e termos de busca. */
export interface ReportDataGoogle {
  /** Quantas unidades (perfis) somam os números. */
  units: number;
  /** Período coberto (YYYY-MM-DD) e quantos dias logo antes servem de comparação. null = sem dado. */
  window: { start: string; end: string; compared_with_days: number } | null;
  /** null = sem dados. avg_rating é nota de 1 a 5. */
  kpis: Record<GbpKpiId, number | null>;
  /** Valor do período anterior (mesmo número de dias logo antes), só onde existe. */
  kpis_previous_period: Partial<Record<GbpKpiId, number>>;
  /** Participação (%) de cada superfície nas visualizações do perfil. */
  surfaces: { surface: GbpSurface; pct: number }[];
  /** Até 5 termos. `at_most` = o Google só diz "menos de N pessoas". */
  top_keywords: { keyword: string; people: number | null; at_most: number | null }[];
  /** Estrelas das avaliações guardadas (últimas 200 por unidade). */
  rating_distribution: Record<"1" | "2" | "3" | "4" | "5", number> | null;
}

/** Dados TikTok para a IA. Só o que a Display API dá: sem alcance, salvamentos nem audiência. */
export interface ReportDataTikTok {
  handle: string;
  /** null = sem dados. engagement_rate é % por visualização. */
  kpis: Record<TikTokKpiId, number | null>;
  /** Valor do mês anterior, só dos KPIs que têm comparação. As somas (visualizações, curtidas,
   * comentários, compartilhamentos) nunca aparecem aqui. */
  kpis_previous_month: Partial<Record<TikTokKpiId, number>>;
  top_videos: {
    caption: string;
    views: number;
    likes: number;
    comments: number;
    shares: number;
    date: string | null;
  }[];
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

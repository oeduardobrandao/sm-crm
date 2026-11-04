// Adapter snapshot -> ReportData, o shape que buildAIPrompt já valida e usa.
// KPIs null ficam FORA (o prompt proíbe inventar números; 0 falso seria pior).
import type {
  AIOutput, KpiValue, ReportData, ReportDataComparison, ReportDataGoogle, ReportDataTikTok,
} from "../report-template/types.ts";
import { TIKTOK_KPI_IDS, type TikTokKpiId } from "../tiktok-analytics/kpis.ts";
import { GBP_KPI_IDS, type GbpKpiId } from "../gbp-analytics/kpis.ts";
import type { GoogleReportSnapshot, ReportDocSnapshot, TikTokReportSnapshot } from "./snapshot.ts";
import type { SectionPlatform } from "./sections.ts";

// Instrução curta em pt-BR, embutida no payload de DADOS que vai pro modelo
// (buildAIPrompt serializa `promptData` inteiro como JSON no userPrompt) --
// só quando o mês anterior teve um post fora da curva (spec §4.3), pra
// parar de tratar a queda pós-viral como fracasso de conteúdo. Sem em-dash
// (regra da casa pra texto de usuário): "." e ";" no lugar.
function comparisonNote(prevTopSharePct: number): string {
  return `O mês anterior teve um post fora da curva com ${prevTopSharePct}% do total; ` +
    "contextualize quedas em vez de tratá-las como fracasso.";
}

function buildComparison(
  comparison: ReportDocSnapshot["comparison"],
): ReportDataComparison | null {
  if (!comparison) return null;
  const { prev_outlier, prev_top_share } = comparison;
  if (!prev_outlier) return { prev_outlier, prev_top_share };
  const pct = Math.round(prev_top_share * 100);
  return { prev_outlier, prev_top_share, note: comparisonNote(pct) };
}

/** KPIs TikTok que a IA pode comparar com o mês anterior (spec §A3). As somas dos vídeos
 * (visualizações, curtidas, comentários, compartilhamentos, curtidas totais) nunca entram, mesmo
 * que um snapshot traga prev para elas. */
const TIKTOK_COMPARABLE: readonly TikTokKpiId[] = [
  "followers_total", "followers_gained", "engagement_rate", "posts_count",
];

function tiktokToReportData(tt: TikTokReportSnapshot): ReportDataTikTok {
  const kpis = {} as Record<TikTokKpiId, number | null>;
  const prev: Partial<Record<TikTokKpiId, number>> = {};
  for (const [id, entry] of Object.entries(tt.kpis) as [TikTokKpiId, TikTokReportSnapshot["kpis"][TikTokKpiId]][]) {
    kpis[id] = entry.value;
    if (TIKTOK_COMPARABLE.includes(id) && entry.value !== null && entry.prev !== null) prev[id] = entry.prev;
  }
  return {
    handle: tt.account.handle,
    kpis,
    kpis_previous_month: prev,
    top_videos: tt.top_posts.map((v) => ({
      caption: v.caption_preview,
      views: v.views,
      likes: v.likes,
      comments: v.comments,
      shares: v.shares,
      date: v.date,
    })),
  };
}

const DAY_MS = 86_400_000;
const GOOGLE_TOP_KEYWORDS = 5;

function googleToReportData(g: GoogleReportSnapshot): ReportDataGoogle {
  const kpis = {} as Record<GbpKpiId, number | null>;
  const prev: Partial<Record<GbpKpiId, number>> = {};
  for (const id of GBP_KPI_IDS) {
    const e = g.kpis[id];
    kpis[id] = e?.value ?? null;
    if (e && e.value !== null && e.prev !== null) prev[id] = e.prev;
  }
  const w = g.window;
  return {
    units: g.units.length,
    window: w
      ? {
        start: w.start,
        end: w.end,
        compared_with_days: Math.round((Date.parse(w.prevEnd) - Date.parse(w.prevStart)) / DAY_MS) + 1,
      }
      : null,
    kpis,
    kpis_previous_period: prev,
    surfaces: g.surfaces.map((s) => ({ surface: s.surface, pct: s.pct })),
    top_keywords: g.keywords.rows.slice(0, GOOGLE_TOP_KEYWORDS).map((k) => ({
      keyword: k.keyword,
      people: k.value,
      at_most: k.threshold,
    })),
    rating_distribution: g.rating_distribution ? { ...g.rating_distribution.counts } : null,
  };
}

/** `platforms` = plataformas do relatório (a escolha do dialog): a narrativa cobre só essas,
 * mesmo com dados carregados das outras. Ausente = todas as presentes no snapshot. As chaves
 * `tiktok` e `instagram_connected` só existem quando mudam algo: o caminho só Instagram
 * produz o mesmo objeto (e o mesmo prompt) de antes do TikTok. */
export function snapshotToReportData(
  snap: ReportDocSnapshot,
  platforms?: readonly SectionPlatform[],
): ReportData {
  const kpis: Record<string, KpiValue> = {};
  for (const [id, entry] of Object.entries(snap.kpis)) {
    if (entry.value === null) continue;
    kpis[id] = { id, value: entry.value, unit: entry.unit, prev: entry.prev };
  }
  const data: ReportData = {
    handle: snap.account.handle,
    specialty: snap.account.specialty,
    period: snap.period.label,
    report_month: snap.period.month,
    kpis,
    kpi_deltas: {},
    comparison: buildComparison(snap.comparison),
    top_posts: snap.top_posts.map((post) => ({
      type: post.type,
      views: post.views,
      reach: post.reach,
      engagement: post.likes + post.comments + post.saves + post.shares,
      saves: post.saves,
      likes: post.likes,
      comments: post.comments,
      caption_preview: post.caption_preview,
      date: post.date ?? undefined,
      permalink: post.permalink ?? undefined,
    })),
    content_breakdown: snap.content_breakdown,
    audience: snap.audience,
    best_times: snap.best_times,
    tags_performance: snap.tags_performance,
    follower_trend: snap.follower_trend,
  };
  const instagram = snap.instagram_connected !== false && (!platforms || platforms.includes("instagram"));
  const tiktok = snap.tiktok && (!platforms || platforms.includes("tiktok")) ? snap.tiktok : null;
  if (!instagram) data.instagram_connected = false;
  if (tiktok) data.tiktok = tiktokToReportData(tiktok);
  const google = snap.google && (!platforms || platforms.includes("google")) ? snap.google : null;
  if (google) data.google = googleToReportData(google);
  return data;
}

const GOAL_PREFIXES = {
  tiktok: { prefix: "tiktok_", ids: TIKTOK_KPI_IDS as readonly string[] },
  google: { prefix: "gbp_", ids: GBP_KPI_IDS as readonly string[] },
} as const;

/** Narrativa de UMA plataforma sem Instagram: id dela sem o prefixo ("views", "website_clicks")
 * em meta ou recomendação ganha o prefixo ("tiktok_", "gbp_"), para o rótulo sair o dessa
 * plataforma e não o do Instagram de mesmo id. Com duas plataformas sem Instagram, o prompt já
 * pede os prefixos e nada é reescrito (um id cru seria ambíguo). */
export function prefixGoalMetrics(output: AIOutput, platform: "tiktok" | "google"): AIOutput {
  const { prefix, ids } = GOAL_PREFIXES[platform];
  return {
    ...output,
    recommendations: output.recommendations.map((r) =>
      r.based_on_metric !== undefined && ids.includes(r.based_on_metric)
        ? { ...r, based_on_metric: `${prefix}${r.based_on_metric}` }
        : r
    ),
    suggested_goals: output.suggested_goals.map((g) =>
      ids.includes(g.metric) ? { ...g, metric: `${prefix}${g.metric}` } : g
    ),
  };
}

/** Narrativa só TikTok (nome de antes do Google Meu Negócio). */
export function prefixTikTokGoalMetrics(output: AIOutput): AIOutput {
  return prefixGoalMetrics(output, "tiktok");
}

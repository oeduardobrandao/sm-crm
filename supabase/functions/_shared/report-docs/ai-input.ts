// Adapter snapshot -> ReportData, o shape que buildAIPrompt já valida e usa.
// KPIs null ficam FORA (o prompt proíbe inventar números; 0 falso seria pior).
import type { KpiValue, ReportData, ReportDataComparison } from "../report-template/types.ts";
import type { ReportDocSnapshot } from "./snapshot.ts";

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

export function snapshotToReportData(snap: ReportDocSnapshot): ReportData {
  const kpis: Record<string, KpiValue> = {};
  for (const [id, entry] of Object.entries(snap.kpis)) {
    if (entry.value === null) continue;
    kpis[id] = { id, value: entry.value, unit: entry.unit, prev: entry.prev };
  }
  return {
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
}

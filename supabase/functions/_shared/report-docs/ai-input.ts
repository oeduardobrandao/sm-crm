// Adapter snapshot -> ReportData, o shape que buildAIPrompt já valida e usa.
// KPIs null ficam FORA (o prompt proíbe inventar números; 0 falso seria pior).
import type { KpiValue, ReportData } from "../report-template/types.ts";
import type { ReportDocSnapshot } from "./snapshot.ts";

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

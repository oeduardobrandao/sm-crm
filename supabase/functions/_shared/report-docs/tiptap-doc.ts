// Construtores de JSON TipTap para os blocos de texto. Só nós (paragraph,
// heading, text com marks) que o renderer do pacote (tiptapToHtml) e o editor
// StarterKit do PR 2 entendem.
import type { AIOutput } from "../report-template/types.ts";
import type { ReportLayout } from "./layout.ts";
import type { TikTokKpiId } from "../tiktok-analytics/kpis.ts";
import { KPI_LABELS_PT, type KpiEntry, type ReportKpiId } from "./kpis.ts";
import { TIKTOK_KPI_LABELS_PT } from "./tiktok-kpi-labels.ts";

const p = (text: string) => ({
  type: "paragraph",
  content: text ? [{ type: "text", text }] : [],
});
const h3 = (text: string) => ({
  type: "heading",
  attrs: { level: 3 },
  content: [{ type: "text", text }],
});

export function textDoc(paragraphs: string[]): unknown {
  return { type: "doc", content: paragraphs.map(p) };
}

export function aiSummaryDoc(ai: AIOutput): unknown {
  return textDoc([ai.executive_summary]);
}

export function aiRecommendationsDoc(ai: AIOutput): unknown {
  const content: unknown[] = [];
  for (const rec of ai.recommendations) {
    content.push(h3(rec.title));
    content.push(p(rec.description));
  }
  return { type: "doc", content };
}

const fmt = new Intl.NumberFormat("pt-BR");

// O prompt pede "metric_id from the provided data", então a IA devolve ids
// crus (reach, followers_gained). O tratamento é AQUI, na renderização: id
// conhecido vira o label pt-BR; texto livre da IA passa como veio. Target
// só-dígitos ganha formato pt-BR ("7000" -> "7.000"); percentual com ponto
// vira vírgula ("11.5%" -> "11,5%").
// Metas TikTok chegam como "tiktok_<kpi>" (o prompt pede o prefixo para não confundir com o
// KPI do Instagram de mesmo id) e ganham " no TikTok" no rótulo.
function metricLabel(metric: string): string {
  if (metric.startsWith("tiktok_")) {
    const tt = (TIKTOK_KPI_LABELS_PT as Record<string, string>)[metric.slice("tiktok_".length)];
    return tt ? `${tt} no TikTok` : metric;
  }
  return (KPI_LABELS_PT as Record<string, string>)[metric] ?? metric;
}

function goalHeading(metric: string, target: string): string {
  const label = metricLabel(metric);
  const t = target.trim();
  const formatted = /^\d+$/.test(t)
    ? fmt.format(Number(t))
    : /^\d+([.,]\d+)?%$/.test(t)
    ? t.replace(".", ",")
    : target;
  return `${label}: ${formatted}`;
}

export function aiGoalsDoc(ai: AIOutput): unknown {
  const content: unknown[] = [];
  for (const goal of ai.suggested_goals) {
    content.push(h3(goalHeading(goal.metric, goal.target)));
    content.push(p(goal.rationale));
  }
  return { type: "doc", content };
}

/** Plataformas do resumo de fallback. Ausente = só Instagram (o texto de sempre). */
export interface FallbackPlatforms {
  instagram: boolean;
  tiktok: Record<TikTokKpiId, KpiEntry> | null;
}

function tiktokSummaryParts(kpis: Record<TikTokKpiId, KpiEntry>): string[] {
  const parts: string[] = [];
  const posts = kpis.posts_count.value;
  if (posts !== null) {
    parts.push(posts === 1 ? "1 vídeo publicado" : `${fmt.format(posts)} vídeos publicados`);
  }
  if (kpis.views.value !== null) parts.push(`${fmt.format(kpis.views.value)} visualizações`);
  if (kpis.followers_gained.value !== null) {
    const g = kpis.followers_gained.value;
    parts.push(g >= 0 ? `${fmt.format(g)} novos seguidores` : `${fmt.format(g)} seguidores no saldo do mês`);
  }
  if (kpis.engagement_rate.value !== null) {
    parts.push(`engajamento por visualização de ${kpis.engagement_rate.value.toFixed(1).replace(".", ",")}%`);
  }
  return parts;
}

export function fallbackSummaryParagraphs(
  kpis: Record<ReportKpiId, KpiEntry>,
  monthLabel: string,
  platforms?: FallbackPlatforms,
): string[] {
  const tiktok = platforms?.tiktok ?? null;
  if (platforms && !platforms.instagram && tiktok) {
    const parts = tiktokSummaryParts(tiktok);
    return [`Resumo de ${monthLabel} no TikTok${parts.length > 0 ? `: ${parts.join(", ")}.` : "."}`];
  }
  const out = [instagramSummary(kpis, monthLabel)];
  if (tiktok) {
    const parts = tiktokSummaryParts(tiktok);
    if (parts.length > 0) out.push(`No TikTok: ${parts.join(", ")}.`);
  }
  return out;
}

function instagramSummary(kpis: Record<ReportKpiId, KpiEntry>, monthLabel: string): string {
  const parts: string[] = [];
  if (kpis.posts_count.value !== null) {
    parts.push(`${fmt.format(kpis.posts_count.value)} publicações no período`);
  }
  if (kpis.reach.value !== null) {
    parts.push(`alcance total de ${fmt.format(kpis.reach.value)} contas`);
  }
  if (kpis.followers_gained.value !== null) {
    const g = kpis.followers_gained.value;
    parts.push(g >= 0 ? `${fmt.format(g)} novos seguidores` : `${fmt.format(g)} seguidores no saldo do mês`);
  }
  if (kpis.engagement_rate.value !== null) {
    parts.push(`taxa de engajamento de ${kpis.engagement_rate.value.toFixed(1).replace(".", ",")}%`);
  }
  const body = parts.length > 0 ? `: ${parts.join(", ")}.` : ".";
  return `Resumo de ${monthLabel}${body}`;
}

export interface AiBlockDocs {
  summary: unknown;
  recommendations: unknown | null;
  goals: unknown | null;
}

/** Preenche o text dos blocos ai_*; blocos de IA sem conteúdo são removidos. */
export function fillAiBlocks(layout: ReportLayout, docs: AiBlockDocs): ReportLayout {
  const blocks = layout.blocks
    .filter((b) => {
      if (b.type === "ai_recommendations" && docs.recommendations === null) return false;
      if (b.type === "ai_goals" && docs.goals === null) return false;
      return true;
    })
    .map((b) => {
      if (b.type === "ai_summary") return { ...b, text: docs.summary };
      if (b.type === "ai_recommendations") return { ...b, text: docs.recommendations! };
      if (b.type === "ai_goals") return { ...b, text: docs.goals! };
      return b;
    });
  return { ...layout, blocks };
}

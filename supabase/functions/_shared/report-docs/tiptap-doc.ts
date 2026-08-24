// Construtores de JSON TipTap para os blocos de texto. Só nós (paragraph,
// heading, text com marks) que o renderer do pacote (tiptapToHtml) e o editor
// StarterKit do PR 2 entendem.
import type { AIOutput } from "../report-template/types.ts";
import type { ReportLayout } from "./layout.ts";
import { KPI_LABELS_PT, type KpiEntry, type ReportKpiId } from "./kpis.ts";

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
// só-dígitos ganha formato pt-BR ("7000" -> "7.000").
function goalHeading(metric: string, target: string): string {
  const label = (KPI_LABELS_PT as Record<string, string>)[metric] ?? metric;
  const t = target.trim();
  const formatted = /^\d+$/.test(t) ? fmt.format(Number(t)) : target;
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

export function fallbackSummaryParagraphs(
  kpis: Record<ReportKpiId, KpiEntry>,
  monthLabel: string,
): string[] {
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
  return [`Resumo de ${monthLabel}${body}`];
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

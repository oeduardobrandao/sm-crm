// Construtores de JSON TipTap para os blocos de texto. Só nós (paragraph,
// heading, text com marks) que o renderer do pacote (tiptapToHtml) e o editor
// StarterKit do PR 2 entendem.
import type { AIOutput } from "../report-template/types.ts";
import type { ReportLayout } from "./layout.ts";
import type { TikTokKpiId } from "../tiktok-analytics/kpis.ts";
import type { KpiEntry, ReportKpiId } from "./kpis.ts";
import { type Lang, intlLocale } from "../i18n/lang.ts";
import { reportDocsText } from "../i18n/catalogs/report-docs.ts";
import type { GbpKpiId } from "../gbp-analytics/kpis.ts";
import type { GbpReportKpiEntry } from "./snapshot.ts";

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

const fmtFor = (lang: Lang) => new Intl.NumberFormat(intlLocale(lang));
/** One decimal, in the language's separator: 3.25 -> "3,3" (pt) / "3.3" (en). */
const pct1 = (v: number, lang: Lang) => (lang === "en" ? v.toFixed(1) : v.toFixed(1).replace(".", ","));

// O prompt pede "metric_id from the provided data", então a IA devolve ids
// crus (reach, followers_gained). O tratamento é AQUI, na renderização: id
// conhecido vira o label pt-BR; texto livre da IA passa como veio. Target
// só-dígitos ganha formato pt-BR ("7000" -> "7.000"); percentual com ponto
// vira vírgula ("11.5%" -> "11,5%").
// Metas TikTok chegam como "tiktok_<kpi>" (o prompt pede o prefixo para não confundir com o
// KPI do Instagram de mesmo id) e ganham " no TikTok" no rótulo.
function metricLabel(metric: string, lang: Lang): string {
  const t = reportDocsText(lang);
  if (metric.startsWith("tiktok_")) {
    const tt = t.kpiTikTok[metric.slice("tiktok_".length)];
    return tt ? t.onTikTok(tt) : metric;
  }
  // Metas do Google Meu Negócio chegam como "gbp_<kpi>" (mesma regra do TikTok).
  if (metric.startsWith("gbp_")) {
    const g = t.kpiGoogle[metric.slice("gbp_".length)];
    return g ? t.onGoogle(g) : metric;
  }
  return t.kpiInstagram[metric] ?? metric;
}

function goalHeading(metric: string, target: string, lang: Lang): string {
  const label = metricLabel(metric, lang);
  const t = target.trim();
  const formatted = /^\d+$/.test(t)
    ? fmtFor(lang).format(Number(t))
    : /^\d+([.,]\d+)?%$/.test(t)
    ? (lang === "en" ? t.replace(",", ".") : t.replace(".", ","))
    : target;
  return `${label}: ${formatted}`;
}

export function aiGoalsDoc(ai: AIOutput, lang: Lang): unknown {
  const content: unknown[] = [];
  for (const goal of ai.suggested_goals) {
    content.push(h3(goalHeading(goal.metric, goal.target, lang)));
    content.push(p(goal.rationale));
  }
  return { type: "doc", content };
}

/** Plataformas do resumo de fallback. Ausente = só Instagram (o texto de sempre). */
export interface FallbackPlatforms {
  instagram: boolean;
  tiktok: Record<TikTokKpiId, KpiEntry> | null;
  /** KPIs do Google Meu Negócio. Ausente/null = sem GMN na narrativa. */
  google?: Record<GbpKpiId, GbpReportKpiEntry> | null;
}

function googleSummaryParts(kpis: Record<GbpKpiId, GbpReportKpiEntry>, lang: Lang): string[] {
  const t = reportDocsText(lang);
  const fmt = fmtFor(lang);
  const parts: string[] = [];
  const add = (id: GbpKpiId, one: string, many: string) => {
    const v = kpis[id]?.value;
    if (v !== null && v !== undefined) parts.push(`${fmt.format(v)} ${v === 1 ? one : many}`);
  };
  add("profile_views", t.gbpProfileViewsOne, t.gbpProfileViewsMany);
  add("calls", t.gbpCallsOne, t.gbpCallsMany);
  add("directions", t.gbpDirectionsOne, t.gbpDirectionsMany);
  add("website_clicks", t.gbpWebsiteClicksOne, t.gbpWebsiteClicksMany);
  return parts;
}

function tiktokSummaryParts(kpis: Record<TikTokKpiId, KpiEntry>, lang: Lang): string[] {
  const t = reportDocsText(lang);
  const fmt = fmtFor(lang);
  const parts: string[] = [];
  const posts = kpis.posts_count.value;
  if (posts !== null) {
    parts.push(posts === 1 ? t.ttVideoOne : t.ttVideos(fmt.format(posts)));
  }
  if (kpis.views.value !== null) parts.push(t.ttViews(fmt.format(kpis.views.value)));
  if (kpis.followers_gained.value !== null) {
    const g = kpis.followers_gained.value;
    parts.push(g >= 0 ? t.gained(fmt.format(g)) : t.netChange(fmt.format(g)));
  }
  if (kpis.engagement_rate.value !== null) {
    parts.push(t.ttEngagement(pct1(kpis.engagement_rate.value, lang)));
  }
  return parts;
}

export function fallbackSummaryParagraphs(
  kpis: Record<ReportKpiId, KpiEntry>,
  monthLabel: string,
  lang: Lang,
  platforms?: FallbackPlatforms,
): string[] {
  const t = reportDocsText(lang);
  const tiktok = platforms?.tiktok ?? null;
  const google = platforms?.google ?? null;
  const out: string[] = [];
  if (platforms && !platforms.instagram && (tiktok || google)) {
    // Sem Instagram: a primeira plataforma presente abre o resumo; a outra entra depois.
    if (tiktok) {
      out.push(t.ttSummary(monthLabel, tiktokSummaryParts(tiktok, lang).join(", ")));
    } else {
      out.push(t.googleSummary(monthLabel, googleSummaryParts(google!, lang).join(", ")));
      return out;
    }
  } else {
    out.push(instagramSummary(kpis, monthLabel, lang));
    if (tiktok) {
      const parts = tiktokSummaryParts(tiktok, lang);
      if (parts.length > 0) out.push(t.ttAlso(parts.join(", ")));
    }
  }
  if (google) {
    const parts = googleSummaryParts(google, lang);
    if (parts.length > 0) out.push(t.googleAlso(parts.join(", ")));
  }
  return out;
}

function instagramSummary(kpis: Record<ReportKpiId, KpiEntry>, monthLabel: string, lang: Lang): string {
  const t = reportDocsText(lang);
  const fmt = fmtFor(lang);
  const parts: string[] = [];
  if (kpis.posts_count.value !== null) {
    parts.push(t.igPosts(fmt.format(kpis.posts_count.value)));
  }
  if (kpis.reach.value !== null) {
    parts.push(t.igReach(fmt.format(kpis.reach.value)));
  }
  if (kpis.followers_gained.value !== null) {
    const g = kpis.followers_gained.value;
    parts.push(g >= 0 ? t.gained(fmt.format(g)) : t.netChange(fmt.format(g)));
  }
  if (kpis.engagement_rate.value !== null) {
    parts.push(t.igEngagement(pct1(kpis.engagement_rate.value, lang)));
  }
  return t.igSummary(monthLabel, parts.join(", "));
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

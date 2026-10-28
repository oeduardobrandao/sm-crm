import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  aiGoalsDoc, aiRecommendationsDoc, fallbackSummaryParagraphs, fillAiBlocks, textDoc,
} from "./tiptap-doc.ts";
import { buildDefaultLayout } from "./default-layout.ts";
import type { AIOutput } from "../report-template/types.ts";

const ai: AIOutput = {
  executive_summary: "Resumo do mês.",
  detailed_analysis: "x".repeat(200),
  recommendations: [
    { title: "Postar mais reels", description: "Reels lideram alcance.", priority: "high" },
  ],
  suggested_goals: [{ metric: "alcance", target: "+10%", rationale: "tendência" }],
};

Deno.test("textDoc gera doc TipTap com um paragraph por string", () => {
  const doc = textDoc(["a", "b"]) as { type: string; content: unknown[] };
  assertEquals(doc.type, "doc");
  assertEquals(doc.content.length, 2);
});

Deno.test("aiGoalsDoc: id de KPI vira label pt-BR e target numérico formata; texto livre passa como veio", () => {
  const doc = aiGoalsDoc({
    ...ai,
    suggested_goals: [
      { metric: "reach", target: "7000", rationale: "r1" },
      { metric: "views", target: "60000", rationale: "r2" },
      { metric: "engagement_rate", target: "11.5%", rationale: "r3" },
      { metric: "alcance nos reels", target: "+10%", rationale: "r4" },
    ],
  }) as { content: { type: string; content: { text: string }[] }[] };
  const headings = doc.content
    .filter((n) => n.type === "heading")
    .map((n) => n.content[0].text);
  assertEquals(headings, [
    "Alcance acumulado: 7.000",
    "Visualizações: 60.000",
    "Taxa de engajamento: 11,5%",
    "alcance nos reels: +10%",
  ]);
});

Deno.test("aiRecommendationsDoc: heading + paragraph por recomendação", () => {
  const doc = aiRecommendationsDoc(ai) as { content: { type: string }[] };
  assertEquals(doc.content[0].type, "heading");
  assertEquals(doc.content[1].type, "paragraph");
});

Deno.test("fallbackSummaryParagraphs cita o mês e não inventa base ausente", () => {
  const paras = fallbackSummaryParagraphs({
    followers_gained: { value: 10, unit: "count", prev: null },
    followers_total: { value: null, unit: "count", prev: null },
    reach: { value: 1000, unit: "count", prev: null },
    views: { value: null, unit: "count", prev: null },
    engagement_rate: { value: 3.2, unit: "pct", prev: null },
    saves: { value: 5, unit: "count", prev: null },
    posts_count: { value: 8, unit: "count", prev: null },
    profile_views: { value: null, unit: "count", prev: null },
    website_clicks: { value: null, unit: "count", prev: null },
    follows: { value: null, unit: "count", prev: null },
  }, "Julho de 2026");
  assert(paras.length >= 1);
  assert(paras[0].includes("Julho de 2026"));
  assert(!paras.join(" ").includes("null"));
});

Deno.test("fillAiBlocks preenche text e remove blocos de IA sem conteúdo", () => {
  let n = 0;
  const layout = buildDefaultLayout({ hasAi: true, hasAudience: true, hasBestTimes: true, hasTags: true, makeId: () => `b${++n}` });
  const filled = fillAiBlocks(layout, { summary: textDoc(["s"]), recommendations: null, goals: null });
  const types = filled.blocks.map((b) => b.type);
  assert(!types.includes("ai_recommendations"));
  assert(!types.includes("ai_goals"));
  const summary = filled.blocks.find((b) => b.type === "ai_summary");
  assert(summary?.text !== undefined);
});

// ─── TikTok (spec 2026-10-28 §B3) ────────────────────────────────────────────────────

const igKpis = {
  followers_gained: { value: 10, unit: "count", prev: null },
  followers_total: { value: null, unit: "count", prev: null },
  reach: { value: 1000, unit: "count", prev: null },
  views: { value: null, unit: "count", prev: null },
  engagement_rate: { value: 3.2, unit: "pct", prev: null },
  saves: { value: 5, unit: "count", prev: null },
  posts_count: { value: 8, unit: "count", prev: null },
  profile_views: { value: null, unit: "count", prev: null },
  website_clicks: { value: null, unit: "count", prev: null },
  follows: { value: null, unit: "count", prev: null },
} as const;
const emptyIgKpis = Object.fromEntries(
  Object.entries(igKpis).map(([k, e]) => [k, { ...e, value: null }]),
) as unknown as typeof igKpis;
const ttKpis = {
  followers_total: { value: 500, unit: "count", prev: null },
  followers_gained: { value: 20, unit: "count", prev: null },
  views: { value: 12000, unit: "count", prev: null },
  engagement_rate: { value: 5.71, unit: "pct", prev: null },
  likes: { value: 50, unit: "count", prev: null },
  comments: { value: 5, unit: "count", prev: null },
  shares: { value: 2, unit: "count", prev: null },
  posts_count: { value: 1, unit: "count", prev: null },
  likes_total: { value: null, unit: "count", prev: null },
} as const;

Deno.test("fallbackSummaryParagraphs só TikTok resume o TikTok, sem números do Instagram vazio", () => {
  const paras = fallbackSummaryParagraphs(emptyIgKpis, "Julho de 2026", { instagram: false, tiktok: ttKpis });
  assertEquals(paras, [
    "Resumo de Julho de 2026 no TikTok: 1 vídeo publicado, 12.000 visualizações, 20 novos seguidores, engajamento por visualização de 5,7%.",
  ]);
});

Deno.test("fallbackSummaryParagraphs com as duas redes: parágrafo do Instagram de hoje mais um do TikTok", () => {
  const legacy = fallbackSummaryParagraphs(igKpis, "Julho de 2026");
  const both = fallbackSummaryParagraphs(igKpis, "Julho de 2026", { instagram: true, tiktok: ttKpis });
  assertEquals(both[0], legacy[0]);
  assertEquals(both[1], "No TikTok: 1 vídeo publicado, 12.000 visualizações, 20 novos seguidores, engajamento por visualização de 5,7%.");
  assertEquals(both.length, 2);
});

Deno.test("fallbackSummaryParagraphs só TikTok sem nenhum dado não inventa nada", () => {
  const noData = Object.fromEntries(
    Object.entries(ttKpis).map(([k, e]) => [k, { ...e, value: null }]),
  ) as unknown as typeof ttKpis;
  const paras = fallbackSummaryParagraphs(emptyIgKpis, "Julho de 2026", { instagram: false, tiktok: noData });
  assertEquals(paras, ["Resumo de Julho de 2026 no TikTok."]);
});

Deno.test("aiGoalsDoc: id tiktok_<kpi> vira o rótulo TikTok com a plataforma", () => {
  const doc = aiGoalsDoc({
    ...ai,
    suggested_goals: [
      { metric: "tiktok_views", target: "60000", rationale: "r1" },
      { metric: "tiktok_engagement_rate", target: "6.5%", rationale: "r2" },
      { metric: "tiktok_desconhecido", target: "10", rationale: "r3" },
    ],
  }) as { content: { type: string; content: { text: string }[] }[] };
  const headings = doc.content.filter((n) => n.type === "heading").map((n) => n.content[0].text);
  assertEquals(headings, [
    "Visualizações no TikTok: 60.000",
    "Engajamento por visualização no TikTok: 6,5%",
    "tiktok_desconhecido: 10",
  ]);
});

import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { aiRecommendationsDoc, fallbackSummaryParagraphs, fillAiBlocks, textDoc } from "./tiptap-doc.ts";
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
    engagement_rate: { value: 3.2, unit: "pct", prev: null },
    saves: { value: 5, unit: "count", prev: null },
    posts_count: { value: 8, unit: "count", prev: null },
    profile_views: { value: null, unit: "count", prev: null },
    website_clicks: { value: null, unit: "count", prev: null },
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

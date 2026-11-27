/**
 * Reports in the workspace language: the legacy HTML report (`_shared/report-template`) and the
 * block-report text `report-docs` writes at generation time. The pt half compares every render
 * with `fixtures/reports-pt.json`, captured from the code before the language change (inputs in
 * `fixtures/reports-cases.ts`); the en half asserts English labels, US number format and no
 * leftover Portuguese.
 */
import { assert, assertEquals } from "./assert.ts";
import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import * as C from "./fixtures/reports-cases.ts";
import { renderReport } from "../_shared/report-template/render.ts";
import { REPORT_FONTS_CSS } from "../_shared/report-template/fonts.ts";
import { buildFallbackSummary } from "../_shared/report-template/fallback.ts";
import { lineChart } from "../_shared/report-template/charts.ts";
import { monthWindow } from "../_shared/report-docs/month-window.ts";
import { aiGoalsDoc, fallbackSummaryParagraphs } from "../_shared/report-docs/tiptap-doc.ts";
import { buildDefaultLayout, isNextStepsTitle } from "../_shared/report-docs/default-layout.ts";
import type { Lang } from "../_shared/i18n/lang.ts";

const FIX = JSON.parse(await Deno.readTextFile(new URL("./fixtures/reports-pt.json", import.meta.url))) as Record<string, unknown>;
const PT_WORDS = /[ãçõáéíóúâêôà]|Resumo|Leitura|Alcance|Seguidores|Publica|Prioridade|Relat/;
const textOf = (html: string) =>
  html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ");
const strip = (html: string) => html.split(REPORT_FONTS_CSS).join("[FONTS_CSS]");
const render = (c: C.RenderCase, lang: Lang) =>
  strip(renderReport({ data: c.data(), branding: C.BRANDING, aiOutput: c.ai, lang }));

// --- pt unchanged -----------------------------------------------------------

Deno.test("pt unchanged: legacy report HTML for every case", () => {
  for (const c of C.RENDER_CASES) assertEquals(render(c, "pt"), FIX[`render/${c.name}`], c.name);
});

Deno.test("pt unchanged: fallback summary, charts, month labels", () => {
  for (const [k, f] of Object.entries(C.FALLBACK_CASES)) {
    assertEquals(buildFallbackSummary(f(), "pt"), FIX[`fallback/${k}`], k);
  }
  const days = C.CHART_LABELS.map((l, i) => ({ label: l, value: 100 + i * 3 }));
  assertEquals(
    lineChart({ lang: "pt", data: days, width: 660, height: 200, color: "#1C1917", annotation: "+30 no mês", eventMarker: { index: 5, label: "Maior alta" } }),
    FIX["chart/days"],
  );
  const months = C.CHART_YEAR.map((l, i) => ({ label: l, value: 100 + i }));
  assertEquals(lineChart({ lang: "pt", data: months, width: 660, height: 200, color: "#1C1917" }), FIX["chart/months"]);
  for (let m = 1; m <= 12; m++) {
    assertEquals(monthWindow(`2026-${String(m).padStart(2, "0")}`, "pt").label, FIX[`window/${m}`]);
    assertEquals(monthWindow(`2026-${String(m).padStart(2, "0")}`).label, FIX[`window/${m}`]);
  }
});

Deno.test("pt unchanged: block-report goal headings, no-AI summaries, default layout", () => {
  const ai = { executive_summary: "", detailed_analysis: "", recommendations: [], suggested_goals: C.GOALS };
  assertEquals(JSON.stringify(aiGoalsDoc(ai, "pt")), FIX["goals"]);
  const fb = fallbackSummaryParagraphs;
  const tt = C.TT_KPIS as never, ttn = C.TT_KPIS_NEG as never, g = C.GBP_KPIS as never;
  assertEquals(fb(C.IG_KPIS_FULL, "Julho de 2026", "pt"), FIX["fb/ig"]);
  assertEquals(fb(C.IG_KPIS_NEG, "Julho de 2026", "pt"), FIX["fb/ig-neg"]);
  assertEquals(fb(C.IG_KPIS_EMPTY, "Julho de 2026", "pt"), FIX["fb/ig-empty"]);
  assertEquals(fb(C.IG_KPIS_FULL, "Julho de 2026", "pt", { instagram: true, tiktok: tt }), FIX["fb/ig+tt"]);
  assertEquals(fb(C.IG_KPIS_FULL, "Julho de 2026", "pt", { instagram: false, tiktok: tt }), FIX["fb/tt-only"]);
  assertEquals(fb(C.IG_KPIS_FULL, "Julho de 2026", "pt", { instagram: false, tiktok: ttn }), FIX["fb/tt-neg"]);
  assertEquals(fb(C.IG_KPIS_FULL, "Julho de 2026", "pt", { instagram: false, tiktok: null, google: g }), FIX["fb/g-only"]);
  assertEquals(fb(C.IG_KPIS_FULL, "Julho de 2026", "pt", { instagram: true, tiktok: tt, google: g }), FIX["fb/all"]);
  let n = 0;
  const mk = () => `id${++n}`;
  assertEquals(
    JSON.stringify(buildDefaultLayout({ hasAi: true, hasAudience: true, hasBestTimes: true, hasTags: true, platforms: ["instagram", "tiktok", "google"], hasTikTokBestTimes: true, hasGbpUnits: true, makeId: mk })),
    FIX["layout/ig-ai"],
  );
  n = 0;
  assertEquals(JSON.stringify(buildDefaultLayout({ hasAi: false, hasAudience: false, hasBestTimes: false, hasTags: false, makeId: mk })), FIX["layout/ig-noai"]);
});

Deno.test("unknown or missing language renders Portuguese, never throws", () => {
  for (const lang of [undefined, "fr", null] as unknown as Lang[]) {
    assertEquals(render(C.RENDER_CASES[0], lang), FIX["render/rich-ai"]);
    assertEquals(buildFallbackSummary(C.FALLBACK_CASES.rich(), lang), FIX["fallback/rich"]);
    assertEquals(fallbackSummaryParagraphs(C.IG_KPIS_FULL, "Julho de 2026", lang), FIX["fb/ig"]);
  }
});

// --- en ---------------------------------------------------------------------

Deno.test("en: legacy report is English with US numbers and no Portuguese or template leftovers", () => {
  for (const c of C.RENDER_CASES) {
    const html = render(c, "en");
    assertStringIncludes(html, '<html lang="en"');
    assertEquals(/\{\{[A-Z_#/]+\}\}/.test(html), false, `${c.name} leftover token`);
    const text = textOf(html);
    // Fixture content (handle, captions, cities, AI text, workspace) is Portuguese by design: remove it.
    const clean = text.replace(/Agência/g, "").replace(/Post <\d+> sobre skincare|São Paulo|Fortaleza|Recife|Natal|Salvador|Belém|Brasil|Portugal|Dobrar Reels|Rever imagens|Testar horários|Porque sim\.|Rendem pouco\.|Noite\.|Primeiro parágrafo|Segundo parágrafo|Continuidade\.|Tendência\.|Alcance\s+50 mil|Salvamentos\s+2\.000|Melasma|Acne|Botox|Peeling|Uma só|Desc\.|unico|Dermatologia/g, "");
    assert(!PT_WORDS.test(clean), `${c.name} still has Portuguese: ${clean.match(PT_WORDS)?.[0]}`);
  }
});

Deno.test("en: labels, compact numbers, month names and priorities", () => {
  const html = render(C.RENDER_CASES[0], "en");
  assertStringIncludes(html, "<title>Report - @drajuliana - Junho 2026</title>");
  assertStringIncludes(html, "Monthly report<br>Instagram");
  assertStringIncludes(html, "Key metrics");
  assertStringIncludes(html, "June 2026");
  assertStringIncludes(html, "May: 35.1K");
  assertStringIncludes(html, "1.2<small>M</small>");
  assertStringIncludes(html, "High priority");
  assertStringIncludes(html, "Plan for July");
  assertStringIncludes(html, "Goals for July");
  const july = render({ name: "july", data: () => C.richData("2026-07", "July 2026"), ai: C.AI_RICH }, "en");
  assertStringIncludes(july, "June: 35.1K");
  assertStringIncludes(july, "Plan for August");
  assertStringIncludes(html, "Your audience");
  assertStringIncludes(html, "cmts".replace("cmts", "comments"));
  assertStringIncludes(html, "Recommendations for July");
  assertStringIncludes(html, "Wednesday · 7 PM");
  assertStringIncludes(html, "Shall we talk about this plan?");
  assertStringIncludes(html, "Biggest jump");
  assertStringIncludes(html, ">Jun 1<");
  assertStringIncludes(html, "+347 followers");
  assertStringIncludes(html, "aged 25 to 34");
  assertStringIncludes(html, "Top 12 posts of the month");
  const jan = render(C.RENDER_CASES[1], "en");
  assertStringIncludes(jan, "vs. December");
  assertStringIncludes(jan, "45,200 (+28.9%)"); // no-AI fallback summary
  assertStringIncludes(jan, "January 2026");
  const sparse = render(C.RENDER_CASES[2], "en");
  assertStringIncludes(sparse, "A drop of");
  assertStringIncludes(sparse, "Follower growth data is not available");
  assertStringIncludes(render(C.RENDER_CASES[3], "en"), "1 recommendation to turn");
});

Deno.test("en: no lowercase month name in any rendered report", () => {
  const months = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/;
  for (const c of C.RENDER_CASES) {
    const text = textOf(render(c, "en"));
    assert(!months.test(text), `${c.name}: lowercase month "${text.match(months)?.[0]}"`);
  }
});

Deno.test("en: fallback summary and chart ticks", () => {
  const html = buildFallbackSummary(C.FALLBACK_CASES.rich(), "en");
  assertStringIncludes(html, "New followers:");
  assertStringIncludes(html, "45,200 (+28.9%)");
  assertStringIncludes(html, "4.2%");
  const svg = lineChart({ lang: "en", data: C.CHART_LABELS.map((l, i) => ({ label: l, value: i })), width: 660, height: 200, color: "#1C1917" });
  assertStringIncludes(svg, ">Jun 1<");
  assertStringIncludes(svg, ">Jun 30<");
});

Deno.test("en: block-report month label, goal headings, no-AI summaries and next-steps title", () => {
  assertEquals(monthWindow("2026-07", "en").label, "July 2026");
  assertEquals(monthWindow("2026-07", "en").startDate, monthWindow("2026-07", "pt").startDate);
  const ai = { executive_summary: "", detailed_analysis: "", recommendations: [], suggested_goals: C.GOALS };
  const headings = (aiGoalsDoc(ai, "en") as { content: { type: string; content: { text: string }[] }[] }).content
    .filter((x) => x.type === "heading").map((x) => x.content[0].text);
  assertEquals(headings, [
    "Cumulative reach: 7,000",
    "Views: 60,000",
    "Engagement rate: 11.5%",
    "alcance nos reels: +10%",
    "New followers on TikTok: 500",
    "tiktok_unknown",
    "Calls on Google Business Profile: 30",
    "gbp_unknown",
  ].map((h, i) => (i === 5 ? "tiktok_unknown: 5" : i === 7 ? "gbp_unknown: x" : h)));
  const fb = fallbackSummaryParagraphs;
  assertEquals(fb(C.IG_KPIS_FULL, "July 2026", "en"), [
    "Summary for July 2026: 8 posts in the period, total reach of 1,234,567 accounts, 10 new followers, engagement rate of 3.3%.",
  ]);
  assertStringIncludes(fb(C.IG_KPIS_NEG, "July 2026", "en")[0], "-7 followers net for the month");
  assertEquals(fb(C.IG_KPIS_EMPTY, "July 2026", "en"), ["Summary for July 2026."]);
  const all = fb(C.IG_KPIS_FULL, "July 2026", "en", { instagram: true, tiktok: C.TT_KPIS as never, google: C.GBP_KPIS as never });
  assertStringIncludes(all[1], "On TikTok: 1 video published, 34,567 views, 12 new followers, engagement per view of 4.6%.");
  assertStringIncludes(all[2], "On Google Business Profile: 1,200 profile views, 1 call, 3 direction requests, 40 website clicks.");
  assertStringIncludes(fb(C.IG_KPIS_FULL, "July 2026", "en", { instagram: false, tiktok: C.TT_KPIS as never })[0], "Summary for July 2026 on TikTok: ");
  const layout = buildDefaultLayout({ hasAi: true, hasAudience: false, hasBestTimes: false, hasTags: false, lang: "en" });
  const titles = layout.blocks.map((b) => (b.config as { title?: string } | undefined)?.title).filter(Boolean);
  assertEquals(titles, ["Key metrics", "Growth and formats", "Posts", "Next steps", "Next steps"]);
  assert(titles.slice(-2).every(isNextStepsTitle));
  assert(isNextStepsTitle("Próximos passos"));
});

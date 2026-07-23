import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { renderReport } from "./render.ts";
import type { AIOutput, ReportData, WorkspaceBranding } from "./types.ts";

const branding: WorkspaceBranding = {
  logo_base64: null,
  splash_base64: null,
  workspace_name: "Agência Teste",
  accent_color: "#7C2D12",
};

function makeData(): ReportData {
  return {
    handle: "@drajuliana",
    specialty: "Dermatologia",
    period: "Junho 2026",
    report_month: "2026-06",
    kpis: {
      followers_gained: { id: "followers_gained", value: 347, unit: "count", prev: 310 },
      engagement_rate: { id: "engagement_rate", value: 4.2, unit: "pct", prev: 4.3 },
      reach: { id: "reach", value: 45200, unit: "count", prev: 35100 },
      saves: { id: "saves", value: 1800, unit: "count", prev: 1275 },
      posts_count: { id: "posts_count", value: 18, unit: "count", prev: 18 },
      profile_views: { id: "profile_views", value: 1200, unit: "count" },
      website_clicks: { id: "website_clicks", value: 89, unit: "count", prev: 91 },
    },
    kpi_deltas: {
      followers_pct_change: 12.4,
      engagement_pct_change: -0.3,
      reach_pct_change: 28.9,
      saves_pct_change: 41.2,
    },
    top_posts: Array.from({ length: 12 }, (_, i) => ({
      type: (["reel", "carousel", "image"] as const)[i % 3],
      reach: 12400 - i * 800,
      engagement: 6.8 - i * 0.3,
      saves: 220 - i * 10,
      likes: 900 - i * 40,
      comments: 40 - i,
      caption_preview: `Post número ${i + 1} sobre skincare`,
      thumbnail_base64: null,
    })),
    content_breakdown: {
      reels: { count: 6, avg_reach: 9800, avg_engagement: 0.058 },
      carousels: { count: 8, avg_reach: 5200, avg_engagement: 0.047 },
      images: { count: 4, avg_reach: 2100, avg_engagement: 0.031 },
    },
    audience: {
      gender_split: { female: 71.2, male: 28.8 },
      top_age_ranges: [{ range: "25-34", pct: 41.0 }],
      top_cities: [{ name: "Fortaleza", pct: 38.2 }],
      top_countries: [{ name: "Brasil", pct: 95.1 }],
    },
    best_times: [
      { day: "qua", hour: 19, avg_engagement: 6.3 },
      { day: "qui", hour: 20, avg_engagement: 5.8 },
      { day: "seg", hour: 19, avg_engagement: 5.2 },
    ],
    tags_performance: [{ tag: "Melasma", avg_engagement: 6.1, avg_reach: 18300, count: 4 }],
    follower_trend: Array.from({ length: 30 }, (_, i) => ({
      date: `2026-06-${String(i + 1).padStart(2, "0")}`,
      count: 24000 + i * 12,
    })),
  };
}

const ai: AIOutput = {
  executive_summary: "Resumo executivo de teste.",
  detailed_analysis: "Análise detalhada (não renderizada).",
  recommendations: [
    { title: "Dobrar Reels", description: "Porque sim.", priority: "high" },
    { title: "Rever imagens", description: "Rendem pouco.", priority: "medium" },
  ],
  suggested_goals: [
    { metric: "Alcance", target: "50 mil", rationale: "Continuidade." },
  ],
};

Deno.test("renders v2 skeleton: fonts, accent vars, no v1 yellow, no emoji, no leftover placeholders", () => {
  const html = renderReport({ data: makeData(), branding, aiOutput: ai });
  assertStringIncludes(html, "font-family: 'Fraunces'");
  assertStringIncludes(html, "--acc: #7C2D12");
  assertEquals(html.includes("#eab308"), false);
  assertEquals(/\p{Extended_Pictographic}/u.test(html), false);
  assertEquals(/{{[A-Z_#/]+}}/.test(html), false);
});

Deno.test("prev values render as previous-month notes; cover teaser carries baseline", () => {
  const html = renderReport({ data: makeData(), branding, aiOutput: ai });
  assertStringIncludes(html, "maio: 35,1"); // reach prev, pt-BR compact
  assertStringIncludes(html, "maio: 310");
});

Deno.test("AI page renders recommendations, goals, priorities", () => {
  const html = renderReport({ data: makeData(), branding, aiOutput: ai });
  assertStringIncludes(html, "Dobrar Reels");
  assertStringIncludes(html, "Prioridade alta");
  assertStringIncludes(html, "50 mil");
  assertEquals(html.includes("Análise detalhada"), false); // detailed_analysis not rendered
});

Deno.test("no AI → plan page dropped and pages renumber", () => {
  const html = renderReport({ data: makeData(), branding, aiOutput: null });
  assertEquals(html.includes("Recomendações"), false);
  assertStringIncludes(html, "2 / 5"); // 5 pages total without the plan page
});

Deno.test("no audience → audience page dropped", () => {
  const data = makeData();
  data.audience = null;
  data.best_times = [];
  const html = renderReport({ data, branding, aiOutput: ai });
  assertEquals(html.includes("Quem é a sua audiência"), false);
});

Deno.test("splash art embedded when present, absent otherwise", () => {
  const withSplash = renderReport({
    data: makeData(),
    branding: { ...branding, splash_base64: "data:image/jpeg;base64,AAAA" },
    aiOutput: ai,
  });
  assertStringIncludes(withSplash, 'class="cover-art"');
  const without = renderReport({ data: makeData(), branding, aiOutput: ai });
  assertEquals(without.includes('class="cover-art"'), false);
});

Deno.test("format colors present as dots; heatmap uses ramp", () => {
  const html = renderReport({ data: makeData(), branding, aiOutput: ai });
  assertStringIncludes(html, "#D97706");
  assertStringIncludes(html, "#0D9488");
  assertStringIncludes(html, "#A21CAF");
  assertStringIncludes(html, "#8F5306"); // darkest ramp step (1º chip / hottest cell)
});

Deno.test("posts 7+ render as list rows", () => {
  const html = renderReport({ data: makeData(), branding, aiOutput: ai });
  assertStringIncludes(html, 'class="post-rest"');
  assertStringIncludes(html, "Post número 12");
});

// ── fix pass 1 ─────────────────────────────────────────────────────────────

Deno.test("top-3 share is measured against the month's total reach, not the top_posts subset", () => {
  const data = makeData();
  // Upstream caps top_posts at the 15 best posts while kpis.reach sums EVERY post
  // of the month, so the subset sum is systematically too small a denominator.
  data.top_posts = Array.from({ length: 12 }, (_, i) => ({
    type: "reel" as const,
    reach: 1000,
    engagement: 5,
    saves: 10,
    likes: 100,
    comments: 5,
    caption_preview: `Post ${i + 1}`,
    thumbnail_base64: null,
  }));
  data.kpis["reach"] = { id: "reach", value: 60000, unit: "count" };

  const html = renderReport({ data, branding, aiOutput: ai });
  assertStringIncludes(html, "(5% do total)"); // 3000 / 60000
  assertEquals(html.includes("(25% do total)"), false); // 3000 / 12000, the old bug
});

Deno.test("top-3 share falls back to the subset sum when reach is missing or zero", () => {
  const data = makeData();
  data.top_posts = data.top_posts.map((p) => ({ ...p, reach: 1000 }));
  delete data.kpis["reach"];
  const html = renderReport({ data, branding, aiOutput: ai });
  assertStringIncludes(html, "(25% do total)"); // 3000 / 12000

  const zero = makeData();
  zero.top_posts = zero.top_posts.map((p) => ({ ...p, reach: 1000 }));
  zero.kpis["reach"] = { id: "reach", value: 0, unit: "count" };
  assertStringIncludes(renderReport({ data: zero, branding, aiOutput: ai }), "(25% do total)");
});

Deno.test("plano takeaway count matches the number of recommendation cards rendered", () => {
  const five: AIOutput = {
    ...ai,
    recommendations: [
      { title: "R1", description: "d", priority: "high" },
      { title: "R2", description: "d", priority: "medium" },
      { title: "R3", description: "d", priority: "low" },
      { title: "R4", description: "d", priority: "medium" },
      { title: "R5", description: "d", priority: "high" },
    ],
  };
  const html = renderReport({ data: makeData(), branding, aiOutput: five });
  const cards = (html.match(/class="reco-card"/g) || []).length;
  assertEquals(cards, 5);
  assertStringIncludes(html, "5 recomendações");
  assertStringIncludes(html, "R5");
});

Deno.test("priority low gets its own neutral label", () => {
  const withLow: AIOutput = {
    ...ai,
    recommendations: [{ title: "Testar carrossel", description: "d", priority: "low" }],
  };
  const html = renderReport({ data: makeData(), branding, aiOutput: withLow });
  assertStringIncludes(html, "Prioridade baixa");
  assertEquals(html.includes("Prioridade média"), false);
});

Deno.test("user text cannot hijack page numbering", () => {
  const data = makeData();
  data.top_posts[0].caption_preview = "Antes {{PAGE_NO}} depois";
  data.tags_performance = [
    { tag: "{{PAGE_TOTAL}}", avg_engagement: 5, avg_reach: 100, count: 1 },
  ];
  const evilBranding = { ...branding, workspace_name: "Agência {{SEC_NO}}" };

  const html = renderReport({ data, branding: evilBranding, aiOutput: ai });
  // footers still number 2..6 of 6 — nothing consumed a page token
  assertStringIncludes(html, "2 / 6");
  assertStringIncludes(html, "6 / 6");
  assertEquals(html.includes("{{"), false);
  // and the caption renders literally
  assertStringIncludes(html, "Antes &#123;&#123;PAGE_NO}} depois");
});

Deno.test("truncated lists say so; complete lists do not", () => {
  const data = makeData();
  data.audience = {
    gender_split: { female: 60, male: 40 },
    top_age_ranges: [
      { range: "13-17", pct: 2 },
      { range: "18-24", pct: 19 },
      { range: "25-34", pct: 41 },
      { range: "35-44", pct: 23 },
      { range: "45-54", pct: 10 },
      { range: "55-64", pct: 5 },
    ],
    top_cities: Array.from({ length: 8 }, (_, i) => ({ name: `Cidade ${i}`, pct: 20 - i })),
    top_countries: Array.from({ length: 5 }, (_, i) => ({ name: `País ${i}`, pct: 50 - i })),
  };
  data.tags_performance = Array.from({ length: 8 }, (_, i) => ({
    tag: `Tópico ${i}`,
    avg_engagement: 5,
    avg_reach: 1000 - i,
    count: 2,
  }));
  const html = renderReport({ data, branding, aiOutput: ai });
  assertStringIncludes(html, "Principais faixas etárias");
  assertStringIncludes(html, "Principais cidades");
  assertStringIncludes(html, "Principais países");
  assertStringIncludes(html, "Os 3 principais tópicos por alcance");
  assertStringIncludes(html, "As 12 principais publicações do mês"); // 18 published, 12 shown

  // nothing dropped → plain labels
  const small = makeData();
  small.kpis["posts_count"] = { id: "posts_count", value: 12, unit: "count" };
  const plain = renderReport({ data: small, branding, aiOutput: ai });
  assertStringIncludes(plain, ">Faixa etária<");
  assertStringIncludes(plain, ">Cidades<");
  assertStringIncludes(plain, ">Países<");
  assertStringIncludes(plain, ">Publicações do mês<");
  assertStringIncludes(plain, ">Performance por tópico<");
});

Deno.test("demographic and location rows are ranked before being capped", () => {
  const data = makeData();
  data.audience = {
    gender_split: { female: 60, male: 40 },
    // upstream order is chronological, not by share
    top_age_ranges: [
      { range: "13-17", pct: 2 },
      { range: "18-24", pct: 19 },
      { range: "25-34", pct: 41 },
      { range: "35-44", pct: 23 },
      { range: "45-54", pct: 10 },
      { range: "55-64", pct: 5 },
    ],
    top_cities: [{ name: "Fortaleza", pct: 38.2 }],
    top_countries: [{ name: "Brasil", pct: 95.1 }],
  };
  const html = renderReport({ data, branding, aiOutput: ai });
  const order = [...html.matchAll(/class="b-l">(\d\d)–(\d\d)</g)].map((m) => `${m[1]}-${m[2]}`);
  assertEquals(order.slice(0, 5), ["25-34", "35-44", "18-24", "45-54", "55-64"]);
  assertEquals(html.includes("13–17"), false); // smallest bucket dropped, not an arbitrary one
  // …and the takeaway must name the same leading bucket the bars show
  assertStringIncludes(html, "Mulheres de 25 a 34 anos em Fortaleza");
});

Deno.test("heat chips never name a slot outside the grid", () => {
  const data = makeData();
  data.best_times = [
    { day: "qui", hour: 22, avg_engagement: 9.9 }, // outside 8h–21h
    { day: "qua", hour: 7, avg_engagement: 9.5 }, // outside 8h–21h
    { day: "seg", hour: 19, avg_engagement: 5.2 },
  ];
  const html = renderReport({ data, branding, aiOutput: ai });
  assertEquals(html.includes("Quinta · 22h"), false);
  assertEquals(html.includes("Quarta · 7h"), false);
  assertStringIncludes(html, "Segunda · 19h");
});

Deno.test("heatmap normalises and ranks only over the in-grid window (8h–21h)", () => {
  const data = makeData();
  // The true maximum (dom 22h) sits OUTSIDE the grid. If maxVal were computed over
  // the unfiltered array, no in-grid cell could ever reach the darkest ramp step —
  // yet the "1º" chip (built from the same unfiltered data) would still render
  // solid --heat-700, looking hotter than anything the grid shows.
  data.best_times = [
    { day: "dom", hour: 22, avg_engagement: 9.9 }, // outside window, would-be max
    { day: "seg", hour: 19, avg_engagement: 5.2 }, // the true in-grid max
  ];
  const html = renderReport({ data, branding, aiOutput: ai });
  assertEquals(html.includes("Domingo · 22h"), false);
  assertStringIncludes(html, "Segunda · 19h");
  // the sole in-grid slot is both the grid's darkest cell AND the "1º" chip —
  // ranked and coloured from the SAME filtered array.
  assertStringIncludes(html, "#8F5306");
});

Deno.test("heatmap section collapses entirely when every slot is outside the grid", () => {
  const none = makeData();
  none.best_times = [{ day: "qui", hour: 23, avg_engagement: 9.9 }];
  const html = renderReport({ data: none, branding, aiOutput: ai });
  assertEquals(html.includes('class="heat-chip'), false); // no chips
  assertEquals(html.includes("Melhores horários para publicar"), false); // no heading
  assertEquals(html.includes('class="heat-table'), false); // no grid
});

Deno.test("negative follower growth is not phrased as growth", () => {
  const data = makeData();
  data.kpis["followers_gained"] = { id: "followers_gained", value: -120, unit: "count" };
  const html = renderReport({ data, branding, aiOutput: ai });
  assertStringIncludes(html, "Queda de <span class=\"hit\">120 seguidores</span> no período.");
  assertEquals(html.includes("Crescimento de"), false);
});

Deno.test("empty recommendations drop the Recomendações heading with them, but goals still render", () => {
  // Unreachable through validateAIOutput today (3-5 recs required), but defensive:
  // same treatment as the empty-Destaques case above, in case that ever changes.
  const goalsOnly: AIOutput = {
    ...ai,
    recommendations: [],
  };
  const html = renderReport({ data: makeData(), branding, aiOutput: goalsOnly });
  assertEquals(html.includes("Recomendações para"), false);
  assertEquals(html.includes('class="reco"'), false);
  assertStringIncludes(html, "Metas para"); // page 6 still renders for the goals
  assertStringIncludes(html, "50 mil");
});

Deno.test("empty highlights drop the Destaques heading with them", () => {
  const data = makeData();
  data.top_posts = [];
  data.content_breakdown = {};
  const html = renderReport({ data, branding, aiOutput: ai });
  assertEquals(html.includes("Destaques"), false);
  assertEquals(html.includes('class="hl-grid"'), false);
});

Deno.test("whitespace-only executive summary falls back to the deterministic summary", () => {
  const blank: AIOutput = { ...ai, executive_summary: "   \n  " };
  const html = renderReport({ data: makeData(), branding, aiOutput: blank });
  assertEquals(html.includes('<div class="summary"></div>'), false);
  assertStringIncludes(html, "<strong>Alcance total:</strong>"); // deterministic fallback bullets
});

// ── page-4 fill (sparse months) ────────────────────────────────────────────

Deno.test("post grid density steps with the card count when the cards own the page", () => {
  const cases: [number, string][] = [
    [1, 'class="post-grid pg-solo"'],
    [2, 'class="post-grid pg-duo"'],
    [3, 'class="post-grid pg-quad"'],
    [4, 'class="post-grid pg-quad"'],
    [5, 'class="post-grid pg-six"'],
    [6, 'class="post-grid pg-six"'],
  ];
  for (const [count, expected] of cases) {
    const data = makeData();
    data.top_posts = data.top_posts.slice(0, count);
    data.tags_performance = []; // no topics table → cards own the page
    const html = renderReport({ data, branding, aiOutput: ai });
    assertStringIncludes(html, expected);
  }
});

Deno.test("post grid keeps the tuned 3-up layout when the page also carries list rows or tags", () => {
  // Widening the cards on a page that already fits pushes a blank 7th sheet.
  const withList = makeData(); // 12 posts → list rows
  withList.tags_performance = [];
  assertStringIncludes(
    renderReport({ data: withList, branding, aiOutput: ai }),
    'class="post-grid "',
  );

  const withTags = makeData();
  withTags.top_posts = withTags.top_posts.slice(0, 2); // would be pg-duo on its own
  assertStringIncludes(
    renderReport({ data: withTags, branding, aiOutput: ai }),
    'class="post-grid "',
  );
});

Deno.test("an empty month gets no density modifier", () => {
  const data = makeData();
  data.top_posts = [];
  data.tags_performance = [];
  assertStringIncludes(
    renderReport({ data, branding, aiOutput: ai }),
    'class="post-grid "',
  );
});

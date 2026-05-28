import type {
  ReportData,
  WorkspaceBranding,
  AIOutput,
  TopPost,
  KpiValue,
} from "./types.ts";
import { escapeHtml } from "./escape.ts";
import {
  lineChart,
  comboChart,
  heatmapChart,
  donutChart,
} from "./charts.ts";
import { buildFallbackSummary } from "./fallback.ts";
import { REPORT_TEMPLATE } from "./template-string.ts";

// ---------------------------------------------------------------------------
// Number formatting helpers (pt-BR locale)
// ---------------------------------------------------------------------------

function fmtNum(n: number, decimals = 0): string {
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtCompact(n: number): string {
  if (n >= 1_000_000) return fmtNum(n / 1_000_000, 1) + "M";
  if (n >= 1_000) return fmtNum(n / 1_000, 1) + "k";
  return fmtNum(n);
}

// ---------------------------------------------------------------------------
// Delta badge helper
// ---------------------------------------------------------------------------

function deltaHtml(delta: number | undefined): string {
  if (delta === undefined || delta === null) return "";
  const sign = delta >= 0 ? "+" : "";
  const arrow = delta > 0 ? "▲" : delta < 0 ? "▼" : "";
  const cls =
    delta > 0 ? "kpi-delta--up" : delta < 0 ? "kpi-delta--down" : "kpi-delta--neutral";
  return `<span class="kpi-delta ${cls}">${arrow} ${sign}${fmtNum(delta, 1)}%</span>`;
}

// ---------------------------------------------------------------------------
// KPI metadata (label + delta key mapping)
// ---------------------------------------------------------------------------

interface KpiMeta {
  label: string;
  deltaKey?: keyof ReportData["kpi_deltas"];
}

const KPI_META: Record<string, KpiMeta> = {
  followers_gained: { label: "Novos Seguidores", deltaKey: "followers_pct_change" },
  engagement_rate: { label: "Engajamento", deltaKey: "engagement_pct_change" },
  reach: { label: "Alcance", deltaKey: "reach_pct_change" },
  saves: { label: "Salvamentos", deltaKey: "saves_pct_change" },
  posts_count: { label: "Publicações" },
  profile_views: { label: "Visitas ao Perfil", deltaKey: "profile_views_pct_change" },
  website_clicks: { label: "Cliques no Link", deltaKey: "website_clicks_pct_change" },
};

// Primary KPIs shown on page 1 (max 4)
const PRIMARY_KPI_IDS = ["followers_gained", "engagement_rate", "reach", "saves"];

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function buildCoverHtml(data: ReportData, branding: WorkspaceBranding): string {
  const logo = branding.logo_base64
    ? `<img class="cover-logo" src="${escapeHtml(branding.logo_base64)}" alt="Logo">`
    : "";

  return `${logo}
    <div class="cover-workspace">${escapeHtml(branding.workspace_name)}</div>
    <div class="cover-handle">${escapeHtml(data.handle)}</div>
    <div class="cover-specialty">${escapeHtml(data.specialty)}</div>
    <div class="cover-period">${escapeHtml(data.period)}</div>`;
}

const CSS_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const ALLOWED_FONTS = new Set([
  "DM Sans", "Inter", "Poppins", "Montserrat", "Plus Jakarta Sans",
]);

function safeCssColor(val: string, fallback: string): string {
  return CSS_COLOR_RE.test(val.trim()) ? val.trim() : fallback;
}

function safeCssFont(val: string): string {
  return ALLOWED_FONTS.has(val) ? val : "DM Sans";
}

function buildBrandingCss(branding: WorkspaceBranding): string {
  const primary = safeCssColor(branding.primary_color, "#eab308");
  const secondary = safeCssColor(branding.secondary_color, "#1e2430");
  const accent = safeCssColor(branding.accent_color, "#3ecf8e");
  const font = safeCssFont(branding.font_family);
  return `--primary: ${primary};
    --secondary: ${secondary};
    --accent: ${accent};
    --font-main: '${font}';`;
}

function buildKpiCards(data: ReportData): string {
  return PRIMARY_KPI_IDS.map((id) => {
    const kpi: KpiValue | undefined = data.kpis[id];
    if (!kpi) return "";
    const meta = KPI_META[id] ?? { label: id };
    const value = kpi.unit === "pct" ? fmtNum(kpi.value, 1) + "%" : fmtCompact(kpi.value);
    const delta = meta.deltaKey
      ? deltaHtml(data.kpi_deltas[meta.deltaKey])
      : "";

    return `<div class="kpi-card">
          <div class="kpi-label">${escapeHtml(meta.label)}</div>
          <div class="kpi-value">${escapeHtml(value)}</div>
          ${delta}
        </div>`;
  })
    .filter(Boolean)
    .join("\n        ");
}

function buildHighlights(data: ReportData): string {
  const parts: string[] = [];

  // Best post highlight
  if (data.top_posts.length > 0) {
    const best = data.top_posts[0];
    parts.push(`<div class="card card--highlight">
          <div class="highlight-title">Melhor Publicação</div>
          <div class="highlight-stat">${escapeHtml(fmtCompact(best.reach))}</div>
          <div class="highlight-desc">alcance &middot; ${escapeHtml(best.type)} &middot; ${escapeHtml(fmtNum(best.engagement, 1))}% eng.</div>
        </div>`);
  }

  // Content breakdown highlight
  const breakdown = data.content_breakdown;
  const types = (["reels", "carousels", "images"] as const).filter(
    (t) => breakdown[t] != null,
  );
  if (types.length > 0) {
    const total = types.reduce((s, t) => s + (breakdown[t]?.count ?? 0), 0);
    const rows = types
      .map((t) => {
        const b = breakdown[t]!;
        const label = t === "reels" ? "Reels" : t === "carousels" ? "Carrosséis" : "Imagens";
        return `${escapeHtml(label)}: ${escapeHtml(String(b.count))}`;
      })
      .join(" &middot; ");
    parts.push(`<div class="card card--highlight">
          <div class="highlight-title">Conteúdo Publicado</div>
          <div class="highlight-stat">${escapeHtml(String(total))}</div>
          <div class="highlight-desc">${rows}</div>
        </div>`);
  }

  return parts.join("\n        ");
}

function buildFollowerChart(data: ReportData, branding: WorkspaceBranding): string {
  if (data.follower_trend.length === 0) {
    return `<div style="text-align:center;color:var(--text-muted);font-size:11px;padding:20px 0;">Dados de evolução de seguidores não disponíveis para este período.</div>`;
  }
  return lineChart({
    data: data.follower_trend.map((p) => ({ label: p.date, value: p.count })),
    width: 660,
    height: 200,
    color: branding.primary_color,
  });
}

function buildContentChart(data: ReportData, branding: WorkspaceBranding): string {
  const breakdown = data.content_breakdown;
  const types: { key: "reels" | "carousels" | "images"; label: string; color: string }[] = [
    { key: "reels", label: "Reels", color: branding.primary_color },
    { key: "carousels", label: "Carrosséis", color: branding.accent_color },
    { key: "images", label: "Imagens", color: "#6366f1" },
  ];

  const items = types
    .filter((t) => breakdown[t.key] != null)
    .map((t) => {
      const b = breakdown[t.key]!;
      return {
        label: t.label,
        barValue: b.avg_reach,
        lineValue: b.avg_engagement * 100,
        barColor: t.color,
      };
    });

  if (items.length === 0) {
    return `<div style="text-align:center;color:var(--text-muted);font-size:11px;padding:20px 0;">Sem dados de formatos para este período.</div>`;
  }

  return comboChart({
    items,
    width: 660,
    height: 220,
    lineColor: "#8b5cf6",
    barLabel: "Alcance Médio",
    lineLabel: "Engajamento %",
  });
}

function buildDetailedKpis(data: ReportData): string {
  return Object.entries(data.kpis)
    .map(([id, kpi]) => {
      const meta = KPI_META[id] ?? { label: id };
      const value = kpi.unit === "pct" ? fmtNum(kpi.value, 1) + "%" : fmtCompact(kpi.value);
      const delta = meta.deltaKey
        ? deltaHtml(data.kpi_deltas[meta.deltaKey])
        : "";
      return `<div class="kpi-card detailed-kpi">
          <div class="kpi-label">${escapeHtml(meta.label)}</div>
          <div class="kpi-value">${escapeHtml(value)}</div>
          ${delta}
        </div>`;
    })
    .join("\n        ");
}

const ICON_HEART = `<svg width="8" height="8" viewBox="0 0 24 24" fill="var(--text-muted)" stroke="none" style="vertical-align:middle"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`;
const ICON_COMMENT = `<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
const ICON_BOOKMARK = `<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`;
const ICON_PLACEHOLDER = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`;

function buildPostCard(post: TopPost, rank: number): string {
  const typeLabel =
    post.type === "reel" ? "Reel" : post.type === "carousel" ? "Carrossel" : "Imagem";

  const thumbContent = post.thumbnail_base64
    ? `<img src="${escapeHtml(post.thumbnail_base64)}" alt="">`
    : ICON_PLACEHOLDER;

  return `<div class="post-card">
      <div class="post-card-thumb">
        <div class="post-card-rank">${rank}</div>
        <div class="post-card-type">${escapeHtml(typeLabel)}</div>
        ${thumbContent}
      </div>
      <div class="post-card-body">
        <div class="post-card-caption">${escapeHtml(post.caption_preview)}</div>
        <div class="post-card-stats">
          <span class="post-card-stat"><strong>${escapeHtml(fmtCompact(post.reach))}</strong> alc.</span>
          <span class="post-card-stat"><strong>${escapeHtml(fmtCompact(post.likes))}</strong> ${ICON_HEART}</span>
          <span class="post-card-stat"><strong>${escapeHtml(fmtCompact(post.comments))}</strong> ${ICON_COMMENT}</span>
          <span class="post-card-stat"><strong>${escapeHtml(fmtCompact(post.saves))}</strong> ${ICON_BOOKMARK}</span>
        </div>
      </div>
    </div>`;
}

const POSTS_PER_PAGE = 9;

function buildTopPosts(data: ReportData): string {
  if (data.top_posts.length === 0) {
    return `<div style="text-align:center;color:var(--text-muted);font-size:11px;padding:20px 0;">Nenhuma publicação neste período.</div>`;
  }

  const chunks: TopPost[][] = [];
  for (let i = 0; i < data.top_posts.length; i += POSTS_PER_PAGE) {
    chunks.push(data.top_posts.slice(i, i + POSTS_PER_PAGE));
  }

  let globalIndex = 0;
  return chunks
    .map((chunk, chunkIdx) => {
      const cards = chunk.map((post) => buildPostCard(post, ++globalIndex)).join("\n      ");
      const grid = `<div class="post-card-grid">\n      ${cards}\n    </div>`;
      if (chunkIdx === 0) return grid;
      return `{{FOOTER}}\n</div>\n\n<div class="page">\n  ${grid}`;
    })
    .join("\n  ");
}

function buildTagsTable(data: ReportData): string {
  return data.tags_performance
    .map(
      (tag) =>
        `<tr>
            <td class="tag-name">${escapeHtml(tag.tag)}</td>
            <td>${escapeHtml(String(tag.count))}</td>
            <td>${escapeHtml(fmtNum(tag.avg_engagement, 1))}%</td>
            <td>${escapeHtml(fmtCompact(tag.avg_reach))}</td>
          </tr>`,
    )
    .join("\n          ");
}

function buildDemographics(
  data: ReportData,
  branding: WorkspaceBranding,
): string {
  const audience = data.audience;
  if (!audience) return "";

  // Gender donut
  const genderSvg = donutChart({
    segments: [
      { label: "Feminino", value: audience.gender_split.female, color: "#ec4899" },
      { label: "Masculino", value: audience.gender_split.male, color: "#3b82f6" },
    ],
    size: 140,
  });

  // Age bars
  const ageBars = audience.top_age_ranges
    .map(
      (r) => `<div class="demo-bar-row">
          <div class="demo-bar-label">${escapeHtml(r.range)}</div>
          <div class="demo-bar-track"><div class="demo-bar-fill" style="width:${Math.min(r.pct, 100)}%;background:${escapeHtml(branding.primary_color)}"></div></div>
          <div class="demo-bar-value">${escapeHtml(fmtNum(r.pct, 1))}%</div>
        </div>`,
    )
    .join("\n      ");

  return `<div>
        <div class="section-subtitle">Gênero</div>
        ${genderSvg}
      </div>
      <div>
        <div class="section-subtitle">Faixa Etária</div>
        <div class="demo-bars">
          ${ageBars}
        </div>
      </div>`;
}

function buildLocation(data: ReportData, branding: WorkspaceBranding): string {
  const audience = data.audience;
  if (!audience) return "";

  const cityBars = audience.top_cities
    .slice(0, 8)
    .map(
      (c) => `<div class="demo-bar-row">
          <div class="demo-bar-label">${escapeHtml(c.name)}</div>
          <div class="demo-bar-track"><div class="demo-bar-fill" style="width:${Math.min(c.pct, 100)}%;background:${escapeHtml(branding.primary_color)}"></div></div>
          <div class="demo-bar-value">${escapeHtml(fmtNum(c.pct, 1))}%</div>
        </div>`,
    )
    .join("\n        ");

  const countryBars = (audience.top_countries ?? [])
    .slice(0, 5)
    .map(
      (c) => `<div class="demo-bar-row">
          <div class="demo-bar-label">${escapeHtml(c.name)}</div>
          <div class="demo-bar-track"><div class="demo-bar-fill" style="width:${Math.min(c.pct, 100)}%;background:${escapeHtml(branding.accent_color)}"></div></div>
          <div class="demo-bar-value">${escapeHtml(fmtNum(c.pct, 1))}%</div>
        </div>`,
    )
    .join("\n        ");

  return `<div>
        <div class="section-subtitle">Cidades</div>
        <div class="demo-bars">${cityBars}</div>
      </div>
      <div>
        <div class="section-subtitle">Países</div>
        <div class="demo-bars">${countryBars}</div>
      </div>`;
}

function buildHeatmap(data: ReportData, branding: WorkspaceBranding): string {
  if (data.best_times.length === 0) {
    return `<div style="text-align:center;color:var(--text-muted);font-size:11px;padding:20px 0;">Dados de horários não disponíveis.</div>`;
  }

  const DAY_MAP: Record<string, number> = {
    seg: 0, ter: 1, qua: 2, qui: 3, sex: 4, sab: 5, dom: 6,
    segunda: 0, terça: 1, quarta: 2, quinta: 3, sexta: 4, sábado: 5, domingo: 6,
    mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6,
  };

  const heatmapData = data.best_times.map((bt) => ({
    day: DAY_MAP[bt.day.toLowerCase()] ?? 0,
    hour: bt.hour,
    value: bt.avg_engagement,
  }));

  return heatmapChart({
    data: heatmapData,
    width: 660,
    height: 200,
    color: branding.primary_color,
  });
}

function buildFooter(data: ReportData, branding: WorkspaceBranding): string {
  return `<div class="page-footer">
      <span class="page-footer-brand">${escapeHtml(branding.workspace_name)}</span>
      <span>${escapeHtml(data.handle)} &middot; ${escapeHtml(data.period)}</span>
    </div>`;
}

// ---------------------------------------------------------------------------
// Main renderer
// ---------------------------------------------------------------------------

export function renderReport(opts: {
  data: ReportData;
  branding: WorkspaceBranding;
  aiOutput: AIOutput | null;
}): string {
  const { data, aiOutput } = opts;
  const branding: WorkspaceBranding = {
    ...opts.branding,
    primary_color: safeCssColor(opts.branding.primary_color, "#eab308"),
    secondary_color: safeCssColor(opts.branding.secondary_color, "#1e2430"),
    accent_color: safeCssColor(opts.branding.accent_color, "#3ecf8e"),
    font_family: safeCssFont(opts.branding.font_family),
    theme: opts.branding.theme === "dark" ? "dark" : "light",
  };

  let html = REPORT_TEMPLATE;

  // 1. Theme
  html = html.replace("{{THEME}}", escapeHtml(branding.theme));

  // 2. Branding CSS
  html = html.replace("{{BRANDING_CSS}}", buildBrandingCss(branding));

  // 3. Title placeholders
  html = html.replace("{{HANDLE}}", escapeHtml(data.handle));
  html = html.replace("{{PERIOD}}", escapeHtml(data.period));

  // 4. Cover
  html = html.replace("{{COVER_HTML}}", buildCoverHtml(data, branding));

  // 5. Executive summary
  const executiveSummary = aiOutput
    ? `<p>${escapeHtml(aiOutput.executive_summary)}</p>`
    : buildFallbackSummary(data);
  html = html.replace("{{EXECUTIVE_SUMMARY}}", executiveSummary);

  // 6. KPI cards
  html = html.replace("{{KPI_CARDS}}", buildKpiCards(data));

  // 7. Highlights
  html = html.replace("{{HIGHLIGHTS}}", buildHighlights(data));

  // 8. Charts
  html = html.replace("{{FOLLOWER_CHART}}", buildFollowerChart(data, branding));
  html = html.replace("{{CONTENT_CHART}}", buildContentChart(data, branding));

  // 9. Detailed KPIs
  html = html.replace("{{DETAILED_KPIS}}", buildDetailedKpis(data));

  // 10. Top posts
  html = html.replace("{{TOP_POSTS}}", buildTopPosts(data));

  // 11. Tags table
  html = html.replace("{{TAGS_TABLE}}", buildTagsTable(data));

  // 12. Demographics, location, heatmap
  html = html.replace("{{DEMOGRAPHICS}}", buildDemographics(data, branding));
  html = html.replace("{{LOCATION}}", buildLocation(data, branding));
  html = html.replace("{{HEATMAP}}", buildHeatmap(data, branding));

  // 13. Footer (replace all instances)
  const footerHtml = buildFooter(data, branding);
  html = html.replaceAll("{{FOOTER}}", footerHtml);

  // 17. Conditional sections — strip audience block when audience is null
  if (data.audience === null) {
    html = html.replace(
      /\{\{#IF_HAS_AUDIENCE\}\}[\s\S]*?\{\{\/IF_HAS_AUDIENCE\}\}/g,
      "",
    );
  } else {
    html = html.replace(/\{\{#IF_HAS_AUDIENCE\}\}/g, "");
    html = html.replace(/\{\{\/IF_HAS_AUDIENCE\}\}/g, "");
  }

  // Strip heatmap block when best_times is empty
  if (data.best_times.length === 0) {
    html = html.replace(
      /\{\{#IF_HAS_HEATMAP\}\}[\s\S]*?\{\{\/IF_HAS_HEATMAP\}\}/g,
      "",
    );
  } else {
    html = html.replace(/\{\{#IF_HAS_HEATMAP\}\}/g, "");
    html = html.replace(/\{\{\/IF_HAS_HEATMAP\}\}/g, "");
  }

  // Strip tags block when tags_performance is empty
  if (data.tags_performance.length === 0) {
    html = html.replace(
      /\{\{#IF_HAS_TAGS\}\}[\s\S]*?\{\{\/IF_HAS_TAGS\}\}/g,
      "",
    );
  } else {
    html = html.replace(/\{\{#IF_HAS_TAGS\}\}/g, "");
    html = html.replace(/\{\{\/IF_HAS_TAGS\}\}/g, "");
  }

  return html;
}

import type {
  ReportData,
  WorkspaceBranding,
  AIOutput,
  TopPost,
  KpiValue,
  Recommendation,
  SuggestedGoal,
} from "./types.ts";
import { escapeHtml } from "./escape.ts";
import {
  lineChart,
  barChart,
  heatmapChart,
  donutChart,
} from "./charts.ts";
import {
  buildFallbackSummary,
  buildFallbackRecommendations,
} from "./fallback.ts";

// ---------------------------------------------------------------------------
// Template (embedded to avoid file-system reads at runtime in Deno Deploy)
// ---------------------------------------------------------------------------

const TEMPLATE_URL = new URL("./template.html", import.meta.url);
let _cachedTemplate: string | null = null;

function loadTemplate(): string {
  if (_cachedTemplate) return _cachedTemplate;
  _cachedTemplate = Deno.readTextFileSync(TEMPLATE_URL);
  return _cachedTemplate;
}

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

  const groups = types
    .filter((t) => breakdown[t.key] != null)
    .map((t) => {
      const b = breakdown[t.key]!;
      return {
        label: t.label,
        values: [
          { value: b.avg_reach, color: t.color, label: "Alcance" },
          { value: b.avg_engagement * 100, color: t.color + "99", label: "Eng." },
        ],
      };
    });

  if (groups.length === 0) {
    return `<div style="text-align:center;color:var(--text-muted);font-size:11px;padding:20px 0;">Sem dados de formatos para este período.</div>`;
  }

  return barChart({ groups, width: 660, height: 200 });
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

function buildTopPosts(data: ReportData): string {
  if (data.top_posts.length === 0) {
    return `<div style="text-align:center;color:var(--text-muted);font-size:11px;padding:20px 0;">Nenhuma publicação neste período.</div>`;
  }

  return data.top_posts
    .slice(0, 5)
    .map((post: TopPost, i: number) => {
      const typeLabel =
        post.type === "reel" ? "Reel" : post.type === "carousel" ? "Carrossel" : "Imagem";

      const thumb = post.thumbnail_base64
        ? `<img class="post-thumb" src="${escapeHtml(post.thumbnail_base64)}" alt="">`
        : `<div class="post-thumb" style="display:flex;align-items:center;justify-content:center;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></div>`;

      return `<div class="post-item">
          <div class="post-rank">${i + 1}</div>
          ${thumb}
          <div class="post-info">
            <div class="post-caption">${escapeHtml(post.caption_preview)}</div>
            <span class="post-badge">${escapeHtml(typeLabel)}</span>
            <div class="post-stats">
              <span class="post-stat"><strong>${escapeHtml(fmtCompact(post.reach))}</strong> alcance</span>
              <span class="post-stat"><strong>${escapeHtml(fmtNum(post.engagement, 1))}%</strong> eng.</span>
              <span class="post-stat"><strong>${escapeHtml(fmtCompact(post.saves))}</strong> salvos</span>
            </div>
          </div>
        </div>`;
    })
    .join("\n      ");
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

function buildAiAnalysis(aiOutput: AIOutput | null): string {
  if (!aiOutput) return "";
  const paragraphs = aiOutput.detailed_analysis
    .split("\n")
    .filter((p) => p.trim())
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join("\n      ");
  return paragraphs;
}

function buildRecommendations(
  recs: Recommendation[],
): string {
  return recs
    .map(
      (rec) => `<div class="rec-item">
          <div class="rec-priority rec-priority--${escapeHtml(rec.priority)}"></div>
          <div class="rec-content">
            <div class="rec-title">${escapeHtml(rec.title)}</div>
            <div class="rec-desc">${escapeHtml(rec.description)}</div>
          </div>
        </div>`,
    )
    .join("\n      ");
}

function buildGoals(goals: SuggestedGoal[]): string {
  if (goals.length === 0) return "";
  return goals
    .map(
      (g) => `<div class="goal-card">
          <div class="goal-metric">${escapeHtml(g.metric)}</div>
          <div class="goal-target">${escapeHtml(g.target)}</div>
          <div class="goal-rationale">${escapeHtml(g.rationale)}</div>
        </div>`,
    )
    .join("\n      ");
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

  let html = loadTemplate();

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

  // 13. AI analysis
  const analysisHtml = aiOutput
    ? buildAiAnalysis(aiOutput)
    : `<p>${escapeHtml(buildFallbackSummary(data))}</p>`;
  html = html.replace("{{AI_ANALYSIS}}", analysisHtml);

  // 14. Recommendations
  const recs = aiOutput
    ? aiOutput.recommendations
    : buildFallbackRecommendations(data);
  html = html.replace("{{RECOMMENDATIONS}}", buildRecommendations(recs));

  // 15. Goals
  const goals = aiOutput ? aiOutput.suggested_goals : [];
  html = html.replace("{{GOALS}}", buildGoals(goals));

  // 16. Footer (replace all instances)
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

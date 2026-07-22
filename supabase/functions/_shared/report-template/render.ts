// Monthly Instagram report — v2 renderer.
//
// Fills REPORT_TEMPLATE (derived from the committed prototype) with report data.
// Everything interpolated from user/third-party data goes through escapeHtml.
//
// Design rules enforced here:
//  - The brand accent (`--acc`) may only appear on the takeaway dash, the post
//    rank chips and the "formato líder" chip. Chart/data colors are FIXED.
//  - No emoji anywhere: Gotenberg has no emoji font. The heart marker is emitted
//    as the numeric entity `&#9829;` so the rendered document carries no
//    Extended_Pictographic codepoint.

import type {
  AIOutput,
  BestTimeSlot,
  KpiValue,
  ReportData,
  TopPost,
  WorkspaceBranding,
} from "./types.ts";
import { escapeHtml } from "./escape.ts";
import { lineChart } from "./charts.ts";
import { buildFallbackSummary } from "./fallback.ts";
import { resolveAccent } from "./theme.ts";
import { REPORT_FONTS_CSS } from "./fonts.ts";
import { REPORT_TEMPLATE } from "./template-string.ts";

// ── fixed data palette (validated 2026-07-22 — see spec §3.2; re-validate if changed)
const FMT = { reel: "#D97706", carousel: "#0D9488", image: "#A21CAF" } as const;
const HEAT = ["#F5DCAE", "#F0CF93", "#ECC178", "#E0A344", "#CE8418", "#B26A08", "#8F5306"];
const INK = "#1C1917";
const DONUT_TRACK = "#EDECEA";

// Text-only stat markers (no emoji — see file header).
const HEART = "&#9829;";
const THUMB_PLACEHOLDER = "▨";

const MONTHS_PT_FULL = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

// Page-fit caps — derived from the prototype's verified page boxes.
const MAX_POST_CARDS = 6;
const MAX_POST_ROWS = 6;
const MAX_TAG_ROWS = 3;
const MAX_AGE_ROWS = 5;
const MAX_CITY_ROWS = 5;
const MAX_COUNTRY_ROWS = 3;
// ai.ts validates 3–5 recommendations, so a 5-item result is routine. Page 6 was
// re-measured at 5 cards (1123px, still inside the A4 box) — cap set to 5 so the
// AI's full plan reaches the client and the takeaway count can never exceed it.
const MAX_RECO_CARDS = 5;
const MAX_GOAL_CARDS = 3;

// ---------------------------------------------------------------------------
// Formatting helpers (pt-BR)
// ---------------------------------------------------------------------------

function fmtNum(n: number, d = 0): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** "45,2 mil" / "1,3 mi" / "310" */
function fmtCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return fmtNum(n / 1_000_000, 1) + " mi";
  if (Math.abs(n) >= 1_000) return fmtNum(n / 1_000, 1) + " mil";
  return fmtNum(n);
}

/** Tight variant for the dense post grid/list, as in the prototype ("42,0k"). */
function fmtStat(n: number): string {
  if (Math.abs(n) >= 1_000_000) return fmtNum(n / 1_000_000, 1) + "mi";
  if (Math.abs(n) >= 1_000) return fmtNum(n / 1_000, 1) + "k";
  return fmtNum(n);
}

function fmtKpi(kpi: KpiValue, v: number): string {
  return kpi.unit === "pct" ? fmtNum(v, 1) + "%" : fmtCompact(v);
}

/** Splits a formatted KPI value into big number + small unit, as the prototype does. */
function kpiValueHtml(kpi: KpiValue, v: number, signed = false): string {
  if (kpi.unit === "pct") {
    return `${escapeHtml(fmtNum(v, 1))}<small>%</small>`;
  }
  const compact = fmtCompact(v);
  const sign = signed && v > 0 ? "+" : "";
  const m = compact.match(/^(.+) (mil|mi)$/);
  if (m) return `${escapeHtml(sign + m[1])}<small>${m[2]}</small>`;
  return escapeHtml(sign + compact);
}

/** previous-month name from ReportData.report_month ("2026-06" → "maio") */
export function prevMonthName(reportMonth: string): string {
  const m = parseInt(String(reportMonth ?? "").split("-")[1], 10);
  if (!m || m < 1 || m > 12) return "mês anterior";
  return MONTHS_PT_FULL[(m + 10) % 12];
}

function nextMonthName(reportMonth: string): string {
  const m = parseInt(String(reportMonth ?? "").split("-")[1], 10);
  if (!m || m < 1 || m > 12) return "o próximo mês";
  return MONTHS_PT_FULL[m % 12];
}

/** "Junho de 2026" from "2026-06"; falls back to ReportData.period. */
function coverMonthLabel(data: ReportData): string {
  const parts = String(data.report_month ?? "").split("-");
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (!y || !m || m < 1 || m > 12) return data.period;
  const name = MONTHS_PT_FULL[m - 1];
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} de ${y}`;
}

function deltaNote(kpi: KpiValue | undefined, prevName: string): string {
  if (!kpi || kpi.prev === undefined || kpi.prev === null) {
    return `<span class="delta-note">vs. ${escapeHtml(prevName)}</span>`;
  }
  return `<span class="delta-note">${escapeHtml(prevName)}: ${escapeHtml(fmtKpi(kpi, kpi.prev))}</span>`;
}

function deltaChip(delta: number | undefined, prevName: string): string {
  if (delta === undefined || delta === null || !isFinite(delta)) return "";
  const rounded = Math.round(delta * 10) / 10;
  if (rounded > 0) {
    return `<span class="delta up">▲ +${escapeHtml(fmtNum(rounded, 1))}%</span>`;
  }
  if (rounded < 0) {
    return `<span class="delta down">▼ −${escapeHtml(fmtNum(Math.abs(rounded), 1))}%</span>`;
  }
  return `<span class="delta flat">= igual a ${escapeHtml(prevName)}</span>`;
}

/** Explicit delta wins; otherwise derive it from the KPI's previous value. */
function resolveDelta(kpi: KpiValue | undefined, explicit: number | undefined): number | undefined {
  if (explicit !== undefined && explicit !== null) return explicit;
  if (!kpi || kpi.prev === undefined || kpi.prev === null || kpi.prev === 0) return undefined;
  return ((kpi.value - kpi.prev) / Math.abs(kpi.prev)) * 100;
}

/** Largest share of a demographic list — upstream order is not a ranking. */
function topByPct<T extends { pct: number }>(rows: T[] | undefined): T | undefined {
  if (!rows || rows.length === 0) return undefined;
  return rows.reduce((best, r) => (r.pct > best.pct ? r : best), rows[0]);
}

const TYPE_LABEL: Record<TopPost["type"], string> = {
  reel: "Reel",
  carousel: "Carrossel",
  image: "Imagem",
};
const TYPE_DOT: Record<TopPost["type"], string> = {
  reel: "reel",
  carousel: "car",
  image: "img",
};

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function buildCoverBrand(b: WorkspaceBranding): string {
  const plate = b.logo_base64
    ? `<div class="cover-logo-plate"><img alt="" src="${escapeHtml(b.logo_base64)}"></div>\n      `
    : "";
  return `${plate}<div class="cover-brand">${escapeHtml(b.workspace_name)}</div>`;
}

function buildCoverMid(data: ReportData): string {
  const city = topByPct(data.audience?.top_cities)?.name;
  const spec = [data.specialty, city].filter(Boolean).join(" · ");
  const specHtml = spec ? `\n    <div class="cover-spec">${escapeHtml(spec)}</div>` : "";
  return `<div class="cover-month">${escapeHtml(coverMonthLabel(data))}</div>
    <div class="cover-handle">${escapeHtml(data.handle)}</div>${specHtml}`;
}

function buildCoverArt(b: WorkspaceBranding): string {
  return b.splash_base64
    ? `<div class="cover-art"><img src="${escapeHtml(b.splash_base64)}" alt=""></div>`
    : "";
}

function teaserCell(
  label: string,
  kpi: KpiValue | undefined,
  delta: number | undefined,
  prevName: string,
  signed = false,
): string {
  if (!kpi) return "";
  const sign = signed && kpi.value > 0 ? "+" : "";
  const value = kpi.unit === "pct" ? fmtNum(kpi.value, 1) + "%" : sign + fmtCompact(kpi.value);

  const bits: string[] = [];
  const d = resolveDelta(kpi, delta);
  if (d !== undefined && isFinite(d)) {
    const rd = Math.round(d * 10) / 10;
    const arrow = rd > 0 ? "▲ +" : rd < 0 ? "▼ −" : "= ";
    bits.push(`${arrow}${fmtNum(Math.abs(rd), 1)}%`);
  }
  if (kpi.prev !== undefined && kpi.prev !== null) {
    bits.push(`${prevName}: ${fmtKpi(kpi, kpi.prev)}`);
  }
  const deltaHtml = bits.length
    ? `\n        <div class="t-delta">${escapeHtml(bits.join(" · "))}</div>`
    : "";

  return `<div>
        <div class="t-label">${escapeHtml(label)}</div>
        <div class="t-value num">${escapeHtml(value)}</div>${deltaHtml}
      </div>`;
}

function buildCoverTeaser(data: ReportData, prevName: string): string {
  const k = data.kpis;
  return [
    teaserCell("Alcance", k["reach"], data.kpi_deltas.reach_pct_change, prevName),
    teaserCell("Novos seguidores", k["followers_gained"], data.kpi_deltas.followers_pct_change, prevName, true),
    teaserCell("Salvamentos", k["saves"], data.kpi_deltas.saves_pct_change, prevName),
  ]
    .filter(Boolean)
    .join("\n      ");
}

function takeaway(label: string, text: string): string {
  if (!text) return "";
  return `<div class="takeaway">
    <div class="lbl">${escapeHtml(label)}</div>
    <div class="txt">${text}</div>
  </div>`;
}

interface FormatEntry {
  key: "reels" | "carousels" | "images";
  name: string;
  lower: string;
  dot: string;
  cls: string;
  count: number;
  avgReach: number;
  avgEngagement: number;
}

function formatEntries(data: ReportData): FormatEntry[] {
  const meta = [
    { key: "reels", name: "Reels", lower: "reels", dot: "reel", cls: "fmt--reel" },
    { key: "carousels", name: "Carrosséis", lower: "carrosséis", dot: "car", cls: "fmt--car" },
    { key: "images", name: "Imagens", lower: "imagens", dot: "img", cls: "fmt--img" },
  ] as const;

  const out: FormatEntry[] = [];
  for (const m of meta) {
    const b = data.content_breakdown[m.key];
    if (!b) continue;
    out.push({
      key: m.key,
      name: m.name,
      lower: m.lower,
      dot: m.dot,
      cls: m.cls,
      count: b.count,
      avgReach: b.avg_reach,
      avgEngagement: b.avg_engagement,
    });
  }
  return out;
}

/**
 * @param recoCount number of recommendations actually rendered on page 6 — must be
 *   the length of the SAME capped array `buildRecoCards` receives, otherwise the
 *   sentence promises more cards than the page shows.
 */
function buildTakeaways(
  data: ReportData,
  recoCount: number,
): Record<string, string> {
  const out: Record<string, string> = {
    resumo: "",
    crescimento: "",
    formatos: "",
    posts: "",
    audiencia: "",
    plano: "",
  };
  const d = data.kpi_deltas;

  // ── resumo: largest positive delta of the month
  const candidates = [
    { v: d.reach_pct_change, label: "alcance" },
    { v: d.followers_pct_change, label: "ganho de seguidores" },
    { v: d.saves_pct_change, label: "volume de salvamentos" },
    { v: d.engagement_pct_change, label: "engajamento" },
  ].filter((c) => c.v !== undefined && c.v !== null && isFinite(c.v as number)) as {
    v: number;
    label: string;
  }[];
  const best = candidates.filter((c) => c.v > 0).sort((a, b) => b.v - a.v)[0];
  if (best) {
    out.resumo = takeaway(
      "Leitura do mês",
      `O ${escapeHtml(best.label)} cresceu <span class="hit">${escapeHtml(fmtNum(best.v, 1))}%</span> — o melhor resultado do mês.`,
    );
  } else {
    const posts = data.kpis["posts_count"]?.value;
    if (posts) {
      out.resumo = takeaway(
        "Leitura do mês",
        `Mês de consolidação: ${escapeHtml(fmtNum(posts))} publicações mantiveram a presença do perfil.`,
      );
    }
  }

  // ── crescimento
  const gainKpi = data.kpis["followers_gained"];
  const gain = gainKpi
    ? gainKpi.value
    : data.follower_trend.length > 1
    ? data.follower_trend[data.follower_trend.length - 1].count - data.follower_trend[0].count
    : undefined;
  if (gain !== undefined) {
    if (gain > 0) {
      out.crescimento = takeaway(
        "Leitura do mês",
        `Crescimento de <span class="hit">+${escapeHtml(fmtNum(gain))} seguidores</span> no período.`,
      );
    } else if (gain < 0) {
      // A negative gain must not be phrased as "crescimento de −120 seguidores".
      out.crescimento = takeaway(
        "Leitura do mês",
        `Queda de <span class="hit">${escapeHtml(fmtNum(Math.abs(gain)))} seguidores</span> no período.`,
      );
    } else {
      out.crescimento = takeaway(
        "Leitura do mês",
        `Base de seguidores <span class="hit">estável</span> no período.`,
      );
    }
  }

  // ── formatos
  const fmts = formatEntries(data).filter((f) => f.avgReach > 0);
  if (fmts.length >= 2) {
    const sorted = [...fmts].sort((a, b) => b.avgReach - a.avgReach);
    const leader = sorted[0];
    const weakest = sorted[sorted.length - 1];
    const ratio = leader.avgReach / weakest.avgReach;
    out.formatos = takeaway(
      "Leitura do mês",
      `${escapeHtml(leader.name)} alcançam <span class="hit">${escapeHtml(fmtNum(ratio, 1))}× mais</span> que ${escapeHtml(weakest.lower)} — o formato merece prioridade.`,
    );
  }

  // ── posts
  if (data.top_posts.length >= 3) {
    const top3 = data.top_posts.slice(0, 3).reduce((s, p) => s + (p.reach || 0), 0);
    // The denominator MUST be the month's total reach, not the sum of `top_posts`:
    // upstream caps `top_posts` at the 15 best posts while `kpis.reach` sums every
    // post of the month, so dividing by the subset inflates the printed share for
    // any client who published more than 15 times.
    const monthReach = data.kpis["reach"]?.value;
    const subsetReach = data.top_posts.reduce((s, p) => s + (p.reach || 0), 0);
    const monthReachValid = typeof monthReach === "number" && isFinite(monthReach) && monthReach > 0;
    let total: number;
    if (monthReachValid && top3 <= (monthReach as number)) {
      total = monthReach as number;
    } else {
      // A present-and-valid kpis.reach that still fails `top3 <= monthReach` means
      // top_posts.reach no longer sums into kpis.reach the way this math assumes —
      // the fallback below silently returns a smaller (inflated-looking) share, so
      // log it rather than let a future upstream contract change go unnoticed.
      if (monthReachValid) {
        console.warn(
          `[report-template] takeaway posts: top3 reach (${top3}) exceeds kpis.reach (${monthReach}); ` +
            `falling back to top_posts subset sum (${subsetReach}) as the denominator.`,
        );
      }
      total = subsetReach;
    }
    if (top3 > 0 && total > 0) {
      const share = Math.round((top3 / total) * 100);
      out.posts = takeaway(
        "Leitura do mês",
        `As 3 melhores publicações somam <span class="hit">${escapeHtml(fmtCompact(top3))} de alcance</span> (${escapeHtml(String(share))}% do total).`,
      );
    }
  }

  // ── audiência
  const aud = data.audience;
  if (aud) {
    const genderLabel = aud.gender_split.female >= aud.gender_split.male ? "Mulheres" : "Homens";
    // By share, NOT by upstream order — age buckets arrive chronologically, so
    // index 0 is the 13-17 bucket and the sentence would contradict the ranked bars.
    const age = topByPct(aud.top_age_ranges)?.range;
    const city = topByPct(aud.top_cities)?.name;
    const bits: string[] = [genderLabel];
    if (age) bits.push(`de ${age.replace(/-/g, " a ")} anos`);
    if (city) bits.push(`em ${city}`);
    out.audiencia = takeaway(
      "Leitura do mês",
      `${escapeHtml(bits.join(" "))} são <span class="hit">o núcleo da audiência</span>.`,
    );
  }

  // ── plano
  const n = recoCount;
  if (n > 0) {
    out.plano = takeaway(
      "Plano de ação",
      `${escapeHtml(fmtNum(n))} ${n === 1 ? "recomendação" : "recomendações"} para transformar os resultados do mês em <span class="hit">tendência sustentada</span>.`,
    );
  }

  return out;
}

function kpiCard(
  label: string,
  kpi: KpiValue | undefined,
  explicitDelta: number | undefined,
  prevName: string,
  signed = false,
): string {
  if (!kpi) return "";
  const delta = resolveDelta(kpi, explicitDelta);
  return `<div class="kpi">
      <div class="k-label">${escapeHtml(label)}</div>
      <div class="k-value num">${kpiValueHtml(kpi, kpi.value, signed)}</div>
      ${deltaChip(delta, prevName)}
      ${deltaNote(kpi, prevName)}
    </div>`;
}

function buildKpiCards(data: ReportData, prevName: string): string {
  const k = data.kpis;
  return [
    kpiCard("Novos seguidores", k["followers_gained"], data.kpi_deltas.followers_pct_change, prevName, true),
    kpiCard("Engajamento", k["engagement_rate"], data.kpi_deltas.engagement_pct_change, prevName),
    kpiCard("Alcance", k["reach"], data.kpi_deltas.reach_pct_change, prevName),
    kpiCard("Salvamentos", k["saves"], data.kpi_deltas.saves_pct_change, prevName),
  ]
    .filter(Boolean)
    .join("\n    ");
}

function buildAuxKpis(data: ReportData, prevName: string): string {
  const k = data.kpis;
  return [
    kpiCard("Publicações", k["posts_count"], undefined, prevName),
    kpiCard("Visitas ao perfil", k["profile_views"], data.kpi_deltas.profile_views_pct_change, prevName),
    kpiCard("Cliques no link", k["website_clicks"], data.kpi_deltas.website_clicks_pct_change, prevName),
  ]
    .filter(Boolean)
    .join("\n    ");
}

function buildHighlights(data: ReportData): string {
  const cards: string[] = [];

  const best = data.top_posts[0];
  if (best) {
    const desc = [
      TYPE_LABEL[best.type],
      `${fmtNum(best.engagement, 1)}% de engajamento`,
      `${fmtNum(best.saves)} salvamentos`,
    ].join(" · ");
    cards.push(`<div class="hl">
      <div class="h-label">Melhor publicação</div>
      <div class="h-big num">${escapeHtml(fmtCompact(best.reach))} <span class="unit">de alcance</span></div>
      <div class="h-caption">“${escapeHtml(best.caption_preview)}”</div>
      <div class="h-desc"><i class="dot ${TYPE_DOT[best.type]}"></i>${escapeHtml(desc)}</div>
    </div>`);
  }

  const fmts = formatEntries(data);
  if (fmts.length > 0) {
    const total = fmts.reduce((s, f) => s + f.count, 0);
    const chips = fmts
      .map(
        (f) =>
          `<div class="m-chip"><div class="m-n num">${escapeHtml(fmtNum(f.count))}</div><div class="m-t"><i class="dot ${f.dot}"></i>${escapeHtml(f.name)}</div></div>`,
      )
      .join("\n        ");
    cards.push(`<div class="hl">
      <div class="h-label">Conteúdo publicado</div>
      <div class="h-big num">${escapeHtml(fmtNum(total))} <span class="unit">${total === 1 ? "post" : "posts"}</span></div>
      <div class="mix">
        ${chips}
      </div>
    </div>`);
  }

  return cards.join("\n    ");
}

function buildTocItems(nextMonth: string, hasAudience: boolean, hasAi: boolean): string {
  const titles = ["Crescimento e formatos", "Publicações do mês"];
  if (hasAudience) titles.push("Quem é a sua audiência");
  if (hasAi) titles.push(`Plano para ${nextMonth}`);

  return titles
    .map(
      (t, i) =>
        `<div class="toc-item"><div class="tc-n">${String(i + 2).padStart(2, "0")}</div><div class="tc-t">${escapeHtml(t)}</div></div>`,
    )
    .join("\n    ");
}

function buildFollowerChart(data: ReportData): string {
  const trend = data.follower_trend;
  if (trend.length === 0) {
    return `<div class="empty">Dados de evolução de seguidores não disponíveis para este período.</div>`;
  }

  const gainKpi = data.kpis["followers_gained"];
  const gain = gainKpi
    ? gainKpi.value
    : trend[trend.length - 1].count - trend[0].count;
  const annotation = `${gain > 0 ? "+" : ""}${fmtNum(gain)} no mês`;

  // Event marker on the sharpest day-over-day rise, kept away from the
  // annotation pill at the right edge so the two labels never collide.
  let eventMarker: { index: number; label: string } | undefined;
  if (trend.length >= 6) {
    let bestIdx = -1;
    let bestJump = 0;
    for (let i = 1; i < trend.length - 3; i++) {
      const jump = trend[i].count - trend[i - 1].count;
      if (jump > bestJump) {
        bestJump = jump;
        bestIdx = i;
      }
    }
    if (bestIdx > 0) eventMarker = { index: bestIdx, label: "Maior alta" };
  }

  return lineChart({
    data: trend.map((p) => ({ label: p.date, value: p.count })),
    width: 680,
    height: 232,
    color: INK,
    annotation,
    eventMarker,
  });
}

function buildFormatCards(data: ReportData): string {
  const fmts = formatEntries(data);
  if (fmts.length === 0) {
    return `<div class="empty">Sem dados de formatos para este período.</div>`;
  }
  const maxReach = Math.max(...fmts.map((f) => f.avgReach), 1);
  const leaderKey = [...fmts].sort((a, b) => b.avgReach - a.avgReach)[0].key;

  return fmts
    .map((f) => {
      const isLead = f.key === leaderKey && fmts.length > 1;
      const width = Math.max(2, Math.round((f.avgReach / maxReach) * 100));
      const chip = isLead ? `<span class="lead-chip">Formato líder</span>` : "";
      return `<div class="fmt${isLead ? " lead" : ""} ${f.cls}">
      <div class="f-head"><span class="f-name">${escapeHtml(f.name)}${chip}</span><span class="f-count num">${escapeHtml(fmtNum(f.count))} ${f.count === 1 ? "post" : "posts"}</span></div>
      <div class="f-reach num">${escapeHtml(fmtCompact(f.avgReach))}</div>
      <div class="f-reach-l">alcance médio</div>
      <div class="f-bar"><i style="width:${width}%"></i></div>
      <div class="f-eng"><span class="f-eng-l">Engajamento médio</span><span class="f-eng-v num">${escapeHtml(fmtNum(f.avgEngagement * 100, 1))}%</span></div>
    </div>`;
    })
    .join("\n    ");
}

function buildTopPostCards(posts: TopPost[]): string {
  if (posts.length === 0) {
    return `<div class="empty">Nenhuma publicação neste período.</div>`;
  }
  return posts
    .slice(0, MAX_POST_CARDS)
    .map((p, i) => {
      const thumb = p.thumbnail_base64
        ? `<img src="${escapeHtml(p.thumbnail_base64)}" alt="">`
        : THUMB_PLACEHOLDER;
      return `<div class="post">
      <div class="p-thumb">${thumb}<div class="p-rank num">${i + 1}</div><div class="p-type"><i class="dot ${TYPE_DOT[p.type]}"></i>${escapeHtml(TYPE_LABEL[p.type])}</div></div>
      <div class="p-body">
        <div class="p-caption">${escapeHtml(p.caption_preview)}</div>
        <div class="p-stats num"><span><b>${escapeHtml(fmtStat(p.reach))}</b> alc.</span><span><b>${escapeHtml(fmtStat(p.likes))}</b> ${HEART}</span><span><b>${escapeHtml(fmtStat(p.comments))}</b> com.</span><span><b>${escapeHtml(fmtStat(p.saves))}</b> salv.</span></div>
      </div>
    </div>`;
    })
    .join("\n    ");
}

function buildPostListRows(posts: TopPost[]): string {
  return posts
    .slice(MAX_POST_CARDS, MAX_POST_CARDS + MAX_POST_ROWS)
    .map(
      (p, i) => `<div class="r-row">
      <span class="r-rank num">${MAX_POST_CARDS + i + 1}</span>
      <span class="r-cap"><i class="dot ${TYPE_DOT[p.type]}"></i>${escapeHtml(p.caption_preview)}</span>
      <span class="r-m num"><b>${escapeHtml(fmtStat(p.reach))}</b> alc.</span>
      <span class="r-m num hide-m"><b>${escapeHtml(fmtStat(p.likes))}</b> ${HEART}</span>
      <span class="r-m num hide-m"><b>${escapeHtml(fmtStat(p.saves))}</b> salv.</span>
    </div>`,
    )
    .join("\n    ");
}

/**
 * Page 4 shows at most 6 cards + 6 list rows, and upstream itself already caps
 * `top_posts` at the 15 best. Whenever anything was left out the heading says how
 * many publications the page actually covers.
 */
function buildPostsHeading(data: ReportData): string {
  const shown = Math.min(data.top_posts.length, MAX_POST_CARDS + MAX_POST_ROWS);
  const published = data.kpis["posts_count"]?.value;
  const total = typeof published === "number" && published > data.top_posts.length
    ? published
    : data.top_posts.length;
  return total > shown
    ? `As ${escapeHtml(fmtNum(shown))} principais publicações do mês`
    : "Publicações do mês";
}

function buildTagsHeading(data: ReportData): string {
  const total = data.tags_performance.length;
  const shown = Math.min(total, MAX_TAG_ROWS);
  return total > shown
    ? `Os ${escapeHtml(fmtNum(shown))} principais tópicos por alcance`
    : "Performance por tópico";
}

function buildTagsTable(data: ReportData): string {
  const tags = [...data.tags_performance]
    .sort((a, b) => b.avg_reach - a.avg_reach)
    .slice(0, MAX_TAG_ROWS);
  const maxReach = Math.max(...tags.map((t) => t.avg_reach), 1);

  return tags
    .map((t) => {
      const w = Math.max(6, Math.round((t.avg_reach / maxReach) * 110));
      return `<tr>
          <td class="t-name"><span>${escapeHtml(t.tag)}</span></td><td class="num">${escapeHtml(fmtNum(t.count))}</td>
          <td><span class="t-bar" style="width:${w}px"></span><span class="num">${escapeHtml(fmtCompact(t.avg_reach))}</span></td>
          <td class="r num">${escapeHtml(fmtNum(t.avg_engagement, 1))}%</td>
        </tr>`;
    })
    .join("\n        ");
}

/**
 * Page space forces every list on this document to be capped. When a cap actually
 * drops rows, the label has to say so — a heading that implies completeness over a
 * truncated list is a factual claim we can't make in a client deliverable.
 */
function topNLabel(complete: string, truncated: string, total: number, shown: number): string {
  return total > shown ? truncated : complete;
}

function barRow(label: string, pct: number, maxPct: number, alt = false): string {
  const w = Math.max(2, Math.min(100, Math.round((pct / (maxPct || 1)) * 100)));
  return `<div class="bar-row"><span class="b-l">${escapeHtml(label)}</span><div class="b-track"><div class="b-fill${alt ? " alt" : ""}" style="width:${w}%"></div></div><span class="b-v num">${escapeHtml(fmtNum(pct, 1))}%</span></div>`;
}

function buildDemographics(data: ReportData): string {
  const aud = data.audience;
  if (!aud) return "";

  // Ring donut, per the prototype: neutral ink arc on a light track with the
  // dominant share called out in the centre. The brand accent is NOT used here.
  const female = aud.gender_split?.female ?? 0;
  const male = aud.gender_split?.male ?? 0;
  const dominantPct = female >= male ? female : male;
  const dominantLabel = female >= male ? "feminino" : "masculino";
  const circumference = 2 * Math.PI * 45;
  const dash = Math.round((Math.max(0, Math.min(100, dominantPct)) / 100) * circumference * 10) / 10;

  const donut = `<div class="panel">
      <div class="pn-label">Gênero</div>
      <div class="donut-wrap">
        <svg width="132" height="132" viewBox="0 0 132 132">
          <circle cx="66" cy="66" r="45" fill="none" stroke="${DONUT_TRACK}" stroke-width="17"/>
          <circle cx="66" cy="66" r="45" fill="none" stroke="${INK}" stroke-width="17"
                  stroke-dasharray="${dash} ${Math.round(circumference * 10) / 10}" stroke-linecap="butt" transform="rotate(-90 66 66)"/>
          <text x="66" y="63" text-anchor="middle" style="font-family:'Fraunces',serif;font-size:20px;font-weight:600;fill:${INK}">${escapeHtml(fmtNum(dominantPct, 0))}%</text>
          <text x="66" y="79" text-anchor="middle" style="font-family:'Instrument Sans',sans-serif;font-size:9px;fill:#8A8A8A">${escapeHtml(dominantLabel)}</text>
        </svg>
        <div class="legend">
          <span><i style="background:${INK}"></i>Feminino ${escapeHtml(fmtNum(female, 0))}%</span>
          <span><i style="background:#D6D3D1"></i>Masculino ${escapeHtml(fmtNum(male, 0))}%</span>
        </div>
      </div>
    </div>`;

  // Sort BEFORE slicing: upstream sends age buckets in chronological order
  // (13-17, 18-24, …), so slicing first would drop an arbitrary bucket and render
  // the bars unranked.
  const allAges = [...(aud.top_age_ranges ?? [])].sort((a, b) => b.pct - a.pct);
  const ages = allAges.slice(0, MAX_AGE_ROWS);
  const maxAge = Math.max(...ages.map((a) => a.pct), 1);
  const ageBars = ages.length
    ? ages.map((a) => barRow(a.range.replace(/-/g, "–"), a.pct, maxAge)).join("\n        ")
    : `<div class="empty">Sem dados de faixa etária.</div>`;

  const agePanel = `<div class="panel">
      <div class="pn-label">${topNLabel("Faixa etária", "Principais faixas etárias", allAges.length, ages.length)}</div>
      <div class="bars">
        ${ageBars}
      </div>
    </div>`;

  return `${donut}\n    ${agePanel}`;
}

function buildLocation(data: ReportData): string {
  const aud = data.audience;
  if (!aud) return "";

  // Sort before slicing (see buildDemographics) so the cap always drops the
  // smallest shares and the bars read as a ranking.
  const allCities = [...(aud.top_cities ?? [])].sort((a, b) => b.pct - a.pct);
  const cities = allCities.slice(0, MAX_CITY_ROWS);
  const maxCity = Math.max(...cities.map((c) => c.pct), 1);
  const cityBars = cities.length
    ? cities.map((c) => barRow(c.name, c.pct, maxCity)).join("\n        ")
    : `<div class="empty">Sem dados de cidades.</div>`;

  const allCountries = [...(aud.top_countries ?? [])].sort((a, b) => b.pct - a.pct);
  const countries = allCountries.slice(0, MAX_COUNTRY_ROWS);
  const maxCountry = Math.max(...countries.map((c) => c.pct), 1);
  const countryBars = countries.length
    ? countries.map((c) => barRow(c.name, c.pct, maxCountry, true)).join("\n        ")
    : `<div class="empty">Sem dados de países.</div>`;

  return `<div class="panel">
      <div class="pn-label">${topNLabel("Cidades", "Principais cidades", allCities.length, cities.length)}</div>
      <div class="bars">
        ${cityBars}
      </div>
    </div>
    <div class="panel">
      <div class="pn-label">${topNLabel("Países", "Principais países", allCountries.length, countries.length)}</div>
      <div class="bars">
        ${countryBars}
      </div>
    </div>`;
}

const DAY_INDEX: Record<string, number> = {
  seg: 0, ter: 1, qua: 2, qui: 3, sex: 4, sab: 5, dom: 6,
  segunda: 0, terça: 1, terca: 1, quarta: 2, quinta: 3, sexta: 4, sábado: 5, sabado: 5, domingo: 6,
  mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6,
};
const DAY_SHORT = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const DAY_FULL = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
const HEAT_HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];

function dayIndex(day: string): number {
  return DAY_INDEX[String(day ?? "").toLowerCase()] ?? 0;
}

/**
 * Both the ramp and the grid must be built from the SAME slots the grid actually
 * displays (8h–21h). Normalising `maxVal` over the unfiltered `best_times` lets the
 * true maximum sit in a column the grid never shows — no visible cell can then
 * reach the darkest ramp step, but a "1º" chip built from the same unfiltered data
 * would still render solid `--heat-700`, looking hotter than anything on the page.
 */
function buildHeatmapTable(slots: BestTimeSlot[]): string {
  const maxVal = Math.max(...slots.map((s) => s.avg_engagement), 0) || 1;

  const cellColor = new Map<string, string>();
  for (const s of slots) {
    const step = Math.max(0, Math.min(6, Math.round(6 * (s.avg_engagement / maxVal))));
    cellColor.set(`${dayIndex(s.day)},${s.hour}`, HEAT[step]);
  }

  const head = `<tr>
        <td class="day"></td>
        ${HEAT_HOURS.map((h) => `<td class="hd">${h}h</td>`).join("")}
      </tr>`;

  const rows = DAY_SHORT.map((label, d) => {
    const cells = HEAT_HOURS.map((h) => {
      const color = cellColor.get(`${d},${h}`);
      return color ? `<td style="background:${color}"></td>` : "<td></td>";
    }).join("");
    return `<tr><td class="day">${label}</td>${cells}</tr>`;
  }).join("\n      ");

  return `<table class="heat-table">
      ${head}
      ${rows}
    </table>`;
}

/** `slots` MUST be the same filtered, in-grid array `buildHeatmapTable` used — a 7h
 * or 22h slot would otherwise produce a chip pointing at a column that does not
 * exist, and its `maxVal` would no longer match the ramp the grid actually paints. */
function buildHeatChips(slots: BestTimeSlot[]): string {
  const top = [...slots]
    .sort((a, b) => b.avg_engagement - a.avg_engagement)
    .slice(0, 3);

  return top
    .map((s, i) => {
      const label = `${DAY_FULL[dayIndex(s.day)]} · ${s.hour}h`;
      if (i === 0) {
        return `<span class="heat-chip first"><small>1º</small>${escapeHtml(label)}</span>`;
      }
      const color = HEAT[6 - i];
      return `<span class="heat-chip"><i class="rampdot" style="background:${color}"></i><small>${i + 1}º</small>${escapeHtml(label)}</span>`;
    })
    .join("\n      ");
}

const PRIO: Record<string, { cls: string; label: string }> = {
  high: { cls: "alta", label: "Prioridade alta" },
  medium: { cls: "media", label: "Prioridade média" },
  low: { cls: "baixa", label: "Prioridade baixa" },
};

/** Takes the ALREADY-capped list so the count in {{TAKEAWAY_PLANO}} can't disagree. */
function buildRecoCards(recos: AIOutput["recommendations"]): string {
  return recos
    .map((r, i) => {
      const prio = PRIO[r.priority] ?? PRIO.medium;
      return `<div class="reco-card">
      <div class="rc-n num">${i + 1}</div>
      <div>
        <div class="rc-t">${escapeHtml(r.title)}</div>
        <div class="rc-d">${escapeHtml(r.description)}</div>
      </div>
      <span class="prio ${prio.cls}">${prio.label}</span>
    </div>`;
    })
    .join("\n    ");
}

function buildGoalCards(ai: AIOutput): string {
  return (ai.suggested_goals ?? [])
    .slice(0, MAX_GOAL_CARDS)
    .map(
      (g) => `<div class="goal">
      <div class="g-metric">${escapeHtml(g.metric)}</div>
      <div class="g-target num">${escapeHtml(g.target)}</div>
      <div class="g-why">${escapeHtml(g.rationale)}</div>
    </div>`,
    )
    .join("\n    ");
}

function buildClosing(b: WorkspaceBranding): string {
  const name = escapeHtml(b.workspace_name);
  return `<div class="closing">
    <div>
      <div class="c-t">Vamos conversar sobre esse plano?</div>
      <div class="c-d">Sua equipe ${name} prepara este relatório todo mês.</div>
    </div>
    <div class="c-b">Fale com a equipe ${name}</div>
  </div>`;
}

function buildFooter(b: WorkspaceBranding, data: ReportData): string {
  return `<div class="page-footer">
    <b>${escapeHtml(b.workspace_name)}</b>
    <span>${escapeHtml(data.handle)} · ${escapeHtml(data.period.toLocaleLowerCase("pt-BR"))}</span>
    <span class="num">{{PAGE_NO}} / {{PAGE_TOTAL}}</span>
  </div>`;
}

function buildExecutiveSummary(data: ReportData, ai: AIOutput | null): string {
  // Whitespace-only passes a plain falsy check and yields a blank summary card.
  if (!ai || !ai.executive_summary || !ai.executive_summary.trim()) {
    return buildFallbackSummary(data);
  }
  return ai.executive_summary
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join("\n      ");
}

// ---------------------------------------------------------------------------
// Template plumbing
// ---------------------------------------------------------------------------

/** Literal replacement — avoids `$&`-style substitution from user content. */
function sub(html: string, token: string, value: string): string {
  return html.split(token).join(value);
}

function conditional(html: string, name: string, keep: boolean): string {
  const open = `{{#IF_${name}}}`;
  const close = `{{/IF_${name}}}`;
  if (keep) return sub(sub(html, open, ""), close, "");
  const re = new RegExp(`\\{\\{#IF_${name}\\}\\}[\\s\\S]*?\\{\\{\\/IF_${name}\\}\\}`, "g");
  return html.replace(re, "");
}

/** Sequential page + section numbering, applied after conditional stripping. */
export function numberPages(html: string): string {
  const total = (html.match(/class="page[ "]/g) || []).length;
  let page = 0;
  html = html.replace(/{{PAGE_NO}}/g, () => String(++page + 1)); // footers start on page 2
  html = html.replaceAll("{{PAGE_TOTAL}}", String(total));

  let sec = 0;
  const secTotal = (html.match(/{{SEC_NO}}/g) || []).length;
  html = html.replace(/{{SEC_NO}}/g, () => String(++sec).padStart(2, "0"));
  html = html.replaceAll("{{SEC_TOTAL}}", String(secTotal).padStart(2, "0"));
  return html;
}

// ---------------------------------------------------------------------------
// Main renderer
// ---------------------------------------------------------------------------

export function renderReport(opts: {
  data: ReportData;
  branding: WorkspaceBranding;
  aiOutput: AIOutput | null;
}): string {
  const { data, branding, aiOutput } = opts;
  const { acc, accFg } = resolveAccent(branding.accent_color ?? branding.primary_color);

  const prevName = prevMonthName(data.report_month);
  const nextName = nextMonthName(data.report_month);

  const hasAudience = data.audience !== null && data.audience !== undefined;
  // Filter ONCE — the grid, the ramp normalisation (maxVal) AND the chips must all
  // read the same in-window slots, or the "1º" chip can claim a heat the grid never
  // shows (or, if every slot is outside the window, the heading renders over a
  // blank grid). See buildHeatmapTable / buildHeatChips.
  const heatSlots: BestTimeSlot[] = data.best_times.filter((s) => HEAT_HOURS.includes(s.hour));
  const hasHeatmap = heatSlots.length > 0;
  const hasTags = data.tags_performance.length > 0;
  const hasList = data.top_posts.length > MAX_POST_CARDS;
  const hasAi = aiOutput !== null &&
    ((aiOutput.recommendations?.length ?? 0) > 0 ||
      (aiOutput.suggested_goals?.length ?? 0) > 0);
  const highlights = buildHighlights(data);
  const hasHighlights = highlights.length > 0;

  // Cap ONCE — the cards and the "N recomendações…" takeaway both read this array.
  const recos = hasAi && aiOutput
    ? (aiOutput.recommendations ?? []).slice(0, MAX_RECO_CARDS)
    : [];
  const hasRecos = recos.length > 0;

  let html = REPORT_TEMPLATE;

  // 1. Conditionals first — user content can never introduce a template token.
  html = conditional(html, "HAS_HIGHLIGHTS", hasHighlights);
  html = conditional(html, "HAS_LIST", hasList);
  html = conditional(html, "HAS_TAGS", hasTags);
  html = conditional(html, "HAS_HEATMAP", hasAudience && hasHeatmap);
  html = conditional(html, "HAS_AUDIENCE", hasAudience);
  html = conditional(html, "HAS_AI", hasAi);
  html = conditional(html, "HAS_RECOS", hasRecos);

  // 2. Footer (once per content page) — carries the page-number tokens.
  html = sub(html, "{{FOOTER}}", buildFooter(branding, data));

  // 3. Document chrome
  html = sub(html, "{{FONTS_CSS}}", REPORT_FONTS_CSS);
  html = sub(html, "{{ACCENT_VARS}}", `--acc: ${acc};\n    --acc-fg: ${accFg};`);
  html = sub(html, "{{HANDLE}}", escapeHtml(data.handle));
  html = sub(html, "{{PERIOD}}", escapeHtml(data.period));
  html = sub(html, "{{NEXT_MONTH}}", escapeHtml(nextName));

  // 4. Cover
  html = sub(html, "{{COVER_BRAND}}", buildCoverBrand(branding));
  html = sub(html, "{{COVER_MID}}", buildCoverMid(data));
  html = sub(html, "{{COVER_ART}}", buildCoverArt(branding));
  html = sub(html, "{{COVER_TEASER}}", buildCoverTeaser(data, prevName));

  // 5. Takeaways
  const tk = buildTakeaways(data, recos.length);
  html = sub(html, "{{TAKEAWAY_RESUMO}}", tk.resumo);
  html = sub(html, "{{TAKEAWAY_CRESCIMENTO}}", tk.crescimento);
  html = sub(html, "{{TAKEAWAY_FORMATOS}}", tk.formatos);
  html = sub(html, "{{TAKEAWAY_POSTS}}", tk.posts);
  html = sub(html, "{{TAKEAWAY_AUDIENCIA}}", tk.audiencia);
  html = sub(html, "{{TAKEAWAY_PLANO}}", tk.plano);

  // 6. Page 2
  html = sub(html, "{{EXECUTIVE_SUMMARY}}", buildExecutiveSummary(data, aiOutput));
  html = sub(html, "{{KPI_CARDS}}", buildKpiCards(data, prevName));
  html = sub(html, "{{HIGHLIGHTS}}", highlights);
  html = sub(html, "{{TOC_ITEMS}}", buildTocItems(nextName, hasAudience, hasAi));

  // 7. Page 3
  html = sub(html, "{{FOLLOWER_CHART}}", buildFollowerChart(data));
  html = sub(html, "{{FORMAT_CARDS}}", buildFormatCards(data));
  html = sub(html, "{{AUX_KPIS}}", buildAuxKpis(data, prevName));

  // 8. Page 4
  html = sub(html, "{{POSTS_HEADING}}", buildPostsHeading(data));
  html = sub(html, "{{TOP_POST_CARDS}}", buildTopPostCards(data.top_posts));
  html = sub(html, "{{POST_LIST_ROWS}}", hasList ? buildPostListRows(data.top_posts) : "");
  html = sub(html, "{{TAGS_HEADING}}", buildTagsHeading(data));
  html = sub(html, "{{TAGS_TABLE}}", hasTags ? buildTagsTable(data) : "");

  // 9. Page 5
  html = sub(html, "{{DEMOGRAPHICS}}", buildDemographics(data));
  html = sub(html, "{{LOCATION}}", buildLocation(data));
  html = sub(html, "{{HEATMAP_TABLE}}", hasHeatmap ? buildHeatmapTable(heatSlots) : "");
  html = sub(html, "{{HEAT_CHIPS}}", hasHeatmap ? buildHeatChips(heatSlots) : "");

  // 10. Page 6
  html = sub(html, "{{RECO_CARDS}}", buildRecoCards(recos));
  html = sub(html, "{{GOAL_CARDS}}", hasAi && aiOutput ? buildGoalCards(aiOutput) : "");
  html = sub(html, "{{CLOSING}}", hasAi ? buildClosing(branding) : "");

  return numberPages(html);
}

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
import { type Lang, intlLocale } from "../i18n/lang.ts";
import { reportTemplateText } from "../i18n/catalogs/report-template.ts";

/** Language + catalog threaded through every builder (pt output is byte-identical to before). */
interface Ctx {
  lang: Lang;
  t: ReturnType<typeof reportTemplateText>;
}

// ── fixed data palette (validated 2026-07-22 — see spec §3.2; re-validate if changed)
const FMT = { reel: "#D97706", carousel: "#0D9488", image: "#A21CAF" } as const;
const HEAT = ["#F5DCAE", "#F0CF93", "#ECC178", "#E0A344", "#CE8418", "#B26A08", "#8F5306"];
const INK = "#1C1917";
const DONUT_TRACK = "#EDECEA";

// Text-only stat markers (no emoji — see file header).
const HEART = "&#9829;";
const THUMB_PLACEHOLDER = "▨";

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
// Formatting helpers (pt-BR for pt, en-US for en)
// ---------------------------------------------------------------------------

function fmtNum(x: Ctx, n: number, d = 0): string {
  return n.toLocaleString(intlLocale(x.lang), { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** Compact number split in digits and unit: 45200 -> ["45,2", "mil"] (pt) / ["45.2", "K"] (en). */
function compactParts(x: Ctx, n: number): [string, string] {
  if (Math.abs(n) >= 1_000_000) return [fmtNum(x, n / 1_000_000, 1), x.t.unitMillion];
  if (Math.abs(n) >= 1_000) return [fmtNum(x, n / 1_000, 1), x.t.unitThousand];
  return [fmtNum(x, n), ""];
}

/** "45,2 mil" / "1,3 mi" / "310" (pt), "45.2K" / "1.3M" / "310" (en) */
function fmtCompact(x: Ctx, n: number): string {
  const [num, unit] = compactParts(x, n);
  if (!unit) return num;
  return x.lang === "en" ? num + unit : `${num} ${unit}`;
}

/** Tight variant for the dense post grid/list, as in the prototype ("42,0k"). */
function fmtStat(x: Ctx, n: number): string {
  if (Math.abs(n) >= 1_000_000) return fmtNum(x, n / 1_000_000, 1) + x.t.statMillion;
  if (Math.abs(n) >= 1_000) return fmtNum(x, n / 1_000, 1) + x.t.statThousand;
  return fmtNum(x, n);
}

function fmtKpi(x: Ctx, kpi: KpiValue, v: number): string {
  return kpi.unit === "pct" ? fmtNum(x, v, 1) + "%" : fmtCompact(x, v);
}

/** Splits a formatted KPI value into big number + small unit, as the prototype does. */
function kpiValueHtml(x: Ctx, kpi: KpiValue, v: number, signed = false): string {
  if (kpi.unit === "pct") {
    return `${escapeHtml(fmtNum(x, v, 1))}<small>%</small>`;
  }
  const [num, unit] = compactParts(x, v);
  const sign = signed && v > 0 ? "+" : "";
  if (unit) return `${escapeHtml(sign + num)}<small>${unit}</small>`;
  return escapeHtml(sign + num);
}

/** previous-month name from ReportData.report_month ("2026-06" → "maio") */
export function prevMonthName(reportMonth: string, lang: Lang): string {
  const t = reportTemplateText(lang);
  const m = parseInt(String(reportMonth ?? "").split("-")[1], 10);
  if (!m || m < 1 || m > 12) return t.prevMonthFallback;
  return t.months[(m + 10) % 12];
}

function nextMonthName(reportMonth: string, lang: Lang): string {
  const t = reportTemplateText(lang);
  const m = parseInt(String(reportMonth ?? "").split("-")[1], 10);
  if (!m || m < 1 || m > 12) return t.nextMonthFallback;
  return t.months[m % 12];
}

/** "Junho de 2026" from "2026-06"; falls back to ReportData.period. */
function coverMonthLabel(x: Ctx, data: ReportData): string {
  const parts = String(data.report_month ?? "").split("-");
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (!y || !m || m < 1 || m > 12) return data.period;
  const name = x.t.months[m - 1];
  return x.t.coverMonth(`${name.charAt(0).toUpperCase()}${name.slice(1)}`, String(y));
}

function deltaNote(x: Ctx, kpi: KpiValue | undefined, prevName: string): string {
  if (!kpi || kpi.prev === undefined || kpi.prev === null) {
    return `<span class="delta-note">${x.t.deltaVs(escapeHtml(prevName))}</span>`;
  }
  return `<span class="delta-note">${escapeHtml(prevName)}: ${escapeHtml(fmtKpi(x, kpi, kpi.prev))}</span>`;
}

function deltaChip(x: Ctx, delta: number | undefined, prevName: string): string {
  if (delta === undefined || delta === null || !isFinite(delta)) return "";
  const rounded = Math.round(delta * 10) / 10;
  if (rounded > 0) {
    return `<span class="delta up">▲ +${escapeHtml(fmtNum(x, rounded, 1))}%</span>`;
  }
  if (rounded < 0) {
    return `<span class="delta down">▼ −${escapeHtml(fmtNum(x, Math.abs(rounded), 1))}%</span>`;
  }
  return `<span class="delta flat">${x.t.deltaSame(escapeHtml(prevName))}</span>`;
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

function typeLabel(x: Ctx, type: TopPost["type"]): string {
  return type === "reel" ? x.t.typeReel : type === "carousel" ? x.t.typeCarousel : x.t.typeImage;
}
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

function buildCoverMid(x: Ctx, data: ReportData): string {
  const city = topByPct(data.audience?.top_cities)?.name;
  const spec = [data.specialty, city].filter(Boolean).join(" · ");
  const specHtml = spec ? `\n    <div class="cover-spec">${escapeHtml(spec)}</div>` : "";
  return `<div class="cover-month">${escapeHtml(coverMonthLabel(x, data))}</div>
    <div class="cover-handle">${escapeHtml(data.handle)}</div>${specHtml}`;
}

function buildCoverArt(b: WorkspaceBranding): string {
  return b.splash_base64
    ? `<div class="cover-art"><img src="${escapeHtml(b.splash_base64)}" alt=""></div>`
    : "";
}

function teaserCell(
  x: Ctx,
  label: string,
  kpi: KpiValue | undefined,
  delta: number | undefined,
  prevName: string,
  signed = false,
): string {
  if (!kpi) return "";
  const sign = signed && kpi.value > 0 ? "+" : "";
  const value = kpi.unit === "pct" ? fmtNum(x, kpi.value, 1) + "%" : sign + fmtCompact(x, kpi.value);

  const bits: string[] = [];
  const d = resolveDelta(kpi, delta);
  if (d !== undefined && isFinite(d)) {
    const rd = Math.round(d * 10) / 10;
    const arrow = rd > 0 ? "▲ +" : rd < 0 ? "▼ −" : "= ";
    bits.push(`${arrow}${fmtNum(x, Math.abs(rd), 1)}%`);
  }
  if (kpi.prev !== undefined && kpi.prev !== null) {
    bits.push(`${prevName}: ${fmtKpi(x, kpi, kpi.prev)}`);
  }
  const deltaHtml = bits.length
    ? `\n        <div class="t-delta">${escapeHtml(bits.join(" · "))}</div>`
    : "";

  return `<div>
        <div class="t-label">${escapeHtml(label)}</div>
        <div class="t-value num">${escapeHtml(value)}</div>${deltaHtml}
      </div>`;
}

function buildCoverTeaser(x: Ctx, data: ReportData, prevName: string): string {
  const k = data.kpis;
  return [
    teaserCell(x, x.t.kpiReach, k["reach"], data.kpi_deltas.reach_pct_change, prevName),
    teaserCell(x, x.t.kpiFollowersGained, k["followers_gained"], data.kpi_deltas.followers_pct_change, prevName, true),
    teaserCell(x, x.t.kpiSaves, k["saves"], data.kpi_deltas.saves_pct_change, prevName),
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

function formatEntries(x: Ctx, data: ReportData): FormatEntry[] {
  const meta = [
    { key: "reels", name: x.t.formatReels, lower: x.t.formatReelsLower, dot: "reel", cls: "fmt--reel" },
    { key: "carousels", name: x.t.formatCarousels, lower: x.t.formatCarouselsLower, dot: "car", cls: "fmt--car" },
    { key: "images", name: x.t.formatImages, lower: x.t.formatImagesLower, dot: "img", cls: "fmt--img" },
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
function buildTakeaways(x: Ctx, 
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
    { v: d.reach_pct_change, label: x.t.candReach },
    { v: d.followers_pct_change, label: x.t.candFollowers },
    { v: d.saves_pct_change, label: x.t.candSaves },
    { v: d.engagement_pct_change, label: x.t.candEngagement },
  ].filter((c) => c.v !== undefined && c.v !== null && isFinite(c.v as number)) as {
    v: number;
    label: string;
  }[];
  const best = candidates.filter((c) => c.v > 0).sort((a, b) => b.v - a.v)[0];
  if (best) {
    out.resumo = takeaway(
      x.t.takeawayMonth,
      x.t.bestGrowth(escapeHtml(best.label), escapeHtml(fmtNum(x, best.v, 1))),
    );
  } else {
    const posts = data.kpis["posts_count"]?.value;
    if (posts) {
      out.resumo = takeaway(x.t.takeawayMonth, x.t.consolidation(escapeHtml(fmtNum(x, posts))));
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
      out.crescimento = takeaway(x.t.takeawayMonth, x.t.followersUp(escapeHtml(fmtNum(x, gain))));
    } else if (gain < 0) {
      // A negative gain must not be phrased as "crescimento de −120 seguidores".
      out.crescimento = takeaway(x.t.takeawayMonth, x.t.followersDown(escapeHtml(fmtNum(x, Math.abs(gain)))));
    } else {
      out.crescimento = takeaway(x.t.takeawayMonth, x.t.followersFlat);
    }
  }

  // ── formatos
  const fmts = formatEntries(x, data).filter((f) => f.avgReach > 0);
  if (fmts.length >= 2) {
    const sorted = [...fmts].sort((a, b) => b.avgReach - a.avgReach);
    const leader = sorted[0];
    const weakest = sorted[sorted.length - 1];
    const ratio = leader.avgReach / weakest.avgReach;
    out.formatos = takeaway(
      x.t.takeawayMonth,
      x.t.formatsLeader(escapeHtml(leader.name), escapeHtml(fmtNum(x, ratio, 1)), escapeHtml(weakest.lower)),
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
        x.t.takeawayMonth,
        x.t.postsTop3(escapeHtml(fmtCompact(x, top3)), escapeHtml(String(share))),
      );
    }
  }

  // ── audiência
  const aud = data.audience;
  if (aud) {
    const genderLabel = aud.gender_split.female >= aud.gender_split.male ? x.t.women : x.t.men;
    // By share, NOT by upstream order — age buckets arrive chronologically, so
    // index 0 is the 13-17 bucket and the sentence would contradict the ranked bars.
    const age = topByPct(aud.top_age_ranges)?.range;
    const city = topByPct(aud.top_cities)?.name;
    const bits: string[] = [genderLabel];
    if (age) bits.push(x.t.ageBit(age));
    if (city) bits.push(x.t.cityBit(city));
    out.audiencia = takeaway(x.t.takeawayMonth, x.t.audienceCore(escapeHtml(bits.join(" "))));
  }

  // ── plano
  const n = recoCount;
  if (n > 0) {
    out.plano = takeaway(
      x.t.takeawayPlan,
      n === 1 ? x.t.planOne(escapeHtml(fmtNum(x, n))) : x.t.planMany(escapeHtml(fmtNum(x, n))),
    );
  }

  return out;
}

function kpiCard(
  x: Ctx,
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
      <div class="k-value num">${kpiValueHtml(x, kpi, kpi.value, signed)}</div>
      ${deltaChip(x, delta, prevName)}
      ${deltaNote(x, kpi, prevName)}
    </div>`;
}

function buildKpiCards(x: Ctx, data: ReportData, prevName: string): string {
  const k = data.kpis;
  return [
    kpiCard(x, x.t.kpiFollowersGained, k["followers_gained"], data.kpi_deltas.followers_pct_change, prevName, true),
    kpiCard(x, x.t.kpiEngagement, k["engagement_rate"], data.kpi_deltas.engagement_pct_change, prevName),
    kpiCard(x, x.t.kpiReach, k["reach"], data.kpi_deltas.reach_pct_change, prevName),
    kpiCard(x, x.t.kpiSaves, k["saves"], data.kpi_deltas.saves_pct_change, prevName),
  ]
    .filter(Boolean)
    .join("\n    ");
}

function buildAuxKpis(x: Ctx, data: ReportData, prevName: string): string {
  const k = data.kpis;
  return [
    kpiCard(x, x.t.kpiPosts, k["posts_count"], undefined, prevName),
    kpiCard(x, x.t.kpiProfileViews, k["profile_views"], data.kpi_deltas.profile_views_pct_change, prevName),
    kpiCard(x, x.t.kpiWebsiteClicks, k["website_clicks"], data.kpi_deltas.website_clicks_pct_change, prevName),
  ]
    .filter(Boolean)
    .join("\n    ");
}

function buildHighlights(x: Ctx, data: ReportData): string {
  const cards: string[] = [];

  const best = data.top_posts[0];
  if (best) {
    const desc = [
      typeLabel(x, best.type),
      x.t.engagementOf(fmtNum(x, best.engagement, 1)),
      x.t.savesCount(fmtNum(x, best.saves)),
    ].join(" · ");
    cards.push(`<div class="hl">
      <div class="h-label">${x.t.bestPost}</div>
      <div class="h-big num">${escapeHtml(fmtCompact(x, best.reach))} <span class="unit">${x.t.ofReach}</span></div>
      <div class="h-caption">“${escapeHtml(best.caption_preview)}”</div>
      <div class="h-desc"><i class="dot ${TYPE_DOT[best.type]}"></i>${escapeHtml(desc)}</div>
    </div>`);
  }

  const fmts = formatEntries(x, data);
  if (fmts.length > 0) {
    const total = fmts.reduce((s, f) => s + f.count, 0);
    const chips = fmts
      .map(
        (f) =>
          `<div class="m-chip"><div class="m-n num">${escapeHtml(fmtNum(x, f.count))}</div><div class="m-t"><i class="dot ${f.dot}"></i>${escapeHtml(f.name)}</div></div>`,
      )
      .join("\n        ");
    cards.push(`<div class="hl">
      <div class="h-label">${x.t.publishedContent}</div>
      <div class="h-big num">${escapeHtml(fmtNum(x, total))} <span class="unit">${total === 1 ? x.t.postOne : x.t.postMany}</span></div>
      <div class="mix">
        ${chips}
      </div>
    </div>`);
  }

  return cards.join("\n    ");
}

function buildTocItems(x: Ctx, nextMonth: string, hasAudience: boolean, hasAi: boolean): string {
  const titles = [x.t.tocGrowth, x.t.tocPosts];
  if (hasAudience) titles.push(x.t.secAudience);
  if (hasAi) titles.push(x.t.tocPlan(nextMonth));

  return titles
    .map(
      (t, i) =>
        `<div class="toc-item"><div class="tc-n">${String(i + 2).padStart(2, "0")}</div><div class="tc-t">${escapeHtml(t)}</div></div>`,
    )
    .join("\n    ");
}

function buildFollowerChart(x: Ctx, data: ReportData): string {
  const trend = data.follower_trend;
  if (trend.length === 0) {
    return `<div class="empty">${x.t.followersEmpty}</div>`;
  }

  const gainKpi = data.kpis["followers_gained"];
  const gain = gainKpi
    ? gainKpi.value
    : trend[trend.length - 1].count - trend[0].count;
  const annotation = x.t.inMonth(`${gain > 0 ? "+" : ""}${fmtNum(x, gain)}`);

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
    if (bestIdx > 0) eventMarker = { index: bestIdx, label: x.t.biggestJump };
  }

  return lineChart({
    lang: x.lang,
    data: trend.map((p) => ({ label: p.date, value: p.count })),
    width: 680,
    height: 232,
    color: INK,
    annotation,
    eventMarker,
  });
}

function buildFormatCards(x: Ctx, data: ReportData): string {
  const fmts = formatEntries(x, data);
  if (fmts.length === 0) {
    return `<div class="empty">${x.t.formatsEmpty}</div>`;
  }
  const maxReach = Math.max(...fmts.map((f) => f.avgReach), 1);
  const leaderKey = [...fmts].sort((a, b) => b.avgReach - a.avgReach)[0].key;

  return fmts
    .map((f) => {
      const isLead = f.key === leaderKey && fmts.length > 1;
      const width = Math.max(2, Math.round((f.avgReach / maxReach) * 100));
      const chip = isLead ? `<span class="lead-chip">${x.t.leadChip}</span>` : "";
      return `<div class="fmt${isLead ? " lead" : ""} ${f.cls}">
      <div class="f-head"><span class="f-name">${escapeHtml(f.name)}${chip}</span><span class="f-count num">${escapeHtml(fmtNum(x, f.count))} ${f.count === 1 ? x.t.postOne : x.t.postMany}</span></div>
      <div class="f-reach num">${escapeHtml(fmtCompact(x, f.avgReach))}</div>
      <div class="f-reach-l">${x.t.avgReachLabel}</div>
      <div class="f-bar"><i style="width:${width}%"></i></div>
      <div class="f-eng"><span class="f-eng-l">${x.t.thAvgEngagement}</span><span class="f-eng-v num">${escapeHtml(fmtNum(x, f.avgEngagement * 100, 1))}%</span></div>
    </div>`;
    })
    .join("\n    ");
}

/**
 * Grid density for page 4. Under the default 3-up grid a light month leaves most
 * of the A4 sheet blank, so when the cards are the page's only content the grid
 * widens them to fill it. Each step was measured against the A4 box with
 * worst-case captions — see the `.post-grid` page-fit note in template-string.ts.
 *
 * `busy` (list rows or topics table also on the page) returns no modifier: that
 * page is already tuned to fit, and widening the cards would push a 7th sheet.
 */
function postGridModifier(count: number, busy: boolean): string {
  if (count === 0 || busy) return "";
  if (count === 1) return "pg-solo";
  if (count === 2) return "pg-duo";
  if (count <= 4) return "pg-quad";
  if (count <= MAX_POST_CARDS) return "pg-six";
  return "";
}

function buildTopPostCards(x: Ctx, posts: TopPost[]): string {
  if (posts.length === 0) {
    return `<div class="empty">${x.t.postsEmpty}</div>`;
  }
  return posts
    .slice(0, MAX_POST_CARDS)
    .map((p, i) => {
      const thumb = p.thumbnail_base64
        ? `<img src="${escapeHtml(p.thumbnail_base64)}" alt="">`
        : THUMB_PLACEHOLDER;
      return `<div class="post">
      <div class="p-thumb">${thumb}<div class="p-rank num">${i + 1}</div><div class="p-type"><i class="dot ${TYPE_DOT[p.type]}"></i>${escapeHtml(typeLabel(x, p.type))}</div></div>
      <div class="p-body">
        <div class="p-caption">${escapeHtml(p.caption_preview)}</div>
        <div class="p-stats num"><span><b>${escapeHtml(fmtStat(x, p.reach))}</b> ${x.t.statReach}</span><span><b>${escapeHtml(fmtStat(x, p.likes))}</b> ${HEART}</span><span><b>${escapeHtml(fmtStat(x, p.comments))}</b> ${x.t.statComments}</span><span><b>${escapeHtml(fmtStat(x, p.saves))}</b> ${x.t.statSaves}</span></div>
      </div>
    </div>`;
    })
    .join("\n    ");
}

function buildPostListRows(x: Ctx, posts: TopPost[]): string {
  return posts
    .slice(MAX_POST_CARDS, MAX_POST_CARDS + MAX_POST_ROWS)
    .map(
      (p, i) => `<div class="r-row">
      <span class="r-rank num">${MAX_POST_CARDS + i + 1}</span>
      <span class="r-cap"><i class="dot ${TYPE_DOT[p.type]}"></i>${escapeHtml(p.caption_preview)}</span>
      <span class="r-m num"><b>${escapeHtml(fmtStat(x, p.reach))}</b> ${x.t.statReach}</span>
      <span class="r-m num hide-m"><b>${escapeHtml(fmtStat(x, p.likes))}</b> ${HEART}</span>
      <span class="r-m num hide-m"><b>${escapeHtml(fmtStat(x, p.saves))}</b> ${x.t.statSaves}</span>
    </div>`,
    )
    .join("\n    ");
}

/**
 * Page 4 shows at most 6 cards + 6 list rows, and upstream itself already caps
 * `top_posts` at the 15 best. Whenever anything was left out the heading says how
 * many publications the page actually covers.
 */
function buildPostsHeading(x: Ctx, data: ReportData): string {
  const shown = Math.min(data.top_posts.length, MAX_POST_CARDS + MAX_POST_ROWS);
  const published = data.kpis["posts_count"]?.value;
  const total = typeof published === "number" && published > data.top_posts.length
    ? published
    : data.top_posts.length;
  return total > shown
    ? x.t.postsHeadingTop(escapeHtml(fmtNum(x, shown)))
    : x.t.postsHeadingAll;
}

function buildTagsHeading(x: Ctx, data: ReportData): string {
  const total = data.tags_performance.length;
  const shown = Math.min(total, MAX_TAG_ROWS);
  return total > shown
    ? x.t.tagsHeadingTop(escapeHtml(fmtNum(x, shown)))
    : x.t.tagsHeadingAll;
}

function buildTagsTable(x: Ctx, data: ReportData): string {
  const tags = [...data.tags_performance]
    .sort((a, b) => b.avg_reach - a.avg_reach)
    .slice(0, MAX_TAG_ROWS);
  const maxReach = Math.max(...tags.map((t) => t.avg_reach), 1);

  return tags
    .map((t) => {
      const w = Math.max(6, Math.round((t.avg_reach / maxReach) * 110));
      return `<tr>
          <td class="t-name"><span>${escapeHtml(t.tag)}</span></td><td class="num">${escapeHtml(fmtNum(x, t.count))}</td>
          <td><span class="t-bar" style="width:${w}px"></span><span class="num">${escapeHtml(fmtCompact(x, t.avg_reach))}</span></td>
          <td class="r num">${escapeHtml(fmtNum(x, t.avg_engagement, 1))}%</td>
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

function barRow(x: Ctx, label: string, pct: number, maxPct: number, alt = false): string {
  const w = Math.max(2, Math.min(100, Math.round((pct / (maxPct || 1)) * 100)));
  return `<div class="bar-row"><span class="b-l">${escapeHtml(label)}</span><div class="b-track"><div class="b-fill${alt ? " alt" : ""}" style="width:${w}%"></div></div><span class="b-v num">${escapeHtml(fmtNum(x, pct, 1))}%</span></div>`;
}

function buildDemographics(x: Ctx, data: ReportData): string {
  const aud = data.audience;
  if (!aud) return "";

  // Ring donut, per the prototype: neutral ink arc on a light track with the
  // dominant share called out in the centre. The brand accent is NOT used here.
  const female = aud.gender_split?.female ?? 0;
  const male = aud.gender_split?.male ?? 0;
  const dominantPct = female >= male ? female : male;
  const dominantLabel = female >= male ? x.t.genderFemaleLower : x.t.genderMaleLower;
  const circumference = 2 * Math.PI * 45;
  const dash = Math.round((Math.max(0, Math.min(100, dominantPct)) / 100) * circumference * 10) / 10;

  const donut = `<div class="panel">
      <div class="pn-label">${x.t.gender}</div>
      <div class="donut-wrap">
        <svg width="132" height="132" viewBox="0 0 132 132">
          <circle cx="66" cy="66" r="45" fill="none" stroke="${DONUT_TRACK}" stroke-width="17"/>
          <circle cx="66" cy="66" r="45" fill="none" stroke="${INK}" stroke-width="17"
                  stroke-dasharray="${dash} ${Math.round(circumference * 10) / 10}" stroke-linecap="butt" transform="rotate(-90 66 66)"/>
          <text x="66" y="63" text-anchor="middle" style="font-family:'Fraunces',serif;font-size:20px;font-weight:600;fill:${INK}">${escapeHtml(fmtNum(x, dominantPct, 0))}%</text>
          <text x="66" y="79" text-anchor="middle" style="font-family:'Instrument Sans',sans-serif;font-size:9px;fill:#8A8A8A">${escapeHtml(dominantLabel)}</text>
        </svg>
        <div class="legend">
          <span><i style="background:${INK}"></i>${x.t.genderFemale} ${escapeHtml(fmtNum(x, female, 0))}%</span>
          <span><i style="background:#D6D3D1"></i>${x.t.genderMale} ${escapeHtml(fmtNum(x, male, 0))}%</span>
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
    ? ages.map((a) => barRow(x, a.range.replace(/-/g, "–"), a.pct, maxAge)).join("\n        ")
    : `<div class="empty">${x.t.ageEmpty}</div>`;

  const agePanel = `<div class="panel">
      <div class="pn-label">${topNLabel(x.t.ageLabel, x.t.ageLabelTop, allAges.length, ages.length)}</div>
      <div class="bars">
        ${ageBars}
      </div>
    </div>`;

  return `${donut}\n    ${agePanel}`;
}

function buildLocation(x: Ctx, data: ReportData): string {
  const aud = data.audience;
  if (!aud) return "";

  // Sort before slicing (see buildDemographics) so the cap always drops the
  // smallest shares and the bars read as a ranking.
  const allCities = [...(aud.top_cities ?? [])].sort((a, b) => b.pct - a.pct);
  const cities = allCities.slice(0, MAX_CITY_ROWS);
  const maxCity = Math.max(...cities.map((c) => c.pct), 1);
  const cityBars = cities.length
    ? cities.map((c) => barRow(x, c.name, c.pct, maxCity)).join("\n        ")
    : `<div class="empty">${x.t.cityEmpty}</div>`;

  const allCountries = [...(aud.top_countries ?? [])].sort((a, b) => b.pct - a.pct);
  const countries = allCountries.slice(0, MAX_COUNTRY_ROWS);
  const maxCountry = Math.max(...countries.map((c) => c.pct), 1);
  const countryBars = countries.length
    ? countries.map((c) => barRow(x, c.name, c.pct, maxCountry, true)).join("\n        ")
    : `<div class="empty">${x.t.countryEmpty}</div>`;

  return `<div class="panel">
      <div class="pn-label">${topNLabel(x.t.cityLabel, x.t.cityLabelTop, allCities.length, cities.length)}</div>
      <div class="bars">
        ${cityBars}
      </div>
    </div>
    <div class="panel">
      <div class="pn-label">${topNLabel(x.t.countryLabel, x.t.countryLabelTop, allCountries.length, countries.length)}</div>
      <div class="bars">
        ${countryBars}
      </div>
    </div>`;
}

/**
 * Exported so the generator's `mappers.test.ts` can assert that every label
 * `mapBestTimes` emits resolves here — the two ends must never drift apart, or
 * `dayIndex()`'s `?? 0` fallback would silently relabel every slot as Monday.
 */
export const DAY_INDEX: Record<string, number> = {
  seg: 0, ter: 1, qua: 2, qui: 3, sex: 4, sab: 5, dom: 6,
  segunda: 0, terça: 1, terca: 1, quarta: 2, quinta: 3, sexta: 4, sábado: 5, sabado: 5, domingo: 6,
  mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6,
};
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
function buildHeatmapTable(x: Ctx, slots: BestTimeSlot[]): string {
  const maxVal = Math.max(...slots.map((s) => s.avg_engagement), 0) || 1;

  const cellColor = new Map<string, string>();
  for (const s of slots) {
    const step = Math.max(0, Math.min(6, Math.round(6 * (s.avg_engagement / maxVal))));
    cellColor.set(`${dayIndex(s.day)},${s.hour}`, HEAT[step]);
  }

  const head = `<tr>
        <td class="day"></td>
        ${HEAT_HOURS.map((h) => `<td class="hd">${x.t.hourShort(h)}</td>`).join("")}
      </tr>`;

  const rows = x.t.daysShort.map((label, d) => {
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
function buildHeatChips(x: Ctx, slots: BestTimeSlot[]): string {
  const top = [...slots]
    .sort((a, b) => b.avg_engagement - a.avg_engagement)
    .slice(0, 3);

  return top
    .map((s, i) => {
      const label = `${x.t.daysFull[dayIndex(s.day)]} · ${x.t.hourLong(s.hour)}`;
      if (i === 0) {
        return `<span class="heat-chip first"><small>${x.t.ranks[0]}</small>${escapeHtml(label)}</span>`;
      }
      const color = HEAT[6 - i];
      return `<span class="heat-chip"><i class="rampdot" style="background:${color}"></i><small>${x.t.ranks[i]}</small>${escapeHtml(label)}</span>`;
    })
    .join("\n      ");
}

const PRIO_CLS: Record<string, string> = { high: "alta", medium: "media", low: "baixa" };
function prioLabel(x: Ctx, cls: string): string {
  return cls === "alta" ? x.t.prioHigh : cls === "baixa" ? x.t.prioLow : x.t.prioMedium;
}

/** Takes the ALREADY-capped list so the count in {{TAKEAWAY_PLANO}} can't disagree. */
function buildRecoCards(x: Ctx, recos: AIOutput["recommendations"]): string {
  return recos
    .map((r, i) => {
      const prioCls = PRIO_CLS[r.priority] ?? PRIO_CLS.medium;
      return `<div class="reco-card">
      <div class="rc-n num">${i + 1}</div>
      <div>
        <div class="rc-t">${escapeHtml(r.title)}</div>
        <div class="rc-d">${escapeHtml(r.description)}</div>
      </div>
      <span class="prio ${prioCls}">${prioLabel(x, prioCls)}</span>
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

function buildClosing(x: Ctx, b: WorkspaceBranding): string {
  const name = escapeHtml(b.workspace_name);
  return `<div class="closing">
    <div>
      <div class="c-t">${x.t.closingTitle}</div>
      <div class="c-d">${x.t.closingText(name)}</div>
    </div>
    <div class="c-b">${x.t.closingButton(name)}</div>
  </div>`;
}

function buildFooter(x: Ctx, b: WorkspaceBranding, data: ReportData): string {
  return `<div class="page-footer">
    <b>${escapeHtml(b.workspace_name)}</b>
    <span>${escapeHtml(data.handle)} · ${escapeHtml(x.t.footerPeriod(data.period))}</span>
    <span class="num">{{PAGE_NO}} / {{PAGE_TOTAL}}</span>
  </div>`;
}

function buildExecutiveSummary(x: Ctx, data: ReportData, ai: AIOutput | null): string {
  // Whitespace-only passes a plain falsy check and yields a blank summary card.
  if (!ai || !ai.executive_summary || !ai.executive_summary.trim()) {
    return buildFallbackSummary(data, x.lang);
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
  /** Workspace language of the report. Required so every caller decides it. */
  lang: Lang;
}): string {
  const { data, branding, aiOutput, lang } = opts;
  const x: Ctx = { lang, t: reportTemplateText(lang) };
  const { acc, accFg } = resolveAccent(branding.accent_color);

  const prevName = prevMonthName(data.report_month, lang);
  const nextName = nextMonthName(data.report_month, lang);

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
  const highlights = buildHighlights(x, data);
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

  // 1b. Static labels of the template, before any user content is interpolated
  html = sub(html, "{{L_HTML_LANG}}", x.t.htmlLang);
  html = sub(html, "{{L_COVER_DOC}}", x.t.coverDoc);
  html = sub(html, "{{L_SEC_SUMMARY}}", x.t.secSummary);
  html = sub(html, "{{L_SEC_KPIS}}", x.t.secKpis);
  html = sub(html, "{{L_SEC_HIGHLIGHTS}}", x.t.secHighlights);
  html = sub(html, "{{L_SEC_TOC}}", x.t.secToc);
  html = sub(html, "{{L_SEC_FOLLOWERS}}", x.t.secFollowers);
  html = sub(html, "{{L_SEC_FORMATS}}", x.t.secFormats);
  html = sub(html, "{{L_SEC_AUX}}", x.t.secAux);
  html = sub(html, "{{L_TH_TOPIC}}", x.t.thTopic);
  html = sub(html, "{{L_TH_POSTS}}", x.t.thPosts);
  html = sub(html, "{{L_TH_AVG_REACH}}", x.t.thAvgReach);
  html = sub(html, "{{L_TH_AVG_ENGAGEMENT}}", x.t.thAvgEngagement);
  html = sub(html, "{{L_SEC_AUDIENCE}}", x.t.secAudience);
  html = sub(html, "{{L_SEC_LOCATION}}", x.t.secLocation);
  html = sub(html, "{{L_SEC_HEAT}}", x.t.secHeat);

  // 2. Footer (once per content page) — carries the page-number tokens.
  html = sub(html, "{{FOOTER}}", buildFooter(x, branding, data));

  // 3. Document chrome
  html = sub(html, "{{FONTS_CSS}}", REPORT_FONTS_CSS);
  html = sub(html, "{{ACCENT_VARS}}", `--acc: ${acc};\n    --acc-fg: ${accFg};`);
  html = sub(html, "{{L_DOC_TITLE}}", x.t.docTitle(escapeHtml(data.handle), escapeHtml(data.period)));
  html = sub(html, "{{L_SEC_RECOS}}", x.t.secRecos(escapeHtml(nextName)));
  html = sub(html, "{{L_SEC_GOALS}}", x.t.secGoals(escapeHtml(nextName)));
  html = sub(html, "{{HANDLE}}", escapeHtml(data.handle));
  html = sub(html, "{{PERIOD}}", escapeHtml(data.period));
  html = sub(html, "{{NEXT_MONTH}}", escapeHtml(nextName));

  // 4. Cover
  html = sub(html, "{{COVER_BRAND}}", buildCoverBrand(branding));
  html = sub(html, "{{COVER_MID}}", buildCoverMid(x, data));
  html = sub(html, "{{COVER_ART}}", buildCoverArt(branding));
  html = sub(html, "{{COVER_TEASER}}", buildCoverTeaser(x, data, prevName));

  // 5. Takeaways
  const tk = buildTakeaways(x, data, recos.length);
  html = sub(html, "{{TAKEAWAY_RESUMO}}", tk.resumo);
  html = sub(html, "{{TAKEAWAY_CRESCIMENTO}}", tk.crescimento);
  html = sub(html, "{{TAKEAWAY_FORMATOS}}", tk.formatos);
  html = sub(html, "{{TAKEAWAY_POSTS}}", tk.posts);
  html = sub(html, "{{TAKEAWAY_AUDIENCIA}}", tk.audiencia);
  html = sub(html, "{{TAKEAWAY_PLANO}}", tk.plano);

  // 6. Page 2
  html = sub(html, "{{EXECUTIVE_SUMMARY}}", buildExecutiveSummary(x, data, aiOutput));
  html = sub(html, "{{KPI_CARDS}}", buildKpiCards(x, data, prevName));
  html = sub(html, "{{HIGHLIGHTS}}", highlights);
  html = sub(html, "{{TOC_ITEMS}}", buildTocItems(x, nextName, hasAudience, hasAi));

  // 7. Page 3
  html = sub(html, "{{FOLLOWER_CHART}}", buildFollowerChart(x, data));
  html = sub(html, "{{FORMAT_CARDS}}", buildFormatCards(x, data));
  html = sub(html, "{{AUX_KPIS}}", buildAuxKpis(x, data, prevName));

  // 8. Page 4
  html = sub(html, "{{POSTS_HEADING}}", buildPostsHeading(x, data));
  html = sub(
    html,
    "{{POST_GRID_MOD}}",
    postGridModifier(data.top_posts.length, hasList || hasTags),
  );
  html = sub(html, "{{TOP_POST_CARDS}}", buildTopPostCards(x, data.top_posts));
  html = sub(html, "{{POST_LIST_ROWS}}", hasList ? buildPostListRows(x, data.top_posts) : "");
  html = sub(html, "{{TAGS_HEADING}}", buildTagsHeading(x, data));
  html = sub(html, "{{TAGS_TABLE}}", hasTags ? buildTagsTable(x, data) : "");

  // 9. Page 5
  html = sub(html, "{{DEMOGRAPHICS}}", buildDemographics(x, data));
  html = sub(html, "{{LOCATION}}", buildLocation(x, data));
  html = sub(html, "{{HEATMAP_TABLE}}", hasHeatmap ? buildHeatmapTable(x, heatSlots) : "");
  html = sub(html, "{{HEAT_CHIPS}}", hasHeatmap ? buildHeatChips(x, heatSlots) : "");

  // 10. Page 6
  html = sub(html, "{{RECO_CARDS}}", buildRecoCards(x, recos));
  html = sub(html, "{{GOAL_CARDS}}", hasAi && aiOutput ? buildGoalCards(aiOutput) : "");
  html = sub(html, "{{CLOSING}}", hasAi ? buildClosing(x, branding) : "");

  return numberPages(html);
}

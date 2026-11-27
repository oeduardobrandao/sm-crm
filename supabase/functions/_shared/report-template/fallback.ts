import { escapeHtml } from "./escape.ts";
import type { ReportData } from "./types.ts";
import { type Lang, intlLocale } from "../i18n/lang.ts";
import { reportTemplateText } from "../i18n/catalogs/report-template.ts";

/**
 * Formats a number in the report locale (pt-BR: dot as thousands separator, comma as decimal
 * separator; en-US: the reverse).
 */
function fmtNumber(lang: Lang, value: number, decimals = 0): string {
  return value.toLocaleString(intlLocale(lang), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Formats a delta percentage with sign, using pt-BR locale (comma decimal).
 * Returns empty string if delta is nullish.
 */
function fmtDelta(lang: Lang, delta: number | undefined): string {
  if (delta === undefined || delta === null) return "";
  const sign = delta >= 0 ? "+" : "";
  return ` (${sign}${fmtNumber(lang, delta, 1)}%)`;
}

/**
 * Builds a bullet-point HTML summary of the report period.
 * Numbers are formatted with pt-BR locale (dot for thousands, comma for decimals).
 * All user-supplied strings are passed through escapeHtml.
 */
export function buildFallbackSummary(data: ReportData, lang: Lang): string {
  const t = reportTemplateText(lang);
  const { kpis, kpi_deltas } = data;

  const followersGained = kpis["followers_gained"]?.value ?? 0;
  const reach = kpis["reach"]?.value ?? 0;
  const engagementRate = kpis["engagement_rate"]?.value ?? 0;
  const postsCount = kpis["posts_count"]?.value ?? 0;

  const followersDelta = fmtDelta(lang, kpi_deltas.followers_pct_change);
  const reachDelta = fmtDelta(lang, kpi_deltas.reach_pct_change);
  const engagementDelta = fmtDelta(lang, kpi_deltas.engagement_pct_change);

  const followersStr = escapeHtml(fmtNumber(lang, followersGained));
  const reachStr = escapeHtml(fmtNumber(lang, reach));
  const engagementStr = escapeHtml(fmtNumber(lang, engagementRate, 1));
  const postsStr = escapeHtml(fmtNumber(lang, postsCount));

  return `<ul>
  <li><strong>${t.fbFollowers}</strong> ${followersStr}${escapeHtml(followersDelta)}</li>
  <li><strong>${t.fbReach}</strong> ${reachStr}${escapeHtml(reachDelta)}</li>
  <li><strong>${t.fbEngagement}</strong> ${engagementStr}%${escapeHtml(engagementDelta)}</li>
  <li><strong>${t.fbPosts}</strong> ${postsStr}</li>
</ul>`;
}


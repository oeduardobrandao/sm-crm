import { escapeHtml } from "./escape.ts";
import type { ReportData } from "./types.ts";

/**
 * Formats a number using pt-BR locale conventions:
 * dot as thousands separator, comma as decimal separator.
 */
function fmtNumber(value: number, decimals = 0): string {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Formats a delta percentage with sign, using pt-BR locale (comma decimal).
 * Returns empty string if delta is nullish.
 */
function fmtDelta(delta: number | undefined): string {
  if (delta === undefined || delta === null) return "";
  const sign = delta >= 0 ? "+" : "";
  return ` (${sign}${fmtNumber(delta, 1)}%)`;
}

/**
 * Builds a bullet-point HTML summary of the report period.
 * Numbers are formatted with pt-BR locale (dot for thousands, comma for decimals).
 * All user-supplied strings are passed through escapeHtml.
 */
export function buildFallbackSummary(data: ReportData): string {
  const { kpis, kpi_deltas } = data;

  const followersGained = kpis["followers_gained"]?.value ?? 0;
  const reach = kpis["reach"]?.value ?? 0;
  const engagementRate = kpis["engagement_rate"]?.value ?? 0;
  const postsCount = kpis["posts_count"]?.value ?? 0;

  const followersDelta = fmtDelta(kpi_deltas.followers_pct_change);
  const reachDelta = fmtDelta(kpi_deltas.reach_pct_change);
  const engagementDelta = fmtDelta(kpi_deltas.engagement_pct_change);

  const followersStr = escapeHtml(fmtNumber(followersGained));
  const reachStr = escapeHtml(fmtNumber(reach));
  const engagementStr = escapeHtml(fmtNumber(engagementRate, 1));
  const postsStr = escapeHtml(fmtNumber(postsCount));

  return `<ul>
  <li><strong>Novos seguidores:</strong> ${followersStr}${escapeHtml(followersDelta)}</li>
  <li><strong>Alcance total:</strong> ${reachStr}${escapeHtml(reachDelta)}</li>
  <li><strong>Taxa de engajamento:</strong> ${engagementStr}%${escapeHtml(engagementDelta)}</li>
  <li><strong>Publicações:</strong> ${postsStr}</li>
</ul>`;
}


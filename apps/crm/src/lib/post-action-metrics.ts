// Per-post "ações" metrics from Instagram media insights: reposts, profile
// visits, new followers (follows) and bio link taps. `null` means no data
// (never fetched, or Instagram didn't return it) and renders as "—", never 0.
// Spec: docs/superpowers/specs/2026-09-29-instagram-post-action-metrics-design.md

export type ActionMetricKey = 'reposts' | 'profile_visits' | 'follows' | 'bio_link_clicks';
export type ActionSortKey = ActionMetricKey | 'follows_per_mil_reach';

export const ACTION_SORT_KEYS: readonly ActionSortKey[] = [
  'reposts',
  'profile_visits',
  'follows',
  'bio_link_clicks',
  'follows_per_mil_reach',
];

export function toNullableCount(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** New followers per 1.000 accounts reached. Reach, not views: both count people. */
export function followsPerMilReach(
  follows: number | null,
  reach: number | null | undefined,
): number | null {
  if (follows === null || typeof reach !== 'number' || reach <= 0) return null;
  return (follows / reach) * 1000;
}

/** Numeric comparator that always puts null/undefined last, whatever the direction. */
export function compareNullableNumber(
  a: number | null | undefined,
  b: number | null | undefined,
  dir: 'asc' | 'desc',
): number {
  const aMissing = a === null || a === undefined;
  const bMissing = b === null || b === undefined;
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  return dir === 'asc' ? a - b : b - a;
}

/** Tooltip for a "—": did the last sync ask and get nothing, or was it never fetched? */
export function missingActionMetricTitle(
  metric: ActionMetricKey,
  unavailable: readonly string[] | null | undefined,
): string {
  return unavailable?.includes(metric)
    ? 'O Instagram não retornou este dado para este post'
    : 'Sem dado para este post ainda';
}

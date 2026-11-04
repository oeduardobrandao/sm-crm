// Pure rules of the `/analytics/google` portfolio page (spec 2026-11-03 §5.1): highlights,
// specialty groups, units that need attention and the units table sort. Every number comes
// from the server's per-unit rows; nothing here re-derives a metric.
import type { GbpPortfolioUnit } from '../../services/gbpAnalytics';

export type GbpHighlightKind = 'actions' | 'growth' | 'rating' | 'newReviews';

export interface GbpHighlight {
  kind: GbpHighlightKind;
  unit: GbpPortfolioUnit;
  /** Actions, growth as a ratio (0.5 = +50%), rating or new reviews. */
  value: number;
}

export interface GbpSpecialtyStat {
  specialty: string;
  count: number;
  viewsPerUnit: number;
  actionsPerUnit: number;
  /** Weighted by each unit's review count; null when no unit of the group has a rating. */
  avgRating: number | null;
}

export type GbpUnitSortCol =
  | 'title'
  | 'profileViews'
  | 'calls'
  | 'directions'
  | 'websiteClicks'
  | 'messages'
  | 'avgRating'
  | 'newReviews'
  | 'lastSyncedAt';

/** "10 → 30" is not "+200%": growth needs a covered previous window with at least this. */
export const GROWTH_MIN_PREV_VIEWS = 50;
/** A rating from a handful of reviews is not "the best". */
export const BEST_RATING_MIN_REVIEWS = 10;

const collator = new Intl.Collator('pt-BR');
const titleOf = (u: GbpPortfolioUnit) => u.title ?? '';

/** The unit with the highest score (null scores are not eligible); ties break by title. */
function leader(
  units: GbpPortfolioUnit[],
  score: (u: GbpPortfolioUnit) => number | null,
): { unit: GbpPortfolioUnit; value: number } | null {
  let best: { unit: GbpPortfolioUnit; value: number } | null = null;
  for (const unit of units) {
    const value = score(unit);
    if (value === null) continue;
    if (
      !best ||
      value > best.value ||
      (value === best.value && collator.compare(titleOf(unit), titleOf(best.unit)) < 0)
    ) {
      best = { unit, value };
    }
  }
  return best;
}

export function growthOf(u: GbpPortfolioUnit): number | null {
  if (u.prevProfileViews === null || u.prevProfileViews < GROWTH_MIN_PREV_VIEWS) return null;
  return (u.profileViews - u.prevProfileViews) / u.prevProfileViews;
}

/** "Destaques do período": a card with no eligible unit is left out. */
export function highlightsFor(units: GbpPortfolioUnit[]): GbpHighlight[] {
  // Actions and growth need a value above 0, so a "0 ações" or negative-growth leader never shows.
  const rules: [GbpHighlightKind, (u: GbpPortfolioUnit) => number | null][] = [
    ['actions', (u) => (u.actions > 0 ? u.actions : null)],
    [
      'growth',
      (u) => {
        const g = growthOf(u);
        return g !== null && g > 0 ? g : null;
      },
    ],
    ['rating', (u) => ((u.reviewCount ?? 0) >= BEST_RATING_MIN_REVIEWS ? u.avgRating : null)],
    ['newReviews', (u) => (u.newReviews !== null && u.newReviews > 0 ? u.newReviews : null)],
  ];
  const out: GbpHighlight[] = [];
  for (const [kind, score] of rules) {
    const hit = leader(units, score);
    if (hit) out.push({ kind, ...hit });
  }
  return out;
}

/** Review-count-weighted rating, as the client tab's Nota média. */
function weightedRating(units: GbpPortfolioUnit[]): number | null {
  let sum = 0;
  let weight = 0;
  for (const u of units) {
    if (u.avgRating === null || !u.reviewCount) continue;
    sum += u.avgRating * u.reviewCount;
    weight += u.reviewCount;
  }
  return weight > 0 ? sum / weight : null;
}

/** "Comparativo por especialidade": groups of 2+ units with a specialty, largest first. */
export function specialtyStatsFor(units: GbpPortfolioUnit[]): GbpSpecialtyStat[] {
  const groups = new Map<string, GbpPortfolioUnit[]>();
  for (const u of units) {
    if (!u.especialidade) continue;
    const list = groups.get(u.especialidade);
    if (list) list.push(u);
    else groups.set(u.especialidade, [u]);
  }
  return [...groups.entries()]
    .filter(([, list]) => list.length >= 2)
    .map(([specialty, list]) => ({
      specialty,
      count: list.length,
      viewsPerUnit: list.reduce((s, u) => s + u.profileViews, 0) / list.length,
      actionsPerUnit: list.reduce((s, u) => s + u.actions, 0) / list.length,
      avgRating: weightedRating(list),
    }))
    .sort((a, b) => b.count - a.count || collator.compare(a.specialty, b.specialty));
}

/** Revoked units first, then active units the sync has not reached in 48 h. */
export function attentionUnits(units: GbpPortfolioUnit[]): GbpPortfolioUnit[] {
  return [
    ...units.filter((u) => u.status === 'revoked'),
    ...units.filter((u) => u.status === 'active' && u.stale),
  ];
}

function sortValue(
  u: GbpPortfolioUnit,
  col: GbpUnitSortCol,
  untitledLabel: string,
): number | string | null {
  switch (col) {
    case 'title':
      // The text the unit cell shows (`title || untitled`), so the order matches what is read.
      return u.title || untitledLabel;
    case 'lastSyncedAt': {
      const t = u.lastSyncedAt ? Date.parse(u.lastSyncedAt) : NaN;
      return Number.isNaN(t) ? null : t;
    }
    default:
      return u[col];
  }
}

/** A new array; nulls last in both directions. `untitledLabel` is what the cell shows for a unit
 * without a title. */
export function sortUnits(
  units: GbpPortfolioUnit[],
  col: GbpUnitSortCol,
  dir: 'asc' | 'desc',
  untitledLabel = '',
): GbpPortfolioUnit[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...units].sort((a, b) => {
    const va = sortValue(a, col, untitledLabel);
    const vb = sortValue(b, col, untitledLabel);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    const cmp =
      typeof va === 'string' || typeof vb === 'string'
        ? collator.compare(String(va), String(vb))
        : va - vb;
    return cmp * sign;
  });
}

const DAY_MS = 86_400_000;

/** Whole days since an ISO timestamp; null when absent. */
export function daysSince(iso: string | null, now: number = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((now - t) / DAY_MS));
}

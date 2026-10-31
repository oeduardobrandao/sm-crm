// Google Meu Negócio KPI math (spec §7). Pure: the caller loads the rows and hands them over
// already filtered to the selected units. GMN is not under the derived-metrics rule, so every
// card is a plain sum of the stored daily metrics, except the rating cards, which read the
// per-unit `gbp_rating_daily` snapshots.
//
// Days the API left out up to data_through are stored as zeros by the sync, and a window never
// ends after data_through, so a missing day here is a real zero, never "sem dados".
import { addDays, daysOf } from "./window.ts";

export const GBP_KPI_IDS = [
  "profile_views",
  "calls",
  "directions",
  "website_clicks",
  "messages",
  "bookings",
  "avg_rating",
  "new_reviews",
] as const;
export type GbpKpiId = (typeof GBP_KPI_IDS)[number];

export interface GbpKpiEntry {
  value: number | null;
  prev: number | null;
}

export interface GbpMetricsRow {
  location_name: string;
  day: string;
  business_impressions_desktop_maps: number;
  business_impressions_desktop_search: number;
  business_impressions_mobile_maps: number;
  business_impressions_mobile_search: number;
  call_clicks: number;
  business_direction_requests: number;
  website_clicks: number;
  messaging_clicks: number;
  business_bookings: number;
  business_food_menu_clicks: number;
}

export const GBP_METRIC_COLUMNS =
  "location_name, day, business_impressions_desktop_maps, business_impressions_desktop_search, " +
  "business_impressions_mobile_maps, business_impressions_mobile_search, call_clicks, business_direction_requests, " +
  "website_clicks, messaging_clicks, business_bookings, business_food_menu_clicks";

export interface GbpRatingRow {
  location_name: string;
  day: string;
  average_rating: number | string | null; // numeric(2,1)
  total_review_count: number | null;
}

export const GBP_SURFACES = ["desktop_maps", "desktop_search", "mobile_maps", "mobile_search"] as const;
export type GbpSurface = (typeof GBP_SURFACES)[number];

const SURFACE_COLUMN: Record<GbpSurface, keyof GbpMetricsRow> = {
  desktop_maps: "business_impressions_desktop_maps",
  desktop_search: "business_impressions_desktop_search",
  mobile_maps: "business_impressions_mobile_maps",
  mobile_search: "business_impressions_mobile_search",
};

/** The action cards. `business_food_menu_clicks` is stored but feeds no card. */
export interface GbpActionTotals {
  profileViews: number;
  calls: number;
  directions: number;
  websiteClicks: number;
  messages: number;
  bookings: number;
}
export interface GbpTotals extends GbpActionTotals {
  surfaces: Record<GbpSurface, number>;
}

export interface GbpDailyPoint extends GbpActionTotals {
  date: string;
}

export interface GbpSurfaceRow {
  surface: GbpSurface;
  value: number;
  pct: number;
}

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

function emptyTotals(): GbpTotals {
  return {
    profileViews: 0,
    calls: 0,
    directions: 0,
    websiteClicks: 0,
    messages: 0,
    bookings: 0,
    surfaces: { desktop_maps: 0, desktop_search: 0, mobile_maps: 0, mobile_search: 0 },
  };
}

function addRow(t: GbpTotals, r: GbpMetricsRow): void {
  for (const s of GBP_SURFACES) {
    const v = n(r[SURFACE_COLUMN[s]]);
    t.surfaces[s] += v;
    t.profileViews += v;
  }
  t.calls += n(r.call_clicks);
  t.directions += n(r.business_direction_requests);
  t.websiteClicks += n(r.website_clicks);
  t.messages += n(r.messaging_clicks);
  t.bookings += n(r.business_bookings);
}

/** Sums of the rows with `day` in [start, end]. */
export function sumMetrics(rows: GbpMetricsRow[], start: string, end: string): GbpTotals {
  const t = emptyTotals();
  for (const r of rows) if (r.day >= start && r.day <= end) addRow(t, r);
  return t;
}

const actionsOf = (t: GbpTotals): GbpActionTotals => ({
  profileViews: t.profileViews,
  calls: t.calls,
  directions: t.directions,
  websiteClicks: t.websiteClicks,
  messages: t.messages,
  bookings: t.bookings,
});

/** One point per day of [start, end], units summed, zero for a day with no row. */
export function dailySeries(rows: GbpMetricsRow[], start: string, end: string): GbpDailyPoint[] {
  const byDay = new Map<string, GbpTotals>();
  for (const r of rows) {
    if (r.day < start || r.day > end) continue;
    const t = byDay.get(r.day) ?? emptyTotals();
    addRow(t, r);
    byDay.set(r.day, t);
  }
  return daysOf(start, end).map((date) => ({ date, ...actionsOf(byDay.get(date) ?? emptyTotals()) }));
}

/** The four impression surfaces with their share of the total, one decimal; 0% on a zero total. */
export function surfaceBreakdown(t: GbpTotals): GbpSurfaceRow[] {
  const total = t.profileViews;
  return GBP_SURFACES.map((surface) => {
    const value = t.surfaces[surface];
    return { surface, value, pct: total > 0 ? Math.round((value / total) * 1000) / 10 : 0 };
  });
}

// ─── Ratings ────────────────────────────────────────────────────────────────────────

/** The unit's latest rating row with `day <= day`; null when it has none. */
function latestOnOrBefore(rows: GbpRatingRow[], locationName: string, day: string): GbpRatingRow | null {
  let best: GbpRatingRow | null = null;
  for (const r of rows) {
    if (r.location_name !== locationName || r.day > day) continue;
    if (!best || r.day > best.day) best = r;
  }
  return best;
}

/** Mean of the units' ratings weighted by their review counts; units without a rating or with no
 * reviews drop out, and null when none is left. */
function weightedRating(points: (GbpRatingRow | null)[]): number | null {
  let weighted = 0;
  let count = 0;
  for (const p of points) {
    if (!p || p.average_rating === null || p.average_rating === undefined) continue;
    const c = n(p.total_review_count);
    if (c <= 0) continue;
    weighted += n(p.average_rating) * c;
    count += c;
  }
  return count > 0 ? weighted / count : null;
}

/** Σ over the units that have both rows of (count at `later` - count at `earlier`); null only
 * when no unit has both. A unit linked inside the window (no baseline yet) is left out rather
 * than blanking the card for "Todas as unidades". */
function reviewDelta(later: (GbpRatingRow | null)[], earlier: (GbpRatingRow | null)[]): number | null {
  let delta: number | null = null;
  for (let i = 0; i < later.length; i++) {
    const a = later[i]?.total_review_count;
    const b = earlier[i]?.total_review_count;
    if (a === null || a === undefined || b === null || b === undefined) continue;
    delta = (delta ?? 0) + n(a) - n(b);
  }
  return delta;
}

export interface GbpKpiInput {
  /** Rows of the selected units covering at least [prevStart, end]. */
  metrics: GbpMetricsRow[];
  /** Rating rows of the selected units up to `end` (older rows supply the baselines). */
  ratings: GbpRatingRow[];
  locationNames: string[];
  window: { start: string; end: string; prevStart: string; prevEnd: string };
  /** The selected units' earliest metrics row is on or before `prevStart`, so the previous
   * window is fully covered. False (data starts inside or after it) nulls the action cards'
   * prev: a % change against a half-synced window would be wrong ("sem comparação" in the UI).
   * The rating cards read point-in-time snapshots and are not affected. */
  prevCovered: boolean;
}

export function emptyGbpKpis(): Record<GbpKpiId, GbpKpiEntry> {
  const out = {} as Record<GbpKpiId, GbpKpiEntry>;
  for (const id of GBP_KPI_IDS) out[id] = { value: null, prev: null };
  return out;
}

export function computeGbpKpis(i: GbpKpiInput): Record<GbpKpiId, GbpKpiEntry> {
  const w = i.window;
  const cur = sumMetrics(i.metrics, w.start, w.end);
  const prev = sumMetrics(i.metrics, w.prevStart, w.prevEnd);

  // Rating snapshots per unit: at the window end, just before the window start, and just before
  // the previous window's start. "Novas avaliações" is the count gained over [start, end].
  const at = (day: string) => i.locationNames.map((l) => latestOnOrBefore(i.ratings, l, day));
  const atEnd = at(w.end);
  const atStart = at(w.prevEnd);
  const atPrevStart = at(addDays(w.prevStart, -1));

  const entry = (value: number, prevValue: number): GbpKpiEntry => ({ value, prev: i.prevCovered ? prevValue : null });
  return {
    profile_views: entry(cur.profileViews, prev.profileViews),
    calls: entry(cur.calls, prev.calls),
    directions: entry(cur.directions, prev.directions),
    website_clicks: entry(cur.websiteClicks, prev.websiteClicks),
    messages: entry(cur.messages, prev.messages),
    bookings: entry(cur.bookings, prev.bookings),
    avg_rating: { value: weightedRating(atEnd), prev: weightedRating(atStart) },
    new_reviews: { value: reviewDelta(atEnd, atStart), prev: reviewDelta(atStart, atPrevStart) },
  };
}

// ─── Rating distribution ────────────────────────────────────────────────────────────

export interface GbpRatingDistribution {
  counts: Record<"1" | "2" | "3" | "4" | "5", number>;
  storedTotal: number;
  total: number;
  partial: boolean;
}

/** Star counts of the stored reviews (the latest 200 per unit). `total` is Σ of each unit's
 * Google review count; a unit without one counts its stored reviews, so it never reads partial. */
export function ratingDistribution(
  stars: { location_name: string; star_rating: number }[],
  units: { location_name: string; total_review_count: number | null }[],
): GbpRatingDistribution {
  const counts = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  const storedByUnit = new Map<string, number>();
  for (const s of stars) {
    const key = String(s.star_rating) as keyof typeof counts;
    if (!(key in counts)) continue;
    counts[key]++;
    storedByUnit.set(s.location_name, (storedByUnit.get(s.location_name) ?? 0) + 1);
  }
  let storedTotal = 0;
  let total = 0;
  for (const u of units) {
    const stored = storedByUnit.get(u.location_name) ?? 0;
    storedTotal += stored;
    total += Math.max(stored, u.total_review_count ?? stored);
  }
  return { counts, storedTotal, total, partial: storedTotal < total };
}

// ─── Keywords ───────────────────────────────────────────────────────────────────────

export interface GbpKeywordRow {
  keyword: string;
  value: number | null;
  /** Google's "menos de N" bucket, when it withholds the exact value. */
  threshold: number | null;
}

/** One row per keyword across units. Exact values add up; when any unit only gives a threshold
 * the sum is an upper bound, so the row becomes "menos de" Σ(value or threshold). Sorted by size,
 * an exact value ranking above a bound of the same number, then by keyword. */
export function aggregateKeywords(
  rows: { keyword: string; value: number | null; threshold: number | null }[],
): GbpKeywordRow[] {
  const byKeyword = new Map<string, { sum: number; bounded: boolean }>();
  for (const r of rows) {
    const acc = byKeyword.get(r.keyword) ?? { sum: 0, bounded: false };
    if (r.value !== null && r.value !== undefined) acc.sum += n(r.value);
    else {
      acc.sum += n(r.threshold);
      acc.bounded = true;
    }
    byKeyword.set(r.keyword, acc);
  }
  const out: GbpKeywordRow[] = [...byKeyword.entries()].map(([keyword, a]) =>
    a.bounded ? { keyword, value: null, threshold: a.sum } : { keyword, value: a.sum, threshold: null }
  );
  const rank = (k: GbpKeywordRow) => (k.value !== null ? k.value : (k.threshold ?? 0) - 0.5);
  return out.sort((a, b) => rank(b) - rank(a) || (a.keyword < b.keyword ? -1 : a.keyword > b.keyword ? 1 : 0));
}

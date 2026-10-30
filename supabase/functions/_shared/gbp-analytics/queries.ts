// Google Meu Negócio analytics reads, shared by the gbp-analytics function (and, in Phase 4, the
// report snapshot loader). Every function takes a service-role client: the gbp_* history tables
// are service-role only, and the caller has already confirmed the workspace owns the client.
//
// Every history read carries the workspace's conta_id: two workspaces can link the same location,
// and their rows share `location_name`. Query errors throw; callers answer a generic 500.
import { saoPauloDate } from "../sao-paulo-date.ts";
import {
  aggregateKeywords,
  computeGbpKpis,
  dailySeries,
  emptyGbpKpis,
  GBP_METRIC_COLUMNS,
  type GbpDailyPoint,
  type GbpKeywordRow,
  type GbpKpiEntry,
  type GbpKpiId,
  type GbpMetricsRow,
  type GbpRatingDistribution,
  type GbpRatingRow,
  type GbpSurfaceRow,
  ratingDistribution,
  sumMetrics,
  surfaceBreakdown,
} from "./kpis.ts";
import { addDays, type AnalyticsWindow, resolveWindow, type WindowRequest, windowDataThrough } from "./window.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export interface GbpUnit {
  id: string;
  location_name: string;
  title: string | null;
  status: "active" | "revoked";
  maps_uri: string | null;
  data_through: string | null;
  average_rating: number | string | null;
  total_review_count: number | null;
}

/** Explicit allowlist. `disconnected` units keep their history for 30 days but count nowhere. */
const UNIT_COLUMNS = "id, location_name, title, status, maps_uri, data_through, average_rating, total_review_count";
export const COUNTED_UNIT_STATUSES = ["active", "revoked"] as const;

const REVIEWS_LIMIT = 50;
/** How far before the previous window a rating snapshot may sit and still serve as a baseline. */
const RATING_LOOKBACK_DAYS = 90;
/** The "3 estrelas ou menos" review filter. */
const LOW_RATING_MAX = 3;

/** PostgREST caps a response at 1000 rows; long windows over several units go past it. */
// Assumes the project's PostgREST max_rows = 1000: a page shorter than PAGE_SIZE ends paging.
const PAGE_SIZE = 1000;

// deno-lint-ignore no-explicit-any
async function selectAllPages<T>(page: (from: number, to: number) => PromiseLike<{ data: any; error: any }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0;; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) return out;
  }
}

/** The client's counted units (active and revoked), oldest link first. */
export async function loadUnits(db: Db, contaId: string, clientId: number): Promise<GbpUnit[]> {
  const { data, error } = await db.from("gbp_locations").select(UNIT_COLUMNS)
    .eq("conta_id", contaId)
    .eq("client_id", clientId)
    .in("status", [...COUNTED_UNIT_STATUSES])
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw error;
  return (data ?? []) as GbpUnit[];
}

const locationNames = (units: GbpUnit[]) => units.map((u) => u.location_name);

async function loadMetrics(db: Db, contaId: string, units: GbpUnit[], start: string, end: string): Promise<GbpMetricsRow[]> {
  return await selectAllPages<GbpMetricsRow>((from, to) =>
    db.from("gbp_metrics_daily").select(GBP_METRIC_COLUMNS)
      .eq("conta_id", contaId)
      .in("location_name", locationNames(units))
      .gte("day", start)
      .lte("day", end)
      .order("location_name", { ascending: true })
      .order("day", { ascending: true })
      .range(from, to)
  );
}

async function loadRatings(db: Db, contaId: string, units: GbpUnit[], w: AnalyticsWindow): Promise<GbpRatingRow[]> {
  return await selectAllPages<GbpRatingRow>((from, to) =>
    db.from("gbp_rating_daily").select("location_name, day, average_rating, total_review_count")
      .eq("conta_id", contaId)
      .in("location_name", locationNames(units))
      .gte("day", addDays(w.prevStart, -1 - RATING_LOOKBACK_DAYS))
      .lte("day", w.end)
      .order("location_name", { ascending: true })
      .order("day", { ascending: true })
      .range(from, to)
  );
}

// ─── Overview, daily, surfaces ─────────────────────────────────────────────────────

export interface GbpOverview {
  /** The window's watermark (`windowDataThrough`): the earliest data_through of the selected
   * active units, or of all of them when none is active; null before the first sync. */
  dataThrough: string | null;
  window: AnalyticsWindow;
  kpis: Record<GbpKpiId, GbpKpiEntry>;
}

export async function buildOverview(db: Db, contaId: string, units: GbpUnit[], req: WindowRequest, now: Date): Promise<GbpOverview> {
  const dataThrough = windowDataThrough(units);
  const { window, hasData } = resolveWindow(req, dataThrough, now);
  if (!hasData) return { dataThrough, window, kpis: emptyGbpKpis() };
  // Fixed order (metrics, then ratings): the handler tests queue mock rows per table.
  const [metrics, ratings] = await Promise.all([
    loadMetrics(db, contaId, units, window.prevStart, window.end),
    loadRatings(db, contaId, units, window),
  ]);
  return {
    dataThrough,
    window,
    kpis: computeGbpKpis({ metrics, ratings, locationNames: locationNames(units), window }),
  };
}

export async function buildDaily(db: Db, contaId: string, units: GbpUnit[], req: WindowRequest, now: Date): Promise<GbpDailyPoint[]> {
  const { window, hasData } = resolveWindow(req, windowDataThrough(units), now);
  if (!hasData) return [];
  const rows = await loadMetrics(db, contaId, units, window.start, window.end);
  return dailySeries(rows, window.start, window.end);
}

export async function buildSurfaces(db: Db, contaId: string, units: GbpUnit[], req: WindowRequest, now: Date): Promise<GbpSurfaceRow[]> {
  const { window, hasData } = resolveWindow(req, windowDataThrough(units), now);
  const rows = hasData ? await loadMetrics(db, contaId, units, window.start, window.end) : [];
  return surfaceBreakdown(sumMetrics(rows, window.start, window.end));
}

// ─── Units table ───────────────────────────────────────────────────────────────────

export interface GbpUnitRow {
  id: string;
  title: string | null;
  status: "active" | "revoked";
  profileViews: number;
  calls: number;
  directions: number;
  websiteClicks: number;
  messages: number;
  bookings: number;
  avgRating: number | null;
  totalReviewCount: number | null;
}

/** Every counted unit with its sums over the "Todas as unidades" window (`windowDataThrough`),
 * so the rows compare like with like, plus the unit's current rating and review count. */
export async function buildUnits(db: Db, contaId: string, units: GbpUnit[], req: WindowRequest, now: Date): Promise<GbpUnitRow[]> {
  const { window, hasData } = resolveWindow(req, windowDataThrough(units), now);
  const rows = hasData ? await loadMetrics(db, contaId, units, window.start, window.end) : [];
  return units.map((u) => {
    const t = sumMetrics(rows.filter((r) => r.location_name === u.location_name), window.start, window.end);
    return {
      id: u.id,
      title: u.title,
      status: u.status,
      profileViews: t.profileViews,
      calls: t.calls,
      directions: t.directions,
      websiteClicks: t.websiteClicks,
      messages: t.messages,
      bookings: t.bookings,
      avgRating: u.average_rating === null || u.average_rating === undefined ? null : Number(u.average_rating),
      totalReviewCount: u.total_review_count ?? null,
    };
  });
}

// ─── Keywords ──────────────────────────────────────────────────────────────────────

export interface GbpKeywords {
  month: string | null;
  months: string[];
  keywords: GbpKeywordRow[];
}

/** First day (YYYY-MM-01) of the São Paulo month of `now`: months before it are closed. */
export function currentMonthStart(now: Date): string {
  return `${saoPauloDate(now).slice(0, 7)}-01`;
}

/** Keywords are backfilled 18 months: older months are not listed (bounds the month scan). */
const KEYWORD_MONTHS_BACK = 18;

/** First day of the month `months` before the month that opens on `monthStart` (YYYY-MM-01). */
function monthsBefore(monthStart: string, months: number): string {
  const [y, m] = monthStart.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 - months, 1)).toISOString().slice(0, 10);
}

/** Closed months with stored keywords (newest first) and the keywords of `month`, or of the
 * newest stored closed month when `month` is null. */
export async function buildKeywords(db: Db, contaId: string, units: GbpUnit[], month: string | null, now: Date): Promise<GbpKeywords> {
  const monthRows = await selectAllPages<{ month: string }>((from, to) =>
    db.from("gbp_search_keywords_monthly").select("month")
      .eq("conta_id", contaId)
      .in("location_name", locationNames(units))
      .gte("month", monthsBefore(currentMonthStart(now), KEYWORD_MONTHS_BACK))
      .lt("month", currentMonthStart(now))
      .order("month", { ascending: false })
      .range(from, to)
  );
  const months = [...new Set(monthRows.map((r) => String(r.month).slice(0, 7)))].sort().reverse();
  const shown = month ?? months[0] ?? null;
  if (shown === null) return { month: null, months, keywords: [] };

  const rows = await selectAllPages<{ keyword: string; value: number | null; threshold: number | null }>((from, to) =>
    db.from("gbp_search_keywords_monthly").select("location_name, keyword, value, threshold")
      .eq("conta_id", contaId)
      .in("location_name", locationNames(units))
      .eq("month", `${shown}-01`)
      .order("location_name", { ascending: true })
      .order("keyword", { ascending: true })
      .range(from, to)
  );
  return { month: shown, months, keywords: aggregateKeywords(rows) };
}

// ─── Reviews ───────────────────────────────────────────────────────────────────────

export type GbpReviewFilter = "all" | "unanswered" | "low";
export const GBP_REVIEW_FILTERS: readonly GbpReviewFilter[] = ["all", "unanswered", "low"];

export interface GbpReview {
  reviewer: string | null;
  rating: number;
  comment: string | null;
  unitTitle: string | null;
  /** Null before the first location refresh: "Abrir no Google" is hidden then. */
  unitMapsUri: string | null;
  createTime: string;
  hasReply: boolean;
}

/** The newest 50 stored reviews of the selected units. `low` is 3 stars or less. */
export async function buildReviews(db: Db, contaId: string, units: GbpUnit[], filter: GbpReviewFilter): Promise<GbpReview[]> {
  let q = db.from("gbp_reviews").select("location_name, reviewer_name, star_rating, comment, create_time, has_reply")
    .eq("conta_id", contaId)
    .in("location_name", locationNames(units));
  if (filter === "unanswered") q = q.eq("has_reply", false);
  if (filter === "low") q = q.lte("star_rating", LOW_RATING_MAX);
  const { data, error } = await q
    .order("create_time", { ascending: false, nullsFirst: false })
    .order("review_id", { ascending: true })
    .limit(REVIEWS_LIMIT);
  if (error) throw error;

  const byName = new Map(units.map((u) => [u.location_name, u]));
  return ((data ?? []) as {
    location_name: string;
    reviewer_name: string | null;
    star_rating: number;
    comment: string | null;
    create_time: string;
    has_reply: boolean;
  }[]).map((r) => ({
    reviewer: r.reviewer_name,
    rating: r.star_rating,
    comment: r.comment,
    unitTitle: byName.get(r.location_name)?.title ?? null,
    unitMapsUri: byName.get(r.location_name)?.maps_uri ?? null,
    createTime: r.create_time,
    hasReply: r.has_reply,
  }));
}

export async function buildRatingDistribution(db: Db, contaId: string, units: GbpUnit[]): Promise<GbpRatingDistribution> {
  const stars = await selectAllPages<{ location_name: string; star_rating: number }>((from, to) =>
    db.from("gbp_reviews").select("location_name, star_rating")
      .eq("conta_id", contaId)
      .in("location_name", locationNames(units))
      .order("location_name", { ascending: true })
      .order("review_id", { ascending: true })
      .range(from, to)
  );
  return ratingDistribution(stars, units);
}

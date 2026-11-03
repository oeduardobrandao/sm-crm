// Google Meu Negócio portfolio (`GET /portfolio`, spec 2026-11-03 §5.1 and §7): every counted
// unit of every active client of the workspace, or of one client. The math is the client tab's:
// one `computeGbpKpis` over all the units for the cards, and one per unit (over that unit's rows)
// for its table row, so no number here is computed a second way.
//
// Reads, in this fixed order (the handler tests queue mock rows per table in call order):
// clientes -> gbp_locations -> gbp_metrics_daily, gbp_rating_daily and gbp_reviews in parallel.
// Each is one paged query for the whole selection, never one per unit. The two history reads
// need a synced window; the reviews do not (they are current, see `reviewsSince`).
import { saoPauloDate } from "../sao-paulo-date.ts";
import { fetchAllRows } from "../paginate.ts";
import {
  computeGbpKpis,
  emptyGbpKpis,
  type GbpKpiEntry,
  type GbpKpiId,
  type GbpMetricsRow,
  type GbpRatingRow,
  latestOnOrBefore,
} from "./kpis.ts";
import { COUNTED_UNIT_STATUSES, type GbpUnit, loadMetrics, loadRatings } from "./queries.ts";
import {
  addDays,
  type AnalyticsWindow,
  dayMs,
  minDataThrough,
  resolveWindow,
  type WindowRequest,
  windowDataThrough,
} from "./window.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export interface GbpPortfolioUnit {
  id: string;
  clientId: number;
  clientName: string;
  especialidade: string | null;
  title: string | null;
  status: "active" | "revoked";
  mapsUri: string | null;
  lastSyncedAt: string | null;
  stale: boolean;
  profileViews: number;
  prevProfileViews: number | null;
  calls: number;
  directions: number;
  websiteClicks: number;
  messages: number;
  bookings: number;
  actions: number; // calls + directions + websiteClicks + messages + bookings
  avgRating: number | null; // snapshot at window end, else gbp_locations.average_rating
  reviewCount: number | null; // snapshot total_review_count, else gbp_locations.total_review_count
  newReviews: number | null;
}

export interface GbpAttentionReview {
  unitId: string;
  clientId: number;
  unitTitle: string | null;
  mapsUri: string | null;
  reviewerName: string | null;
  starRating: number;
  comment: string | null;
  createTime: string | null;
}

export interface GbpPortfolio {
  window: AnalyticsWindow;
  dataThrough: string | null;
  kpis: {
    units: number;
    revokedUnits: number;
    profileViews: GbpKpiEntry;
    actions: GbpKpiEntry;
    avgRating: GbpKpiEntry;
    newReviews: GbpKpiEntry;
  };
  units: GbpPortfolioUnit[];
  reviewsAttention: GbpAttentionReview[]; // every match, newest first; the page shows 10
}

/** An active unit not synced for this long is "Desatualizada". */
export const GBP_STALE_MS = 48 * 3600 * 1000;

/** Brazil has no DST since 2019: São Paulo midnight is 03:00 UTC. */
const SP_OFFSET_MS = 3 * 3600 * 1000;
/** The "pedem atenção" reviews: 3 stars or less, not answered. */
const ATTENTION_MAX_STARS = 3;

interface PortfolioSourceUnit extends GbpUnit {
  client_id: number;
  last_synced_at: string | null;
}

const UNIT_COLUMNS =
  "id, client_id, location_name, title, status, maps_uri, data_through, last_synced_at, average_rating, total_review_count";

const ACTION_IDS = ["calls", "directions", "website_clicks", "messages", "bookings"] as const satisfies readonly GbpKpiId[];

/** Active and not synced in 48 h. A revoked unit stops syncing by design, so it is never stale. */
export function isStaleUnit(u: { status: string; last_synced_at: string | null }, now: Date): boolean {
  if (u.status !== "active" || !u.last_synced_at) return false;
  const at = Date.parse(u.last_synced_at);
  return Number.isFinite(at) && now.getTime() - at > GBP_STALE_MS;
}

/** The portfolio watermark: `windowDataThrough`, except that stale active units are left out the
 * way revoked ones already are, so one stuck unit cannot drag the others back to its date. With no
 * fresh active unit synced, `windowDataThrough` over all of them, unchanged. */
export function portfolioDataThrough(
  units: { status: string; data_through: string | null; last_synced_at: string | null }[],
  now: Date,
): string | null {
  const fresh = minDataThrough(units.filter((u) => u.status === "active" && !isStaleUnit(u, now)));
  return fresh ?? windowDataThrough(units);
}

/** The five action entries summed; prev null when any of them has no comparison. */
function actionsEntry(k: Record<GbpKpiId, GbpKpiEntry>): GbpKpiEntry {
  let value: number | null = 0;
  let prev: number | null = 0;
  for (const id of ACTION_IDS) {
    value = value === null || k[id].value === null ? null : value + k[id].value;
    prev = prev === null || k[id].prev === null ? null : prev + k[id].prev;
  }
  return { value, prev };
}

function groupBy<T extends { location_name: string }>(rows: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const list = out.get(r.location_name);
    if (list) list.push(r);
    else out.set(r.location_name, [r]);
  }
  return out;
}

/** The portfolio takes `?days=` only (spec §7). */
export type GbpPortfolioRequest = Extract<WindowRequest, { kind: "days" }>;

/** São Paulo midnight, as an ISO instant, of the first day of the reviews list: the last N SP
 * days ending today (not the metrics window, which ends days back at data_through). */
function reviewsSince(days: number, now: Date): string {
  const first = addDays(saoPauloDate(now), -(days - 1));
  return new Date((dayMs(first) as number) + SP_OFFSET_MS).toISOString();
}

async function loadClients(db: Db, contaId: string, clientId: number | null) {
  return await fetchAllRows<{ id: number; nome: string | null; especialidade: string | null }>((from, to) => {
    let q = db.from("clientes").select("id, nome, especialidade")
      .eq("conta_id", contaId)
      .eq("status", "ativo");
    if (clientId !== null) q = q.eq("id", clientId);
    return q.order("id", { ascending: true }).range(from, to);
  });
}

async function loadPortfolioUnits(db: Db, contaId: string, clientIds: number[]): Promise<PortfolioSourceUnit[]> {
  return await fetchAllRows<PortfolioSourceUnit>((from, to) =>
    db.from("gbp_locations").select(UNIT_COLUMNS)
      .eq("conta_id", contaId)
      .in("client_id", clientIds)
      .in("status", [...COUNTED_UNIT_STATUSES])
      .order("client_id", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
  );
}

async function loadAttentionReviews(db: Db, contaId: string, units: PortfolioSourceUnit[], since: string) {
  return await fetchAllRows<{
    location_name: string;
    reviewer_name: string | null;
    star_rating: number;
    comment: string | null;
    create_time: string | null;
  }>((from, to) =>
    db.from("gbp_reviews").select("location_name, reviewer_name, star_rating, comment, create_time")
      .eq("conta_id", contaId)
      .in("location_name", units.map((u) => u.location_name))
      .lte("star_rating", ATTENTION_MAX_STARS)
      .eq("has_reply", false)
      .gte("create_time", since)
      .order("create_time", { ascending: false, nullsFirst: false })
      .order("location_name", { ascending: true })
      .order("review_id", { ascending: true })
      .range(from, to)
  );
}

export async function buildGbpPortfolio(
  db: Db,
  contaId: string,
  req: GbpPortfolioRequest,
  clientId: number | null,
  now: Date,
): Promise<GbpPortfolio> {
  const clients = await loadClients(db, contaId, clientId);
  const units = clients.length > 0 ? await loadPortfolioUnits(db, contaId, clients.map((c) => c.id)) : [];
  const dataThrough = portfolioDataThrough(units, now);
  const { window, hasData } = resolveWindow(req, dataThrough, now);
  const read = hasData && units.length > 0;

  const [metrics, ratings, reviews] = await Promise.all([
    read ? loadMetrics(db, contaId, units, window.prevStart, window.end) : [] as GbpMetricsRow[],
    read ? loadRatings(db, contaId, units, window) : [] as GbpRatingRow[],
    units.length > 0 ? loadAttentionReviews(db, contaId, units, reviewsSince(req.days, now)) : [],
  ]);

  const metricsByUnit = groupBy(metrics);
  const ratingsByUnit = groupBy(ratings);
  // The sync stores every day from the backfill start, zeros included: a row on prevStart means
  // the previous window is fully covered.
  const coveredOnPrevStart = (rows: GbpMetricsRow[] | undefined) => (rows ?? []).some((r) => r.day === window.prevStart);

  const all = read
    ? computeGbpKpis({
      metrics,
      ratings,
      locationNames: units.map((u) => u.location_name),
      window,
      prevCovered: units.some((u) => coveredOnPrevStart(metricsByUnit.get(u.location_name))),
    })
    : emptyGbpKpis();

  const clientById = new Map(clients.map((c) => [c.id, c]));
  const rows: GbpPortfolioUnit[] = units.map((u) => {
    const unitMetrics = metricsByUnit.get(u.location_name) ?? [];
    const unitRatings = ratingsByUnit.get(u.location_name) ?? [];
    const k = read
      ? computeGbpKpis({
        metrics: unitMetrics,
        ratings: unitRatings,
        locationNames: [u.location_name],
        window,
        prevCovered: coveredOnPrevStart(unitMetrics),
      })
      : emptyGbpKpis();
    const snapshot = latestOnOrBefore(unitRatings, u.location_name, window.end);
    const client = clientById.get(u.client_id);
    const especialidade = client?.especialidade?.trim() || null;
    const calls = k.calls.value ?? 0;
    const directions = k.directions.value ?? 0;
    const websiteClicks = k.website_clicks.value ?? 0;
    const messages = k.messages.value ?? 0;
    const bookings = k.bookings.value ?? 0;
    return {
      id: u.id,
      clientId: u.client_id,
      clientName: client?.nome ?? "",
      especialidade,
      title: u.title,
      status: u.status,
      mapsUri: u.maps_uri,
      lastSyncedAt: u.last_synced_at,
      stale: isStaleUnit(u, now),
      profileViews: k.profile_views.value ?? 0,
      prevProfileViews: k.profile_views.prev,
      calls,
      directions,
      websiteClicks,
      messages,
      bookings,
      actions: calls + directions + websiteClicks + messages + bookings,
      avgRating: snapshot
        ? k.avg_rating.value
        : (u.average_rating === null || u.average_rating === undefined ? null : Number(u.average_rating)),
      reviewCount: snapshot ? (snapshot.total_review_count ?? null) : (u.total_review_count ?? null),
      newReviews: k.new_reviews.value,
    };
  });

  const unitByName = new Map(units.map((u) => [u.location_name, u]));
  const reviewsAttention: GbpAttentionReview[] = [];
  for (const r of reviews) {
    const u = unitByName.get(r.location_name);
    if (!u) continue;
    reviewsAttention.push({
      unitId: u.id,
      clientId: u.client_id,
      unitTitle: u.title,
      mapsUri: u.maps_uri,
      reviewerName: r.reviewer_name,
      starRating: r.star_rating,
      comment: r.comment,
      createTime: r.create_time,
    });
  }

  return {
    window,
    dataThrough,
    kpis: {
      units: units.length,
      revokedUnits: units.filter((u) => u.status === "revoked").length,
      profileViews: all.profile_views,
      actions: actionsEntry(all),
      avgRating: all.avg_rating,
      newReviews: all.new_reviews,
    },
    units: rows,
    reviewsAttention,
  };
}

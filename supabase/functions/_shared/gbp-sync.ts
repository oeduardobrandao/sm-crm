// Sync of ONE Google Meu Negócio location (spec §5.2, plan Task 8). Shared by gbp-sync-cron
// and the manual sync route of google-integration (Task 9), so both follow the same steps:
//
//   1. Daily metrics for [data_through - 7, yesterday] (a backfill tries 548, then 365, then
//      180 days, taking a 400 as "range not allowed"). `data_through` = the latest day Google
//      SERVED a dated entry for (value or not, so a location gone quiet keeps advancing) minus
//      2; a response with no dated entry at all gives yesterday - 2; it never moves backwards.
//      Every day of the window up to it is written (0 for days Google omitted); later days never
//      are.
//   2. Search keywords, one single-month call per closed month (2, or 18 on a backfill: over a
//      multi-month range Google sums the months into one number). On a backfill the new
//      data_through is persisted only after this step completes: the backfill is keyed on
//      data_through IS NULL, so a run that dies before the 18 months are stored backfills again
//      next hour (the metric rows already written are idempotent upserts).
//   3. Reviews, newest first, until a known review with an unchanged update_time or 200 rows;
//      rows beyond the newest 200 are pruned. Today's gbp_rating_daily and the cached totals on
//      the location come from the same response.
//   4. Location refresh (title, voice of merchant, Maps link) together with last_synced_at.
//
// Write guard (plan "Shared sync semantics"): every write first runs a guarded
// `UPDATE gbp_locations … WHERE id AND conta_id AND status = 'active'`. Zero rows means the
// unit was disconnected or revoked mid-run, so the sync stops with `revoked` and writes nothing
// else; otherwise a write could land after google_expire_units deleted the unit's history and
// orphan it forever. Each step persists before the next network call (spec §5.3), and the
// metrics rows land BEFORE data_through advances, so a run killed mid-backfill re-backfills.
//
// Outcomes, not failures: token REVOKED -> revoked; TOKEN_INVALID or NOT_FOUND -> skipped (one
// console.error; a location deleted at Google 404s every hour and must not page anyone);
// NOT_APPROVED -> not_approved; QUOTA_EXCEEDED -> quota_skipped (keeps what was written, no
// last_synced_at, so the next hour retries). RATE_LIMITED is retried after 1, 2 and 4 s and
// then thrown. Anything else is thrown for the caller to count as a failure.
//
// Every history read, write and delete is keyed by the location's own conta_id: the same
// location_name may be linked in another workspace (Review Focus 3).

import type * as GbpApiModule from "./gbp-api.ts";
import {
  GBP_DAILY_METRICS,
  type GbpDailyMetricsResult,
  type GbpDayMetrics,
  type GbpKeywordRow,
  type GbpReview,
} from "./gbp-api.ts";
import { type DbClient, GoogleApiError } from "./google.ts";
import { previousMonth, saoPauloDate } from "./sao-paulo-date.ts";

/** The `gbp_locations` columns the sync reads. Never token columns. */
export interface GbpLocationRow {
  id: string;
  conta_id: string;
  client_id: number | string;
  connection_id: string | null;
  account_name: string;
  location_name: string;
  title: string | null;
  has_voice_of_merchant: boolean;
  average_rating: number | string | null;
  total_review_count: number | null;
  status: string;
  data_through: string | null;
  last_synced_at: string | null;
  last_sync_attempt_at?: string | null;
  maps_uri?: string | null;
}

/** Column list for selecting a GbpLocationRow (no token columns). */
export const GBP_LOCATION_COLUMNS =
  "id, conta_id, client_id, connection_id, account_name, location_name, title, has_voice_of_merchant, " +
  "average_rating, total_review_count, status, data_through, last_synced_at, last_sync_attempt_at, maps_uri";

export interface GbpSyncDeps {
  svc: DbClient;
  api: typeof GbpApiModule;
  getFreshGoogleToken: (svc: DbClient, connectionId: string) => Promise<string>;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
}

export type GbpSyncStatus = "synced" | "revoked" | "not_approved" | "quota_skipped" | "skipped";

export interface GbpSyncOutcome {
  status: GbpSyncStatus;
  /** True when the location had no data_through yet (first sync). */
  backfill: boolean;
}

/** Spike S3 default: the first window the Performance API accepts wins. */
const BACKFILL_WINDOWS_DAYS = [548, 365, 180];
const REWRITE_LOOKBACK_DAYS = 7;
/** Google back-fills the most recent days, so the watermark trails the latest served day by two. */
const WATERMARK_LAG_DAYS = 2;
const KEYWORD_MONTHS = 2;
const BACKFILL_KEYWORD_MONTHS = 18;
const MAX_REVIEWS = 200;
/** Guard against a pagination loop from a misbehaving upstream (200 rows = 4 pages of 50). */
const MAX_REVIEW_PAGES = 10;
const RATE_LIMIT_BACKOFF_MS = [1000, 2000, 4000];
const UPSERT_CHUNK = 500;

const METRIC_COLUMNS = GBP_DAILY_METRICS.map((m) => m.toLowerCase() as keyof GbpDayMetrics);

/** A guarded unit update matched no row: the location is no longer active. */
class UnitNotActive extends Error {
  constructor() {
    super("gbp location is no longer active");
    this.name = "UnitNotActive";
  }
}

function addDays(isoDay: string, days: number): string {
  const [y, m, d] = isoDay.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string): string[] {
  const out: string[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) out.push(day);
  return out;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** A 400 from Google on a date range: the API does not serve a window that long or that old. */
function isRangeRejected(err: unknown): boolean {
  return err instanceof GoogleApiError && err.code === "UPSTREAM" && err.status === 400;
}

function roundRating(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10;
}

async function withRetry<T>(deps: GbpSyncDeps, call: () => Promise<T>): Promise<T> {
  for (let attempt = 0;; attempt++) {
    try {
      return await call();
    } catch (err) {
      const rateLimited = err instanceof GoogleApiError && err.code === "RATE_LIMITED";
      if (!rateLimited || attempt >= RATE_LIMIT_BACKOFF_MS.length) throw err;
      await deps.sleep(RATE_LIMIT_BACKOFF_MS[attempt]);
    }
  }
}

class LocationSync {
  private readonly nowIso: string;
  private readonly today: string;
  private readonly yesterday: string;

  constructor(
    private readonly deps: GbpSyncDeps,
    private readonly loc: GbpLocationRow,
    now: Date,
    private readonly backfill: boolean,
  ) {
    this.nowIso = now.toISOString();
    // GMN days are São Paulo dates (plan "Shared sync semantics").
    this.today = saoPauloDate(now);
    this.yesterday = addDays(this.today, -1);
  }

  /** The write guard: zero rows updated means the unit was revoked or unlinked mid-run. */
  private async guard(patch: Record<string, unknown>): Promise<void> {
    const { data, error } = await this.deps.svc
      .from("gbp_locations")
      .update(patch)
      .eq("id", this.loc.id)
      .eq("conta_id", this.loc.conta_id)
      .eq("status", "active")
      .select("id");
    if (error) throw new Error(`gbp-sync: location update failed: ${error.message}`);
    if (!Array.isArray(data) || data.length === 0) throw new UnitNotActive();
  }

  private async upsert(table: string, rows: Record<string, unknown>[], onConflict: string): Promise<void> {
    for (const part of chunk(rows, UPSERT_CHUNK)) {
      const { error } = await this.deps.svc.from(table).upsert(part, { onConflict });
      if (error) throw new Error(`gbp-sync: ${table} upsert failed: ${error.message}`);
    }
  }

  async run(token: string): Promise<void> {
    const through = await this.syncDailyMetrics(token);
    await this.syncKeywords(token);
    // Backfill: the watermark lands only now that the 18 keyword months are stored.
    if (this.backfill) await this.guard({ data_through: through });
    await this.syncReviews(token);
    await this.refreshLocation(token);
  }

  private async fetchMetrics(token: string, range: { start: string; end: string }) {
    return await withRetry(this.deps, () => this.deps.api.fetchDailyMetrics(token, this.loc.location_name, range));
  }

  /** Writes the metric rows and returns the new data_through (persisted here unless backfill). */
  private async syncDailyMetrics(token: string): Promise<string> {
    let range: { start: string; end: string } | null = null;
    let result: GbpDailyMetricsResult | null = null;

    if (this.backfill) {
      let rejected: unknown = null;
      for (const length of BACKFILL_WINDOWS_DAYS) {
        const candidate = { start: addDays(this.today, -length), end: this.yesterday };
        try {
          result = await this.fetchMetrics(token, candidate);
          range = candidate;
          break;
        } catch (err) {
          if (!isRangeRejected(err)) throw err;
          rejected = err;
        }
      }
      if (!result || !range) throw rejected;
    } else {
      range = { start: addDays(this.loc.data_through!, -REWRITE_LOOKBACK_DAYS), end: this.yesterday };
      result = await this.fetchMetrics(token, range);
    }

    const { days } = result;
    const served = result.latestServedDay;
    const latest = served && served >= range.start && served <= range.end ? served : null;
    const computed = addDays(latest ?? this.yesterday, -WATERMARK_LAG_DAYS);
    const stored = this.loc.data_through;
    const through = stored && stored > computed ? stored : computed;

    const lastDay = through < range.end ? through : range.end;
    const rows = daysBetween(range.start, lastDay).map((day) => {
      const metrics = days.get(day);
      const row: Record<string, unknown> = { conta_id: this.loc.conta_id, location_name: this.loc.location_name, day };
      for (const column of METRIC_COLUMNS) row[column] = metrics ? Number(metrics[column]) || 0 : 0;
      return row;
    });

    await this.guard({ updated_at: this.nowIso });
    if (rows.length > 0) await this.upsert("gbp_metrics_daily", rows, "conta_id,location_name,day");
    if (!this.backfill) await this.guard({ data_through: through });
    return through;
  }

  private async syncKeywords(token: string): Promise<void> {
    const count = this.backfill ? BACKFILL_KEYWORD_MONTHS : KEYWORD_MONTHS;
    let month = this.today.slice(0, 7);
    for (let i = 0; i < count; i++) {
      month = previousMonth(month);
      let rows: GbpKeywordRow[];
      try {
        const m = month;
        rows = await withRetry(this.deps, () => this.deps.api.fetchMonthlyKeywords(token, this.loc.location_name, m));
      } catch (err) {
        // Older months than the API serves: the remaining ones are older still.
        if (this.backfill && isRangeRejected(err)) {
          console.warn(`[gbp-sync] location ${this.loc.id}: keywords not served from ${month} back`);
          break;
        }
        throw err;
      }
      if (rows.length === 0) continue;
      await this.guard({ updated_at: this.nowIso });
      await this.upsert(
        "gbp_search_keywords_monthly",
        rows.map((r) => ({
          conta_id: this.loc.conta_id,
          location_name: this.loc.location_name,
          month: `${month}-01`,
          keyword: r.keyword,
          // Both keys always: an upsert only touches the keys it sends, and a keyword moving
          // from threshold to value would otherwise break the exactly-one CHECK.
          value: r.value ?? null,
          threshold: r.threshold ?? null,
        })),
        "conta_id,location_name,month,keyword",
      );
    }
  }

  private async syncReviews(token: string): Promise<void> {
    const { data: knownRows, error: knownError } = await this.deps.svc
      .from("gbp_reviews")
      .select("review_id, update_time")
      .eq("conta_id", this.loc.conta_id)
      .eq("location_name", this.loc.location_name)
      .order("update_time", { ascending: false })
      .limit(1000);
    if (knownError) throw new Error(`gbp-sync: gbp_reviews read failed: ${knownError.message}`);
    const known = new Map<string, number>();
    for (const row of (knownRows ?? []) as Array<{ review_id: string; update_time: string }>) {
      known.set(row.review_id, Date.parse(row.update_time));
    }

    const collected = new Map<string, GbpReview>();
    let averageRating: number | null = null;
    let totalReviewCount: number | null = null;
    let pageToken: string | undefined;
    walk: for (let page = 0; page < MAX_REVIEW_PAGES; page++) {
      const opts = pageToken ? { pageToken } : {};
      const result = await withRetry(
        this.deps,
        () => this.deps.api.listReviews(token, this.loc.account_name, this.loc.location_name, opts),
      );
      if (page === 0) {
        averageRating = result.averageRating;
        totalReviewCount = result.totalReviewCount;
      }
      for (const review of result.reviews) {
        if (known.get(review.reviewId) === Date.parse(review.updateTime)) break walk;
        if (!collected.has(review.reviewId)) collected.set(review.reviewId, review);
        if (collected.size >= MAX_REVIEWS) break walk;
      }
      if (!result.nextPageToken) break;
      pageToken = result.nextPageToken;
    }

    const hasTotals = averageRating !== null || totalReviewCount !== null;
    const rating = roundRating(averageRating);
    await this.guard(
      hasTotals ? { average_rating: rating, total_review_count: totalReviewCount } : { updated_at: this.nowIso },
    );

    if (collected.size > 0) {
      await this.upsert(
        "gbp_reviews",
        [...collected.values()].map((r) => ({
          conta_id: this.loc.conta_id,
          location_name: this.loc.location_name,
          review_id: r.reviewId,
          reviewer_name: r.reviewerName,
          star_rating: r.starRating,
          comment: r.comment,
          create_time: r.createTime,
          update_time: r.updateTime,
          has_reply: r.hasReply,
        })),
        "conta_id,location_name,review_id",
      );
    }

    if (hasTotals) {
      const { error } = await this.deps.svc.from("gbp_rating_daily").upsert({
        conta_id: this.loc.conta_id,
        location_name: this.loc.location_name,
        day: this.today,
        average_rating: rating,
        total_review_count: totalReviewCount,
      }, { onConflict: "conta_id,location_name,day" });
      if (error) throw new Error(`gbp-sync: gbp_rating_daily upsert failed: ${error.message}`);
    }

    // Keep the newest 200 (by update time, the order the walk reads in).
    const merged = new Map(known);
    for (const r of collected.values()) merged.set(r.reviewId, Date.parse(r.updateTime));
    const stale = [...merged.entries()]
      .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .slice(MAX_REVIEWS)
      .map(([id]) => id);
    for (const ids of chunk(stale, UPSERT_CHUNK)) {
      const { error } = await this.deps.svc
        .from("gbp_reviews")
        .delete()
        .eq("conta_id", this.loc.conta_id)
        .eq("location_name", this.loc.location_name)
        .in("review_id", ids);
      if (error) throw new Error(`gbp-sync: gbp_reviews prune failed: ${error.message}`);
    }
  }

  private async refreshLocation(token: string): Promise<void> {
    const info = await withRetry(this.deps, () => this.deps.api.getLocation(token, this.loc.location_name));
    await this.guard({
      title: info.title,
      has_voice_of_merchant: info.hasVoiceOfMerchant,
      maps_uri: info.mapsUri,
      last_synced_at: this.nowIso,
    });
  }
}

/** Syncs one location. Throws only for errors the caller must count as failures. */
export async function syncGbpLocation(
  deps: GbpSyncDeps,
  location: GbpLocationRow,
  opts: { now: Date },
): Promise<GbpSyncOutcome> {
  const backfill = location.data_through === null;
  const outcome = (status: GbpSyncStatus): GbpSyncOutcome => ({ status, backfill });

  if (!location.connection_id) {
    console.error(`[gbp-sync] location ${location.id}: no connection, skipped`);
    return outcome("skipped");
  }

  try {
    const token = await deps.getFreshGoogleToken(deps.svc, location.connection_id);
    await new LocationSync(deps, location, opts.now, backfill).run(token);
    return outcome("synced");
  } catch (err) {
    if (err instanceof UnitNotActive) {
      console.log(`[gbp-sync] location ${location.id}: no longer active, stopped`);
      return outcome("revoked");
    }
    if (err instanceof GoogleApiError) {
      switch (err.code) {
        case "REVOKED":
          return outcome("revoked");
        case "NOT_APPROVED":
          console.warn(`[gbp-sync] location ${location.id}: API access not approved, skipped today`);
          return outcome("not_approved");
        case "QUOTA_EXCEEDED":
          console.warn(`[gbp-sync] location ${location.id}: quota exceeded, retried next hour`);
          return outcome("quota_skipped");
        case "TOKEN_INVALID":
        case "NOT_FOUND":
          console.error(`[gbp-sync] location ${location.id}: ${err.code}, skipped`);
          return outcome("skipped");
      }
    }
    throw err;
  }
}

// Google Meu Negócio (Business Profile) read client for the Phase 2 sync and analytics:
// Performance daily metrics, monthly search keywords, reviews (v4) and location info
// (Business Information v1). Every call goes through googleFetch (timeouts + error mapping,
// see _shared/google.ts), injected as `fetchJson` so tests replay documented response shapes.
// Spec: docs/superpowers/specs/2026-10-29-youtube-google-meu-negocio-design.md §5.2.
//
// Response field names follow the documented resources and were not re-verified against a live
// response: a mismatch found in staging is a fixture fix here, not a design change.

import { googleFetch } from "./google.ts";

export type GbpFetchJson = (url: string, token: string, init?: RequestInit & { timeoutMs?: number }) => Promise<unknown>;

const PERFORMANCE_BASE = "https://businessprofileperformance.googleapis.com/v1";
const REVIEWS_BASE = "https://mybusiness.googleapis.com/v4";
const BUSINESS_INFO_BASE = "https://mybusinessbusinessinformation.googleapis.com/v1";

const KEYWORDS_PAGE_SIZE = 100;
const REVIEWS_PAGE_SIZE = 50;
/** Guard against a pagination loop from a misbehaving upstream. */
const MAX_KEYWORD_PAGES = 50;

/**
 * The ten daily metrics of spec §5.2, in the order requested. Not BUSINESS_CONVERSATIONS
 * (removed) or BUSINESS_FOOD_ORDERS (deprecated).
 */
export const GBP_DAILY_METRICS = [
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
  "CALL_CLICKS",
  "BUSINESS_DIRECTION_REQUESTS",
  "WEBSITE_CLICKS",
  "MESSAGING_CLICKS",
  "BUSINESS_BOOKINGS",
  "BUSINESS_FOOD_MENU_CLICKS",
] as const;

export type GbpDailyMetric = (typeof GBP_DAILY_METRICS)[number];

/** One day of metrics; keys are the lower snake case `gbp_metrics_daily` columns. */
export interface GbpDayMetrics {
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

export interface GbpKeywordRow {
  month: string;
  keyword: string;
  /** Exact monthly impressions; absent when Google only reports a threshold. */
  value?: number;
  /** Google reports the actual value is below this number. */
  threshold?: number;
}

export interface GbpReview {
  reviewId: string;
  /** null for anonymous reviewers. */
  reviewerName: string | null;
  starRating: 1 | 2 | 3 | 4 | 5;
  comment: string | null;
  createTime: string;
  updateTime: string;
  hasReply: boolean;
}

export interface GbpReviewsPage {
  reviews: GbpReview[];
  averageRating: number | null;
  totalReviewCount: number | null;
  nextPageToken: string | null;
}

export interface GbpLocationInfo {
  title: string;
  hasVoiceOfMerchant: boolean;
  mapsUri: string | null;
}

function metricKey(metric: GbpDailyMetric): keyof GbpDayMetrics {
  return metric.toLowerCase() as keyof GbpDayMetrics;
}

const METRIC_KEY_BY_ENUM = new Map<string, keyof GbpDayMetrics>(GBP_DAILY_METRICS.map((m) => [m, metricKey(m)]));

function zeroDay(): GbpDayMetrics {
  return {
    business_impressions_desktop_maps: 0,
    business_impressions_desktop_search: 0,
    business_impressions_mobile_maps: 0,
    business_impressions_mobile_search: 0,
    call_clicks: 0,
    business_direction_requests: 0,
    website_clicks: 0,
    messaging_clicks: 0,
    business_bookings: 0,
    business_food_menu_clicks: 0,
  };
}

/** Parses a Google int64 (JSON string) or number; undefined when it is not a finite number. */
function toCount(raw: unknown): number | undefined {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function parseIsoDay(day: string): { year: number; month: number; day: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) throw new Error(`gbp-api: invalid day "${day}"`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function isoDay(date: { year?: number; month?: number; day?: number } | undefined): string | null {
  if (!date?.year || !date.month || !date.day) return null;
  return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

/** Every ISO day from start to end inclusive (UTC arithmetic: the strings are plain calendar days). */
function daysBetween(start: string, end: string): string[] {
  const from = parseIsoDay(start);
  const to = parseIsoDay(end);
  const cursor = new Date(Date.UTC(from.year, from.month - 1, from.day));
  const last = Date.UTC(to.year, to.month - 1, to.day);
  const days: string[] = [];
  while (cursor.getTime() <= last) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

interface DailyMetricsResponse {
  multiDailyMetricTimeSeries?: Array<{
    dailyMetricTimeSeries?: Array<{
      dailyMetric?: string;
      dailySubEntityType?: unknown;
      timeSeries?: { datedValues?: Array<{ date?: { year?: number; month?: number; day?: number }; value?: string | number }> };
    }>;
  }>;
}

/**
 * Daily metrics for `range` (inclusive ISO days), keyed by ISO day. Every day of the range is
 * present with all ten metrics: Google omits `value` for zero and may omit whole days, both
 * become 0. Days Google returns outside the range are ignored, as are unknown metrics and
 * breakdown series (`dailySubEntityType`), which would double count the unbroken total.
 */
export async function fetchDailyMetrics(
  token: string,
  locationName: string,
  range: { start: string; end: string },
  fetchJson: GbpFetchJson = googleFetch,
): Promise<Map<string, GbpDayMetrics>> {
  const start = parseIsoDay(range.start);
  const end = parseIsoDay(range.end);
  const url = new URL(`${PERFORMANCE_BASE}/${locationName}:fetchMultiDailyMetricsTimeSeries`);
  for (const metric of GBP_DAILY_METRICS) url.searchParams.append("dailyMetrics", metric);
  url.searchParams.set("dailyRange.start_date.year", String(start.year));
  url.searchParams.set("dailyRange.start_date.month", String(start.month));
  url.searchParams.set("dailyRange.start_date.day", String(start.day));
  url.searchParams.set("dailyRange.end_date.year", String(end.year));
  url.searchParams.set("dailyRange.end_date.month", String(end.month));
  url.searchParams.set("dailyRange.end_date.day", String(end.day));

  const body = (await fetchJson(url.toString(), token)) as DailyMetricsResponse | null;

  const days = new Map<string, GbpDayMetrics>();
  for (const day of daysBetween(range.start, range.end)) days.set(day, zeroDay());

  for (const group of body?.multiDailyMetricTimeSeries ?? []) {
    for (const series of group?.dailyMetricTimeSeries ?? []) {
      const key = series?.dailyMetric ? METRIC_KEY_BY_ENUM.get(series.dailyMetric) : undefined;
      if (!key || series.dailySubEntityType) continue;
      for (const point of series.timeSeries?.datedValues ?? []) {
        const day = isoDay(point?.date);
        const row = day ? days.get(day) : undefined;
        if (row) row[key] = toCount(point.value) ?? 0;
      }
    }
  }
  return days;
}

interface KeywordsResponse {
  searchKeywordsCounts?: Array<{ searchKeyword?: string; insightsValue?: { value?: string; threshold?: string } }>;
  nextPageToken?: string;
}

/**
 * Search keywords for ONE month (`YYYY-MM`), following `nextPageToken`. One call per month on
 * purpose: over a multi-month range Google sums the months into a single number.
 */
export async function fetchMonthlyKeywords(
  token: string,
  locationName: string,
  month: string,
  fetchJson: GbpFetchJson = googleFetch,
): Promise<GbpKeywordRow[]> {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) throw new Error(`gbp-api: invalid month "${month}"`);
  const year = String(Number(m[1]));
  const monthNumber = String(Number(m[2]));

  const rows: GbpKeywordRow[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_KEYWORD_PAGES; page++) {
    const url = new URL(`${PERFORMANCE_BASE}/${locationName}/searchkeywords/impressions/monthly`);
    url.searchParams.set("monthlyRange.start_month.year", year);
    url.searchParams.set("monthlyRange.start_month.month", monthNumber);
    url.searchParams.set("monthlyRange.end_month.year", year);
    url.searchParams.set("monthlyRange.end_month.month", monthNumber);
    url.searchParams.set("pageSize", String(KEYWORDS_PAGE_SIZE));
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const body = (await fetchJson(url.toString(), token)) as KeywordsResponse | null;
    for (const entry of body?.searchKeywordsCounts ?? []) {
      const keyword = entry?.searchKeyword;
      if (!keyword) continue;
      const value = toCount(entry.insightsValue?.value);
      if (value !== undefined) {
        rows.push({ month, keyword, value });
        continue;
      }
      const threshold = toCount(entry.insightsValue?.threshold);
      if (threshold !== undefined) rows.push({ month, keyword, threshold });
    }
    pageToken = body?.nextPageToken || undefined;
    if (!pageToken) break;
  }
  return rows;
}

const STAR_RATINGS: Record<string, GbpReview["starRating"]> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

interface ReviewsResponse {
  reviews?: Array<{
    reviewId?: string;
    reviewer?: { displayName?: string; isAnonymous?: boolean };
    starRating?: string;
    comment?: string;
    createTime?: string;
    updateTime?: string;
    reviewReply?: unknown;
  }>;
  averageRating?: number;
  totalReviewCount?: number;
  nextPageToken?: string;
}

/**
 * One page (50) of reviews, newest update first. The caller pages with `nextPageToken`.
 * Reviews with no star rating (`STAR_RATING_UNSPECIFIED`) or no id are dropped: the history
 * table requires 1..5 and a key.
 */
export async function listReviews(
  token: string,
  accountName: string,
  locationName: string,
  opts: { pageToken?: string } = {},
  fetchJson: GbpFetchJson = googleFetch,
): Promise<GbpReviewsPage> {
  const url = new URL(`${REVIEWS_BASE}/${accountName}/${locationName}/reviews`);
  url.searchParams.set("orderBy", "updateTime desc");
  url.searchParams.set("pageSize", String(REVIEWS_PAGE_SIZE));
  if (opts.pageToken) url.searchParams.set("pageToken", opts.pageToken);

  const body = (await fetchJson(url.toString(), token)) as ReviewsResponse | null;

  const reviews: GbpReview[] = [];
  for (const review of body?.reviews ?? []) {
    const starRating = review?.starRating ? STAR_RATINGS[review.starRating] : undefined;
    if (!review?.reviewId || !starRating) continue;
    const anonymous = review.reviewer?.isAnonymous === true;
    reviews.push({
      reviewId: review.reviewId,
      reviewerName: anonymous ? null : review.reviewer?.displayName || null,
      starRating,
      comment: review.comment || null,
      createTime: review.createTime ?? "",
      updateTime: review.updateTime ?? review.createTime ?? "",
      hasReply: !!review.reviewReply,
    });
  }
  return {
    reviews,
    averageRating: typeof body?.averageRating === "number" ? body.averageRating : null,
    totalReviewCount: typeof body?.totalReviewCount === "number" ? body.totalReviewCount : null,
    nextPageToken: body?.nextPageToken || null,
  };
}

interface LocationResponse {
  title?: string;
  metadata?: { hasVoiceOfMerchant?: boolean; mapsUri?: string };
}

/** Location title, voice-of-merchant flag and Maps link (Business Information v1). */
export async function getLocation(
  token: string,
  locationName: string,
  fetchJson: GbpFetchJson = googleFetch,
): Promise<GbpLocationInfo> {
  const url = new URL(`${BUSINESS_INFO_BASE}/${locationName}`);
  url.searchParams.set("readMask", "title,metadata");
  const body = (await fetchJson(url.toString(), token)) as LocationResponse | null;
  return {
    title: body?.title || locationName,
    hasVoiceOfMerchant: body?.metadata?.hasVoiceOfMerchant === true,
    mapsUri: body?.metadata?.mapsUri || null,
  };
}

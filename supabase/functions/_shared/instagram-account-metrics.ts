// Account-level Instagram Graph metric fetch + normalization.
//
// This owns the window/chunk math that used to live only in
// instagram-analytics/views.ts (that file now imports + re-exports it, so
// its existing consumers keep working unchanged) plus the account-level
// metric fetching used by report-docs, the CRM analytics endpoint and the
// sync cron (Fases 2-5 of the report/app parity initiative).
//
// Empirical facts baked into the rules below (2026-08-31 Graph spike, see
// .superpowers/sdd/2026-08-31-report-app-parity/spike-result*.json):
// - graph.instagram.com/me/insights accepts a single 31-day total_value
//   request for reach/accounts_engaged; there is no hard 30-day cap on that
//   single-request mode.
// - reach and accounts_engaged are NOT deduplicated across days, even
//   within one request. Chunk-summing them for windows >31d therefore
//   yields an "accumulated" (not truly-unique) number, same as a >31d
//   single request would if the API allowed one. That's a deliberate,
//   honestly-labeled tradeoff, never a null-out because the window is big.
// - a daily values[] series exists ONLY for reach and follower_count.
// - follower_count daily values are per-day DELTAS (0-8 in the sample
//   account), not running totals.
// - follows_and_unfollows returns no total_value at all without
//   breakdown=follow_type; with it, total_value.breakdowns[0].results holds
//   FOLLOWER / NON_FOLLOWER buckets.

export const VIEWS_WINDOW_DAYS = 90;
export const VIEWS_CHUNK_DAYS = 30;
const DAY = 86400;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Date.parse normalizes impossible days ("2026-02-30" becomes Mar 2), so a
// parsed date only counts as valid when it round-trips to the supplied string.
function parseUtcDayStrict(day: string): number | null {
  const ms = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10) === day ? ms : null;
}

export interface ViewsRange {
  since: number;
  until: number;
  partial: boolean;
  prev: { since: number; until: number } | null;
}

export function parseViewsRange(
  params: URLSearchParams,
  nowSec: number,
): { ok: true; range: ViewsRange } | { ok: false; error: string } {
  const days = params.get('days');
  const start = params.get('start');
  const end = params.get('end');

  const hasDays = days !== null;
  const hasRange = start !== null || end !== null;
  if (hasDays === hasRange) return { ok: false, error: 'exactly one of days or start+end is required' };

  let since: number;
  let until: number;

  if (hasDays) {
    const n = parseInt(days!, 10);
    if (isNaN(n) || n < 1 || n > 730) return { ok: false, error: 'days out of range' };
    until = nowSec;
    since = until - n * DAY;
  } else {
    if (!start || !end || !DATE_RE.test(start) || !DATE_RE.test(end)) {
      return { ok: false, error: 'start/end must be YYYY-MM-DD' };
    }
    const startMs = parseUtcDayStrict(start);
    const endMs = parseUtcDayStrict(end);
    if (startMs === null || endMs === null) return { ok: false, error: 'invalid dates' };
    if (startMs > endMs) return { ok: false, error: 'start after end' };
    since = startMs / 1000;
    if (since > nowSec) return { ok: false, error: 'start in the future' };
    // Inclusive end day -> exclusive upper bound at the next midnight.
    until = Math.min(endMs / 1000 + DAY, nowSec);
  }

  const windowStart = nowSec - VIEWS_WINDOW_DAYS * DAY;
  const clamped = Math.max(since, windowStart);
  if (until <= clamped) return { ok: false, error: 'range outside the available window' };
  const partial = clamped > since;
  const len = until - clamped;
  const prevSince = clamped - len;
  const prev = !partial && prevSince >= windowStart ? { since: prevSince, until: clamped } : null;

  return { ok: true, range: { since: clamped, until, partial, prev } };
}

export function chunkRange(
  since: number,
  until: number,
  maxDays = VIEWS_CHUNK_DAYS,
): { since: number; until: number }[] {
  const step = maxDays * DAY;
  const chunks: { since: number; until: number }[] = [];
  for (let s = since; s < until; s += step) {
    chunks.push({ since: s, until: Math.min(s + step, until) });
  }
  return chunks;
}

// --- Account-level metric normalization -----------------------------------

export type AccountMetric =
  | 'reach' | 'views' | 'saves' | 'accounts_engaged'
  | 'profile_views' | 'website_clicks' | 'follows_and_unfollows';

// reach/accounts_engaged: unique-accounts metrics. Never deduplicated across
// days by the Graph API, but a single request up to 31d gets the API's own
// (still not-deduplicated) number instead of a chunk-sum.
export const UNIQUE_METRICS: ReadonlySet<AccountMetric> = new Set(['reach', 'accounts_engaged']);
const UNIQUE_SINGLE_REQUEST_MAX_DAYS = 31;

export interface FollowsBreakdown {
  follows: number;
  unfollows: number;
  net: number;
}

export interface AccountTotals {
  reach: number | null;
  views: number | null;
  saves: number | null;
  accounts_engaged: number | null;
  profile_views: number | null;
  website_clicks: number | null;
  follows_and_unfollows: FollowsBreakdown | null;
}

export interface DailyValues {
  reach: number | null;
  views: number | null;
  saves: number | null;
  accounts_engaged: number | null;
  profile_views: number | null;
  website_clicks: number | null;
  follows: number | null;
  unfollows: number | null;
}

const GRAPH_BASE = 'https://graph.instagram.com/me/insights';

interface GraphInsightBreakdownResult {
  dimension_values?: string[];
  value?: number;
}

interface GraphInsightEntry {
  name?: string;
  total_value?: {
    value?: number;
    breakdowns?: Array<{
      dimension_keys?: string[];
      results?: GraphInsightBreakdownResult[];
    }>;
  };
  values?: Array<{ value?: number; end_time?: string }>;
}

interface GraphInsightResponse {
  data?: GraphInsightEntry[];
  error?: { code?: number; message?: string };
}

// Single Graph call for one metric over one window. Throws TOKEN_EXPIRED
// (views.ts convention) on Graph error code 190; any other Graph-level
// error is returned on `.error` for the caller to normalize to null.
async function fetchInsight(
  fetchFn: typeof fetch,
  accessToken: string,
  metric: string,
  since: number,
  until: number,
  extraParams: string,
): Promise<GraphInsightResponse> {
  const url =
    `${GRAPH_BASE}?metric=${metric}&period=day${extraParams}` +
    `&since=${since}&until=${until}&access_token=${accessToken}`;
  const res = await fetchFn(url, { signal: AbortSignal.timeout(10_000) });
  const data = (await res.json()) as GraphInsightResponse;
  if (data.error?.code === 190) {
    throw { code: 'TOKEN_EXPIRED', message: 'Instagram token expired' };
  }
  return data;
}

// Windows to request for one metric: unique metrics get a single request up
// to 31d (the API-provided, still-not-deduplicated accumulation); anything
// bigger, and every additive metric regardless of size, chunk-sums by 30d.
function metricWindows(
  metric: AccountMetric,
  since: number,
  until: number,
): { since: number; until: number }[] {
  if (UNIQUE_METRICS.has(metric) && until - since <= UNIQUE_SINGLE_REQUEST_MAX_DAYS * DAY) {
    return [{ since, until }];
  }
  return chunkRange(since, until, VIEWS_CHUNK_DAYS);
}

async function fetchSimpleMetricTotal(
  fetchFn: typeof fetch,
  accessToken: string,
  metric: AccountMetric,
  since: number,
  until: number,
): Promise<number | null> {
  const windows = metricWindows(metric, since, until);
  const responses = await Promise.all(
    windows.map((w) => fetchInsight(fetchFn, accessToken, metric, w.since, w.until, '&metric_type=total_value')),
  );
  let sum = 0;
  let found = false;
  for (const data of responses) {
    // A chunk-level Graph error (non-190) invalidates the WHOLE metric for
    // this call. Skipping just that chunk and summing the rest would silently
    // under-report a partial total as if it were complete.
    if (data.error) return null;
    const entry = data.data?.find((d) => d.name === metric);
    const value = entry?.total_value?.value;
    if (typeof value === 'number') {
      sum += value;
      found = true;
    }
  }
  return found ? sum : null;
}

async function fetchFollowsTotal(
  fetchFn: typeof fetch,
  accessToken: string,
  since: number,
  until: number,
): Promise<FollowsBreakdown | null> {
  const windows = metricWindows('follows_and_unfollows', since, until);
  const responses = await Promise.all(
    windows.map((w) =>
      fetchInsight(
        fetchFn,
        accessToken,
        'follows_and_unfollows',
        w.since,
        w.until,
        '&metric_type=total_value&breakdown=follow_type',
      ),
    ),
  );
  let follows = 0;
  let unfollows = 0;
  let found = false;
  for (const data of responses) {
    // Same policy as fetchSimpleMetricTotal: any chunk-level Graph error
    // nulls the whole metric instead of silently summing a partial result.
    if (data.error) return null;
    const entry = data.data?.find((d) => d.name === 'follows_and_unfollows');
    const results = entry?.total_value?.breakdowns?.[0]?.results;
    if (!results) continue;
    for (const r of results) {
      const key = r.dimension_values?.[0];
      const value = r.value;
      if (typeof value !== 'number') continue;
      if (key === 'FOLLOWER') {
        follows += value;
        found = true;
      } else if (key === 'NON_FOLLOWER') {
        unfollows += value;
        found = true;
      }
    }
  }
  return found ? { follows, unfollows, net: follows - unfollows } : null;
}

// Runs one metric's fetch in isolation: any failure that reaches here as a
// thrown exception (network error, timeout, malformed JSON -- Graph-returned
// `.error` bodies are already normalized to null inside fetch*Total) degrades
// to null instead of rejecting the caller's Promise.all. TOKEN_EXPIRED is the
// sole exception: it must still surface, so every caller of this call site
// can react to an expired token instead of silently losing the whole batch.
async function isolateNonTokenFailure<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    if ((e as { code?: string } | null)?.code === 'TOKEN_EXPIRED') throw e;
    return null;
  }
}

// Fetches account totals for the requested metrics over [sinceSec, untilSec).
// One Graph call per metric (possibly chunked internally); a non-token
// failure on one metric nulls just that field, never the others. A Graph
// code-190 error (expired token) rejects the whole call.
export async function fetchAccountTotals(
  fetchFn: typeof fetch,
  accessToken: string,
  metrics: AccountMetric[],
  sinceSec: number,
  untilSec: number,
): Promise<Partial<AccountTotals>> {
  const entries = await Promise.all(
    metrics.map(async (metric) => {
      const value = await isolateNonTokenFailure(
        (): Promise<number | FollowsBreakdown | null> =>
          metric === 'follows_and_unfollows'
            ? fetchFollowsTotal(fetchFn, accessToken, sinceSec, untilSec)
            : fetchSimpleMetricTotal(fetchFn, accessToken, metric, sinceSec, untilSec),
      );
      return [metric, value] as const;
    }),
  );
  const result: Partial<AccountTotals> = {};
  for (const [metric, value] of entries) {
    (result as Record<string, unknown>)[metric] = value;
  }
  return result;
}

const CLOSED_DAY_SIMPLE_METRICS: AccountMetric[] = [
  'reach', 'views', 'saves', 'accounts_engaged', 'profile_views', 'website_clicks',
];

// Values for ONE closed UTC day ([dayUtc 00:00Z, dayUtc+1 00:00Z)): one
// Graph request per metric (~7 total), all within that same window.
export async function fetchClosedDayValues(
  fetchFn: typeof fetch,
  accessToken: string,
  dayUtc: string,
): Promise<Partial<DailyValues>> {
  const since = Date.parse(`${dayUtc}T00:00:00Z`) / 1000;
  const until = since + DAY;

  const [totals, follows] = await Promise.all([
    fetchAccountTotals(fetchFn, accessToken, CLOSED_DAY_SIMPLE_METRICS, since, until),
    isolateNonTokenFailure(() => fetchFollowsTotal(fetchFn, accessToken, since, until)),
  ]);

  return {
    reach: totals.reach ?? null,
    views: totals.views ?? null,
    saves: totals.saves ?? null,
    accounts_engaged: totals.accounts_engaged ?? null,
    profile_views: totals.profile_views ?? null,
    website_clicks: totals.website_clicks ?? null,
    follows: follows?.follows ?? null,
    unfollows: follows?.unfollows ?? null,
  };
}

// Graph's end_time for a daily value carries the calendar date the value
// measures -- its time-of-day component (07:00Z in the sample account) is
// just a per-account reporting-boundary artifact, NOT a "day before" marker.
// Ground truth (spike-result.json): a single-day request for the UTC day
// 2026-08-31 ([...T00:00Z, 2026-09-01T00:00Z)) returned 579
// (`reach_total_chunk1`), matching `reach_daily`'s last entry exactly --
// {end_time: "2026-08-31T07:00:00+0000", value: 579}. So the date component
// of end_time IS the day; no shift is applied.
function dayOfEndTime(endTime: string): string {
  const ms = Date.parse(endTime);
  return new Date(ms).toISOString().slice(0, 10);
}

// Thrown by fetchDailySeries when ANY chunk of a multi-chunk daily-series
// fetch (fetchReachDaily / fetchFollowerCountDeltas) comes back with a
// non-190 Graph error. These series feed a backfill cursor, not a one-off
// display value: a partial-but-returned Map would look successful and let
// the caller advance its cursor past days it never actually fetched,
// permanently skipping them. A thrown error is safer -- the caller (the
// backfill consumer) should catch this, NOT advance the cursor, and retry
// the whole series on its next tick. (Graph code 190 still throws
// TOKEN_EXPIRED from fetchInsight before a chunk even reaches this check.)
export interface SeriesIncompleteError {
  code: 'SERIES_INCOMPLETE';
  metric: 'reach' | 'follower_count';
  message: string;
}

async function fetchDailySeries(
  fetchFn: typeof fetch,
  accessToken: string,
  metric: 'reach' | 'follower_count',
  sinceSec: number,
  untilSec: number,
): Promise<Map<string, number>> {
  const chunks = chunkRange(sinceSec, untilSec, VIEWS_CHUNK_DAYS);
  const responses = await Promise.all(
    chunks.map((c) => fetchInsight(fetchFn, accessToken, metric, c.since, c.until, '')),
  );
  const out = new Map<string, number>();
  for (const data of responses) {
    if (data.error) {
      const err: SeriesIncompleteError = {
        code: 'SERIES_INCOMPLETE',
        metric,
        message: data.error.message || 'Graph API error',
      };
      throw err;
    }
    const entry = data.data?.find((d) => d.name === metric);
    for (const v of entry?.values ?? []) {
      if (typeof v.value === 'number' && v.end_time) {
        out.set(dayOfEndTime(v.end_time), v.value);
      }
    }
  }
  return out;
}

// Native daily reach series (the only metric with a values[] series per the
// spike). 1 request per 30d chunk. Feeds the reach_day backfill.
export function fetchReachDaily(
  fetchFn: typeof fetch,
  accessToken: string,
  sinceSec: number,
  untilSec: number,
): Promise<Map<string, number>> {
  return fetchDailySeries(fetchFn, accessToken, 'reach', sinceSec, untilSec);
}

// Daily follower-count DELTAS (Graph returns day-over-day variation, 0-8 in
// the sample account, NOT a running total -- confirmed by the spike).
// Retention ~30d.
export function fetchFollowerCountDeltas(
  fetchFn: typeof fetch,
  accessToken: string,
  sinceSec: number,
  untilSec: number,
): Promise<Map<string, number>> {
  return fetchDailySeries(fetchFn, accessToken, 'follower_count', sinceSec, untilSec);
}

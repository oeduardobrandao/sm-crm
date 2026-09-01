// GET /account-metrics/:clientId?start&end -- account-level IG totals for an
// ARBITRARY (not necessarily calendar-month) date range, with a `previous`
// window of equal length and Instagram-app-style KPI parity (Task 12,
// .superpowers/sdd/2026-08-31-report-app-parity).
//
// Range parsing is deliberately its OWN thing, not `parseViewsRange`:
// parseViewsRange clamps/rejects anything outside the 90-day Graph retention
// window BEFORE any fallback could run, which would kill exactly the
// historical-range case this endpoint promises (e.g. a backfilled January
// read from `instagram_account_metrics_monthly`). Retention here decides
// ONLY whether a live Graph fetch is attempted -- a window fully inside the
// last 90 days tries live; anything partially or fully outside skips live
// entirely and goes straight to the monthly-row / daily-sum snapshot chain.
//
// The snapshot chain itself is a variant of report-docs/account-window.ts's
// live -> monthly-row -> daily-sum cadence, NOT a reuse of it: that module's
// shape assumes a CALENDAR-MONTH-ALIGNED window (it unconditionally reads
// the monthly row keyed by month-start, then sums daily rows across the
// month's exact day count). An arbitrary range breaks both assumptions, so
// this file reimplements the chain with two changes: the monthly row is
// consulted ONLY when the requested range exactly equals one calendar month
// (day 1 through the month's last day), and the daily sum runs over exactly
// the requested date span rather than a fixed month length. reach and
// accounts_engaged (unique-accounts metrics, never deduplicated across days
// by the Graph API -- see instagram-account-metrics.ts) still never fall
// back to a daily sum; the calendar-month exception is the only path back to
// a stored number for them once live is unavailable.
import {
  fetchAccountTotals,
  parseUtcDayStrict,
  VIEWS_WINDOW_DAYS,
  type AccountMetric,
  type AccountTotals,
  type FollowsBreakdown,
} from "../_shared/instagram-account-metrics.ts";

const DAY_MS = 86_400_000;
const DAY_SEC = 86_400;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;

// deno-lint-ignore no-explicit-any
type Db = any;

type SimpleMetric =
  | "reach" | "views" | "saves" | "accounts_engaged" | "profile_views" | "website_clicks";

const SIMPLE_METRICS: SimpleMetric[] = [
  "reach", "views", "saves", "accounts_engaged", "profile_views", "website_clicks",
];
const ALL_METRICS: AccountMetric[] = [...SIMPLE_METRICS, "follows_and_unfollows"];
const UNIQUE_METRICS: ReadonlySet<SimpleMetric> = new Set(["reach", "accounts_engaged"]);

interface MonthlyRow {
  reach_month: number | null;
  views_month: number | null;
  saves_month: number | null;
  accounts_engaged_month: number | null;
  profile_views_month: number | null;
  website_clicks_month: number | null;
  follows_month: number | null;
  unfollows_month: number | null;
}

const MONTHLY_FIELD: Record<SimpleMetric, keyof MonthlyRow> = {
  reach: "reach_month",
  views: "views_month",
  saves: "saves_month",
  accounts_engaged: "accounts_engaged_month",
  profile_views: "profile_views_month",
  website_clicks: "website_clicks_month",
};
const MONTHLY_COLUMNS =
  "reach_month, views_month, saves_month, accounts_engaged_month, " +
  "profile_views_month, website_clicks_month, follows_month, unfollows_month";

interface DailyRow {
  snapshot_date: string;
  reach_day: number | null;
  views_day: number | null;
  saves_day: number | null;
  accounts_engaged_day: number | null;
  profile_views_day: number | null;
  website_clicks_day: number | null;
  follows_day: number | null;
  unfollows_day: number | null;
}

const DAILY_FIELD: Record<SimpleMetric, keyof DailyRow> = {
  reach: "reach_day",
  views: "views_day",
  saves: "saves_day",
  accounts_engaged: "accounts_engaged_day",
  profile_views: "profile_views_day",
  website_clicks: "website_clicks_day",
};
const DAILY_COLUMNS =
  "snapshot_date, reach_day, views_day, saves_day, accounts_engaged_day, " +
  "profile_views_day, website_clicks_day, follows_day, unfollows_day";

export interface FollowersWindow {
  start: number;
  end: number;
  delta: number;
}

export interface AccountMetricsWindow extends AccountTotals {
  followers: FollowersWindow | null;
}

export type MetricSource = "live" | "snapshot" | null;

export interface AccountMetricsResponse {
  period: { start: string; end: string; effectiveEnd: string };
  current: AccountMetricsWindow;
  previous: AccountMetricsWindow | null;
  source: Record<string, MetricSource>;
}

export type AccountMetricsResult =
  | { ok: true; body: AccountMetricsResponse }
  | { ok: false; status: 400; error: string };

export interface AccountMetricsDeps {
  db: Db;
  fetch: typeof fetch;
  // instagram_accounts.id is a uuid (baseline schema), not a numeric id.
  account: { id: string };
  accessToken: string;
  /** Injectable "now", ms since epoch. Defaults to `Date.now()`. */
  nowMs?: number;
}

// --- Range parsing (own logic, see file header) -----------------------------

interface ParsedRange {
  ok: true;
  effectiveEnd: string;
}
interface ParseRangeError {
  ok: false;
  error: string;
}

export function parseAccountMetricsRange(
  start: string | null | undefined,
  end: string | null | undefined,
  nowSec: number,
): ParsedRange | ParseRangeError {
  if (!start || !end) return { ok: false, error: "start and end are required" };
  if (!DATE_RE.test(start) || !DATE_RE.test(end)) {
    return { ok: false, error: "start/end must be YYYY-MM-DD" };
  }
  const startMs = parseUtcDayStrict(start);
  const endMs = parseUtcDayStrict(end);
  if (startMs === null || endMs === null) return { ok: false, error: "invalid dates" };
  if (startMs > endMs) return { ok: false, error: "start after end" };
  if (startMs > nowSec * 1000) return { ok: false, error: "start in the future" };

  const spanDays = Math.round((endMs - startMs) / DAY_MS) + 1;
  if (spanDays > MAX_RANGE_DAYS) return { ok: false, error: "range too large" };

  // effectiveEnd clamps at "now" (data can't exist beyond today): a request
  // reaching into the future is honored up to today, never further.
  const todayDate = new Date(nowSec * 1000).toISOString().slice(0, 10);
  const effectiveEnd = end > todayDate ? todayDate : end;
  return { ok: true, effectiveEnd };
}

// --- Small date helpers -------------------------------------------------

function toMs(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

function addDays(day: string, days: number): string {
  return new Date(toMs(day) + days * DAY_MS).toISOString().slice(0, 10);
}

function dateRangeInclusive(start: string, endInclusive: string): string[] {
  const startMs = toMs(start);
  const endMs = toMs(endInclusive);
  const out: string[] = [];
  for (let ms = startMs; ms <= endMs; ms += DAY_MS) {
    out.push(new Date(ms).toISOString().slice(0, 10));
  }
  return out;
}

// A range counts as "exactly one calendar month" only when it starts on day 1
// and ends on that same month's last day -- never "close enough".
function isCalendarMonthRange(start: string, endInclusive: string): boolean {
  const [sy, sm, sd] = start.split("-").map(Number);
  if (sd !== 1) return false;
  const [ey, em, ed] = endInclusive.split("-").map(Number);
  if (sy !== ey || sm !== em) return false;
  const lastDay = new Date(Date.UTC(sy, sm, 0)).getUTCDate();
  return ed === lastDay;
}

// --- Live fetch -----------------------------------------------------------

// Any non-token failure (network error, malformed response, or a per-metric
// Graph error already isolated inside fetchAccountTotals) degrades this
// window's live totals to null so the snapshot chain below can take over.
// TOKEN_EXPIRED is the sole exception: it must surface so the caller (the
// route in index.ts) can react the same way every other IG route does.
async function liveTotals(
  deps: AccountMetricsDeps,
  sinceSec: number,
  untilSec: number,
): Promise<Partial<AccountTotals> | null> {
  try {
    return await fetchAccountTotals(deps.fetch, deps.accessToken, ALL_METRICS, sinceSec, untilSec);
  } catch (e) {
    if ((e as { code?: string } | null)?.code === "TOKEN_EXPIRED") throw e;
    console.warn(`[account-metrics] live fetch failed: ${(e as Error)?.message ?? String(e)}`);
    return null;
  }
}

function liveComplete(live: Partial<AccountTotals> | null): live is AccountTotals {
  if (!live) return false;
  return SIMPLE_METRICS.every((m) => typeof live[m] === "number") && !!live.follows_and_unfollows;
}

// --- Snapshot chain for one window ----------------------------------------

function daySumField(
  dailyRows: readonly DailyRow[],
  field: keyof DailyRow,
  expectedDays: readonly string[],
): number | null {
  if (dailyRows.length !== expectedDays.length) return null;
  const byDate = new Map(dailyRows.map((r) => [r.snapshot_date, r]));
  let sum = 0;
  for (const day of expectedDays) {
    const row = byDate.get(day);
    const v = row?.[field];
    if (typeof v !== "number") return null;
    sum += v;
  }
  return sum;
}

interface WindowResolution {
  totals: AccountTotals;
  source: Record<string, MetricSource>;
}

function resolveWindow(
  live: Partial<AccountTotals> | null,
  monthlyRow: MonthlyRow | null,
  dailyRows: readonly DailyRow[],
  expectedDays: readonly string[],
  isCalendarMonth: boolean,
): WindowResolution {
  const totals = {} as AccountTotals;
  const source: Record<string, MetricSource> = {};

  for (const metric of SIMPLE_METRICS) {
    const liveVal = live?.[metric];
    if (typeof liveVal === "number") {
      totals[metric] = liveVal;
      source[metric] = "live";
      continue;
    }
    if (isCalendarMonth && monthlyRow) {
      const monthlyVal = monthlyRow[MONTHLY_FIELD[metric]];
      if (typeof monthlyVal === "number") {
        totals[metric] = monthlyVal;
        source[metric] = "snapshot";
        continue;
      }
    }
    if (!UNIQUE_METRICS.has(metric)) {
      const sum = daySumField(dailyRows, DAILY_FIELD[metric], expectedDays);
      if (sum !== null) {
        totals[metric] = sum;
        source[metric] = "snapshot";
        continue;
      }
    }
    totals[metric] = null;
    source[metric] = null;
  }

  if (live?.follows_and_unfollows) {
    totals.follows_and_unfollows = live.follows_and_unfollows;
    source.follows_and_unfollows = "live";
  } else if (
    isCalendarMonth && monthlyRow &&
    typeof monthlyRow.follows_month === "number" && typeof monthlyRow.unfollows_month === "number"
  ) {
    totals.follows_and_unfollows = {
      follows: monthlyRow.follows_month,
      unfollows: monthlyRow.unfollows_month,
      net: monthlyRow.follows_month - monthlyRow.unfollows_month,
    } satisfies FollowsBreakdown;
    source.follows_and_unfollows = "snapshot";
  } else {
    const follows = daySumField(dailyRows, "follows_day", expectedDays);
    const unfollows = daySumField(dailyRows, "unfollows_day", expectedDays);
    if (follows !== null && unfollows !== null) {
      totals.follows_and_unfollows = { follows, unfollows, net: follows - unfollows };
      source.follows_and_unfollows = "snapshot";
    } else {
      totals.follows_and_unfollows = null;
      source.follows_and_unfollows = null;
    }
  }

  return { totals, source };
}

async function resolveWindowFull(
  deps: AccountMetricsDeps,
  start: string,
  endInclusive: string,
  live: Partial<AccountTotals> | null,
): Promise<WindowResolution> {
  if (liveComplete(live)) {
    const source: Record<string, MetricSource> = {};
    for (const m of ALL_METRICS) source[m] = "live";
    return { totals: live, source };
  }

  const isCalendarMonth = isCalendarMonthRange(start, endInclusive);
  const expectedDays = dateRangeInclusive(start, endInclusive);

  let monthlyRow: MonthlyRow | null = null;
  if (isCalendarMonth) {
    const { data, error } = await deps.db
      .from("instagram_account_metrics_monthly")
      .select(MONTHLY_COLUMNS)
      .eq("instagram_account_id", deps.account.id)
      .eq("month", start)
      .maybeSingle();
    if (error) {
      console.warn(`[account-metrics] monthly row query failed: ${error.message ?? String(error)}`);
    } else {
      monthlyRow = (data as MonthlyRow | null) ?? null;
    }
  }

  const { data: dailyData, error: dailyError } = await deps.db
    .from("instagram_account_metrics_daily")
    .select(DAILY_COLUMNS)
    .eq("instagram_account_id", deps.account.id)
    .gte("snapshot_date", start)
    .lte("snapshot_date", endInclusive)
    .order("snapshot_date", { ascending: true });
  if (dailyError) {
    console.warn(`[account-metrics] daily rows query failed: ${dailyError.message ?? String(dailyError)}`);
  }
  const dailyRows: DailyRow[] = dailyError ? [] : ((dailyData as DailyRow[] | null) ?? []);

  return resolveWindow(live, monthlyRow, dailyRows, expectedDays, isCalendarMonth);
}

function isAllNull(totals: AccountTotals): boolean {
  return SIMPLE_METRICS.every((m) => totals[m] === null) && totals.follows_and_unfollows === null;
}

// --- Followers: first/last instagram_follower_history point strictly within
// the requested window (dates inclusive) -- the user's explicit range, not a
// labeled month.
async function followersFor(
  deps: AccountMetricsDeps,
  start: string,
  end: string,
): Promise<FollowersWindow | null> {
  const { data, error } = await deps.db
    .from("instagram_follower_history")
    .select("date, follower_count")
    .eq("instagram_account_id", deps.account.id)
    .gte("date", start)
    .lte("date", end)
    .order("date", { ascending: true });
  if (error || !data || data.length < 2) return null;

  const rows = data as Array<{ date: string; follower_count: number }>;
  const first = rows[0];
  const last = rows[rows.length - 1];
  return { start: first.follower_count, end: last.follower_count, delta: last.follower_count - first.follower_count };
}

// --- Main entrypoint --------------------------------------------------------

export async function handleAccountMetrics(
  deps: AccountMetricsDeps,
  start: string,
  end: string,
): Promise<AccountMetricsResult> {
  const nowMs = deps.nowMs ?? Date.now();
  const nowSec = Math.floor(nowMs / 1000);

  const parsed = parseAccountMetricsRange(start, end, nowSec);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  const { effectiveEnd } = parsed;

  const startMs = toMs(start);
  const effEndMs = toMs(effectiveEnd);
  // lenDays MUST derive from effectiveEnd, not the raw (possibly future) end:
  // the current window itself is clamped to effectiveEnd, so a previous
  // window sized off the unclamped end would run longer than current.
  const lenDays = Math.round((effEndMs - startMs) / DAY_MS) + 1;

  const prevEnd = addDays(start, -1);
  const prevStart = addDays(prevEnd, -(lenDays - 1));

  const windowStartSec = nowSec - VIEWS_WINDOW_DAYS * DAY_SEC;

  const currentSinceSec = startMs / 1000;
  const currentUntilSec = Math.min(effEndMs / 1000 + DAY_SEC, nowSec);
  const currentEligible = currentSinceSec >= windowStartSec && currentUntilSec > currentSinceSec;

  const prevSinceSec = toMs(prevStart) / 1000;
  const prevUntilSec = Math.min(toMs(prevEnd) / 1000 + DAY_SEC, nowSec);
  const prevEligible = prevSinceSec >= windowStartSec && prevUntilSec > prevSinceSec;

  const [currentLive, prevLive] = await Promise.all([
    currentEligible ? liveTotals(deps, currentSinceSec, currentUntilSec) : Promise.resolve(null),
    prevEligible ? liveTotals(deps, prevSinceSec, prevUntilSec) : Promise.resolve(null),
  ]);

  const [currentResolved, prevResolved, currentFollowers, prevFollowers] = await Promise.all([
    resolveWindowFull(deps, start, effectiveEnd, currentLive),
    resolveWindowFull(deps, prevStart, prevEnd, prevLive),
    followersFor(deps, start, effectiveEnd),
    followersFor(deps, prevStart, prevEnd),
  ]);

  const current: AccountMetricsWindow = { ...currentResolved.totals, followers: currentFollowers };

  const previousEmpty = isAllNull(prevResolved.totals) && prevFollowers === null;
  const previous: AccountMetricsWindow | null = previousEmpty
    ? null
    : { ...prevResolved.totals, followers: prevFollowers };

  return {
    ok: true,
    body: {
      period: { start, end, effectiveEnd },
      current,
      previous,
      source: currentResolved.source,
    },
  };
}

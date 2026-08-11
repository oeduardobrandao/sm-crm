// Period math and Graph fetching for the account-level "views" KPI.
//
// Instagram constraints encoded here: user-insights data is stored for at
// most 90 days, and a single insights call covers at most ~30 days, so
// requested ranges are clamped to the window and fetched in chunks.
// All ranges are half-open [since, until) in unix seconds.

export const VIEWS_WINDOW_DAYS = 90;
export const VIEWS_CHUNK_DAYS = 30;
const DAY = 86400;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
    const startMs = Date.parse(`${start}T00:00:00Z`);
    const endMs = Date.parse(`${end}T00:00:00Z`);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return { ok: false, error: 'invalid dates' };
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

export async function fetchViewsTotal(
  fetchFn: typeof fetch,
  accessToken: string,
  since: number,
  until: number,
): Promise<number> {
  const url =
    `https://graph.instagram.com/me/insights?metric=views&metric_type=total_value&period=day` +
    `&since=${since}&until=${until}&access_token=${accessToken}`;
  const res = await fetchFn(url, { signal: AbortSignal.timeout(10_000) });
  const data = await res.json();
  if (data.error?.code === 190) throw { code: 'TOKEN_EXPIRED', message: 'Instagram token expired' };
  if (data.error) throw new Error(data.error.message || 'Graph API error');
  let total = 0;
  for (const insight of data.data ?? []) {
    if (insight.name === 'views') total += insight.total_value?.value || 0;
  }
  return total;
}

export async function sumViewsRange(
  fetchFn: typeof fetch,
  accessToken: string,
  since: number,
  until: number,
): Promise<number> {
  const totals = await Promise.all(
    chunkRange(since, until).map((c) => fetchViewsTotal(fetchFn, accessToken, c.since, c.until)),
  );
  return totals.reduce((sum, t) => sum + t, 0);
}

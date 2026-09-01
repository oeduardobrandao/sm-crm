// Graph fetching for the account-level "views" KPI.
//
// The window/chunk math (VIEWS_WINDOW_DAYS, VIEWS_CHUNK_DAYS, parseViewsRange,
// chunkRange) moved to the shared _shared/instagram-account-metrics.ts module
// so report-docs, the CRM analytics endpoint and the sync cron can reuse it;
// it's re-exported here unchanged so existing consumers of this file don't break.
// All ranges are half-open [since, until) in unix seconds.

import { chunkRange } from '../_shared/instagram-account-metrics.ts';

export {
  VIEWS_WINDOW_DAYS,
  VIEWS_CHUNK_DAYS,
  parseViewsRange,
  chunkRange,
} from '../_shared/instagram-account-metrics.ts';
export type { ViewsRange } from '../_shared/instagram-account-metrics.ts';

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

import type { QueryKey } from '@tanstack/react-query';

/**
 * `placeholderData` of the Conta posts query. The key ends with the baseline's `dataUpdatedAt`,
 * so a baseline refetch (window focus after `staleTime`) moves the posts query to a fresh key with
 * no cache: without a placeholder the page drops to its skeleton and unmounts an open metrics
 * dialog. Keep the previous posts only across that change: every other part of the key (client,
 * days, sort, period) must match, so a period or sort switch still shows the loading state.
 */
export function keepPostsAcrossBaselineRefresh<T>(
  prevData: T | undefined,
  prevQuery: { queryKey: QueryKey } | undefined,
  nextKey: QueryKey,
): T | undefined {
  if (prevData === undefined || !prevQuery) return undefined;
  const prevKey = prevQuery.queryKey;
  if (prevKey.length === 0 || prevKey.length !== nextKey.length) return undefined;
  for (let i = 0; i < nextKey.length - 1; i++) {
    if (!Object.is(prevKey[i], nextKey[i])) return undefined;
  }
  return prevData;
}

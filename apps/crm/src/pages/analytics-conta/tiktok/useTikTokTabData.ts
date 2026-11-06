// The TikTok tab's queries, shared by the desktop tab and its phone variant.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';
import {
  getTikTokBestTimes,
  getTikTokFollowerHistory,
  getTikTokOverview,
  getTikTokPostsAnalytics,
  isTikTokFeatureDisabled,
  TikTokNotConnectedError,
  type AnalyticsRange,
  type TikTokPostSort,
} from '../../../services/tiktokAnalytics';

type RetryOption = boolean | number | ((count: number, err: unknown) => boolean);

/**
 * Not connected and plan-gated answers are final: retrying them only delays the state. Any
 * other failure follows the QueryClient's own retry setting (TanStack's default is 3).
 */
function retryUnlessFinal(fallback: RetryOption = 3) {
  return (count: number, err: unknown): boolean => {
    if (err instanceof TikTokNotConnectedError || isTikTokFeatureDisabled(err)) return false;
    if (typeof fallback === 'function') return fallback(count, err);
    if (typeof fallback === 'number') return count < fallback;
    return fallback;
  };
}

/** Keeps the last period's numbers on screen while a new period loads, never another client's. */
const samePlaceholder =
  (clientId: number) =>
  <T>(prev: T | undefined, prevQuery?: { queryKey: readonly unknown[] }): T | undefined =>
    prevQuery?.queryKey[1] === clientId ? prev : undefined;

export function useTikTokTabData(clientId: number, range: AnalyticsRange, sort: TikTokPostSort) {
  const keepSameClient = samePlaceholder(clientId);
  const retry = retryUnlessFinal(
    useQueryClient().getDefaultOptions().queries?.retry as RetryOption | undefined,
  );
  const { features } = useWorkspaceLimits();
  // Fail open like the rest of the app: an unlimited workspace has no features object.
  const bestTimesLocked = features?.feature_best_times === false;
  const aiLocked = features?.feature_instagram_ai === false;

  // The overview decides the tab's state (not connected, expired, header); the other reads
  // wait for it, so a disconnected client gets one 404 instead of four.
  const overview = useQuery({
    queryKey: ['tt-overview', clientId, range],
    queryFn: () => getTikTokOverview(clientId, range),
    placeholderData: keepSameClient,
    retry,
  });
  const connected = overview.isSuccess;

  const history = useQuery({
    queryKey: ['tt-history', clientId, range],
    queryFn: () => getTikTokFollowerHistory(clientId, range),
    enabled: connected,
    placeholderData: keepSameClient,
    retry,
  });
  const posts = useQuery({
    queryKey: ['tt-posts', clientId, range, sort],
    queryFn: () => getTikTokPostsAnalytics(clientId, range, sort),
    enabled: connected,
    placeholderData: keepSameClient,
    retry,
  });
  const bestTimes = useQuery({
    queryKey: ['tt-best-times', clientId],
    queryFn: () => getTikTokBestTimes(clientId),
    enabled: connected && !bestTimesLocked,
    retry,
  });

  return {
    overview,
    history,
    posts,
    bestTimes,
    /** By plan, or the server answered feature_disabled. */
    bestTimesLocked: bestTimesLocked || isTikTokFeatureDisabled(bestTimes.error),
    aiLocked,
  };
}

/** Every tt-* query of one client: what a sync makes stale. */
export const isTikTokTabQuery = (clientId: number) => (query: { queryKey: readonly unknown[] }) =>
  typeof query.queryKey[0] === 'string' &&
  query.queryKey[0].startsWith('tt-') &&
  query.queryKey[1] === clientId;

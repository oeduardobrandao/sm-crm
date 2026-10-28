// The TikTok tab's queries, shared by the desktop tab and its phone variant.
import { useQuery } from '@tanstack/react-query';
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

/** Not connected and plan-gated answers are final: retrying them only delays the state. */
const retry = (count: number, err: unknown) =>
  !(err instanceof TikTokNotConnectedError) && !isTikTokFeatureDisabled(err) && count < 2;

/** Keeps the last period's numbers on screen while a new period loads, never another client's. */
const samePlaceholder =
  (clientId: number) =>
  <T>(prev: T | undefined, prevQuery?: { queryKey: readonly unknown[] }): T | undefined =>
    prevQuery?.queryKey[1] === clientId ? prev : undefined;

export function useTikTokTabData(clientId: number, range: AnalyticsRange, sort: TikTokPostSort) {
  const keepSameClient = samePlaceholder(clientId);
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

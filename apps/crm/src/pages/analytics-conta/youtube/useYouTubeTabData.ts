// The YouTube tab's queries, shared by the desktop tab and its phone variant.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getYouTubeDaily,
  getYouTubeDemographics,
  getYouTubeOverview,
  getYouTubeTopShorts,
  getYouTubeTraffic,
  getYouTubeVideos,
  isGoogleFeatureDisabled,
  YouTubeNotConnectedError,
  type AnalyticsRange,
  type YouTubeContentType,
  type YtVideoSort,
} from '../../../services/youtubeAnalytics';

type RetryOption = boolean | number | ((count: number, err: unknown) => boolean);

/**
 * Not connected and plan-gated answers are final: retrying them only delays the state. Any
 * other failure follows the QueryClient's own retry setting (TanStack's default is 3).
 */
function retryUnlessFinal(fallback: RetryOption = 3) {
  return (count: number, err: unknown): boolean => {
    if (err instanceof YouTubeNotConnectedError || isGoogleFeatureDisabled(err)) return false;
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

export function useYouTubeTabData(
  clientId: number,
  range: AnalyticsRange,
  type: YouTubeContentType,
  sort: YtVideoSort,
) {
  const keepSameClient = samePlaceholder(clientId);
  const retry = retryUnlessFinal(
    useQueryClient().getDefaultOptions().queries?.retry as RetryOption | undefined,
  );

  // The overview decides the tab's state (not connected, revoked, first sync, header); the
  // other reads wait for it, so a disconnected client gets one 404 instead of six.
  const overview = useQuery({
    queryKey: ['yt-overview', clientId, range, type],
    queryFn: () => getYouTubeOverview(clientId, range, type),
    placeholderData: keepSameClient,
    retry,
  });
  const connected = overview.isSuccess;

  const daily = useQuery({
    queryKey: ['yt-daily', clientId, range, type],
    queryFn: () => getYouTubeDaily(clientId, range, type),
    enabled: connected,
    placeholderData: keepSameClient,
    retry,
  });
  const traffic = useQuery({
    queryKey: ['yt-traffic', clientId, range],
    queryFn: () => getYouTubeTraffic(clientId, range),
    enabled: connected,
    placeholderData: keepSameClient,
    retry,
  });
  // The API's own last-28-days snapshot: it does not follow the period.
  const demographics = useQuery({
    queryKey: ['yt-demographics', clientId],
    queryFn: () => getYouTubeDemographics(clientId),
    enabled: connected,
    retry,
  });
  const videos = useQuery({
    queryKey: ['yt-videos', clientId, range, sort],
    queryFn: () => getYouTubeVideos(clientId, range, sort),
    enabled: connected,
    placeholderData: keepSameClient,
    retry,
  });
  const topShorts = useQuery({
    queryKey: ['yt-top-shorts', clientId, range],
    queryFn: () => getYouTubeTopShorts(clientId, range),
    enabled: connected,
    placeholderData: keepSameClient,
    retry,
  });

  return {
    overview,
    daily,
    traffic,
    demographics,
    videos,
    topShorts,
    /** The server answered feature_disabled: the plan lacks the YouTube or reports flag. */
    locked: isGoogleFeatureDisabled(overview.error),
  };
}

/** Every yt-* query of one client: what a sync makes stale. */
export const isYouTubeTabQuery = (clientId: number) => (query: { queryKey: readonly unknown[] }) =>
  typeof query.queryKey[0] === 'string' &&
  query.queryKey[0].startsWith('yt-') &&
  query.queryKey[1] === clientId;

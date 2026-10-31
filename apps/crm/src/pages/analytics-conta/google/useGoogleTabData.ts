// The Google Meu Negócio tab's queries, shared by the desktop tab and its phone variant.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  GbpNotConnectedError,
  getGbpDaily,
  getGbpKeywords,
  getGbpOverview,
  getGbpRatingDistribution,
  getGbpReviews,
  getGbpSurfaces,
  getGbpUnits,
  isGoogleFeatureDisabled,
  type AnalyticsRange,
  type GbpLocation,
  type GbpReviewFilter,
} from '../../../services/gbpAnalytics';

type RetryOption = boolean | number | ((count: number, err: unknown) => boolean);

/**
 * Not connected and plan-gated answers are final: retrying them only delays the state. Any
 * other failure follows the QueryClient's own retry setting (TanStack's default is 3).
 */
function retryUnlessFinal(fallback: RetryOption = 3) {
  return (count: number, err: unknown): boolean => {
    if (err instanceof GbpNotConnectedError || isGoogleFeatureDisabled(err)) return false;
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

export function useGoogleTabData(
  clientId: number,
  range: AnalyticsRange,
  location: GbpLocation,
  reviewFilter: GbpReviewFilter,
  /** YYYY-MM; null reads the latest closed month. */
  keywordsMonth: string | null,
) {
  const keepSameClient = samePlaceholder(clientId);
  const retry = retryUnlessFinal(
    useQueryClient().getDefaultOptions().queries?.retry as RetryOption | undefined,
  );

  // The overview decides the tab's state (not connected, revoked, first sync, header); the
  // other reads wait for it, so a disconnected client gets one 404 instead of seven.
  const overview = useQuery({
    queryKey: ['gbp-overview', clientId, range, location],
    queryFn: () => getGbpOverview(clientId, range, location),
    placeholderData: keepSameClient,
    retry,
  });
  const connected = overview.isSuccess;

  const daily = useQuery({
    queryKey: ['gbp-daily', clientId, range, location],
    queryFn: () => getGbpDaily(clientId, range, location),
    enabled: connected,
    placeholderData: keepSameClient,
    retry,
  });
  const surfaces = useQuery({
    queryKey: ['gbp-surfaces', clientId, range, location],
    queryFn: () => getGbpSurfaces(clientId, range, location),
    enabled: connected,
    placeholderData: keepSameClient,
    retry,
  });
  // Monthly and closed months only: it does not follow the period.
  const keywords = useQuery({
    queryKey: ['gbp-keywords', clientId, keywordsMonth, location],
    queryFn: () => getGbpKeywords(clientId, keywordsMonth, location),
    enabled: connected,
    placeholderData: keepSameClient,
    retry,
  });
  const reviews = useQuery({
    queryKey: ['gbp-reviews', clientId, reviewFilter, location],
    queryFn: () => getGbpReviews(clientId, reviewFilter, location),
    enabled: connected,
    placeholderData: keepSameClient,
    retry,
  });
  const ratingDistribution = useQuery({
    queryKey: ['gbp-rating-distribution', clientId, location],
    queryFn: () => getGbpRatingDistribution(clientId, location),
    enabled: connected,
    placeholderData: keepSameClient,
    retry,
  });
  const units = useQuery({
    queryKey: ['gbp-units', clientId, range],
    queryFn: () => getGbpUnits(clientId, range),
    enabled: connected,
    placeholderData: keepSameClient,
    retry,
  });

  return {
    overview,
    daily,
    surfaces,
    keywords,
    reviews,
    ratingDistribution,
    units,
    /** The server answered feature_disabled: the plan lacks the Google or reports flag. */
    locked: isGoogleFeatureDisabled(overview.error),
  };
}

/** Every gbp-* query of one client: what a sync makes stale. */
export const isGbpTabQuery = (clientId: number) => (query: { queryKey: readonly unknown[] }) =>
  typeof query.queryKey[0] === 'string' &&
  query.queryKey[0].startsWith('gbp-') &&
  query.queryKey[1] === clientId;

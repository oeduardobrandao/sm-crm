import { useQuery } from '@tanstack/react-query';
import { getMetricsHistory } from '../../lib/api';

export const METRICS_HISTORY_KEY = ['admin', 'metrics-history'] as const;

/** Shared by both chart sections and the page (same key, one request). */
export function useMetricsHistory() {
  return useQuery({
    queryKey: METRICS_HISTORY_KEY,
    queryFn: getMetricsHistory,
    staleTime: 5 * 60 * 1000,
  });
}

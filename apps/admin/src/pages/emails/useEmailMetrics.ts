import { useQuery } from '@tanstack/react-query';
import { getEmailMetrics } from '../../lib/api';

export const EMAIL_METRICS_KEY = ['admin', 'email-metrics'] as const;

export interface EmailRange {
  start: string;
  end: string;
}

/** `enabled` is false while a custom range is invalid, so nothing is fetched. */
export function useEmailMetrics(range: EmailRange, enabled = true) {
  return useQuery({
    queryKey: [...EMAIL_METRICS_KEY, range.start, range.end],
    queryFn: () => getEmailMetrics(range.start, range.end),
    staleTime: 60 * 1000,
    enabled,
  });
}

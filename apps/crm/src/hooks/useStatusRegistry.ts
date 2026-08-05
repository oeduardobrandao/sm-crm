import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPostStatusDefinitions } from '../store';
import { buildStatusRegistry } from '../pages/entregas/statusRegistry';
import type { StatusRegistry } from '../pages/entregas/statusRegistry';

export const POST_STATUS_DEFINITIONS_QUERY_KEY = ['post-status-definitions'] as const;

/**
 * The workspace's status registry (canonical + custom statuses). While the
 * definitions query is loading (or errored), the registry is canonical-only,
 * so every consumer degrades to today's behavior. Definitions change rarely;
 * settings mutations invalidate the key.
 */
export function useStatusRegistry(): StatusRegistry {
  const { data } = useQuery({
    queryKey: POST_STATUS_DEFINITIONS_QUERY_KEY,
    queryFn: () => getPostStatusDefinitions(),
    staleTime: 5 * 60 * 1000,
  });
  return useMemo(() => buildStatusRegistry(data ?? []), [data]);
}

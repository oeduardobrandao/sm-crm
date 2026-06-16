import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getScheduledPosts,
  getInstagramAccountStatuses,
  type IgAccountStatus,
} from '../../../store';
import { monthRangeISO, bucketByLocalDay } from './scheduledPostsUtils';

/**
 * Workspace-wide scheduled posts for `month`, bucketed by local day, plus a
 * client-scoped Instagram account-status map for inline publish gating.
 *
 * `enabled` MUST be passed explicitly: CalendarView is mounted for the whole
 * Calendar tab regardless of its internal mode, so mounting alone does not gate
 * the fetch. Pass `mode === 'publicacoes'`.
 */
export function useScheduledPosts(month: Date, enabled: boolean) {
  const { startISO, endISO } = monthRangeISO(month);

  const postsQuery = useQuery({
    queryKey: ['scheduled-posts', startISO, endISO],
    queryFn: () => getScheduledPosts(startISO, endISO),
    enabled,
  });

  const posts = useMemo(() => postsQuery.data ?? [], [postsQuery.data]);

  const clientIds = useMemo(
    () =>
      Array.from(
        new Set(posts.map((p) => p.cliente_id).filter((id): id is number => id != null)),
      ).sort((a, b) => a - b),
    [posts],
  );

  const igQuery = useQuery({
    queryKey: ['ig-account-statuses', clientIds.join(',')],
    queryFn: () => getInstagramAccountStatuses(clientIds),
    enabled: enabled && !postsQuery.isLoading && clientIds.length > 0,
  });

  const byDay = useMemo(() => bucketByLocalDay(posts), [posts]);

  const igStatuses = useMemo(
    () => igQuery.data ?? new Map<number, IgAccountStatus>(),
    [igQuery.data],
  );

  return {
    byDay,
    igStatuses,
    isLoading: postsQuery.isLoading,
  };
}

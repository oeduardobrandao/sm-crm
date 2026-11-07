import { useInfiniteQuery } from '@tanstack/react-query';
import { getEmailList, type EmailListCursor } from '../../lib/api';
import { statusesToEvents, type ListFilters } from './email-list-view';

export const EMAIL_LIST_KEY = ['admin', 'email-list'] as const;

/** Infinite list of sends. `enabled` is false while a custom range is invalid. */
export function useEmailList(filters: ListFilters, enabled = true) {
  const q = useInfiniteQuery({
    queryKey: [...EMAIL_LIST_KEY, filters],
    initialPageParam: null as EmailListCursor | null,
    queryFn: ({ pageParam }) =>
      getEmailList({
        start: filters.start,
        end: filters.end,
        categories: filters.categories,
        types: filters.types,
        events: statusesToEvents(filters.statuses),
        cursor: pageParam,
      }),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    staleTime: 60 * 1000,
    enabled,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const types = q.data?.pages[0]?.types ?? [];
  return { ...q, items, types };
}

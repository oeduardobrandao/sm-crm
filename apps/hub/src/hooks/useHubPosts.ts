import { useCallback, useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { fetchOlderPosts } from '../api';
import { HISTORY_OPTS, hubPostsHistoryKey, hubPostsQuery } from '../queries';
import { mergeById } from '../lib/mergeById';
import type { HubPost, HubPostsResponse, PostApproval } from '../types';

export interface UseHubPostsResult {
  data: HubPostsResponse | undefined;
  posts: HubPost[];
  postApprovals: PostApproval[];
  isLoading: boolean;
  isError: boolean;
  loadOlder: () => void;
  hasOlder: boolean;
  isLoadingOlder: boolean;
  olderError: boolean;
}

/**
 * The bounded shell (every in-flight post plus the last 90 days of published ones) and,
 * with `history`, older published posts loaded on demand with "Carregar posts anteriores".
 * Spec: docs/superpowers/specs/2026-10-02-hub-posts-bounded-design.md
 */
export function useHubPosts(
  token: string,
  opts: {
    history?: boolean;
    // Structural on purpose: UseQueryOptions<HubPostsResponse>['refetchInterval'] fails tsc
    // (TS2769) against hubPostsQuery's inferred string[] key.
    refetchInterval?: (query: { state: { data?: HubPostsResponse } }) => number | false;
  } = {},
): UseHubPostsResult {
  const shell = useQuery({ ...hubPostsQuery(token), refetchInterval: opts.refetchInterval });
  const olderCursor = shell.data?.olderCursor ?? null;

  // useInfiniteQuery fetches its first page the moment it is enabled, so it stays disabled
  // until the client asks. Tracking WHICH cursor was started also resets history when the
  // shell rolls over to a new day's cursor (the key includes it, so that is a fresh query).
  const [startedCursor, setStartedCursor] = useState<string | null>(null);
  const historyEnabled = !!opts.history && olderCursor !== null && startedCursor === olderCursor;

  const history = useInfiniteQuery({
    queryKey: hubPostsHistoryKey(token, olderCursor),
    queryFn: ({ pageParam }) => fetchOlderPosts(token, pageParam),
    initialPageParam: olderCursor ?? '',
    getNextPageParam: (page: HubPostsResponse) => page.nextCursor ?? undefined,
    enabled: historyEnabled,
    ...HISTORY_OPTS,
  });

  const historyData = historyEnabled ? history.data : undefined;
  const hasOlder =
    olderCursor !== null &&
    (historyData === undefined ? true : history.hasNextPage || history.isFetchNextPageError);

  const loadOlder = useCallback(() => {
    if (olderCursor === null || history.isFetching) return;
    if (startedCursor !== olderCursor) {
      setStartedCursor(olderCursor); // enabling the query fetches the first page
      return;
    }
    if (history.data === undefined) {
      void history.refetch();
      return;
    }
    if (history.hasNextPage || history.isFetchNextPageError) void history.fetchNextPage();
  }, [olderCursor, startedCursor, history]);

  const pages = historyData?.pages;
  const posts = useMemo(
    () => mergeById(shell.data?.posts ?? [], pages?.flatMap((p) => p.posts) ?? []),
    [shell.data?.posts, pages],
  );
  const postApprovals = useMemo(
    () => mergeById(shell.data?.postApprovals ?? [], pages?.flatMap((p) => p.postApprovals) ?? []),
    [shell.data?.postApprovals, pages],
  );

  return {
    data: shell.data,
    posts,
    postApprovals,
    isLoading: shell.isLoading,
    isError: shell.isError,
    loadOlder,
    hasOlder,
    isLoadingOlder: historyEnabled && history.isFetching,
    olderError: historyEnabled && (history.isError || history.isFetchNextPageError),
  };
}

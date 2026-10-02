import { QueryClient, queryOptions } from '@tanstack/react-query';
import { matchPath } from 'react-router-dom';
import { fetchBootstrap, fetchPosts } from './api';

// Fetched once per visit, like the effect it replaced: a refetch on window
// focus would spend the shared hub-read budget for data that never changes
// mid-session. No retry (on mount either), so an invalid link shows its error
// right away and costs one bad-token hit, not two.
export const hubBootstrapQuery = (workspace: string, token: string) =>
  queryOptions({
    queryKey: ['hub-bootstrap', workspace, token],
    queryFn: () => fetchBootstrap(workspace, token),
    staleTime: Infinity,
    retry: false,
    retryOnMount: false,
  });

// Every hub-posts reader (HomePage, Postagens, Aprovações, the nav badges)
// shares this key and inherits the staleTime below.
const HUB_POSTS_KEY = 'hub-posts';

export function createHubQueryClient() {
  const queryClient = new QueryClient();
  // prefetchHubShell lands the posts before any reader mounts; with the default
  // staleTime of 0 each reader's mount would refetch them straight away.
  // Mutations still invalidate, so this only drops redundant background refetches.
  queryClient.setQueryDefaults([HUB_POSTS_KEY], { staleTime: 30_000 });
  return queryClient;
}

/**
 * Starts the two requests every Hub route needs (bootstrap, and the posts the
 * nav's pending-approvals badge reads) before the router has even downloaded
 * the page chunk. Without this, bootstrap waits for the chunk and posts wait
 * for bootstrap: three round trips in a row instead of one. HubShell and the
 * pages read the same cache entries.
 */
export function prefetchHubShell(queryClient: QueryClient, pathname: string) {
  const match = matchPath({ path: '/:workspace/hub/:token', end: false }, pathname);
  const { workspace, token } = match?.params ?? {};
  if (!workspace || !token) return;
  void queryClient.prefetchQuery(hubBootstrapQuery(workspace, token));
  void queryClient.prefetchQuery({
    queryKey: [HUB_POSTS_KEY, token],
    queryFn: () => fetchPosts(token),
  });
}

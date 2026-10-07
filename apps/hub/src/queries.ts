import {
  QueryClient,
  infiniteQueryOptions,
  keepPreviousData,
  queryOptions,
} from '@tanstack/react-query';
import { matchPath } from 'react-router-dom';
import {
  fetchAgenda,
  fetchAgendaItem,
  fetchAgendaPeriodo,
  fetchBootstrap,
  fetchConvite,
  fetchPost,
  fetchPosts,
  fetchPostsInRange,
  CONVITE_INDISPONIVEL,
} from './api';
import type { HubAgendaCursor, HubAgendaItem, HubAgendaResponse } from './types';

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
export const HUB_POSTS_KEY = 'hub-posts';

export const hubPostsQuery = (token: string) =>
  queryOptions({ queryKey: [HUB_POSTS_KEY, token], queryFn: () => fetchPosts(token) });

/**
 * History and range fail fast: one retry, shown in about a second instead of ~7s.
 * Published rows don't change mid-session, so they never refetch on focus or go stale;
 * a reload refreshes them (or a remount after `invalidateHubPosts` marked them invalidated).
 */
export const HISTORY_OPTS = {
  retry: 1,
  retryDelay: 300,
  staleTime: Infinity,
  refetchOnWindowFocus: false,
} as const;

export const hubPostsHistoryKey = (token: string, olderCursor: string | null) =>
  [HUB_POSTS_KEY, token, 'history', olderCursor] as const;

export const hubPostsRangeQuery = (token: string, from: string, to: string) =>
  queryOptions({
    queryKey: [HUB_POSTS_KEY, token, 'range', from],
    queryFn: () => fetchPostsInRange(token, from, to),
    ...HISTORY_OPTS,
  });

// A 404 ("não disponível") is an answer, not a failure to retry.
export const hubPostQuery = (token: string, postId: number) =>
  queryOptions({
    queryKey: [HUB_POSTS_KEY, token, 'post', postId],
    queryFn: () => fetchPost(token, postId),
    retry: false,
  });

/**
 * After an approval or correction: refetch the shell and any open single post. History pages
 * and range months are published posts the action cannot change, so they are only marked
 * stale (refetching them would spend one hub-read hit per loaded page).
 */
export function invalidateHubPosts(qc: QueryClient, token: string) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: [HUB_POSTS_KEY, token], exact: true }),
    qc.invalidateQueries({ queryKey: [HUB_POSTS_KEY, token, 'post'] }),
    qc.invalidateQueries({ queryKey: [HUB_POSTS_KEY, token, 'history'], refetchType: 'none' }),
    qc.invalidateQueries({ queryKey: [HUB_POSTS_KEY, token, 'range'], refetchType: 'none' }),
  ]);
}

// ── Agenda ──────────────────────────────────────────────────────────────────

export const HUB_AGENDA_KEY = 'hub-agenda';
export const HUB_AGENDA_ITEM_KEY = 'hub-agenda-item';

/**
 * The Agenda page and the Home block share this one infinite query (Home reads
 * `pages[0]`), so the cache entry always has the infinite shape. A short
 * staleTime keeps Home -> Agenda navigation from spending a second hub-read hit.
 */
export const hubAgendaQuery = (token: string) =>
  infiniteQueryOptions({
    queryKey: [HUB_AGENDA_KEY, token],
    queryFn: ({ pageParam }) => fetchAgenda(token, pageParam),
    initialPageParam: undefined as HubAgendaCursor | undefined,
    getNextPageParam: (last: HubAgendaResponse) => last.proximo ?? undefined,
    staleTime: 30_000,
  });

// A 404 (gone, or another client's) is an answer, not a failure to retry.
export const hubAgendaItemQuery = (token: string, ocorrenciaId: number) =>
  queryOptions({
    queryKey: [HUB_AGENDA_ITEM_KEY, token, ocorrenciaId],
    queryFn: () => fetchAgendaItem(token, ocorrenciaId).then((r) => r.item),
    retry: false,
    staleTime: 30_000,
  });

/**
 * The home calendar's month of events. Unlike the posts range, it runs for EVERY month shown.
 * Under the `[HUB_AGENDA_KEY, token]` prefix so `invalidateHubAgenda` drops it too; the
 * previous month stays on screen while the next one loads.
 */
export const hubAgendaPeriodoQuery = (token: string, de: string, ate: string) =>
  queryOptions({
    queryKey: [HUB_AGENDA_KEY, token, 'periodo', de],
    queryFn: () => fetchAgendaPeriodo(token, de, ate).then((r) => r.itens),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    // Fail fast like the posts range: the calendar keeps working, the panel offers a retry.
    retry: 1,
    retryDelay: 300,
  });

export const hubAgendaPeriodoPrefix = (token: string) => [HUB_AGENDA_KEY, token, 'periodo'];

/** Writes the item a mutation returned into every cached copy (list pages, deep link, months). */
export function setHubAgendaItem(qc: QueryClient, token: string, item: HubAgendaItem) {
  qc.setQueryData(hubAgendaQuery(token).queryKey, (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            itens: page.itens.map((i) => (i.ocorrencia_id === item.ocorrencia_id ? item : i)),
          })),
        }
      : data,
  );
  qc.setQueryData([HUB_AGENDA_ITEM_KEY, token, item.ocorrencia_id], (old: unknown) =>
    old ? item : old,
  );
  qc.setQueriesData<HubAgendaItem[]>({ queryKey: hubAgendaPeriodoPrefix(token) }, (itens) =>
    itens?.map((i) => (i.ocorrencia_id === item.ocorrencia_id ? item : i)),
  );
}

/** After a failed write (moved, ended, already resolved): reload what the client sees. */
export function invalidateHubAgenda(qc: QueryClient, token: string) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: [HUB_AGENDA_KEY, token] }),
    qc.invalidateQueries({ queryKey: [HUB_AGENDA_ITEM_KEY, token] }),
  ]);
}

// ── Guest invite ────────────────────────────────────────────────────────────

/** The invite page. Its 404 ("não está mais disponível") is an answer, never retried. */
export const conviteQuery = (token: string) =>
  queryOptions({
    queryKey: ['convite', token],
    queryFn: () => fetchConvite(token),
    retry: (falhas, erro) => erro.message !== CONVITE_INDISPONIVEL && falhas < 1,
    retryDelay: 300,
    staleTime: 30_000,
  });

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
  void queryClient.prefetchQuery(hubPostsQuery(token));
}

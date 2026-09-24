import { useQuery } from '@tanstack/react-query';
import { getActivePosts, type ActivePost } from '../../../store';
import { getPostPublishState } from '../postLabels';

/** Estável enquanto a query não resolveu: um `?? []` novo a cada render
 *  invalidaria todo useMemo que lê `posts` (mesmo aviso de useEntregasData). */
const EMPTY_POSTS: ActivePost[] = [];

/**
 * Every post of every active workflow (scheduled or not), for the Kanban/Lista
 * "Publicações" modes, the "Sem processo" section and the "Minha fila" view.
 *
 * `enabled` MUST be passed explicitly: EntregasPage mounts this hook regardless
 * of the active view/mode, so mounting alone does not gate the fetch. Pass
 * true only while one of those consumers is actually visible.
 */
export function useActivePosts(enabled: boolean) {
  const query = useQuery({
    queryKey: ['active-posts'],
    queryFn: getActivePosts,
    enabled,
    // While any post is mid-publishing (agendado + scheduled time passed), poll so
    // the board flips to "Postado" on its own. Stops once nothing is publishing.
    refetchInterval: (query) =>
      (query.state.data ?? []).some((p) => getPostPublishState(p) === 'publicando') ? 15000 : false,
  });

  return {
    posts: query.data ?? EMPTY_POSTS,
    isLoading: query.isLoading,
    // Sem dados e sem erro ainda. Cobre o cold start pausado/offline, em que
    // isLoading (isPending && isFetching) é false. Uma query DESLIGADA também é
    // pending: quem lê isto precisa checar que a passou `enabled` = true.
    isPending: query.isPending,
    // Só erro SEM dados (primeira carga falhou). Um refetch em background que
    // falha com cache presente mantém a lista na tela em vez de trocá-la pelo erro.
    isError: query.isLoadingError,
  };
}

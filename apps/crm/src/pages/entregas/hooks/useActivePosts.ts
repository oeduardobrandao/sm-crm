import { useQuery } from '@tanstack/react-query';
import { getActivePosts } from '../../../store';
import { getPostPublishState } from '../postLabels';

/**
 * Every post of every active workflow (scheduled or not), for the Kanban/Lista
 * "Publicações" modes.
 *
 * `enabled` MUST be passed explicitly: EntregasPage mounts this hook regardless
 * of the active view/mode, so mounting alone does not gate the fetch. Pass
 * true only while a posts mode is actually visible.
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
    posts: query.data ?? [],
    isLoading: query.isLoading,
  };
}

import { useQuery } from '@tanstack/react-query';
// Read only inside the query function (like usePostDestinations): the drawer test harnesses mock
// '@/store' with a fixed export list, and the query only runs for a Geral suggestion.
import { getPostTargets, type PostEditSuggestion, type WorkflowPost } from '@/store';
import { suggestionTouchesGeral, type LiveGeralTarget } from '../editSuggestionFields';

/**
 * The live Geral row for reviewing a client suggestion. The Geral caption lives in `post_targets`,
 * not in the post the drawers load, so it is fetched only while a pending suggestion changed it
 * (`geral_caption` in `changed_fields`). Its own key under the `['post-targets', postId]` prefix:
 * every destination write and an accept invalidate that prefix, so it refreshes with them, but it
 * never fills `usePostDestinations`'s entry (which the editor reads as "multiplatform data" even
 * while that hook is disabled).
 *
 * `undefined` = not needed, or still loading (the review never judges a conflict against it);
 * `null` = the post has no Geral destination.
 */
export function useSuggestionGeralTarget(
  post: Pick<WorkflowPost, 'id' | 'platform'>,
  suggestion: PostEditSuggestion | null,
): LiveGeralTarget | null | undefined {
  const postId = post.id ?? null;
  const enabled = postId != null && suggestionTouchesGeral(suggestion);
  const { data } = useQuery({
    queryKey: ['post-targets', postId, post.platform ?? null, 'suggestion-review'],
    queryFn: () => getPostTargets(postId!),
    enabled,
  });
  if (!enabled || !data) return undefined;
  const row = data.find((t) => t.platform === 'geral');
  return row ? { id: row.id, caption: row.caption } : null;
}

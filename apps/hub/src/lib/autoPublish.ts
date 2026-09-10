import type { HubPostsResponse } from '../types';

/**
 * Whether approving a post of the given workflow will auto-schedule it.
 * False while the workflow is mid dual-approval (a later client-approval etapa
 * is still open), matching hub-approve's server-side guard — the card must not
 * promise "aprovar = agendar" during an earlier approval cycle.
 *
 * workflowId is `number | null` because a post avulso (fora de fluxo) has no
 * workflow at all, so it can never appear in the workflow suspended-ids array.
 * For an avulso post, the guard instead falls back to `postId`: an avulso can
 * have its own individual process with another client-approval etapa ahead,
 * mirrored server-side by hub-approve's suspended-post-ids check. Old
 * backends that do not send `autoPublishSuspendedPostIds` read as "not
 * suspended" (compatible default).
 */
export function isAutoPublishActive(
  data:
    | Pick<
        HubPostsResponse,
        'autoPublishOnApproval' | 'autoPublishSuspendedWorkflowIds' | 'autoPublishSuspendedPostIds'
      >
    | undefined,
  workflowId: number | null,
  postId: number,
): boolean {
  if (!data?.autoPublishOnApproval) return false;
  if (workflowId == null) return !(data.autoPublishSuspendedPostIds ?? []).includes(postId);
  return !(data.autoPublishSuspendedWorkflowIds ?? []).includes(workflowId);
}

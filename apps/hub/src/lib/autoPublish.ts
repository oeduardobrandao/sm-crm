import type { HubPostsResponse } from '../types';

/**
 * Whether approving a post of the given workflow will auto-schedule it.
 * False while the workflow is mid dual-approval (a later client-approval etapa
 * is still open), matching hub-approve's server-side guard — the card must not
 * promise "aprovar = agendar" during an earlier approval cycle.
 */
export function isAutoPublishActive(
  data:
    | Pick<HubPostsResponse, 'autoPublishOnApproval' | 'autoPublishSuspendedWorkflowIds'>
    | undefined,
  workflowId: number,
): boolean {
  if (!data?.autoPublishOnApproval) return false;
  return !(data.autoPublishSuspendedWorkflowIds ?? []).includes(workflowId);
}

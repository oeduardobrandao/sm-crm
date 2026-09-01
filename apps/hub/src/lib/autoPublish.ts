import type { HubPostsResponse } from '../types';

/**
 * Whether approving a post of the given workflow will auto-schedule it.
 * False while the workflow is mid dual-approval (a later client-approval etapa
 * is still open), matching hub-approve's server-side guard — the card must not
 * promise "aprovar = agendar" during an earlier approval cycle.
 *
 * workflowId is `number | null` because a post avulso (fora de fluxo) has no
 * workflow at all, so it can never appear in the suspended-ids array (every
 * entry there is a workflow id) — it reads as "not suspended" here, same as
 * hub-approve's own isFinalApprovalCycle early return for a null workflow_id.
 */
export function isAutoPublishActive(
  data:
    | Pick<HubPostsResponse, 'autoPublishOnApproval' | 'autoPublishSuspendedWorkflowIds'>
    | undefined,
  workflowId: number | null,
): boolean {
  if (!data?.autoPublishOnApproval) return false;
  if (workflowId == null) return true;
  return !(data.autoPublishSuspendedWorkflowIds ?? []).includes(workflowId);
}

import { describe, it, expect } from 'vitest';
import { isAutoPublishActive } from '../autoPublish';

describe('isAutoPublishActive', () => {
  it('is false while data has not loaded', () => {
    expect(isAutoPublishActive(undefined, 7, 1)).toBe(false);
  });

  it('is false when the client has auto-publish off', () => {
    expect(isAutoPublishActive({ autoPublishOnApproval: false }, 7, 1)).toBe(false);
  });

  it('is true when auto-publish is on and the workflow is not suspended', () => {
    expect(
      isAutoPublishActive(
        { autoPublishOnApproval: true, autoPublishSuspendedWorkflowIds: [9] },
        7,
        1,
      ),
    ).toBe(true);
  });

  it('is false for a workflow mid dual-approval (suspended)', () => {
    expect(
      isAutoPublishActive(
        { autoPublishOnApproval: true, autoPublishSuspendedWorkflowIds: [7] },
        7,
        1,
      ),
    ).toBe(false);
  });

  it('treats a missing suspended list as no suspensions (older backend)', () => {
    expect(isAutoPublishActive({ autoPublishOnApproval: true }, 7, 1)).toBe(true);
  });

  it('is true for a post avulso (workflowId null) when auto-publish is on', () => {
    // An avulso post has no workflow etapas at all, so it can never appear in
    // autoPublishSuspendedWorkflowIds -- matches hub-approve's own
    // isFinalApprovalCycle early return for a null workflow_id.
    expect(
      isAutoPublishActive(
        { autoPublishOnApproval: true, autoPublishSuspendedWorkflowIds: [7] },
        null,
        1,
      ),
    ).toBe(true);
  });

  it('is false for a post avulso when auto-publish is off', () => {
    expect(isAutoPublishActive({ autoPublishOnApproval: false }, null, 1)).toBe(false);
  });

  it('é falso para um avulso cujo processo individual está suspenso', () => {
    expect(
      isAutoPublishActive(
        { autoPublishOnApproval: true, autoPublishSuspendedPostIds: [42] },
        null,
        42,
      ),
    ).toBe(false);
  });

  it('é verdadeiro para um avulso fora da lista de suspensos', () => {
    expect(
      isAutoPublishActive(
        { autoPublishOnApproval: true, autoPublishSuspendedPostIds: [42] },
        null,
        7,
      ),
    ).toBe(true);
  });

  it('ignora a lista de posts quando o post tem fluxo', () => {
    expect(
      isAutoPublishActive(
        {
          autoPublishOnApproval: true,
          autoPublishSuspendedPostIds: [42],
          autoPublishSuspendedWorkflowIds: [],
        },
        9,
        42,
      ),
    ).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import { isAutoPublishActive } from '../autoPublish';

describe('isAutoPublishActive', () => {
  it('is false while data has not loaded', () => {
    expect(isAutoPublishActive(undefined, 7)).toBe(false);
  });

  it('is false when the client has auto-publish off', () => {
    expect(isAutoPublishActive({ autoPublishOnApproval: false }, 7)).toBe(false);
  });

  it('is true when auto-publish is on and the workflow is not suspended', () => {
    expect(
      isAutoPublishActive({ autoPublishOnApproval: true, autoPublishSuspendedWorkflowIds: [9] }, 7),
    ).toBe(true);
  });

  it('is false for a workflow mid dual-approval (suspended)', () => {
    expect(
      isAutoPublishActive({ autoPublishOnApproval: true, autoPublishSuspendedWorkflowIds: [7] }, 7),
    ).toBe(false);
  });

  it('treats a missing suspended list as no suspensions (older backend)', () => {
    expect(isAutoPublishActive({ autoPublishOnApproval: true }, 7)).toBe(true);
  });

  it('is true for a post avulso (workflowId null) when auto-publish is on', () => {
    // An avulso post has no workflow etapas at all, so it can never appear in
    // autoPublishSuspendedWorkflowIds -- matches hub-approve's own
    // isFinalApprovalCycle early return for a null workflow_id.
    expect(
      isAutoPublishActive(
        { autoPublishOnApproval: true, autoPublishSuspendedWorkflowIds: [7] },
        null,
      ),
    ).toBe(true);
  });

  it('is false for a post avulso when auto-publish is off', () => {
    expect(isAutoPublishActive({ autoPublishOnApproval: false }, null)).toBe(false);
  });
});

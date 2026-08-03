import { describe, it, expect, vi, beforeEach } from 'vitest';

const reportPaywallHit = vi.fn();
vi.mock('../paywall-report', () => ({
  reportPaywallHit: (...a: unknown[]) => reportPaywallHit(...a),
}));

const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }));

import { handleEntitlementMutationError } from '../entitlement-toast';

describe('handleEntitlementMutationError', () => {
  beforeEach(() => {
    toastError.mockClear();
    reportPaywallHit.mockClear();
  });

  it('shows an upgrade toast for an entitlement error and returns true', () => {
    const handled = handleEntitlementMutationError(
      { message: 'plan_limit_exceeded:max_clients' },
      'ws-1',
    );
    expect(handled).toBe(true);
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0][0]).toContain('clientes');
  });

  it('ignores non-entitlement errors and returns false', () => {
    const handled = handleEntitlementMutationError(new Error('boom'), 'ws-1');
    expect(handled).toBe(false);
    expect(toastError).not.toHaveBeenCalled();
  });
});

describe('handleEntitlementMutationError paywall reporting', () => {
  beforeEach(() => reportPaywallHit.mockClear());

  it('reports a DB-trigger feature denial', () => {
    handleEntitlementMutationError({ message: 'feature_disabled:feature_hub_portal' }, 'ws-1');
    expect(reportPaywallHit).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      feature: 'feature_hub_portal',
    });
  });

  it('reports an edge-function feature denial', () => {
    handleEntitlementMutationError({ error: 'feature_disabled', feature: 'feature_mcp' }, 'ws-1');
    expect(reportPaywallHit).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      feature: 'feature_mcp',
    });
  });

  it('does NOT report a limit error (limit gates are slice 2)', () => {
    handleEntitlementMutationError({ message: 'plan_limit_exceeded:max_clients' }, 'ws-1');
    expect(reportPaywallHit).not.toHaveBeenCalled();
  });

  it('does not report when no workspace id is known', () => {
    handleEntitlementMutationError({ message: 'feature_disabled:feature_leads' }, null);
    expect(reportPaywallHit).not.toHaveBeenCalled();
  });

  it('returns false and reports nothing for an unrelated error', () => {
    expect(handleEntitlementMutationError(new Error('network'), 'ws-1')).toBe(false);
    expect(reportPaywallHit).not.toHaveBeenCalled();
  });
});

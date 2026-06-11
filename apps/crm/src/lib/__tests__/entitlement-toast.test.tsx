import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleEntitlementMutationError } from '../entitlement-toast';

const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }));

describe('handleEntitlementMutationError', () => {
  beforeEach(() => toastError.mockClear());

  it('shows an upgrade toast for an entitlement error and returns true', () => {
    const handled = handleEntitlementMutationError({ message: 'plan_limit_exceeded:max_clients' });
    expect(handled).toBe(true);
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0][0]).toContain('clientes');
  });

  it('ignores non-entitlement errors and returns false', () => {
    const handled = handleEntitlementMutationError(new Error('boom'));
    expect(handled).toBe(false);
    expect(toastError).not.toHaveBeenCalled();
  });
});

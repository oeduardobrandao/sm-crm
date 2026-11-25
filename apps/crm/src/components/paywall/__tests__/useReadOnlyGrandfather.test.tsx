import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/hooks/useWorkspaceLimits', () => ({ useWorkspaceLimits: vi.fn() }));
vi.mock('@/services/billing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/billing')>()),
  getEffectivePlanWithSource: vi.fn(),
}));

import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';
import { getEffectivePlanWithSource } from '@/services/billing';
import { useReadOnlyGrandfather } from '../useReadOnlyGrandfather';

const rt = (outcome: string | null) => ({
  startedAt: '2026-11-10T17:00:00Z',
  endsAt: '2026-11-24T17:00:00Z',
  endedAt: outcome ? '2026-11-24T17:05:00Z' : null,
  outcome,
  cardAddedAt: null,
  firstPaidAt: null,
});

function limits(featureOn: boolean) {
  vi.mocked(useWorkspaceLimits).mockReturnValue({
    features: { feature_financial: featureOn, feature_contracts: featureOn },
    limits: {},
    isLoading: false,
    isUnlimited: false,
  } as never);
}

function run() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useReadOnlyGrandfather('feature_financial'), { wrapper });
}

beforeEach(() => vi.clearAllMocks());

describe('useReadOnlyGrandfather', () => {
  it('is read-only for an ex-trial workspace on Free', async () => {
    limits(false);
    vi.mocked(getEffectivePlanWithSource).mockResolvedValue({
      planId: null,
      planSource: 'system',
      reverseTrial: rt('downgraded'),
    } as never);
    const { result } = run();
    expect(result.current).toEqual({ readOnly: false, pending: true });
    await waitFor(() => expect(result.current).toEqual({ readOnly: true, pending: false }));
  });

  it('stays read-only on a later plan that still lacks the flag', async () => {
    limits(false);
    vi.mocked(getEffectivePlanWithSource).mockResolvedValue({
      planId: 'start',
      planSource: 'stripe',
      reverseTrial: rt('downgraded'),
    } as never);
    const { result } = run();
    await waitFor(() => expect(result.current).toEqual({ readOnly: true, pending: false }));
  });

  it('stays locked for any other Free workspace', async () => {
    limits(false);
    vi.mocked(getEffectivePlanWithSource).mockResolvedValue({
      planId: null,
      planSource: 'system',
      reverseTrial: rt(null),
    } as never);
    const { result } = run();
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.readOnly).toBe(false);
  });

  it('never queries when the plan has the feature', () => {
    limits(true);
    const { result } = run();
    expect(result.current).toEqual({ readOnly: false, pending: false });
    expect(getEffectivePlanWithSource).not.toHaveBeenCalled();
  });

  it('fails closed (locked, not pending) when the plan read errors', async () => {
    limits(false);
    vi.mocked(getEffectivePlanWithSource).mockRejectedValue(new Error('boom'));
    const { result } = run();
    await waitFor(() => expect(result.current).toEqual({ readOnly: false, pending: false }));
  });
});

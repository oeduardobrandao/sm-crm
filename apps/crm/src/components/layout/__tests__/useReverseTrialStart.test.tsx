import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('../../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/services/billing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/billing')>();
  return { ...actual, getReverseTrialOffer: vi.fn(), startReverseTrial: vi.fn() };
});
vi.mock('@/lib/analytics', () => ({ captureEvent: vi.fn() }));

import { useAuth } from '../../../context/AuthContext';
import { getReverseTrialOffer, startReverseTrial } from '@/services/billing';
import { captureEvent } from '@/lib/analytics';
import { useReverseTrialStart } from '../useReverseTrialStart';

const ENDS_AT = '2026-12-08T17:00:00Z';

function setAuth(role: 'owner' | 'admin' | 'agent', workspaceRole: typeof role | null = null) {
  vi.mocked(useAuth).mockReturnValue({ role, workspaceRole } as never);
}

function run(pathname: string, opts?: { disabled?: boolean }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const seen: boolean[] = [];
  const hook = renderHook(
    ({ path }) => {
      const state = useReverseTrialStart(path, opts);
      seen.push(state.pending);
      return state;
    },
    { wrapper, initialProps: { path: pathname } },
  );
  return { ...hook, client, invalidate, seen };
}

beforeEach(() => {
  vi.clearAllMocks();
  setAuth('owner');
  vi.mocked(getReverseTrialOffer).mockResolvedValue({ enabled: true, eligible: true, auto: true });
  vi.mocked(startReverseTrial).mockResolvedValue({ started: true, endsAt: ENDS_AT });
});

afterEach(() => {
  (window as unknown as { Capacitor?: unknown }).Capacitor = undefined;
});

describe('useReverseTrialStart', () => {
  it('starts_once_for_new_owner', async () => {
    const { result, client, invalidate, rerender } = run('/dashboard');
    expect(result.current.pending).toBe(true);
    await waitFor(() => expect(result.current.welcomeEndsAt).toBe(ENDS_AT));
    expect(result.current.pending).toBe(false);
    expect(startReverseTrial).toHaveBeenCalledTimes(1);
    expect(startReverseTrial).toHaveBeenCalledWith('signup');
    expect(captureEvent).toHaveBeenCalledWith('reverse_trial_started', { source: 'signup' });
    const keys = invalidate.mock.calls.map((c) => (c[0] as { queryKey: unknown }).queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([['billing'], ['workspace-limits'], ['workspace-usage']]),
    );

    // Navigation and refetches never start it again in the same mount.
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['billing'] });
    });
    rerender({ path: '/clientes' });
    expect(startReverseTrial).toHaveBeenCalledTimes(1);

    act(() => result.current.dismissWelcome());
    expect(result.current.welcomeEndsAt).toBeNull();
  });

  it('runs_on_native', async () => {
    (window as unknown as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    const { result } = run('/dashboard');
    await waitFor(() => expect(result.current.welcomeEndsAt).toBe(ENDS_AT));
    expect(startReverseTrial).toHaveBeenCalledWith('signup');
  });

  it('agent_never_starts', () => {
    setAuth('agent');
    const { result } = run('/dashboard');
    expect(result.current.pending).toBe(false);
    expect(getReverseTrialOffer).not.toHaveBeenCalled();
    expect(startReverseTrial).not.toHaveBeenCalled();
  });

  it('follows the active workspace role', () => {
    setAuth('owner', 'admin');
    run('/dashboard');
    expect(getReverseTrialOffer).not.toHaveBeenCalled();
  });

  it('existing_free_owner_not_started', async () => {
    vi.mocked(getReverseTrialOffer).mockResolvedValue({
      enabled: true,
      eligible: true,
      auto: false,
    });
    const { result } = run('/dashboard');
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(startReverseTrial).not.toHaveBeenCalled();
    expect(result.current.welcomeEndsAt).toBeNull();
  });

  it.each(['/comecar', '/workspace-setup', '/configuracao/cobranca', '/oauth/callback'])(
    'not_on_comecar_intent_path %s',
    (path) => {
      const { result } = run(path);
      expect(result.current.pending).toBe(false);
      expect(getReverseTrialOffer).not.toHaveBeenCalled();
      expect(startReverseTrial).not.toHaveBeenCalled();
    },
  );

  it('does nothing while disabled (owner still needs setup)', () => {
    const { result } = run('/dashboard', { disabled: true });
    expect(result.current.pending).toBe(false);
    expect(getReverseTrialOffer).not.toHaveBeenCalled();
  });

  it('not_eligible_no_redirect', async () => {
    vi.mocked(startReverseTrial).mockResolvedValue({
      started: false,
      endsAt: null,
      reason: 'not_eligible',
    });
    const { result } = run('/dashboard');
    await waitFor(() => expect(startReverseTrial).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.welcomeEndsAt).toBeNull();
    expect(captureEvent).not.toHaveBeenCalled();
  });

  it('rpc_error_no_loop', async () => {
    vi.mocked(startReverseTrial).mockRejectedValue(new Error('boom'));
    const { result, client, seen } = run('/dashboard');
    await waitFor(() => expect(startReverseTrial).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.pending).toBe(false));
    const settledAt = seen.length;
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['billing'] });
    });
    expect(startReverseTrial).toHaveBeenCalledTimes(1);
    expect(seen.slice(settledAt).some(Boolean)).toBe(false);
    expect(result.current.welcomeEndsAt).toBeNull();
  });

  it('fails open when the offer query errors', async () => {
    vi.mocked(getReverseTrialOffer).mockRejectedValue(new Error('boom'));
    const { result } = run('/dashboard');
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(startReverseTrial).not.toHaveBeenCalled();
  });
});

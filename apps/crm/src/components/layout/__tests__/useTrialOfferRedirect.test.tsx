import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../../context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/services/billing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/billing')>();
  return {
    ...actual,
    getWorkspaceSubscription: vi.fn(),
    getEffectivePlanWithSource: vi.fn(),
  };
});

import { useAuth } from '../../../context/AuthContext';
import { getEffectivePlanWithSource, getWorkspaceSubscription } from '@/services/billing';
import { useTrialOfferRedirect } from '../useTrialOfferRedirect';

const plan = (over: Record<string, unknown> = {}) => ({
  planId: 'free',
  planSource: 'system',
  wasDemo: false,
  trialOfferSeenAt: null,
  ...over,
});
const NEVER_SUBSCRIBED = { hasEverSubscribed: false } as never;

function setAuth(role: 'owner' | 'admin' | 'agent', workspaceRole: typeof role | null = null) {
  vi.mocked(useAuth).mockReturnValue({ role, workspaceRole } as never);
}

function run(pathname: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useTrialOfferRedirect(pathname), { wrapper });
}

beforeEach(() => {
  vi.clearAllMocks();
  setAuth('owner');
  vi.mocked(getEffectivePlanWithSource).mockResolvedValue(plan());
  vi.mocked(getWorkspaceSubscription).mockResolvedValue(NEVER_SUBSCRIBED);
});

describe('useTrialOfferRedirect', () => {
  it('reports pending, never redirect, while the queries load', async () => {
    const { result } = run('/dashboard');
    expect(result.current).toEqual({ pending: true, redirect: false });
    await waitFor(() => expect(result.current.pending).toBe(false));
  });

  it('redirects an eligible owner who has not seen the offer', async () => {
    const { result } = run('/dashboard');
    await waitFor(() => expect(result.current).toEqual({ pending: false, redirect: true }));
  });

  it('does not redirect once the offer was seen', async () => {
    vi.mocked(getEffectivePlanWithSource).mockResolvedValue(
      plan({ trialOfferSeenAt: '2026-10-27T12:00:00Z' }),
    );
    const { result } = run('/dashboard');
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.redirect).toBe(false);
  });

  it('decides from the active workspace alone, with no workspace argument', async () => {
    // The user owns another unseen workspace, but the active one carries the marker.
    vi.mocked(getEffectivePlanWithSource).mockResolvedValue(
      plan({ trialOfferSeenAt: '2026-10-27T12:00:00Z' }),
    );
    const { result } = run('/dashboard');
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.redirect).toBe(false);
    expect(getEffectivePlanWithSource).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getEffectivePlanWithSource).mock.calls[0]).toEqual([]);
  });

  it('never redirects an agent and fires no query', () => {
    setAuth('agent');
    const { result } = run('/dashboard');
    expect(result.current).toEqual({ pending: false, redirect: false });
    expect(getEffectivePlanWithSource).not.toHaveBeenCalled();
    expect(getWorkspaceSubscription).not.toHaveBeenCalled();
  });

  it('follows the active workspace role over the profile role', async () => {
    setAuth('owner', 'agent');
    const { result } = run('/dashboard');
    expect(result.current).toEqual({ pending: false, redirect: false });
    expect(getEffectivePlanWithSource).not.toHaveBeenCalled();
  });

  it.each([
    '/comecar',
    '/configuracao/cobranca',
    '/workspace-setup',
    '/oauth/callback',
    '/conectar',
  ])('does not redirect on the exempt path %s', (path) => {
    const { result } = run(path);
    expect(result.current).toEqual({ pending: false, redirect: false });
    expect(getEffectivePlanWithSource).not.toHaveBeenCalled();
  });

  it('does not redirect a comped (manual) plan', async () => {
    vi.mocked(getEffectivePlanWithSource).mockResolvedValue(plan({ planSource: 'manual' }));
    const { result } = run('/dashboard');
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.redirect).toBe(false);
  });

  it('does not redirect a workspace that already trialed', async () => {
    vi.mocked(getWorkspaceSubscription).mockResolvedValue({ hasEverSubscribed: true } as never);
    const { result } = run('/dashboard');
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.redirect).toBe(false);
  });

  it('fails open when the plan query rejects', async () => {
    vi.mocked(getEffectivePlanWithSource).mockRejectedValue(new Error('boom'));
    const { result } = run('/dashboard');
    await waitFor(() => expect(result.current).toEqual({ pending: false, redirect: false }));
    expect(result.current.redirect).toBe(false);
  });

  it('fails open when the subscription query rejects', async () => {
    vi.mocked(getWorkspaceSubscription).mockRejectedValue(new Error('boom'));
    const { result } = run('/dashboard');
    await waitFor(() => expect(result.current).toEqual({ pending: false, redirect: false }));
  });
});

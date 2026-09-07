import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PortalFill } from '@/store';

// usePortalFill backs the "O que o cliente vê" panel on AcessoPage. AcessoPage.test.tsx
// mocks this hook as a whole to drive the panel's rendering predicates; this suite covers
// what that mock hides: the hook's own gating. hub-token and workspace-slug next to it on
// AcessoPage both use `enabled: !isRestricted` so a restricted agent never fetches them
// (a security finding on the previous task) — this hook has to do the same, and
// HubRoleGate.tsx stays the one place that defines "restricted".

vi.mock('@/context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/store/hub');

import { useAuth } from '@/context/AuthContext';
import * as hubStore from '@/store/hub';
import { usePortalFill } from '../usePortalFill';

const mockedUseAuth = vi.mocked(useAuth);

const FILL: PortalFill = {
  briefingTotal: 12,
  briefingAnswered: 8,
  brandFiles: 3,
  hasBrand: true,
  pages: 2,
  newIdeasWithoutReply: 1,
};

function setAuth(workspaceRole: 'owner' | 'admin' | 'agent' | null) {
  mockedUseAuth.mockReturnValue({ workspaceRole } as never);
}

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(hubStore.getPortalFill).mockResolvedValue(FILL);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('usePortalFill', () => {
  it('fetches getPortalFill for an owner', async () => {
    setAuth('owner');
    const { result } = renderHook(() => usePortalFill(15), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(FILL));
    expect(hubStore.getPortalFill).toHaveBeenCalledWith(15);
  });

  it('fetches getPortalFill for an admin', async () => {
    setAuth('admin');
    const { result } = renderHook(() => usePortalFill(15), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(FILL));
    expect(hubStore.getPortalFill).toHaveBeenCalledWith(15);
  });

  // The regression this guards against: without `enabled: !isRestricted`, this query
  // would fire for an agent even though HubRoleGate hides the panel that shows its
  // result — the fetch itself is the leak, not just the rendered value.
  it('does not fetch getPortalFill for an agent', async () => {
    setAuth('agent');
    const { result } = renderHook(() => usePortalFill(15), { wrapper });
    await waitFor(() => expect(result.current.isPending).toBe(true));
    expect(hubStore.getPortalFill).not.toHaveBeenCalled();
  });
});

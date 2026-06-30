import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useWorkspaceLimits } from '../useWorkspaceLimits';
import { supabase } from '../../lib/supabase';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'tok' } },
      }),
    },
  },
}));

vi.mock('../../context/AuthContext', () => ({
  AuthContext: { Provider: ({ children }: { children: ReactNode }) => children },
}));

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(supabase.auth.getSession).mockResolvedValue({
    data: { session: { access_token: 'tok' } },
  } as never);
});

describe('useWorkspaceLimits seats', () => {
  it('returns undefined seats when the response omits the block', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ plan_name: 'free', limits: null, features: null }),
      }),
    );
    const { result } = renderHook(() => useWorkspaceLimits(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.seats).toBeUndefined();
  });

  it('exposes the server-computed seats block', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          plan_name: 'agency',
          limits: { max_team_members: 5 },
          features: null,
          seats: { included: 5, purchased: 2, effective: 7, used: 4 },
        }),
      }),
    );
    const { result } = renderHook(() => useWorkspaceLimits(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.seats).toEqual({
      included: 5,
      purchased: 2,
      effective: 7,
      used: 4,
    });
  });
});

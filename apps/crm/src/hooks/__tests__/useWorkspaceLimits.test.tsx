import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('../../lib/supabase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/supabase')>()),
  supabase: { auth: { getSession } },
}));

import { AuthContext } from '../../context/AuthContext';
import { useWorkspaceLimits } from '../useWorkspaceLimits';

type AuthValue = NonNullable<React.ContextType<typeof AuthContext>>;

function wrapperFor(auth: Partial<AuthValue> | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    const tree = <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    return auth ? (
      <AuthContext.Provider value={auth as AuthValue}>{tree}</AuthContext.Provider>
    ) : (
      tree
    );
  };
}

describe('useWorkspaceLimits', () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    getSession.mockReset();
    fetchSpy.mockReset();
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => vi.unstubAllGlobals());

  // Sign-out in the iOS app renders with `user: null` before AuthContext clears the query
  // cache (the Keychain delete is async). A limits fetch started in that window was then
  // dropped from the cache mid-flight and ProtectedRoute's observer read "loading" forever,
  // leaving the app on a skeleton instead of /login. Signed out, the query must not run.
  it('does not fetch and is not loading while signed out', () => {
    const { result } = renderHook(() => useWorkspaceLimits(), {
      wrapper: wrapperFor({ user: null, profile: null }),
    });
    expect(result.current.isLoading).toBe(false);
    expect(getSession).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches the limits when signed in', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 't' } } });
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ plan_name: 'Pro', limits: null, features: null }), {
        status: 200,
      }),
    );
    const { result } = renderHook(() => useWorkspaceLimits(), {
      wrapper: wrapperFor({
        user: { id: 'u1' } as AuthValue['user'],
        profile: { conta_id: 'w1' } as AuthValue['profile'],
      }),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.planName).toBe('Pro');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  // Isolated component tests render the hook without an AuthProvider; keep it fetching there.
  it('still fetches outside an AuthProvider', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 't' } } });
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ plan_name: null, limits: null, features: null }), {
        status: 200,
      }),
    );
    const { result } = renderHook(() => useWorkspaceLimits(), { wrapper: wrapperFor(null) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

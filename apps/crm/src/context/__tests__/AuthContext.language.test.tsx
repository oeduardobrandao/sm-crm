import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockMaybeSingle, mockMembershipGetUser, mockGetContaId, mockApplyFallback } = vi.hoisted(
  () => ({
    mockMaybeSingle: vi.fn(),
    mockMembershipGetUser: vi.fn(),
    mockGetContaId: vi.fn(),
    mockApplyFallback: vi.fn(),
  }),
);

vi.mock('../../lib/supabase');

vi.mock('../../store/core', () => ({
  supabase: {
    auth: { getUser: mockMembershipGetUser },
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ maybeSingle: mockMaybeSingle }) }),
      }),
    }),
  },
  getContaId: mockGetContaId,
}));

vi.mock('../../lib/analytics', () => ({
  identifyWorkspaceUser: vi.fn(),
  resetAnalytics: vi.fn(),
}));

vi.mock('../../lib/signupMarket', () => ({ applyAccountLanguageFallback: mockApplyFallback }));

import * as supabaseModule from '../../lib/supabase';
import { AuthProvider, useAuth } from '../AuthContext';

type MockedSupabaseModule = typeof supabaseModule & {
  __resetSupabaseMock: () => void;
  __setCurrentProfile: (profile: Record<string, unknown> | null) => void;
  __setCurrentUser: (user: Record<string, unknown> | null) => void;
  __emitAuthChange: (
    event: string,
    session: { user: Record<string, unknown> | null } | null,
  ) => void;
};
const mocked = supabaseModule as MockedSupabaseModule;

// Records, at every render where the profile is present, whether the fallback already ran.
const profileRenders: boolean[] = [];

function Probe() {
  const auth = useAuth();
  if (auth.profile) profileRenders.push(mockApplyFallback.mock.calls.length > 0);
  return <span data-testid="loading">{String(auth.loading)}</span>;
}

function renderWithAuth() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

const usUser = { id: 'user-us', user_metadata: { market: 'us' } };

describe('AuthProvider language fallback', () => {
  beforeEach(() => {
    mockApplyFallback.mockReset();
    profileRenders.length = 0;
    mocked.__resetSupabaseMock();
    mocked.__setCurrentUser(usUser);
    mocked.__setCurrentProfile({ id: 'user-us', nome: 'Ann', role: 'owner', conta_id: 'c1' });
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockMembershipGetUser.mockResolvedValue({ data: { user: usUser } });
    mockGetContaId.mockResolvedValue('c1');
  });

  it('applies the account language once when the session user is first known, before the profile renders', async () => {
    renderWithAuth();
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));

    // The listener's INITIAL_SESSION for the same user must not apply it a second time.
    act(() => mocked.__emitAuthChange('INITIAL_SESSION', { user: usUser }));

    expect(mockApplyFallback).toHaveBeenCalledTimes(1);
    expect(mockApplyFallback).toHaveBeenCalledWith(usUser);
    expect(profileRenders.length).toBeGreaterThan(0);
    expect(profileRenders.every(Boolean)).toBe(true);
  });

  it('applies it for a user who signs in later', async () => {
    mocked.__setCurrentUser(null);
    renderWithAuth();
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(mockApplyFallback).not.toHaveBeenCalled();

    act(() => mocked.__emitAuthChange('SIGNED_IN', { user: usUser }));
    expect(mockApplyFallback).toHaveBeenCalledTimes(1);
    expect(mockApplyFallback).toHaveBeenCalledWith(usUser);
  });
});

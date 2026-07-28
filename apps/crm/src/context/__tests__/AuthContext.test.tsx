import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

// vi.hoisted: the vi.mock('../../store/core', ...) factory below runs before
// this file's own top-level statements, so a plain `const mock... = vi.fn()`
// would still be in the TDZ when the factory executes. Same reasoning as
// store/__tests__/membership.test.ts.
const { mockMaybeSingle, mockMembershipGetUser, mockGetContaId } = vi.hoisted(() => ({
  mockMaybeSingle: vi.fn(),
  mockMembershipGetUser: vi.fn(),
  mockGetContaId: vi.fn(),
}));

vi.mock('../../lib/supabase');
// getMyMembership() (store/workspace.ts) reads `supabase` and `getContaId`
// from THIS module, not from '../../lib/supabase'. The previous factory only
// exported `initStoreRole`, so `supabase` was undefined inside
// getMyMembership() and every call threw before reaching the mocked
// maybeSingle() — canSeeFinancials always resolved via the catch path to
// 'unknown', and the membership happy path (the one AuthContext.tsx:150
// actually exercises) was never covered by this suite.
vi.mock('../../store/core', () => ({
  initStoreRole: vi.fn(async () => undefined),
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

import * as supabaseModule from '../../lib/supabase';
import { AuthProvider, useAuth } from '../AuthContext';

type MockedSupabaseModule = typeof supabaseModule & {
  __resetSupabaseMock: () => void;
  __setCurrentProfile: (profile: Record<string, unknown> | null) => void;
  __queueCurrentProfileResponse: (response: Promise<Record<string, unknown> | null>) => void;
  __setCurrentUser: (user: { id: string } | null) => void;
  __emitAuthChange: (event: string, session: { user: { id: string } | null } | null) => void;
};

const mockedSupabase = supabaseModule as MockedSupabaseModule;

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

function Probe() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="role">{auth.role}</span>
      <span data-testid="user">{auth.user?.id ?? 'anon'}</span>
      <span data-testid="loading">{String(auth.loading)}</span>
      <span data-testid="workspaceRole">{auth.workspaceRole ?? 'null'}</span>
      <span data-testid="canSeeFinancials">{String(auth.canSeeFinancials)}</span>
      <button
        onClick={() => {
          void auth.signOut();
        }}
      >
        sair
      </button>
    </div>
  );
}

describe('AuthProvider', () => {
  it('hydrates the authenticated user role from the cached profile', async () => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentUser({ id: 'user-99' });
    mockedSupabase.__setCurrentProfile({
      id: 'user-99',
      nome: 'Joana Lima',
      role: 'admin',
      conta_id: 'conta-admin',
    });

    renderWithAuth();

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    expect(screen.getByTestId('user')).toHaveTextContent('user-99');
    expect(screen.getByTestId('role')).toHaveTextContent('admin');
  });

  it('resolves canSeeFinancials to true for an owner whose can_see_financials column is false', async () => {
    // Guards AuthContext.tsx:150 — deriveFinancialAccess(membership), not the
    // raw `membership.can_see_financials` column. can_see_financials is only
    // meaningful for admins; owners must see financials regardless of it.
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentUser({ id: 'user-1' });
    mockedSupabase.__setCurrentProfile({
      id: 'user-1',
      nome: 'Eduardo',
      role: 'owner',
      conta_id: 'conta-1',
    });
    mockMembershipGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockGetContaId.mockResolvedValue('conta-1');
    mockMaybeSingle.mockResolvedValue({
      data: { role: 'owner', can_see_financials: false },
      error: null,
    });

    renderWithAuth();

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    expect(screen.getByTestId('workspaceRole')).toHaveTextContent('owner');
    expect(screen.getByTestId('canSeeFinancials')).toHaveTextContent('true');
  });

  it('resolves canSeeFinancials to false for an agent whose can_see_financials column is true', async () => {
    // Mirror case: agents never see financials, whatever the column says.
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentUser({ id: 'user-2' });
    mockedSupabase.__setCurrentProfile({
      id: 'user-2',
      nome: 'Agente',
      role: 'agent',
      conta_id: 'conta-1',
    });
    mockMembershipGetUser.mockResolvedValue({ data: { user: { id: 'user-2' } } });
    mockGetContaId.mockResolvedValue('conta-1');
    mockMaybeSingle.mockResolvedValue({
      data: { role: 'agent', can_see_financials: true },
      error: null,
    });

    renderWithAuth();

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    expect(screen.getByTestId('workspaceRole')).toHaveTextContent('agent');
    expect(screen.getByTestId('canSeeFinancials')).toHaveTextContent('false');
  });

  it('clears profile when onAuthStateChange emits a signed-out session', async () => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentUser({ id: 'user-1' });
    mockedSupabase.__setCurrentProfile({
      id: 'user-1',
      nome: 'Eduardo',
      role: 'owner',
      conta_id: 'conta-1',
    });

    renderWithAuth();

    await waitFor(() => {
      expect(screen.getByTestId('role')).toHaveTextContent('owner');
    });

    await act(async () => {
      mockedSupabase.__emitAuthChange('SIGNED_OUT', null);
    });

    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('anon');
      expect(screen.getByTestId('role')).toHaveTextContent('agent');
    });
  });

  it('ignores a stale profile request that resolves after sign-out', async () => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentUser({ id: 'user-1' });

    let resolveProfile!: (profile: Record<string, unknown> | null) => void;
    mockedSupabase.__queueCurrentProfileResponse(
      new Promise((resolve) => {
        resolveProfile = resolve;
      }),
    );

    renderWithAuth();

    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('user-1');
    });

    await act(async () => {
      mockedSupabase.__emitAuthChange('SIGNED_OUT', null);
    });

    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('anon');
      expect(screen.getByTestId('role')).toHaveTextContent('agent');
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    await act(async () => {
      resolveProfile({
        id: 'user-1',
        nome: 'Eduardo',
        role: 'owner',
        conta_id: 'conta-1',
      });
    });

    expect(screen.getByTestId('user')).toHaveTextContent('anon');
    expect(screen.getByTestId('role')).toHaveTextContent('agent');
  });

  it('keeps the active profile request across token refreshes for the same user', async () => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentUser({ id: 'user-1' });

    let resolveProfile!: (profile: Record<string, unknown> | null) => void;
    mockedSupabase.__queueCurrentProfileResponse(
      new Promise((resolve) => {
        resolveProfile = resolve;
      }),
    );

    renderWithAuth();

    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('user-1');
    });

    await act(async () => {
      mockedSupabase.__emitAuthChange('TOKEN_REFRESHED', { user: { id: 'user-1' } });
      resolveProfile({
        id: 'user-1',
        nome: 'Eduardo',
        role: 'owner',
        conta_id: 'conta-1',
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('role')).toHaveTextContent('owner');
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });
  });

  it('signOut clears the profile from context', async () => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentUser({ id: 'user-1' });
    mockedSupabase.__setCurrentProfile({
      id: 'user-1',
      nome: 'Eduardo',
      role: 'owner',
      conta_id: 'conta-1',
    });

    renderWithAuth();

    await waitFor(() => {
      expect(screen.getByTestId('role')).toHaveTextContent('owner');
    });

    await act(async () => {
      screen.getByText('sair').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('role')).toHaveTextContent('agent');
    });
  });

  it('signOut clears the React Query cache so the next account gets no stale entitlements', async () => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentUser({ id: 'user-1' });
    mockedSupabase.__setCurrentProfile({
      id: 'user-1',
      nome: 'Eduardo',
      role: 'owner',
      conta_id: 'conta-1',
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Seed a previous user's cached entitlements (free plan, everything locked).
    queryClient.setQueryData(['workspace-limits', 'conta-1'], {
      plan_name: 'Free',
      features: { feature_leads: false },
    });
    expect(queryClient.getQueryData(['workspace-limits', 'conta-1'])).toBeDefined();

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('role')).toHaveTextContent('owner');
    });

    await act(async () => {
      screen.getByText('sair').click();
    });

    await waitFor(() => {
      expect(queryClient.getQueryData(['workspace-limits', 'conta-1'])).toBeUndefined();
    });
  });

  it('useAuth throws when used outside AuthProvider', () => {
    // Silence the expected React error boundary log.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(() => renderHook(() => useAuth())).toThrow('useAuth must be used within AuthProvider');
    } finally {
      spy.mockRestore();
    }
  });
});

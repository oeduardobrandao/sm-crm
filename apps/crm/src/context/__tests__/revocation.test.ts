import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';

// vi.hoisted: see AuthContext.test.tsx — getMyMembership() (store/workspace.ts)
// reads `supabase`/`getContaId` from THIS module, not from '../../lib/supabase'.
const { mockMaybeSingle, mockMembershipGetUser, mockGetContaId } = vi.hoisted(() => ({
  mockMaybeSingle: vi.fn(),
  mockMembershipGetUser: vi.fn(),
  mockGetContaId: vi.fn(),
}));

vi.mock('../../lib/supabase');
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
import { AuthProvider, useAuth, FINANCIAL_QUERY_KEYS } from '../AuthContext';

type MockedSupabaseModule = typeof supabaseModule & {
  __resetSupabaseMock: () => void;
  __setCurrentProfile: (profile: Record<string, unknown> | null) => void;
  __setCurrentUser: (user: { id: string } | null) => void;
  __emitWorkspaceMemberUpdate: (newRow: Record<string, unknown>) => void;
  __getWorkspaceMemberSubscription: () => {
    event: string;
    schema: string;
    table: string;
    filter: string;
  } | null;
};

const mockedSupabase = supabaseModule as MockedSupabaseModule;

describe('FINANCIAL_QUERY_KEYS', () => {
  it('covers every cache holding financial values', () => {
    expect(FINANCIAL_QUERY_KEYS).toEqual(
      expect.arrayContaining(['clientes', 'membros', 'transacoes', 'contratos', 'dashboardStats']),
    );
  });

  // portfolioSummary is Instagram accounts, top/worst posts and growth counters
  // (analytics.ts:236) — no monetary field. Purging it would refetch a large
  // payload for no reason.
  it('excludes portfolioSummary, which holds no financial data', () => {
    expect(FINANCIAL_QUERY_KEYS).not.toContain('portfolioSummary');
  });
});

function Probe() {
  const auth = useAuth();
  return createElement(
    'div',
    null,
    createElement('span', { 'data-testid': 'canSeeFinancials' }, String(auth.canSeeFinancials)),
    createElement('span', { 'data-testid': 'workspaceRole' }, String(auth.workspaceRole)),
  );
}

function renderWithAuth(queryClient: QueryClient) {
  return render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(AuthProvider, null, createElement(Probe)),
    ),
  );
}

describe('live revocation handler', () => {
  it('sets canSeeFinancials false and purges financial caches on a true -> false UPDATE', async () => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentUser({ id: 'user-7' });
    mockedSupabase.__setCurrentProfile({
      id: 'user-7',
      nome: 'Admin Revogado',
      role: 'admin',
      conta_id: 'conta-7',
    });
    mockMembershipGetUser.mockResolvedValue({ data: { user: { id: 'user-7' } } });
    mockGetContaId.mockResolvedValue('conta-7');
    // Hydration: admin currently allowed to see financials.
    mockMaybeSingle.mockResolvedValue({
      data: { role: 'admin', can_see_financials: true },
      error: null,
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    for (const key of FINANCIAL_QUERY_KEYS) {
      queryClient.setQueryData([key], ['cached-value']);
    }
    // Non-financial cache: must survive the purge.
    queryClient.setQueryData(['portfolioSummary'], ['cached-analytics']);

    renderWithAuth(queryClient);

    await waitFor(() => {
      expect(screen.getByTestId('canSeeFinancials')).toHaveTextContent('true');
    });

    // Simulate the owner revoking this admin's can_see_financials flag: a
    // postgres_changes UPDATE payload on workspace_members carries the full
    // new row (unlike DELETE, which is why revocation-by-deletion relies on
    // the poll instead — see AuthContext.tsx).
    await act(async () => {
      mockedSupabase.__emitWorkspaceMemberUpdate({
        workspace_id: 'conta-7',
        role: 'admin',
        can_see_financials: false,
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('canSeeFinancials')).toHaveTextContent('false');
    });

    for (const key of FINANCIAL_QUERY_KEYS) {
      expect(queryClient.getQueryData([key])).toBeUndefined();
    }
    expect(queryClient.getQueryData(['portfolioSummary'])).toEqual(['cached-analytics']);
  });

  it('does not purge caches when the update leaves access unchanged (owner stays owner)', async () => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentUser({ id: 'user-8' });
    mockedSupabase.__setCurrentProfile({
      id: 'user-8',
      nome: 'Dona da Conta',
      role: 'owner',
      conta_id: 'conta-8',
    });
    mockMembershipGetUser.mockResolvedValue({ data: { user: { id: 'user-8' } } });
    mockGetContaId.mockResolvedValue('conta-8');
    mockMaybeSingle.mockResolvedValue({
      data: { role: 'owner', can_see_financials: false },
      error: null,
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(['clientes'], ['cached-value']);

    renderWithAuth(queryClient);

    await waitFor(() => {
      // Owners always see financials regardless of the can_see_financials column.
      expect(screen.getByTestId('canSeeFinancials')).toHaveTextContent('true');
    });

    await act(async () => {
      mockedSupabase.__emitWorkspaceMemberUpdate({
        workspace_id: 'conta-8',
        role: 'owner',
        can_see_financials: false,
      });
    });

    // Still true (owner), so the cache must not have been touched.
    expect(screen.getByTestId('canSeeFinancials')).toHaveTextContent('true');
    expect(queryClient.getQueryData(['clientes'])).toEqual(['cached-value']);
  });

  it('a payload for a different workspace_id does not change canSeeFinancials or workspaceRole', async () => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentUser({ id: 'user-11' });
    mockedSupabase.__setCurrentProfile({
      id: 'user-11',
      nome: 'Admin Multi-Workspace',
      role: 'admin',
      conta_id: 'conta-11',
    });
    mockMembershipGetUser.mockResolvedValue({ data: { user: { id: 'user-11' } } });
    mockGetContaId.mockResolvedValue('conta-11');
    mockMaybeSingle.mockResolvedValue({
      data: { role: 'admin', can_see_financials: true },
      error: null,
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    for (const key of FINANCIAL_QUERY_KEYS) {
      queryClient.setQueryData([key], ['cached-value']);
    }

    renderWithAuth(queryClient);

    await waitFor(() => {
      expect(screen.getByTestId('canSeeFinancials')).toHaveTextContent('true');
    });
    expect(screen.getByTestId('workspaceRole')).toHaveTextContent('admin');

    // wm_select_same_workspace (migration 20260612120000) lets this user read
    // their membership row in every workspace they belong to, not only the
    // active one ('conta-11'). A `user_id=eq.<uid>` filter alone matches an
    // UPDATE on a DIFFERENT workspace's row too, so Realtime can deliver it
    // here. It must not overwrite workspaceRole/canSeeFinancials for the
    // active workspace.
    await act(async () => {
      mockedSupabase.__emitWorkspaceMemberUpdate({
        workspace_id: 'conta-OTHER',
        role: 'agent',
        can_see_financials: false,
      });
    });

    expect(screen.getByTestId('canSeeFinancials')).toHaveTextContent('true');
    expect(screen.getByTestId('workspaceRole')).toHaveTextContent('admin');
    for (const key of FINANCIAL_QUERY_KEYS) {
      expect(queryClient.getQueryData([key])).toEqual(['cached-value']);
    }
  });

  it(
    "a poll resolving to null (membership deleted) sets canSeeFinancials to 'unknown' " +
      'and purges financial caches (the true -> unknown transition)',
    async () => {
      mockedSupabase.__resetSupabaseMock();
      mockedSupabase.__setCurrentUser({ id: 'user-12' });
      mockedSupabase.__setCurrentProfile({
        id: 'user-12',
        nome: 'Admin Removido',
        role: 'admin',
        conta_id: 'conta-12',
      });
      mockMembershipGetUser.mockResolvedValue({ data: { user: { id: 'user-12' } } });
      mockGetContaId.mockResolvedValue('conta-12');
      // Hydration: admin currently allowed to see financials.
      mockMaybeSingle.mockResolvedValueOnce({
        data: { role: 'admin', can_see_financials: true },
        error: null,
      });

      // Capture the poll's setInterval callback instead of waiting 60 real
      // seconds for it to fire.
      const pollCallbacks: Array<() => void> = [];
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval').mockImplementation(((
        fn: () => void,
      ) => {
        pollCallbacks.push(fn);
        return 0 as unknown as ReturnType<typeof setInterval>;
      }) as typeof setInterval);

      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      for (const key of FINANCIAL_QUERY_KEYS) {
        queryClient.setQueryData([key], ['cached-value']);
      }

      try {
        renderWithAuth(queryClient);

        await waitFor(() => {
          expect(screen.getByTestId('canSeeFinancials')).toHaveTextContent('true');
        });
        expect(pollCallbacks.length).toBeGreaterThan(0);

        // The membership row is gone: getMyMembership() resolves to null,
        // exactly as it does after a deletion (see store/workspace.ts).
        mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

        await act(async () => {
          pollCallbacks[pollCallbacks.length - 1]();
        });

        // Critical 2: null must flow through instead of being ignored.
        await waitFor(() => {
          expect(screen.getByTestId('canSeeFinancials')).toHaveTextContent('unknown');
        });
        expect(screen.getByTestId('workspaceRole')).toHaveTextContent('null');

        // Critical 3: `true -> 'unknown'` must still purge (`!'unknown'` is
        // `false`, which is why the old `wasAllowed && !nowAllowed` check
        // missed exactly this transition).
        for (const key of FINANCIAL_QUERY_KEYS) {
          expect(queryClient.getQueryData([key])).toBeUndefined();
        }
      } finally {
        setIntervalSpy.mockRestore();
      }
    },
  );

  it('registers the workspace_members subscription with the expected table/event/filter', async () => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentUser({ id: 'user-13' });
    mockedSupabase.__setCurrentProfile({
      id: 'user-13',
      nome: 'Usuário Padrão',
      role: 'owner',
      conta_id: 'conta-13',
    });
    mockMembershipGetUser.mockResolvedValue({ data: { user: { id: 'user-13' } } });
    mockGetContaId.mockResolvedValue('conta-13');
    mockMaybeSingle.mockResolvedValue({
      data: { role: 'owner', can_see_financials: false },
      error: null,
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithAuth(queryClient);

    await waitFor(() => {
      expect(screen.getByTestId('canSeeFinancials')).toHaveTextContent('true');
    });

    // Only non-null once .subscribe() has actually been called on the
    // channel — deleting that call must fail this assertion, not slip past a
    // mock that routes callbacks regardless (Important 4).
    const subscription = mockedSupabase.__getWorkspaceMemberSubscription();
    expect(subscription).not.toBeNull();
    expect(subscription).toMatchObject({
      event: 'UPDATE',
      schema: 'public',
      table: 'workspace_members',
    });
    expect(subscription?.filter).toBe('user_id=eq.user-13');
  });
});

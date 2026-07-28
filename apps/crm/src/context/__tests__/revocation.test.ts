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
    'span',
    { 'data-testid': 'canSeeFinancials' },
    String(auth.canSeeFinancials),
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
      mockedSupabase.__emitWorkspaceMemberUpdate({ role: 'admin', can_see_financials: false });
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
      mockedSupabase.__emitWorkspaceMemberUpdate({ role: 'owner', can_see_financials: false });
    });

    // Still true (owner), so the cache must not have been touched.
    expect(screen.getByTestId('canSeeFinancials')).toHaveTextContent('true');
    expect(queryClient.getQueryData(['clientes'])).toEqual(['cached-value']);
  });
});

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
      expect.arrayContaining([
        'cliente',
        'clientes',
        'membros',
        'transacoes',
        'contratos',
        'dashboardStats',
      ]),
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
    // canSeeFinancials settling proves hydration resolved, but the live-
    // revocation effect is a SEPARATE effect keyed on [userId, profile?.conta_id]
    // — it only needs `profile`, which the hydration flow's async IIFE sets
    // BEFORE it goes on to await getMyMembership() and set canSeeFinancials.
    // That makes this subscription wait usually redundant in practice, but
    // "usually" is exactly what makes the emit below racy under load: without
    // this wait there is no guarantee the channel's UPDATE callback is
    // registered yet, and __emitWorkspaceMemberUpdate silently drops the
    // payload if it isn't (see the working pattern at the 'unknown' -> false
    // test below).
    await waitFor(() => {
      expect(mockedSupabase.__getWorkspaceMemberSubscription()).not.toBeNull();
    });

    const removeSpy = vi.spyOn(queryClient, 'removeQueries');
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const refetchSpy = vi.spyOn(queryClient, 'refetchQueries');

    // Simulate the owner revoking this admin's can_see_financials flag: a
    // postgres_changes UPDATE payload on workspace_members carries the full
    // new row (unlike DELETE, which is why revocation-by-deletion relies on
    // the poll instead — see AuthContext.tsx).
    await act(async () => {
      mockedSupabase.__emitWorkspaceMemberUpdate({
        workspace_id: 'conta-7',
        role: 'admin',
        can_see_financials: false,
        role_id: null,
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('canSeeFinancials')).toHaveTextContent('false');
    });

    for (const key of FINANCIAL_QUERY_KEYS) {
      expect(queryClient.getQueryData([key])).toBeUndefined();
      // Revocation must use removeQueries (outright purge), never merely
      // invalidateQueries — a merge/refactor that swapped this for
      // invalidation would still leave a stale authorised value reachable
      // from cache for an instant.
      expect(removeSpy).toHaveBeenCalledWith({ queryKey: [key] });
    }
    expect(invalidateSpy).not.toHaveBeenCalled();
    // No extra refetchQueries() call either: removeQueries() already deletes
    // these keys from the cache, so a follow-up refetchQueries() call (scoped
    // or not) would find nothing left to match for them — it would only end
    // up refetching unrelated active queries on the page. See the "false ->
    // true (grant)" test below for the equivalent assertion on that path.
    expect(refetchSpy).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(['portfolioSummary'])).toEqual(['cached-analytics']);

    removeSpy.mockRestore();
    invalidateSpy.mockRestore();
    refetchSpy.mockRestore();
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
    // Subscription readiness, not just hydration — see the comment on the
    // equivalent wait in the first test above.
    await waitFor(() => {
      expect(mockedSupabase.__getWorkspaceMemberSubscription()).not.toBeNull();
    });

    await act(async () => {
      mockedSupabase.__emitWorkspaceMemberUpdate({
        workspace_id: 'conta-8',
        role: 'owner',
        can_see_financials: false,
        role_id: null,
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
    // Subscription readiness, not just hydration — see the comment on the
    // equivalent wait in the first test above.
    await waitFor(() => {
      expect(mockedSupabase.__getWorkspaceMemberSubscription()).not.toBeNull();
    });

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
        role_id: null,
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

        const removeSpy = vi.spyOn(queryClient, 'removeQueries');
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

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
          expect(removeSpy).toHaveBeenCalledWith({ queryKey: [key] });
        }
        expect(invalidateSpy).not.toHaveBeenCalled();

        removeSpy.mockRestore();
        invalidateSpy.mockRestore();
      } finally {
        setIntervalSpy.mockRestore();
      }
    },
  );

  it(
    'purges financial caches on the very first resolution into a non-authorised ' +
      "state ('unknown' -> false) — the transition a `wasAllowed`-style boolean " +
      "(captured only as `ref === true`) cannot see, because 'unknown' was never " +
      '`true` either',
    async () => {
      mockedSupabase.__resetSupabaseMock();
      mockedSupabase.__setCurrentUser({ id: 'user-20' });
      mockedSupabase.__setCurrentProfile({
        id: 'user-20',
        nome: 'Admin Restrito',
        role: 'admin',
        conta_id: 'conta-20',
      });
      mockMembershipGetUser.mockResolvedValue({ data: { user: { id: 'user-20' } } });
      mockGetContaId.mockResolvedValue('conta-20');

      // Hold the hydration effect's OWN getMyMembership() call pending, so
      // canSeeFinancials (and its ref) stay at their untouched initial
      // 'unknown' — exactly the state on every fresh page load — while the
      // separate live-revocation effect below still mounts (it only needs
      // `profile`, which the hydration flow sets before it ever calls
      // getMyMembership) and can react on its own.
      let resolveMembership!: (v: { data: unknown; error: null }) => void;
      mockMaybeSingle.mockReturnValue(
        new Promise((resolve) => {
          resolveMembership = resolve;
        }),
      );

      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      for (const key of FINANCIAL_QUERY_KEYS) {
        queryClient.setQueryData([key], ['cached-value']);
      }

      renderWithAuth(queryClient);

      // Confirm the race is actually set up: hydration is stuck mid-flight
      // (still 'unknown') by the time the subscription exists.
      await waitFor(() => {
        expect(mockedSupabase.__getWorkspaceMemberSubscription()).not.toBeNull();
      });
      expect(screen.getByTestId('canSeeFinancials')).toHaveTextContent('unknown');

      const removeSpy = vi.spyOn(queryClient, 'removeQueries');
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      // A postgres_changes UPDATE resolves the same admin to
      // can_see_financials: false through applyMembership, while the ref is
      // still sitting at its never-started 'unknown'.
      await act(async () => {
        mockedSupabase.__emitWorkspaceMemberUpdate({
          workspace_id: 'conta-20',
          role: 'admin',
          can_see_financials: false,
          role_id: null,
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId('canSeeFinancials')).toHaveTextContent('false');
      });

      for (const key of FINANCIAL_QUERY_KEYS) {
        expect(queryClient.getQueryData([key])).toBeUndefined();
        expect(removeSpy).toHaveBeenCalledWith({ queryKey: [key] });
      }
      expect(invalidateSpy).not.toHaveBeenCalled();

      removeSpy.mockRestore();
      invalidateSpy.mockRestore();

      // Let the stalled hydration path resolve too, so nothing leaks into
      // later tests.
      await act(async () => {
        resolveMembership({ data: { role: 'admin', can_see_financials: false }, error: null });
      });
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
    //
    // Polled, not read once: canSeeFinancials above is set by the membership
    // lookup, while the channel is created by a separate effect gated on
    // `profile?.conta_id`. The two resolve independently, so a settled
    // canSeeFinancials does NOT imply the channel has subscribed — reading
    // synchronously here loses that race under load (it went red in CI while
    // passing locally). Same pattern already used by the revocation test above.
    await waitFor(() => {
      expect(mockedSupabase.__getWorkspaceMemberSubscription()).not.toBeNull();
    });

    const subscription = mockedSupabase.__getWorkspaceMemberSubscription();
    expect(subscription).not.toBeNull();
    expect(subscription).toMatchObject({
      event: 'UPDATE',
      schema: 'public',
      table: 'workspace_members',
    });
    expect(subscription?.filter).toBe('user_id=eq.user-13');
  });

  it('invalidates and refetches financial caches on a false -> true UPDATE (grant)', async () => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentUser({ id: 'user-30' });
    mockedSupabase.__setCurrentProfile({
      id: 'user-30',
      nome: 'Admin Promovido',
      role: 'admin',
      conta_id: 'conta-30',
    });
    mockMembershipGetUser.mockResolvedValue({ data: { user: { id: 'user-30' } } });
    mockGetContaId.mockResolvedValue('conta-30');
    // Hydration: admin currently restricted.
    mockMaybeSingle.mockResolvedValue({
      data: { role: 'admin', can_see_financials: false },
      error: null,
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    for (const key of FINANCIAL_QUERY_KEYS) {
      queryClient.setQueryData([key], ['masked-value']);
    }

    renderWithAuth(queryClient);

    await waitFor(() => {
      expect(screen.getByTestId('canSeeFinancials')).toHaveTextContent('false');
    });
    // Subscription readiness, not just hydration — see the comment on the
    // equivalent wait in the first test above.
    await waitFor(() => {
      expect(mockedSupabase.__getWorkspaceMemberSubscription()).not.toBeNull();
    });

    const removeSpy = vi.spyOn(queryClient, 'removeQueries');
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const refetchSpy = vi.spyOn(queryClient, 'refetchQueries');

    // Simulate the owner granting this admin can_see_financials.
    await act(async () => {
      mockedSupabase.__emitWorkspaceMemberUpdate({
        workspace_id: 'conta-30',
        role: 'admin',
        can_see_financials: true,
        role_id: null,
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('canSeeFinancials')).toHaveTextContent('true');
    });

    // Grant must invalidate (so a refetch replaces the masked rows) but must
    // NOT remove: the cache holds masked (NULL) values, not sensitive ones,
    // and blanking the UI here would be strictly worse than the brief stale
    // read while the invalidated queries refetch.
    for (const key of FINANCIAL_QUERY_KEYS) {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: [key] });
    }
    expect(removeSpy).not.toHaveBeenCalled();
    // refetchQueries IS called here — but only as invalidateQueries' own
    // internal delegation (queryClient.ts: invalidateQueries ends by calling
    // `this.refetchQueries({ ...filters, type: 'active' })`), which is
    // already scoped to the invalidated key and is exactly what makes the
    // per-key invalidate a real refetch. Spying on the shared queryClient
    // instance picks up that internal call too, so what must NOT appear is
    // AuthContext's own extra, unfiltered call: `{ type: 'active' }` with no
    // queryKey, which would redundantly cancel+restart the refetch
    // invalidateQueries just started AND blast every other unrelated active
    // query mounted on the page (workflows, integrations, Instagram, …) on
    // every single grant.
    expect(refetchSpy).not.toHaveBeenCalledWith({ type: 'active' });
    for (const call of refetchSpy.mock.calls) {
      expect(call[0]).toEqual(expect.objectContaining({ queryKey: expect.any(Array) }));
    }

    removeSpy.mockRestore();
    invalidateSpy.mockRestore();
    refetchSpy.mockRestore();
  });

  it(
    'purges financial caches when a grant is immediately followed by a revoke ' +
      'with no render in between them (the ref-lag race: applyMembership must ' +
      'assign canSeeFinancialsRef synchronously itself, because the passive ' +
      'mirror effect that otherwise copies canSeeFinancials into the ref only ' +
      'runs after React commits, and two applyMembership calls batched into the ' +
      'same commit never give it that chance)',
    async () => {
      mockedSupabase.__resetSupabaseMock();
      mockedSupabase.__setCurrentUser({ id: 'user-41' });
      mockedSupabase.__setCurrentProfile({
        id: 'user-41',
        nome: 'Admin Instável',
        role: 'admin',
        conta_id: 'conta-41',
      });
      mockMembershipGetUser.mockResolvedValue({ data: { user: { id: 'user-41' } } });
      mockGetContaId.mockResolvedValue('conta-41');
      // Hydration: admin currently restricted, so the ref starts at `false`
      // and has already been flushed by the mirror effect (we wait for it
      // below) before the race is set up.
      mockMaybeSingle.mockResolvedValue({
        data: { role: 'admin', can_see_financials: false },
        error: null,
      });

      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      for (const key of FINANCIAL_QUERY_KEYS) {
        queryClient.setQueryData([key], ['masked-value']);
      }

      renderWithAuth(queryClient);

      await waitFor(() => {
        expect(screen.getByTestId('canSeeFinancials')).toHaveTextContent('false');
      });
      // Subscription readiness, not just hydration — see the comment on the
      // equivalent wait in the first test above. Both waits are needed here:
      // one proves hydration settled to the expected starting state, the
      // other proves the channel's UPDATE callback is actually registered,
      // so neither of the two emits below is silently dropped.
      await waitFor(() => {
        expect(mockedSupabase.__getWorkspaceMemberSubscription()).not.toBeNull();
      });

      const removeSpy = vi.spyOn(queryClient, 'removeQueries');
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      // Both postgres_changes payloads are delivered synchronously by the
      // mock (see __emitWorkspaceMemberUpdate), so calling them back to back
      // inside a single, NON-async act() callback — no `await` between them —
      // keeps both applyMembership invocations in the same JS tick. React 18
      // automatic batching then folds the two setCanSeeFinancials calls into
      // one commit, so the passive `useEffect(() => { canSeeFinancialsRef
      // .current = canSeeFinancials }, [canSeeFinancials])` mirror runs only
      // once, AFTER both applyMembership calls already executed — it cannot
      // run between them. That is the exact shape of the race: grant
      // (false -> true) then revoke (true -> false) before any render/flush.
      act(() => {
        mockedSupabase.__emitWorkspaceMemberUpdate({
          workspace_id: 'conta-41',
          role: 'admin',
          can_see_financials: true, // grant
          role_id: null,
        });
        mockedSupabase.__emitWorkspaceMemberUpdate({
          workspace_id: 'conta-41',
          role: 'admin',
          can_see_financials: false, // revoke, same tick, right behind the grant
          role_id: null,
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId('canSeeFinancials')).toHaveTextContent('false');
      });

      // The revoke must still purge outright, even though it landed in the
      // same batch as the grant right before it. Against the pre-fix code
      // (guard reads the passive-mirror ref instead of one applyMembership
      // assigns itself) both calls compare against the SAME stale `false`
      // ref, so the revoke's `false !== false` looks like a no-op and this
      // assertion fails — removeQueries is never called and the grant's
      // invalidate+refetch is left free to repopulate the cache with
      // authorised rows after access was already revoked.
      for (const key of FINANCIAL_QUERY_KEYS) {
        expect(queryClient.getQueryData([key])).toBeUndefined();
        expect(removeSpy).toHaveBeenCalledWith({ queryKey: [key] });
      }

      removeSpy.mockRestore();
      invalidateSpy.mockRestore();
    },
  );

  it(
    "invalidates and refetches financial caches on an 'unknown' -> true UPDATE " +
      '(the ordinary first-resolution path for an authorised admin, mirroring the ' +
      "'unknown' -> false grant-denial race above)",
    async () => {
      mockedSupabase.__resetSupabaseMock();
      mockedSupabase.__setCurrentUser({ id: 'user-31' });
      mockedSupabase.__setCurrentProfile({
        id: 'user-31',
        nome: 'Admin Autorizado',
        role: 'admin',
        conta_id: 'conta-31',
      });
      mockMembershipGetUser.mockResolvedValue({ data: { user: { id: 'user-31' } } });
      mockGetContaId.mockResolvedValue('conta-31');

      // Hold the hydration effect's OWN getMyMembership() call pending, so
      // canSeeFinancials (and its ref) stay at their untouched initial
      // 'unknown' while the live-revocation effect's subscription mounts and
      // reacts to a realtime UPDATE on its own — same technique as the
      // "'unknown' -> false" race test above.
      let resolveMembership!: (v: { data: unknown; error: null }) => void;
      mockMaybeSingle.mockReturnValue(
        new Promise((resolve) => {
          resolveMembership = resolve;
        }),
      );

      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      for (const key of FINANCIAL_QUERY_KEYS) {
        queryClient.setQueryData([key], ['masked-value']);
      }

      renderWithAuth(queryClient);

      await waitFor(() => {
        expect(mockedSupabase.__getWorkspaceMemberSubscription()).not.toBeNull();
      });
      expect(screen.getByTestId('canSeeFinancials')).toHaveTextContent('unknown');

      const removeSpy = vi.spyOn(queryClient, 'removeQueries');
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      await act(async () => {
        mockedSupabase.__emitWorkspaceMemberUpdate({
          workspace_id: 'conta-31',
          role: 'admin',
          can_see_financials: true,
          role_id: null,
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId('canSeeFinancials')).toHaveTextContent('true');
      });

      for (const key of FINANCIAL_QUERY_KEYS) {
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: [key] });
      }
      expect(removeSpy).not.toHaveBeenCalled();

      removeSpy.mockRestore();
      invalidateSpy.mockRestore();

      // Let the stalled hydration path resolve too, so nothing leaks into
      // later tests.
      await act(async () => {
        resolveMembership({ data: { role: 'admin', can_see_financials: true }, error: null });
      });
    },
  );

  it(
    'does not invalidate, remove, or refetch on a true -> true poll no-op ' +
      '(the ref-comparison guard must still suppress a same-state repeat, ' +
      'or the 60s poll would refetch storm every tick)',
    async () => {
      mockedSupabase.__resetSupabaseMock();
      mockedSupabase.__setCurrentUser({ id: 'user-32' });
      mockedSupabase.__setCurrentProfile({
        id: 'user-32',
        nome: 'Owner Estável',
        role: 'owner',
        conta_id: 'conta-32',
      });
      mockMembershipGetUser.mockResolvedValue({ data: { user: { id: 'user-32' } } });
      mockGetContaId.mockResolvedValue('conta-32');
      // Hydration: owner, always allowed.
      mockMaybeSingle.mockResolvedValueOnce({
        data: { role: 'owner', can_see_financials: false },
        error: null,
      });

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

        const removeSpy = vi.spyOn(queryClient, 'removeQueries');
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
        const refetchSpy = vi.spyOn(queryClient, 'refetchQueries');

        // The poll resolves to the SAME state (owner, still allowed): a
        // true -> true repeat, not a transition.
        mockMaybeSingle.mockResolvedValueOnce({
          data: { role: 'owner', can_see_financials: false },
          error: null,
        });

        await act(async () => {
          pollCallbacks[pollCallbacks.length - 1]();
        });

        // Still true, and untouched — the guard must have skipped entirely.
        expect(screen.getByTestId('canSeeFinancials')).toHaveTextContent('true');
        for (const key of FINANCIAL_QUERY_KEYS) {
          expect(queryClient.getQueryData([key])).toEqual(['cached-value']);
        }
        expect(removeSpy).not.toHaveBeenCalled();
        expect(invalidateSpy).not.toHaveBeenCalled();
        expect(refetchSpy).not.toHaveBeenCalled();

        removeSpy.mockRestore();
        invalidateSpy.mockRestore();
        refetchSpy.mockRestore();
      } finally {
        setIntervalSpy.mockRestore();
      }
    },
  );
});

// Coverage for the role_id-transition branch added alongside can(): a
// realtime UPDATE payload never carries the workspace_roles.permissions
// embed, so any transition INVOLVING a custom role (assigned, or just
// removed) must fall back to a fresh getMyMembership() round trip instead of
// applying the raw payload — see the comment on that branch in
// AuthContext.tsx. None of the tests above ever set `role_id` on an emitted
// payload, so this branch had zero coverage before this describe block.
describe('live revocation handler — role_id-transition refetch branch', () => {
  it('a payload with a non-null role_id triggers a getMyMembership() refetch and applies ITS permissions, not the raw payload', async () => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentUser({ id: 'user-50' });
    mockedSupabase.__setCurrentProfile({
      id: 'user-50',
      nome: 'Admin com Papel Novo',
      role: 'admin',
      conta_id: 'conta-50',
    });
    mockMembershipGetUser.mockResolvedValue({ data: { user: { id: 'user-50' } } });
    mockGetContaId.mockResolvedValue('conta-50');
    // Hydration: legacy admin, financials restricted.
    mockMaybeSingle.mockResolvedValueOnce({
      data: { role: 'admin', can_see_financials: false, role_id: null, workspace_roles: null },
      error: null,
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithAuth(queryClient);

    await waitFor(() => {
      expect(screen.getByTestId('canSeeFinancials')).toHaveTextContent('false');
    });
    await waitFor(() => {
      expect(mockedSupabase.__getWorkspaceMemberSubscription()).not.toBeNull();
    });

    // The refetch's OWN getMyMembership() response: a custom role granting
    // financeiro/ver — the OPPOSITE of what the raw payload's
    // can_see_financials (false) would produce if it were applied directly.
    // The assertion below can only pass if the refetched permissions embed,
    // not the raw emitted row, was what actually got applied.
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        role: 'agent',
        can_see_financials: false,
        role_id: 'role-financeiro-ver',
        workspace_roles: { permissions: { financeiro: 'ver' } },
      },
      error: null,
    });

    await act(async () => {
      mockedSupabase.__emitWorkspaceMemberUpdate({
        workspace_id: 'conta-50',
        role: 'agent',
        can_see_financials: false,
        role_id: 'role-financeiro-ver',
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('canSeeFinancials')).toHaveTextContent('true');
    });
    expect(screen.getByTestId('workspaceRole')).toHaveTextContent('agent');
  });

  it('a role_id transition from custom back to null (legacy) also refetches, rather than trusting the raw payload', async () => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentUser({ id: 'user-51' });
    mockedSupabase.__setCurrentProfile({
      id: 'user-51',
      nome: 'Papel Removido',
      role: 'admin',
      conta_id: 'conta-51',
    });
    mockMembershipGetUser.mockResolvedValue({ data: { user: { id: 'user-51' } } });
    mockGetContaId.mockResolvedValue('conta-51');
    // Hydration: custom role, empty permissions — denies financeiro
    // regardless of the legacy can_see_financials flag (TT-16 semantics).
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        role: 'agent',
        can_see_financials: true,
        role_id: 'role-1',
        workspace_roles: { permissions: {} },
      },
      error: null,
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithAuth(queryClient);

    await waitFor(() => {
      expect(screen.getByTestId('canSeeFinancials')).toHaveTextContent('false');
    });
    await waitFor(() => {
      expect(mockedSupabase.__getWorkspaceMemberSubscription()).not.toBeNull();
    });

    // The emitted payload's own can_see_financials is `true` — if the
    // custom -> null transition were (incorrectly) applied directly instead
    // of refetched, canSeeFinancials would flip to `true` right here. The
    // refetch's OWN queued response below deliberately disagrees (`false`),
    // so the assertion can only pass if getMyMembership() was actually
    // called again for this transition, not the raw payload trusted.
    mockMaybeSingle.mockResolvedValueOnce({
      data: { role: 'admin', can_see_financials: false, role_id: null, workspace_roles: null },
      error: null,
    });

    await act(async () => {
      mockedSupabase.__emitWorkspaceMemberUpdate({
        workspace_id: 'conta-51',
        role: 'admin',
        can_see_financials: true,
        role_id: null,
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('workspaceRole')).toHaveTextContent('admin');
    });
    // Must reflect the REFETCH's answer (false), not the raw payload's
    // can_see_financials (true).
    expect(screen.getByTestId('canSeeFinancials')).toHaveTextContent('false');
  });

  it('a rejected refetch leaves canSeeFinancials/workspaceRole untouched (no partial state on failure)', async () => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentUser({ id: 'user-52' });
    mockedSupabase.__setCurrentProfile({
      id: 'user-52',
      nome: 'Admin Estável',
      role: 'admin',
      conta_id: 'conta-52',
    });
    mockMembershipGetUser.mockResolvedValue({ data: { user: { id: 'user-52' } } });
    mockGetContaId.mockResolvedValue('conta-52');
    mockMaybeSingle.mockResolvedValueOnce({
      data: { role: 'admin', can_see_financials: true, role_id: null, workspace_roles: null },
      error: null,
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithAuth(queryClient);

    await waitFor(() => {
      expect(screen.getByTestId('canSeeFinancials')).toHaveTextContent('true');
    });
    await waitFor(() => {
      expect(mockedSupabase.__getWorkspaceMemberSubscription()).not.toBeNull();
    });

    // getMyMembership() throws on a query error (store/workspace.ts) — the
    // refetch this role_id transition triggers will reject.
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });

    await act(async () => {
      mockedSupabase.__emitWorkspaceMemberUpdate({
        workspace_id: 'conta-52',
        role: 'agent',
        can_see_financials: false,
        role_id: 'role-broken',
      });
    });

    // fetchAndApplyMembership()'s `.catch(() => {})` swallows the rejection
    // BEFORE applyMembership ever runs — state must be exactly what
    // hydration left it at, not a partial/blank application.
    expect(screen.getByTestId('canSeeFinancials')).toHaveTextContent('true');
    expect(screen.getByTestId('workspaceRole')).toHaveTextContent('admin');
  });

  it('an older refetch resolving after a newer one does not overwrite the newer state (membershipFetchSeq ordering guard)', async () => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentUser({ id: 'user-60' });
    mockedSupabase.__setCurrentProfile({
      id: 'user-60',
      nome: 'Admin com Corridas',
      role: 'admin',
      conta_id: 'conta-60',
    });
    mockMembershipGetUser.mockResolvedValue({ data: { user: { id: 'user-60' } } });
    mockGetContaId.mockResolvedValue('conta-60');
    mockMaybeSingle.mockResolvedValueOnce({
      data: { role: 'admin', can_see_financials: false, role_id: null, workspace_roles: null },
      error: null,
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithAuth(queryClient);

    await waitFor(() => {
      expect(mockedSupabase.__getWorkspaceMemberSubscription()).not.toBeNull();
    });

    let resolveOlder!: (v: { data: unknown; error: null }) => void;
    let resolveNewer!: (v: { data: unknown; error: null }) => void;
    mockMaybeSingle.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOlder = resolve;
      }),
    );
    mockMaybeSingle.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveNewer = resolve;
      }),
    );

    // Two role_id transitions back to back, no render/await between them —
    // both start their own getMyMembership() refetch while the PREVIOUS
    // one is still pending (same synchronous-batch technique as the
    // ref-lag race test above).
    act(() => {
      mockedSupabase.__emitWorkspaceMemberUpdate({
        workspace_id: 'conta-60',
        role: 'agent',
        can_see_financials: false,
        role_id: 'role-older',
      });
      mockedSupabase.__emitWorkspaceMemberUpdate({
        workspace_id: 'conta-60',
        role: 'agent',
        can_see_financials: false,
        role_id: 'role-newer',
      });
    });

    // Resolve the NEWER request first, then the OLDER one — the exact
    // out-of-order network race membershipFetchSeq exists to guard against.
    await act(async () => {
      resolveNewer({
        data: {
          role: 'agent',
          can_see_financials: false,
          role_id: 'role-newer',
          workspace_roles: { permissions: { financeiro: 'ver' } },
        },
        error: null,
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('canSeeFinancials')).toHaveTextContent('true');
    });

    await act(async () => {
      resolveOlder({
        data: {
          role: 'agent',
          can_see_financials: false,
          role_id: 'role-older',
          workspace_roles: { permissions: { financeiro: 'none' } },
        },
        error: null,
      });
    });

    // The stale (older) response must be dropped — state must still reflect
    // the newer, already-applied result, not regress to the older one.
    expect(screen.getByTestId('canSeeFinancials')).toHaveTextContent('true');
  });

  it('a refetch resolving after this effect tears down (unmount) never reaches applyMembership (no late purge/invalidate)', async () => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentUser({ id: 'user-62' });
    mockedSupabase.__setCurrentProfile({
      id: 'user-62',
      nome: 'Admin Desmontado',
      role: 'admin',
      conta_id: 'conta-62',
    });
    mockMembershipGetUser.mockResolvedValue({ data: { user: { id: 'user-62' } } });
    mockGetContaId.mockResolvedValue('conta-62');
    mockMaybeSingle.mockResolvedValueOnce({
      data: { role: 'admin', can_see_financials: true, role_id: null, workspace_roles: null },
      error: null,
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = renderWithAuth(queryClient);

    await waitFor(() => {
      expect(screen.getByTestId('canSeeFinancials')).toHaveTextContent('true');
    });
    await waitFor(() => {
      expect(mockedSupabase.__getWorkspaceMemberSubscription()).not.toBeNull();
    });

    let resolvePending!: (v: { data: unknown; error: null }) => void;
    mockMaybeSingle.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePending = resolve;
      }),
    );

    await act(async () => {
      mockedSupabase.__emitWorkspaceMemberUpdate({
        workspace_id: 'conta-62',
        role: 'agent',
        can_see_financials: false,
        role_id: 'role-in-flight',
      });
    });

    const removeSpy = vi.spyOn(queryClient, 'removeQueries');
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    // Tear down the effect (and every channel/poll/closure it owns) while
    // the refetch it started is still in flight.
    view.unmount();

    // The stale refetch resolves AFTER teardown, with a payload that — had
    // it reached applyMembership() — would flip canSeeFinancials true ->
    // false and purge every FINANCIAL_QUERY_KEYS entry via removeQueries().
    await act(async () => {
      resolvePending({
        data: {
          role: 'agent',
          can_see_financials: false,
          role_id: 'role-in-flight',
          workspace_roles: { permissions: { financeiro: 'none' } },
        },
        error: null,
      });
    });

    // Neither call fired: the teardown guard (membershipFetchSeq bumped in
    // this effect's own cleanup) dropped the resolution before it ever
    // reached applyMembership(), so no purge/invalidate happened on behalf
    // of an effect instance that no longer exists.
    expect(removeSpy).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();

    removeSpy.mockRestore();
    invalidateSpy.mockRestore();
  });
});

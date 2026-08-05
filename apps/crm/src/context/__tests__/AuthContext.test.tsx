import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
// from THIS module, not from '../../lib/supabase'. A factory that omits
// them leaves `supabase` undefined inside getMyMembership(), so every call
// throws before reaching the mocked maybeSingle() — canSeeFinancials always
// resolves via the catch path to 'unknown', and the membership happy path
// (the one AuthContext.tsx actually exercises) never gets covered by this
// suite.
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

// Real analytics.ts no-ops every export unless VITE_POSTHOG_KEY is set (never
// true in this test env), so without this mock `resetAnalytics()` silently
// does nothing and a regression that drops its call from AuthContext would
// go uncaught. Mocked so the A -> B test below can assert it was actually
// invoked, not just that it wouldn't have thrown.
vi.mock('../../lib/analytics', () => ({
  identifyWorkspaceUser: vi.fn(),
  resetAnalytics: vi.fn(),
}));

import * as supabaseModule from '../../lib/supabase';
import { resetAnalytics } from '../../lib/analytics';
import { AuthProvider, useAuth } from '../AuthContext';

const mockedResetAnalytics = vi.mocked(resetAnalytics);

type MockedSupabaseModule = typeof supabaseModule & {
  __resetSupabaseMock: () => void;
  __setCurrentProfile: (profile: Record<string, unknown> | null) => void;
  __queueCurrentProfileResponse: (response: Promise<Record<string, unknown> | null>) => void;
  __queueFunctionsInvokeResponse: (
    response: { data: unknown; error?: unknown } | Promise<{ data: unknown; error?: unknown }>,
  ) => void;
  __setCurrentUser: (user: { id: string; email?: string } | null) => void;
  __emitAuthChange: (
    event: string,
    session: { user: { id: string; email?: string } | null } | null,
  ) => void;
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

// Populated during Probe's render body (not an effect), so it captures every
// distinct commit React produces -- including one that a later effect's own
// setState corrects before `act()` settles and before any effect-driven
// commit is visible to a `screen.getByTestId` query afterwards. That later
// correction (the "Fetch profile whenever user changes" effect always calls
// setLoading(true) at its top once userId changes) means a plain "check
// `loading` after `act()` resolves" assertion can't tell a fixed
// synchronous reset apart from a delayed one -- both settle to the same
// final value. Recording every render this way is what makes the
// distinction observable in a test at all.
let renderHistory: Array<{ user: string; loading: string }> = [];

function Probe() {
  const auth = useAuth();
  renderHistory.push({ user: auth.user?.id ?? 'anon', loading: String(auth.loading) });
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

  it('resets profile/financial/analytics state and re-raises loading on a same-tab A -> B user switch (cross-account bleed + spurious-redirect regression)', async () => {
    // Both users non-null — e.g. another tab signing in against shared
    // storage. Gating the reset on `!nextUser` alone let B render with A's
    // profile/canSeeFinancials/query cache until B's own membership resolved.
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentUser({ id: 'user-A' });
    mockedSupabase.__setCurrentProfile({
      id: 'user-A',
      nome: 'Ana',
      role: 'owner',
      conta_id: 'conta-A',
    });
    mockMembershipGetUser.mockResolvedValue({ data: { user: { id: 'user-A' } } });
    mockGetContaId.mockResolvedValue('conta-A');
    mockMaybeSingle.mockResolvedValue({
      data: { role: 'owner', can_see_financials: true },
      error: null,
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('canSeeFinancials')).toHaveTextContent('true');
    });

    // Seed a cache entry the way a real financial query would, so we can
    // prove it is purged on the switch instead of surviving for user B.
    queryClient.setQueryData(['transacoes'], [{ id: 'tx-a' }]);

    // Block B's profile fetch so we can observe the state in between the
    // auth event and B's own hydration completing.
    let resolveProfileB!: (profile: Record<string, unknown> | null) => void;
    mockedSupabase.__queueCurrentProfileResponse(
      new Promise((resolve) => {
        resolveProfileB = resolve;
      }),
    );

    // Reset right before the switch: everything captured from here on is
    // renders caused by the switch itself.
    renderHistory = [];

    await act(async () => {
      mockedSupabase.__emitAuthChange('SIGNED_IN', { user: { id: 'user-B' } });
    });

    // B must never render with A's identity still attached, even before B's
    // own membership/profile resolve.
    expect(screen.getByTestId('user')).toHaveTextContent('user-B');
    // `role` reads 'agent' right here too, purely because `profile` was just
    // reset to null — that is the fallback formula (`profile?.role ?? 'agent'`),
    // true before AND after the fix below, so asserting it here would never
    // catch a regression.
    //
    // What actually gates a consumer like ProtectedRoute from acting on that
    // fallback is `loading`. Checking `screen.getByTestId('loading')` here
    // (the settled DOM, after `act()` has fully resolved) can NOT tell the
    // fix apart from the bug: the "fetch profile whenever user changes"
    // effect (keyed on userId) unconditionally sets loading(true) at its own
    // top, so by the time `act()` settles, `loading` reads 'true' either
    // way — whether this reset set it synchronously in the SAME commit as
    // `user`/`profile`, or only that later effect did. The bug is a commit
    // that is briefly live (and, outside a test, paintable) with
    // `user: 'user-B'` and `loading: false` before that correction —
    // exactly the window a real route guard's render can observe. Render-body
    // history (captured on every commit, not just the final one visible
    // after `act()`) is what makes that window observable at all: it must
    // never show B's id paired with loading:false.
    expect(renderHistory).not.toContainEqual({ user: 'user-B', loading: 'false' });
    expect(screen.getByTestId('loading')).toHaveTextContent('true');
    expect(screen.getByTestId('workspaceRole')).toHaveTextContent('null');
    expect(screen.getByTestId('canSeeFinancials')).toHaveTextContent('unknown');
    expect(queryClient.getQueryData(['transacoes'])).toBeUndefined();
    // posthog-js keeps A's distinct_id across a second identify() call
    // without an explicit reset() first — omitting this call would merge
    // B's events/person-properties into A's PostHog profile.
    expect(mockedResetAnalytics).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveProfileB({
        id: 'user-B',
        nome: 'Beto',
        role: 'agent',
        conta_id: 'conta-B',
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });
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

// window.$crisp is a real array in production (Crisp's snippet installs
// `window.$crisp = []` before its async script loads, and `.push(...)`
// queues commands onto that same array), which is exactly why the ambient
// `Window['$crisp']` type declared alongside AppLayout/TopBarActions/
// MobileNav is `Array<unknown[]>`, not some bespoke SDK object. None of the
// suites above ever set `window.$crisp`, which is precisely why both the
// original bleed (identity never reset) and the stale-email gap (identify
// effect not keyed on email) went unnoticed -- every push silently no-oped
// on `undefined` in jsdom. This block is scoped with its own
// beforeEach/afterEach so it never leaks the stub into the tests above or
// below it.
describe('AuthProvider Crisp identification', () => {
  let crispPush: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.$crisp = [];
    crispPush = vi.spyOn(window.$crisp, 'push');
  });

  afterEach(() => {
    delete (window as { $crisp?: unknown }).$crisp;
  });

  it('identifies user:email and user:nickname once an identity exists', async () => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentUser({ id: 'user-1', email: 'eduardo@example.com' });
    mockedSupabase.__setCurrentProfile({
      id: 'user-1',
      nome: 'Eduardo Souza',
      role: 'owner',
      conta_id: 'conta-1',
    });

    renderWithAuth();

    await waitFor(() => {
      expect(crispPush).toHaveBeenCalledWith(['set', 'user:email', ['eduardo@example.com']]);
    });
    await waitFor(() => {
      expect(crispPush).toHaveBeenCalledWith(['set', 'user:nickname', ['Eduardo Souza']]);
    });
  });

  it('pushes the signed (two-element) form when crisp-identity resolves a signature', async () => {
    // Guards against the signing call being silently dropped from the push:
    // this test would fail if `signature` stopped being read from
    // `supabase.functions.invoke('crisp-identity')`'s response, or if the
    // two-element ['set', 'user:email', [email, signature]] form regressed
    // to the unsigned one-element form even when a signature IS available.
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentUser({ id: 'user-1', email: 'eduardo@example.com' });
    mockedSupabase.__setCurrentProfile({
      id: 'user-1',
      nome: 'Eduardo Souza',
      role: 'owner',
      conta_id: 'conta-1',
    });
    mockedSupabase.__queueFunctionsInvokeResponse({ data: { signature: 'abc' }, error: null });

    renderWithAuth();

    await waitFor(() => {
      expect(crispPush).toHaveBeenCalledWith(['set', 'user:email', ['eduardo@example.com', 'abc']]);
    });
    // The unsigned form must never be pushed when a signature was obtained.
    expect(crispPush).not.toHaveBeenCalledWith(['set', 'user:email', ['eduardo@example.com']]);
  });

  it('falls back to the unsigned (one-element) form when crisp-identity returns no signature', async () => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentUser({ id: 'user-1', email: 'eduardo@example.com' });
    mockedSupabase.__setCurrentProfile({
      id: 'user-1',
      nome: 'Eduardo Souza',
      role: 'owner',
      conta_id: 'conta-1',
    });
    mockedSupabase.__queueFunctionsInvokeResponse({ data: null, error: { message: 'boom' } });

    renderWithAuth();

    await waitFor(() => {
      expect(crispPush).toHaveBeenCalledWith(['set', 'user:email', ['eduardo@example.com']]);
    });
  });

  it('re-pushes user:email with the NEW value after an in-session email change (same userId)', async () => {
    // Regression coverage for the stale-identity finding: a Supabase
    // USER_UPDATED event (e.g. the user changes their email) updates
    // `user.email` in state while `userId` stays the same. Before the Crisp
    // identify push was split into its own effect keyed on
    // [userId, user?.email, profile?.nome], the profile-hydration effect
    // (keyed only on [sessionReady, userId]) would not re-run, and Crisp
    // would stay identified with the OLD email for the rest of the session.
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentUser({ id: 'user-1', email: 'old@example.com' });
    mockedSupabase.__setCurrentProfile({
      id: 'user-1',
      nome: 'Eduardo Souza',
      role: 'owner',
      conta_id: 'conta-1',
    });

    renderWithAuth();

    await waitFor(() => {
      expect(crispPush).toHaveBeenCalledWith(['set', 'user:email', ['old@example.com']]);
    });

    crispPush.mockClear();

    await act(async () => {
      mockedSupabase.__emitAuthChange('USER_UPDATED', {
        user: { id: 'user-1', email: 'new@example.com' },
      });
    });

    await waitFor(() => {
      expect(crispPush).toHaveBeenCalledWith(['set', 'user:email', ['new@example.com']]);
    });
    // The stale value must never resurface after the change settles.
    expect(crispPush).not.toHaveBeenCalledWith(['set', 'user:email', ['old@example.com']]);
  });

  it('resets the Crisp session on sign-out, before the next identity could be pushed', async () => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentUser({ id: 'user-1', email: 'eduardo@example.com' });
    mockedSupabase.__setCurrentProfile({
      id: 'user-1',
      nome: 'Eduardo Souza',
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
      expect(crispPush).toHaveBeenCalledWith(['do', 'session:reset']);
    });
  });

  it('never pushes the outgoing user:email after session:reset when sign-out races an in-flight crisp-identity call', async () => {
    // Regression coverage for the cross-customer attribution race: the
    // signing round trip added by the timeout fix is NOT synchronous, so a
    // sign-out's synchronous session:reset can fire while a crisp-identity
    // call started by the JUST-reset (outgoing) user is still in flight. If
    // that response is allowed to push user:email afterwards, the next
    // person on a shared machine gets attributed to the outgoing customer --
    // exactly what session:reset exists to prevent. `crispResetGeneration` is
    // what closes this window (see the comment above the effect in
    // AuthContext.tsx): it is bumped synchronously at the top of signOut(),
    // before any await, so it has already moved by the time this held invoke
    // promise is resolved below -- even though the effect's own `active`
    // closure variable has not necessarily been torn down yet (that only
    // happens once React re-renders with the new, signed-out userId).
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentUser({ id: 'user-1', email: 'eduardo@example.com' });
    mockedSupabase.__setCurrentProfile({
      id: 'user-1',
      nome: 'Eduardo Souza',
      role: 'owner',
      conta_id: 'conta-1',
    });

    let resolveInvoke!: (value: { data: unknown; error?: unknown }) => void;
    mockedSupabase.__queueFunctionsInvokeResponse(
      new Promise((resolve) => {
        resolveInvoke = resolve;
      }),
    );

    renderWithAuth();

    await waitFor(() => {
      expect(screen.getByTestId('role')).toHaveTextContent('owner');
    });
    // The Crisp email effect has started and is now awaiting the held
    // invoke promise above -- it has not resolved yet.

    // Trigger sign-out with the SYNC act() overload, not the async one: it
    // runs only the synchronous portion of the click handler (which starts
    // `signOut()`, bumping `authGeneration.current` as its very first
    // statement, before any await) without draining the microtask queue any
    // further. This is what puts us inside the race window instead of
    // letting the whole sign-out settle first.
    act(() => {
      screen.getByText('sair').click();
    });

    // Now let the in-flight crisp-identity call for the OUTGOING user
    // resolve, with a signature -- the worst case (a validly signed push for
    // the wrong identity).
    await act(async () => {
      resolveInvoke({ data: { signature: 'abc' }, error: null });
    });

    await waitFor(() => {
      expect(screen.getByTestId('role')).toHaveTextContent('agent');
    });
    expect(crispPush).toHaveBeenCalledWith(['do', 'session:reset']);

    const emailPushesAfterReset = crispPush.mock.calls.filter(
      (call) => call[0]?.[0] === 'set' && call[0]?.[1] === 'user:email',
    );
    expect(emailPushesAfterReset).toHaveLength(0);
  });

  it('still identifies when an unrelated auth event (TOKEN_REFRESHED) lands mid-invoke', async () => {
    // The narrowing half of the guard above, and the reason it counts
    // session:reset pushes rather than auth events. `authGeneration` moves on
    // EVERY onAuthStateChange event -- INITIAL_SESSION, TOKEN_REFRESHED,
    // USER_UPDATED, SIGNED_IN -- none of which reset the Crisp session. A
    // token refresh inside the crisp-identity invoke window is routine at app
    // start (the invoke can take seconds against a cold edge function), and
    // comparing against authGeneration made it reject the push. The effect's
    // deps are [userId, user?.email], neither of which a refresh changes, so
    // it never re-ran: the user stayed UNIDENTIFIED in Crisp for the entire
    // mount -- strictly worse than the unsigned fallback. This test fails
    // against the old authGeneration guard and passes against
    // crispResetGeneration.
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentUser({ id: 'user-1', email: 'eduardo@example.com' });
    mockedSupabase.__setCurrentProfile({
      id: 'user-1',
      nome: 'Eduardo Souza',
      role: 'owner',
      conta_id: 'conta-1',
    });

    let resolveInvoke!: (value: { data: unknown; error?: unknown }) => void;
    mockedSupabase.__queueFunctionsInvokeResponse(
      new Promise((resolve) => {
        resolveInvoke = resolve;
      }),
    );

    renderWithAuth();

    await waitFor(() => {
      expect(screen.getByTestId('role')).toHaveTextContent('owner');
    });
    // The identify effect is now parked on the held invoke promise.

    // An auth event that does NOT change identity: same user id, same email.
    // No session:reset is pushed for it, so nothing may suppress the push.
    await act(async () => {
      mockedSupabase.__emitAuthChange('TOKEN_REFRESHED', {
        user: { id: 'user-1', email: 'eduardo@example.com' },
      });
    });
    expect(crispPush).not.toHaveBeenCalledWith(['do', 'session:reset']);

    await act(async () => {
      resolveInvoke({ data: { signature: 'abc' }, error: null });
    });

    await waitFor(() => {
      expect(crispPush).toHaveBeenCalledWith(['set', 'user:email', ['eduardo@example.com', 'abc']]);
    });
  });
});

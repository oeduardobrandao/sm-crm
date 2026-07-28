import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { User } from '@supabase/supabase-js';
import {
  supabase,
  getCurrentProfile,
  clearProfileCache,
  signOut as supabaseSignOut,
  healPendingInvite,
} from '../lib/supabase';
import { initStoreRole } from '../store/core';
import { getMyMembership, type MyMembership } from '../store/workspace';
import { deriveFinancialAccess, type FinancialAccess } from '../lib/financialAccess';
import { identifyWorkspaceUser, resetAnalytics } from '../lib/analytics';

interface Profile {
  id: string;
  nome: string;
  role: 'owner' | 'admin' | 'agent';
  conta_id: string;
  active_workspace_id?: string;
  [key: string]: unknown;
}

/**
 * Caches holding financial values, purged on live revocation (true -> false).
 *
 * Deliberately excludes `portfolioSummary`: that query is Instagram accounts,
 * top/worst posts and growth counters (services/analytics.ts) — no monetary
 * field. Purging it would refetch a large payload for nothing.
 */
export const FINANCIAL_QUERY_KEYS = [
  'clientes',
  'membros',
  'transacoes',
  'contratos',
  'dashboardStats',
];

interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  role: 'owner' | 'admin' | 'agent';
  /**
   * Role from workspace_members for the ACTIVE workspace. Prefer this over
   * `role` for anything permission-bearing; `role` comes from profiles and goes
   * stale on workspace switch. `null` while unresolved.
   */
  workspaceRole: 'owner' | 'admin' | 'agent' | null;
  /**
   * Whether the membership lookup behind `workspaceRole` has actually
   * settled, and how: `true` means it ran to completion (whether or not it
   * found a row); `'error'` means it threw (network/RLS blip) without ever
   * determining membership one way or the other; `false` means it hasn't
   * run yet for the current identity. `workspaceRole === null` alone is
   * ambiguous between "removed from the workspace" and "could not
   * determine" — this disambiguates. Consumers should treat only
   * `workspaceRole === null && membershipResolved === true` as a genuine
   * "no longer a member".
   */
  membershipResolved: boolean | 'error';
  canSeeFinancials: FinancialAccess;
  loading: boolean;
  refetchProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [workspaceRole, setWorkspaceRole] = useState<'owner' | 'admin' | 'agent' | null>(null);
  const [membershipResolved, setMembershipResolved] = useState<boolean | 'error'>(false);
  const [canSeeFinancials, setCanSeeFinancials] = useState<FinancialAccess>('unknown');
  const [loading, setLoading] = useState(true);
  const [sessionReady, setSessionReady] = useState(false);
  const authGeneration = useRef(0);
  const profileRequestId = useRef(0);
  const activeUserId = useRef<string | null>(null);
  const userId = user?.id;

  useEffect(() => {
    let active = true;
    const initialAuthGeneration = authGeneration.current;

    // Resolve only the session here. Profile hydration belongs to the user
    // effect below so every session transition has exactly one request owner.
    void supabase.auth.getSession().then(
      ({ data }) => {
        if (!active || authGeneration.current !== initialAuthGeneration) return;
        const sessionUser = data.session?.user ?? null;
        activeUserId.current = sessionUser?.id ?? null;
        setUser(sessionUser);
        setSessionReady(true);
      },
      () => {
        if (!active || authGeneration.current !== initialAuthGeneration) return;
        setUser(null);
        setSessionReady(true);
        setLoading(false);
      },
    );

    // Listen for auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      authGeneration.current += 1;

      const nextUser = session?.user ?? null;
      const nextUserId = nextUser?.id ?? null;
      // Any identity change — including A -> B with both non-null, e.g.
      // another tab signing in against shared storage — must reset every
      // per-user value below. Gating this on `!nextUser` alone left B
      // rendering with A's profile/canSeeFinancials/query cache until B's
      // membership resolved: a brief cross-account exposure. Match `signOut`
      // below (clearProfileCache, all four resets, queryClient.clear()).
      const userChanged = activeUserId.current !== nextUserId;
      if (userChanged) profileRequestId.current += 1;
      activeUserId.current = nextUserId;
      setUser(nextUser);
      setSessionReady(true);
      if (userChanged) {
        clearProfileCache();
        setProfile(null);
        setWorkspaceRole(null);
        setCanSeeFinancials('unknown');
        setMembershipResolved(false);
        // Without this, posthog-js keeps A's distinct_id: it never switches
        // identity on a second identify() call without an explicit reset()
        // first. Skipping this let B's events and person-properties land on
        // A's PostHog profile -- the same cross-account bleed the resets
        // above exist to close, one layer over. Mirrors `signOut` below.
        resetAnalytics();
        queryClient.clear();
        // A non-null nextUser still has hydration ahead of it (the
        // profile-fetch effect below, keyed on userId, takes over `loading`
        // from here). Raising it back to true -- rather than leaving it at
        // whatever value A's completed hydration left it at -- closes the
        // window where a render sees `loading: false` with `profile: null`:
        // `role` falls back to 'agent' there (see the derivation below), and
        // consumers gating on `loading` (ProtectedRoute, ConfiguracaoLayout)
        // must not be allowed to act on that fallback before B's real role
        // resolves.
        if (nextUser) setLoading(true);
        else setLoading(false);
      }
    });

    return () => {
      active = false;
      authGeneration.current += 1;
      profileRequestId.current += 1;
      activeUserId.current = null;
      subscription.unsubscribe();
    };
    // queryClient is a stable module-level singleton (see App.tsx), so listing
    // it here satisfies exhaustive-deps without causing extra effect runs.
  }, [queryClient]);

  // Fetch profile whenever user changes
  useEffect(() => {
    if (!sessionReady) return;

    if (!userId) {
      profileRequestId.current += 1;
      setProfile(null);
      setWorkspaceRole(null);
      setMembershipResolved(false);
      setCanSeeFinancials('unknown');
      setLoading(false);
      return;
    }

    let active = true;
    const requestId = ++profileRequestId.current;
    setLoading(true);

    void (async () => {
      try {
        const nextProfile = await getCurrentProfile(true);
        if (!active || profileRequestId.current !== requestId) return;

        setProfile(nextProfile as Profile | null);
        if (nextProfile) {
          // plan_id is null here on purpose: AuthContext resolves before entitlements load, and
          // blocking identify on a second request would delay every event behind it. Cohorting by
          // plan is a follow-up — enrich the `workspace` group where useEntitlements already has it.
          identifyWorkspaceUser(userId, {
            workspace_id: (nextProfile as Profile).conta_id,
            plan_id: null,
            role: (nextProfile as Profile).role,
          });
        }
        await initStoreRole();
        if (!active || profileRequestId.current !== requestId) return;

        // Joins the existing guarded hydration flow so `loading` covers it too.
        // On failure resolve to 'unknown', NEVER to a boolean.
        try {
          const membership = await getMyMembership();
          if (!active || profileRequestId.current !== requestId) return;
          setWorkspaceRole(membership?.role ?? null);
          setCanSeeFinancials(deriveFinancialAccess(membership));
          // The lookup ran to completion -- `membership === null` here means
          // it genuinely found no row, not that it failed. Either way this
          // is a real, resolved answer about membership.
          setMembershipResolved(true);
        } catch {
          if (!active || profileRequestId.current !== requestId) return;
          setWorkspaceRole(null);
          setCanSeeFinancials('unknown');
          // The lookup THREW (network/RLS blip) -- membership was never
          // actually determined. Must stay distinguishable from a genuine
          // "no row found" (`true`, above) so callers don't tell a real
          // member they've been removed over a transient error.
          setMembershipResolved('error');
        }

        void healPendingInvite();
      } catch {
        if (active && profileRequestId.current === requestId) {
          setProfile(null);
          // getCurrentProfile()/initStoreRole() threw before the membership
          // lookup ever ran -- nothing about membership is known.
          setMembershipResolved('error');
        }
      } finally {
        if (active && profileRequestId.current === requestId) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [sessionReady, userId]);

  // Mirrors canSeeFinancials into a ref so the revocation handler below reads
  // the CURRENT value without needing to re-subscribe every time it changes.
  const canSeeFinancialsRef = useRef<FinancialAccess>('unknown');
  useEffect(() => {
    canSeeFinancialsRef.current = canSeeFinancials;
  }, [canSeeFinancials]);

  // Live revocation.
  //
  // Severity, stated precisely: this is a correctness/UX concern, not a
  // disclosure boundary. After Migration B the database denies the read
  // regardless of what this client believes, so a stale cache cannot survive
  // a refetch and no new financial data can be obtained either way. This
  // effect is defence-in-depth over values already sitting in memory (query
  // cache, open dialogs) for a tab that never refetches on its own — it must
  // never be described or relied upon as the enforcement boundary.
  //
  // Keyed on [userId, profile?.conta_id] rather than [sessionReady, userId]
  // (the hydration effect above): that effect never re-runs on a workspace
  // switch, which is safe today only because the sole switch path
  // (Sidebar.tsx) does a full window.location.reload(). Keying here on the
  // workspace id too means this subscription still re-points itself at the
  // new workspace if that assumption ever changes.
  useEffect(() => {
    const workspaceId = profile?.conta_id;
    if (!userId || !workspaceId) return;

    const applyMembership = (
      next: { workspace_id?: string; role?: string; can_see_financials?: boolean } | null,
    ) => {
      setWorkspaceRole(next ? ((next.role as 'owner' | 'admin' | 'agent') ?? null) : null);
      // Both callers of applyMembership (the realtime UPDATE payload and the
      // poll's getMyMembership() result) only ever invoke it with a genuine,
      // resolved answer -- the poll's own `.catch(() => {})` below swallows
      // lookup errors before they would reach here. So every call is a real
      // resolution, whether membership is present or (`next === null`) gone.
      setMembershipResolved(true);
      // Same derivation as hydration — never re-implement the role semantics
      // here. Two copies drift; this bug already shipped once on this branch
      // (a raw can_see_financials assignment gave agents access and denied
      // restricted owners). `next === null` — membership row gone, which is
      // exactly what a deletion resolves to via getMyMembership() — derives
      // to 'unknown' here too: it masks financial values and fails the route
      // guard neutral instead of keeping a stale role/grant alive.
      const nowAllowed = deriveFinancialAccess(next as MyMembership | null);
      setCanSeeFinancials(nowAllowed);

      // Purge on ANY transition INTO a non-authorised state, not only a
      // transition FROM a definitely-granted one. A `wasAllowed` boolean
      // (`ref === true`) cannot see this: hydration starts the ref at
      // 'unknown', so a restricted admin's very first resolution is
      // `'unknown' -> false` — `wasAllowed` is `false` going in, so the old
      // `wasAllowed && nowAllowed !== true` check never fires for it, even
      // though that is exactly the transition that must purge (a prior fetch
      // could already have populated the cache with real rows while access
      // was still unresolved). Comparing the ref's actual value instead of
      // collapsing it to a boolean catches that case too, while `ref !==
      // nowAllowed` still skips a same-state repeat from the 60s poll
      // (e.g. false -> false), which is not a transition and must not
      // re-purge or re-trigger a refetch storm every tick.
      if (nowAllowed !== true && canSeeFinancialsRef.current !== nowAllowed) {
        for (const key of FINANCIAL_QUERY_KEYS) {
          queryClient.removeQueries({ queryKey: [key] });
        }
        void queryClient.refetchQueries({ type: 'active' });
      }
    };

    // wm_select_same_workspace (migration 20260612120000) lets this user read
    // their membership row in EVERY workspace they belong to, not just the
    // active one, so a `user_id=eq.<uid>` filter alone lets Realtime deliver
    // UPDATEs from other workspaces too. Without the workspace_id guard below,
    // a row from a different workspace would overwrite workspaceRole/
    // canSeeFinancials for the active one — a spurious revocation or grant.
    //
    // Migration A adds workspace_members to the realtime publication under
    // the DEFAULT replica identity, so DELETE events carry only the primary
    // key. A filter on user_id=eq.<uid> matches no DELETE payload, so being
    // removed from the workspace entirely would look "subscribed and
    // healthy" while silently going unnoticed. Subscribe to UPDATE only (it
    // carries the full new row) — the bounded poll below is what actually
    // covers deletion (see its comment for how).
    // Do NOT add REPLICA IDENTITY FULL to make DELETE usable here: that
    // costs write amplification on every update to this table and is a
    // deliberate trade to leave for later, not to slip in.
    const channel = supabase
      .channel(`wm:${userId}:${workspaceId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'workspace_members',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as {
            workspace_id?: string;
            role?: string;
            can_see_financials?: boolean;
          };
          if (row.workspace_id !== workspaceId) return;
          applyMembership(row);
        },
      )
      .subscribe();

    // Bounded polling fallback. Refetch-on-focus alone is insufficient: focus
    // events never fire for a tab that stays foregrounded, which is precisely
    // the indefinite-cache case this exists to address. It is also the only
    // path that covers revocation-by-deletion: getMyMembership() resolves to
    // `null` once the row is gone (filtered by both user_id AND workspace_id,
    // so it is immune to the cross-workspace bleed above), and applyMembership
    // now lets that `null` flow through instead of early-returning — see its
    // comment for what that derives to.
    const poll = setInterval(() => {
      void getMyMembership()
        .then(applyMembership)
        .catch(() => {});
    }, 60_000);

    return () => {
      clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [userId, profile?.conta_id, queryClient]);

  const fetchProfile = async () => {
    if (!sessionReady || !user) {
      profileRequestId.current += 1;
      setProfile(null);
      setWorkspaceRole(null);
      setMembershipResolved(false);
      setCanSeeFinancials('unknown');
      setLoading(false);
      return;
    }

    const requestId = ++profileRequestId.current;
    setLoading(true);
    try {
      const nextProfile = await getCurrentProfile(true);
      if (profileRequestId.current !== requestId) return;

      setProfile(nextProfile as Profile | null);
      await initStoreRole();
    } catch {
      if (profileRequestId.current === requestId) setProfile(null);
    } finally {
      if (profileRequestId.current === requestId) setLoading(false);
    }
  };

  const role: 'owner' | 'admin' | 'agent' =
    (profile?.role as 'owner' | 'admin' | 'agent') ?? 'agent';

  const signOut = async () => {
    authGeneration.current += 1;
    profileRequestId.current += 1;
    await supabaseSignOut();
    // Prevent the next user on a shared machine from being merged into this identity.
    resetAnalytics();
    clearProfileCache();
    activeUserId.current = null;
    setUser(null);
    setSessionReady(true);
    setProfile(null);
    setWorkspaceRole(null);
    setMembershipResolved(false);
    setCanSeeFinancials('unknown');
    setLoading(false);
    // Drop all cached per-user data (entitlements, notifications, …) so the next
    // account that logs in never sees the previous user's plan/limits.
    queryClient.clear();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        role,
        workspaceRole,
        membershipResolved,
        canSeeFinancials,
        loading,
        refetchProfile: fetchProfile,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

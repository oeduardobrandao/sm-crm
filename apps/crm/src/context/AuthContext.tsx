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
import { getMyMembership } from '../store/workspace';
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
      if (activeUserId.current !== nextUserId) profileRequestId.current += 1;
      activeUserId.current = nextUserId;
      setUser(nextUser);
      setSessionReady(true);
      if (!nextUser) {
        clearProfileCache();
        setProfile(null);
        setWorkspaceRole(null);
        setCanSeeFinancials('unknown');
        setLoading(false);
      }
    });

    return () => {
      active = false;
      authGeneration.current += 1;
      profileRequestId.current += 1;
      activeUserId.current = null;
      subscription.unsubscribe();
    };
  }, []);

  // Fetch profile whenever user changes
  useEffect(() => {
    if (!sessionReady) return;

    if (!userId) {
      profileRequestId.current += 1;
      setProfile(null);
      setWorkspaceRole(null);
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
        } catch {
          if (!active || profileRequestId.current !== requestId) return;
          setWorkspaceRole(null);
          setCanSeeFinancials('unknown');
        }

        void healPendingInvite();
      } catch {
        if (active && profileRequestId.current === requestId) setProfile(null);
      } finally {
        if (active && profileRequestId.current === requestId) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [sessionReady, userId]);

  const fetchProfile = async () => {
    if (!sessionReady || !user) {
      profileRequestId.current += 1;
      setProfile(null);
      setWorkspaceRole(null);
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

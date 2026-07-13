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
  loading: boolean;
  refetchProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionReady, setSessionReady] = useState(false);
  const authGeneration = useRef(0);
  const profileRequestId = useRef(0);
  const userId = user?.id;

  useEffect(() => {
    let active = true;
    const initialAuthGeneration = authGeneration.current;

    // Resolve only the session here. Profile hydration belongs to the user
    // effect below so every session transition has exactly one request owner.
    void supabase.auth.getSession().then(
      ({ data }) => {
        if (!active || authGeneration.current !== initialAuthGeneration) return;
        setUser(data.session?.user ?? null);
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
      profileRequestId.current += 1;

      const nextUser = session?.user ?? null;
      setUser(nextUser);
      setSessionReady(true);
      if (!nextUser) {
        clearProfileCache();
        setProfile(null);
        setLoading(false);
      }
    });

    return () => {
      active = false;
      authGeneration.current += 1;
      profileRequestId.current += 1;
      subscription.unsubscribe();
    };
  }, []);

  // Fetch profile whenever user changes
  useEffect(() => {
    if (!sessionReady) return;

    if (!userId) {
      profileRequestId.current += 1;
      setProfile(null);
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
        await initStoreRole();
        if (!active || profileRequestId.current !== requestId) return;

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
    clearProfileCache();
    setUser(null);
    setSessionReady(true);
    setProfile(null);
    setLoading(false);
    // Drop all cached per-user data (entitlements, notifications, …) so the next
    // account that logs in never sees the previous user's plan/limits.
    queryClient.clear();
  };

  return (
    <AuthContext.Provider
      value={{ user, profile, role, loading, refetchProfile: fetchProfile, signOut }}
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

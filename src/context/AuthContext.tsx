import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase, getCurrentProfile, clearProfileCache, signOut as supabaseSignOut } from '../lib/supabase';

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

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async () => {
    const p = await getCurrentProfile(true);
    setProfile(p);
  };

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (!session?.user) {
        clearProfileCache();
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Fetch profile whenever user changes
  useEffect(() => {
    if (user) {
      fetchProfile();
    } else {
      setProfile(null);
    }
  }, [user?.id]);

  const role: 'owner' | 'admin' | 'agent' = (profile?.role as 'owner' | 'admin' | 'agent') ?? 'agent';

  const signOut = async () => {
    await supabaseSignOut();
    clearProfileCache();
    setProfile(null);
  };

  return (
    <AuthContext.Provider value={{ user, profile, role, loading, refetchProfile: fetchProfile, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { verifyAdmin } from '../lib/api';

interface AdminAuthContextValue {
  user: User | null;
  isAdmin: boolean;
  loading: boolean;
  adminEmail: string | null;
  signOut: () => Promise<void>;
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  // Kept together with the user it was checked for: a result belonging to a previous user
  // must never be read as the current user's.
  const [adminCheck, setAdminCheck] = useState<{ userId: string; isAdmin: boolean } | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setSessionLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null;
      setUser(nextUser);
      // Signing out invalidates the verdict, so signing back in re-checks rather than
      // reusing what was true for that user before.
      if (!nextUser) setAdminCheck(null);
      setSessionLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const userId = user?.id ?? null;
  // null while the current user's admin status is still unknown.
  const verifiedIsAdmin =
    adminCheck !== null && userId !== null && adminCheck.userId === userId
      ? adminCheck.isAdmin
      : null;

  useEffect(() => {
    if (userId === null || verifiedIsAdmin !== null) return;
    let cancelled = false;
    verifyAdmin()
      .then(({ is_admin }) => {
        if (!cancelled) setAdminCheck({ userId, isAdmin: is_admin });
      })
      .catch((err) => {
        // A failed check is not proof of "not an admin", but the guard has to decide
        // something — log loudly so a transient failure is not mistaken for a denial.
        console.error('[admin-auth] verifyAdmin FAILED (treating as not-admin)', err);
        if (!cancelled) setAdminCheck({ userId, isAdmin: false });
      });
    return () => {
      cancelled = true;
    };
  }, [userId, verifiedIsAdmin]);

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setAdminCheck(null);
  };

  // Signed in but unverified is "unknown", not "denied" — consumers must wait it out rather
  // than send the user back to the login screen while the check is still in flight.
  const loading = sessionLoading || (userId !== null && verifiedIsAdmin === null);

  return (
    <AdminAuthContext.Provider
      value={{
        user,
        isAdmin: verifiedIsAdmin === true,
        loading,
        adminEmail: user?.email ?? null,
        signOut,
      }}
    >
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth(): AdminAuthContextValue {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error('useAdminAuth must be used within AdminAuthProvider');
  return ctx;
}

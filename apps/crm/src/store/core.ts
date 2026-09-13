import { supabase, getCurrentUser, getCurrentProfile, clearProfileCache } from '@/lib/supabase';

export { supabase, getCurrentUser, getCurrentProfile, clearProfileCache };

// ---- Helpers ----
export function formatDate(d: string): string {
  return new Date(d + 'T00:00:00').toLocaleDateString('pt-BR');
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();
}

export async function getUserId(): Promise<string> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Não autenticado');
  return user.id;
}

export async function getContaId(): Promise<string> {
  // Forces a fresh read instead of the module-level profile cache: this value
  // is stamped onto every write's conta_id, and RLS checks it against the
  // DB's live active_workspace_id at insert time. A long-lived tab (sleep/
  // wake, bfcache restore) can hold a cachedProfile from a previous active
  // workspace while RLS-scoped reads (already live, uncached) show the
  // current one -- sending the stale conta_id then fails every write with a
  // confusing RLS 403, even though nothing about the workspace actually
  // changed in this tab's session.
  const profile = await getCurrentProfile(true);
  if (!profile || !profile.conta_id)
    throw new Error('Conta não encontrada ou usuário não autenticado');
  return profile.conta_id;
}

import { supabase, getCurrentUser, getCurrentProfile, clearProfileCache } from '@/lib/supabase';

export { supabase, getCurrentUser, getCurrentProfile, clearProfileCache };

export let currentUserRole: 'owner' | 'admin' | 'agent' = 'agent';

export async function initStoreRole() {
  try {
    const profile = await getCurrentProfile();
    if (profile) {
      currentUserRole = profile.role || 'agent';
    } else {
      currentUserRole = 'agent';
    }
  } catch (e) {
    console.error('[store] initStoreRole failed, defaulting to agent:', e);
    currentUserRole = 'agent';
  }
}

// ---- Helpers ----
export function formatBRL(val: number): string {
  if (currentUserRole === 'agent') return 'R$ •••••';
  return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

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
  const profile = await getCurrentProfile();
  if (!profile || !profile.conta_id)
    throw new Error('Conta não encontrada ou usuário não autenticado');
  return profile.conta_id;
}

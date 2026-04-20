import { supabase } from '../lib/supabase';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

export type InviteRole = 'owner' | 'admin' | 'agent';

export interface InviteResult {
  success: boolean;
  message?: string;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${session.access_token}`,
  };
}

export async function inviteUser(email: string, role: InviteRole): Promise<InviteResult> {
  if (!email) throw new Error('Email é obrigatório');
  const headers = await getAuthHeaders();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/invite-user`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, role }),
  });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error || result.message || `Erro ${res.status}`);
  return result as InviteResult;
}

export async function cancelInvite(id: number): Promise<InviteResult> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/invite-user?id=${id}`, {
    method: 'DELETE',
    headers,
  });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error || `Erro ${res.status}`);
  return result as InviteResult;
}

import { supabase } from '../lib/supabase';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

export type InviteRole = 'owner' | 'admin' | 'agent';

export interface InviteResult {
  success: boolean;
  message?: string;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  };
}

export async function inviteUser(
  email: string,
  role: InviteRole,
  membroId?: number,
  roleId?: string,
): Promise<InviteResult> {
  if (!email) throw new Error('Email é obrigatório');
  const headers = await getAuthHeaders();
  const body: Record<string, unknown> = { email, role };
  if (membroId != null) body.membroId = membroId;
  // Snake_case on purpose: invite-user reads `body.role_id`, not `roleId` —
  // mirrors the request shape the edge function (Task 6) actually parses.
  if (roleId != null) body.role_id = roleId;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/invite-user`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const result = await res.json();
  if (!res.ok) {
    // Carry the JSON payload on the Error so mapEntitlementError() can read
    // { error: 'plan_limit_exceeded', resource } from the edge function.
    const error = new Error(result.error || result.message || `Erro ${res.status}`);
    Object.assign(error, result);
    throw error;
  }
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

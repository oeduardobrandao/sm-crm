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
  // role_id is ALWAYS sent explicitly (uuid, or null when there is none) —
  // snake_case because invite-user reads `body.role_id`, not `roleId`. Never
  // omitted: invite-user/inviteOrResend treat the KEY's absence as "legacy
  // caller, inherit whatever role_id an existing pending invite for this
  // email already carries" — first-party callers (this function) must send
  // `null` explicitly for a deliberate plain-role choice, or a fresh invite
  // could silently resurrect a stale custom papel from an unrelated earlier
  // invite to the same address instead of the role the caller just picked.
  const body: Record<string, unknown> = { email, role, role_id: roleId ?? null };
  if (membroId != null) body.membroId = membroId;
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

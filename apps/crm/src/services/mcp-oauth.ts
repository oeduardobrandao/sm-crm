import { supabase } from '../lib/supabase';

const FN = (import.meta.env.VITE_SUPABASE_URL as string) + '/functions/v1/mcp-oauth-consent';

async function authHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Não autenticado');
  return { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' };
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch(FN, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data as T;
}

export interface EligibleWorkspace {
  id: string;
  name: string;
  role: string;
  feature_mcp: boolean;
}

export interface EligibleResult {
  workspaces: EligibleWorkspace[];
  /** O usuário está em platform_admins e pode autorizar o MCP do Admin da plataforma. */
  platform_admin: boolean;
}

/** Workspaces elegíveis + se o usuário é platform admin. */
export function listEligibleWorkspaces(): Promise<EligibleResult> {
  return call<{ workspaces: EligibleWorkspace[]; platform_admin?: boolean }>({
    action: 'eligible-workspaces',
  }).then((d) => ({ workspaces: d.workspaces, platform_admin: d.platform_admin === true }));
}

/**
 * Records (or re-points) the consent grant before the browser approves the OAuth authorization.
 * The edge function derives the OAuth client_id server-side from authorization_id — we never send it.
 */
export function recordOAuthGrant(params: {
  authorization_id: string;
  scopes: string[];
  conta_id?: string;
  target?: 'workspace' | 'platform';
}): Promise<{ ok: true }> {
  return call<{ ok: true }>({ action: 'approve', ...params });
}

export interface OAuthGrant {
  id: string;
  client_id: string;
  scopes: string[];
  created_at: string;
  revoked_at: string | null;
  connected_by: string | null;
}

/** Active + revoked Claude OAuth connections for the current workspace (owner/admin). */
export function listOAuthGrants(): Promise<OAuthGrant[]> {
  return call<{ grants: OAuthGrant[] }>({ action: 'list-grants' }).then((d) => d.grants);
}

/** Revokes a Claude OAuth connection — MCP access is cut immediately. */
export function revokeOAuthGrant(grant_id: string): Promise<{ ok: true }> {
  return call<{ ok: true }>({ action: 'revoke-grant', grant_id });
}

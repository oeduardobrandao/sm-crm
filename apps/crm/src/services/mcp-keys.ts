import { supabase } from '../lib/supabase';

const FN = (import.meta.env.VITE_SUPABASE_URL as string) + '/functions/v1/mcp-keys';

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

export interface McpKey {
  id: string;
  name: string;
  token_suffix: string;
  scopes: string[];
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export function listMcpKeys(): Promise<McpKey[]> {
  return call<{ keys: McpKey[] }>({ action: 'list' }).then((d) => d.keys);
}

export function createMcpKey(params: {
  name: string;
  scopes: string[];
  expires_at?: string | null;
}): Promise<{ token: string; key: McpKey }> {
  return call<{ token: string; key: McpKey }>({ action: 'create', ...params });
}

export function revokeMcpKey(id: string): Promise<{ ok: true }> {
  return call<{ ok: true }>({ action: 'revoke', id });
}

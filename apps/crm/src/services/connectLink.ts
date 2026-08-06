import { supabase } from '../lib/supabase';

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/instagram-connect-link`;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export interface ConnectLink {
  url: string;
  expires_at: string;
}

export type PublicConnectStatus = 'live' | 'revoked' | 'expired' | 'unavailable' | 'not_found';

export interface PublicConnectInfo {
  status: PublicConnectStatus;
  cliente_name: string;
  workspace_name: string;
  connected_username: string | null;
}

async function authedHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return {
    apikey: ANON,
    Authorization: `Bearer ${session?.access_token}`,
    'Content-Type': 'application/json',
  };
}

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || 'Erro na requisição');
  }
  return (await res.json()) as T;
}

export async function getConnectLink(clienteId: number): Promise<ConnectLink | null> {
  const res = await fetch(`${FN_URL}?cliente_id=${clienteId}`, { headers: await authedHeaders() });
  const data = await unwrap<{ link: ConnectLink | null }>(res);
  return data.link;
}

export async function createConnectLink(clienteId: number): Promise<ConnectLink> {
  const res = await fetch(FN_URL, {
    method: 'POST',
    headers: await authedHeaders(),
    body: JSON.stringify({ cliente_id: clienteId }),
  });
  const data = await unwrap<{ link: ConnectLink }>(res);
  return data.link;
}

export async function revokeConnectLink(clienteId: number): Promise<void> {
  const res = await fetch(`${FN_URL}?cliente_id=${clienteId}`, {
    method: 'DELETE',
    headers: await authedHeaders(),
  });
  await unwrap<{ ok: boolean }>(res);
}

export async function emailConnectLink(clienteId: number, email: string): Promise<void> {
  const res = await fetch(`${FN_URL}/email`, {
    method: 'POST',
    headers: await authedHeaders(),
    body: JSON.stringify({ cliente_id: clienteId, email }),
  });
  await unwrap<{ ok: boolean }>(res);
}

// --- Rotas públicas. Sem Authorization: quem chama é o cliente final, sem login. ---

export async function getPublicConnectInfo(token: string): Promise<PublicConnectInfo> {
  const res = await fetch(`${FN_URL}/public/${encodeURIComponent(token)}`, {
    headers: { apikey: ANON },
  });
  // Um token desconhecido é 404 e é um estado normal da página, não uma exceção.
  if (res.status === 404) {
    return { status: 'not_found', cliente_name: '', workspace_name: '', connected_username: null };
  }
  const data = await unwrap<Partial<PublicConnectInfo> & { status: PublicConnectStatus }>(res);
  return {
    status: data.status,
    cliente_name: data.cliente_name ?? '',
    workspace_name: data.workspace_name ?? '',
    connected_username: data.connected_username ?? null,
  };
}

export async function startPublicConnect(token: string): Promise<string> {
  const res = await fetch(`${FN_URL}/public/${encodeURIComponent(token)}/start`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
  });
  const data = await unwrap<{ url: string }>(res);
  return data.url;
}

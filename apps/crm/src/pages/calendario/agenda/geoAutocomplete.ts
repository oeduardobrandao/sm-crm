import { supabase } from '@/lib/supabase';

export interface SugestaoEndereco {
  /** Full one-line address, what the field receives on pick. */
  rotulo: string;
  linha1: string;
  linha2: string;
}

export const MIN_TEXTO_ENDERECO = 3;

/** Address suggestions through the geo-autocomplete edge function (the
 *  Geoapify key stays server-side). Throws on any failure; callers treat that
 *  as "no suggestions" and keep the field as plain text. */
export async function buscarEnderecos(
  texto: string,
  signal?: AbortSignal,
): Promise<SugestaoEndereco[]> {
  const q = texto.trim();
  if (q.length < MIN_TEXTO_ENDERECO) return [];
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('sem sessão');
  const base = import.meta.env.VITE_SUPABASE_URL as string;
  const res = await fetch(
    `${base}/functions/v1/geo-autocomplete?${new URLSearchParams({ q }).toString()}`,
    { headers: { Authorization: `Bearer ${session.access_token}` }, signal },
  );
  if (!res.ok) throw new Error(`geo-autocomplete ${res.status}`);
  const body = (await res.json()) as { sugestoes?: SugestaoEndereco[] };
  return Array.isArray(body.sugestoes) ? body.sugestoes : [];
}

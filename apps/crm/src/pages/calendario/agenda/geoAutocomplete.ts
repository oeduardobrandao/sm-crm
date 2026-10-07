import { supabase } from '@/lib/supabase';

export interface SugestaoEndereco {
  /** Full one-line address, what the field receives on pick. */
  rotulo: string;
  linha1: string;
  linha2: string;
}

export const MIN_TEXTO_ENDERECO = 3;
/** The function rejects longer queries (400). */
export const MAX_TEXTO_ENDERECO = 200;

// After a 503 (service off or platform quota spent) or 429 (this user's
// limit), stop calling for a while: every call still costs an auth round-trip.
const PAUSA_503_MS = 10 * 60_000;
const PAUSA_429_MS = 60_000;
let pausadoAte = 0;

/** Tests only. */
export function _resetPausaEnderecos() {
  pausadoAte = 0;
}

/** Address suggestions through the geo-autocomplete edge function (the
 *  Geoapify key stays server-side). Throws on any failure; callers treat that
 *  as "no suggestions" and keep the field as plain text. */
export async function buscarEnderecos(
  texto: string,
  signal?: AbortSignal,
): Promise<SugestaoEndereco[]> {
  const q = texto.trim();
  if (q.length < MIN_TEXTO_ENDERECO || q.length > MAX_TEXTO_ENDERECO) return [];
  if (Date.now() < pausadoAte) return [];
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('sem sessão');
  const base = import.meta.env.VITE_SUPABASE_URL as string;
  const res = await fetch(
    `${base}/functions/v1/geo-autocomplete?${new URLSearchParams({ q }).toString()}`,
    { headers: { Authorization: `Bearer ${session.access_token}` }, signal },
  );
  if (res.status === 503) pausadoAte = Date.now() + PAUSA_503_MS;
  if (res.status === 429) pausadoAte = Date.now() + PAUSA_429_MS;
  if (!res.ok) throw new Error(`geo-autocomplete ${res.status}`);
  const body = (await res.json()) as { sugestoes?: SugestaoEndereco[] };
  return Array.isArray(body.sugestoes) ? body.sugestoes : [];
}

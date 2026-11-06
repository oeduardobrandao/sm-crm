import { supabase, getUserId, getContaId } from './core';

export interface Membro {
  id?: number;
  user_id?: string;
  nome: string;
  cargo: string;
  tipo: 'clt' | 'freelancer_mensal' | 'freelancer_demanda';
  custo_mensal: number | null;
  /** Public URL or NULL (never ''). Written only by `set_member_photo`. */
  avatar_url: string | null;
  conta_id?: string;
  data_pagamento?: number;
  crm_user_id?: string | null;
}

/** Allowlisted columns — must match the GRANT in Migration B exactly. */
const MEMBRO_SAFE_COLUMNS =
  'id, user_id, conta_id, nome, cargo, tipo, avatar_url, data_pagamento, created_at, crm_user_id';

export async function getMembros(): Promise<Membro[]> {
  // Reads go through the masking view; writes stay on the base table.
  const { data, error } = await supabase
    .from('membros_v')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addMembro(
  m: Omit<Membro, 'id' | 'user_id' | 'conta_id' | 'avatar_url'> & { avatar_url?: string | null },
): Promise<Omit<Membro, 'custo_mensal'>> {
  const user_id = await getUserId();
  const conta_id = await getContaId();
  // RETURNING is narrowed to the allowlist: `.select()` is RETURNING *, which
  // needs SELECT on custo_mensal and would fail for a restricted admin.
  const { data, error } = await supabase
    .from('membros')
    .insert({ ...m, user_id, conta_id })
    .select(MEMBRO_SAFE_COLUMNS)
    .single();
  if (error) throw error;
  return data as Omit<Membro, 'custo_mensal'>;
}

export async function updateMembro(
  id: number,
  m: Partial<Omit<Membro, 'id' | 'user_id' | 'conta_id'>>,
): Promise<void> {
  const { error } = await supabase
    .from('membros')
    .update(m)
    .eq('id', id)
    .select(MEMBRO_SAFE_COLUMNS)
    .single();
  if (error) throw error;
}

export async function removeMembro(id: number): Promise<void> {
  const { error } = await supabase.from('membros').delete().eq('id', id);
  if (error) throw error;
}

export async function setMembroCrmUser(membroId: number, crmUserId: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_membro_crm_user', {
    p_membro_id: membroId,
    p_crm_user_id: crmUserId,
  });
  if (error) throw error;
}

/** Whose photo: the caller's own (Perfil) or a team record (Equipe, needs equipe:editar). */
export type FotoAlvo = { kind: 'self'; userId: string } | { kind: 'membro'; membroId: number };

/**
 * Sets (or with `path = null`, removes) a person's photo. `path` is the object already
 * uploaded to the `avatars` bucket; the RPC checks it and builds the public URL itself.
 * Returns the stored URL, or null after a removal.
 */
export async function setMemberPhoto(alvo: FotoAlvo, path: string | null): Promise<string | null> {
  const { data, error } = await supabase.rpc('set_member_photo', {
    p_membro_id: alvo.kind === 'membro' ? alvo.membroId : null,
    p_user_id: alvo.kind === 'self' ? alvo.userId : null,
    p_path: path,
  });
  if (error) throw error;
  return (data as string | null) ?? null;
}

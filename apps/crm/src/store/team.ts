import { supabase, getUserId, getContaId } from './core';

export interface Membro {
  id?: number;
  user_id?: string;
  nome: string;
  cargo: string;
  tipo: 'clt' | 'freelancer_mensal' | 'freelancer_demanda';
  custo_mensal: number | null;
  avatar_url: string;
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

export async function addMembro(m: Omit<Membro, 'id' | 'user_id' | 'conta_id'>): Promise<void> {
  const user_id = await getUserId();
  const conta_id = await getContaId();
  // RETURNING is narrowed to the allowlist: `.select()` is RETURNING *, which
  // needs SELECT on custo_mensal and would fail for a restricted admin.
  const { error } = await supabase
    .from('membros')
    .insert({ ...m, user_id, conta_id })
    .select(MEMBRO_SAFE_COLUMNS)
    .single();
  if (error) throw error;
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

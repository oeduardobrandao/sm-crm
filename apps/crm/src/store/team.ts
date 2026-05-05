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

export async function getMembros(): Promise<Membro[]> {
  const { data, error } = await supabase
    .from('membros')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addMembro(m: Omit<Membro, 'id' | 'user_id' | 'conta_id'>): Promise<Membro> {
  const user_id = await getUserId();
  const conta_id = await getContaId();
  const { data, error } = await supabase
    .from('membros')
    .insert({ ...m, user_id, conta_id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateMembro(id: number, m: Partial<Omit<Membro, 'id' | 'user_id' | 'conta_id'>>): Promise<Membro> {
  const { data, error } = await supabase
    .from('membros')
    .update(m)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function removeMembro(id: number): Promise<void> {
  const { error } = await supabase.from('membros').delete().eq('id', id);
  if (error) throw error;
}

export async function setMembroCrmUser(membroId: number, crmUserId: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_membro_crm_user', {
    p_membro_id:   membroId,
    p_crm_user_id: crmUserId,
  });
  if (error) throw error;
}

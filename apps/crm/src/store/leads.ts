import { supabase, getUserId, getContaId } from './core';

export interface Lead {
  id?: number;
  conta_id?: string;
  user_id?: string;
  nome: string;
  email: string;
  telefone: string;
  instagram: string;
  canal: string;
  origem: 'manual' | 'typeform' | 'instagram';
  status: 'novo' | 'contatado' | 'qualificado' | 'perdido' | 'convertido';
  notas: string;
  especialidade: string;
  faturamento: string;
  objetivo: string;
  tags: string;
  created_at?: string;
}

export async function getLeads(): Promise<Lead[]> {
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

/**
 * Exact lead count for plan-usage display. getLeads() is a single unpaged
 * select capped by the server max-rows setting, so its length can understate
 * a large workspace; head+count asks Postgres for the real number.
 */
export async function getLeadsCount(): Promise<number> {
  const { count, error } = await supabase.from('leads').select('*', { count: 'exact', head: true });
  if (error) throw error;
  return count ?? 0;
}

export async function addLead(
  l: Omit<Lead, 'id' | 'user_id' | 'conta_id' | 'created_at'>,
): Promise<Lead> {
  const user_id = await getUserId();
  const conta_id = await getContaId();
  const { data, error } = await supabase
    .from('leads')
    .insert({ ...l, user_id, conta_id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateLead(
  id: number,
  l: Partial<Omit<Lead, 'id' | 'user_id' | 'conta_id' | 'created_at'>>,
): Promise<Lead> {
  const { data, error } = await supabase.from('leads').update(l).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function removeLead(id: number): Promise<void> {
  const { error } = await supabase.from('leads').delete().eq('id', id);
  if (error) throw error;
}

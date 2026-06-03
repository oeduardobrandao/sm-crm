import { supabase, getUserId, getContaId } from './core';

export interface Transacao {
  id?: number;
  user_id?: string;
  data: string;
  descricao: string;
  detalhe: string;
  categoria: string;
  tipo: 'entrada' | 'saida';
  valor: number;
  cliente_id?: number | null;
  conta_id?: string;
  status?: 'pago' | 'agendado';
  referencia_agendamento?: string | null;
}

export interface Contrato {
  id?: number;
  user_id?: string;
  cliente_id?: number | null;
  cliente_nome: string;
  titulo: string;
  data_inicio: string;
  data_fim: string;
  status: 'vigente' | 'a_assinar' | 'encerrado';
  valor_total: number;
  conta_id?: string;
}

// =============================================
// TRANSACOES CRUD
// =============================================
export async function getTransacoes(): Promise<Transacao[]> {
  const { data, error } = await supabase
    .from('transacoes')
    .select('*')
    .order('data', { ascending: false });
  if (error) throw error;

  // Retrocompatibilidade: Se status for undefined/null no banco, vira 'pago' localmente para não quebrar fluxos antigos.
  return (data || []).map((t) => ({ ...t, status: t.status || 'pago' }));
}

export async function addTransacao(
  t: Omit<Transacao, 'id' | 'user_id' | 'conta_id'>,
): Promise<Transacao> {
  const user_id = await getUserId();
  const conta_id = await getContaId();
  const payload = {
    ...t,
    user_id,
    conta_id,
    status: t.status || 'pago',
    referencia_agendamento: t.referencia_agendamento || null,
  };
  const { data, error } = await supabase.from('transacoes').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateTransacao(
  id: number,
  t: Partial<Omit<Transacao, 'id' | 'user_id' | 'conta_id'>>,
): Promise<Transacao> {
  const { data, error } = await supabase
    .from('transacoes')
    .update(t)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function removeTransacao(id: number): Promise<void> {
  const { error } = await supabase.from('transacoes').delete().eq('id', id);
  if (error) throw error;
}

// =============================================
// CONTRATOS CRUD
// =============================================
export async function getContratos(): Promise<Contrato[]> {
  const { data, error } = await supabase
    .from('contratos')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addContrato(
  c: Omit<Contrato, 'id' | 'user_id' | 'conta_id'>,
): Promise<Contrato> {
  const user_id = await getUserId();
  const conta_id = await getContaId();
  const { data, error } = await supabase
    .from('contratos')
    .insert({ ...c, user_id, conta_id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateContrato(
  id: number,
  c: Partial<Omit<Contrato, 'id' | 'user_id' | 'conta_id'>>,
): Promise<Contrato> {
  const { data, error } = await supabase.from('contratos').update(c).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function removeContrato(id: number): Promise<void> {
  const { error } = await supabase.from('contratos').delete().eq('id', id);
  if (error) throw error;
}

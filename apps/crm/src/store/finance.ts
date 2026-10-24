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

/** A lançamento that repeats every month; each month shows up as an "agendado" entry. */
export interface TransacaoRecorrente {
  id?: number;
  tipo: 'entrada' | 'saida';
  descricao: string;
  categoria: string;
  valor: number;
  /** Day of the month; shorter months use their last day. */
  dia: number;
  /** First month it occurs in, always the 1st (YYYY-MM-01). */
  inicio: string;
  /** Last month it occurs in (YYYY-MM-01), or null when it has no end. */
  fim: string | null;
}

/** referencia_agendamento of a recorrente's occurrence in a month. */
export function referenciaRecorrente(id: number, ano: number, mes: number): string {
  return `recorrente_${id}_${ano}_${String(mes).padStart(2, '0')}`;
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
// TRANSACOES RECORRENTES CRUD
// =============================================
export async function getRecorrentes(): Promise<TransacaoRecorrente[]> {
  const { data, error } = await supabase
    .from('transacoes_recorrentes')
    .select('id, tipo, descricao, categoria, valor, dia, inicio, fim')
    .order('descricao');
  if (error) throw error;
  return (data || []).map((r) => ({ ...r, valor: Number(r.valor) }));
}

export async function addRecorrente(
  r: Omit<TransacaoRecorrente, 'id' | 'fim'>,
): Promise<TransacaoRecorrente> {
  const user_id = await getUserId();
  const conta_id = await getContaId();
  const { data, error } = await supabase
    .from('transacoes_recorrentes')
    .insert({ ...r, user_id, conta_id })
    .select('id, tipo, descricao, categoria, valor, dia, inicio, fim')
    .single();
  if (error) throw error;
  return { ...data, valor: Number(data.valor) };
}

export async function updateRecorrente(
  id: number,
  r: Partial<Pick<TransacaoRecorrente, 'descricao' | 'categoria' | 'valor' | 'dia' | 'fim'>>,
): Promise<void> {
  const { error } = await supabase.from('transacoes_recorrentes').update(r).eq('id', id);
  if (error) throw error;
}

export async function removeRecorrente(id: number): Promise<void> {
  const { error } = await supabase.from('transacoes_recorrentes').delete().eq('id', id);
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

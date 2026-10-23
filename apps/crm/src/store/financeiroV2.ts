import { supabase } from './core';

// Financeiro v2 (rentabilidade por cliente). The workspace is resolved by the
// database (RLS + the RPCs), so nothing here passes a conta_id. Types mirror the
// JSON the RPCs return; see the Financeiro v2 phase 1 plan.

export type ModeloAcordo = 'mensal_meta' | 'mensal_limite' | 'por_entrega';
export type MetaPeriodo = 'dia_util' | 'semana' | 'mes';
export type StatusClienteFinanceiro = 'ativo' | 'pausado' | 'encerrado';
export type RegraRateio = 'rateio' | 'exclusivo' | 'entrega';

export interface PeriodoFinanceiro {
  inicio: string;
  fim: string;
  rotulo: string;
  /** 'futuro' only comes from `getPeriodosEditaveis`. For a closed period the
   *  rentabilidade payload still reads 'aberto' (the snapshot is taken in the same
   *  UPDATE that closes it): take closed/reopened state from `getPeriodos`. */
  status: 'aberto' | 'fechado' | 'reaberto' | 'futuro';
  transicao: boolean;
  /** Present on the rentabilidade payload only, absent on `periodos_listar` rows. */
  fator?: number;
}

export interface FuncaoFinanceira {
  id: number;
  nome: string;
  ordem: number;
}

export interface PessoaRentabilidade {
  membro_id: number;
  nome: string;
  funcao_id: number | null;
  regra: RegraRateio;
  /** This client's share of the member's cost. */
  valor: number;
  /** The member's full cost in the period. */
  total: number;
  /** How many clients share it. */
  n_clientes: number;
  /** Only for `entrega`; null = a informar. */
  quantidade: number | null;
  valor_unitario: number | null;
}

export interface ClienteRentabilidade {
  cliente_id: number;
  nome: string;
  status: 'ativo' | 'pausado';
  receita: number;
  custo: number;
  lucro: number;
  /** Fraction (0.528 = 52,8%); null when receita is 0. */
  margem: number | null;
  a_informar: boolean;
  /** Keys are funcao ids as strings. */
  por_funcao: Record<string, number>;
  pessoas: PessoaRentabilidade[];
}

export interface MembroRentabilidade {
  membro_id: number;
  nome: string;
  funcao_id: number | null;
  modelo: ModeloAcordo;
  custo: number;
  n_clientes: number;
  limite_clientes: number | null;
  por_cliente: number | null;
  a_informar: boolean;
}

export interface TotaisRentabilidade {
  receita: number;
  custo_clientes: number;
  custo_sem_cliente: number;
  custo_total: number;
  lucro: number;
  margem: number | null;
  por_funcao: Record<string, number>;
}

export interface RentabilidadeSeeded {
  seeded: true;
  periodo: PeriodoFinanceiro;
  /** In percentage points (55 = 55%). */
  meta_margem: number;
  funcoes: FuncaoFinanceira[];
  clientes: ClienteRentabilidade[];
  membros: MembroRentabilidade[];
  totais: TotaisRentabilidade;
  incompleto: boolean;
}

export type Rentabilidade = RentabilidadeSeeded | { seeded: false };

export interface FinanceiroConfig {
  conta_id?: string;
  periodo_dia: number;
  meta_margem: number;
  seeded_at: string | null;
  updated_at: string | null;
  created_at?: string;
}

/** The `p_acordo` jsonb of `financeiro_acordo_salvar`. */
export interface AcordoInput {
  funcao_id: number | null;
  modelo: ModeloAcordo;
  valor: number;
  unidade: string | null;
  meta_quantidade: number | null;
  meta_periodo: MetaPeriodo | null;
  limite_clientes: number | null;
  dia_pagamento: number | null;
  vigencia_inicio: string | null;
  vigencia_fim: string | null;
  arquivo_path: string | null;
}

export interface AcordoVersao extends AcordoInput {
  id: number;
  membro_id: number;
  vale_desde: string;
  created_by: string | null;
  conta_id?: string;
  created_at?: string;
}

export interface ClienteVersao {
  id: number;
  cliente_id: number;
  vale_desde: string;
  valor_mensal: number;
  dia_pagamento: number | null;
  status: StatusClienteFinanceiro;
  created_by: string | null;
  conta_id?: string;
  created_at?: string;
}

export interface AtribuicaoMudanca {
  membro_id: number;
  cliente_id: number;
  ativo: boolean;
}

export interface EntregaItem {
  cliente_id: number;
  quantidade: number | null;
}

// =============================================
// READS
// =============================================

/** `inicio` omitted = the latest period not closed (else the latest). */
export async function getRentabilidade(inicio?: string): Promise<Rentabilidade> {
  const { data, error } = await supabase.rpc('financeiro_rentabilidade', {
    p_inicio: inicio ?? null,
  });
  if (error) throw error;
  return data as Rentabilidade;
}

export async function getPeriodos(): Promise<PeriodoFinanceiro[]> {
  const { data, error } = await supabase.rpc('financeiro_periodos_listar');
  if (error) throw error;
  return (data ?? []) as PeriodoFinanceiro[];
}

/** Reopened periods, the current one, and the next two projected starts ('futuro'). */
export async function getPeriodosEditaveis(): Promise<PeriodoFinanceiro[]> {
  const { data, error } = await supabase.rpc('financeiro_periodos_editaveis');
  if (error) throw error;
  return (data ?? []) as PeriodoFinanceiro[];
}

export async function getFinanceiroConfig(): Promise<FinanceiroConfig | null> {
  const { data, error } = await supabase.from('financeiro_config').select('*').maybeSingle();
  if (error) throw error;
  return (data as FinanceiroConfig | null) ?? null;
}

export async function getFuncoes(): Promise<FuncaoFinanceira[]> {
  const { data, error } = await supabase
    .from('financeiro_funcoes')
    .select('*')
    .order('ordem', { ascending: true });
  if (error) throw error;
  return (data ?? []) as FuncaoFinanceira[];
}

export async function getAcordoVersoes(membroId: number): Promise<AcordoVersao[]> {
  const { data, error } = await supabase
    .from('financeiro_acordo_versoes')
    .select('*')
    .eq('membro_id', membroId)
    .order('vale_desde', { ascending: false });
  if (error) throw error;
  return (data ?? []) as AcordoVersao[];
}

export async function getClienteVersoes(clienteId: number): Promise<ClienteVersao[]> {
  const { data, error } = await supabase
    .from('financeiro_cliente_versoes')
    .select('*')
    .eq('cliente_id', clienteId)
    .order('vale_desde', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ClienteVersao[];
}

export async function getEntregasManuais(
  inicio: string,
  membroId: number,
): Promise<{ cliente_id: number; quantidade: number }[]> {
  const { data, error } = await supabase
    .from('financeiro_entregas_manuais')
    .select('cliente_id, quantidade')
    .eq('periodo_inicio', inicio)
    .eq('membro_id', membroId);
  if (error) throw error;
  return (data ?? []) as { cliente_id: number; quantidade: number }[];
}

// =============================================
// WRITES
// =============================================

export async function seedFinanceiro(
  periodoDia: number,
): Promise<{ seeded: true; ja_existia: boolean }> {
  const { data, error } = await supabase.rpc('financeiro_seed', { p_periodo_dia: periodoDia });
  if (error) throw error;
  return data as { seeded: true; ja_existia: boolean };
}

export async function salvarConfig(periodoDia: number, metaMargem: number): Promise<void> {
  const { error } = await supabase.rpc('financeiro_config_salvar', {
    p_periodo_dia: periodoDia,
    p_meta_margem: metaMargem,
  });
  if (error) throw error;
}

/** `id` null inserts. Returns the new (or same) funcao id. */
export async function salvarFuncao(
  id: number | null,
  nome: string,
  ordem: number,
): Promise<number> {
  const { data, error } = await supabase.rpc('financeiro_funcao_salvar', {
    p_id: id,
    p_nome: nome,
    p_ordem: ordem,
  });
  if (error) throw error;
  return data as number;
}

export async function excluirFuncao(id: number): Promise<void> {
  const { error } = await supabase.rpc('financeiro_funcao_excluir', { p_id: id });
  if (error) throw error;
}

export async function salvarCliente(
  clienteId: number,
  valeDesde: string,
  valorMensal: number,
  diaPagamento: number | null,
  status: StatusClienteFinanceiro,
): Promise<void> {
  const { error } = await supabase.rpc('financeiro_cliente_salvar', {
    p_cliente_id: clienteId,
    p_vale_desde: valeDesde,
    p_valor_mensal: valorMensal,
    p_dia_pagamento: diaPagamento,
    p_status: status,
  });
  if (error) throw error;
}

export async function salvarAcordo(
  membroId: number,
  valeDesde: string,
  acordo: AcordoInput,
): Promise<void> {
  const { error } = await supabase.rpc('financeiro_acordo_salvar', {
    p_membro_id: membroId,
    p_vale_desde: valeDesde,
    p_acordo: acordo,
  });
  if (error) throw error;
}

export async function salvarAtribuicoes(
  valeDesde: string,
  mudancas: AtribuicaoMudanca[],
): Promise<void> {
  const { error } = await supabase.rpc('financeiro_atribuicoes_salvar', {
    p_vale_desde: valeDesde,
    p_mudancas: mudancas,
  });
  if (error) throw error;
}

/** A `quantidade` of null deletes that client's manual entry. */
export async function salvarEntregas(
  inicio: string,
  membroId: number,
  itens: EntregaItem[],
): Promise<void> {
  const { error } = await supabase.rpc('financeiro_entregas_salvar', {
    p_inicio: inicio,
    p_membro_id: membroId,
    p_itens: itens,
  });
  if (error) throw error;
}

export async function reabrirPeriodo(inicio: string): Promise<void> {
  const { error } = await supabase.rpc('financeiro_periodo_reabrir', { p_inicio: inicio });
  if (error) throw error;
}

export async function fecharPeriodo(inicio: string): Promise<void> {
  const { error } = await supabase.rpc('financeiro_periodo_fechar', { p_inicio: inicio });
  if (error) throw error;
}

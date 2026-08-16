import { supabase, getUserId, getContaId } from './core';
import { applyTemplateToClient } from './hub';

export interface Cliente {
  id?: number;
  user_id?: string;
  nome: string;
  sigla: string;
  cor: string;
  plano: string;
  email: string;
  telefone: string;
  status: 'ativo' | 'pausado' | 'encerrado';
  valor_mensal: number;
  notion_page_url?: string;
  conta_id?: string;
  data_pagamento?: number;
  dia_entrega?: number;
  especialidade?: string;
  data_aniversario?: string | null;
  send_report_email?: boolean;
  include_ai_analysis?: boolean;
}

export interface ClienteEndereco {
  id?: number;
  cliente_id: number;
  conta_id?: string;
  tipo: 'residencial' | 'comercial';
  logradouro: string;
  numero: string;
  complemento?: string;
  bairro: string;
  cidade: string;
  estado: string;
  cep: string;
  created_at?: string;
  updated_at?: string;
}

export interface ClienteData {
  id?: number;
  cliente_id: number;
  conta_id?: string;
  titulo: string;
  data: string;
  created_at?: string;
}

/**
 * Allowlisted columns — must match the GRANT in Migration B exactly.
 *
 * Must stay a single string literal (no `+` concatenation): supabase-js parses
 * the `.select()` argument at the type level to infer the return shape, and a
 * concatenated expression widens to plain `string`, which the parser can't
 * read — it falls back to a `GenericStringError` result type.
 */
const CLIENTE_SAFE_COLUMNS =
  'id, user_id, conta_id, nome, sigla, cor, plano, email, telefone, status, created_at, notion_page_url, data_pagamento, especialidade, data_aniversario, dia_entrega, auto_publish_on_approval, send_report_email, include_ai_analysis';

// Supabase's REST layer applies a project-level max-rows cap (commonly 1000), so
// an unbounded `.select('*')` is silently truncated once a workspace has more
// clientes than that cap — the same trap supabase/functions/data-import/handler.ts
// pages around for import_job_items (see its own PAGE_SIZE comment). getClientes()
// backs the client roster used across the whole app, including the import
// wizard's merge-vs-create decision (ImportarPage.tsx): a truncated list there
// silently turns a merge into a duplicate cliente, and because the read is
// ordered newest-first, the rows that fall off are always the OLDEST clients.
// Paged explicitly rather than trusting the cap, following the same pattern.
const PAGE_SIZE = 500;

export async function getCliente(id: number): Promise<Cliente | null> {
  const { data, error } = await supabase
    .from('clientes_v')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getClientes(): Promise<Cliente[]> {
  const all: Cliente[] = [];
  for (let from = 0; ; ) {
    // Reads go through the masking view; writes stay on the base table.
    //
    // Secondary sort by `id` makes the ordering fully deterministic: range-based
    // (OFFSET/LIMIT) pagination requires a stable sort across separate queries,
    // and `created_at` alone is not guaranteed unique (bulk inserts/imports can
    // share a timestamp), which could otherwise skip or duplicate rows at a page
    // boundary.
    const { data, error } = await supabase
      .from('clientes_v')
      .select('*')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    // Stop only on an EMPTY page, never on `page.length < PAGE_SIZE`. Breaking
    // on a short page would re-introduce a dependency on the server's max-rows
    // setting: if that cap is ever set below PAGE_SIZE, the first page comes
    // back short and the read would stop there, silently truncating again.
    if (page.length === 0) break;
    all.push(...page);
    from += page.length;
  }
  return all;
}

export async function addCliente(
  c: Omit<Cliente, 'id' | 'user_id' | 'conta_id'>,
  // Return type excludes valor_mensal: the RETURNING projection below is
  // narrowed to the allowlist, so the row this resolves with never carries it.
): Promise<Omit<Cliente, 'valor_mensal'>> {
  const user_id = await getUserId();
  const conta_id = await getContaId();
  // RETURNING is narrowed to the allowlist: `.select()` is RETURNING *, which
  // needs SELECT on valor_mensal and would fail for a restricted admin.
  const { data, error } = await supabase
    .from('clientes')
    .insert({ ...c, user_id, conta_id })
    .select(CLIENTE_SAFE_COLUMNS)
    .single();
  if (error) throw error;

  // Auto-seed a briefing from the workspace's default template, if one is set.
  // Best-effort: a failure here must never block client creation.
  try {
    const { data: tpl } = await supabase
      .from('briefing_templates')
      .select('id')
      .eq('conta_id', conta_id)
      .eq('is_default', true)
      .maybeSingle();
    if (tpl?.id && data?.id) {
      await applyTemplateToClient(data.id, conta_id, tpl.id);
    }
  } catch (e) {
    // Browser code — no server-side observability for this.
    console.warn('[addCliente] auto-seed briefing template failed:', e);
  }

  return data;
}

export async function updateCliente(
  id: number,
  c: Partial<Omit<Cliente, 'id' | 'user_id' | 'conta_id'>>,
): Promise<void> {
  const { error } = await supabase
    .from('clientes')
    .update(c)
    .eq('id', id)
    .select(CLIENTE_SAFE_COLUMNS)
    .single();
  if (error) throw error;
}

export async function removeCliente(id: number): Promise<void> {
  const { error } = await supabase.from('clientes').delete().eq('id', id);
  if (error) throw error;
}

// =============================================
// CLIENTE ENDERECOS CRUD
// =============================================

export async function getClienteEnderecos(clienteId: number): Promise<ClienteEndereco[]> {
  const { data, error } = await supabase
    .from('cliente_enderecos')
    .select('*')
    .eq('cliente_id', clienteId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addClienteEndereco(
  e: Omit<ClienteEndereco, 'id' | 'conta_id' | 'created_at' | 'updated_at'>,
): Promise<ClienteEndereco> {
  const conta_id = await getContaId();
  const { data, error } = await supabase
    .from('cliente_enderecos')
    .insert({ ...e, conta_id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateClienteEndereco(
  id: number,
  e: Partial<Omit<ClienteEndereco, 'id' | 'conta_id' | 'created_at' | 'updated_at'>>,
): Promise<ClienteEndereco> {
  const { data, error } = await supabase
    .from('cliente_enderecos')
    .update({ ...e, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function removeClienteEndereco(id: number): Promise<void> {
  const { error } = await supabase.from('cliente_enderecos').delete().eq('id', id);
  if (error) throw error;
}

// =============================================
// CLIENTE DATAS IMPORTANTES CRUD
// =============================================

export async function getClienteDatas(clienteId: number): Promise<ClienteData[]> {
  const { data, error } = await supabase
    .from('cliente_datas')
    .select('*')
    .eq('cliente_id', clienteId)
    .order('data', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function getAllClienteDatas(): Promise<ClienteData[]> {
  const { data, error } = await supabase
    .from('cliente_datas')
    .select('*')
    .order('data', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function addClienteData(
  d: Omit<ClienteData, 'id' | 'conta_id' | 'created_at'>,
): Promise<ClienteData> {
  const conta_id = await getContaId();
  const { data, error } = await supabase
    .from('cliente_datas')
    .insert({ ...d, conta_id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateClienteData(
  id: number,
  d: Partial<Omit<ClienteData, 'id' | 'conta_id' | 'created_at'>>,
): Promise<ClienteData> {
  const { data, error } = await supabase
    .from('cliente_datas')
    .update(d)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function removeClienteData(id: number): Promise<void> {
  const { error } = await supabase.from('cliente_datas').delete().eq('id', id);
  if (error) throw error;
}

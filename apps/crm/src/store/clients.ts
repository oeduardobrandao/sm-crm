import { supabase, getUserId, getContaId } from './core';

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

export async function getClientes(): Promise<Cliente[]> {
  const { data, error } = await supabase
    .from('clientes')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addCliente(c: Omit<Cliente, 'id' | 'user_id' | 'conta_id'>): Promise<Cliente> {
  const user_id = await getUserId();
  const conta_id = await getContaId();
  const { data, error } = await supabase
    .from('clientes')
    .insert({ ...c, user_id, conta_id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateCliente(id: number, c: Partial<Omit<Cliente, 'id' | 'user_id' | 'conta_id'>>): Promise<Cliente> {
  const { data, error } = await supabase
    .from('clientes')
    .update(c)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
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

export async function addClienteEndereco(e: Omit<ClienteEndereco, 'id' | 'conta_id' | 'created_at' | 'updated_at'>): Promise<ClienteEndereco> {
  const conta_id = await getContaId();
  const { data, error } = await supabase
    .from('cliente_enderecos')
    .insert({ ...e, conta_id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateClienteEndereco(id: number, e: Partial<Omit<ClienteEndereco, 'id' | 'conta_id' | 'created_at' | 'updated_at'>>): Promise<ClienteEndereco> {
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

export async function addClienteData(d: Omit<ClienteData, 'id' | 'conta_id' | 'created_at'>): Promise<ClienteData> {
  const conta_id = await getContaId();
  const { data, error } = await supabase
    .from('cliente_datas')
    .insert({ ...d, conta_id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateClienteData(id: number, d: Partial<Omit<ClienteData, 'id' | 'conta_id' | 'created_at'>>): Promise<ClienteData> {
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

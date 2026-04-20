// =============================================
// Mesaas - Data Store (Supabase Persistence)
// =============================================
import { supabase, getCurrentUser, getCurrentProfile, clearProfileCache } from './lib/supabase';

// ---- Types ----
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
}

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
}

export interface IntegracaoStatus {
  id?: number;
  user_id?: string;
  integracao_id: string;
  status: 'conectado' | 'desconectado' | 'em_breve';
  conta_id?: string;
}

export let currentUserRole: 'owner' | 'admin' | 'agent' = 'agent';

export async function initStoreRole() {
  try {
    const profile = await getCurrentProfile();
    if (profile) {
      currentUserRole = profile.role || 'agent';
    } else {
      currentUserRole = 'agent';
    }
  } catch (e) {
    console.error('[store] initStoreRole failed, defaulting to agent:', e);
    currentUserRole = 'agent';
  }
}

// ---- Helpers ----
export function formatBRL(val: number): string {
  if (currentUserRole === 'agent') return 'R$ •••••';
  return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatDate(d: string): string {
  return new Date(d + 'T00:00:00').toLocaleDateString('pt-BR');
}

export function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
}

async function getUserId(): Promise<string> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Não autenticado');
  return user.id;
}

async function getContaId(): Promise<string> {
  const profile = await getCurrentProfile();
  if (!profile || !profile.conta_id) throw new Error('Conta não encontrada ou usuário não autenticado');
  return profile.conta_id;
}

// =============================================
// CLIENTES CRUD
// =============================================
export async function getWorkspaceUsers(): Promise<any[]> {
  const conta_id = await getContaId();
  const { data, error } = await supabase
    .from('workspace_members')
    .select('user_id, role, joined_at, profiles!inner(id, nome, avatar_url, created_at)')
    .eq('workspace_id', conta_id)
    .order('joined_at', { ascending: true });
  if (error) throw error;
  // Flatten the join result to match the expected shape
  return (data || []).map((m: any) => ({
    id: m.profiles.id,
    nome: m.profiles.nome,
    role: m.role,
    avatar_url: m.profiles.avatar_url,
    created_at: m.profiles.created_at,
  }));
}

export async function getMyWorkspaces(): Promise<any[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('workspace_members')
    .select('workspace_id, role, workspaces!inner(id, name, logo_url)')
    .eq('user_id', user.id);
  if (error) throw error;
  return (data || []).map((m: any) => ({
    id: m.workspaces.id,
    name: m.workspaces.name,
    logo_url: m.workspaces.logo_url,
    role: m.role,
  }));
}

export async function getCurrentWorkspace(): Promise<{ id: string; name: string; logo_url: string | null } | null> {
  const profile = await getCurrentProfile();
  if (!profile?.conta_id) return null;
  const { data, error } = await supabase
    .from('workspaces')
    .select('id, name, logo_url')
    .eq('id', profile.conta_id)
    .single();
  if (error) return null;
  return data;
}

export async function updateWorkspace(workspaceId: string, updates: { name?: string; logo_url?: string | null }): Promise<void> {
  const { error } = await supabase
    .from('workspaces')
    .update(updates)
    .eq('id', workspaceId);
  if (error) throw error;
}

export async function switchWorkspace(workspaceId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Não autenticado');
  const { error } = await supabase
    .from('profiles')
    .update({ active_workspace_id: workspaceId, conta_id: workspaceId })
    .eq('id', user.id);
  if (error) throw error;
  // Clear cached profile so next call fetches fresh data
  clearProfileCache();
}

async function callManageWorkspaceUser(action: string, targetUserId: string, extra?: Record<string, unknown>): Promise<void> {
  const session = (await supabase.auth.getSession()).data.session;
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-workspace-user`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session?.access_token}`,
    },
    body: JSON.stringify({ action, targetUserId, ...extra }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || result.message || `Erro HTTP ${response.status}`);
}

export async function updateWorkspaceUserRole(userId: string, role: string): Promise<void> {
  await callManageWorkspaceUser('update-role', userId, { role });
}

export async function removeWorkspaceUser(userId: string): Promise<void> {
  await callManageWorkspaceUser('remove', userId);
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
// CLIENTE ENDEREÇOS CRUD
// =============================================
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
export interface ClienteData {
  id?: number;
  cliente_id: number;
  conta_id?: string;
  titulo: string;
  data: string;
  created_at?: string;
}

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

// =============================================
// TRANSAÇÕES CRUD
// =============================================
export async function getTransacoes(): Promise<Transacao[]> {
  const { data, error } = await supabase
    .from('transacoes')
    .select('*')
    .order('data', { ascending: false });
  if (error) throw error;
  
  // Retrocompatibilidade: Se status for undefined/null no banco, vira 'pago' localmente para não quebrar fluxos antigos.
  return (data || []).map(t => ({...t, status: t.status || 'pago'}));
}

export async function addTransacao(t: Omit<Transacao, 'id' | 'user_id' | 'conta_id'>): Promise<Transacao> {
  const user_id = await getUserId();
  const conta_id = await getContaId();
  const payload = { 
    ...t, 
    user_id, 
    conta_id,
    status: t.status || 'pago',
    referencia_agendamento: t.referencia_agendamento || null
  };
  const { data, error } = await supabase
    .from('transacoes')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateTransacao(id: number, t: Partial<Omit<Transacao, 'id' | 'user_id' | 'conta_id'>>): Promise<Transacao> {
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

export async function addContrato(c: Omit<Contrato, 'id' | 'user_id' | 'conta_id'>): Promise<Contrato> {
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

export async function updateContrato(id: number, c: Partial<Omit<Contrato, 'id' | 'user_id' | 'conta_id'>>): Promise<Contrato> {
  const { data, error } = await supabase
    .from('contratos')
    .update(c)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function removeContrato(id: number): Promise<void> {
  const { error } = await supabase.from('contratos').delete().eq('id', id);
  if (error) throw error;
}

// =============================================
// MEMBROS CRUD
// =============================================
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

// =============================================
// INTEGRAÇÕES STATUS
// =============================================
const DEFAULT_INTEGRATIONS = [
  { integracao_id: 'meta_ads', label: 'Meta Ads', icon: 'fa-brands fa-meta', desc: 'Facebook & Instagram Ads' },
  { integracao_id: 'asaas', label: 'Asaas', icon: 'fa-solid fa-file-invoice-dollar', desc: 'Cobranças e Boletos' },
  { integracao_id: 'whatsapp', label: 'WhatsApp Business', icon: 'fa-brands fa-whatsapp', desc: 'Mensagens e Notificações' },
  { integracao_id: 'google_analytics', label: 'Google Analytics', icon: 'fa-brands fa-google', desc: 'Métricas e Relatórios' },
  { integracao_id: 'canva', label: 'Canva', icon: 'fa-solid fa-palette', desc: 'Design e Criativos' },
  { integracao_id: 'notion', label: 'Notion', icon: 'fa-solid fa-book', desc: 'Documentos e Planejamento' },
];

export function getIntegrationsMeta() {
  return DEFAULT_INTEGRATIONS;
}

export async function getIntegracoesStatus(): Promise<IntegracaoStatus[]> {
  const { data, error } = await supabase
    .from('integracoes_status')
    .select('*');
  if (error) throw error;
  return data || [];
}

export async function toggleIntegracao(integracao_id: string, newStatus: 'conectado' | 'desconectado'): Promise<void> {
  const user_id = await getUserId();
  const conta_id = await getContaId();
  const { error } = await supabase
    .from('integracoes_status')
    .upsert({ user_id, conta_id, integracao_id, status: newStatus }, { onConflict: 'user_id,integracao_id' });
  if (error) throw error;
}

// =============================================
// COMPUTED HELPERS (for Dashboard)
// =============================================
/** Projects virtual scheduled transactions for the current month from clientes/membros */
export function projetarAgendamentos(transacoesFisicas: Transacao[], clientes: Cliente[], membros: Membro[]): Transacao[] {
  const transacoes = [...transacoesFisicas];
  const now = new Date();
  const mes = String(now.getMonth() + 1).padStart(2, '0');
  const ano = now.getFullYear();

  const addAgendamento = (idRef: string, dia: number, valor: number, desc: string, tipo: 'entrada' | 'saida') => {
    if (!transacoesFisicas.some(t => t.referencia_agendamento === idRef)) {
      transacoes.push({
        id: Date.now() + Math.random(),
        tipo, valor, descricao: desc,
        detalhe: 'Agendamento automático',
        categoria: 'Agendamento',
        data: `${ano}-${mes}-${String(dia).padStart(2, '0')}`,
        status: 'agendado',
        referencia_agendamento: idRef,
      } as Transacao);
    }
  };

  clientes.filter(c => c.status === 'ativo' && c.data_pagamento).forEach(c => {
    addAgendamento(`cliente_${c.id}_${ano}_${mes}`, c.data_pagamento!, Number(c.valor_mensal), c.nome, 'entrada');
  });

  membros.filter(m => m.data_pagamento).forEach(m => {
    addAgendamento(`membro_${m.id}_${ano}_${mes}`, m.data_pagamento!, Number(m.custo_mensal), m.nome, 'saida');
  });

  return transacoes;
}

export async function getDashboardStats() {
  const [clientes, transacoesFisicas, membros] = await Promise.all([getClientes(), getTransacoes(), getMembros()]);

  const now = new Date();
  const mesAtual = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const transacoes = projetarAgendamentos(transacoesFisicas, clientes, membros);
  const transacoesMes = transacoes.filter(t => t.data.startsWith(mesAtual));

  const clientesAtivos = clientes.filter(c => c.status === 'ativo');
  const receitaMensal = clientesAtivos.reduce((sum, c) => sum + Number(c.valor_mensal), 0);
  const despesas = transacoesMes.filter(t => t.tipo === 'saida');
  const despesaTotal = despesas.reduce((sum, t) => sum + Number(t.valor), 0);

  return {
    clientes,
    clientesAtivos,
    receitaMensal,
    despesaTotal,
    saldo: receitaMensal - despesaTotal,
    transacoes: transacoesMes,
  };
}

// =============================================
// LEADS CRUD
// =============================================
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

export async function addLead(l: Omit<Lead, 'id' | 'user_id' | 'conta_id' | 'created_at'>): Promise<Lead> {
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

export async function updateLead(id: number, l: Partial<Omit<Lead, 'id' | 'user_id' | 'conta_id' | 'created_at'>>): Promise<Lead> {
  const { data, error } = await supabase
    .from('leads')
    .update(l)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function removeLead(id: number): Promise<void> {
  const { error } = await supabase.from('leads').delete().eq('id', id);
  if (error) throw error;
}

// =============================================
// WORKFLOW TEMPLATES
// =============================================
export interface WorkflowTemplateEtapa {
  nome: string;
  prazo_dias: number;
  tipo_prazo: 'uteis' | 'corridos';
  responsavel_id?: number | null;
  tipo?: 'padrao' | 'aprovacao_cliente';
}

export interface WorkflowTemplate {
  id?: number;
  conta_id?: string;
  user_id?: string;
  nome: string;
  etapas: WorkflowTemplateEtapa[];
  modo_prazo?: 'padrao' | 'data_fixa' | 'data_entrega';
  created_at?: string;
}

export async function getWorkflowTemplates(): Promise<WorkflowTemplate[]> {
  const { data, error } = await supabase
    .from('workflow_templates')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addWorkflowTemplate(t: Omit<WorkflowTemplate, 'id' | 'user_id' | 'conta_id' | 'created_at'>): Promise<WorkflowTemplate> {
  const user_id = await getUserId();
  const conta_id = await getContaId();
  const { data, error } = await supabase
    .from('workflow_templates')
    .insert({ ...t, user_id, conta_id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateWorkflowTemplate(id: number, t: Partial<Omit<WorkflowTemplate, 'id' | 'user_id' | 'conta_id'>>): Promise<WorkflowTemplate> {
  const { data, error } = await supabase
    .from('workflow_templates')
    .update(t)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function removeWorkflowTemplate(id: number): Promise<void> {
  const { error } = await supabase.from('workflow_templates').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Propagate template step changes (nome, prazo_dias, tipo_prazo, responsavel_id, tipo)
 * to all `pendente` workflow_etapas belonging to active workflows that use this template.
 * Steps that are already `ativo` or `concluido` are left untouched.
 */
export async function propagateTemplateToWorkflows(templateId: number, etapas: WorkflowTemplateEtapa[]): Promise<void> {
  // Find all active workflows using this template
  const { data: workflows, error: wfErr } = await supabase
    .from('workflows')
    .select('id')
    .eq('template_id', templateId)
    .eq('status', 'ativo');
  if (wfErr) throw wfErr;
  if (!workflows || workflows.length === 0) return;

  for (const wf of workflows) {
    const { data: wfEtapas, error: etErr } = await supabase
      .from('workflow_etapas')
      .select('*')
      .eq('workflow_id', wf.id)
      .order('ordem', { ascending: true });
    if (etErr) throw etErr;
    if (!wfEtapas) continue;

    for (const wfEtapa of wfEtapas) {
      if (wfEtapa.status !== 'pendente') continue;
      const tplEtapa = etapas[wfEtapa.ordem];
      if (!tplEtapa) continue;
      await supabase
        .from('workflow_etapas')
        .update({
          nome: tplEtapa.nome,
          prazo_dias: tplEtapa.prazo_dias,
          tipo_prazo: tplEtapa.tipo_prazo,
          responsavel_id: tplEtapa.responsavel_id ?? null,
          tipo: tplEtapa.tipo ?? 'padrao',
        })
        .eq('id', wfEtapa.id);
    }
  }
}

// =============================================
// WORKFLOWS
// =============================================
export interface Workflow {
  id?: number;
  conta_id?: string;
  user_id?: string;
  cliente_id: number;
  titulo: string;
  template_id?: number | null;
  status: 'ativo' | 'concluido' | 'arquivado';
  etapa_atual: number;
  recorrente: boolean;
  modo_prazo?: 'padrao' | 'data_fixa' | 'data_entrega';
  link_notion?: string | null;
  link_drive?: string | null;
  position?: number;
  created_at?: string;
}

export async function getWorkflows(): Promise<Workflow[]> {
  const { data, error } = await supabase
    .from('workflows')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getWorkflowsByCliente(clienteId: number): Promise<Workflow[]> {
  const { data, error } = await supabase
    .from('workflows')
    .select('*')
    .eq('cliente_id', clienteId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getConcludedWorkflows(): Promise<Workflow[]> {
  const { data, error } = await supabase
    .from('workflows')
    .select('*')
    .eq('status', 'concluido')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getConcludedWorkflowsByCliente(clienteId: number): Promise<Workflow[]> {
  const { data, error } = await supabase
    .from('workflows')
    .select('*')
    .eq('cliente_id', clienteId)
    .eq('status', 'concluido')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function addWorkflow(w: Omit<Workflow, 'id' | 'user_id' | 'conta_id' | 'created_at'>): Promise<Workflow> {
  const user_id = await getUserId();
  const conta_id = await getContaId();
  const { data, error } = await supabase
    .from('workflows')
    .insert({ ...w, user_id, conta_id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateWorkflow(id: number, w: Partial<Omit<Workflow, 'id' | 'user_id' | 'conta_id'>>): Promise<Workflow> {
  const { data, error } = await supabase
    .from('workflows')
    .update(w)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateWorkflowPositions(updates: { id: number; position: number }[]): Promise<void> {
  await Promise.all(
    updates.map(({ id, position }) =>
      supabase.from('workflows').update({ position }).eq('id', id).then(({ error }) => {
        if (error) throw error;
      })
    )
  );
}

export async function removeWorkflow(id: number): Promise<void> {
  const { error } = await supabase.from('workflows').delete().eq('id', id);
  if (error) throw error;
}

// =============================================
// WORKFLOW ETAPAS (STEPS)
// =============================================
export interface WorkflowEtapa {
  id?: number;
  workflow_id: number;
  ordem: number;
  nome: string;
  prazo_dias: number;
  tipo_prazo: 'uteis' | 'corridos';
  responsavel_id?: number | null;
  tipo?: 'padrao' | 'aprovacao_cliente';
  status: 'pendente' | 'ativo' | 'concluido';
  iniciado_em?: string | null;
  concluido_em?: string | null;
  data_limite?: string | null;
}

export async function getWorkflowEtapas(workflowId: number): Promise<WorkflowEtapa[]> {
  const { data, error } = await supabase
    .from('workflow_etapas')
    .select('*')
    .eq('workflow_id', workflowId)
    .order('ordem', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function getAllActiveEtapas(): Promise<(WorkflowEtapa & { workflow_titulo?: string; cliente_nome?: string; cliente_id?: number })[]> {
  const { data, error } = await supabase
    .from('workflow_etapas')
    .select('*, workflows!inner(titulo, cliente_id, status, clientes!inner(nome))')
    .eq('workflows.status', 'ativo')
    .order('ordem', { ascending: true });
  if (error) throw error;
  return (data || []).map((row: any) => ({
    ...row,
    workflow_titulo: row.workflows?.titulo,
    cliente_id: row.workflows?.cliente_id,
    cliente_nome: row.workflows?.clientes?.nome,
    workflows: undefined,
  }));
}

export async function getAllEtapasWithWorkflow(): Promise<(WorkflowEtapa & {
  workflow_titulo?: string;
  workflow_status?: string;
  workflow_created_at?: string;
  template_id?: number | null;
  cliente_id?: number;
  cliente_nome?: string;
})[]> {
  const { data, error } = await supabase
    .from('workflow_etapas')
    .select('*, workflows!inner(titulo, status, created_at, template_id, cliente_id, clientes!inner(nome))')
    .order('ordem', { ascending: true });
  if (error) throw error;
  return (data || []).map((row: any) => ({
    ...row,
    workflow_titulo: row.workflows?.titulo,
    workflow_status: row.workflows?.status,
    workflow_created_at: row.workflows?.created_at,
    template_id: row.workflows?.template_id,
    cliente_id: row.workflows?.cliente_id,
    cliente_nome: row.workflows?.clientes?.nome,
    workflows: undefined,
  }));
}

export async function addWorkflowEtapa(e: Omit<WorkflowEtapa, 'id'>): Promise<WorkflowEtapa> {
  const { data, error } = await supabase
    .from('workflow_etapas')
    .insert(e)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateWorkflowEtapa(id: number, e: Partial<Omit<WorkflowEtapa, 'id'>>): Promise<WorkflowEtapa> {
  const { data, error } = await supabase
    .from('workflow_etapas')
    .update(e)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Complete a step: marks it done, activates the next step, and advances the workflow pointer. */
export async function completeEtapa(workflowId: number, etapaId: number): Promise<{ workflow: Workflow; etapas: WorkflowEtapa[] }> {
  const now = new Date().toISOString();

  // Mark current step as done
  await updateWorkflowEtapa(etapaId, { status: 'concluido', concluido_em: now });

  // Get all steps to find the next one
  const etapas = await getWorkflowEtapas(workflowId);
  const currentIdx = etapas.findIndex(e => e.id === etapaId);
  const nextIdx = currentIdx + 1;

  let workflow: Workflow;

  if (nextIdx < etapas.length) {
    // Activate next step
    await updateWorkflowEtapa(etapas[nextIdx].id!, { status: 'ativo', iniciado_em: now });
    workflow = await updateWorkflow(workflowId, { etapa_atual: nextIdx });
  } else {
    // All steps done — mark workflow as complete
    workflow = await updateWorkflow(workflowId, { status: 'concluido', etapa_atual: currentIdx });
  }

  const updatedEtapas = await getWorkflowEtapas(workflowId);
  return { workflow, etapas: updatedEtapas };
}

/** Revert a workflow to its previous step (move card one column back). */
export async function revertEtapa(workflowId: number): Promise<{ workflow: Workflow; etapas: WorkflowEtapa[] }> {
  const etapas = await getWorkflowEtapas(workflowId);
  const activeIdx = etapas.findIndex(e => e.status === 'ativo');
  if (activeIdx <= 0) throw new Error('Não é possível voltar — já está na primeira etapa.');

  const now = new Date().toISOString();
  const currentEtapa = etapas[activeIdx];
  const prevEtapa = etapas[activeIdx - 1];

  // Deactivate current step → pendente
  await updateWorkflowEtapa(currentEtapa.id!, { status: 'pendente', iniciado_em: null });

  // Re-activate previous step
  await updateWorkflowEtapa(prevEtapa.id!, { status: 'ativo', concluido_em: null, iniciado_em: now });

  // Update workflow pointer
  const workflow = await updateWorkflow(workflowId, { etapa_atual: activeIdx - 1 });
  const updatedEtapas = await getWorkflowEtapas(workflowId);
  return { workflow, etapas: updatedEtapas };
}

/** Clone a workflow for recurrence (creates a fresh copy with all steps reset). */
export async function duplicateWorkflow(workflowId: number): Promise<Workflow> {
  const [workflow, etapas] = await Promise.all([
    supabase.from('workflows').select('*').eq('id', workflowId).single().then(r => { if (r.error) throw r.error; return r.data as Workflow; }),
    getWorkflowEtapas(workflowId),
  ]);

  const now = new Date().toISOString();
  const modoPrazo = workflow.modo_prazo || 'padrao';

  // For data_entrega mode: recalculate delivery deadlines for the next cycle
  // Fetch cliente to get dia_entrega, then compute new deadlines
  let nextDeliveryDeadlines: Map<number, string> | null = null;
  if (modoPrazo === 'data_entrega') {
    const { data: clienteRow } = await supabase
      .from('clientes')
      .select('dia_entrega')
      .eq('id', workflow.cliente_id)
      .single();
    const diaEntrega = clienteRow?.dia_entrega as number | undefined;
    if (diaEntrega) {
      // Find anchor (aprovacao_cliente) step and compute from next month's delivery date
      const anchorEtapa = etapas.find(e => e.tipo === 'aprovacao_cliente');
      if (anchorEtapa) {
        // Next delivery date: advance one cycle from today
        const today = new Date();
        let nextMonth = today.getMonth() + 2; // +1 for next month, +1 for 1-based
        let nextYear = today.getFullYear();
        if (nextMonth > 12) { nextMonth = 1; nextYear++; }
        const daysInNextMonth = new Date(nextYear, nextMonth, 0).getDate();
        const deliveryDay = Math.min(diaEntrega, daysInNextMonth);
        const deliveryDate = new Date(nextYear, nextMonth - 1, deliveryDay);
        nextDeliveryDeadlines = _computeDeliveryDeadlines(etapas, deliveryDate);
      }
    }
  }

  const newWorkflow = await addWorkflow({
    cliente_id: workflow.cliente_id,
    titulo: workflow.titulo,
    template_id: workflow.template_id || null,
    status: 'ativo',
    etapa_atual: 0,
    recorrente: workflow.recorrente,
    modo_prazo: modoPrazo,
  });

  try {
    for (let i = 0; i < etapas.length; i++) {
      const etapa = etapas[i];
      // Determine data_limite for the new workflow's steps
      let dataLimite: string | null = null;
      if (modoPrazo === 'data_entrega' && nextDeliveryDeadlines) {
        dataLimite = nextDeliveryDeadlines.get(etapa.ordem) || null;
      }
      // data_fixa: clear dates (user sets new dates manually)
      // padrao: no data_limite
      await addWorkflowEtapa({
        workflow_id: newWorkflow.id!,
        ordem: i,
        nome: etapa.nome,
        prazo_dias: etapa.prazo_dias,
        tipo_prazo: etapa.tipo_prazo,
        responsavel_id: etapa.responsavel_id || null,
        tipo: etapa.tipo,
        status: i === 0 ? 'ativo' : 'pendente',
        iniciado_em: i === 0 ? now : null,
        concluido_em: null,
        data_limite: dataLimite,
      });
    }
  } catch (err) {
    // Clean up orphaned workflow if etapa inserts failed
    try { await removeWorkflow(newWorkflow.id!); } catch { /* best effort */ }
    throw err;
  }

  return newWorkflow;
}

/**
 * Internal helper: compute data_limite for each step given a delivery date.
 * Exported as computeDeliveryDeadlines from useEntregasData.ts for UI use.
 * The anchor (aprovacao_cliente) step gets the delivery date.
 * Steps before anchor: walk backward subtracting prazo_dias.
 * Steps after anchor: walk forward adding prazo_dias.
 * Returns Map<ordem, ISO date string>.
 */
function _computeDeliveryDeadlines(etapas: WorkflowEtapa[], deliveryDate: Date): Map<number, string> {
  const sorted = [...etapas].sort((a, b) => a.ordem - b.ordem);
  const anchorIdx = sorted.findIndex(e => e.tipo === 'aprovacao_cliente');
  if (anchorIdx === -1) return new Map();

  const result = new Map<number, string>();
  const toISO = (d: Date) => d.toISOString().split('T')[0];

  // Anchor step gets delivery date
  result.set(sorted[anchorIdx].ordem, toISO(deliveryDate));

  // Walk backward from anchor
  let cursor = new Date(deliveryDate);
  for (let i = anchorIdx - 1; i >= 0; i--) {
    cursor = _subtractDays(cursor, sorted[i].prazo_dias, sorted[i].tipo_prazo);
    result.set(sorted[i].ordem, toISO(cursor));
  }

  // Walk forward from anchor
  cursor = new Date(deliveryDate);
  for (let i = anchorIdx + 1; i < sorted.length; i++) {
    cursor = _addDays(cursor, sorted[i].prazo_dias, sorted[i].tipo_prazo);
    result.set(sorted[i].ordem, toISO(cursor));
  }

  return result;
}

function _subtractDays(from: Date, days: number, tipoPrazo: 'corridos' | 'uteis'): Date {
  const result = new Date(from);
  if (tipoPrazo === 'corridos') {
    result.setDate(result.getDate() - days);
    return result;
  }
  let remaining = days;
  while (remaining > 0) {
    result.setDate(result.getDate() - 1);
    const dow = result.getDay();
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return result;
}

function _addDays(from: Date, days: number, tipoPrazo: 'corridos' | 'uteis'): Date {
  const result = new Date(from);
  if (tipoPrazo === 'corridos') {
    result.setDate(result.getDate() + days);
    return result;
  }
  let remaining = days;
  while (remaining > 0) {
    result.setDate(result.getDate() + 1);
    const dow = result.getDay();
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return result;
}

// =============================================
// PORTAL TOKENS (Client-facing sharing)
// =============================================
export async function createPortalToken(workflowId: number): Promise<string> {
  const conta_id = await getContaId();
  // Check if token already exists
  const { data: existing } = await supabase
    .from('portal_tokens')
    .select('token')
    .eq('workflow_id', workflowId)
    .maybeSingle();
  if (existing) return existing.token;
  // Create new token
  const { data, error } = await supabase
    .from('portal_tokens')
    .insert({ workflow_id: workflowId, conta_id })
    .select('token')
    .single();
  if (error) throw error;
  return data.token;
}

export async function getPortalToken(workflowId: number): Promise<string | null> {
  const { data } = await supabase
    .from('portal_tokens')
    .select('token')
    .eq('workflow_id', workflowId)
    .maybeSingle();
  return data?.token || null;
}

export interface PortalApproval {
  id: number;
  workflow_etapa_id: number;
  action: 'aprovado' | 'correcao' | 'mensagem';
  comentario: string | null;
  created_at: string;
  is_workspace_user?: boolean;
}

export async function getPortalApprovals(etapaIds: number[]): Promise<PortalApproval[]> {
  if (etapaIds.length === 0) return [];
  const { data, error } = await supabase
    .from('portal_approvals')
    .select('id, workflow_etapa_id, action, comentario, created_at, is_workspace_user')
    .in('workflow_etapa_id', etapaIds)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function replyToPortalApproval(workflowId: number, etapaId: number, comentario: string): Promise<void> {
  const token = await getPortalToken(workflowId);
  if (!token) throw new Error("Workflow must be shared before replying.");

  const { error } = await supabase.from('portal_approvals').insert({
    workflow_etapa_id: etapaId,
    token,
    action: 'mensagem',
    comentario,
    is_workspace_user: true
  });
  if (error) throw error;
}

// =============================================
// WORKFLOW POSTS (Sub-tasks / Content pieces)
// =============================================
export interface WorkflowPost {
  id?: number;
  workflow_id: number;
  conta_id?: string; // uuid stored as string in JS
  titulo: string;
  conteudo: Record<string, unknown> | null;
  conteudo_plain: string;
  tipo: 'feed' | 'reels' | 'stories' | 'carrossel';
  ordem: number;
  status:
    | 'rascunho'
    | 'revisao_interna'
    | 'aprovado_interno'
    | 'enviado_cliente'
    | 'aprovado_cliente'
    | 'correcao_cliente'
    | 'agendado'
    | 'postado';
  responsavel_id?: number | null;
  scheduled_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface PostMedia {
  id: number;
  post_id: number;
  conta_id: string;
  r2_key: string;
  thumbnail_r2_key: string | null;
  kind: 'image' | 'video';
  mime_type: string;
  size_bytes: number;
  original_filename: string;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  is_cover: boolean;
  sort_order: number;
  uploaded_by: string | null;
  created_at: string;
  // Populated only on hydrated responses
  url?: string;
  thumbnail_url?: string | null;
}

export interface PostApproval {
  id: number;
  post_id: number;
  token: string;
  action: 'aprovado' | 'correcao' | 'mensagem';
  comentario: string | null;
  is_workspace_user: boolean;
  created_at: string;
}

// =============================================
// CUSTOM PROPERTIES
// =============================================

export type PropertyType =
  | 'text' | 'number' | 'select' | 'multiselect' | 'status'
  | 'date' | 'person' | 'checkbox' | 'url' | 'email' | 'phone' | 'created_time';

export interface SelectOption {
  id: string;      // stable uuid string
  label: string;
  color: string;   // hex color e.g. '#E1306C'
}

export interface TemplatePropertyDefinition {
  id?: number;
  template_id: number;
  conta_id?: string;
  name: string;
  type: PropertyType;
  config: Record<string, unknown>; // shape varies by type — see spec
  portal_visible: boolean;
  display_order: number;
  created_at?: string;
}

export interface PostPropertyValue {
  id?: number;
  post_id: number;
  property_definition_id: number;
  value: unknown;
  definition: TemplatePropertyDefinition;
}

export interface WorkflowSelectOption {
  id?: number;
  workflow_id: number;
  property_definition_id: number;
  conta_id?: string;
  option_id: string;   // uuid string
  label: string;
  color: string;
  created_at?: string;
}

export async function getPropertyDefinitions(templateId: number): Promise<TemplatePropertyDefinition[]> {
  const { data, error } = await supabase
    .from('template_property_definitions')
    .select('*')
    .eq('template_id', templateId)
    .order('display_order', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function getWorkflowPosts(workflowId: number): Promise<WorkflowPost[]> {
  const { data, error } = await supabase
    .from('workflow_posts')
    .select('*')
    .eq('workflow_id', workflowId)
    .order('ordem', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function getWorkflowPostsWithProperties(workflowId: number): Promise<(WorkflowPost & { property_values: PostPropertyValue[] })[]> {
  const { data, error } = await supabase
    .from('workflow_posts')
    .select(`
      *,
      post_property_values (
        id,
        property_definition_id,
        value,
        template_property_definitions (
          id, template_id, conta_id, name, type, config, portal_visible, display_order, created_at
        )
      )
    `)
    .eq('workflow_id', workflowId)
    .order('ordem', { ascending: true });
  if (error) throw error;
  return (data || []).map((post: any) => {
    const { post_property_values: rawPvs, ...rest } = post;
    return {
      ...rest,
      property_values: (rawPvs || []).map((pv: any) => ({
        id: pv.id,
        post_id: post.id,
        property_definition_id: pv.property_definition_id,
        value: pv.value,
        definition: pv.template_property_definitions,
      })),
    };
  });
}

export async function getWorkflowPostsCounts(
  workflowIds: number[]
): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  if (workflowIds.length === 0) return counts;
  const { data, error } = await supabase
    .from('workflow_posts')
    .select('workflow_id')
    .in('workflow_id', workflowIds);
  if (error) throw error;
  for (const row of (data ?? []) as { workflow_id: number }[]) {
    counts.set(row.workflow_id, (counts.get(row.workflow_id) ?? 0) + 1);
  }
  return counts;
}

export async function addWorkflowPost(
  p: Omit<WorkflowPost, 'id' | 'conta_id' | 'created_at' | 'updated_at'>
): Promise<WorkflowPost> {
  const conta_id = await getContaId();
  const { data, error } = await supabase
    .from('workflow_posts')
    .insert({ ...p, conta_id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateWorkflowPost(
  id: number,
  p: Partial<Omit<WorkflowPost, 'id' | 'conta_id' | 'workflow_id' | 'created_at' | 'updated_at'>>
): Promise<WorkflowPost> {
  const { data, error } = await supabase
    .from('workflow_posts')
    .update(p)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function removeWorkflowPost(id: number): Promise<void> {
  const { error } = await supabase.from('workflow_posts').delete().eq('id', id);
  if (error) throw error;
}

export async function reorderWorkflowPosts(updates: { id: number; ordem: number }[]): Promise<void> {
  await Promise.all(
    updates.map(({ id, ordem }) =>
      supabase.from('workflow_posts').update({ ordem }).eq('id', id).then(({ error }) => {
        if (error) throw error;
      })
    )
  );
}

export async function createPropertyDefinition(
  templateId: number,
  payload: Omit<TemplatePropertyDefinition, 'id' | 'template_id' | 'conta_id' | 'created_at'>
): Promise<TemplatePropertyDefinition> {
  const conta_id = await getContaId();
  const { data, error } = await supabase
    .from('template_property_definitions')
    .insert({ ...payload, template_id: templateId, conta_id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updatePropertyDefinition(
  id: number,
  payload: Partial<Omit<TemplatePropertyDefinition, 'id' | 'template_id' | 'conta_id' | 'created_at'>>
): Promise<TemplatePropertyDefinition> {
  const conta_id = await getContaId();
  const { data, error } = await supabase
    .from('template_property_definitions')
    .update(payload)
    .eq('id', id)
    .eq('conta_id', conta_id)
    .select()
    .single();
  if (error) throw error;
  if (!data) throw new Error('Property definition not found');
  return data;
}

export async function deletePropertyDefinition(id: number): Promise<void> {
  const conta_id = await getContaId();
  const { error } = await supabase
    .from('template_property_definitions')
    .delete()
    .eq('id', id)
    .eq('conta_id', conta_id);
  if (error) throw error;
}

export async function upsertPostPropertyValue(
  postId: number,
  definitionId: number,
  value: unknown
): Promise<void> {
  const { error } = await supabase
    .from('post_property_values')
    .upsert(
      { post_id: postId, property_definition_id: definitionId, value, updated_at: new Date().toISOString() },
      { onConflict: 'post_id,property_definition_id' }
    );
  if (error) throw error;
}

export async function createWorkflowSelectOption(
  workflowId: number,
  definitionId: number,
  label: string,
  color: string
): Promise<WorkflowSelectOption> {
  const conta_id = await getContaId();
  const { data, error } = await supabase
    .from('workflow_select_options')
    .insert({ workflow_id: workflowId, property_definition_id: definitionId, label, color, conta_id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getWorkflowSelectOptions(workflowId: number, definitionId: number): Promise<WorkflowSelectOption[]> {
  const { data, error } = await supabase
    .from('workflow_select_options')
    .select('*')
    .eq('workflow_id', workflowId)
    .eq('property_definition_id', definitionId);
  if (error) throw error;
  return data || [];
}

/** Batch-send all internally-approved posts to the client */
export async function sendPostsToCliente(workflowId: number): Promise<void> {
  const { error } = await supabase
    .from('workflow_posts')
    .update({ status: 'enviado_cliente' })
    .eq('workflow_id', workflowId)
    .eq('status', 'aprovado_interno');
  if (error) throw error;
}

export async function approvePostsInternally(workflowId: number): Promise<void> {
  const { error } = await supabase
    .from('workflow_posts')
    .update({ status: 'aprovado_cliente' })
    .eq('workflow_id', workflowId)
    .not('status', 'in', '(agendado,postado)');
  if (error) throw error;
}

export async function getPostApprovals(postIds: number[]): Promise<PostApproval[]> {
  if (postIds.length === 0) return [];
  const { data, error } = await supabase
    .from('post_approvals')
    .select('*')
    .in('post_id', postIds)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function replyToPostApproval(
  postId: number,
  workflowId: number,
  comentario: string
): Promise<void> {
  const token = await getPortalToken(workflowId);
  if (!token) throw new Error('Crie e compartilhe o portal antes de responder.');
  const { error } = await supabase.from('post_approvals').insert({
    post_id: postId,
    token,
    action: 'mensagem',
    comentario,
    is_workspace_user: true,
  });
  if (error) throw error;
}

/** Calculate deadline info for an active step. */
export function getDeadlineInfo(etapa: WorkflowEtapa): { diasRestantes: number; horasRestantes: number; estourado: boolean; urgente: boolean } {
  const now = new Date();

  // FIRST: if a fixed deadline date is set, calculate relative to it directly
  // (applies to data_fixa and data_entrega modes — step may still be pending)
  if (etapa.data_limite) {
    const limite = new Date(etapa.data_limite);
    // data_limite is a date (no time), treat end of that day as midnight start of next day
    limite.setDate(limite.getDate() + 1);
    const msRestantes = limite.getTime() - now.getTime();
    const totalHorasRestantes = Math.floor(msRestantes / (1000 * 60 * 60));
    const diasRestantes = Math.floor(totalHorasRestantes / 24);
    const horasRestantes = totalHorasRestantes % 24;
    return {
      diasRestantes,
      horasRestantes,
      estourado: msRestantes < 0,
      urgente: msRestantes >= 0 && msRestantes <= 24 * 60 * 60 * 1000,
    };
  }

  if (etapa.status !== 'ativo' || !etapa.iniciado_em) {
    return { diasRestantes: etapa.prazo_dias, horasRestantes: 0, estourado: false, urgente: false };
  }

  const inicio = new Date(etapa.iniciado_em);

  let msRestantes: number;
  if (etapa.tipo_prazo === 'uteis') {
    let diasPassados = 0;
    const cursor = new Date(inicio);
    while (cursor < now) {
      cursor.setDate(cursor.getDate() + 1);
      const dow = cursor.getDay();
      if (dow !== 0 && dow !== 6) diasPassados++;
    }
    const prazoMs = etapa.prazo_dias * 24 * 60 * 60 * 1000;
    msRestantes = prazoMs - diasPassados * 24 * 60 * 60 * 1000;
  } else {
    const prazoMs = etapa.prazo_dias * 24 * 60 * 60 * 1000;
    msRestantes = prazoMs - (now.getTime() - inicio.getTime());
  }

  const totalHorasRestantes = Math.floor(msRestantes / (1000 * 60 * 60));
  const diasRestantes = Math.floor(totalHorasRestantes / 24);
  const horasRestantes = totalHorasRestantes % 24;

  return {
    diasRestantes,
    horasRestantes,
    estourado: msRestantes < 0,
    urgente: msRestantes >= 0 && msRestantes <= 24 * 60 * 60 * 1000,
  };
}

// ──────────────────────────────────────────────
// Hub management types
// ──────────────────────────────────────────────

export interface HubBrandRow {
  id?: string;
  cliente_id: number;
  logo_url?: string | null;
  primary_color?: string | null;
  secondary_color?: string | null;
  font_primary?: string | null;
  font_secondary?: string | null;
}

export interface HubBrandFileRow {
  id: string;
  cliente_id: number;
  name: string;
  file_url: string;
  file_type: string;
  display_order: number;
}

export interface HubPageRow {
  id: string;
  conta_id: string;
  cliente_id: number;
  title: string;
  content: unknown[];
  display_order: number;
  created_at: string;
}

// ──────────────────────────────────────────────
// Hub management functions
// ──────────────────────────────────────────────

export async function getHubToken(clienteId: number) {
  const { data } = await supabase
    .from('client_hub_tokens')
    .select('id, token, is_active')
    .eq('cliente_id', clienteId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as { id: string; token: string; is_active: boolean } | null;
}

export async function createHubToken(clienteId: number, contaId: string) {
  const { data, error } = await supabase
    .from('client_hub_tokens')
    .insert({ cliente_id: clienteId, conta_id: contaId })
    .select('id, token, is_active')
    .single();
  if (error) throw error;
  return data as { id: string; token: string; is_active: boolean };
}

export async function setHubTokenActive(tokenId: string, isActive: boolean) {
  await supabase.from('client_hub_tokens').update({ is_active: isActive }).eq('id', tokenId);
}

export async function getHubBrand(clienteId: number) {
  const { data: brand } = await supabase.from('hub_brand').select('*').eq('cliente_id', clienteId).maybeSingle();
  const { data: files } = await supabase.from('hub_brand_files').select('*').eq('cliente_id', clienteId).order('display_order');
  return { brand: brand as HubBrandRow | null, files: (files ?? []) as HubBrandFileRow[] };
}

export async function upsertHubBrand(clienteId: number, values: Partial<HubBrandRow>) {
  await supabase.from('hub_brand').upsert({ ...values, cliente_id: clienteId }, { onConflict: 'cliente_id' });
}

export async function addHubBrandFile(clienteId: number, name: string, file_url: string, file_type: string, display_order: number) {
  await supabase.from('hub_brand_files').insert({ cliente_id: clienteId, name, file_url, file_type, display_order });
}

export async function removeHubBrandFile(fileId: string) {
  await supabase.from('hub_brand_files').delete().eq('id', fileId);
}

export async function getHubPages(clienteId: number) {
  const { data } = await supabase.from('hub_pages').select('*').eq('cliente_id', clienteId).order('display_order');
  return (data ?? []) as HubPageRow[];
}

export async function upsertHubPage(page: Partial<HubPageRow> & { cliente_id: number; conta_id: string }) {
  if (page.id) {
    await supabase.from('hub_pages').update(page).eq('id', page.id);
  } else {
    await supabase.from('hub_pages').insert(page);
  }
}

export async function removeHubPage(pageId: string) {
  await supabase.from('hub_pages').delete().eq('id', pageId);
}

export async function getWorkspaceSlug(): Promise<string | null> {
  const conta_id = await getContaId();
  const { data } = await supabase.from('workspaces').select('slug').eq('id', conta_id).maybeSingle();
  return (data as { slug: string | null } | null)?.slug ?? null;
}

export interface HubBriefingQuestionRow {
  id: string;
  cliente_id: number;
  conta_id: string;
  question: string;
  answer: string | null;
  section: string | null;
  display_order: number;
  created_at: string;
}

export async function getHubBriefingQuestions(clienteId: number): Promise<HubBriefingQuestionRow[]> {
  const { data, error } = await supabase
    .from('hub_briefing_questions')
    .select('*')
    .eq('cliente_id', clienteId)
    .order('display_order');
  if (error) throw error;
  return data ?? [];
}

export async function addHubBriefingQuestion(clienteId: number, contaId: string, question: string, section?: string | null, answer?: string | null): Promise<void> {
  const { data: existing } = await supabase
    .from('hub_briefing_questions')
    .select('display_order')
    .eq('cliente_id', clienteId)
    .order('display_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (existing?.display_order ?? -1) + 1;
  const { error } = await supabase
    .from('hub_briefing_questions')
    .insert({ cliente_id: clienteId, conta_id: contaId, question, display_order: nextOrder, section: section ?? null, answer: answer ?? null });
  if (error) throw error;
}

export async function updateHubBriefingQuestionSection(id: string, section: string | null): Promise<void> {
  const { error } = await supabase
    .from('hub_briefing_questions')
    .update({ section })
    .eq('id', id);
  if (error) throw error;
}

export async function updateHubBriefingQuestion(id: string, question: string): Promise<void> {
  const { error } = await supabase
    .from('hub_briefing_questions')
    .update({ question })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteHubBriefingQuestion(id: string): Promise<void> {
  const { error } = await supabase
    .from('hub_briefing_questions')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

// ---- Ideias ----

export interface IdeiaReaction {
  id: string;
  ideia_id: string;
  membro_id: number;
  emoji: string;
  created_at: string;
  membros: { nome: string };
}

export interface Ideia {
  id: string;
  workspace_id: string;
  cliente_id: number;
  titulo: string;
  descricao: string;
  links: string[];
  status: 'nova' | 'em_analise' | 'aprovada' | 'descartada';
  comentario_agencia: string | null;
  comentario_autor_id: number | null;
  comentario_at: string | null;
  created_at: string;
  updated_at: string;
  clientes: { nome: string };
  comentario_autor: { nome: string } | null;
  ideia_reactions: IdeiaReaction[];
}

export async function getIdeias(filters: { cliente_id?: number } = {}): Promise<Ideia[]> {
  let q = supabase
    .from('ideias')
    .select(`
      id, workspace_id, cliente_id, titulo, descricao, links, status,
      comentario_agencia, comentario_autor_id, comentario_at, created_at, updated_at,
      clientes(nome),
      comentario_autor:membros!comentario_autor_id(nome),
      ideia_reactions(id, ideia_id, membro_id, emoji, created_at, membros(nome))
    `)
    .order('created_at', { ascending: false });

  if (filters.cliente_id) q = q.eq('cliente_id', filters.cliente_id);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Ideia[];
}

export async function updateIdeiaStatus(
  ideiaId: string,
  status: Ideia['status'],
): Promise<void> {
  const { error } = await supabase
    .from('ideias')
    .update({ status })
    .eq('id', ideiaId);
  if (error) throw new Error(error.message);
}

export async function upsertIdeiaComentario(
  ideiaId: string,
  comentario: string,
  autorId: number,
): Promise<void> {
  const { error } = await supabase
    .from('ideias')
    .update({
      comentario_agencia: comentario,
      comentario_autor_id: autorId,
      comentario_at: new Date().toISOString(),
    })
    .eq('id', ideiaId);
  if (error) throw new Error(error.message);
}

export async function toggleIdeiaReaction(
  ideiaId: string,
  membroId: number,
  emoji: string,
): Promise<void> {
  // Check if this user already reacted with this emoji
  const { data: existing } = await supabase
    .from('ideia_reactions')
    .select('id')
    .eq('ideia_id', ideiaId)
    .eq('membro_id', membroId)
    .eq('emoji', emoji)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('ideia_reactions')
      .delete()
      .eq('id', existing.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase
      .from('ideia_reactions')
      .insert({ ideia_id: ideiaId, membro_id: membroId, emoji });
    if (error) throw new Error(error.message);
  }
}

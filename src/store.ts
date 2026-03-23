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
  especialidade?: string;
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

export let currentUserRole: 'owner' | 'admin' | 'agent' = 'owner';

export async function initStoreRole() {
  try {
    const profile = await getCurrentProfile();
    if (profile) {
      currentUserRole = profile.role || 'owner';
    }
  } catch(e) {}
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
}

export interface WorkflowTemplate {
  id?: number;
  conta_id?: string;
  user_id?: string;
  nome: string;
  etapas: WorkflowTemplateEtapa[];
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
  link_notion?: string | null;
  link_drive?: string | null;
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
  const newWorkflow = await addWorkflow({
    cliente_id: workflow.cliente_id,
    titulo: workflow.titulo,
    template_id: workflow.template_id || null,
    status: 'ativo',
    etapa_atual: 0,
    recorrente: workflow.recorrente,
  });

  try {
    for (let i = 0; i < etapas.length; i++) {
      await addWorkflowEtapa({
        workflow_id: newWorkflow.id!,
        ordem: i,
        nome: etapas[i].nome,
        prazo_dias: etapas[i].prazo_dias,
        tipo_prazo: etapas[i].tipo_prazo,
        responsavel_id: etapas[i].responsavel_id || null,
        status: i === 0 ? 'ativo' : 'pendente',
        iniciado_em: i === 0 ? now : null,
        concluido_em: null,
      });
    }
  } catch (err) {
    // Clean up orphaned workflow if etapa inserts failed
    try { await removeWorkflow(newWorkflow.id!); } catch { /* best effort */ }
    throw err;
  }

  return newWorkflow;
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

/** Calculate deadline info for an active step. */
export function getDeadlineInfo(etapa: WorkflowEtapa): { diasRestantes: number; horasRestantes: number; estourado: boolean; urgente: boolean } {
  if (etapa.status !== 'ativo' || !etapa.iniciado_em) {
    return { diasRestantes: etapa.prazo_dias, horasRestantes: 0, estourado: false, urgente: false };
  }

  const inicio = new Date(etapa.iniciado_em);
  const now = new Date();

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

import { supabase, getUserId, getContaId } from './core';
import { resetApprovedPostsForNextCycle } from './posts';
import { fetchAllPaged } from './paging';

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

export async function addWorkflowTemplate(
  t: Omit<WorkflowTemplate, 'id' | 'user_id' | 'conta_id' | 'created_at'>,
): Promise<WorkflowTemplate> {
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

export async function updateWorkflowTemplate(
  id: number,
  t: Partial<Omit<WorkflowTemplate, 'id' | 'user_id' | 'conta_id'>>,
): Promise<WorkflowTemplate> {
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
 * Propagate template step changes to `pendente`/`ativo` workflow_etapas of active workflows
 * using this template, and backfill (as `pendente`) any template step whose `ordem` has no
 * workflow_etapas row yet — appending a new step to a template reaches workflows created
 * before the edit. Server-side now — see `propagate_template_to_workflows` in
 * supabase/migrations/20260828000010_propagate_template_backfill_new_steps.sql for the full
 * behavioral spec (it reads the template's `etapas` jsonb directly, so the caller no longer
 * passes it).
 */
export async function propagateTemplateToWorkflows(templateId: number): Promise<void> {
  const { error } = await supabase.rpc('propagate_template_to_workflows', {
    p_template_id: templateId,
  });
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
  modo_prazo?: 'padrao' | 'data_fixa' | 'data_entrega';
  link_notion?: string | null;
  link_drive?: string | null;
  position?: number;
  created_at?: string;
  created_via?: 'human' | 'agent';
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

export async function addWorkflow(
  w: Omit<Workflow, 'id' | 'user_id' | 'conta_id' | 'created_at'>,
): Promise<Workflow> {
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

export async function updateWorkflow(
  id: number,
  w: Partial<Omit<Workflow, 'id' | 'user_id' | 'conta_id'>>,
): Promise<Workflow> {
  const { data, error } = await supabase.from('workflows').update(w).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function updateWorkflowPositions(
  updates: { id: number; position: number }[],
): Promise<void> {
  await Promise.all(
    updates.map(({ id, position }) =>
      supabase
        .from('workflows')
        .update({ position })
        .eq('id', id)
        .then(({ error }) => {
          if (error) throw error;
        }),
    ),
  );
}

export async function removeWorkflow(id: number): Promise<void> {
  const { error } = await supabase.from('workflows').delete().eq('id', id);
  if (error) throw error;
}

// =============================================
// WORKFLOW EVENTS (HISTÓRICO DO FLUXO)
// =============================================
export interface WorkflowEventChange {
  field: string;
  from: unknown;
  to: unknown;
  from_label?: string;
  to_label?: string;
}

export interface WorkflowEvent {
  id: number;
  workflow_id: number;
  conta_id: string;
  event_type:
    | 'criado'
    | 'etapa_iniciada'
    | 'etapa_concluida'
    | 'etapa_revertida'
    | 'etapa_editada'
    | 'fluxo_editado'
    | 'fluxo_concluido'
    | 'fluxo_reaberto'
    | 'fluxo_arquivado'
    | 'template_migrado'
    | 'template_propagado';
  etapa_id: number | null;
  etapa_nome: string | null;
  source: 'workspace_user' | 'client' | 'system';
  actor_user_id: string | null;
  actor_name: string | null;
  metadata: { changes?: WorkflowEventChange[]; [key: string]: unknown };
  created_at: string;
}

export async function getWorkflowEvents(workflowId: number): Promise<WorkflowEvent[]> {
  const { data, error } = await supabase
    .from('workflow_events')
    .select(
      'id, workflow_id, conta_id, event_type, etapa_id, etapa_nome, source, actor_user_id, actor_name, metadata, created_at',
    )
    .eq('workflow_id', workflowId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;
  return data || [];
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

export async function getAllActiveEtapas(): Promise<
  (WorkflowEtapa & { workflow_titulo?: string; cliente_nome?: string; cliente_id?: number })[]
> {
  const rows = await fetchAllPaged(async (from, to) => {
    const { data, error } = await supabase
      .from('workflow_etapas')
      .select('*, workflows!inner(titulo, cliente_id, status, clientes!inner(nome))')
      .eq('workflows.status', 'ativo')
      .order('ordem', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to);
    if (error) throw error;
    return data || [];
  });
  return rows.map((row: any) => ({
    ...row,
    workflow_titulo: row.workflows?.titulo,
    cliente_id: row.workflows?.cliente_id,
    cliente_nome: row.workflows?.clientes?.nome,
    workflows: undefined,
  }));
}

export async function getAllEtapasWithWorkflow(): Promise<
  (WorkflowEtapa & {
    workflow_titulo?: string;
    workflow_status?: string;
    workflow_created_at?: string;
    template_id?: number | null;
    cliente_id?: number;
    cliente_nome?: string;
  })[]
> {
  const { data, error } = await supabase
    .from('workflow_etapas')
    .select(
      '*, workflows!inner(titulo, status, created_at, template_id, cliente_id, clientes!inner(nome))',
    )
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
  const payload = { ...e, responsavel_id: e.responsavel_id || null };
  const { data, error } = await supabase.from('workflow_etapas').insert(payload).select().single();
  if (error) throw error;
  return data;
}

export async function updateWorkflowEtapa(
  id: number,
  e: Partial<Omit<WorkflowEtapa, 'id'>>,
): Promise<WorkflowEtapa> {
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
export async function completeEtapa(
  workflowId: number,
  etapaId: number,
): Promise<{ workflow: Workflow; etapas: WorkflowEtapa[] }> {
  const now = new Date().toISOString();

  // Mark current step as done
  await updateWorkflowEtapa(etapaId, { status: 'concluido', concluido_em: now });

  // Get all steps to find the next one
  const etapas = await getWorkflowEtapas(workflowId);
  const currentIdx = etapas.findIndex((e) => e.id === etapaId);
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

/** True when another client-approval etapa exists after the given etapa. */
export function hasLaterApprovalEtapa(etapas: WorkflowEtapa[], etapaId: number): boolean {
  const current = etapas.find((e) => e.id === etapaId);
  if (!current) return false;
  return etapas.some((e) => e.tipo === 'aprovacao_cliente' && e.ordem > current.ordem);
}

export interface CompleteEtapaWithRearmResult {
  workflow: Workflow;
  etapas: WorkflowEtapa[];
  /** Approved posts were reset to rascunho for the next approval cycle. */
  rearmed: boolean;
  /** The etapa advanced but the post reset failed — needs manual remediation. */
  rearmFailed: boolean;
}

/**
 * completeEtapa + approval-cycle re-arm: when the completed etapa is an aprovacao_cliente
 * and another approval etapa lies ahead, approved posts are reset to rascunho so the next
 * approval cycle can run. Callers that must NOT touch posts ("Avançar etapa sem alterar
 * posts") keep calling plain completeEtapa.
 */
export async function completeEtapaWithRearm(
  workflowId: number,
  etapaId: number,
): Promise<CompleteEtapaWithRearmResult> {
  const before = await getWorkflowEtapas(workflowId);
  const current = before.find((e) => e.id === etapaId);
  const rearm = current?.tipo === 'aprovacao_cliente' && hasLaterApprovalEtapa(before, etapaId);
  const result = await completeEtapa(workflowId, etapaId);
  if (!rearm) return { ...result, rearmed: false, rearmFailed: false };
  // The advance already happened — a reset failure must not surface as an advance failure.
  try {
    await resetApprovedPostsForNextCycle(workflowId);
    return { ...result, rearmed: true, rearmFailed: false };
  } catch {
    return { ...result, rearmed: false, rearmFailed: true };
  }
}

/** Revert a workflow to its previous step (move card one column back). */
export async function revertEtapa(
  workflowId: number,
): Promise<{ workflow: Workflow; etapas: WorkflowEtapa[] }> {
  const etapas = await getWorkflowEtapas(workflowId);
  const activeIdx = etapas.findIndex((e) => e.status === 'ativo');
  if (activeIdx <= 0) throw new Error('Não é possível voltar — já está na primeira etapa.');

  const now = new Date().toISOString();
  const currentEtapa = etapas[activeIdx];
  const prevEtapa = etapas[activeIdx - 1];

  // Deactivate current step → pendente
  await updateWorkflowEtapa(currentEtapa.id!, { status: 'pendente', iniciado_em: null });

  // Re-activate previous step (preserve original start time)
  await updateWorkflowEtapa(prevEtapa.id!, {
    status: 'ativo',
    concluido_em: null,
    iniciado_em: prevEtapa.iniciado_em ?? now,
  });

  // Update workflow pointer
  const workflow = await updateWorkflow(workflowId, { etapa_atual: activeIdx - 1 });
  const updatedEtapas = await getWorkflowEtapas(workflowId);
  return { workflow, etapas: updatedEtapas };
}

export async function reopenWorkflow(
  workflowId: number,
): Promise<{ workflow: Workflow; etapas: WorkflowEtapa[] }> {
  const etapas = await getWorkflowEtapas(workflowId);
  if (etapas.length === 0) throw new Error('Fluxo sem etapas.');

  const lastEtapa = etapas[etapas.length - 1];
  const now = new Date().toISOString();

  await updateWorkflowEtapa(lastEtapa.id!, {
    status: 'ativo',
    concluido_em: null,
    iniciado_em: now,
  });
  const workflow = await updateWorkflow(workflowId, {
    status: 'ativo',
    etapa_atual: etapas.length - 1,
  });
  const updatedEtapas = await getWorkflowEtapas(workflowId);
  return { workflow, etapas: updatedEtapas };
}

/** Clone a workflow for recurrence (creates a fresh copy with all steps reset). */
export async function duplicateWorkflow(workflowId: number): Promise<Workflow> {
  const [workflow, etapas] = await Promise.all([
    supabase
      .from('workflows')
      .select('*')
      .eq('id', workflowId)
      .single()
      .then((r) => {
        if (r.error) throw r.error;
        return r.data as Workflow;
      }),
    getWorkflowEtapas(workflowId),
  ]);

  const now = new Date().toISOString();
  const modoPrazo = workflow.modo_prazo || 'padrao';

  // For data_entrega mode: recalculate delivery deadlines for the next cycle
  // Fetch cliente to get dia_entrega, then compute new deadlines
  let nextDeliveryDeadlines: Map<number, string> | null = null;
  if (modoPrazo === 'data_entrega') {
    const { data: clienteRow } = await supabase
      .from('clientes_v')
      .select('dia_entrega')
      .eq('id', workflow.cliente_id)
      .single();
    const diaEntrega = clienteRow?.dia_entrega as number | undefined;
    if (diaEntrega) {
      // Find anchor (aprovacao_cliente) step and compute from next month's delivery date
      const anchorEtapa = etapas.find((e) => e.tipo === 'aprovacao_cliente');
      if (anchorEtapa) {
        // Next delivery date: advance one cycle from today
        const today = new Date();
        let nextMonth = today.getMonth() + 2; // +1 for next month, +1 for 1-based
        let nextYear = today.getFullYear();
        if (nextMonth > 12) {
          nextMonth = 1;
          nextYear++;
        }
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
    try {
      await removeWorkflow(newWorkflow.id!);
    } catch {
      /* best effort */
    }
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
export function _computeDeliveryDeadlines(
  etapas: WorkflowEtapa[],
  deliveryDate: Date,
): Map<number, string> {
  const sorted = [...etapas].sort((a, b) => a.ordem - b.ordem);
  const anchorIdx = sorted.findIndex((e) => e.tipo === 'aprovacao_cliente');
  if (anchorIdx === -1) return new Map();

  const result = new Map<number, string>();
  const toISO = (d: Date) => d.toISOString().split('T')[0];

  // Anchor step gets delivery date
  result.set(sorted[anchorIdx].ordem, toISO(deliveryDate));

  // Walk backward from anchor
  let cursor = new Date(deliveryDate);
  for (let i = anchorIdx - 1; i >= 0; i--) {
    cursor = _subtractDays(cursor, sorted[i + 1].prazo_dias, sorted[i + 1].tipo_prazo);
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

/** Calculate deadline info for an active step. */
export function getDeadlineInfo(etapa: WorkflowEtapa): {
  diasRestantes: number;
  horasRestantes: number;
  estourado: boolean;
  urgente: boolean;
} {
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

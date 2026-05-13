import { supabase, getContaId } from './core';
import { getPortalToken } from './portal';

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
    | 'postado'
    | 'falha_publicacao';
  responsavel_id?: number | null;
  scheduled_at?: string | null;
  ig_caption?: string | null;
  instagram_permalink?: string | null;
  published_at?: string | null;
  publish_error?: string | null;
  publish_retry_count?: number;
  instagram_container_id?: string | null;
  instagram_media_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ClientePost {
  id: number;
  workflow_id: number;
  titulo: string;
  tipo: WorkflowPost['tipo'];
  status: WorkflowPost['status'];
  scheduled_at: string | null;
  ordem: number;
  workflow_titulo: string;
}

export async function getClientePosts(clienteId: number): Promise<ClientePost[]> {
  const { data, error } = await supabase
    .from('workflow_posts')
    .select('id, workflow_id, titulo, tipo, status, scheduled_at, ordem, workflows!inner(titulo, status)')
    .eq('workflows.cliente_id', clienteId)
    .eq('workflows.status', 'ativo')
    .order('scheduled_at', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: row.id,
    workflow_id: row.workflow_id,
    titulo: row.titulo,
    tipo: row.tipo,
    status: row.status,
    scheduled_at: row.scheduled_at,
    ordem: row.ordem,
    workflow_titulo: row.workflows.titulo,
  }));
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
  blur_data_url?: string | null;
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

export async function getAllWorkflowPosts(): Promise<WorkflowPost[]> {
  const { data, error } = await supabase
    .from('workflow_posts')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getWorkflowPostsWithProperties(workflowId: number): Promise<(WorkflowPost & { property_values: PostPropertyValue[]; has_media: boolean })[]> {
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
      ),
      post_file_links (id)
    `)
    .eq('workflow_id', workflowId)
    .order('ordem', { ascending: true });
  if (error) throw error;
  return (data || []).map((post: any) => {
    const { post_property_values: rawPvs, post_file_links: rawMedia, ...rest } = post;
    return {
      ...rest,
      has_media: Array.isArray(rawMedia) && rawMedia.length > 0,
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

export async function getWorkflowApprovedPostsCounts(
  workflowIds: number[]
): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  if (workflowIds.length === 0) return counts;
  const { data, error } = await supabase
    .from('workflow_posts')
    .select('workflow_id')
    .in('workflow_id', workflowIds)
    .eq('status', 'aprovado_cliente');
  if (error) throw error;
  for (const row of (data ?? []) as { workflow_id: number }[]) {
    counts.set(row.workflow_id, (counts.get(row.workflow_id) ?? 0) + 1);
  }
  return counts;
}

export async function getWorkflowRevisaoInternaCounts(
  workflowIds: number[]
): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  if (workflowIds.length === 0) return counts;
  const { data, error } = await supabase
    .from('workflow_posts')
    .select('workflow_id')
    .in('workflow_id', workflowIds)
    .eq('status', 'revisao_interna');
  if (error) throw error;
  for (const row of (data ?? []) as { workflow_id: number }[]) {
    counts.set(row.workflow_id, (counts.get(row.workflow_id) ?? 0) + 1);
  }
  return counts;
}

export async function getWorkflowPostResponsaveis(
  workflowIds: number[]
): Promise<Map<number, number[]>> {
  const map = new Map<number, number[]>();
  if (workflowIds.length === 0) return map;
  const { data, error } = await supabase
    .from('workflow_posts')
    .select('workflow_id, responsavel_id')
    .in('workflow_id', workflowIds)
    .not('responsavel_id', 'is', null);
  if (error) throw error;
  for (const row of (data ?? []) as { workflow_id: number; responsavel_id: number }[]) {
    const arr = map.get(row.workflow_id) ?? [];
    if (!arr.includes(row.responsavel_id)) arr.push(row.responsavel_id);
    map.set(row.workflow_id, arr);
  }
  return map;
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
  const { error } = await supabase.from('post_approvals').insert({
    post_id: postId,
    token: token ?? null,
    action: 'mensagem',
    comentario,
    is_workspace_user: true,
  });
  if (error) throw error;
}

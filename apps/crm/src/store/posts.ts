import { supabase, getContaId, getUserId } from './core';
import { extractMentionsFromDoc } from '@/components/mentions/mentionTokens';
import { syncMentions } from './mentions';

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
  /** Workspace-defined custom status (post_status_definitions). When set, the
   * z1 DB trigger forces `status` to the definition's behaves_as value, and
   * clears this pointer whenever `status` moves away from it. */
  custom_status_id?: string | null;
  responsavel_id?: number | null;
  scheduled_at?: string | null;
  ig_caption?: string | null;
  instagram_permalink?: string | null;
  published_at?: string | null;
  publish_error?: string | null;
  publish_error_code?: string | null;
  publish_retry_count?: number;
  instagram_container_id?: string | null;
  instagram_media_id?: string | null;
  /** Which platform(s) this post targets. Defaults to 'instagram' at the DB level
   * (migration 20260719000001_tiktok_publishing.sql). 'stories' tipo never allows
   * 'tiktok'/'both' — TikTok has no Stories API. */
  platform?: 'instagram' | 'tiktok' | 'both';
  tiktok_publish_id?: string | null;
  tiktok_post_id?: string | null;
  tiktok_post_url?: string | null;
  tiktok_publish_status?: 'initiated' | 'processing' | 'published' | 'failed' | null;
  tiktok_publish_error?: string | null;
  tiktok_publish_retry_count?: number;
  tiktok_caption?: string | null;
  tiktok_title?: string | null;
  tiktok_settings?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
  created_via?: 'human' | 'agent';
  /** Set by the storage auto-clean when the post's media was deleted after
   * publication (spec 2026-08-10). Distinguishes "cleaned" from "never had
   * media" so the gallery can render the removal placeholder. */
  media_autocleaned_at?: string | null;
  /** Post Express marker. hub-approve skips the min-future date check and
   * self-schedules on approval when the client's auto-publish is on. */
  is_express?: boolean;
  /** Reel de teste (Instagram trial reel). NULL/undefined = post normal.
   * 'auto' = SS_PERFORMANCE (graduação automática), 'manual' = graduação no
   * app. Só válido em tipo 'reels' mirando Instagram; o trigger
   * workflow_posts_z5_clear_ig_trial limpa fora disso. */
  ig_trial_strategy?: 'manual' | 'auto' | null;
}

export interface ClientePost {
  id: number;
  workflow_id: number;
  titulo: string;
  tipo: WorkflowPost['tipo'];
  status: WorkflowPost['status'];
  custom_status_id: string | null;
  scheduled_at: string | null;
  ordem: number;
  workflow_titulo: string;
  /** Target platform; absent on legacy rows (treat as 'instagram', the DB default). */
  platform?: WorkflowPost['platform'];
  ig_trial_strategy?: 'manual' | 'auto' | null;
}

export async function getClientePosts(clienteId: number): Promise<ClientePost[]> {
  const { data, error } = await supabase
    .from('workflow_posts')
    .select(
      'id, workflow_id, titulo, tipo, status, custom_status_id, scheduled_at, ordem, platform, ig_trial_strategy, workflows!inner(titulo, status)',
    )
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
    custom_status_id: row.custom_status_id ?? null,
    scheduled_at: row.scheduled_at,
    ordem: row.ordem,
    workflow_titulo: row.workflows.titulo,
    platform: row.platform ?? undefined,
    ig_trial_strategy: row.ig_trial_strategy ?? null,
  }));
}

export interface PostPreview {
  conteudo_plain: string;
  responsavel_id: number | null;
  ig_caption: string | null;
  published_at: string | null;
  instagram_permalink: string | null;
}

/**
 * Detail fields for a single post, lazy-loaded by the calendar detail panel.
 * RLS scopes by conta_id; no explicit conta filter needed (mirrors updateWorkflowPost).
 */
export async function getPostPreview(postId: number): Promise<PostPreview> {
  const { data, error } = await supabase
    .from('workflow_posts')
    .select('conteudo_plain, responsavel_id, ig_caption, published_at, instagram_permalink')
    .eq('id', postId)
    .single();
  if (error) throw error;
  return {
    conteudo_plain: data.conteudo_plain ?? '',
    responsavel_id: data.responsavel_id ?? null,
    ig_caption: data.ig_caption ?? null,
    published_at: data.published_at ?? null,
    instagram_permalink: data.instagram_permalink ?? null,
  };
}

export interface MentionPostResult {
  id: number;
  titulo: string;
  workflow_id: number;
}

// Escapes the three characters that are special inside a Postgres ILIKE pattern
// ('%', '_') plus the escape character itself ('\') so a user's raw search term
// can't widen or break the wrapping `%term%` pattern below.
function escapeIlikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, '\\$&');
}

/**
 * Post search backing the @-mention dropdown (Task 4 of the at-mentions spec).
 * RLS scopes workflow_posts by conta_id -- no explicit conta filter needed.
 */
export async function searchPostsForMention(term: string): Promise<MentionPostResult[]> {
  const trimmed = term.trim();
  if (!trimmed) return [];
  const { data, error } = await supabase
    .from('workflow_posts')
    .select('id, titulo, workflow_id')
    .ilike('titulo', `%${escapeIlikeTerm(trimmed)}%`)
    .limit(5);
  if (error) throw error;
  return data ?? [];
}

export interface ScheduledPost {
  id: number;
  workflow_id: number;
  cliente_id: number | null;
  cliente_nome: string;
  workflow_titulo: string;
  titulo: string;
  tipo: WorkflowPost['tipo'];
  status: WorkflowPost['status'];
  custom_status_id: string | null;
  scheduled_at: string; // non-null (range-filtered)
  published_at: string | null;
  ig_caption: string | null;
  instagram_permalink: string | null;
  publish_error: string | null;
  publish_error_code: string | null;
  ordem: number;
  responsavel_id: number | null;
  /** Which platform(s) this post targets; DB defaults to 'instagram' (see WorkflowPost). */
  platform: NonNullable<WorkflowPost['platform']>;
  tiktok_publish_status: WorkflowPost['tiktok_publish_status'];
  tiktok_publish_error: string | null;
  tiktok_post_url: string | null;
  instagram_media_id: string | null;
  ig_trial_strategy: 'manual' | 'auto' | null;
}

/**
 * All posts (across active workflows / all clients) whose scheduled_at falls in
 * [startISO, endISO). workflow_posts has only workflow_id as an FK, so the client
 * name is reached through a nested workflows -> clientes join (mirrors
 * getAllActiveEtapas in store/workflows.ts). RLS enforces conta_id.
 *
 * Includes platform/tiktok_* fields so callers (e.g. PublicacoesPanel) can route
 * schedule/cancel/retry to the correct platform service instead of assuming
 * Instagram for every post (see toWorkflowPost in PublicacoesPanel.tsx).
 */
const POST_CONTEXT_COLUMNS =
  'id, workflow_id, titulo, tipo, status, custom_status_id, scheduled_at, published_at, ig_caption, instagram_permalink, publish_error, publish_error_code, ordem, responsavel_id, platform, tiktok_publish_status, tiktok_publish_error, tiktok_post_url, instagram_media_id, ig_trial_strategy';

function mapPostContextRow(row: any): ActivePost {
  return {
    id: row.id,
    workflow_id: row.workflow_id,
    cliente_id: row.workflows?.cliente_id ?? null,
    cliente_nome: row.workflows?.clientes?.nome ?? '',
    workflow_titulo: row.workflows?.titulo ?? '',
    titulo: row.titulo,
    tipo: row.tipo,
    status: row.status,
    custom_status_id: row.custom_status_id ?? null,
    scheduled_at: row.scheduled_at ?? null,
    published_at: row.published_at ?? null,
    ig_caption: row.ig_caption ?? null,
    instagram_permalink: row.instagram_permalink ?? null,
    publish_error: row.publish_error ?? null,
    publish_error_code: row.publish_error_code ?? null,
    ordem: row.ordem,
    responsavel_id: row.responsavel_id ?? null,
    platform: row.platform ?? 'instagram',
    tiktok_publish_status: row.tiktok_publish_status ?? null,
    tiktok_publish_error: row.tiktok_publish_error ?? null,
    tiktok_post_url: row.tiktok_post_url ?? null,
    instagram_media_id: row.instagram_media_id ?? null,
    ig_trial_strategy: row.ig_trial_strategy ?? null,
  };
}

export async function getScheduledPosts(
  startISO: string,
  endISO: string,
): Promise<ScheduledPost[]> {
  const { data, error } = await supabase
    .from('workflow_posts')
    .select(
      `${POST_CONTEXT_COLUMNS}, workflows!inner(titulo, cliente_id, status, clientes!inner(nome))`,
    )
    .eq('workflows.status', 'ativo')
    .not('scheduled_at', 'is', null)
    .gte('scheduled_at', startISO)
    .lt('scheduled_at', endISO)
    .order('scheduled_at', { ascending: true });
  if (error) throw error;
  // The scheduled_at range filter guarantees non-null, narrowing ActivePost to ScheduledPost.
  return (data || []).map(mapPostContextRow) as ScheduledPost[];
}

/** Same shape as ScheduledPost, but scheduled_at may be null (no range filter). */
export type ActivePost = Omit<ScheduledPost, 'scheduled_at'> & { scheduled_at: string | null };

/**
 * Every post of every active workflow, scheduled or not — the data source for the
 * Entregas Kanban/Lista "Publicações" modes. Unlike getScheduledPosts, `clientes`
 * is a LEFT join so posts of client-less workflows still appear (cliente_nome '').
 * RLS enforces conta_id.
 */
export async function getActivePosts(): Promise<ActivePost[]> {
  const { data, error } = await supabase
    .from('workflow_posts')
    .select(`${POST_CONTEXT_COLUMNS}, workflows!inner(titulo, cliente_id, status, clientes(nome))`)
    .eq('workflows.status', 'ativo')
    .order('scheduled_at', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data || []).map(mapPostContextRow);
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
  /** 'design' = an Estúdio-rendered link (T4.1/T4.5 — the design owns it, not user-editable);
   * optional because responses cached before the post-media-manage redeploy omit it. */
  origin?: 'manual' | 'design';
  uploaded_by: string | null;
  created_at: string;
  blur_data_url?: string | null;
  // Populated only on hydrated responses
  url?: string;
  thumbnail_url?: string | null;
  /** ISO timestamp when this file was permanently lost (Aug 2026 R2 incident and any
   * future reconciliation); null when the file is fine. Optional only because a
   * response cached before this field shipped omits the key — check the value,
   * never key presence. */
  media_lost_at?: string | null;
  /** Cloudflare Stream HLS manifest, when the video has one. Optional — cached
   * pre-deploy responses omit it, same convention as `origin`. */
  playback?: { hls: string; expires_at: string } | null;
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

export interface PostStatusEvent {
  id: number;
  post_id: number;
  from_status: WorkflowPost['status'] | null;
  to_status: WorkflowPost['status'];
  source: 'workspace_user' | 'client' | 'system';
  actor_user_id: string | null;
  actor_name: string | null;
  post_approval_id: number | null;
  from_custom_status_id: string | null;
  to_custom_status_id: string | null;
  /** Label snapshots taken at event time — survive rename/deletion of the definition. */
  from_custom_nome: string | null;
  to_custom_nome: string | null;
  created_at: string;
}

// =============================================
// CUSTOM PROPERTIES
// =============================================

export type PropertyType =
  | 'text'
  | 'number'
  | 'select'
  | 'multiselect'
  | 'status'
  | 'date'
  | 'person'
  | 'checkbox'
  | 'url'
  | 'email'
  | 'phone'
  | 'created_time';

export interface SelectOption {
  id: string; // stable uuid string
  label: string;
  color: string; // hex color e.g. '#E1306C'
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
  option_id: string; // uuid string
  label: string;
  color: string;
  created_at?: string;
}

export async function getPropertyDefinitions(
  templateId: number,
): Promise<TemplatePropertyDefinition[]> {
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

/**
 * Post statuses where the content work is still with the team, i.e. the
 * assignee has an action: writing, in internal review, client asked for
 * fixes, or the publish failed. Waiting states (aprovado_interno,
 * enviado_cliente, aprovado_cliente) and terminal ones (agendado, postado)
 * are not "pending" for the assignee.
 */
export const ASSIGNEE_PENDING_POST_STATUSES = [
  'rascunho',
  'revisao_interna',
  'correcao_cliente',
  'falha_publicacao',
] as const;

export interface AssignedPendingPost {
  id: number;
  workflow_id: number;
  titulo: string;
  status: WorkflowPost['status'];
  custom_status_id: string | null;
  workflow_titulo: string;
  cliente_nome: string;
}

/** Pending posts assigned to a membro across active workflows (agent dashboard). */
export async function getAssignedPendingPosts(membroId: number): Promise<AssignedPendingPost[]> {
  const { data, error } = await supabase
    .from('workflow_posts')
    .select(
      'id, workflow_id, titulo, status, custom_status_id, workflows!inner(titulo, status, clientes!inner(nome))',
    )
    .eq('workflows.status', 'ativo')
    .eq('responsavel_id', membroId)
    .in('status', ASSIGNEE_PENDING_POST_STATUSES as unknown as string[])
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map((row: any) => ({
    id: row.id,
    workflow_id: row.workflow_id,
    titulo: row.titulo,
    status: row.status,
    custom_status_id: row.custom_status_id ?? null,
    workflow_titulo: row.workflows?.titulo ?? '',
    cliente_nome: row.workflows?.clientes?.nome ?? '',
  }));
}

export interface AwaitingClientePost extends ActivePost {
  /** ISO timestamp of the latest transition into enviado_cliente, or null when
   * no status event recorded it (legacy rows). */
  waiting_since: string | null;
}

/**
 * Posts of active workflows currently waiting on the client (enviado_cliente),
 * with the moment they entered that status. `waiting_since` comes from
 * post_status_events, NOT updated_at (which moves on every edit), so it
 * reliably means "waiting since". Dashboard "Hoje" follow-up signal.
 */
export async function getAwaitingClientePosts(): Promise<AwaitingClientePost[]> {
  const { data, error } = await supabase
    .from('workflow_posts')
    .select(`${POST_CONTEXT_COLUMNS}, workflows!inner(titulo, cliente_id, status, clientes(nome))`)
    .eq('workflows.status', 'ativo')
    .eq('status', 'enviado_cliente')
    .order('created_at', { ascending: true });
  if (error) throw error;
  const posts = (data || []).map(mapPostContextRow);
  if (posts.length === 0) return [];

  const { data: events, error: evError } = await supabase
    .from('post_status_events')
    .select('post_id, created_at')
    .in(
      'post_id',
      posts.map((p) => p.id),
    )
    .eq('to_status', 'enviado_cliente')
    .order('created_at', { ascending: false });
  if (evError) throw evError;
  const latest = new Map<number, string>();
  for (const ev of (events ?? []) as { post_id: number; created_at: string }[]) {
    if (!latest.has(ev.post_id)) latest.set(ev.post_id, ev.created_at);
  }
  return posts.map((p) => ({ ...p, waiting_since: latest.get(p.id) ?? null }));
}

export async function getAllWorkflowPosts(): Promise<WorkflowPost[]> {
  const { data, error } = await supabase
    .from('workflow_posts')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getWorkflowPostsWithProperties(
  workflowId: number,
): Promise<(WorkflowPost & { property_values: PostPropertyValue[]; has_media: boolean })[]> {
  const { data, error } = await supabase
    .from('workflow_posts')
    .select(
      `
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
    `,
    )
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

export async function getWorkflowPostsCounts(workflowIds: number[]): Promise<Map<number, number>> {
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
  workflowIds: number[],
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

/**
 * Post statuses that mean the post has cleared client approval — either the
 * client approved it (`aprovado_cliente`) or it moved further down the pipeline
 * (scheduled / posted / publish-failed, all of which happen only after client
 * approval). Used to decide when a client-approval etapa is fully cleared, so a
 * workflow whose posts are already scheduled/posted still counts as approved.
 */
export const CLIENT_CLEARED_STATUSES = [
  'aprovado_cliente',
  'agendado',
  'postado',
  'falha_publicacao',
] as const;

export async function getWorkflowClearedClientePostsCounts(
  workflowIds: number[],
): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  if (workflowIds.length === 0) return counts;
  const { data, error } = await supabase
    .from('workflow_posts')
    .select('workflow_id')
    .in('workflow_id', workflowIds)
    .in('status', CLIENT_CLEARED_STATUSES as unknown as string[]);
  if (error) throw error;
  for (const row of (data ?? []) as { workflow_id: number }[]) {
    counts.set(row.workflow_id, (counts.get(row.workflow_id) ?? 0) + 1);
  }
  return counts;
}

export async function getWorkflowAwaitingClientePostsCounts(
  workflowIds: number[],
): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  if (workflowIds.length === 0) return counts;
  const { data, error } = await supabase
    .from('workflow_posts')
    .select('workflow_id')
    .in('workflow_id', workflowIds)
    .eq('status', 'enviado_cliente');
  if (error) throw error;
  for (const row of (data ?? []) as { workflow_id: number }[]) {
    counts.set(row.workflow_id, (counts.get(row.workflow_id) ?? 0) + 1);
  }
  return counts;
}

export async function getWorkflowRevisaoInternaCounts(
  workflowIds: number[],
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
  workflowIds: number[],
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
  p: Omit<WorkflowPost, 'id' | 'conta_id' | 'created_at' | 'updated_at'>,
): Promise<WorkflowPost> {
  const conta_id = await getContaId();
  const { data, error } = await supabase
    .from('workflow_posts')
    .insert({ ...p, conta_id })
    .select()
    .single();
  if (error) throw error;
  if (p.conteudo != null) {
    const membroIds = extractMentionsFromDoc(p.conteudo)
      .filter((ref) => ref.entityType === 'membro')
      .map((ref) => ref.id);
    await syncMentions('workflow_post', data.id, membroIds);
  }
  return data;
}

export async function updateWorkflowPost(
  id: number,
  p: Partial<Omit<WorkflowPost, 'id' | 'conta_id' | 'workflow_id' | 'created_at' | 'updated_at'>>,
): Promise<WorkflowPost> {
  const { data, error } = await supabase
    .from('workflow_posts')
    .update(p)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  if ('conteudo' in p) {
    const membroIds = extractMentionsFromDoc(p.conteudo)
      .filter((ref) => ref.entityType === 'membro')
      .map((ref) => ref.id);
    await syncMentions('workflow_post', id, membroIds);
  }
  return data;
}

export async function removeWorkflowPost(id: number): Promise<void> {
  const { error } = await supabase.from('workflow_posts').delete().eq('id', id);
  if (error) throw error;
}

export async function reorderWorkflowPosts(
  updates: { id: number; ordem: number }[],
): Promise<void> {
  await Promise.all(
    updates.map(({ id, ordem }) =>
      supabase
        .from('workflow_posts')
        .update({ ordem })
        .eq('id', id)
        .then(({ error }) => {
          if (error) throw error;
        }),
    ),
  );
}

export async function createPropertyDefinition(
  templateId: number,
  payload: Omit<TemplatePropertyDefinition, 'id' | 'template_id' | 'conta_id' | 'created_at'>,
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
  payload: Partial<
    Omit<TemplatePropertyDefinition, 'id' | 'template_id' | 'conta_id' | 'created_at'>
  >,
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
  value: unknown,
): Promise<void> {
  const { error } = await supabase.from('post_property_values').upsert(
    {
      post_id: postId,
      property_definition_id: definitionId,
      value,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'post_id,property_definition_id' },
  );
  if (error) throw error;
}

export async function createWorkflowSelectOption(
  workflowId: number,
  definitionId: number,
  label: string,
  color: string,
): Promise<WorkflowSelectOption> {
  const conta_id = await getContaId();
  const { data, error } = await supabase
    .from('workflow_select_options')
    .insert({
      workflow_id: workflowId,
      property_definition_id: definitionId,
      label,
      color,
      conta_id,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getWorkflowSelectOptions(
  workflowId: number,
  definitionId: number,
): Promise<WorkflowSelectOption[]> {
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

/**
 * Re-arm the next client-approval cycle (multi-approval fluxos): posts the client already
 * approved go back to rascunho so a later aprovacao_cliente etapa can send them to the
 * portal again. Scheduled/posted/failed posts are never touched. Mirrors the manual
 * workaround agencies use for double-approval flows; post_approvals history is preserved.
 */
export async function resetApprovedPostsForNextCycle(workflowId: number): Promise<void> {
  const { error } = await supabase
    .from('workflow_posts')
    .update({ status: 'rascunho' })
    .eq('workflow_id', workflowId)
    .eq('status', 'aprovado_cliente');
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

export async function getPostStatusEvents(postIds: number[]): Promise<PostStatusEvent[]> {
  if (postIds.length === 0) return [];
  const { data, error } = await supabase
    .from('post_status_events')
    .select(
      'id, post_id, from_status, to_status, source, actor_user_id, actor_name, post_approval_id, from_custom_status_id, to_custom_status_id, from_custom_nome, to_custom_nome, created_at',
    )
    .in('post_id', postIds)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function replyToPostApproval(
  postId: number,
  _workflowId: number,
  comentario: string,
): Promise<void> {
  const author_user_id = await getUserId();
  const { error } = await supabase.from('post_approvals').insert({
    post_id: postId,
    token: null,
    action: 'mensagem',
    comentario,
    is_workspace_user: true,
    author_user_id,
  });
  if (error) throw error;
}

// =============================================
// POST EDIT SUGGESTIONS
// =============================================

export interface PostEditSuggestion {
  id: number;
  post_id: number;
  suggested_conteudo: Record<string, unknown> | null;
  suggested_conteudo_plain: string;
  suggested_ig_caption: string | null;
  changed_fields: string[];
  status: 'pending' | 'accepted' | 'rejected';
  updated_at: string;
}

export async function getPostEditSuggestions(postIds: number[]): Promise<PostEditSuggestion[]> {
  if (postIds.length === 0) return [];
  const { data, error } = await supabase
    .from('post_edit_suggestions')
    .select(
      'id, post_id, suggested_conteudo, suggested_conteudo_plain, suggested_ig_caption, changed_fields, status, updated_at',
    )
    .in('post_id', postIds)
    .eq('status', 'pending');
  if (error) throw error;
  return data || [];
}

export async function acceptEditSuggestion(id: number): Promise<void> {
  const { error } = await supabase.rpc('accept_edit_suggestion', { p_suggestion_id: id });
  if (error) throw error;
}

export async function rejectEditSuggestion(id: number): Promise<void> {
  const { error } = await supabase.rpc('reject_edit_suggestion', { p_suggestion_id: id });
  if (error) throw error;
}

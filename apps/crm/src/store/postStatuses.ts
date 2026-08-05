import { supabase, getContaId } from './core';
import type { WorkflowPost } from './posts';

// =============================================
// CUSTOM POST STATUSES (post_status_definitions)
// =============================================
// Workspace-defined statuses layered over the canonical pipeline. Each one
// "behaves as" a non-machine canonical status; the DB z1 trigger keeps
// workflow_posts.status in sync with the pointed definition (migration
// 20260805000001). Writes are owner/admin-gated by RLS and the
// feature_custom_properties plan trigger; catch feature_disabled errors at
// the component with handleEntitlementMutationError (no edge function in
// the path, so App.tsx's MutationCache.onError never sees them).

/** Canonical statuses a custom status may behave as (machine statuses excluded). */
export type CustomStatusBehavesAs = Exclude<
  WorkflowPost['status'],
  'agendado' | 'postado' | 'falha_publicacao'
>;

export interface PostStatusDefinition {
  id: string;
  conta_id: string;
  nome: string;
  cor: string;
  behaves_as: CustomStatusBehavesAs;
  ordem: number;
  arquivado: boolean;
  created_at: string;
  updated_at: string;
}

export async function getPostStatusDefinitions(opts?: {
  includeArchived?: boolean;
}): Promise<PostStatusDefinition[]> {
  let query = supabase
    .from('post_status_definitions')
    .select('*')
    .order('ordem', { ascending: true })
    .order('nome', { ascending: true });
  if (!opts?.includeArchived) query = query.eq('arquivado', false);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function createPostStatusDefinition(
  payload: Pick<PostStatusDefinition, 'nome' | 'cor' | 'behaves_as' | 'ordem'>,
): Promise<PostStatusDefinition> {
  const conta_id = await getContaId();
  const { data, error } = await supabase
    .from('post_status_definitions')
    .insert({ ...payload, conta_id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updatePostStatusDefinition(
  id: string,
  payload: Partial<Pick<PostStatusDefinition, 'nome' | 'cor' | 'behaves_as' | 'ordem'>>,
): Promise<PostStatusDefinition> {
  const { data, error } = await supabase
    .from('post_status_definitions')
    .update(payload)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Archive a definition. The DB trigger post_status_definitions_detach_posts
 * atomically clears custom_status_id on pointing posts; each keeps its
 * canonical status (it deterministically "falls back" to the behaves_as
 * column it was already in).
 */
export async function archivePostStatusDefinition(id: string): Promise<void> {
  const { error } = await supabase
    .from('post_status_definitions')
    .update({ arquivado: true })
    .eq('id', id);
  if (error) throw error;
}

/** Hard delete. The detach trigger clears posts pre-delete (snapshotting the
 * nome into the audit log); automations targeting it cascade-delete. */
export async function deletePostStatusDefinition(id: string): Promise<void> {
  const { error } = await supabase.from('post_status_definitions').delete().eq('id', id);
  if (error) throw error;
}

// =============================================
// STATUS-ENTRY AUTOMATIONS (post_status_automations)
// =============================================
// Rules fired by the z2 DB trigger when a post ENTERS a status (canonical or
// custom). Ships in the automations migration (PR4); the store API lands
// with it. Config shapes:
//   notify:             { target: 'member', membro_id } |
//                       { target: 'responsavel' } |
//                       { target: 'roles', roles: ['owner','admin'] }
//   assign_responsavel: { membro_id }

export type PostStatusAutomationAction = 'notify' | 'assign_responsavel';

export type PostStatusAutomationConfig =
  | { target: 'member'; membro_id: number }
  | { target: 'responsavel' }
  | { target: 'roles'; roles: string[] }
  | { membro_id: number };

export interface PostStatusAutomation {
  id: string;
  conta_id: string;
  /** Exactly one of trigger_status / trigger_custom_status_id is set (DB CHECK). */
  trigger_status: WorkflowPost['status'] | null;
  trigger_custom_status_id: string | null;
  action_type: PostStatusAutomationAction;
  config: PostStatusAutomationConfig;
  ativo: boolean;
  created_at: string;
  updated_at: string;
}

export async function getPostStatusAutomations(): Promise<PostStatusAutomation[]> {
  const { data, error } = await supabase
    .from('post_status_automations')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createPostStatusAutomation(
  payload: Pick<
    PostStatusAutomation,
    'trigger_status' | 'trigger_custom_status_id' | 'action_type' | 'config'
  > &
    Partial<Pick<PostStatusAutomation, 'ativo'>>,
): Promise<PostStatusAutomation> {
  const conta_id = await getContaId();
  const { data, error } = await supabase
    .from('post_status_automations')
    .insert({ ...payload, conta_id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updatePostStatusAutomation(
  id: string,
  payload: Partial<
    Pick<
      PostStatusAutomation,
      'trigger_status' | 'trigger_custom_status_id' | 'action_type' | 'config' | 'ativo'
    >
  >,
): Promise<PostStatusAutomation> {
  const { data, error } = await supabase
    .from('post_status_automations')
    .update(payload)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deletePostStatusAutomation(id: string): Promise<void> {
  const { error } = await supabase.from('post_status_automations').delete().eq('id', id);
  if (error) throw error;
}

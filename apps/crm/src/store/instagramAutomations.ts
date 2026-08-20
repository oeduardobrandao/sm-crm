import { supabase, getContaId } from './core';

// =============================================
// INSTAGRAM COMMENT-TO-DM AUTOMATIONS (instagram_comment_automations)
// =============================================
// Workspace-defined rules: a keyword match on a comment under a given IG
// media triggers a DM (and optional public reply). Requires the connected
// IG account to hold instagram_business_manage_comments and an active
// comments webhook subscription -- see IgAccountStatus.canAutomate in
// './integrations'.

export interface InstagramCommentAutomation {
  id: string;
  conta_id: string;
  client_id: number;
  name: string;
  ig_media_id: string | null;
  media_permalink: string | null;
  media_caption: string | null;
  /** Internal `workflow_posts.id` when the target is a post that has not been
   * published yet. A DB trigger fills `ig_media_id` in once it publishes, so the
   * "linked" state carries both. */
  workflow_post_id: number | null;
  /** Tombstone: set when the targeted production post was deleted before it ever
   * published. The DB forces `ativo = false` alongside it and refuses to clear it
   * unless the same write supplies a new target. Detect a tombstone by THIS field
   * only, never by a null `ig_media_id`. */
  pending_post_deleted_at: string | null;
  keywords: string[];
  dm_message: string;
  public_reply: string | null;
  ativo: boolean;
  dms_sent_count: number;
  last_triggered_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface InstagramAutomationSend {
  id: string;
  comment_id: string;
  automation_id: string;
  conta_id: string;
  media_id: string | null;
  commenter_id: string | null;
  commenter_username: string | null;
  comment_text: string | null;
  comment_created_at: string;
  status: 'processing' | 'retry' | 'sent' | 'sent_partial' | 'failed' | 'skipped';
  skip_reason: string | null;
  error_code: string | null;
  dm_status: 'sent' | 'failed' | null;
  public_reply_status: 'sent' | 'failed' | 'unknown' | null;
  attempts: number;
  created_at: string;
}

export async function getInstagramAutomations(): Promise<InstagramCommentAutomation[]> {
  const { data, error } = await supabase
    .from('instagram_comment_automations')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createInstagramAutomation(
  payload: Pick<
    InstagramCommentAutomation,
    | 'client_id'
    | 'name'
    | 'ig_media_id'
    | 'media_permalink'
    | 'media_caption'
    | 'workflow_post_id'
    | 'keywords'
    | 'dm_message'
    | 'public_reply'
  >,
): Promise<InstagramCommentAutomation> {
  const conta_id = await getContaId();
  const { data, error } = await supabase
    .from('instagram_comment_automations')
    .insert({ ...payload, conta_id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Every field is optional, and omission is meaningful: `pending_post_deleted_at`
 * belongs in the patch ONLY when clearing a tombstone (send `null` together with
 * the new target). Sending it on an ordinary edit would resurrect an automation
 * the DB deliberately parked.
 */
export async function updateInstagramAutomation(
  id: string,
  payload: Partial<
    Pick<
      InstagramCommentAutomation,
      | 'name'
      | 'ig_media_id'
      | 'media_permalink'
      | 'media_caption'
      | 'workflow_post_id'
      | 'pending_post_deleted_at'
      | 'keywords'
      | 'dm_message'
      | 'public_reply'
      | 'ativo'
    >
  >,
): Promise<InstagramCommentAutomation> {
  const { data, error } = await supabase
    .from('instagram_comment_automations')
    .update(payload)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteInstagramAutomation(id: string): Promise<void> {
  const { error } = await supabase.from('instagram_comment_automations').delete().eq('id', id);
  if (error) throw error;
}

export async function getInstagramAutomationSends(
  automationId: string,
  limit = 20,
): Promise<InstagramAutomationSend[]> {
  const { data, error } = await supabase
    .from('instagram_automation_sends')
    .select('*')
    .eq('automation_id', automationId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function countInstagramAutomations(): Promise<number> {
  const { count, error } = await supabase
    .from('instagram_comment_automations')
    .select('*', { count: 'exact', head: true });
  if (error) throw error;
  return count ?? 0;
}

import { supabase, getContaId } from './core';

// =============================================
// INSTAGRAM COMMENT-TO-DM AUTOMATIONS (instagram_comment_automations)
// =============================================
// Workspace-defined rules: a keyword match on a comment under a given IG
// media triggers a DM (and optional public reply). Requires the connected
// IG account to hold instagram_business_manage_comments and an active
// comments webhook subscription -- see IgAccountStatus.canAutomate in
// './integrations'.

// Botao de link na DM (button template da Meta). Guardado em
// instagram_comment_automations.dm_buttons (jsonb, 0..3 itens, CHECK no banco).
export interface DmButton {
  title: string;
  url: string;
}

// Mídia do cartão de DM (generic template). Espelha o formato validado por
// validate_ig_dm_media (migration 20260901000014): key SEMPRE em
// automation-media/<conta_id>/..., content_type restrito, size_bytes em
// bytes, width/height opcionais e só presentacionais.
export interface DmMedia {
  key: string;
  content_type: string;
  size_bytes: number;
  width?: number;
  height?: number;
}

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
  dm_buttons: DmButton[];
  /** Mídia do cartão (opcional). Com mídia, dm_message vira o TÍTULO do
   * cartão (limite de 80, imposto pelo CHECK ica_dm_message_len_with_media). */
  dm_media: DmMedia | null;
  /** Subtítulo do cartão. Só existe junto de dm_media -- ver
   * ica_dm_subtitle_with_media. */
  dm_subtitle: string | null;
  public_reply: string | null;
  public_replies: string[];
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
  dm_kind:
    | 'text'
    | 'buttons'
    | 'buttons_fallback_text'
    | 'card'
    | 'card_fallback_buttons'
    | 'card_fallback_text'
    | null;
  public_reply_status: 'sent' | 'failed' | 'unknown' | null;
  public_reply_text: string | null;
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

/**
 * Every automation attached to one post of the editor, in creation order.
 *
 * Two columns can point at the same post and only one of them survives the
 * publish: an automation created while the post was still in production carries
 * `workflow_post_id`, one created straight against the live media carries
 * `ig_media_id`. Once the post publishes, the DB trigger fills `ig_media_id` in
 * next to the existing `workflow_post_id`, so the OR (not an AND) is what keeps
 * both kinds visible on the same post.
 *
 * `igMediaId` is a Graph API media id we stored ourselves, never user input, so
 * it goes into the PostgREST filter grammar as-is.
 */
export async function getAutomationsForPost(
  postId: number,
  igMediaId: string | null,
): Promise<InstagramCommentAutomation[]> {
  const base = supabase.from('instagram_comment_automations').select('*');
  const filtered = igMediaId
    ? base.or(`workflow_post_id.eq.${postId},ig_media_id.eq.${igMediaId}`)
    : base.eq('workflow_post_id', postId);
  const { data, error } = await filtered.order('created_at', { ascending: true });
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
    | 'dm_buttons'
    | 'dm_media'
    | 'dm_subtitle'
    | 'public_reply'
    | 'public_replies'
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
      | 'dm_buttons'
      | 'dm_media'
      | 'dm_subtitle'
      | 'public_reply'
      | 'public_replies'
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

/** Sinal do checklist de primeiros passos: TRUE quando pelo menos uma conta IG
 * do workspace satisfaz a elegibilidade tripla do processador de automações
 * (active + os dois escopos + subscription de comentários) — o mesmo trio de
 * condições da claim RPC (migration 20260815000007). RLS limita ao workspace. */
export async function hasAutomationReadyAccount(): Promise<boolean> {
  const { data, error } = await supabase
    .from('instagram_accounts')
    .select('id')
    .eq('authorization_status', 'active')
    .contains('permissions', [
      'instagram_business_manage_comments',
      'instagram_business_manage_messages',
    ])
    .not('comments_subscribed_at', 'is', null)
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

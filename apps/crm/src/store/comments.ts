import { supabase, getCurrentProfile } from './core';
import { extractMentionsFromText } from '@/components/mentions/mentionTokens';
import { syncMentions } from './mentions';

function membroMentionIds(text: string): number[] {
  return extractMentionsFromText(text)
    .filter((ref) => ref.entityType === 'membro')
    .map((ref) => ref.id);
}

export interface CommentThread {
  id: number;
  post_id: number;
  conta_id: string;
  quoted_text: string;
  status: 'active' | 'resolved';
  created_by: string;
  resolved_by: string | null;
  created_at: string;
  resolved_at: string | null;
  /**
   * 'conteudo' = TipTap mark inside conteudo; 'ig_caption' = offsets into ig_caption;
   * 'geral' = the post's single general discussion thread (no anchor, never resolved).
   */
  field: 'conteudo' | 'ig_caption' | 'geral';
  /** UTF-16 code-unit offsets into ig_caption. Null for 'conteudo' threads and orphans. */
  anchor_start: number | null;
  anchor_end: number | null;
  /** Caption threads only: the anchored passage no longer exists in the caption. */
  orphaned: boolean;
}

export interface CommentAnchor {
  field: 'ig_caption';
  start: number;
  end: number;
}

/** One entry of save_ig_caption's `p_anchors`. Orphans carry null offsets and no quoted_text. */
export interface CaptionAnchorPatch {
  id: number;
  anchor_start: number | null;
  anchor_end: number | null;
  orphaned: boolean;
  quoted_text?: string;
}

export interface PostComment {
  id: number;
  thread_id: number;
  author_id: string;
  content: string;
  created_at: string;
  updated_at: string | null;
}

export interface CommentThreadWithComments extends CommentThread {
  post_comments: PostComment[];
}

// ── Inline comment threads ──────────────────────────────────────

export async function getPostCommentThreads(
  postIds: number[],
): Promise<CommentThreadWithComments[]> {
  if (postIds.length === 0) return [];
  const { data, error } = await supabase
    .from('post_comment_threads')
    .select('*, post_comments(*)')
    .in('post_id', postIds)
    .order('created_at', { ascending: true });
  if (error) throw error;
  const threads = (data || []) as CommentThreadWithComments[];
  for (const t of threads) {
    t.post_comments.sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
  }
  return threads;
}

export async function createCommentThread(
  postId: number,
  quotedText: string,
  firstComment: string,
  anchor?: CommentAnchor,
): Promise<CommentThreadWithComments> {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error('No profile');

  const { data: thread, error: threadErr } = await supabase
    .from('post_comment_threads')
    .insert({
      post_id: postId,
      conta_id: profile.conta_id,
      quoted_text: quotedText,
      created_by: profile.id,
      ...(anchor
        ? { field: anchor.field, anchor_start: anchor.start, anchor_end: anchor.end }
        : {}),
    })
    .select()
    .single();
  if (threadErr) throw threadErr;

  const { data: comment, error: commentErr } = await supabase
    .from('post_comments')
    .insert({
      thread_id: thread.id,
      author_id: profile.id,
      content: firstComment,
    })
    .select()
    .single();
  if (commentErr) throw commentErr;

  await syncMentions('post_comment', comment.id, membroMentionIds(firstComment));

  return { ...thread, post_comments: [comment] } as CommentThreadWithComments;
}

/** Longest message `post_discussao_enviar` accepts (it raises `content_too_long` above it). */
export const DISCUSSAO_MAX_CHARS = 4000;

/**
 * Sends a message to the post's internal discussion through `post_discussao_enviar`.
 * Without `threadId` it lands in the general thread (created on the first message); with one
 * it replies in an active passage thread of the same post. Mentions are synced inside the
 * RPC's transaction, so there is no client-side `syncMentions` here.
 */
export async function sendDiscussaoMessage(
  postId: number,
  content: string,
  threadId?: number,
): Promise<PostComment> {
  const { data, error } = await supabase.rpc('post_discussao_enviar', {
    p_post_id: postId,
    p_content: content,
    p_thread_id: threadId ?? null,
  });
  if (error) throw error;
  return data as PostComment;
}

/** Reply in a passage thread. Delegates to the discussion RPC (mentions are synced server side). */
export async function addPostComment(
  postId: number,
  threadId: number,
  content: string,
): Promise<PostComment> {
  return sendDiscussaoMessage(postId, content, threadId);
}

/** Moves the caller's read watermark for the post's discussion up to `commentId`. */
export async function markDiscussaoLida(postId: number, commentId: number): Promise<void> {
  const { error } = await supabase.rpc('post_discussao_marcar_lido', {
    p_post_id: postId,
    p_comment_id: commentId,
  });
  if (error) throw error;
}

export async function setDiscussaoSeguindo(postId: number, seguir: boolean): Promise<void> {
  const { error } = await supabase.rpc('post_discussao_seguir', {
    p_post_id: postId,
    p_seguir: seguir,
  });
  if (error) throw error;
}

export interface DiscussaoParticipacao {
  seguindo: boolean;
  lastSeenCommentId: number;
  /** True for the post's responsible who has no participation row yet. */
  implicito: boolean;
}

export async function getDiscussaoParticipacao(postId: number): Promise<DiscussaoParticipacao> {
  const { data, error } = await supabase.rpc('get_post_discussao_participacao', {
    p_post_id: postId,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as {
    seguindo: boolean;
    last_seen_comment_id: number | string;
    implicito: boolean;
  } | null;
  if (!row) return { seguindo: false, lastSeenCommentId: 0, implicito: false };
  return {
    seguindo: !!row.seguindo,
    lastSeenCommentId: Number(row.last_seen_comment_id) || 0,
    implicito: !!row.implicito,
  };
}

export interface DiscussaoNaoLidas {
  postId: number;
  workflowId: number | null;
  total: number;
  naoLidas: number;
}

/**
 * Discussion totals and unread counts, by post and/or by workflow. Both lists empty means
 * nothing to ask: returns `[]` without calling the RPC (a NULL/NULL call would be the
 * whole workspace).
 */
export async function getDiscussaoNaoLidas(args: {
  postIds?: number[];
  workflowIds?: number[];
}): Promise<DiscussaoNaoLidas[]> {
  const postIds = args.postIds ?? [];
  const workflowIds = args.workflowIds ?? [];
  if (postIds.length === 0 && workflowIds.length === 0) return [];
  const { data, error } = await supabase.rpc('get_post_discussao_nao_lidas', {
    p_post_ids: postIds.length > 0 ? postIds : null,
    p_workflow_ids: workflowIds.length > 0 ? workflowIds : null,
  });
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    postId: Number(r.post_id),
    workflowId: r.workflow_id == null ? null : Number(r.workflow_id),
    total: Number(r.total) || 0,
    naoLidas: Number(r.nao_lidas) || 0,
  }));
}

/** The post's general discussion thread (as opposed to a thread anchored to a passage). */
export function isGeralThread(t: CommentThread): boolean {
  return t.field === 'geral';
}

export async function updatePostComment(commentId: number, content: string): Promise<void> {
  const { error } = await supabase
    .from('post_comments')
    .update({ content, updated_at: new Date().toISOString() })
    .eq('id', commentId);
  if (error) throw error;
  await syncMentions('post_comment', commentId, membroMentionIds(content));
}

export async function deletePostComment(commentId: number): Promise<void> {
  const { error } = await supabase.from('post_comments').delete().eq('id', commentId);
  if (error) throw error;
}

export async function resolveCommentThread(threadId: number): Promise<void> {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error('No profile');
  const { error } = await supabase
    .from('post_comment_threads')
    .update({ status: 'resolved', resolved_by: profile.id, resolved_at: new Date().toISOString() })
    .eq('id', threadId);
  if (error) throw error;
}

export async function reopenCommentThread(threadId: number): Promise<void> {
  const { error } = await supabase
    .from('post_comment_threads')
    .update({ status: 'active', resolved_by: null, resolved_at: null })
    .eq('id', threadId);
  if (error) throw error;
}

export async function deleteCommentThread(threadId: number): Promise<void> {
  const { error } = await supabase.from('post_comment_threads').delete().eq('id', threadId);
  if (error) throw error;
}

/**
 * Saves the Instagram caption AND re-anchors its comment threads in one
 * transaction (RPC), so re-anchored offsets never describe text the DB doesn't hold.
 * Thread creation (`createCommentThread`) is not range-checked against the caption: the UI
 * flushes and re-verifies the quoted slice first, and `validateAnchors` orphans a stray one.
 *
 * `anchors` must contain ONLY this post's `ig_caption` threads. The RPC range-checks every
 * non-orphaned entry (`anchor_end` <= UTF-16 length of the caption) BEFORE it filters by
 * post/field, so a foreign or stale entry aborts the whole save (`anchor_out_of_range`)
 * and rolls the caption back too.
 */
export async function saveIgCaption(
  postId: number,
  caption: string,
  anchors: CaptionAnchorPatch[],
): Promise<void> {
  const { error } = await supabase.rpc('save_ig_caption', {
    p_post_id: postId,
    p_caption: caption,
    p_anchors: anchors,
  });
  if (error) throw error;
}

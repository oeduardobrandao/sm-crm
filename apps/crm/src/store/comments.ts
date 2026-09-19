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
  /** 'conteudo' = TipTap mark inside conteudo; 'ig_caption' = offsets into ig_caption. */
  field: 'conteudo' | 'ig_caption';
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

export async function addPostComment(threadId: number, content: string): Promise<PostComment> {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error('No profile');
  const { data, error } = await supabase
    .from('post_comments')
    .insert({ thread_id: threadId, author_id: profile.id, content })
    .select()
    .single();
  if (error) throw error;
  await syncMentions('post_comment', data.id, membroMentionIds(content));
  return data as PostComment;
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
 * transaction (RPC), so the stored offsets can never describe text the DB doesn't hold.
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

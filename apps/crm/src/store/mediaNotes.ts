import { supabase, getContaId, getUserId } from './core';
import { isMissingRelationError } from './missingRelation';

// Feedback em mídia: notas fixadas num slide, momento de vídeo e/ou ponto da mídia.
// Importado por caminho, NÃO re-exportado de store/index.ts, para que os testes de
// drawer que mockam '@/store' não sejam afetados.

export interface MediaNoteReply {
  id: number;
  note_id: number;
  author_kind: 'client' | 'team';
  author_user_id: string | null;
  body: string;
  created_at: string;
}

export interface MediaNote {
  id: number;
  post_id: number;
  media_kind: 'image' | 'video';
  visibility: 'client' | 'internal';
  author_kind: 'client' | 'team';
  author_user_id: string | null;
  current_link_id: number | null;
  current_slide_index: number | null;
  slide_index_at_creation: number;
  is_previous_version: boolean;
  t_seconds: number | null;
  x: number | null;
  y: number | null;
  body: string;
  status: 'open' | 'resolved';
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  replies: MediaNoteReply[];
}

// Listas explícitas de colunas: a view e a tabela de respostas carregam `hub_token`
// (credencial do cliente no Hub), que nunca pode chegar ao CRM. Sem `select('*')`.
const NOTE_COLUMNS =
  'id, post_id, media_kind, visibility, author_kind, author_user_id, current_link_id, current_slide_index, slide_index_at_creation, is_previous_version, t_seconds, x, y, body, status, resolved_by, resolved_at, created_at';
const REPLY_COLUMNS = 'id, note_id, author_kind, author_user_id, body, created_at';

export const mediaNotesKey = (postIds: number[]) => ['media-notes', postIds.join(',')] as const;

export async function getMediaNotes(postIds: number[]): Promise<MediaNote[]> {
  if (postIds.length === 0) return [];
  const { data, error } = await supabase
    .from('post_media_notes_v')
    .select(NOTE_COLUMNS)
    .in('post_id', postIds)
    .order('created_at', { ascending: true });
  // Frontend deployed before migration 20261025000001: no notes yet, not an error.
  if (error && isMissingRelationError(error, 'post_media_notes_v')) return [];
  if (error) throw error;
  const rows = (data || []) as Omit<MediaNote, 'replies'>[];
  if (rows.length === 0) return [];

  const { data: replyData, error: replyError } = await supabase
    .from('post_media_note_replies')
    .select(REPLY_COLUMNS)
    .in(
      'note_id',
      rows.map((n) => n.id),
    )
    .order('created_at', { ascending: true });
  if (replyError) throw replyError;

  const byNote = new Map<number, MediaNoteReply[]>();
  for (const reply of (replyData || []) as MediaNoteReply[]) {
    const list = byNote.get(reply.note_id);
    if (list) list.push(reply);
    else byNote.set(reply.note_id, [reply]);
  }
  return rows.map((n) => ({ ...n, replies: byNote.get(n.id) ?? [] }));
}

export async function createInternalMediaNote(input: {
  postId: number;
  linkId: number;
  tSeconds?: number;
  x?: number;
  y?: number;
  body: string;
}): Promise<number> {
  const { data, error } = await supabase.rpc('create_team_media_note', {
    p_post_id: input.postId,
    p_link_id: input.linkId,
    p_t_seconds: input.tSeconds ?? null,
    p_x: input.x ?? null,
    p_y: input.y ?? null,
    p_body: input.body,
  });
  if (error) throw error;
  return data as number;
}

export async function replyToMediaNote(noteId: number, body: string): Promise<void> {
  const [authorUserId, contaId] = await Promise.all([getUserId(), getContaId()]);
  const { error } = await supabase.from('post_media_note_replies').insert({
    note_id: noteId,
    conta_id: contaId,
    author_kind: 'team',
    author_user_id: authorUserId,
    body,
  });
  if (error) throw error;
}

/** Só a coluna `status` é gravável; resolved_by/resolved_at saem do trigger. */
export async function setMediaNoteStatus(
  noteIds: number[],
  status: 'open' | 'resolved',
): Promise<void> {
  if (noteIds.length === 0) return;
  const { error } = await supabase.from('post_media_notes').update({ status }).in('id', noteIds);
  if (error) throw error;
}

/** Notas abertas, da versão atual da mídia, fixadas nesse link. */
export function openNotesOnLink(notes: MediaNote[], linkId: number): MediaNote[] {
  return notes.filter(
    (n) => n.status === 'open' && !n.is_previous_version && n.current_link_id === linkId,
  );
}

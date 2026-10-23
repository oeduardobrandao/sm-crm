import type { MediaNote } from '@/store/mediaNotes';
import type { PostApproval } from '@/store/posts';

export function makeNote(over: Partial<MediaNote> = {}): MediaNote {
  return {
    id: 1,
    post_id: 42,
    media_kind: 'image',
    visibility: 'client',
    author_kind: 'client',
    author_user_id: null,
    current_link_id: 5,
    current_slide_index: 0,
    slide_index_at_creation: 0,
    is_previous_version: false,
    t_seconds: null,
    x: null,
    y: null,
    body: 'Trocar a cor',
    status: 'open',
    resolved_by: null,
    resolved_at: null,
    created_at: '2026-10-22T10:00:00Z',
    replies: [],
    ...over,
  };
}

export function makeApproval(over: Partial<PostApproval> = {}): PostApproval {
  return {
    id: 1,
    post_id: 42,
    token: 't',
    action: 'aprovado',
    comentario: null,
    is_workspace_user: false,
    author_user_id: null,
    media_note_ids: [],
    created_at: '2026-10-22T12:00:00Z',
    ...over,
  };
}

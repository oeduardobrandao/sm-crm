import { describe, expect, it } from 'vitest';
import type { MediaNote } from '@/store/mediaNotes';
import type { PostApproval, PostMedia } from '@/store/posts';
import { buildConversationItems, noteAnchorLabel } from '../conversationItems';

function note(over: Partial<MediaNote> = {}): MediaNote {
  return {
    id: 1,
    post_id: 10,
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

function approval(over: Partial<PostApproval> = {}): PostApproval {
  return {
    id: 1,
    post_id: 10,
    token: 't',
    action: 'mensagem',
    comentario: 'Oi',
    is_workspace_user: false,
    author_user_id: null,
    media_note_ids: [],
    created_at: '2026-10-22T09:00:00Z',
    ...over,
  };
}

const media = [{ id: 5 }, { id: 6 }] as PostMedia[];

describe('buildConversationItems', () => {
  it('interleaves chronologically and excludes internal notes', () => {
    const items = buildConversationItems(
      [
        approval({ id: 1, created_at: '2026-10-22T09:00:00Z' }),
        approval({ id: 2, created_at: '2026-10-22T12:00:00Z' }),
      ],
      [
        note({ id: 1, created_at: '2026-10-22T10:00:00Z' }),
        note({
          id: 2,
          created_at: '2026-10-22T11:00:00Z',
          visibility: 'internal',
          author_kind: 'team',
        }),
      ],
      media,
    );
    expect(items.map((i) => i.key)).toEqual(['a-1', 'n-1', 'a-2']);
  });

  it('attaches the snapshot summary to a correction', () => {
    const items = buildConversationItems(
      [approval({ id: 1, action: 'correcao', media_note_ids: [1, 2] })],
      [
        note({ id: 1, current_slide_index: 2 }),
        note({ id: 2, current_slide_index: 3, created_at: '2026-10-22T10:30:00Z' }),
      ],
      media,
    );
    const first = items.find((i) => i.kind === 'approval');
    expect(first?.kind === 'approval' && first.noteSummary).toBe(
      '2 comentários na mídia em aberto: slides 3, 4',
    );
    expect(first?.kind === 'approval' && first.openCommentsLabel).toBeUndefined();
  });

  it('aprovado with snapshot gets the open-comments label', () => {
    const items = buildConversationItems(
      [approval({ id: 1, action: 'aprovado', media_note_ids: [1, 2] })],
      [note({ id: 1 }), note({ id: 2, current_slide_index: 1 })],
      media,
    );
    const a = items[0];
    expect(a.kind === 'approval' && a.openCommentsLabel).toBe(
      'Aprovado com 2 comentários em aberto',
    );
  });

  it('aprovado without snapshot has no label', () => {
    const items = buildConversationItems([approval({ action: 'aprovado' })], [], media);
    const a = items[0];
    expect(a.kind === 'approval' && a.openCommentsLabel).toBeUndefined();
    expect(a.kind === 'approval' && a.noteSummary).toBeUndefined();
  });
});

describe('noteAnchorLabel', () => {
  it('numbers pins per slide', () => {
    const n1 = note({ id: 1, x: 0.1, y: 0.1, created_at: '2026-10-22T10:00:00Z' });
    const n2 = note({ id: 2, x: 0.2, y: 0.2, created_at: '2026-10-22T10:05:00Z' });
    const other = note({ id: 3, x: 0.2, y: 0.2, current_link_id: 6, current_slide_index: 1 });
    const all = [n1, n2, other];
    expect(noteAnchorLabel(n1, all, media)).toBe('Slide 1 · ponto 1');
    expect(noteAnchorLabel(n2, all, media)).toBe('Slide 1 · ponto 2');
    expect(noteAnchorLabel(other, all, media)).toBe('Slide 2 · ponto 1');
  });

  it('formats video moments and previous versions', () => {
    expect(noteAnchorLabel(note({ media_kind: 'video', t_seconds: 42 }), [], media)).toBe('0:42');
    expect(
      noteAnchorLabel(
        note({
          current_link_id: null,
          current_slide_index: null,
          slide_index_at_creation: 2,
          is_previous_version: true,
        }),
        [],
        media,
      ),
    ).toBe('Slide 3 (versão anterior)');
  });
});

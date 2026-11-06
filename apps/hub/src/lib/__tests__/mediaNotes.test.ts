import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import pt from '../../../../../packages/i18n/locales/pt/hubPosts.json';
import type { HubMediaNote, HubPost } from '../../types';
import {
  anchorLabel,
  canWriteNotes,
  notesForPost,
  openCountByLink,
  openNoteCount,
} from '../mediaNotes';

function note(over: Partial<HubMediaNote> = {}): HubMediaNote {
  return {
    id: 1,
    post_id: 10,
    media_kind: 'image',
    link_id: 100,
    slide_index: 0,
    is_previous_version: false,
    t_seconds: null,
    x: null,
    y: null,
    author: 'client',
    author_name: null,
    body: 'b',
    status: 'open',
    resolved_at: null,
    created_at: '2026-10-23T00:00:00Z',
    replies: [],
    ...over,
  };
}

const post = (over: Partial<HubPost> = {}) =>
  ({ id: 10, status: 'enviado_cliente', em_producao: null, ...over }) as HubPost;

/** Interpolates the real pt copy, enough to assert the final label. */
const t = ((key: string, opts?: Record<string, unknown>) => {
  const raw = key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], pt);
  return String(raw).replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts?.[k]));
}) as unknown as TFunction<'hubPosts'>;

describe('notesForPost', () => {
  it('keeps only the post notes', () => {
    const all = [note({ id: 1, post_id: 10 }), note({ id: 2, post_id: 11 })];
    expect(notesForPost(all, 10).map((n) => n.id)).toEqual([1]);
  });
});

describe('openNoteCount', () => {
  it('counts open notes including previous-version ones', () => {
    const notes = [
      note({ id: 1 }),
      note({ id: 2, status: 'resolved' }),
      note({ id: 3, is_previous_version: true, link_id: null }),
    ];
    expect(openNoteCount(notes)).toBe(2);
  });
});

describe('openCountByLink', () => {
  it('ignores resolved and previous-version notes', () => {
    const notes = [
      note({ id: 1, link_id: 100 }),
      note({ id: 2, link_id: 100 }),
      note({ id: 3, link_id: 101, status: 'resolved' }),
      note({ id: 4, link_id: null, is_previous_version: true }),
      note({ id: 5, link_id: 102 }),
    ];
    expect(openCountByLink(notes)).toEqual(
      new Map([
        [100, 2],
        [102, 1],
      ]),
    );
  });
});

describe('canWriteNotes', () => {
  it.each([
    'enviado_cliente',
    'aprovado_cliente',
    'correcao_cliente',
    'agendado',
    'postado',
    'falha_publicacao',
  ])('is true for %s', (status) => {
    expect(canWriteNotes(post({ status: status as HubPost['status'] }))).toBe(true);
  });

  it('is false for rascunho and the internal statuses', () => {
    expect(canWriteNotes(post({ status: 'rascunho' }))).toBe(false);
    expect(canWriteNotes(post({ status: 'revisao_interna' }))).toBe(false);
    expect(canWriteNotes(post({ status: 'aprovado_interno' }))).toBe(false);
  });

  it('is false while the post is em_producao', () => {
    expect(canWriteNotes(post({ em_producao: 'correcao' }))).toBe(false);
  });
});

describe('anchorLabel', () => {
  it('labels a pinned image note with slide and point', () => {
    expect(anchorLabel(note({ slide_index: 2, x: 0.1, y: 0.2 }), t, 1)).toBe('Slide 3 · ponto 1');
  });

  it('labels a whole-slide image note with the slide only', () => {
    expect(anchorLabel(note({ slide_index: 2 }), t)).toBe('Slide 3');
  });

  it('falls back to the slide when a pinned note has no point number', () => {
    expect(anchorLabel(note({ slide_index: 0, x: 0.1, y: 0.2 }), t)).toBe('Slide 1');
  });

  it('labels a pinned video note with the moment', () => {
    expect(anchorLabel(note({ media_kind: 'video', t_seconds: 42, x: 0.5, y: 0.5 }), t)).toBe(
      '0:42 · ponto na cena',
    );
  });

  it('labels an unpinned video note with the moment only', () => {
    expect(anchorLabel(note({ media_kind: 'video', t_seconds: 75.9 }), t)).toBe('1:15');
  });

  it('labels a video note with no moment by its slide position', () => {
    expect(anchorLabel(note({ media_kind: 'video', slide_index: 1, t_seconds: null }), t)).toBe(
      'Slide 2',
    );
  });

  it('marks a previous-version note', () => {
    expect(anchorLabel(note({ slide_index: 1, link_id: null, is_previous_version: true }), t)).toBe(
      'Slide 2 (versão anterior)',
    );
  });
});

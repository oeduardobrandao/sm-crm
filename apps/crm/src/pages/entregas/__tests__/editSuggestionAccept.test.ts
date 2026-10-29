import { describe, expect, it } from 'vitest';
import type { PostEditSuggestion } from '../../../store/posts';
import { classifyAcceptError, mentionIdsToSyncAfterAccept } from '../editSuggestionAccept';

const mention = (entityType: string, id: number) => ({
  type: 'mention',
  attrs: { entityType, id, label: 'x', parentId: null },
});
const docWith = (...nodes: unknown[]) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: nodes }],
});

function suggestion(over: Partial<PostEditSuggestion> = {}): PostEditSuggestion {
  return {
    id: 1,
    post_id: 2,
    suggested_conteudo: docWith(mention('membro', 7), mention('cliente', 9), mention('membro', 8)),
    suggested_conteudo_plain: '@a @b @c',
    suggested_ig_caption: null,
    original_conteudo: null,
    original_conteudo_plain: '',
    original_ig_caption: null,
    changed_fields: ['conteudo'],
    status: 'pending',
    updated_at: '2026-10-28T20:33:00Z',
    ...over,
  };
}

describe('mentionIdsToSyncAfterAccept', () => {
  it('returns the member ids of the suggested doc when texto was applied', () => {
    expect(mentionIdsToSyncAfterAccept(suggestion(), ['texto'])).toEqual([7, 8]);
  });

  it('returns an empty list (clear the ledger) when the applied doc has no member mentions', () => {
    const s = suggestion({ suggested_conteudo: docWith(mention('cliente', 9)) });
    expect(mentionIdsToSyncAfterAccept(s, ['texto'])).toEqual([]);
  });

  it('skips the sync when texto was not applied (the team texto and its mentions stay)', () => {
    expect(mentionIdsToSyncAfterAccept(suggestion(), ['legenda'])).toBeNull();
  });

  it('skips the sync when the client did not change the doc', () => {
    const s = suggestion({ changed_fields: ['ig_caption'] });
    expect(mentionIdsToSyncAfterAccept(s, ['texto', 'legenda'])).toBeNull();
  });

  it('skips the sync for a NULL suggested doc (caption-only Story suggestion)', () => {
    const s = suggestion({ suggested_conteudo: null, changed_fields: ['conteudo', 'ig_caption'] });
    expect(mentionIdsToSyncAfterAccept(s, ['texto', 'legenda'])).toBeNull();
  });
});

describe('classifyAcceptError', () => {
  it('maps the server error codes', () => {
    expect(classifyAcceptError({ message: 'suggestion_changed' })).toBe('changed');
    expect(classifyAcceptError({ message: 'suggestion_conflict' })).toBe('conflict');
  });

  it('matches inside a longer PostgREST message', () => {
    expect(classifyAcceptError(new Error('P0001: suggestion_conflict'))).toBe('conflict');
  });

  it('falls back to other for anything else', () => {
    expect(classifyAcceptError({ message: 'no_fields' })).toBe('other');
    expect(classifyAcceptError(null)).toBe('other');
    expect(classifyAcceptError(undefined)).toBe('other');
    expect(classifyAcceptError('boom')).toBe('other');
  });
});

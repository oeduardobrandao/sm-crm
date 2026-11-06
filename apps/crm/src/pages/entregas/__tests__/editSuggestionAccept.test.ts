import { describe, expect, it } from 'vitest';
import type { PostEditSuggestion } from '../../../store/posts';
import {
  classifyAcceptError,
  destinationAcceptErrorKey,
  mentionIdsToSyncAfterAccept,
} from '../editSuggestionAccept';

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
    suggested_tiktok_caption: null,
    original_tiktok_caption: null,
    suggested_geral_caption: null,
    original_geral_caption: null,
    geral_target_id: null,
    tiktok_followed_ig: null,
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

  it('maps the destination refusals and the deadlock', () => {
    expect(classifyAcceptError({ message: 'target_gone', code: 'P0001' })).toBe('target_gone');
    expect(classifyAcceptError({ message: 'target_locked', code: 'P0001' })).toBe('target_locked');
    expect(classifyAcceptError({ message: 'deadlock detected', code: '40P01' })).toBe('retry');
  });

  it('falls back to other for anything else', () => {
    expect(classifyAcceptError({ message: 'no_fields' })).toBe('other');
    expect(classifyAcceptError(null)).toBe('other');
    expect(classifyAcceptError(undefined)).toBe('other');
    expect(classifyAcceptError('boom')).toBe('other');
    expect(classifyAcceptError({ message: 'x', code: '23505' })).toBe('other');
  });
});

describe('destinationAcceptErrorKey', () => {
  const k = (s: string) => `postEditor:suggestionReview.errors.${s}`;

  it('names the destination by the accepted field, generic when both or neither', () => {
    expect(destinationAcceptErrorKey('target_gone', ['texto', 'legenda_tiktok'])).toBe(
      k('targetGoneTiktok'),
    );
    expect(destinationAcceptErrorKey('target_gone', ['legenda_geral'])).toBe(k('targetGoneGeral'));
    expect(destinationAcceptErrorKey('target_gone', ['legenda_tiktok', 'legenda_geral'])).toBe(
      k('targetGone'),
    );
    expect(destinationAcceptErrorKey('target_gone', ['legenda'])).toBe(k('targetGone'));
  });

  it('target_locked and retry have their own lines; the rest stays with the drawer', () => {
    expect(destinationAcceptErrorKey('target_locked', ['legenda_tiktok'])).toBe(k('targetLocked'));
    expect(destinationAcceptErrorKey('retry', ['texto'])).toBe(k('retry'));
    expect(destinationAcceptErrorKey('changed', ['texto'])).toBeNull();
    expect(destinationAcceptErrorKey('conflict', ['texto'])).toBeNull();
    expect(destinationAcceptErrorKey('other', ['texto'])).toBeNull();
  });
});

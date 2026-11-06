import { describe, expect, it } from 'vitest';
import {
  changedSuggestionFields,
  destinationCaptions,
  editCaptionGroups,
  groupCaptions,
  resolvePostTargets,
  suggestionAwareRawCaptions,
} from '../postView';
import type { HubPost, PendingEditSuggestion } from '../../types';

function post(over: Partial<HubPost> = {}): HubPost {
  return {
    id: 1,
    titulo: 'P',
    tipo: 'reels',
    status: 'enviado_cliente',
    ordem: 1,
    conteudo: null,
    conteudo_plain: '',
    scheduled_at: null,
    ig_caption: null,
    instagram_permalink: null,
    published_at: null,
    publish_error: null,
    workflow_id: null,
    workflow_titulo: null,
    workflow_created_at: null,
    media: [],
    cover_media: null,
    pending_suggestion: null,
    suggestion_rejected_at: null,
    ...over,
  };
}

describe('resolvePostTargets', () => {
  it('keeps the destinations in PLATFORM_IDS order', () => {
    expect(
      resolvePostTargets(post({ targets: ['geral', 'instagram', 'tiktok'], geral_caption: null })),
    ).toEqual(['instagram', 'tiktok', 'geral']);
  });

  it('derives destinations from the legacy platform on an old payload', () => {
    expect(resolvePostTargets(post({ platform: 'both' }))).toEqual(['instagram', 'tiktok']);
    expect(resolvePostTargets(post({ platform: 'tiktok' }))).toEqual(['tiktok']);
    expect(resolvePostTargets(post({}))).toEqual(['instagram']);
  });

  it('trusts the new payload over the legacy platform (stories lose their TikTok row)', () => {
    expect(resolvePostTargets(post({ platform: 'both', targets: ['instagram'] }))).toEqual([
      'instagram',
    ]);
  });

  it('falls back to the single block with no destinations or no Geral caption field', () => {
    expect(resolvePostTargets(post({ targets: [] }))).toBeNull();
    expect(resolvePostTargets(post({ platform: 'other' }))).toBeNull();
    expect(resolvePostTargets(post({ targets: ['geral'] }))).toBeNull();
    expect(resolvePostTargets(post({ targets: ['geral'], geral_caption: null }))).toEqual([
      'geral',
    ]);
  });
});

describe('destinationCaptions', () => {
  const all = ['instagram', 'tiktok', 'geral'] as const;

  it('uses each destination its own caption', () => {
    const p = post({ ig_caption: 'IG', tiktok_caption: 'TT', geral_caption: 'GE' });
    expect(destinationCaptions(p, [...all], 'IG', 'IG')).toEqual([
      { platform: 'instagram', text: 'IG' },
      { platform: 'tiktok', text: 'TT' },
      { platform: 'geral', text: 'GE' },
    ]);
  });

  it('TikTok follows the raw Instagram caption when it has none, like the publisher', () => {
    const p = post({ ig_caption: 'IG', tiktok_caption: null });
    expect(destinationCaptions(p, ['tiktok'], 'IG', 'IG')).toEqual([
      { platform: 'tiktok', text: 'IG' },
    ]);
  });

  it('TikTok never shows the LEGENDA fallback: with no caption it publishes nothing', () => {
    const p = post({ conteudo_plain: 'Roteiro\nLEGENDA: do corpo', ig_caption: null });
    expect(destinationCaptions(p, ['instagram', 'tiktok'], 'do corpo', null)).toEqual([
      { platform: 'instagram', text: 'do corpo' },
      { platform: 'tiktok', text: '' },
    ]);
  });

  it("an emptied TikTok caption ('') does not follow Instagram", () => {
    const p = post({ ig_caption: 'IG', tiktok_caption: '' });
    expect(destinationCaptions(p, ['tiktok'], 'IG', 'IG')).toEqual([
      { platform: 'tiktok', text: '' },
    ]);
  });

  it('Geral without a caption is empty', () => {
    expect(destinationCaptions(post({ geral_caption: null }), ['geral'], '', null)).toEqual([
      { platform: 'geral', text: '' },
    ]);
  });
});

describe('groupCaptions', () => {
  it('groups identical captions in destination order', () => {
    expect(
      groupCaptions([
        { platform: 'instagram', text: 'A' },
        { platform: 'tiktok', text: 'B' },
        { platform: 'geral', text: 'A' },
      ]),
    ).toEqual([
      { platforms: ['instagram', 'geral'], text: 'A' },
      { platforms: ['tiktok'], text: 'B' },
    ]);
  });

  it('compares exactly: trailing whitespace keeps captions apart', () => {
    expect(
      groupCaptions([
        { platform: 'instagram', text: 'A' },
        { platform: 'tiktok', text: 'A ' },
      ]),
    ).toHaveLength(2);
  });
});

describe('editCaptionGroups (PR 2: which fields a group touches)', () => {
  const groupsOf = (p: HubPost, igShown: string) =>
    groupCaptions(destinationCaptions(p, resolvePostTargets(p)!, igShown, p.ig_caption));

  it('TikTok with a null caption in the Instagram group is not a field', () => {
    const p = post({ targets: ['instagram', 'tiktok'], ig_caption: 'IG', tiktok_caption: null });
    expect(editCaptionGroups(groupsOf(p, 'IG'), p.tiktok_caption)).toEqual([
      { platforms: ['instagram', 'tiktok'], text: 'IG', fields: ['legenda'] },
    ]);
  });

  it('TikTok with its own caption equal to Instagram touches both fields', () => {
    const p = post({ targets: ['instagram', 'tiktok'], ig_caption: 'IG', tiktok_caption: 'IG' });
    expect(editCaptionGroups(groupsOf(p, 'IG'), p.tiktok_caption)[0].fields).toEqual([
      'legenda',
      'legenda_tiktok',
    ]);
  });

  it('TikTok alone with a null raw caption IS a field (LEGENDA fallback case)', () => {
    const p = post({
      targets: ['instagram', 'tiktok'],
      ig_caption: null,
      tiktok_caption: null,
      conteudo_plain: 'Roteiro\nLEGENDA: do corpo',
    });
    expect(editCaptionGroups(groupsOf(p, 'do corpo'), p.tiktok_caption)).toEqual([
      { platforms: ['instagram'], text: 'do corpo', fields: ['legenda'] },
      { platforms: ['tiktok'], text: '', fields: ['legenda_tiktok'] },
    ]);
  });

  it('Geral is its own field, grouped or not', () => {
    const p = post({
      targets: ['instagram', 'tiktok', 'geral'],
      ig_caption: 'IG',
      tiktok_caption: 'TT',
      geral_caption: 'TT',
    });
    expect(editCaptionGroups(groupsOf(p, 'IG'), p.tiktok_caption)).toEqual([
      { platforms: ['instagram'], text: 'IG', fields: ['legenda'] },
      { platforms: ['tiktok', 'geral'], text: 'TT', fields: ['legenda_tiktok', 'legenda_geral'] },
    ]);
  });
});

describe('suggestionAwareRawCaptions', () => {
  const suggestion = (over: Partial<PendingEditSuggestion>): PendingEditSuggestion => ({
    id: 1,
    suggested_conteudo: null,
    suggested_conteudo_plain: '',
    suggested_ig_caption: null,
    changed_fields: [],
    updated_at: '2026-10-30T00:00:00Z',
    ...over,
  });

  it('uses the suggested value only for a column the suggestion changed', () => {
    const p = post({ tiktok_caption: 'TT vivo', geral_caption: 'G vivo' });
    expect(
      suggestionAwareRawCaptions(
        p,
        suggestion({
          changed_fields: ['tiktok_caption'],
          suggested_tiktok_caption: 'TT novo',
          suggested_geral_caption: 'G velho',
        }),
      ),
    ).toEqual({ tiktok_caption: 'TT novo', geral_caption: 'G vivo' });
  });

  it('keeps the live values without a suggestion or on an old payload', () => {
    const p = post({ tiktok_caption: null, geral_caption: 'G' });
    expect(suggestionAwareRawCaptions(p, null)).toEqual({
      tiktok_caption: null,
      geral_caption: 'G',
    });
    expect(
      suggestionAwareRawCaptions(p, suggestion({ changed_fields: ['geral_caption'] })),
    ).toEqual({ tiktok_caption: null, geral_caption: 'G' });
  });
});

describe('changedSuggestionFields', () => {
  it('maps columns to logical fields in display order', () => {
    expect(
      changedSuggestionFields(['geral_caption', 'conteudo_plain', 'tiktok_caption', 'ig_caption']),
    ).toEqual(['texto', 'legenda', 'legenda_tiktok', 'legenda_geral']);
    expect(changedSuggestionFields(undefined)).toEqual([]);
  });
});

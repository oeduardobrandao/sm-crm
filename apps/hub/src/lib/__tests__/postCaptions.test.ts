import { describe, expect, it } from 'vitest';
import { destinationCaptions, groupCaptions, resolvePostTargets } from '../postView';
import type { HubPost } from '../../types';

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

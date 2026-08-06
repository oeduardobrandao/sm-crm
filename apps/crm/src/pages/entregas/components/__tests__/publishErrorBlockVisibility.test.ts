import { describe, expect, it } from 'vitest';
import { shouldShowPublishErrorBlock } from '../publishErrorBlockVisibility';

describe('shouldShowPublishErrorBlock', () => {
  it('instagram falhado: mostra', () => {
    expect(
      shouldShowPublishErrorBlock({
        status: 'falha_publicacao',
        platform: 'instagram',
        instagram_media_id: null,
      }),
    ).toBe(true);
  });

  it('both com Instagram não publicado: mostra', () => {
    expect(
      shouldShowPublishErrorBlock({
        status: 'falha_publicacao',
        platform: 'both',
        instagram_media_id: null,
      }),
    ).toBe(true);
  });

  it('both com Instagram já publicado (TikTok falhado): esconde', () => {
    expect(
      shouldShowPublishErrorBlock({
        status: 'falha_publicacao',
        platform: 'both',
        instagram_media_id: 'ig_12345',
      }),
    ).toBe(false);
  });

  it('tiktok puro: esconde', () => {
    expect(
      shouldShowPublishErrorBlock({
        status: 'falha_publicacao',
        platform: 'tiktok',
        instagram_media_id: null,
      }),
    ).toBe(false);
  });
});

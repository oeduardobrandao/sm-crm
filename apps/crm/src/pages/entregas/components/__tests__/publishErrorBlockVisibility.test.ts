import { describe, expect, it } from 'vitest';
import { shouldShowPublishErrorBlock } from '../publishErrorBlockVisibility';

describe('shouldShowPublishErrorBlock', () => {
  it('instagram falhado: mostra', () => {
    expect(
      shouldShowPublishErrorBlock({
        status: 'falha_publicacao',
        platform: 'instagram',
        instagram_media_id: null,
        publish_error: 'algo deu errado',
        publish_error_code: null,
      }),
    ).toBe(true);
  });

  it('both com Instagram não publicado e publish_error preenchido: mostra', () => {
    expect(
      shouldShowPublishErrorBlock({
        status: 'falha_publicacao',
        platform: 'both',
        instagram_media_id: null,
        publish_error: 'algo deu errado',
        publish_error_code: null,
      }),
    ).toBe(true);
  });

  it('both com Instagram já publicado (TikTok falhado): esconde', () => {
    expect(
      shouldShowPublishErrorBlock({
        status: 'falha_publicacao',
        platform: 'both',
        instagram_media_id: 'ig_12345',
        publish_error: 'algo deu errado',
        publish_error_code: null,
      }),
    ).toBe(false);
  });

  it('tiktok puro: esconde', () => {
    expect(
      shouldShowPublishErrorBlock({
        status: 'falha_publicacao',
        platform: 'tiktok',
        instagram_media_id: null,
        publish_error: null,
        publish_error_code: null,
      }),
    ).toBe(false);
  });

  it('both com TikTok falhado primeiro (IG pendente, publish_error null): esconde', () => {
    expect(
      shouldShowPublishErrorBlock({
        status: 'falha_publicacao',
        platform: 'both',
        instagram_media_id: null,
        publish_error: null,
        publish_error_code: null,
      }),
    ).toBe(false);
  });

  it('instagram falhado com publish_error_code preenchido (sem publish_error): mostra', () => {
    expect(
      shouldShowPublishErrorBlock({
        status: 'falha_publicacao',
        platform: 'instagram',
        instagram_media_id: null,
        publish_error: null,
        publish_error_code: 'TOKEN_EXPIRED',
      }),
    ).toBe(true);
  });
});

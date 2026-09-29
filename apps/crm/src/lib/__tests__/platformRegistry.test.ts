import { describe, expect, it } from 'vitest';
import {
  CONTENT_FORMATS,
  CONTENT_FORMAT_LABELS,
  PLATFORM_IDS,
  PLATFORM_DEFS,
  COMING_SOON_PLATFORMS,
  IG_CAPTION_MAX,
  supportsFormat,
  captionMaxFor,
} from '@mesaas/platforms';

describe('platform registry', () => {
  it('keeps the four stored tipo values, in display order', () => {
    expect(CONTENT_FORMATS).toEqual(['feed', 'carrossel', 'reels', 'stories']);
  });

  it('labels content formats neutrally', () => {
    expect(CONTENT_FORMAT_LABELS).toEqual({
      feed: 'Imagem',
      carrossel: 'Carrossel',
      reels: 'Vídeo vertical',
      stories: 'Stories',
    });
  });

  it('lists instagram, tiktok and geral as selectable platforms', () => {
    expect(PLATFORM_IDS).toEqual(['instagram', 'tiktok', 'geral']);
    expect(COMING_SOON_PLATFORMS.map((p) => p.id)).toEqual(['youtube']);
  });

  it('only geral skips auto-publishing', () => {
    expect(PLATFORM_IDS.filter((p) => !PLATFORM_DEFS[p].autoPublish)).toEqual(['geral']);
  });

  it('gates tiktok behind feature_tiktok', () => {
    expect(PLATFORM_DEFS.tiktok.planFeature).toBe('feature_tiktok');
    expect(PLATFORM_DEFS.instagram.planFeature).toBeNull();
    expect(PLATFORM_DEFS.geral.planFeature).toBeNull();
  });

  it('tiktok has no stories; instagram and geral take every format', () => {
    expect(supportsFormat('tiktok', 'stories')).toBe(false);
    for (const f of CONTENT_FORMATS) {
      expect(supportsFormat('instagram', f)).toBe(true);
      expect(supportsFormat('geral', f)).toBe(true);
    }
  });

  it('caption limits per platform and format', () => {
    expect(IG_CAPTION_MAX).toBe(2200);
    expect(captionMaxFor('instagram', 'reels')).toBe(2200);
    expect(captionMaxFor('tiktok', 'reels')).toBe(2200);
    expect(captionMaxFor('tiktok', 'carrossel')).toBe(4000);
    expect(captionMaxFor('tiktok', 'stories')).toBeNull();
    expect(captionMaxFor('geral', 'feed')).toBeNull();
    expect(PLATFORM_DEFS.tiktok.titleMax).toBe(90);
  });
});

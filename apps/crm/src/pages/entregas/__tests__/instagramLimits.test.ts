import { describe, it, expect } from 'vitest';
import * as front from '../instagramLimits';
// Import via alias: o módulo _shared é TS puro (sem APIs Deno), então o Vitest
// o transforma normalmente. O alias '@shared' está configurado em vitest.config.ts.
import * as shared from '@shared/instagram-limits';

describe('instagramLimits: paridade front vs _shared', () => {
  it('constantes idênticas', () => {
    expect(front.IMAGE_MAX_BYTES).toBe(shared.IMAGE_MAX_BYTES);
    expect(front.VIDEO_MAX_BYTES).toBe(shared.VIDEO_MAX_BYTES);
    expect(front.STORY_VIDEO_MAX_BYTES).toBe(shared.STORY_VIDEO_MAX_BYTES);
    expect(front.STORY_VIDEO_AR_MIN).toBe(shared.STORY_VIDEO_AR_MIN);
    expect(front.VIDEO_MAX_WIDTH).toBe(shared.VIDEO_MAX_WIDTH);
    expect(front.IMAGE_MIN_DIM).toBe(shared.IMAGE_MIN_DIM);
    expect(front.IMAGE_AR_MIN).toBe(shared.IMAGE_AR_MIN);
    expect(front.STORY_IMAGE_AR_MIN).toBe(shared.STORY_IMAGE_AR_MIN);
    expect(front.IMAGE_AR_MAX).toBe(shared.IMAGE_AR_MAX);
    expect(front.VIDEO_AR_MIN).toBe(shared.VIDEO_AR_MIN);
    expect(front.VIDEO_AR_MAX).toBe(shared.VIDEO_AR_MAX);
    expect(front.VIDEO_MIN_DURATION).toBe(shared.VIDEO_MIN_DURATION);
    expect(front.VIDEO_MAX_DURATION).toBe(shared.VIDEO_MAX_DURATION);
    expect(front.STORY_VIDEO_MAX_DURATION).toBe(shared.STORY_VIDEO_MAX_DURATION);
    expect(front.CAROUSEL_MAX_ITEMS).toBe(shared.CAROUSEL_MAX_ITEMS);
    expect([...front.ALLOWED_IMAGE_MIMES].sort()).toEqual([...shared.ALLOWED_IMAGE_MIMES].sort());
    expect([...front.ALLOWED_VIDEO_MIMES].sort()).toEqual([...shared.ALLOWED_VIDEO_MIMES].sort());
  });

  it('mesmo veredito para os mesmos arquivos', () => {
    const fixtures = [
      {
        id: 1,
        kind: 'image' as const,
        mime_type: 'image/jpeg',
        size_bytes: 9 * 1024 * 1024,
        width: 1080,
        height: 1350,
        duration_seconds: null,
      },
      {
        id: 2,
        kind: 'video' as const,
        mime_type: 'video/mp4',
        size_bytes: 260 * 1024 * 1024,
        width: 1080,
        height: 1920,
        duration_seconds: 30,
      },
      {
        id: 3,
        kind: 'video' as const,
        mime_type: 'video/mp4',
        size_bytes: 1024,
        width: 1080,
        height: 1920,
        duration_seconds: 95,
      },
      {
        id: 4,
        kind: 'image' as const,
        mime_type: 'image/gif',
        size_bytes: 1024,
        width: 500,
        height: 500,
        duration_seconds: null,
      },
      {
        id: 5,
        kind: 'image' as const,
        mime_type: 'image/jpeg',
        size_bytes: 1024,
        width: 1080,
        height: 1350,
        duration_seconds: null,
      },
    ];
    const sharedFixtures = fixtures.map((f) => ({ ...f, r2_key: 'k', sort_order: 0 }));
    for (const forStories of [false, true]) {
      expect(front.validateMedia(fixtures, { forStories }).map((e) => e.message)).toEqual(
        shared.validateMedia(sharedFixtures, { forStories }).map((e) => e.message),
      );
    }
  });
});

const image = {
  id: 1,
  kind: 'image' as const,
  mime_type: 'image/jpeg',
  size_bytes: 1024,
  width: 1080,
  height: 1440,
  duration_seconds: null,
};
const video = {
  ...image,
  kind: 'video' as const,
  mime_type: 'video/mp4',
  width: 1920,
  height: 1080,
  duration_seconds: 900,
  size_bytes: 300 * 1024 * 1024,
};

describe('publishing requirements', () => {
  it('accepts the tested 3:4 feed boundary and rejects taller feed images', () => {
    expect(front.validateMedia([image])).toEqual([]);
    expect(front.validateMedia([{ ...image, height: 1441 }])).toHaveLength(1);
  });
  it('requires JPEG conversion, but lets Instagram normalize image width', () => {
    expect(front.validateMedia([{ ...image, mime_type: 'image/png' }])).toHaveLength(1);
    expect(front.validateMedia([{ ...image, width: 300, height: 300 }])).toEqual([]);
  });
  it('accepts landscape Reels up to 300 MB and 15 minutes', () => {
    expect(front.validateMedia([video])).toEqual([]);
    expect(front.validateMedia([{ ...video, size_bytes: video.size_bytes + 1 }])).toHaveLength(1);
    expect(front.validateMedia([{ ...video, duration_seconds: 901 }])).toHaveLength(1);
  });
  it('enforces separate Story video size and duration limits', () => {
    const story = { ...video, size_bytes: 100 * 1024 * 1024, duration_seconds: 60 };
    expect(front.validateMedia([story], { forStories: true })).toEqual([]);
    expect(
      front.validateMedia([{ ...story, size_bytes: story.size_bytes + 1 }], { forStories: true }),
    ).toHaveLength(1);
    expect(
      front.validateMedia([{ ...story, duration_seconds: 61 }], { forStories: true }),
    ).toHaveLength(1);
  });
  it('does not block Story images solely for non-9:16 framing', () => {
    expect(
      front.validateMedia([{ ...image, width: 1080, height: 2200 }], { forStories: true }),
    ).toEqual([]);
  });
});

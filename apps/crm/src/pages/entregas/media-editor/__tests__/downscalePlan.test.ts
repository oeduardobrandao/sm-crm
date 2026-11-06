import { describe, expect, it } from 'vitest';
import {
  FFMPEG_FALLBACK_MAX_INPUT_BYTES,
  FFMPEG_FALLBACK_MAX_INPUT_BYTES_IOS,
  downscaledFilename,
  ffmpegFallbackMaxBytes,
  planDownscale,
} from '../downscalePlan';

const MAX = 300 * 2 ** 20;
const src = (width: number, height: number, durationSeconds = 30) => ({
  width,
  height,
  sizeBytes: 1,
  durationSeconds,
});

describe('planDownscale', () => {
  it.each([
    [2160, 3840, 1080, 1920, true],
    [3840, 2160, 1920, 1080, true],
    [2400, 2400, 1080, 1080, true],
    [2560, 1440, 1920, 1080, true],
    [1921, 1081, 1918, 1080, true],
    [4000, 1000, 1920, 480, true],
    [1080, 1920, 1080, 1920, false],
  ])('plans %ix%i → %ix%i', (w, h, ow, oh, resized) => {
    const p = planDownscale(src(w, h), { maxBytes: MAX })!;
    expect([p.width, p.height, p.resized]).toEqual([ow, oh, resized]);
    expect((p.width % 2) + (p.height % 2)).toBe(0);
  });

  it('caps bitrate at 8 Mbps and budgets long videos', () => {
    expect(planDownscale(src(2160, 3840), { maxBytes: MAX })!.bitrate).toBe(8_000_000);
    expect(planDownscale(src(2160, 3840, 600), { maxBytes: MAX })!.bitrate).toBe(
      Math.floor((MAX * 8 * 0.88) / 600 - 128_000),
    );
  });

  it('returns null when the budget is under 100 kbps', () => {
    expect(planDownscale(src(2160, 3840, 900), { maxBytes: 10 * 2 ** 20 })).toBeNull();
  });
});

describe('downscaledFilename', () => {
  it('names outputs', () => {
    const resized = planDownscale(src(2160, 3840), { maxBytes: MAX })!;
    expect(downscaledFilename('Clip.MOV', resized)).toBe('Clip (1080p).mp4');
    const sizeOnly = planDownscale(src(1080, 1920), { maxBytes: MAX })!;
    expect(downscaledFilename('Clip.MOV', sizeOnly)).toBe('Clip (otimizado).mp4');
  });

  it('names by short side', () => {
    const p = planDownscale(src(4000, 1000), { maxBytes: MAX })!;
    expect(downscaledFilename('X.mp4', p)).toBe('X (480p).mp4');
  });
});

describe('ffmpegFallbackMaxBytes', () => {
  it('picks the iOS ceiling for iPhone/iPadOS', () => {
    expect(
      ffmpegFallbackMaxBytes({
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)',
        maxTouchPoints: 5,
      }),
    ).toBe(FFMPEG_FALLBACK_MAX_INPUT_BYTES_IOS);
    expect(
      ffmpegFallbackMaxBytes({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        maxTouchPoints: 5,
      }),
    ).toBe(FFMPEG_FALLBACK_MAX_INPUT_BYTES_IOS);
    expect(
      ffmpegFallbackMaxBytes({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120',
        maxTouchPoints: 0,
      }),
    ).toBe(FFMPEG_FALLBACK_MAX_INPUT_BYTES);
  });
});

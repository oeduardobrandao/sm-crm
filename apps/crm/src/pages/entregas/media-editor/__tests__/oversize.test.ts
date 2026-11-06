import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PostMediaLike } from '../../../instagramLimits';

const probe = vi.hoisted(() => ({ probeVideo: vi.fn() }));
vi.mock('@/services/postMedia', () => ({ probeVideo: probe.probeVideo }));

import { PROBE_TIMEOUT_MS, oversizeOnly, probeWithTimeout, videoMaxBytes } from '../oversize';

const MB = 2 ** 20;
const video = (w: number, h: number, mb: number, duration = 30): PostMediaLike => ({
  id: 1,
  kind: 'video',
  mime_type: 'video/mp4',
  size_bytes: mb * MB,
  width: w,
  height: h,
  duration_seconds: duration,
});

describe('oversizeOnly', () => {
  it('flags width only', () => {
    expect(oversizeOnly(video(2160, 3840, 50), {})).toEqual({ eligible: true, reasons: ['width'] });
  });
  it('flags width and size', () => {
    expect(oversizeOnly(video(2160, 3840, 400), {})).toEqual({
      eligible: true,
      reasons: ['width', 'size'],
    });
  });
  it('flags size only, with the lower Stories limit', () => {
    expect(oversizeOnly(video(1080, 1920, 400), {})).toEqual({ eligible: true, reasons: ['size'] });
    expect(oversizeOnly(video(1080, 1920, 150), { forStories: true })).toEqual({
      eligible: true,
      reasons: ['size'],
    });
  });
  it('is ineligible when another rule also fails', () => {
    expect(oversizeOnly(video(2160, 3840, 50), { isCarousel: true }).eligible).toBe(false);
    expect(oversizeOnly(video(2160, 3840, 50, 2), {}).eligible).toBe(false);
  });
  it('is ineligible when nothing is over, or for images', () => {
    expect(oversizeOnly(video(1080, 1920, 50), {})).toEqual({ eligible: false, reasons: [] });
    const img: PostMediaLike = { ...video(4000, 4000, 1), kind: 'image', mime_type: 'image/jpeg' };
    expect(oversizeOnly(img, {}).eligible).toBe(false);
  });
});

describe('videoMaxBytes', () => {
  it('returns 300 MB, or 100 MB for Stories', () => {
    expect(videoMaxBytes(false)).toBe(300 * MB);
    expect(videoMaxBytes(true)).toBe(100 * MB);
  });
});

describe('probeWithTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
    probe.probeVideo.mockReset();
  });
  const file = new File([''], 'a.mp4');

  it('resolves null on timeout', async () => {
    vi.useFakeTimers();
    probe.probeVideo.mockReturnValue(new Promise(() => {}));
    const p = probeWithTimeout(file);
    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS);
    await expect(p).resolves.toBeNull();
  });
  it('resolves null on rejection or a non-object result', async () => {
    probe.probeVideo.mockRejectedValueOnce(new Error('x'));
    await expect(probeWithTimeout(file)).resolves.toBeNull();
    probe.probeVideo.mockResolvedValueOnce(undefined);
    await expect(probeWithTimeout(file)).resolves.toBeNull();
  });
  it('returns the probe result', async () => {
    const r = { width: 1, height: 2, duration_seconds: 3 };
    probe.probeVideo.mockResolvedValueOnce(r);
    await expect(probeWithTimeout(file)).resolves.toEqual(r);
  });
});

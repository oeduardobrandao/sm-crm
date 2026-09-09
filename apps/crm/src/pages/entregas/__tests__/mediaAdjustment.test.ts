import { describe, expect, it } from 'vitest';
import { getPlacement, getPresets, videoArguments } from '../media-editor/geometry';

describe('media adjustment geometry', () => {
  it('offers all feed formats including tested 3:4 and legal landscape', () => {
    expect(getPresets('image', false).map((p) => p.label)).toEqual(['1:1', '4:5', '3:4', '1,91:1']);
    const landscape = getPresets('image', false)[3];
    expect(landscape.width / landscape.height).toBeLessThanOrEqual(1.91);
    expect(getPresets('video', false)[0]).toMatchObject({ width: 1080, height: 1920 });
  });
  it('crops without stretching and clamps panning to the frame', () => {
    const p = getPlacement(1920, 1080, 1080, 1920, 'crop', 1, 1, 0.5);
    expect(p.width / p.height).toBeCloseTo(1920 / 1080);
    expect(p.x + p.width).toBeCloseTo(1080);
    expect(p.y).toBe(0);
  });
  it('fits the whole landscape source with centered padding', () => {
    expect(getPlacement(1920, 1080, 1080, 1920, 'fit', 2, 0, 0)).toEqual({
      x: 0,
      y: 656.25,
      width: 1080,
      height: 607.5,
    });
  });
  it('prevents empty crop margins at maximum zoom and extreme positions', () => {
    for (const x of [-1, 0, 0.5, 1, 2]) {
      const p = getPlacement(100, 1000, 1080, 1080, 'crop', 3, x, x);
      expect(p.x).toBeLessThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(0);
      expect(p.x + p.width).toBeGreaterThanOrEqual(1080);
      expect(p.y + p.height).toBeGreaterThanOrEqual(1080);
    }
  });
  it('encodes a complete video with compatible audio, pixel format and faststart', () => {
    const args = videoArguments(
      {
        width: 1080,
        height: 1920,
        mode: 'fit',
        zoom: 1,
        x: 0.5,
        y: 0.5,
        background: 'blur',
        color: '#12151a',
      },
      1920,
      1080,
      900,
      300 * 1024 * 1024,
    );
    expect(args).toContain('libx264');
    expect(args).toContain('yuv420p');
    expect(args).toContain('aac');
    expect(args).toContain('+faststart');
    expect(args).not.toContain('-t');
    expect(args.join(' ')).toContain('boxblur');
    expect(Number(args[args.indexOf('-b:v') + 1])).toBeLessThan((300 * 1024 * 1024 * 8) / 900);
  });
});

import { jpegFromCanvas } from '../media-editor/render';
import { vi } from 'vitest';

it('retries image compression and returns JPEG below its byte limit', async () => {
  let attempt = 0;
  const canvas = {
    toBlob: vi.fn((callback: BlobCallback) =>
      callback(new Blob([new Uint8Array(++attempt === 1 ? 20 : 8)], { type: 'image/jpeg' })),
    ),
  };
  const result = await jpegFromCanvas(canvas as unknown as HTMLCanvasElement, 'adjusted.jpg', 10);
  expect(result.type).toBe('image/jpeg');
  expect(result.size).toBe(8);
});

it('crops in source space before scaling an extreme portrait video', () => {
  const args = videoArguments(
    {
      width: 1080,
      height: 1920,
      mode: 'crop',
      zoom: 3,
      x: 0.5,
      y: 0.5,
      background: 'solid',
      color: '#12151a',
    },
    16,
    1600,
    3,
    300 * 1024 * 1024,
  );
  const filter = args[args.indexOf('-filter_complex') + 1];
  expect(filter.indexOf('crop=')).toBeLessThan(filter.indexOf('scale='));
  expect(filter).toContain('scale=1080:1920');
});

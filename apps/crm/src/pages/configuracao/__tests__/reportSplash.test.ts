import { describe, expect, it, vi } from 'vitest';
import { downscaleImage } from '../reportSplash';

function fakeBitmap(w: number, h: number) {
  return { width: w, height: h, close: vi.fn() } as unknown as ImageBitmap;
}

describe('downscaleImage', () => {
  it('scales width down to max and keeps aspect', async () => {
    const drawImage = vi.fn();
    const toBlob = vi.fn((cb: (b: Blob | null) => void) =>
      cb(new Blob(['x'], { type: 'image/jpeg' })),
    );
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => fakeBitmap(3840, 2160)),
    );
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toBlob,
    } as unknown as HTMLCanvasElement;
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as HTMLElement & HTMLCanvasElement);

    await downscaleImage(new File(['x'], 'a.png', { type: 'image/png' }), 1920, 0.82);
    expect(canvas.width).toBe(1920);
    expect(canvas.height).toBe(1080);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.82);
  });

  it('does not upscale small images', async () => {
    const toBlob = vi.fn((cb: (b: Blob | null) => void) =>
      cb(new Blob(['x'], { type: 'image/jpeg' })),
    );
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => fakeBitmap(800, 400)),
    );
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: vi.fn() }),
      toBlob,
    } as unknown as HTMLCanvasElement;
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as HTMLElement & HTMLCanvasElement);
    await downscaleImage(new File(['x'], 'a.png', { type: 'image/png' }));
    expect(canvas.width).toBe(800);
  });
});

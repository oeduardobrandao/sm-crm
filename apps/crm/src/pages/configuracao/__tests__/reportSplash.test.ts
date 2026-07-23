import { describe, expect, it, vi } from 'vitest';
import { downscaleImage } from '../reportSplash';

function fakeBitmap(w: number, h: number) {
  return { width: w, height: h, close: vi.fn() } as unknown as ImageBitmap;
}

function fakeCtx() {
  return { drawImage: vi.fn(), fillRect: vi.fn(), fillStyle: '' };
}

describe('downscaleImage', () => {
  it('scales width down to max and keeps aspect', async () => {
    const ctx = fakeCtx();
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
      getContext: () => ctx,
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
      getContext: () => fakeCtx(),
      toBlob,
    } as unknown as HTMLCanvasElement;
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as HTMLElement & HTMLCanvasElement);
    await downscaleImage(new File(['x'], 'a.png', { type: 'image/png' }));
    expect(canvas.width).toBe(800);
  });

  it('bounds height too, for a tall narrow image', async () => {
    const toBlob = vi.fn((cb: (b: Blob | null) => void) =>
      cb(new Blob(['x'], { type: 'image/jpeg' })),
    );
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => fakeBitmap(1200, 9000)),
    );
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => fakeCtx(),
      toBlob,
    } as unknown as HTMLCanvasElement;
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as HTMLElement & HTMLCanvasElement);
    // maxWidth 1920, quality 0.82, maxHeight 1080 (defaults): height is the
    // binding constraint, not width.
    await downscaleImage(new File(['x'], 'a.png', { type: 'image/png' }));
    expect(canvas.height).toBe(1080);
    expect(canvas.width).toBe(Math.round(1200 * (1080 / 9000)));
  });

  it("flattens transparency onto the report cover's backdrop, not white", async () => {
    const ctx = fakeCtx();
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
      getContext: () => ctx,
      toBlob,
    } as unknown as HTMLCanvasElement;
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as HTMLElement & HTMLCanvasElement);
    await downscaleImage(new File(['x'], 'a.png', { type: 'image/png' }));
    // Must track `.cover-art`'s background in the report template — a white
    // fill turned every transparent PNG into a white block on the dark cover.
    expect(ctx.fillStyle).toBe('#26221F');
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 800, 400);
    expect(ctx.fillRect.mock.invocationCallOrder[0]).toBeLessThan(
      ctx.drawImage.mock.invocationCallOrder[0],
    );
  });

  it('releases the bitmap even when getContext fails', async () => {
    const bitmap = fakeBitmap(800, 400);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => bitmap),
    );
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => null,
    } as unknown as HTMLCanvasElement;
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as HTMLElement & HTMLCanvasElement);

    await expect(downscaleImage(new File(['x'], 'a.png', { type: 'image/png' }))).rejects.toThrow(
      'Falha ao processar a imagem',
    );
    expect((bitmap as unknown as { close: () => void }).close).toHaveBeenCalled();
  });
});

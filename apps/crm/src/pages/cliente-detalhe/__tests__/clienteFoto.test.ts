import { describe, expect, it, vi } from 'vitest';
import { resizeClientePhoto } from '../clienteFoto';

function fakeBitmap(w: number, h: number) {
  return { width: w, height: h, close: vi.fn() } as unknown as ImageBitmap;
}

function stubCanvas(toBlob: (cb: (b: Blob | null) => void) => void) {
  const ctx = { drawImage: vi.fn() };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toBlob: vi.fn(toBlob),
  } as unknown as HTMLCanvasElement;
  vi.spyOn(document, 'createElement').mockReturnValue(canvas as HTMLElement & HTMLCanvasElement);
  return { canvas, ctx };
}

describe('resizeClientePhoto', () => {
  it('caps the square side at 512 for a large image', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => fakeBitmap(2000, 2000)),
    );
    const { canvas } = stubCanvas((cb) => cb(new Blob(['x'], { type: 'image/png' })));

    await resizeClientePhoto(new File(['x'], 'a.png', { type: 'image/png' }));

    expect(canvas.width).toBe(512);
    expect(canvas.height).toBe(512);
  });

  it('does not upscale a small image', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => fakeBitmap(200, 300)),
    );
    const { canvas } = stubCanvas((cb) => cb(new Blob(['x'], { type: 'image/png' })));

    await resizeClientePhoto(new File(['x'], 'a.png', { type: 'image/png' }));

    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(200);
  });

  it('uses the shorter side for a non-square source (WorkspaceTab-parity, not a crop)', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => fakeBitmap(800, 400)),
    );
    const { canvas, ctx } = stubCanvas((cb) => cb(new Blob(['x'], { type: 'image/png' })));

    await resizeClientePhoto(new File(['x'], 'a.png', { type: 'image/png' }));

    expect(canvas.width).toBe(400);
    expect(canvas.height).toBe(400);
    // Whole source drawn into the square — this stretches non-square images,
    // matching WorkspaceTab.handleLogoUpload exactly.
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 400, 400);
  });

  it('outputs image/png', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => fakeBitmap(300, 300)),
    );
    const { canvas } = stubCanvas((cb) => cb(new Blob(['x'], { type: 'image/png' })));

    await resizeClientePhoto(new File(['x'], 'a.png', { type: 'image/png' }));

    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png');
  });

  it('releases the bitmap even when getContext fails', async () => {
    const bitmap = fakeBitmap(300, 300);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => bitmap),
    );
    const canvas = { width: 0, height: 0, getContext: () => null } as unknown as HTMLCanvasElement;
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as HTMLElement & HTMLCanvasElement);

    await expect(
      resizeClientePhoto(new File(['x'], 'a.png', { type: 'image/png' })),
    ).rejects.toThrow('Falha ao processar a imagem');
    expect((bitmap as unknown as { close: () => void }).close).toHaveBeenCalled();
  });
});

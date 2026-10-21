import { afterEach, describe, expect, it, vi } from 'vitest';
import { cropPessoaPhoto, MAX_PESSOA_FOTO_BYTES } from '../pessoaFoto';

function fakeBitmap(w: number, h: number) {
  return { width: w, height: h, close: vi.fn() } as unknown as ImageBitmap;
}

function stubCanvas(toBlob: (cb: (b: Blob | null) => void) => void = (cb) => cb(new Blob(['x']))) {
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

const file = () => new File(['x'], 'foto.jpg', { type: 'image/jpeg' });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('cropPessoaPhoto', () => {
  it('crops the centered square', async () => {
    const bitmap = fakeBitmap(4032, 3024);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => bitmap),
    );
    const { canvas, ctx } = stubCanvas();

    await cropPessoaPhoto(file());

    expect(canvas.width).toBe(512);
    expect(canvas.height).toBe(512);
    expect(ctx.drawImage).toHaveBeenCalledWith(bitmap, 504, 0, 3024, 3024, 0, 0, 512, 512);
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.85);
  });

  it('crops a portrait source vertically centered', async () => {
    const bitmap = fakeBitmap(3024, 4032);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => bitmap),
    );
    const { ctx } = stubCanvas();

    await cropPessoaPhoto(file());

    expect(ctx.drawImage).toHaveBeenCalledWith(bitmap, 0, 504, 3024, 3024, 0, 0, 512, 512);
  });

  it('never upscales', async () => {
    const bitmap = fakeBitmap(300, 200);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => bitmap),
    );
    const { canvas, ctx } = stubCanvas();

    await cropPessoaPhoto(file());

    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(200);
    expect(ctx.drawImage).toHaveBeenCalledWith(bitmap, 50, 0, 200, 200, 0, 0, 200, 200);
  });

  it('releases the bitmap when the canvas has no context', async () => {
    const bitmap = fakeBitmap(300, 300);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => bitmap),
    );
    const canvas = { width: 0, height: 0, getContext: () => null } as unknown as HTMLCanvasElement;
    vi.spyOn(document, 'createElement').mockReturnValue(canvas as HTMLElement & HTMLCanvasElement);

    await expect(cropPessoaPhoto(file())).rejects.toThrow('Falha ao processar a imagem');
    expect((bitmap as unknown as { close: () => void }).close).toHaveBeenCalled();
  });

  it('rejects when the canvas yields no blob', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => fakeBitmap(300, 300)),
    );
    stubCanvas((cb) => cb(null));

    await expect(cropPessoaPhoto(file())).rejects.toThrow('Falha ao processar a imagem');
  });

  it('caps the input at 10 MB', () => {
    expect(MAX_PESSOA_FOTO_BYTES).toBe(10 * 1024 * 1024);
  });
});

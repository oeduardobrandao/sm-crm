import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareReportImage, scaledSize, validateReportImage } from '../reportImageUpload';

const f = (type: string, bytes: number) => new File([new Uint8Array(bytes)], 'x', { type });

describe('validateReportImage', () => {
  it('aceita jpg/png/webp até 10 MB', () => {
    expect(validateReportImage(f('image/png', 10))).toBeNull();
    expect(validateReportImage(f('image/webp', 10 * 1024 * 1024))).toBeNull();
  });
  it('formato não suportado', () => {
    expect(validateReportImage(f('image/gif', 10))).toBe(
      'Formato não suportado. Use JPG, PNG ou WebP.',
    );
  });
  it('acima do limite mostra o tamanho', () => {
    expect(validateReportImage(f('image/jpeg', 18 * 1024 * 1024))).toBe(
      'Esta imagem tem 18 MB. O limite é 10 MB.',
    );
  });
  it('tamanho fracionário usa uma casa decimal com vírgula', () => {
    expect(validateReportImage(f('image/jpeg', Math.round(10.4 * 1024 * 1024)))).toBe(
      'Esta imagem tem 10,4 MB. O limite é 10 MB.',
    );
  });
  it('logo acima do limite nunca lê como 10 MB', () => {
    expect(validateReportImage(f('image/jpeg', 10 * 1024 * 1024 + 1))).toBe(
      'Esta imagem tem 10,1 MB. O limite é 10 MB.',
    );
  });
});

describe('scaledSize', () => {
  it('nunca amplia e limita o maior lado a 2400', () => {
    expect(scaledSize(1200, 800)).toEqual({ width: 1200, height: 800 });
    expect(scaledSize(4800, 2400)).toEqual({ width: 2400, height: 1200 });
    expect(scaledSize(1000, 5000)).toEqual({ width: 480, height: 2400 });
  });
  it('cada lado tem pelo menos 1 px', () => {
    expect(scaledSize(10000, 1)).toEqual({ width: 2400, height: 1 });
    expect(scaledSize(1, 10000)).toEqual({ width: 1, height: 2400 });
  });
});

describe('prepareReportImage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it('lê a orientação EXIF (from-image) e usa as dimensões já de pé', async () => {
    const bitmap = { width: 900, height: 1600, close: vi.fn() };
    const create = vi.fn(async () => bitmap);
    vi.stubGlobal('createImageBitmap', create);
    const file = f('image/jpeg', 10);
    const out = await prepareReportImage(file);
    expect(create).toHaveBeenCalledWith(file, { imageOrientation: 'from-image' });
    expect(out).toEqual({ file, width: 900, height: 1600 });
    expect(bitmap.close).toHaveBeenCalled();
  });
});

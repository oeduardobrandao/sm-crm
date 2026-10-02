import { describe, expect, it } from 'vitest';
import { scaledSize, validateReportImage } from '../reportImageUpload';

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
});

describe('scaledSize', () => {
  it('nunca amplia e limita o maior lado a 2400', () => {
    expect(scaledSize(1200, 800)).toEqual({ width: 1200, height: 800 });
    expect(scaledSize(4800, 2400)).toEqual({ width: 2400, height: 1200 });
    expect(scaledSize(1000, 5000)).toEqual({ width: 480, height: 2400 });
  });
});

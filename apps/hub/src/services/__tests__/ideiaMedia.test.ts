import { describe, it, expect } from 'vitest';
import { validateIdeiaImage, IMAGE_MIME, MAX_IMAGE_BYTES } from '../ideiaMedia';

function fakeFile(type: string, size: number): File {
  const f = new File([new Uint8Array(1)], 'x', { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

describe('validateIdeiaImage', () => {
  it('accepts a normal jpeg', () => {
    expect(() => validateIdeiaImage(fakeFile('image/jpeg', 1000))).not.toThrow();
  });
  it('rejects non-image types', () => {
    expect(() => validateIdeiaImage(fakeFile('application/pdf', 1000))).toThrow();
  });
  it('rejects files over the size cap', () => {
    expect(() => validateIdeiaImage(fakeFile('image/png', MAX_IMAGE_BYTES + 1))).toThrow();
  });
  it('exposes the allowed mime list', () => {
    expect(IMAGE_MIME).toContain('image/webp');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { encodeImageAsJpeg } from '../imageJpeg';

class MockImage {
  naturalWidth = 4000;
  naturalHeight = 2000;
  onload: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  set src(_v: string) {
    queueMicrotask(() => this.onload?.());
  }
}

const canvases: { width: number; height: number; type?: string; quality?: number }[] = [];

beforeEach(() => {
  canvases.length = 0;
  vi.stubGlobal('Image', MockImage);

  const RealURL = globalThis.URL;
  class MockURL extends RealURL {
    static createObjectURL() {
      return 'blob:mock';
    }
    static revokeObjectURL() {
      return undefined;
    }
  }
  vi.stubGlobal('URL', MockURL);

  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag === 'canvas') {
      const c = {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: () => {} }),
        toBlob: (cb: (b: Blob | null) => void, type?: string, quality?: number) => {
          canvases.push({ width: c.width, height: c.height, type, quality });
          queueMicrotask(() => cb(new Blob([new Uint8Array(32)], { type: 'image/jpeg' })));
        },
      };
      return c as unknown as HTMLCanvasElement;
    }
    return realCreate(tag);
  });
});

function file(type: string) {
  return new File([new Uint8Array(16)], 'x', { type });
}

describe('encodeImageAsJpeg', () => {
  it('outputs a JPEG File named cover.jpg', async () => {
    const out = await encodeImageAsJpeg(file('image/png'));
    expect(out.type).toBe('image/jpeg');
    expect(out.name).toBe('cover.jpg');
  });

  it('caps the longest edge (4000x2000 -> 1920x960)', async () => {
    await encodeImageAsJpeg(file('image/png'));
    expect(canvases[0]).toMatchObject({ width: 1920, height: 960 });
  });

  it('runs even for JPEG input (no short-circuit — still caps a 4000px JPEG)', async () => {
    await encodeImageAsJpeg(file('image/jpeg'));
    expect(canvases[0]).toMatchObject({ width: 1920, height: 960 });
  });

  it('honors a custom maxEdge and quality', async () => {
    await encodeImageAsJpeg(file('image/png'), 1000, 0.6);
    expect(canvases[0]).toMatchObject({
      width: 1000,
      height: 500,
      type: 'image/jpeg',
      quality: 0.6,
    });
  });
});

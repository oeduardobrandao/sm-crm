import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const frameMock = vi.hoisted(() => ({ extractVideoFrame: vi.fn() }));
const ideiaMock = vi.hoisted(() => ({
  probeImage: vi.fn(),
  generateThumbnail: vi.fn(),
  generateBlur: vi.fn(),
}));
vi.mock('@mesaas/ui/video/frame', () => frameMock);
vi.mock('../ideiaMedia', () => ideiaMock);

import {
  MAX_REFERENCE_THUMB_BYTES,
  drawNeutralPoster,
  prepareReferenceMedia,
} from '../referenceMedia';

function sizedFile(name: string, type: string, size: number): File {
  const f = new File([new Uint8Array(1)], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

/** Detached <video> that reports metadata as soon as it gets a src. */
class MockVideo {
  preload = '';
  muted = false;
  playsInline = false;
  videoWidth = 1080;
  videoHeight = 1920;
  duration = 12.4;
  onloadedmetadata: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_value: string) {
    queueMicrotask(() => this.onloadedmetadata?.());
  }
  removeAttribute() {}
  load() {}
}

const drawCalls: string[] = [];

/** jsdom has no canvas: a 2D context that records every drawing call. */
function fakeCanvas() {
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_target, prop) => () => {
      drawCalls.push(String(prop));
    },
    set: () => true,
  });
  return {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toBlob: (cb: (blob: Blob | null) => void, type: string) => cb(new Blob(['poster'], { type })),
  };
}

const urlStatics = URL as unknown as Record<string, unknown>;

describe('prepareReferenceMedia', () => {
  beforeEach(() => {
    drawCalls.length = 0;
    frameMock.extractVideoFrame.mockReset();
    ideiaMock.probeImage.mockReset();
    ideiaMock.generateThumbnail.mockReset();
    ideiaMock.generateBlur.mockReset();
    urlStatics.createObjectURL = vi.fn(() => 'blob:local');
    urlStatics.revokeObjectURL = vi.fn();
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag === 'video') return new MockVideo() as unknown as HTMLElement;
      if (tag === 'canvas') return fakeCanvas() as unknown as HTMLElement;
      return realCreate(tag);
    }) as typeof document.createElement);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete urlStatics.createObjectURL;
    delete urlStatics.revokeObjectURL;
  });

  it('returns no thumbnail for a PDF', async () => {
    const media = await prepareReferenceMedia(
      sizedFile('a.pdf', 'application/pdf', 10),
      'document',
    );
    expect(media).toEqual({ thumbnail: null });
    expect(ideiaMock.generateThumbnail).not.toHaveBeenCalled();
  });

  it('builds an image thumbnail at 480px with blur and dimensions', async () => {
    const thumb = sizedFile('thumb.webp', 'image/webp', 40_000);
    ideiaMock.generateThumbnail.mockResolvedValue(thumb);
    ideiaMock.generateBlur.mockResolvedValue('data:image/webp;base64,AAA');
    ideiaMock.probeImage.mockResolvedValue({ width: 1080, height: 1350 });
    const file = sizedFile('foto.jpg', 'image/jpeg', 2_000_000);

    const media = await prepareReferenceMedia(file, 'image');

    expect(ideiaMock.generateThumbnail).toHaveBeenCalledWith(file, 480);
    expect(media).toEqual({
      thumbnail: thumb,
      blurDataUrl: 'data:image/webp;base64,AAA',
      width: 1080,
      height: 1350,
    });
  });

  it('shrinks the thumbnail until it fits the 512 KB cap', async () => {
    ideiaMock.generateThumbnail
      .mockResolvedValueOnce(sizedFile('t.webp', 'image/webp', MAX_REFERENCE_THUMB_BYTES + 1))
      .mockResolvedValueOnce(sizedFile('t.webp', 'image/webp', 100_000));
    ideiaMock.generateBlur.mockResolvedValue(undefined);
    ideiaMock.probeImage.mockResolvedValue({ width: 4000, height: 3000 });

    const media = await prepareReferenceMedia(
      sizedFile('big.png', 'image/png', 9_000_000),
      'image',
    );

    expect(ideiaMock.generateThumbnail.mock.calls.map((call) => call[1])).toEqual([480, 320]);
    expect(media.thumbnail?.size).toBe(100_000);
  });

  it('uses the first video frame as the poster, with duration and size from the metadata', async () => {
    const frame = sizedFile('thumb.jpg', 'image/jpeg', 300_000);
    const thumb = sizedFile('thumb.webp', 'image/webp', 30_000);
    frameMock.extractVideoFrame.mockResolvedValue(frame);
    ideiaMock.generateThumbnail.mockResolvedValue(thumb);
    ideiaMock.generateBlur.mockResolvedValue('data:blur');

    const media = await prepareReferenceMedia(
      sizedFile('clip.mp4', 'video/mp4', 50_000_000),
      'video',
    );

    expect(ideiaMock.generateThumbnail).toHaveBeenCalledWith(frame, 480);
    expect(media).toEqual({
      thumbnail: thumb,
      blurDataUrl: 'data:blur',
      width: 1080,
      height: 1920,
      durationSeconds: 12,
    });
  });

  it('draws a neutral poster with a play glyph when no frame can be decoded (HEVC in Chrome)', async () => {
    frameMock.extractVideoFrame.mockRejectedValue(new Error('decode'));

    const media = await prepareReferenceMedia(
      sizedFile('clip.mov', 'video/quicktime', 5_000_000),
      'video',
    );

    expect(media.thumbnail).toBeInstanceOf(File);
    expect(media.thumbnail?.type).toBe('image/webp');
    expect(drawCalls).toContain('arc');
    expect(ideiaMock.generateThumbnail).not.toHaveBeenCalled();
    expect(media.durationSeconds).toBe(12);
  });

  it('draws a plain neutral tile when asked for no play glyph', async () => {
    const poster = await drawNeutralPoster(false);
    expect(poster.name).toBe('thumb.webp');
    expect(drawCalls).toEqual(['fillRect']);
  });
});

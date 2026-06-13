import { beforeEach, describe, expect, it, vi } from 'vitest';

import { captureFrameFromElement, extractVideoFrame } from '../videoFrame';

class MockVideo {
  static instances: MockVideo[] = [];
  // When true, the created element exposes a requestVideoFrameCallback that
  // accepts a callback but never invokes it — exactly how real browsers behave
  // for a detached, paused <video>. Capture must not depend on it firing.
  static neverFiringRvfc = false;

  preload = '';
  muted = false;
  playsInline = false;
  crossOrigin: string | null = null;
  videoWidth = 3840;
  videoHeight = 2160;
  duration = 13.2;
  readyState = 2; // HAVE_CURRENT_DATA
  currentTimeValue = 0;
  onloadedmetadata: (() => void) | null = null;
  onseeked: (() => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  srcValue = '';
  failOnLoad = false;

  constructor() {
    MockVideo.instances.push(this);
    if (MockVideo.neverFiringRvfc) {
      (this as unknown as { requestVideoFrameCallback: () => number }).requestVideoFrameCallback =
        () => 1;
    }
  }

  set src(value: string) {
    this.srcValue = value;
    queueMicrotask(() => {
      if (this.failOnLoad) this.onerror?.(new Event('error'));
      else this.onloadedmetadata?.();
    });
  }

  get src() {
    return this.srcValue;
  }

  set currentTime(value: number) {
    this.currentTimeValue = value;
    queueMicrotask(() => this.onseeked?.());
  }

  get currentTime() {
    return this.currentTimeValue;
  }

  removeAttribute() {}
  load() {}
}

const canvases: { width: number; height: number }[] = [];

beforeEach(() => {
  MockVideo.instances.length = 0;
  MockVideo.neverFiringRvfc = false;
  canvases.length = 0;

  // Capture is driven off requestAnimationFrame; fire it on the microtask queue
  // so the extraction promise settles within an awaited test.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    queueMicrotask(() => cb(0));
    return 0;
  });

  const realCreateElement = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
    if (tagName === 'video') return new MockVideo() as unknown as HTMLVideoElement;
    if (tagName === 'canvas') {
      const fakeBlob = new Blob([new Uint8Array(64)], { type: 'image/jpeg' });
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: () => {} }),
        toBlob: (cb: (blob: Blob | null) => void) => queueMicrotask(() => cb(fakeBlob)),
      };
      canvases.push(canvas);
      return canvas as unknown as HTMLCanvasElement;
    }
    return realCreateElement(tagName);
  });

  const RealURL = globalThis.URL;
  class MockURL extends RealURL {
    static createObjectURL() {
      return 'blob:mocked';
    }

    static revokeObjectURL() {
      return undefined;
    }
  }
  vi.stubGlobal('URL', MockURL);
});

function createVideoFile() {
  return new File([new Uint8Array(256)], 'reel.mp4', { type: 'video/mp4' });
}

describe('captureFrameFromElement', () => {
  it('captures a JPEG scaled so the longest edge is 1920', async () => {
    const video = new MockVideo();
    const file = await captureFrameFromElement(video as unknown as HTMLVideoElement);

    expect(file.type).toBe('image/jpeg');
    expect(file.name).toBe('thumb.jpg');
    expect(canvases[0]).toMatchObject({ width: 1920, height: 1080 });
  });

  it('does not upscale small videos', async () => {
    const video = new MockVideo();
    video.videoWidth = 720;
    video.videoHeight = 1280;
    await captureFrameFromElement(video as unknown as HTMLVideoElement);

    expect(canvases[0]).toMatchObject({ width: 720, height: 1280 });
  });

  it('rejects when no frame data is available yet', async () => {
    const video = new MockVideo();
    video.readyState = 1; // HAVE_METADATA

    await expect(captureFrameFromElement(video as unknown as HTMLVideoElement)).rejects.toThrow();
  });
});

describe('extractVideoFrame', () => {
  it('seeks to min(0.5, duration/2) and resolves with a frame', async () => {
    const file = await extractVideoFrame(createVideoFile());

    expect(file.type).toBe('image/jpeg');
    expect(MockVideo.instances[0].currentTimeValue).toBe(0.5);
    expect(MockVideo.instances[0].muted).toBe(true);
  });

  it('halves the seek target for very short videos', async () => {
    const promise = extractVideoFrame(createVideoFile());
    MockVideo.instances[0].duration = 0.6;
    await promise;

    expect(MockVideo.instances[0].currentTimeValue).toBeCloseTo(0.3);
  });

  it('falls back to t=0 when duration is not finite', async () => {
    const promise = extractVideoFrame(createVideoFile());
    MockVideo.instances[0].duration = NaN;
    await promise;

    expect(MockVideo.instances[0].currentTimeValue).toBe(0);
  });

  it('honors an explicit timeSeconds', async () => {
    await extractVideoFrame(createVideoFile(), 7.25);

    expect(MockVideo.instances[0].currentTimeValue).toBe(7.25);
  });

  it('sets crossOrigin only for remote URLs', async () => {
    await extractVideoFrame('https://r2.example.com/video.mp4?signed=1');
    expect(MockVideo.instances[0].crossOrigin).toBe('anonymous');

    await extractVideoFrame(createVideoFile());
    expect(MockVideo.instances[1].crossOrigin).toBeNull();
  });

  it('rejects when the video cannot be decoded', async () => {
    const promise = extractVideoFrame(createVideoFile());
    MockVideo.instances[0].failOnLoad = true;

    await expect(promise).rejects.toThrow('Não foi possível decodificar o vídeo');
  });

  it('captures via requestAnimationFrame even when requestVideoFrameCallback never fires', async () => {
    // Regression: real browsers never fire rVFC for a detached, paused <video>,
    // so the previous rVFC-based capture hung until the load timeout and the UI
    // fell back to a manual thumbnail. Capture must come from `seeked` + rAF.
    MockVideo.neverFiringRvfc = true;

    const file = await extractVideoFrame(createVideoFile());

    expect(file.type).toBe('image/jpeg');
  });
});

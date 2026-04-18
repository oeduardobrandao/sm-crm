import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFetchMock } from '../../../../../test/shared/fetchMock';

vi.mock('../../lib/supabase');

import {
  deletePostMedia,
  detectKind,
  listPostMedia,
  reorderPostMedia,
  setPostMediaCover,
  uploadMany,
  uploadPostMedia,
  validateFile,
} from '../postMedia';

class MockImage {
  naturalWidth = 1080;
  naturalHeight = 1350;
  onload: (() => void) | null = null;
  onerror: ((error: Event) => void) | null = null;

  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

class MockXHR {
  static instances: MockXHR[] = [];

  status = 200;
  method = '';
  url = '';
  body: File | null = null;
  headers = new Map<string, string>();
  upload = {
    onprogress: null as ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    MockXHR.instances.push(this);
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.headers.set(name, value);
  }

  send(body: File) {
    this.body = body;
    this.upload.onprogress?.({ lengthComputable: true, loaded: body.size, total: body.size });
    queueMicrotask(() => this.onload?.());
  }
}

const fetchHarness = createFetchMock();

function createFile(name: string, type: string, size = 128) {
  return new File([new Uint8Array(size)], name, { type });
}

describe('post media service', () => {
  beforeEach(() => {
    fetchHarness.reset();
    MockXHR.instances.length = 0;

    vi.stubGlobal('fetch', fetchHarness.fetchMock);
    vi.stubGlobal('Image', MockImage);
    vi.stubGlobal('XMLHttpRequest', MockXHR);
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

    const realCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName === 'video') {
        return {
          preload: '',
          videoWidth: 1920,
          videoHeight: 1080,
          duration: 13.2,
          onloadedmetadata: null as (() => void) | null,
          onerror: null as ((event: Event) => void) | null,
          set src(_value: string) {
            queueMicrotask(() => this.onloadedmetadata?.());
          },
        } as unknown as HTMLVideoElement;
      }

      return realCreateElement(tagName);
    });
  });

  it('validates supported media kinds and file limits', () => {
    expect(detectKind(createFile('cliente.jpg', 'image/jpeg'))).toBe('image');
    expect(detectKind(createFile('reel.mp4', 'video/mp4'))).toBe('video');
    expect(() => detectKind(createFile('planilha.pdf', 'application/pdf'))).toThrow(
      'Tipo não suportado: application/pdf',
    );
    expect(() => validateFile(createFile('grande.mov', 'video/quicktime', 450 * 1024 * 1024), 'video')).toThrow(
      'Arquivo maior que 400 MB',
    );
  });

  it('lists media through the edge function helper', async () => {
    fetchHarness.queueResponse({
      json: {
        media: [
          { id: 1, post_id: 9, kind: 'image', sort_order: 0 },
        ],
      },
    });

    const media = await listPostMedia(9);

    expect(media).toEqual([{ id: 1, post_id: 9, kind: 'image', sort_order: 0 }]);
    expect(String(fetchHarness.calls[0].input)).toContain('post-media-manage');
    expect(String(fetchHarness.calls[0].input)).toContain('post_id=9');
  });

  it('uploads an image, sends progress updates, and finalizes the record', async () => {
    const image = createFile('campanha-abril.png', 'image/png', 256);
    const onProgress = vi.fn();

    fetchHarness.queueResponse({
      json: {
        media_id: 'media-1',
        upload_url: 'https://upload.r2.dev/media-1',
        r2_key: 'contas/1/posts/media-1.png',
      },
    });
    fetchHarness.queueResponse({
      json: {
        id: 1,
        post_id: 22,
        kind: 'image',
        r2_key: 'contas/1/posts/media-1.png',
        is_cover: true,
      },
    });

    const media = await uploadPostMedia({
      postId: 22,
      file: image,
      onProgress,
    });

    expect(media).toMatchObject({
      id: 1,
      post_id: 22,
      kind: 'image',
      is_cover: true,
    });
    expect(fetchHarness.calls).toHaveLength(2);
    expect(JSON.parse(String(fetchHarness.calls[0].init?.body))).toMatchObject({
      post_id: 22,
      filename: 'campanha-abril.png',
      mime_type: 'image/png',
      kind: 'image',
    });
    expect(JSON.parse(String(fetchHarness.calls[1].init?.body))).toMatchObject({
      post_id: 22,
      media_id: 'media-1',
      width: 1080,
      height: 1350,
      original_filename: 'campanha-abril.png',
    });
    expect(MockXHR.instances).toHaveLength(1);
    expect(MockXHR.instances[0].method).toBe('PUT');
    expect(MockXHR.instances[0].url).toBe('https://upload.r2.dev/media-1');
    expect(onProgress).toHaveBeenCalledWith({ loaded: 256, total: 256 });
  });

  it('requires a thumbnail when uploading videos', async () => {
    await expect(
      uploadPostMedia({
        postId: 31,
        file: createFile('bastidores.mp4', 'video/mp4', 512),
      }),
    ).rejects.toThrow('Vídeos exigem uma thumbnail');
  });

  it('updates, deletes, and batches uploads through the shared function wrapper', async () => {
    fetchHarness.queueResponse({ json: { id: 7, is_cover: true } });
    fetchHarness.queueResponse({ json: { id: 7, sort_order: 3 } });
    fetchHarness.queueResponse({ json: {} });

    await expect(setPostMediaCover(7)).resolves.toMatchObject({ id: 7, is_cover: true });
    await expect(reorderPostMedia(7, 3)).resolves.toMatchObject({ id: 7, sort_order: 3 });
    await expect(deletePostMedia(7)).resolves.toBeUndefined();

    const started: number[] = [];
    const finished: number[] = [];
    await uploadMany([1, 2, 3, 4], async (value) => {
      started.push(value);
      await Promise.resolve();
      finished.push(value);
    }, 2);

    expect(started).toHaveLength(4);
    expect(finished).toEqual([1, 2, 3, 4]);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({
  createKbVideoUpload: vi.fn(),
  cancelKbVideoUpload: vi.fn(),
}));

import { cancelKbVideoUpload, createKbVideoUpload } from '../api';
import { postToStream, uploadKbVideo, validateVideoFile } from '../stream-upload';

class FakeXhr {
  static last: FakeXhr | null = null;
  method = '';
  url = '';
  body: unknown = null;
  status = 0;
  timeout = 0;
  upload: {
    onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null;
  } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  send(body: unknown) {
    this.body = body;
  }
  abort() {
    this.onabort?.();
  }
}

beforeEach(() => {
  FakeXhr.last = null;
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  vi.mocked(createKbVideoUpload).mockResolvedValue({
    uploadURL: 'https://upload.example/u1',
    video: { id: 7, stream_uid: 'u1' },
  } as never);
  vi.mocked(cancelKbVideoUpload).mockResolvedValue({ video: {} } as never);
});

const file = new File(['x'], 'tutorial.mp4', { type: 'video/mp4' });

describe('validateVideoFile', () => {
  it('accepts videos up to 200 MB only', () => {
    expect(validateVideoFile(file)).toBeNull();
    expect(validateVideoFile(new File(['x'], 'a.png', { type: 'image/png' }))).toMatch(/vídeo/);
    const big = new File(['x'], 'big.mp4', { type: 'video/mp4' });
    Object.defineProperty(big, 'size', { value: 201 * 1024 * 1024 });
    expect(validateVideoFile(big)).toMatch(/200 MB/);
  });
});

describe('postToStream', () => {
  it('POSTs the file as multipart "file" and reports progress', async () => {
    const onProgress = vi.fn();
    const done = postToStream('https://upload.example/u1', file, onProgress);
    const xhr = FakeXhr.last!;
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('https://upload.example/u1');
    expect((xhr.body as FormData).get('file')).toBe(file);
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
    expect(onProgress).toHaveBeenCalledWith(0.5);
    xhr.status = 200;
    xhr.onload?.();
    await expect(done).resolves.toBeUndefined();
  });

  it('rejects on a non-2xx answer', async () => {
    const done = postToStream('https://upload.example/u1', file);
    FakeXhr.last!.status = 400;
    FakeXhr.last!.onload?.();
    await expect(done).rejects.toThrow('400');
  });
});

describe('uploadKbVideo', () => {
  it('cancels the reservation when the upload is aborted', async () => {
    const controller = new AbortController();
    const done = uploadKbVideo(7, file, { signal: controller.signal });
    await vi.waitFor(() => expect(FakeXhr.last).not.toBeNull());
    controller.abort();
    await expect(done).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancelKbVideoUpload).toHaveBeenCalledWith(7, 'u1');
  });

  it('returns the pending video after a successful upload', async () => {
    const done = uploadKbVideo(7, file);
    await vi.waitFor(() => expect(FakeXhr.last).not.toBeNull());
    FakeXhr.last!.status = 200;
    FakeXhr.last!.onload?.();
    await expect(done).resolves.toMatchObject({ id: 7, stream_uid: 'u1' });
    expect(cancelKbVideoUpload).not.toHaveBeenCalled();
  });
});

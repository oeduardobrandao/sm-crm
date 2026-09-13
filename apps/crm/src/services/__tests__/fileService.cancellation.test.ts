import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../../lib/supabase');
import { uploadFile } from '../fileService';
const documentFile = new File(['pdf'], 'a.pdf', { type: 'application/pdf' });
afterEach(() => vi.unstubAllGlobals());
it('aborts presigning and never starts a PUT after cancellation', async () => {
  const controller = new AbortController();
  const xhr = vi.fn();
  vi.stubGlobal('XMLHttpRequest', xhr);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init) => {
      controller.abort();
      expect(init.signal.aborted).toBe(true);
      return new Response(
        JSON.stringify({ upload_url: 'https://put', file_id: 'uuid', kind: 'document' }),
      );
    }),
  );
  await expect(
    uploadFile({ file: documentFile, folderId: null, signal: controller.signal }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(xhr).not.toHaveBeenCalled();
});
for (const failure of ['cancel', 'timeout']) {
  it(`stops PUT on ${failure} and never finalizes`, async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ upload_url: 'https://put', file_id: 'uuid', kind: 'document' }),
        ),
    );
    vi.stubGlobal('fetch', fetcher);
    let aborted = false;
    class XHR {
      timeout = 0;
      upload = {};
      onabort?: () => void;
      ontimeout?: () => void;
      open() {}
      setRequestHeader() {}
      abort() {
        aborted = true;
        this.onabort?.();
      }
      send() {
        expect(this.timeout).toBeGreaterThan(0);
        queueMicrotask(() => (failure === 'cancel' ? controller.abort() : this.ontimeout?.()));
      }
    }
    vi.stubGlobal('XMLHttpRequest', XHR);
    await expect(
      uploadFile({ file: documentFile, folderId: null, signal: controller.signal }),
    ).rejects.toMatchObject({ name: failure === 'cancel' ? 'AbortError' : 'TimeoutError' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    if (failure === 'cancel') expect(aborted).toBe(true);
  });
}

it('aborts finalization after a successful PUT without deleting the uploaded object', async () => {
  const controller = new AbortController();
  const fetcher = vi.fn(async (url, init) => {
    if (String(url).endsWith('file-upload-finalize')) {
      controller.abort();
      expect(init.signal.aborted).toBe(true);
      throw controller.signal.reason;
    }
    return new Response(
      JSON.stringify({ upload_url: 'https://put', file_id: 'uuid', kind: 'document' }),
    );
  });
  vi.stubGlobal('fetch', fetcher);
  class XHR {
    status = 200;
    upload = {};
    onload?: () => void;
    open() {}
    setRequestHeader() {}
    send() {
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal('XMLHttpRequest', XHR);
  await expect(
    uploadFile({ file: documentFile, folderId: null, signal: controller.signal }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls.every(([, init]) => init.method === 'POST')).toBe(true);
});

it('sets a deadline on both presigning and finalization', async () => {
  const signals: AbortSignal[] = [];
  const deadline = vi.spyOn(AbortSignal, 'timeout');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init) => {
      signals.push(init.signal);
      return new Response(
        JSON.stringify({ upload_url: 'https://put', file_id: 'uuid', kind: 'document', id: 42 }),
      );
    }),
  );
  class XHR {
    status = 200;
    upload = {};
    onload?: () => void;
    open() {}
    setRequestHeader() {}
    send() {
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal('XMLHttpRequest', XHR);
  await uploadFile({ file: documentFile, folderId: null });
  expect(signals).toHaveLength(2);
  expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true);
  expect(deadline).toHaveBeenCalledWith(30_000);
  deadline.mockRestore();
});

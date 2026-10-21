import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReferenceItem } from '../../types/postReferences';

const svc = vi.hoisted(() => ({
  fetchPostReferences: vi.fn(),
  uploadPostReference: vi.fn(),
  addPostReferenceLink: vi.fn(),
  updatePostReferenceNote: vi.fn(),
  removePostReference: vi.fn(),
}));
vi.mock('../../services/postReferences', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/postReferences')>()),
  ...svc,
}));

import { PostReferenceError } from '../../services/postReferences';
import { postReferencesKey, usePostReferences } from '../usePostReferences';

function item(id: number, over: Partial<ReferenceItem> = {}): ReferenceItem {
  return {
    id,
    kind: 'file',
    file_kind: 'image',
    name: `f${id}.jpg`,
    mime_type: 'image/jpeg',
    size_bytes: 1000,
    duration_seconds: null,
    width: null,
    height: null,
    url: 'https://r2/get',
    thumbnail_url: null,
    blur_data_url: null,
    download_url: null,
    link_url: null,
    link_title: null,
    link_domain: null,
    note: null,
    post_approval_id: null,
    created_at: '2026-10-08T12:00:00.000Z',
    can_remove: true,
    ...over,
  };
}

function file(name: string, type = 'image/jpeg', size = 1000): File {
  const f = new File([new Uint8Array(1)], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(initial: { can_add: boolean; items: ReferenceItem[] }) {
  svc.fetchPostReferences.mockResolvedValue(initial);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, ...renderHook(() => usePostReferences('tok', 5), { wrapper }) };
}

describe('usePostReferences', () => {
  beforeEach(() => {
    Object.values(svc).forEach((fn) => fn.mockReset());
  });

  it('loads the list under the hub-post-references key', async () => {
    const { result, qc } = setup({ can_add: true, items: [item(1)] });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.canAdd).toBe(true);
    expect(svc.fetchPostReferences).toHaveBeenCalledWith('tok', 5);
    expect(qc.getQueryData(postReferencesKey(5))).toEqual({ can_add: true, items: [item(1)] });
    expect(postReferencesKey(5)).toEqual(['hub-post-references', 5]);
  });

  it('runs at most two uploads at once and appends each finished item', async () => {
    const { result } = setup({ can_add: true, items: [] });
    await waitFor(() => expect(result.current.data).toBeDefined());
    const pending = [
      deferred<ReferenceItem>(),
      deferred<ReferenceItem>(),
      deferred<ReferenceItem>(),
    ];
    let n = 0;
    svc.uploadPostReference.mockImplementation(() => pending[n++].promise);

    let all!: Promise<ReferenceItem[]>;
    act(() => {
      all = result.current.startUploads([file('a.jpg'), file('b.jpg'), file('c.jpg')]);
    });
    expect(result.current.uploads.map((u) => u.status)).toEqual([
      'uploading',
      'uploading',
      'uploading',
    ]);
    expect(result.current.uploadsInFlight).toBe(true);
    expect(svc.uploadPostReference).toHaveBeenCalledTimes(2);

    await act(async () => pending[0].resolve(item(10)));
    await waitFor(() => expect(svc.uploadPostReference).toHaveBeenCalledTimes(3));
    await act(async () => {
      pending[1].resolve(item(11));
      pending[2].resolve(item(12));
    });

    await expect(all).resolves.toEqual([item(10), item(11), item(12)]);
    // TanStack notifies observers on a timer: wait for the cache write to reach the hook.
    await waitFor(() => expect(result.current.items.map((i) => i.id)).toEqual([10, 11, 12]));
    expect(result.current.uploads).toEqual([]);
    expect(result.current.uploadsInFlight).toBe(false);
    expect(result.current.freshIds).toEqual([10, 11, 12]);
  });

  it('reports progress on the entry', async () => {
    const { result } = setup({ can_add: true, items: [] });
    await waitFor(() => expect(result.current.data).toBeDefined());
    const d = deferred<ReferenceItem>();
    let progress!: (loaded: number, total: number) => void;
    svc.uploadPostReference.mockImplementation(
      (_t: string, _p: number, _f: File, opts: { onProgress: typeof progress }) => {
        progress = opts.onProgress;
        return d.promise;
      },
    );
    act(() => {
      void result.current.startUploads([file('a.mp4', 'video/mp4', 4000)]);
    });
    act(() => progress(1000, 4000));
    expect(result.current.uploads[0]).toMatchObject({
      name: 'a.mp4',
      fileKind: 'video',
      loaded: 1000,
      total: 4000,
      status: 'uploading',
    });
    await act(async () => d.resolve(item(3)));
  });

  it('cancels an upload: aborts its signal and drops the entry', async () => {
    const { result } = setup({ can_add: true, items: [] });
    await waitFor(() => expect(result.current.data).toBeDefined());
    let signal!: AbortSignal;
    svc.uploadPostReference.mockImplementation(
      (_t: string, _p: number, _f: File, opts: { signal: AbortSignal }) => {
        signal = opts.signal;
        return new Promise((_, reject) =>
          opts.signal.addEventListener('abort', () =>
            reject(new DOMException('cancelled', 'AbortError')),
          ),
        );
      },
    );
    let all!: Promise<ReferenceItem[]>;
    act(() => {
      all = result.current.startUploads([file('a.jpg')]);
    });
    const localId = result.current.uploads[0].localId;
    await act(async () => result.current.cancelUpload(localId));
    expect(signal.aborted).toBe(true);
    expect(result.current.uploads).toEqual([]);
    await expect(all).resolves.toEqual([]);
  });

  it('keeps a cancelled upload in flight until its finalize settles, then keeps the item', async () => {
    const { result } = setup({ can_add: true, items: [] });
    await waitFor(() => expect(result.current.data).toBeDefined());
    const d = deferred<ReferenceItem>();
    let signal!: AbortSignal;
    // Finalize is not abortable: the service ignores the signal and resolves with the item.
    svc.uploadPostReference.mockImplementation(
      (_t: string, _p: number, _f: File, opts: { signal: AbortSignal }) => {
        signal = opts.signal;
        return d.promise;
      },
    );
    let all!: Promise<ReferenceItem[]>;
    act(() => {
      all = result.current.startUploads([file('a.jpg')]);
    });
    await act(async () => result.current.cancelUpload(result.current.uploads[0].localId));
    expect(signal.aborted).toBe(true);
    expect(result.current.uploads).toHaveLength(1);
    expect(result.current.uploadsInFlight).toBe(true);

    await act(async () => d.resolve(item(21)));
    await expect(all).resolves.toEqual([item(21)]);
    await waitFor(() => expect(result.current.items.map((i) => i.id)).toEqual([21]));
    expect(result.current.uploads).toEqual([]);
    expect(result.current.uploadsInFlight).toBe(false);
  });

  it('drops a cancelled upload whose call fails after the cancel', async () => {
    const { result } = setup({ can_add: true, items: [] });
    await waitFor(() => expect(result.current.data).toBeDefined());
    const d = deferred<ReferenceItem>();
    svc.uploadPostReference.mockImplementation(() => d.promise);
    let all!: Promise<ReferenceItem[]>;
    act(() => {
      all = result.current.startUploads([file('a.jpg')]);
    });
    await act(async () => result.current.cancelUpload(result.current.uploads[0].localId));
    await act(async () => d.reject(new PostReferenceError('internal')));
    await expect(all).resolves.toEqual([]);
    expect(result.current.uploads).toEqual([]);
  });

  it('cancels a queued upload without ever starting it', async () => {
    const { result } = setup({ can_add: true, items: [] });
    await waitFor(() => expect(result.current.data).toBeDefined());
    svc.uploadPostReference.mockReturnValue(new Promise(() => {}));
    let all!: Promise<ReferenceItem[]>;
    act(() => {
      all = result.current.startUploads([file('a.jpg'), file('b.jpg'), file('c.jpg')]);
    });
    expect(svc.uploadPostReference).toHaveBeenCalledTimes(2);
    await act(async () => result.current.cancelUpload(result.current.uploads[2].localId));
    expect(result.current.uploads.map((u) => u.name)).toEqual(['a.jpg', 'b.jpg']);
    expect(svc.uploadPostReference).toHaveBeenCalledTimes(2);
    void all;
  });

  it('still settles startUploads when onUploaded throws', async () => {
    const { result } = setup({ can_add: true, items: [] });
    await waitFor(() => expect(result.current.data).toBeDefined());
    svc.uploadPostReference.mockResolvedValue(item(31));
    const onUploaded = vi.fn(() => {
      throw new Error('consumer bug');
    });
    let out: ReferenceItem[] = [];
    await act(async () => {
      out = await result.current.startUploads([file('a.jpg')], { onUploaded });
    });
    expect(onUploaded).toHaveBeenCalledTimes(1);
    expect(out).toEqual([item(31)]);
    expect(result.current.uploads).toEqual([]);
  });

  it('ignores retryUpload while the entry is uploading or queued', async () => {
    const { result } = setup({ can_add: true, items: [] });
    await waitFor(() => expect(result.current.data).toBeDefined());
    svc.uploadPostReference.mockReturnValue(new Promise(() => {}));
    act(() => {
      void result.current.startUploads([file('a.jpg'), file('b.jpg'), file('c.jpg')]);
    });
    expect(svc.uploadPostReference).toHaveBeenCalledTimes(2);
    const [running, , queued] = result.current.uploads;
    act(() => {
      result.current.retryUpload(running.localId);
      result.current.retryUpload(queued.localId);
    });
    expect(svc.uploadPostReference).toHaveBeenCalledTimes(2);
    expect(result.current.uploads).toHaveLength(3);
  });

  it('keeps a failed upload as an error entry and retries it with a fresh call', async () => {
    const { result } = setup({ can_add: true, items: [] });
    await waitFor(() => expect(result.current.data).toBeDefined());
    svc.uploadPostReference.mockRejectedValueOnce(new PostReferenceError('internal'));
    await act(async () => {
      await result.current.startUploads([file('a.jpg')]);
    });
    expect(result.current.uploads[0]).toMatchObject({ status: 'error', error: 'internal' });

    svc.uploadPostReference.mockResolvedValueOnce(item(4));
    await act(async () => result.current.retryUpload(result.current.uploads[0].localId));
    await waitFor(() => expect(result.current.items.map((i) => i.id)).toEqual([4]));
    expect(svc.uploadPostReference).toHaveBeenCalledTimes(2);
    expect(result.current.uploads).toEqual([]);
  });

  it('tags each upload with its source (tab by default) and keeps it, and onUploaded, across a retry', async () => {
    const { result } = setup({ can_add: true, items: [] });
    await waitFor(() => expect(result.current.data).toBeDefined());
    svc.uploadPostReference.mockReturnValueOnce(new Promise(() => {}));
    act(() => {
      void result.current.startUploads([file('tab.jpg')]);
    });
    expect(result.current.uploads[0]).toMatchObject({ name: 'tab.jpg', source: 'tab' });

    svc.uploadPostReference.mockRejectedValueOnce(new PostReferenceError('internal'));
    const onUploaded = vi.fn();
    await act(async () => {
      await result.current.startUploads([file('c.jpg')], { onUploaded, source: 'composer' });
    });
    const failed = result.current.uploads.find((u) => u.name === 'c.jpg');
    expect(failed).toMatchObject({ status: 'error', source: 'composer' });
    expect(onUploaded).not.toHaveBeenCalled();

    const retry = deferred<ReferenceItem>();
    svc.uploadPostReference.mockReturnValueOnce(retry.promise);
    await act(async () => result.current.retryUpload(failed!.localId));
    expect(result.current.uploads.find((u) => u.name === 'c.jpg')).toMatchObject({
      status: 'uploading',
      source: 'composer',
    });
    await act(async () => retry.resolve(item(6)));
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith(item(6)));
  });

  it('rejects invalid files and files past the 10-per-post limit without calling the server', async () => {
    const existing = Array.from({ length: 9 }, (_, i) => item(i + 1));
    const { result } = setup({ can_add: true, items: existing });
    await waitFor(() => expect(result.current.items).toHaveLength(9));
    svc.uploadPostReference.mockReturnValue(new Promise(() => {}));
    act(() => {
      void result.current.startUploads([
        file('x.svg', 'image/svg+xml'),
        file('ok.jpg'),
        file('extra.jpg'),
      ]);
    });
    expect(result.current.uploads.map((u) => [u.name, u.status, u.error])).toEqual([
      ['x.svg', 'error', 'unsupported_type'],
      ['ok.jpg', 'uploading', undefined],
      ['extra.jpg', 'error', 'reference_limit'],
    ]);
    expect(svc.uploadPostReference).toHaveBeenCalledTimes(1);
  });

  it('keeps a just-uploaded item when an older refetch resolves after it', async () => {
    const { result } = setup({ can_add: true, items: [item(1)] });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    // A refetch is in flight (focus after the file picker, or remove()'s invalidate) and
    // read the list before the finalize committed: its answer lacks the new item.
    const stale = deferred<{ can_add: boolean; items: ReferenceItem[] }>();
    svc.fetchPostReferences.mockImplementationOnce(() => stale.promise);
    act(() => result.current.refresh());
    await waitFor(() => expect(svc.fetchPostReferences).toHaveBeenCalledTimes(2));

    const up = deferred<ReferenceItem>();
    svc.uploadPostReference.mockReturnValue(up.promise);
    const onUploaded = vi.fn();
    act(() => {
      void result.current.startUploads([file('a.jpg')], { onUploaded, source: 'composer' });
    });
    // Committed: any refetch that starts from now on reads the item.
    svc.fetchPostReferences.mockResolvedValue({ can_add: true, items: [item(1), item(50)] });
    await act(async () => up.resolve(item(50)));
    await waitFor(() => expect(result.current.items.map((i) => i.id)).toEqual([1, 50]));
    expect(onUploaded).toHaveBeenCalledWith(item(50));

    await act(async () => stale.resolve({ can_add: true, items: [item(1)] }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(result.current.items.map((i) => i.id)).toEqual([1, 50]);
  });

  it('keeps a just-added link when an older refetch resolves after it', async () => {
    const { result } = setup({ can_add: true, items: [item(1)] });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    const stale = deferred<{ can_add: boolean; items: ReferenceItem[] }>();
    svc.fetchPostReferences.mockImplementationOnce(() => stale.promise);
    act(() => result.current.refresh());
    await waitFor(() => expect(svc.fetchPostReferences).toHaveBeenCalledTimes(2));

    const link = item(60, { kind: 'link', file_kind: null });
    svc.addPostReferenceLink.mockResolvedValue(link);
    svc.fetchPostReferences.mockResolvedValue({ can_add: true, items: [item(1), link] });
    await act(async () => {
      await result.current.addLink({ url: 'exemplo.com' });
    });
    await act(async () => stale.resolve({ can_add: true, items: [item(1)] }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(result.current.items.map((i) => i.id)).toEqual([1, 60]);
  });

  it('calls onUploaded per finished file', async () => {
    const { result } = setup({ can_add: true, items: [] });
    await waitFor(() => expect(result.current.data).toBeDefined());
    svc.uploadPostReference.mockResolvedValue(item(8));
    const onUploaded = vi.fn();
    await act(async () => {
      await result.current.startUploads([file('a.jpg')], { onUploaded });
    });
    expect(onUploaded).toHaveBeenCalledWith(item(8));
  });

  it('adds a link, updates a note and removes an item in the cache', async () => {
    const { result } = setup({ can_add: true, items: [item(1)] });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    svc.addPostReferenceLink.mockResolvedValue(item(2, { kind: 'link', file_kind: null }));
    await act(async () => {
      await result.current.addLink({ url: 'exemplo.com' });
    });
    await waitFor(() => expect(result.current.items.map((i) => i.id)).toEqual([1, 2]));

    svc.updatePostReferenceNote.mockResolvedValue(item(1, { note: 'nova' }));
    await act(async () => result.current.updateNote(1, 'nova'));
    await waitFor(() => expect(result.current.items[0].note).toBe('nova'));

    svc.removePostReference.mockResolvedValue(undefined);
    svc.fetchPostReferences.mockResolvedValue({ can_add: true, items: [item(2)] });
    await act(async () => result.current.remove(1));
    await waitFor(() => expect(result.current.items.map((i) => i.id)).toEqual([2]));
  });

  it('refetches and rethrows when a removal is locked', async () => {
    const { result } = setup({ can_add: true, items: [item(1)] });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    svc.removePostReference.mockRejectedValue(new PostReferenceError('locked'));
    await act(async () => {
      await expect(result.current.remove(1)).rejects.toMatchObject({ code: 'locked' });
    });
    await waitFor(() => expect(svc.fetchPostReferences).toHaveBeenCalledTimes(2));
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostMedia } from '../../store/posts';

const { uploadFile, getSession } = vi.hoisted(() => ({
  uploadFile: vi.fn(),
  getSession: vi.fn(),
}));
vi.mock('../fileService', () => ({ uploadFile }));
vi.mock('../../lib/supabase', () => ({ supabase: { auth: { getSession } } }));
import { replacePostMedia } from '../mediaAdjustment';

const media = {
  id: 7,
  post_id: 9,
  r2_key: 'contas/ws/files/original.jpg',
  kind: 'image',
} as PostMedia;
const file = new File(['adjusted'], 'adjusted.jpg', { type: 'image/jpeg' });
const fetchMock = vi.fn();

describe('replacePostMedia', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({ data: { session: { access_token: 'token' } } });
    uploadFile.mockResolvedValue({ id: 42 });
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('uploads a standalone file and atomically swaps the existing link with its original key', async () => {
    const onProgress = vi.fn();
    await replacePostMedia(media, file, undefined, onProgress);
    expect(uploadFile).toHaveBeenCalledWith({
      file,
      thumbnail: undefined,
      folderId: null,
      onProgress,
    });
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('https://mesaas.supabase.co/functions/v1/post-media-manage/7/replace');
    expect(request.method).toBe('PATCH');
    expect(request.headers.Authorization).toBe('Bearer token');
    expect(JSON.parse(request.body)).toEqual({ file_id: 42, expected_r2_key: media.r2_key });
    expect(request.signal).toBeInstanceOf(AbortSignal);
  });

  it('passes the thumbnail of an adjusted video to upload', async () => {
    const video = new File(['video'], 'adjusted.mp4', { type: 'video/mp4' });
    const thumbnail = new File(['thumbnail'], 'thumb.jpg', { type: 'image/jpeg' });
    await replacePostMedia({ ...media, kind: 'video' }, video, thumbnail);
    expect(uploadFile.mock.calls[0][0].thumbnail).toBe(thumbnail);
  });

  it('does not upload when the session has expired', async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    await expect(replacePostMedia(media, file, undefined)).rejects.toThrow(/sessão/i);
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('never attempts a swap after failed upload', async () => {
    uploadFile.mockRejectedValue(new Error('Upload failed'));
    await expect(replacePostMedia(media, file, undefined)).rejects.toThrow('Upload failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports stale media or publishing conflicts with a reload instruction', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'conflict' }), { status: 409 }),
    );
    await expect(replacePostMedia(media, file, undefined)).rejects.toThrow(/recarregue/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves uploaded output after uncertain network failure instead of issuing a deletion', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(replacePostMedia(media, file, undefined)).rejects.toThrow(/confirmar/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].method).toBe('PATCH');
  });

  it('does not expose internal server details', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'secret internal detail' }), { status: 500 }),
    );
    await expect(replacePostMedia(media, file, undefined)).rejects.toThrow(
      'Não foi possível salvar o ajuste.',
    );
  });
});

it('stops before upload when adjustment save is cancelled', async () => {
  const controller = new AbortController();
  controller.abort();
  uploadFile.mockClear();
  await expect(
    replacePostMedia(media, file, undefined, undefined, controller.signal),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(uploadFile).not.toHaveBeenCalled();
});
it('does not swap after cancellation during upload', async () => {
  const controller = new AbortController();
  getSession.mockResolvedValue({ data: { session: { access_token: 'token' } } });
  uploadFile.mockImplementation(async (args) => {
    expect(args.signal).toBe(controller.signal);
    controller.abort();
    return { id: 42 };
  });
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  await expect(
    replacePostMedia(media, file, undefined, undefined, controller.signal),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetchMock).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

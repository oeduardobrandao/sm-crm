import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFetchMock } from '../../../../../test/shared/fetchMock';
import {
  hasUnsavedWork,
  resetUnsavedWorkForTests,
} from '../../../../../packages/app-lifecycle/src/unsaved-work';

const mediaMock = vi.hoisted(() => ({ prepareReferenceMedia: vi.fn() }));
vi.mock('../referenceMedia', () => mediaMock);

import {
  PostReferenceError,
  addPostReferenceLink,
  fetchPostReferences,
  isAbortError,
  normalizeReferenceUrl,
  removePostReference,
  updatePostReferenceNote,
  uploadPostReference,
  validateReferenceFile,
} from '../postReferences';

const fetchHarness = createFetchMock();

class FakeXHR {
  static all: FakeXHR[] = [];
  method = '';
  url = '';
  headers: Record<string, string> = {};
  status = 200;
  body: unknown;
  upload: {
    onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null;
  } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  aborted = false;
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
    FakeXHR.all.push(this);
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  send(body: unknown) {
    this.body = body;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  respond(status = 200) {
    this.status = status;
    this.onload?.();
  }
}

function sizedFile(name: string, type: string, size: number): File {
  const f = new File([new Uint8Array(1)], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

const ITEM = {
  id: 9,
  kind: 'file',
  file_kind: 'image',
  name: 'foto.jpg',
  mime_type: 'image/jpeg',
  size_bytes: 1000,
  duration_seconds: null,
  width: 10,
  height: 10,
  url: 'https://r2/get',
  thumbnail_url: 'https://r2/thumb',
  blur_data_url: null,
  download_url: null,
  link_url: null,
  link_title: null,
  link_domain: null,
  note: null,
  post_approval_id: null,
  created_at: '2026-10-08T12:00:00.000Z',
  can_remove: true,
};

function bodyOf(call: number) {
  return JSON.parse(String(fetchHarness.calls[call].init?.body));
}

describe('postReferences service', () => {
  beforeEach(() => {
    fetchHarness.reset();
    vi.stubGlobal('fetch', fetchHarness.fetchMock);
    FakeXHR.all = [];
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
    mediaMock.prepareReferenceMedia.mockReset();
    resetUnsavedWorkForTests();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists a post's references with the token and post id", async () => {
    fetchHarness.queueResponse({ json: { can_add: true, items: [ITEM] } });
    const res = await fetchPostReferences('tok', 42);
    expect(res).toEqual({ can_add: true, items: [ITEM] });
    const url = new URL(String(fetchHarness.calls[0].input));
    expect(url.pathname).toBe('/functions/v1/hub-post-references');
    expect(url.searchParams.get('token')).toBe('tok');
    expect(url.searchParams.get('post_id')).toBe('42');
    expect((fetchHarness.calls[0].init?.headers as Record<string, string>).apikey).toBe(
      'anon-key-for-tests',
    );
  });

  it('maps a known server error code and falls back to internal for anything else', async () => {
    fetchHarness.queueResponse({ ok: false, status: 409, json: { error: 'post_not_pending' } });
    await expect(fetchPostReferences('tok', 1)).rejects.toMatchObject({ code: 'post_not_pending' });
    fetchHarness.queueResponse({ ok: false, status: 500, json: { error: 'duplicate key value' } });
    await expect(fetchPostReferences('tok', 1)).rejects.toMatchObject({ code: 'internal' });
    fetchHarness.queueResponse({ ok: false, status: 429, json: { error: 'rate_limited' } });
    await expect(fetchPostReferences('tok', 1)).rejects.toMatchObject({ code: 'rate_limited' });
    // Token failures are Portuguese strings, not codes.
    fetchHarness.queueResponse({ ok: false, status: 404, json: { error: 'Link inválido.' } });
    await expect(fetchPostReferences('tok', 1)).rejects.toMatchObject({ code: 'internal' });
  });

  it('validates type and size on the client', () => {
    expect(validateReferenceFile(sizedFile('a.svg', 'image/svg+xml', 10))).toBe('unsupported_type');
    expect(validateReferenceFile(sizedFile('a.jpg', 'image/jpeg', 25 * 1024 * 1024 + 1))).toBe(
      'too_large',
    );
    expect(validateReferenceFile(sizedFile('a.pdf', 'application/pdf', 1000))).toBeNull();
    expect(validateReferenceFile(sizedFile('v.mp4', 'video/mp4', 200 * 1024 * 1024))).toBeNull();
    expect(validateReferenceFile(sizedFile('v.mp4', 'video/mp4', 200 * 1024 * 1024 + 1))).toBe(
      'too_large',
    );
    // An empty File.type (some Android pickers) falls back to the extension.
    expect(validateReferenceFile(sizedFile('clip.MOV', '', 1000))).toBeNull();
  });

  it('presigns, PUTs file and thumbnail with progress, then finalizes', async () => {
    const thumb = sizedFile('thumb.webp', 'image/webp', 4000);
    mediaMock.prepareReferenceMedia.mockResolvedValue({
      thumbnail: thumb,
      blurDataUrl: 'data:blur',
      width: 1080,
      height: 1350,
    });
    fetchHarness.queueResponse({
      json: {
        upload_url: 'https://r2/put-file',
        r2_key: 'contas/c/files/u.jpg',
        thumbnail_upload_url: 'https://r2/put-thumb',
        thumbnail_r2_key: 'contas/c/files/u.thumb.webp',
      },
    });
    fetchHarness.queueResponse({ status: 201, json: { item: ITEM } });
    const progress: Array<[number, number]> = [];
    const file = sizedFile('foto.jpg', 'image/jpeg', 1000);

    const pending = uploadPostReference('tok', 42, file, {
      note: '  trocar a foto  ',
      onProgress: (loaded, total) => progress.push([loaded, total]),
    });
    await vi.waitFor(() => expect(FakeXHR.all).toHaveLength(2));
    expect(hasUnsavedWork()).toBe(true);

    expect(bodyOf(0)).toEqual({
      token: 'tok',
      post_id: 42,
      filename: 'foto.jpg',
      mime_type: 'image/jpeg',
      size_bytes: 1000,
      thumbnail: { mime_type: 'image/webp', size_bytes: 4000 },
    });
    const [filePut, thumbPut] = FakeXHR.all;
    expect(filePut.url).toBe('https://r2/put-file');
    expect(filePut.headers['Content-Type']).toBe('image/jpeg');
    expect(thumbPut.url).toBe('https://r2/put-thumb');
    expect(thumbPut.headers['Content-Type']).toBe('image/webp');

    filePut.upload.onprogress?.({ lengthComputable: true, loaded: 500, total: 1000 });
    filePut.respond();
    thumbPut.respond();

    await expect(pending).resolves.toEqual(ITEM);
    expect(progress).toEqual([
      [0, 1000],
      [500, 1000],
    ]);
    expect(String(fetchHarness.calls[1].input)).toContain('/hub-post-references/files');
    expect(bodyOf(1)).toEqual({
      token: 'tok',
      post_id: 42,
      r2_key: 'contas/c/files/u.jpg',
      thumbnail_r2_key: 'contas/c/files/u.thumb.webp',
      thumbnail_bytes: 4000,
      mime_type: 'image/jpeg',
      size_bytes: 1000,
      name: 'foto.jpg',
      width: 1080,
      height: 1350,
      duration_seconds: null,
      blur_data_url: 'data:blur',
      note: 'trocar a foto',
    });
    expect(hasUnsavedWork()).toBe(false);
  });

  it('sends a PDF with no thumbnail and a single PUT', async () => {
    mediaMock.prepareReferenceMedia.mockResolvedValue({ thumbnail: null });
    fetchHarness.queueResponse({
      json: {
        upload_url: 'https://r2/put-file',
        r2_key: 'contas/c/files/u.pdf',
        thumbnail_upload_url: null,
        thumbnail_r2_key: null,
      },
    });
    fetchHarness.queueResponse({ json: { item: { ...ITEM, file_kind: 'document' } } });
    const pending = uploadPostReference('tok', 42, sizedFile('a.pdf', 'application/pdf', 900), {});
    await vi.waitFor(() => expect(FakeXHR.all).toHaveLength(1));
    expect(bodyOf(0)).not.toHaveProperty('thumbnail');
    FakeXHR.all[0].respond();
    await pending;
    expect(bodyOf(1)).not.toHaveProperty('thumbnail_r2_key');
    expect(bodyOf(1)).not.toHaveProperty('thumbnail_bytes');
    expect(bodyOf(1)).toMatchObject({
      width: null,
      height: null,
      duration_seconds: null,
      blur_data_url: null,
      note: null,
    });
  });

  it('rejects an invalid file before any request', async () => {
    await expect(
      uploadPostReference('tok', 1, sizedFile('a.svg', 'image/svg+xml', 10), {}),
    ).rejects.toMatchObject({ code: 'unsupported_type' });
    expect(fetchHarness.calls).toHaveLength(0);
  });

  it('aborts the PUTs and never finalizes when the signal fires', async () => {
    mediaMock.prepareReferenceMedia.mockResolvedValue({ thumbnail: null });
    fetchHarness.queueResponse({
      json: {
        upload_url: 'https://r2/put',
        r2_key: 'k',
        thumbnail_upload_url: null,
        thumbnail_r2_key: null,
      },
    });
    const controller = new AbortController();
    const pending = uploadPostReference('tok', 1, sizedFile('a.pdf', 'application/pdf', 9), {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(FakeXHR.all).toHaveLength(1));
    controller.abort();
    const err = await pending.catch((e: unknown) => e);
    expect(isAbortError(err)).toBe(true);
    expect(FakeXHR.all[0].aborted).toBe(true);
    expect(fetchHarness.calls).toHaveLength(1);
  });

  it('turns a failed PUT into an internal error', async () => {
    mediaMock.prepareReferenceMedia.mockResolvedValue({ thumbnail: null });
    fetchHarness.queueResponse({
      json: {
        upload_url: 'https://r2/put',
        r2_key: 'k',
        thumbnail_upload_url: null,
        thumbnail_r2_key: null,
      },
    });
    const pending = uploadPostReference('tok', 1, sizedFile('a.pdf', 'application/pdf', 9), {});
    await vi.waitFor(() => expect(FakeXHR.all).toHaveLength(1));
    FakeXHR.all[0].respond(403);
    await expect(pending).rejects.toBeInstanceOf(PostReferenceError);
    await expect(pending).rejects.toMatchObject({ code: 'internal' });
  });

  it('normalizes link URLs like the server', () => {
    expect(normalizeReferenceUrl('  exemplo.com/post ')).toBe('https://exemplo.com/post');
    expect(normalizeReferenceUrl('http://exemplo.com')).toBe('http://exemplo.com/');
    expect(normalizeReferenceUrl('exemplo.com:8080/x')).toBe('https://exemplo.com:8080/x');
    expect(normalizeReferenceUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeReferenceUrl('https://user:pw@exemplo.com')).toBeNull();
    expect(normalizeReferenceUrl('https://exem plo.com')).toBeNull();
    expect(normalizeReferenceUrl('')).toBeNull();
    expect(normalizeReferenceUrl(`https://exemplo.com/${'a'.repeat(2048)}`)).toBeNull();
  });

  it('adds a link with the normalized URL and trimmed title and note', async () => {
    fetchHarness.queueResponse({ status: 201, json: { item: { ...ITEM, kind: 'link' } } });
    await addPostReferenceLink('tok', 42, {
      url: 'exemplo.com/post',
      title: '  Referência ',
      note: '',
    });
    expect(String(fetchHarness.calls[0].input)).toContain('/hub-post-references/links');
    expect(bodyOf(0)).toEqual({
      token: 'tok',
      post_id: 42,
      url: 'https://exemplo.com/post',
      title: 'Referência',
    });
  });

  it('rejects an invalid link without calling the server', async () => {
    await expect(addPostReferenceLink('tok', 1, { url: 'ftp://x.com' })).rejects.toMatchObject({
      code: 'invalid_url',
    });
    expect(fetchHarness.calls).toHaveLength(0);
  });

  it('patches a note and deletes a reference by id', async () => {
    fetchHarness.queueResponse({ json: { item: { ...ITEM, note: 'nova' } } });
    const item = await updatePostReferenceNote('tok', 9, ' nova ');
    expect(item.note).toBe('nova');
    expect(fetchHarness.calls[0].init?.method).toBe('PATCH');
    expect(String(fetchHarness.calls[0].input)).toContain('/hub-post-references/9');
    expect(bodyOf(0)).toEqual({ token: 'tok', note: 'nova' });

    fetchHarness.queueResponse({ json: { ok: true } });
    await removePostReference('tok', 9);
    const url = new URL(String(fetchHarness.calls[1].input));
    expect(url.pathname).toBe('/functions/v1/hub-post-references/9');
    expect(url.searchParams.get('token')).toBe('tok');
    expect(fetchHarness.calls[1].init?.method).toBe('DELETE');
  });

  it('maps a locked delete to PostReferenceError("locked")', async () => {
    fetchHarness.queueResponse({ ok: false, status: 409, json: { error: 'locked' } });
    await expect(removePostReference('tok', 9)).rejects.toMatchObject({ code: 'locked' });
  });
});

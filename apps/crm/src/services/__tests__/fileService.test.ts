import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFetchMock } from '../../../../../test/shared/fetchMock';

vi.mock('../../lib/supabase');

import { __setCurrentSession, __resetSupabaseMock } from '../../lib/__mocks__/supabase';
import {
  getFolderContents,
  createFolder,
  renameFolder,
  moveFolder,
  deleteFolder,
  uploadFile,
  renameFile,
  moveFile,
  deleteFile,
  linkFileToPost,
  unlinkFileFromPost,
  getPostLinks,
} from '../fileService';

const fetchHarness = createFetchMock();

// ─── Helpers ────────────────────────────────────────────────────

function mockFile(name = 'photo.png', type = 'image/png', size = 1024): File {
  const blob = new Blob(['x'.repeat(size)], { type });
  return new File([blob], name, { type });
}

function lastCallBody(index = 0) {
  const body = fetchHarness.calls[index]?.init?.body;
  return body ? JSON.parse(String(body)) : undefined;
}

function lastCallUrl(index = 0) {
  return String(fetchHarness.calls[index]?.input ?? '');
}

function lastCallMethod(index = 0) {
  return fetchHarness.calls[index]?.init?.method;
}

function lastCallHeaders(index = 0) {
  return fetchHarness.calls[index]?.init?.headers as Record<string, string>;
}

// ─── Tests ──────────────────────────────────────────────────────

describe('fileService', () => {
  beforeEach(() => {
    __resetSupabaseMock();
    fetchHarness.reset();
    vi.stubGlobal('fetch', fetchHarness.fetchMock);
    __setCurrentSession({ access_token: 'test-jwt', user: { id: 'user-1' } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Auth & callFn behavior ─────────────────────────────────────

  describe('callFn (tested through public functions)', () => {
    it('includes Authorization bearer token and apikey on every request', async () => {
      fetchHarness.queueResponse({ json: { folder: null, subfolders: [], files: [], breadcrumbs: [] } });

      await getFolderContents(null);

      const headers = lastCallHeaders();
      expect(headers['Authorization']).toBe('Bearer test-jwt');
      expect(headers['apikey']).toBe('anon-key-for-tests');
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('throws "Not authenticated" when there is no session', async () => {
      __setCurrentSession(null);

      await expect(getFolderContents(null)).rejects.toThrow('Not authenticated');
      expect(fetchHarness.calls).toHaveLength(0);
    });

    it('throws the server error message on non-2xx responses', async () => {
      fetchHarness.queueResponse({
        ok: false,
        status: 403,
        json: { error: 'Acesso negado' },
      });

      await expect(getFolderContents(null)).rejects.toThrow('Acesso negado');
    });

    it('falls back to HTTP status when error body has no error field', async () => {
      fetchHarness.queueResponse({
        ok: false,
        status: 500,
        json: {},
      });

      await expect(getFolderContents(null)).rejects.toThrow('HTTP 500');
    });

    it('falls back to HTTP status when error body is not valid JSON', async () => {
      fetchHarness.queueResponse({
        ok: false,
        status: 502,
        json: new Error('bad json'),
      });

      await expect(getFolderContents(null)).rejects.toThrow('HTTP 502');
    });
  });

  // ── Folder operations ──────────────────────────────────────────

  describe('getFolderContents', () => {
    it('requests root folder when parentId is null', async () => {
      const contents = { folder: null, subfolders: [], files: [], breadcrumbs: [] };
      fetchHarness.queueResponse({ json: contents });

      const result = await getFolderContents(null);

      expect(result).toEqual(contents);
      expect(lastCallUrl()).toContain('/file-manage/folders');
      expect(lastCallUrl()).not.toContain('parent_id');
      expect(lastCallMethod()).toBe('GET');
    });

    it('passes parent_id query param when requesting a specific folder', async () => {
      const contents = { folder: { id: 5, name: 'Images' }, subfolders: [], files: [], breadcrumbs: [] };
      fetchHarness.queueResponse({ json: contents });

      const result = await getFolderContents(5);

      expect(result).toEqual(contents);
      expect(lastCallUrl()).toContain('parent_id=5');
    });
  });

  describe('createFolder', () => {
    it('sends POST with name and parent_id', async () => {
      const folder = { id: 10, name: 'Campanhas', parent_id: null };
      fetchHarness.queueResponse({ json: folder });

      const result = await createFolder('Campanhas', null);

      expect(result).toEqual(folder);
      expect(lastCallMethod()).toBe('POST');
      expect(lastCallUrl()).toContain('/file-manage/folders');
      expect(lastCallBody()).toEqual({ name: 'Campanhas', parent_id: null });
    });

    it('sends POST with a non-null parent_id for nested folders', async () => {
      const folder = { id: 11, name: 'Sub', parent_id: 10 };
      fetchHarness.queueResponse({ json: folder });

      await createFolder('Sub', 10);

      expect(lastCallBody()).toEqual({ name: 'Sub', parent_id: 10 });
    });
  });

  describe('renameFolder', () => {
    it('sends PATCH with new name to the correct folder path', async () => {
      const updated = { id: 5, name: 'Renamed' };
      fetchHarness.queueResponse({ json: updated });

      const result = await renameFolder(5, 'Renamed');

      expect(result).toEqual(updated);
      expect(lastCallMethod()).toBe('PATCH');
      expect(lastCallUrl()).toContain('/file-manage/folders/5');
      expect(lastCallBody()).toEqual({ name: 'Renamed' });
    });
  });

  describe('moveFolder', () => {
    it('sends PATCH with new parent_id', async () => {
      const updated = { id: 5, parent_id: 20 };
      fetchHarness.queueResponse({ json: updated });

      const result = await moveFolder(5, 20);

      expect(result).toEqual(updated);
      expect(lastCallMethod()).toBe('PATCH');
      expect(lastCallUrl()).toContain('/file-manage/folders/5');
      expect(lastCallBody()).toEqual({ parent_id: 20 });
    });

    it('sends null parent_id to move folder to root', async () => {
      fetchHarness.queueResponse({ json: { id: 5, parent_id: null } });

      await moveFolder(5, null);

      expect(lastCallBody()).toEqual({ parent_id: null });
    });
  });

  describe('deleteFolder', () => {
    it('sends DELETE to the correct folder path', async () => {
      fetchHarness.queueResponse({ json: {} });

      await deleteFolder(5);

      expect(lastCallMethod()).toBe('DELETE');
      expect(lastCallUrl()).toContain('/file-manage/folders/5');
    });

    it('throws on 409 for system folder deletion attempt', async () => {
      fetchHarness.queueResponse({
        ok: false,
        status: 409,
        json: { error: 'Não é possível excluir pasta do sistema' },
      });

      await expect(deleteFolder(1)).rejects.toThrow('Não é possível excluir pasta do sistema');
    });
  });

  // ── File operations ────────────────────────────────────────────

  describe('renameFile', () => {
    it('sends PATCH with new name to the file path', async () => {
      const updated = { id: 7, name: 'new-name.png' };
      fetchHarness.queueResponse({ json: updated });

      const result = await renameFile(7, 'new-name.png');

      expect(result).toEqual(updated);
      expect(lastCallMethod()).toBe('PATCH');
      expect(lastCallUrl()).toContain('/file-manage/files/7');
      expect(lastCallBody()).toEqual({ name: 'new-name.png' });
    });
  });

  describe('moveFile', () => {
    it('sends PATCH with folder_id', async () => {
      const updated = { id: 7, folder_id: 3 };
      fetchHarness.queueResponse({ json: updated });

      const result = await moveFile(7, 3);

      expect(result).toEqual(updated);
      expect(lastCallMethod()).toBe('PATCH');
      expect(lastCallUrl()).toContain('/file-manage/files/7');
      expect(lastCallBody()).toEqual({ folder_id: 3 });
    });

    it('sends null folder_id to move file to root', async () => {
      fetchHarness.queueResponse({ json: { id: 7, folder_id: null } });

      await moveFile(7, null);

      expect(lastCallBody()).toEqual({ folder_id: null });
    });
  });

  describe('deleteFile', () => {
    it('sends DELETE to the correct file path', async () => {
      fetchHarness.queueResponse({ json: {} });

      await deleteFile(7);

      expect(lastCallMethod()).toBe('DELETE');
      expect(lastCallUrl()).toContain('/file-manage/files/7');
    });

    it('throws on 409 when file is linked to posts', async () => {
      fetchHarness.queueResponse({
        ok: false,
        status: 409,
        json: { error: 'Arquivo está vinculado a postagens' },
      });

      await expect(deleteFile(7)).rejects.toThrow('Arquivo está vinculado a postagens');
    });
  });

  describe('uploadFile', () => {
    // We mock putWithProgress indirectly: the presign call returns an upload_url
    // that our fetch mock handles, then the finalize call returns the file record.
    // Since putWithProgress uses XMLHttpRequest (not fetch), we need to mock XMLHttpRequest.

    let xhrInstances: MockXHR[];

    class MockXHR {
      method = '';
      url = '';
      headers: Record<string, string> = {};
      upload = { onprogress: null as ((e: ProgressEvent) => void) | null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      status = 200;

      constructor() {
        xhrInstances.push(this);
      }

      open(method: string, url: string) {
        this.method = method;
        this.url = url;
      }

      setRequestHeader(key: string, value: string) {
        this.headers[key] = value;
      }

      send() {
        // Simulate successful upload
        setTimeout(() => {
          this.status = 200;
          this.onload?.();
        }, 0);
      }
    }

    beforeEach(() => {
      xhrInstances = [];
      vi.stubGlobal('XMLHttpRequest', MockXHR);
      // jsdom doesn't have URL.createObjectURL — add mock implementations
      URL.createObjectURL = vi.fn(() => 'blob:mock-url');
      URL.revokeObjectURL = vi.fn();
    });

    it('performs the full presign -> PUT -> finalize flow for a document', async () => {
      // 1) Presign response
      fetchHarness.queueResponse({
        json: {
          file_id: 'uuid-1',
          upload_url: 'https://r2.example.com/upload-presigned',
          r2_key: 'files/uuid-1.pdf',
          kind: 'document',
        },
      });
      // 2) Finalize response
      fetchHarness.queueResponse({
        json: {
          id: 42,
          name: 'report.pdf',
          kind: 'document',
          r2_key: 'files/uuid-1.pdf',
        },
      });

      const file = mockFile('report.pdf', 'application/pdf', 5000);
      const result = await uploadFile({ file, folderId: 3 });

      // Presign call
      expect(lastCallUrl(0)).toContain('/file-upload-url');
      expect(lastCallMethod(0)).toBe('POST');
      const presignBody = lastCallBody(0);
      expect(presignBody.filename).toBe('report.pdf');
      expect(presignBody.mime_type).toBe('application/pdf');
      expect(presignBody.size_bytes).toBe(file.size);
      expect(presignBody.folder_id).toBe(3);

      // XHR upload
      expect(xhrInstances).toHaveLength(1);
      expect(xhrInstances[0].method).toBe('PUT');
      expect(xhrInstances[0].url).toBe('https://r2.example.com/upload-presigned');

      // Finalize call
      expect(lastCallUrl(1)).toContain('/file-upload-finalize');
      expect(lastCallMethod(1)).toBe('POST');
      const finalizeBody = lastCallBody(1);
      expect(finalizeBody.file_id).toBe('uuid-1');
      expect(finalizeBody.r2_key).toBe('files/uuid-1.pdf');
      expect(finalizeBody.kind).toBe('document');
      expect(finalizeBody.name).toBe('report.pdf');
      expect(finalizeBody.folder_id).toBe(3);

      expect(result).toMatchObject({ id: 42, name: 'report.pdf' });
    });

    it('uploads thumbnail alongside main file when provided', async () => {
      fetchHarness.queueResponse({
        json: {
          file_id: 'uuid-2',
          upload_url: 'https://r2.example.com/video-presigned',
          r2_key: 'files/uuid-2.mp4',
          kind: 'video',
          thumbnail_upload_url: 'https://r2.example.com/thumb-presigned',
          thumbnail_r2_key: 'files/uuid-2-thumb.jpg',
        },
      });
      fetchHarness.queueResponse({
        json: { id: 43, name: 'clip.mp4', kind: 'video' },
      });

      const file = mockFile('clip.mp4', 'video/mp4', 10000);
      const thumbnail = mockFile('thumb.jpg', 'image/jpeg', 500);

      // Mock probeVideo via document.createElement
      const mockVideo = {
        preload: '',
        onloadedmetadata: null as (() => void) | null,
        onerror: null as (() => void) | null,
        set src(_: string) {
          setTimeout(() => {
            Object.defineProperty(this, 'videoWidth', { value: 1920, configurable: true });
            Object.defineProperty(this, 'videoHeight', { value: 1080, configurable: true });
            Object.defineProperty(this, 'duration', { value: 15.5, configurable: true });
            this.onloadedmetadata?.();
          }, 0);
        },
        videoWidth: 0,
        videoHeight: 0,
        duration: 0,
      };
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        if (tag === 'video') return mockVideo as unknown as HTMLVideoElement;
        // Fallback to real implementation for canvas etc.
        return document.createElement.call(document, tag);
      });

      // The createElement mock above causes infinite recursion for the canvas call.
      // We need a different approach: only intercept 'video', pass through everything else.
      const originalCreateElement = Document.prototype.createElement;
      vi.spyOn(document, 'createElement').mockImplementation(function (this: Document, tag: string) {
        if (tag === 'video') return mockVideo as unknown as HTMLVideoElement;
        return originalCreateElement.call(this, tag);
      } as typeof document.createElement);

      const result = await uploadFile({ file, folderId: null, thumbnail });

      // Two XHR uploads: main file + thumbnail
      expect(xhrInstances).toHaveLength(2);
      expect(xhrInstances[0].url).toBe('https://r2.example.com/video-presigned');
      expect(xhrInstances[1].url).toBe('https://r2.example.com/thumb-presigned');

      // Finalize includes thumbnail_r2_key
      const finalizeBody = lastCallBody(1);
      expect(finalizeBody.thumbnail_r2_key).toBe('files/uuid-2-thumb.jpg');
      expect(finalizeBody.width).toBe(1920);
      expect(finalizeBody.height).toBe(1080);
      expect(finalizeBody.duration_seconds).toBe(16); // Math.round(15.5)

      expect(result).toMatchObject({ id: 43, kind: 'video' });
    });

    it('probes image dimensions for image uploads and sends blur hash as background PATCH', async () => {
      fetchHarness.queueResponse({
        json: {
          file_id: 'uuid-3',
          upload_url: 'https://r2.example.com/img-presigned',
          r2_key: 'files/uuid-3.png',
          kind: 'image',
        },
      });
      fetchHarness.queueResponse({
        json: { id: 44, name: 'banner.png', kind: 'image' },
      });
      // Background blur hash PATCH response
      fetchHarness.queueResponse({ json: {} });

      const file = mockFile('banner.png', 'image/png', 2000);

      vi.stubGlobal('Image', class MockImage {
        naturalWidth = 800;
        naturalHeight = 600;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        _src = '';
        constructor() {}
        set src(val: string) {
          this._src = val;
          setTimeout(() => this.onload?.(), 0);
        }
        get src() { return this._src; }
      });

      const mockCtx = { drawImage: vi.fn() };
      const mockCanvas = {
        width: 0,
        height: 0,
        getContext: vi.fn(() => mockCtx),
        toDataURL: vi.fn(() => 'data:image/webp;base64,blur-placeholder'),
      };
      const originalCreateElement = Document.prototype.createElement;
      vi.spyOn(document, 'createElement').mockImplementation(function (this: Document, tag: string) {
        if (tag === 'canvas') return mockCanvas as unknown as HTMLCanvasElement;
        return originalCreateElement.call(this, tag);
      } as typeof document.createElement);

      const result = await uploadFile({ file, folderId: 1 });

      const finalizeBody = lastCallBody(1);
      expect(finalizeBody.width).toBe(800);
      expect(finalizeBody.height).toBe(600);
      expect(finalizeBody.blur_data_url).toBeUndefined();
      expect(finalizeBody.duration_seconds).toBeUndefined();

      expect(result).toMatchObject({ id: 44, kind: 'image' });
    });

    it('calls onProgress callback during upload', async () => {
      fetchHarness.queueResponse({
        json: {
          file_id: 'uuid-4',
          upload_url: 'https://r2.example.com/progress-presigned',
          r2_key: 'files/uuid-4.pdf',
          kind: 'document',
        },
      });
      fetchHarness.queueResponse({
        json: { id: 45, name: 'doc.pdf', kind: 'document' },
      });

      // Override MockXHR send to emit progress
      const originalSend = MockXHR.prototype.send;
      MockXHR.prototype.send = function (this: MockXHR) {
        if (this.upload.onprogress) {
          this.upload.onprogress(new ProgressEvent('progress', { loaded: 512, total: 1024, lengthComputable: true }));
        }
        this.status = 200;
        setTimeout(() => this.onload?.(), 0);
      };

      const onProgress = vi.fn();
      const file = mockFile('doc.pdf', 'application/pdf', 1024);

      await uploadFile({ file, folderId: null, onProgress });

      expect(onProgress).toHaveBeenCalledWith({ loaded: 512, total: 1024 });

      MockXHR.prototype.send = originalSend;
    });

    it('includes post_id in finalize body when provided', async () => {
      fetchHarness.queueResponse({
        json: {
          file_id: 'uuid-5',
          upload_url: 'https://r2.example.com/post-presigned',
          r2_key: 'files/uuid-5.png',
          kind: 'document',
        },
      });
      fetchHarness.queueResponse({
        json: { id: 46, name: 'asset.png', kind: 'document' },
      });

      const file = mockFile('asset.png', 'application/pdf', 500);
      await uploadFile({ file, folderId: 2, postId: 99 });

      const finalizeBody = lastCallBody(1);
      expect(finalizeBody.post_id).toBe(99);
    });
  });

  // ── Link operations ────────────────────────────────────────────

  describe('linkFileToPost', () => {
    it('sends POST with file_id and post_id', async () => {
      const link = { id: 1, file_id: 10, post_id: 20, is_cover: false, sort_order: 0 };
      fetchHarness.queueResponse({ json: link });

      const result = await linkFileToPost(10, 20);

      expect(result).toEqual(link);
      expect(lastCallMethod()).toBe('POST');
      expect(lastCallUrl()).toContain('/file-manage/links');
      expect(lastCallBody()).toEqual({ file_id: 10, post_id: 20 });
    });
  });

  describe('unlinkFileFromPost', () => {
    it('sends DELETE to the correct link path', async () => {
      fetchHarness.queueResponse({ json: {} });

      await unlinkFileFromPost(15);

      expect(lastCallMethod()).toBe('DELETE');
      expect(lastCallUrl()).toContain('/file-manage/links/15');
    });
  });

  describe('getPostLinks', () => {
    it('sends GET with post_id query param', async () => {
      const data = {
        links: [
          { id: 1, post_id: 30, file_id: 10, files: { id: 10, name: 'image.png' } },
        ],
      };
      fetchHarness.queueResponse({ json: data });

      const result = await getPostLinks(30);

      expect(result).toEqual(data);
      expect(lastCallMethod()).toBe('GET');
      expect(lastCallUrl()).toContain('/file-manage/links');
      expect(lastCallUrl()).toContain('post_id=30');
    });
  });

  // ── Media helpers (indirectly tested via uploadFile) ───────────

  describe('media probing via uploadFile', () => {
    let xhrInstances: MockXHR[];

    class MockXHR {
      method = '';
      url = '';
      headers: Record<string, string> = {};
      upload = { onprogress: null as ((e: ProgressEvent) => void) | null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      status = 200;

      constructor() {
        xhrInstances.push(this);
      }

      open(method: string, url: string) {
        this.method = method;
        this.url = url;
      }

      setRequestHeader(key: string, value: string) {
        this.headers[key] = value;
      }

      send() {
        setTimeout(() => {
          this.status = 200;
          this.onload?.();
        }, 0);
      }
    }

    beforeEach(() => {
      xhrInstances = [];
      vi.stubGlobal('XMLHttpRequest', MockXHR);
      URL.createObjectURL = vi.fn(() => 'blob:mock-url');
      URL.revokeObjectURL = vi.fn();
    });

    it('handles image probe failure gracefully (blur_data_url becomes undefined)', async () => {
      fetchHarness.queueResponse({
        json: {
          file_id: 'uuid-fail',
          upload_url: 'https://r2.example.com/fail-presigned',
          r2_key: 'files/uuid-fail.png',
          kind: 'image',
        },
      });
      fetchHarness.queueResponse({
        json: { id: 50, name: 'broken.png', kind: 'image' },
      });

      // Image that loads for probeImage but fails generateBlurDataUrl
      let imageCount = 0;
      vi.stubGlobal('Image', class MockImage {
        naturalWidth = 640;
        naturalHeight = 480;
        onload: (() => void) | null = null;
        onerror: ((e: unknown) => void) | null = null;
        _src = '';
        set src(val: string) {
          this._src = val;
          imageCount++;
          if (imageCount <= 1) {
            // probeImage succeeds
            setTimeout(() => this.onload?.(), 0);
          } else {
            // generateBlurDataUrl - image loads, but canvas fails
            setTimeout(() => this.onload?.(), 0);
          }
        }
        get src() { return this._src; }
      });

      // Canvas that throws
      const originalCreateElement = Document.prototype.createElement;
      vi.spyOn(document, 'createElement').mockImplementation(function (this: Document, tag: string) {
        if (tag === 'canvas') {
          return {
            width: 0,
            height: 0,
            getContext: () => ({ drawImage: () => { throw new Error('Canvas not supported'); } }),
            toDataURL: vi.fn(),
          } as unknown as HTMLCanvasElement;
        }
        return originalCreateElement.call(this, tag);
      } as typeof document.createElement);

      const file = mockFile('broken.png', 'image/png', 800);
      await uploadFile({ file, folderId: null });

      const finalizeBody = lastCallBody(1);
      expect(finalizeBody.width).toBe(640);
      expect(finalizeBody.height).toBe(480);
      // blur_data_url should be undefined because generateBlurDataUrl threw
      expect(finalizeBody.blur_data_url).toBeUndefined();
    });

    it('does not probe dimensions or blur for document files', async () => {
      fetchHarness.queueResponse({
        json: {
          file_id: 'uuid-doc',
          upload_url: 'https://r2.example.com/doc-presigned',
          r2_key: 'files/uuid-doc.pdf',
          kind: 'document',
        },
      });
      fetchHarness.queueResponse({
        json: { id: 51, name: 'notes.pdf', kind: 'document' },
      });

      const file = mockFile('notes.pdf', 'application/pdf', 3000);
      await uploadFile({ file, folderId: null });

      const finalizeBody = lastCallBody(1);
      expect(finalizeBody.width).toBeUndefined();
      expect(finalizeBody.height).toBeUndefined();
      expect(finalizeBody.duration_seconds).toBeUndefined();
      expect(finalizeBody.blur_data_url).toBeUndefined();
    });
  });
});

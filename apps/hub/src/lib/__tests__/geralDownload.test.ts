import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HubPost, HubPostMedia } from '../../types';

const zipFiles = vi.hoisted(() => new Map<string, unknown>());
vi.mock('jszip', () => ({
  default: class {
    file(name: string, data: unknown) {
      zipFiles.set(name, data);
    }
    async generateAsync() {
      return new Blob(['zip']);
    }
  },
}));

import {
  canDownloadGeral,
  downloadGeralContent,
  geralFileName,
  geralZipName,
} from '../geralDownload';

function media(over: Partial<HubPostMedia> = {}): HubPostMedia {
  return {
    id: 1,
    post_id: 1,
    kind: 'image',
    mime_type: 'image/jpeg',
    url: 'https://cdn/a.jpg',
    thumbnail_url: null,
    width: 1920,
    height: 1080,
    duration_seconds: null,
    is_cover: false,
    sort_order: 0,
    ...over,
  };
}

function post(over: Partial<HubPost> = {}): HubPost {
  return {
    id: 7,
    titulo: 'Vídeo institucional: versão final',
    tipo: 'reels',
    status: 'aprovado_cliente',
    ordem: 1,
    conteudo: null,
    conteudo_plain: '',
    scheduled_at: null,
    ig_caption: null,
    instagram_permalink: null,
    published_at: null,
    publish_error: null,
    workflow_id: 1,
    workflow_titulo: null,
    workflow_created_at: null,
    media: [media()],
    cover_media: null,
    pending_suggestion: null,
    suggestion_rejected_at: null,
    targets: ['geral'],
    geral_caption: 'Legenda geral',
    ...over,
  };
}

describe('canDownloadGeral', () => {
  it('needs a Geral destination and a client approval', () => {
    expect(canDownloadGeral(post())).toBe(true);
    expect(canDownloadGeral(post({ status: 'postado', targets: ['instagram', 'geral'] }))).toBe(
      true,
    );
    expect(canDownloadGeral(post({ status: 'falha_publicacao' }))).toBe(true);
    expect(canDownloadGeral(post({ status: 'enviado_cliente' }))).toBe(false);
    expect(canDownloadGeral(post({ status: 'correcao_cliente' }))).toBe(false);
    expect(canDownloadGeral(post({ targets: ['instagram'] }))).toBe(false);
  });

  it('reads the legacy platform column on old payloads', () => {
    expect(canDownloadGeral(post({ targets: undefined, platform: 'other' }))).toBe(true);
    expect(canDownloadGeral(post({ targets: undefined, platform: 'both' }))).toBe(false);
  });
});

describe('file names', () => {
  it('numbers files in order with the extension of their type', () => {
    expect(geralFileName(media(), 0)).toBe('01.jpg');
    expect(geralFileName(media({ mime_type: 'video/quicktime' }), 9)).toBe('10.mov');
    expect(geralFileName(media({ mime_type: 'image/svg+xml' }), 1)).toBe('02.svg');
  });

  it('slugs the post title for the zip', () => {
    expect(geralZipName(post())).toBe('video-institucional-versao-final.zip');
    expect(geralZipName(post({ titulo: '!!!' }))).toBe('post-7.zip');
  });
});

describe('downloadGeralContent', () => {
  const fetchMock = vi.fn(async () => new Response(new Blob(['x'])));
  let downloads: string[];

  beforeEach(() => {
    zipFiles.clear();
    downloads = [];
    vi.stubGlobal('fetch', fetchMock);
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push(this.download);
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    fetchMock.mockClear();
  });

  it('saves a single file directly, without a zip', async () => {
    await expect(downloadGeralContent(post())).resolves.toBe('saved');
    expect(fetchMock).toHaveBeenCalledWith('https://cdn/a.jpg', { cache: 'no-store' });
    expect(downloads).toEqual(['01.jpg']);
    expect(zipFiles.size).toBe(0);
  });

  it('zips several files in order with legenda.txt, skipping lost media', async () => {
    await downloadGeralContent(
      post({
        media: [
          media({ id: 1 }),
          media({ id: 2, url: null, media_lost_at: '2026-08-01T00:00:00Z' }),
          media({ id: 3, kind: 'video', mime_type: 'video/mp4', url: 'https://cdn/b.mp4' }),
        ],
      }),
    );
    expect([...zipFiles.keys()]).toEqual(['01.jpg', '02.mp4', 'legenda.txt']);
    expect(zipFiles.get('legenda.txt')).toBe('Legenda geral');
    expect(downloads).toEqual(['video-institucional-versao-final.zip']);
  });

  it('leaves legenda.txt out when the Geral caption is empty', async () => {
    await downloadGeralContent(
      post({ geral_caption: '  ', media: [media({ id: 1 }), media({ id: 2 })] }),
    );
    expect([...zipFiles.keys()]).toEqual(['01.jpg', '02.jpg']);
  });

  it('fails when a file cannot be fetched', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }));
    await expect(downloadGeralContent(post())).rejects.toThrow('HTTP 403');
    expect(downloads).toEqual([]);
  });
});

describe('downloadGeralContent on an iPhone', () => {
  const fetchMock = vi.fn(
    async (url: string) => new Response(new Blob([url], { type: 'video/mp4' })),
  );
  const share = vi.fn<(data: ShareData) => Promise<void>>();
  const canShare = vi.fn<(data: ShareData) => boolean>();
  let downloads: string[];

  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15';
  const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
  const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130 Mobile';

  function device(userAgent: string, maxTouchPoints = 5) {
    Object.defineProperty(navigator, 'userAgent', { value: userAgent, configurable: true });
    Object.defineProperty(navigator, 'maxTouchPoints', {
      value: maxTouchPoints,
      configurable: true,
    });
  }

  beforeEach(() => {
    zipFiles.clear();
    downloads = [];
    share.mockReset().mockResolvedValue(undefined);
    canShare.mockReset().mockReturnValue(true);
    vi.stubGlobal('fetch', fetchMock);
    Object.assign(navigator, { share, canShare });
    device(IPHONE);
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push(this.download);
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    fetchMock.mockClear();
    Reflect.deleteProperty(navigator, 'share');
    Reflect.deleteProperty(navigator, 'canShare');
    // Drop the own properties so the prototype's getters come back.
    Reflect.deleteProperty(navigator, 'userAgent');
    Reflect.deleteProperty(navigator, 'maxTouchPoints');
  });

  const video = media({ kind: 'video', mime_type: 'video/mp4', url: 'https://cdn/v.mp4' });

  it('opens the share sheet with each file, named in order, instead of a zip', async () => {
    const result = await downloadGeralContent(
      post({ media: [media({ id: 1 }), { ...video, id: 2 }] }),
    );
    expect(result).toBe('shared');
    const files = share.mock.calls[0][0].files!;
    expect(files.map((f) => f.name)).toEqual(['01.jpg', '02.mp4']);
    expect(files[1].type).toBe('video/mp4');
    expect(downloads).toEqual([]);
    expect(zipFiles.size).toBe(0);
  });

  it('reports a closed share sheet as cancelled, not a failure', async () => {
    share.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'AbortError' }));
    const p = post({ media: [video] });
    await expect(downloadGeralContent(p)).resolves.toBe('cancelled');
    // Trying again reuses the files.
    await expect(downloadGeralContent(p)).resolves.toBe('shared');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the files when the tap expired and shares them on the next tap without refetching', async () => {
    share.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
    const p = post({ media: [video] });
    await expect(downloadGeralContent(p)).resolves.toBe('pending');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(downloadGeralContent(p)).resolves.toBe('shared');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledTimes(2);
  });

  it('falls back to the regular download when the files cannot be shared', async () => {
    canShare.mockReturnValue(false);
    await expect(downloadGeralContent(post({ media: [video] }))).resolves.toBe('saved');
    expect(share).not.toHaveBeenCalled();
    expect(downloads).toEqual(['01.mp4']);
  });

  it('also shares on an iPad, which reports a Mac user agent', async () => {
    device(IPAD, 5);
    await expect(downloadGeralContent(post({ media: [video] }))).resolves.toBe('shared');
  });

  it.each([
    ['Android, whose download already reaches the gallery', ANDROID, 5],
    ['a desktop Mac', IPAD, 0],
  ])('keeps the regular download on %s', async (_label, ua, touchPoints) => {
    device(ua, touchPoints);
    await expect(downloadGeralContent(post({ media: [video] }))).resolves.toBe('saved');
    expect(share).not.toHaveBeenCalled();
    expect(downloads).toEqual(['01.mp4']);
  });

  it('keeps the pending files across a refetch that signs new URLs', async () => {
    share.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
    await downloadGeralContent(post({ media: [video] }));
    await expect(
      downloadGeralContent(post({ media: [{ ...video, url: 'https://cdn/v.mp4?sig=new' }] })),
    ).resolves.toBe('shared');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails on another share error', async () => {
    share.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'DataError' }));
    await expect(downloadGeralContent(post({ media: [video] }))).rejects.toThrow();
  });
});

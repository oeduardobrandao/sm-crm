import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../../../services/postMedia', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../services/postMedia')>();
  return {
    ...actual,
    listPostMedia: vi.fn(async () => []),
    uploadPostMedia: vi.fn(),
    deletePostMedia: vi.fn(),
    reorderPostMedia: vi.fn(),
  };
});

vi.mock('../../../../utils/videoFrame', () => ({
  extractVideoFrame: vi.fn(),
  captureFrameFromElement: vi.fn(),
}));

vi.mock('../../../../utils/imageJpeg', () => ({
  encodeImageAsJpeg: vi.fn((f: File) => Promise.resolve(f)),
}));

vi.mock('../PostMediaLightbox', () => ({
  PostMediaLightbox: () => null,
}));

vi.mock('../ThumbnailPickerDialog', () => ({
  ThumbnailPickerDialog: () => null,
}));

vi.mock('../../../arquivos/components/FilePickerModal', () => ({
  FilePickerModal: () => null,
}));

vi.mock('../../../../services/fileService', () => ({
  linkFileToPost: vi.fn(),
  unlinkFileFromPost: vi.fn(),
}));

const { downloadMediaMock, zipFileSpy } = vi.hoisted(() => ({
  downloadMediaMock: vi.fn(async () => undefined),
  zipFileSpy: vi.fn(),
}));

vi.mock('@/utils/downloadMedia', () => ({ downloadMedia: downloadMediaMock }));

vi.mock('jszip', () => ({
  default: class MockJSZip {
    file = zipFileSpy;
    async generateAsync() {
      return new Blob(['zip']);
    }
  },
}));

import { listPostMedia, uploadPostMedia } from '../../../../services/postMedia';
import type { PostMedia } from '../../../../store';
import { extractVideoFrame } from '../../../../utils/videoFrame';
import { encodeImageAsJpeg } from '../../../../utils/imageJpeg';
import { PostMediaGallery } from '../PostMediaGallery';

const uploadPostMediaMock = vi.mocked(uploadPostMedia);
const extractVideoFrameMock = vi.mocked(extractVideoFrame);
const encodeImageAsJpegMock = vi.mocked(encodeImageAsJpeg);

function createFile(name: string, type: string) {
  return new File([new Uint8Array(64)], name, { type });
}

function renderGallery() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
  render(
    <QueryClientProvider client={qc}>
      <PostMediaGallery postId={42} />
    </QueryClientProvider>,
  );
  return { invalidateSpy };
}

async function pickFiles(files: File[]) {
  // The add tile is a label wrapping a hidden file input.
  // findByText waits for the loading skeleton to resolve before the label appears.
  const label = await screen.findByText('Adicionar');
  const input = label.closest('label')!.querySelector('input')!;
  fireEvent.change(input, { target: { files } });
}

beforeEach(() => {
  vi.clearAllMocks();
  uploadPostMediaMock.mockImplementation(
    async ({ file }) =>
      ({
        id: Math.floor(Math.random() * 1000),
        post_id: 42,
        kind: file.type.startsWith('video/') ? 'video' : 'image',
      }) as Awaited<ReturnType<typeof uploadPostMedia>>,
  );
  extractVideoFrameMock.mockResolvedValue(createFile('thumb.jpg', 'image/jpeg'));
});

describe('PostMediaGallery upload orchestration', () => {
  it('auto-extracts a frame and uploads videos without prompting', async () => {
    renderGallery();
    const video = createFile('reel.mp4', 'video/mp4');

    await pickFiles([video]);

    await waitFor(() => expect(uploadPostMediaMock).toHaveBeenCalledTimes(1));
    expect(extractVideoFrameMock).toHaveBeenCalledWith(video);
    expect(uploadPostMediaMock.mock.calls[0][0]).toMatchObject({
      postId: 42,
      file: video,
      thumbnail: expect.any(File),
    });
    expect(screen.queryByText(/Não foi possível gerar a miniatura/)).not.toBeInTheDocument();
  });

  it('uploads every file in a mixed selection (no drop-the-rest)', async () => {
    renderGallery();
    const files = [
      createFile('a.jpg', 'image/jpeg'),
      createFile('b.mp4', 'video/mp4'),
      createFile('c.png', 'image/png'),
    ];

    await pickFiles(files);

    await waitFor(() => expect(uploadPostMediaMock).toHaveBeenCalledTimes(3));
    expect(extractVideoFrameMock).toHaveBeenCalledTimes(1);
  });

  it('assigns each uploaded file a sort_order from its selection position', async () => {
    renderGallery();
    const files = [
      createFile('1.png', 'image/png'),
      createFile('2.png', 'image/png'),
      createFile('3.png', 'image/png'),
    ];

    await pickFiles(files);

    await waitFor(() => expect(uploadPostMediaMock).toHaveBeenCalledTimes(3));
    // Uploads run concurrently, so sort by the assigned position rather than
    // call order: every file must carry a distinct 0/1/2 from its index.
    const sortOrders = uploadPostMediaMock.mock.calls.map((c) => c[0].sortOrder).sort();
    expect(sortOrders).toEqual([0, 1, 2]);
  });

  it('queues undecodable videos for manual thumbnails instead of overwriting', async () => {
    renderGallery();
    extractVideoFrameMock.mockRejectedValue(new Error('decode failed'));
    const videos = [
      createFile('um.mov', 'video/quicktime'),
      createFile('dois.mov', 'video/quicktime'),
    ];

    await pickFiles(videos);

    // Wait until both videos have been processed and the second is shown as queued.
    // "remainingVideos" renders when pendingVideos.length > 1 (count = length - 1).
    await waitFor(() =>
      expect(screen.getByText(/1 vídeo\(s\) aguardando miniatura/)).toBeInTheDocument(),
    );
    expect(screen.getByText('um.mov')).toBeInTheDocument();
    expect(uploadPostMediaMock).not.toHaveBeenCalled();
  });

  it('uploads the queued video once a manual thumbnail is chosen', async () => {
    renderGallery();
    extractVideoFrameMock.mockRejectedValue(new Error('decode failed'));
    const video = createFile('um.mov', 'video/quicktime');
    await pickFiles([video]);
    // Wait for the pending panel to appear (extraction failed, uid removed from queue).
    await screen.findByText('Escolher thumbnail');

    // Switch to fake timers AFTER all async setup is done, to control the 2s
    // setTimeout that clears the upload progress item from the DOM.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const manualThumb = createFile('capa.jpg', 'image/jpeg');
      const label = screen.getByText('Escolher thumbnail');
      const input = label.closest('label')!.querySelector('input')!;
      fireEvent.change(input, { target: { files: [manualThumb] } });

      // Let the upload promise resolve (real async) then advance past the 2s cleanup.
      await waitFor(() => expect(uploadPostMediaMock).toHaveBeenCalledTimes(1));
      expect(uploadPostMediaMock.mock.calls[0][0]).toMatchObject({
        file: video,
        thumbnail: manualThumb,
      });
      expect(encodeImageAsJpegMock).toHaveBeenCalledWith(manualThumb);
      // Advance past the 2s setTimeout that clears the upload progress items.
      vi.advanceTimersByTime(3000);
      await waitFor(() => expect(screen.queryByText('um.mov')).not.toBeInTheDocument());
    } finally {
      vi.useRealTimers();
    }
  });

  it('invalidates workflow-covers after uploads', async () => {
    const { invalidateSpy } = renderGallery();

    await pickFiles([createFile('reel.mp4', 'video/mp4')]);

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['workflow-covers'] }),
    );
  });
});

function makeMedia(n: number): PostMedia[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    post_id: 1,
    conta_id: 'c',
    r2_key: `img/${i}.jpg`,
    thumbnail_r2_key: null,
    kind: 'image' as const,
    mime_type: 'image/jpeg',
    size_bytes: 1000,
    original_filename: `img${i}.jpg`,
    width: 1080,
    height: 1080,
    duration_seconds: null,
    is_cover: i === 0,
    sort_order: i,
    uploaded_by: null,
    created_at: '2026-01-01T00:00:00Z',
    url: `https://example.test/img/${i}.jpg`,
  }));
}

describe('carousel 10-item warning', () => {
  it('shows the warning when there are 11 media items', async () => {
    vi.mocked(listPostMedia).mockResolvedValueOnce(makeMedia(11));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <PostMediaGallery postId={1} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/Carrossel acima do limite/i)).toBeInTheDocument();
  });

  it('does not show the warning at exactly 10 media items', async () => {
    vi.mocked(listPostMedia).mockResolvedValueOnce(makeMedia(10));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <PostMediaGallery postId={1} />
      </QueryClientProvider>,
    );
    await screen.findByText('Adicionar'); // wait for the query to resolve
    expect(screen.queryByText(/Carrossel acima do limite/i)).not.toBeInTheDocument();
  });
});

describe('"Baixar todos" zip threshold', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob(['bytes']), { status: 200 })),
    );
    URL.createObjectURL = vi.fn(() => 'blob:zip');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('downloads the file directly when the post has exactly one', async () => {
    vi.mocked(listPostMedia).mockResolvedValueOnce(makeMedia(1));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <PostMediaGallery postId={1} />
      </QueryClientProvider>,
    );

    // One file → the button drops the "todos" wording along with the zip.
    fireEvent.click(await screen.findByText('Baixar arquivo'));

    await waitFor(() =>
      expect(downloadMediaMock).toHaveBeenCalledWith(
        expect.objectContaining({ original_filename: 'img0.jpg' }),
      ),
    );
    expect(zipFileSpy).not.toHaveBeenCalled();
  });

  it('still zips when the post has more than one file', async () => {
    vi.mocked(listPostMedia).mockResolvedValueOnce(makeMedia(2));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <PostMediaGallery postId={1} />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByText('Baixar todos'));

    await waitFor(() => expect(zipFileSpy).toHaveBeenCalledTimes(2));
    expect(downloadMediaMock).not.toHaveBeenCalled();
  });
});

describe('media request mode', () => {
  // Regression: the tile used to request the url in no-cors mode while the
  // preloader, lightbox and zip download request the SAME url in cors mode.
  // The proxy serves media as `immutable` for a year, so whichever request
  // landed first decided the browser's cache entry — and a no-cors entry (no
  // ACAO header) makes every later cors read fail, breaking the lightbox.
  it('requests image tiles in cors mode, matching every other reader of the url', async () => {
    vi.mocked(listPostMedia).mockResolvedValueOnce(makeMedia(1));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <PostMediaGallery postId={1} />
      </QueryClientProvider>,
    );

    const img = await screen.findByAltText('img0.jpg');
    expect(img).toHaveAttribute('crossorigin', 'anonymous');
  });
});

// ============================================================

// Regression guard: Estúdio was retired, so the gallery can never be design-locked again.
describe('PostMediaGallery design decoupling regression guard', () => {
  it('never renders a design-ownership banner', async () => {
    vi.mocked(listPostMedia).mockResolvedValueOnce([
      { id: 10, kind: 'image', origin: 'manual', url: 'https://x/y.jpg' } as never,
    ]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <PostMediaGallery postId={1} onChange={vi.fn()} />
      </QueryClientProvider>,
    );
    await screen.findByText('Adicionar'); // wait for the query to resolve
    expect(screen.queryByTestId('design-ownership-banner')).toBeNull();
  });
});

// ============================================================

// Storage auto-clean placeholder (spec 2026-08-10): an empty gallery on a post
// stamped media_autocleaned_at means "removed to free storage", not "add some".
describe('PostMediaGallery auto-clean placeholder', () => {
  function renderStamped(extra?: {
    instagramPermalink?: string | null;
    tiktokPostUrl?: string | null;
  }) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <PostMediaGallery
          postId={7}
          mediaAutocleanedAt="2026-08-05T05:30:00Z"
          instagramPermalink={extra?.instagramPermalink ?? null}
          tiktokPostUrl={extra?.tiktokPostUrl ?? null}
        />
      </QueryClientProvider>,
    );
  }

  it('renders the placeholder with the Instagram link instead of the dropzone', async () => {
    vi.mocked(listPostMedia).mockResolvedValueOnce([]);
    renderStamped({ instagramPermalink: 'https://www.instagram.com/p/abc/' });

    expect(await screen.findByText('Mídia removida para liberar espaço')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Ver publicação no Instagram/ });
    expect(link).toHaveAttribute('href', 'https://www.instagram.com/p/abc/');
    expect(screen.queryByText('Adicionar')).toBeNull();
  });

  it('falls back to the TikTok link when there is no Instagram permalink', async () => {
    vi.mocked(listPostMedia).mockResolvedValueOnce([]);
    renderStamped({ tiktokPostUrl: 'https://www.tiktok.com/@x/video/1' });

    expect(await screen.findByText('Mídia removida para liberar espaço')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Ver publicação no TikTok/ });
    expect(link).toHaveAttribute('href', 'https://www.tiktok.com/@x/video/1');
  });

  it('renders no publication link when the post has neither URL', async () => {
    vi.mocked(listPostMedia).mockResolvedValueOnce([]);
    renderStamped();

    expect(await screen.findByText('Mídia removida para liberar espaço')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('keeps the normal gallery when the post still has media', async () => {
    vi.mocked(listPostMedia).mockResolvedValueOnce([
      { id: 10, kind: 'image', origin: 'manual', url: 'https://x/y.jpg' } as never,
    ]);
    renderStamped({ instagramPermalink: 'https://www.instagram.com/p/abc/' });

    await screen.findByText('Adicionar');
    expect(screen.queryByText('Mídia removida para liberar espaço')).toBeNull();
  });

  it('keeps the dropzone when the post was never cleaned', async () => {
    vi.mocked(listPostMedia).mockResolvedValueOnce([]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <PostMediaGallery postId={7} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Adicionar')).toBeInTheDocument();
    expect(screen.queryByText('Mídia removida para liberar espaço')).toBeNull();
  });
});

describe('PostMediaGallery permanently lost media', () => {
  it('shows the unavailable placeholder instead of a broken image for a permanently lost tile', async () => {
    vi.mocked(listPostMedia).mockResolvedValueOnce([
      {
        ...makeMedia(1)[0],
        url: undefined,
        thumbnail_url: null,
        media_lost_at: '2026-08-14T03:00:00.000Z',
      },
    ]);
    renderGallery();
    expect(await screen.findByText('Mídia indisponível')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});

// ============================================================

// Cover is derived (legacy/MCP is_cover flag, else first by sort order) —
// there's no manual "set as cover" star anymore. Mirrors the resolution rule
// already used by the Hub backend and post-media-manage's other readers.
describe('PostMediaGallery derived cover', () => {
  it('marks the first media as capa when no legacy is_cover flag exists', async () => {
    vi.mocked(listPostMedia).mockResolvedValueOnce(
      makeMedia(3).map((m) => ({ ...m, is_cover: false })),
    );
    renderGallery();

    const badges = await screen.findAllByText('capa');
    expect(badges).toHaveLength(1);
    const tile = badges[0].closest('.aspect-square');
    expect(tile).toContainElement(screen.getByAltText('img0.jpg'));
  });

  it('still honors a legacy is_cover flag on a non-first media', async () => {
    vi.mocked(listPostMedia).mockResolvedValueOnce(
      makeMedia(3).map((m, i) => ({ ...m, is_cover: i === 1 })),
    );
    renderGallery();

    const badges = await screen.findAllByText('capa');
    expect(badges).toHaveLength(1);
    const tile = badges[0].closest('.aspect-square');
    expect(tile).toContainElement(screen.getByAltText('img1.jpg'));
  });

  it('does not render a set-cover button anymore', async () => {
    vi.mocked(listPostMedia).mockResolvedValueOnce(makeMedia(2));
    renderGallery();

    await screen.findAllByText('capa');
    expect(screen.queryByTitle('Definir como capa')).toBeNull();
  });

  it('invalidates workflow-covers after deleting a media item', async () => {
    vi.mocked(listPostMedia).mockResolvedValueOnce(makeMedia(2));
    const { invalidateSpy } = renderGallery();

    const [deleteButton] = await screen.findAllByTitle('Remover');
    fireEvent.click(deleteButton);

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['workflow-covers'] }),
    );
  });
});

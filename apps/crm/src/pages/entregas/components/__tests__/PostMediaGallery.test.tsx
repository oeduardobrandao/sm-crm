import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
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
    updateVideoThumbnail: vi.fn(),
    probeVideo: vi.fn(async () => ({ width: 1080, height: 1920, duration_seconds: 30 })),
  };
});

vi.mock('@mesaas/ui/video/frame', () => ({
  extractVideoFrame: vi.fn(),
  captureFrameFromElement: vi.fn(),
}));

vi.mock('../../../../utils/imageJpeg', () => ({
  encodeImageAsJpeg: vi.fn((f: File) => Promise.resolve(f)),
}));

vi.mock('../PostMediaLightbox', () => ({
  PostMediaLightbox: ({
    open,
    initialIndex,
    onCreateInternalNote,
    onNoteStatus,
  }: {
    open: boolean;
    initialIndex: number;
    onCreateInternalNote?: (input: Record<string, unknown>) => Promise<void>;
    onNoteStatus?: (ids: number[], status: 'open' | 'resolved') => Promise<void>;
  }) =>
    open ? (
      <div data-testid="lightbox-stub" data-index={initialIndex}>
        <button
          type="button"
          onClick={() => void onCreateInternalNote?.({ linkId: 5, x: 0.1, y: 0.2, body: 'n' })}
        >
          stub-criar-nota
        </button>
        <button type="button" onClick={() => void onNoteStatus?.([77], 'resolved')}>
          stub-resolver-nota
        </button>
      </div>
    ) : null,
}));

vi.mock('@/store/mediaNotes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/mediaNotes')>()),
  setMediaNoteStatus: vi.fn(async () => undefined),
  createInternalMediaNote: vi.fn(async () => 1),
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

import {
  deletePostMedia,
  listPostMedia,
  updateVideoThumbnail,
  uploadPostMedia,
} from '../../../../services/postMedia';
import type { PostMedia } from '../../../../store';
import { extractVideoFrame } from '@mesaas/ui/video/frame';
import { encodeImageAsJpeg } from '../../../../utils/imageJpeg';
import { PostMediaGallery } from '../PostMediaGallery';
import { createInternalMediaNote, setMediaNoteStatus, type MediaNote } from '@/store/mediaNotes';
import { makeNote } from '../mediaNotes/__tests__/fixtures';

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

describe('tile file names', () => {
  it('shows each file name under its tile so the order can be checked at a glance', async () => {
    const media = makeMedia(2);
    media[1] = { ...media[1], original_filename: 'carrossel-cliente-final-10.png' };
    vi.mocked(listPostMedia).mockResolvedValueOnce(media);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <PostMediaGallery postId={1} />
      </QueryClientProvider>,
    );

    expect(await screen.findByTitle('img0.jpg')).toHaveTextContent('img0.jpg');
    // Long names keep their end visible: the slide number is what tells the order.
    const long = screen.getByTitle('carrossel-cliente-final-10.png');
    expect(long).toHaveTextContent('carrossel-cliente-final-10.png');
    expect(long.lastElementChild).toHaveTextContent('l-10.png');
  });
});

// ============================================================

// Regression guard: Estúdio was retired, so the gallery can never be design-locked again.
describe('PostMediaGallery design decoupling regression guard', () => {
  it('never renders a design-ownership banner', async () => {
    vi.mocked(listPostMedia).mockResolvedValueOnce([
      {
        id: 10,
        kind: 'image',
        origin: 'manual',
        url: 'https://x/y.jpg',
        original_filename: 'y.jpg',
      } as never,
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
      {
        id: 10,
        kind: 'image',
        origin: 'manual',
        url: 'https://x/y.jpg',
        original_filename: 'y.jpg',
      } as never,
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

vi.mock('../MediaAdjustmentDialog', () => ({
  MediaAdjustmentDialog: ({
    media,
    onUpdated,
    onReplaced,
    onClose,
  }: {
    media: PostMedia;
    onUpdated: () => void;
    onReplaced?: () => void;
    onClose: () => void;
  }) => (
    <div role="dialog">
      Editando {media.original_filename}
      <button
        onClick={() => {
          onReplaced?.();
          onUpdated();
          onClose();
        }}
      >
        Simular ajuste salvo
      </button>
      {/* The real dialog also calls onUpdated from its catch once a save was attempted. */}
      <button
        onClick={() => {
          onUpdated();
          onClose();
        }}
      >
        Simular falha no ajuste
      </button>
    </div>
  ),
}));

describe('PostMediaGallery adjustment entry points', () => {
  const image = {
    id: 44,
    post_id: 42,
    kind: 'image',
    mime_type: 'image/jpeg',
    original_filename: 'portrait.jpg',
    url: 'https://example.test/portrait.jpg',
    width: 1080,
    height: 1920,
    size_bytes: 1024,
    duration_seconds: null,
    is_cover: false,
  } as PostMedia;
  it('identifies the invalid file and opens its adjustment editor', async () => {
    vi.mocked(listPostMedia).mockResolvedValue([image]);
    renderGallery();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Ajustar proporção de portrait.jpg' }),
    );
    expect(await screen.findByRole('dialog')).toHaveTextContent('portrait.jpg');
  });
  it('does not warn about a supported 3:4 feed image', async () => {
    vi.mocked(listPostMedia).mockResolvedValue([{ ...image, height: 1440 }]);
    renderGallery();
    // 'Adicionar' renders with the empty gallery, before the media list resolves: wait
    // on the tile's own control so the warning check below runs against loaded media.
    expect(await screen.findByTitle('Ajustar proporção')).toBeInTheDocument();
    expect(screen.queryByText(/precisa de ajuste/)).not.toBeInTheDocument();
  });
});

it('does not apply the carousel item warning to sequential Stories', async () => {
  vi.mocked(listPostMedia).mockResolvedValue(makeMedia(11));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PostMediaGallery postId={1} forStories />
    </QueryClientProvider>,
  );
  await screen.findByText('Adicionar');
  expect(screen.queryByText(/máximo de 10/i)).not.toBeInTheDocument();
});

it('revalidates the gallery and refreshes visible cover caches after adjustment', async () => {
  const invalid = { ...makeMedia(1)[0], height: 1920 };
  vi.mocked(listPostMedia)
    .mockResolvedValueOnce([invalid])
    .mockResolvedValue([{ ...invalid, height: 1440 }]);
  const { invalidateSpy } = renderGallery();
  fireEvent.click(await screen.findByRole('button', { name: 'Ajustar proporção de img0.jpg' }));
  fireEvent.click(screen.getByRole('button', { name: 'Simular ajuste salvo' }));
  await waitFor(() =>
    expect(screen.queryByText('1 arquivo precisa de ajuste')).not.toBeInTheDocument(),
  );
  expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['workflow-grid'] });
  expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['workflow-covers'] });
});

describe('PostMediaGallery Reel cover uploaded as a second file', () => {
  const video = {
    id: 50,
    post_id: 42,
    kind: 'video',
    mime_type: 'video/mp4',
    original_filename: 'reel.mp4',
    url: 'https://example.test/reel.mp4',
    thumbnail_url: 'https://example.test/reel-thumb.jpg',
    width: 1080,
    height: 1920,
    size_bytes: 1024,
    duration_seconds: 30,
    is_cover: false,
  } as PostMedia;
  const cover = {
    id: 51,
    post_id: 42,
    kind: 'image',
    mime_type: 'image/jpeg',
    original_filename: 'capa.jpg',
    url: 'https://example.test/capa.jpg',
    width: 1080,
    height: 1920,
    size_bytes: 1024,
    duration_seconds: null,
    is_cover: false,
  } as PostMedia;

  afterEach(() => vi.unstubAllGlobals());

  it('explains the cover belongs in the thumbnail instead of flagging the 9:16 ratio', async () => {
    vi.mocked(listPostMedia).mockResolvedValue([video, cover]);
    renderGallery();
    expect(await screen.findByText('Esta imagem parece ser a capa do Reel')).toBeInTheDocument();
    expect(screen.queryByText(/Proporção da imagem fora do permitido/)).not.toBeInTheDocument();
    // The video is judged as the Reel it becomes, not as a carousel slide.
    expect(screen.queryByText(/Proporção do vídeo fora do permitido/)).not.toBeInTheDocument();
    expect(screen.queryByText(/precisa de ajuste/)).not.toBeInTheDocument();
  });

  it('leaves a feed-ratio image beside a video alone (a real carousel)', async () => {
    vi.mocked(listPostMedia).mockResolvedValue([video, { ...cover, height: 1350 }]);
    renderGallery();
    await screen.findAllByTitle('Ajustar proporção');
    expect(screen.queryByText('Esta imagem parece ser a capa do Reel')).not.toBeInTheDocument();
  });

  it('moves the image into the video thumbnail, then removes the slide', async () => {
    vi.mocked(listPostMedia).mockResolvedValue([video, cover]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob(['img'], { type: 'image/jpeg' }))),
    );
    const order: string[] = [];
    vi.mocked(updateVideoThumbnail).mockImplementation(async () => {
      order.push('thumbnail');
      return video;
    });
    vi.mocked(deletePostMedia).mockImplementation(async () => {
      order.push('delete');
    });
    renderGallery();
    fireEvent.click(await screen.findByRole('button', { name: 'Usar como capa do Reel' }));
    await waitFor(() => expect(deletePostMedia).toHaveBeenCalledWith(51));
    expect(updateVideoThumbnail).toHaveBeenCalledWith(50, expect.any(File));
    expect(order).toEqual(['thumbnail', 'delete']);
  });

  it('keeps the image when the thumbnail update fails', async () => {
    vi.mocked(listPostMedia).mockResolvedValue([video, cover]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob(['img'], { type: 'image/jpeg' }))),
    );
    vi.mocked(updateVideoThumbnail).mockRejectedValue(new Error('upload failed'));
    renderGallery();
    fireEvent.click(await screen.findByRole('button', { name: 'Usar como capa do Reel' }));
    await waitFor(() => expect(updateVideoThumbnail).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Usar como capa do Reel' })).toBeEnabled(),
    );
    expect(deletePostMedia).not.toHaveBeenCalled();
  });
});

describe('PostMediaGallery feedback em mídia', () => {
  const slide = (id: number, over: Partial<PostMedia> = {}) =>
    ({ ...makeMedia(1)[0], id, original_filename: `s${id}.jpg`, ...over }) as PostMedia;
  const notesOn = (linkId: number, n: number, firstId = linkId * 100): MediaNote[] =>
    Array.from({ length: n }, (_, i) => makeNote({ id: firstId + i, current_link_id: linkId }));

  function renderWithNotes(notes: MediaNote[], onNotesChanged = vi.fn(), extra = {}) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <PostMediaGallery postId={42} notes={notes} onNotesChanged={onNotesChanged} {...extra} />
      </QueryClientProvider>,
    );
    return { onNotesChanged };
  }

  it('tiles carry the count of open notes on that item (client and internal, current only)', async () => {
    vi.mocked(listPostMedia).mockResolvedValue([slide(5), slide(6)]);
    renderWithNotes([
      ...notesOn(5, 2),
      makeNote({ id: 900, current_link_id: 5, visibility: 'internal', author_kind: 'team' }),
      makeNote({ id: 901, current_link_id: 5, status: 'resolved' }),
      makeNote({ id: 902, current_link_id: null, is_previous_version: true }),
    ]);
    expect(await screen.findByText('3 comentários em aberto')).toBeInTheDocument();
    expect(screen.getAllByText(/em aberto/)).toHaveLength(1);
  });

  it('gallery delete with open notes shows prompt and confirm resolves them', async () => {
    vi.mocked(listPostMedia).mockResolvedValue([slide(5), slide(6)]);
    vi.mocked(deletePostMedia).mockResolvedValue(undefined);
    const { onNotesChanged } = renderWithNotes([...notesOn(5, 2, 10), ...notesOn(6, 1, 20)]);

    fireEvent.click((await screen.findAllByTitle('Remover'))[0]);

    expect(
      await screen.findByText('Marcar como resolvidos os 2 comentários deste slide?'),
    ).toBeInTheDocument();
    expect(deletePostMedia).toHaveBeenCalledWith(5);
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como resolvidos' }));
    await waitFor(() => expect(setMediaNoteStatus).toHaveBeenCalledWith([10, 11], 'resolved'));
    await waitFor(() => expect(onNotesChanged).toHaveBeenCalled());
  });

  it('Agora não leaves the notes open', async () => {
    vi.mocked(listPostMedia).mockResolvedValue([slide(5)]);
    vi.mocked(deletePostMedia).mockResolvedValue(undefined);
    const { onNotesChanged } = renderWithNotes(notesOn(5, 2, 10));
    fireEvent.click(await screen.findByTitle('Remover'));
    fireEvent.click(await screen.findByRole('button', { name: 'Agora não' }));
    await waitFor(() => expect(screen.queryByText(/deste slide/)).not.toBeInTheDocument());
    expect(setMediaNoteStatus).not.toHaveBeenCalled();
    expect(onNotesChanged).not.toHaveBeenCalled();
  });

  it('no prompt when the delete fails', async () => {
    vi.mocked(listPostMedia).mockResolvedValue([slide(5)]);
    vi.mocked(deletePostMedia).mockRejectedValue(new Error('falhou'));
    renderWithNotes(notesOn(5, 2, 10));
    fireEvent.click(await screen.findByTitle('Remover'));
    await waitFor(() => expect(deletePostMedia).toHaveBeenCalled());
    expect(screen.queryByText(/deste slide/)).not.toBeInTheDocument();
  });

  it('no prompt when there are no open notes on that link', async () => {
    vi.mocked(listPostMedia).mockResolvedValue([slide(5), slide(6)]);
    vi.mocked(deletePostMedia).mockResolvedValue(undefined);
    renderWithNotes([
      ...notesOn(6, 2, 20),
      makeNote({ id: 11, current_link_id: 5, status: 'resolved' }),
    ]);
    fireEvent.click((await screen.findAllByTitle('Remover'))[0]);
    await waitFor(() => expect(deletePostMedia).toHaveBeenCalledWith(5));
    expect(screen.queryByText(/deste slide/)).not.toBeInTheDocument();
  });

  it('adjust replace with open notes shows prompt after the save', async () => {
    vi.mocked(listPostMedia).mockResolvedValue([slide(5)]);
    renderWithNotes(notesOn(5, 3, 10));
    fireEvent.click(await screen.findByTitle('Ajustar proporção'));
    expect(screen.queryByText(/deste slide/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Simular ajuste salvo' }));
    expect(
      await screen.findByText('Marcar como resolvidos os 3 comentários deste slide?'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como resolvidos' }));
    await waitFor(() => expect(setMediaNoteStatus).toHaveBeenCalledWith([10, 11, 12], 'resolved'));
  });

  it('adjust replace without open notes on that link shows no prompt', async () => {
    vi.mocked(listPostMedia).mockResolvedValue([slide(5), slide(6)]);
    renderWithNotes(notesOn(6, 2, 20));
    fireEvent.click((await screen.findAllByTitle('Ajustar proporção'))[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Simular ajuste salvo' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByText(/deste slide/)).not.toBeInTheDocument();
  });

  it('openLinkRequest opens the lightbox on that item (anchor chip)', async () => {
    vi.mocked(listPostMedia).mockResolvedValue([slide(5), slide(6), slide(7)]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <PostMediaGallery postId={42} openLinkRequest={null} />
      </QueryClientProvider>,
    );
    await screen.findAllByTitle('Remover');
    expect(screen.queryByTestId('lightbox-stub')).not.toBeInTheDocument();
    rerender(
      <QueryClientProvider client={qc}>
        <PostMediaGallery postId={42} openLinkRequest={{ linkId: 6, nonce: 1 }} />
      </QueryClientProvider>,
    );
    expect(await screen.findByTestId('lightbox-stub')).toHaveAttribute('data-index', '1');
  });

  it('passes internal note creation through with the post id, then refreshes', async () => {
    vi.mocked(listPostMedia).mockResolvedValue([slide(5)]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onNotesChanged = vi.fn();
    render(
      <QueryClientProvider client={qc}>
        <PostMediaGallery
          postId={42}
          notes={[]}
          onNotesChanged={onNotesChanged}
          openLinkRequest={{ linkId: 5, nonce: 1 }}
        />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'stub-criar-nota' }));
    await waitFor(() =>
      expect(createInternalMediaNote).toHaveBeenCalledWith({
        postId: 42,
        linkId: 5,
        x: 0.1,
        y: 0.2,
        body: 'n',
      }),
    );
    await waitFor(() => expect(onNotesChanged).toHaveBeenCalled());
  });

  it('adjust: a failed or aborted replace (onUpdated only) does not offer the prompt', async () => {
    vi.mocked(listPostMedia).mockResolvedValue([slide(5)]);
    renderWithNotes(notesOn(5, 3, 10));
    fireEvent.click(await screen.findByTitle('Ajustar proporção'));
    fireEvent.click(screen.getByRole('button', { name: 'Simular falha no ajuste' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByText(/deste slide/)).not.toBeInTheDocument();
  });

  it('the prompt covers every open note on the link, client and internal', async () => {
    vi.mocked(listPostMedia).mockResolvedValue([slide(5)]);
    vi.mocked(deletePostMedia).mockResolvedValue(undefined);
    renderWithNotes([
      makeNote({ id: 10, current_link_id: 5 }),
      makeNote({ id: 11, current_link_id: 5, visibility: 'internal', author_kind: 'team' }),
      makeNote({ id: 12, current_link_id: 5, status: 'resolved' }),
    ]);
    fireEvent.click(await screen.findByTitle('Remover'));
    expect(
      await screen.findByText('Marcar como resolvidos os 2 comentários deste slide?'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como resolvidos' }));
    await waitFor(() => expect(setMediaNoteStatus).toHaveBeenCalledWith([10, 11], 'resolved'));
  });

  it('a removed video asks about "deste vídeo" and a single note reads in the singular', async () => {
    vi.mocked(listPostMedia).mockResolvedValue([
      slide(5, { kind: 'video', original_filename: 'v.mp4', url: 'https://example.test/v.mp4' }),
    ]);
    vi.mocked(deletePostMedia).mockResolvedValue(undefined);
    renderWithNotes([makeNote({ id: 10, current_link_id: 5, media_kind: 'video' })]);
    fireEvent.click(await screen.findByTitle('Remover'));
    expect(
      await screen.findByText('Marcar como resolvido o comentário deste vídeo?'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Marcar como resolvido' })).toBeInTheDocument();
  });

  it('Reel cover moved: offers to resolve the open notes of the removed image', async () => {
    const video = slide(50, {
      kind: 'video',
      original_filename: 'reel.mp4',
      url: 'https://example.test/reel.mp4',
      thumbnail_url: 'https://example.test/reel-thumb.jpg',
      width: 1080,
      height: 1920,
    });
    const cover = slide(51, { original_filename: 'capa.jpg', width: 1080, height: 1920 });
    vi.mocked(listPostMedia).mockResolvedValue([video, cover]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob(['img'], { type: 'image/jpeg' }))),
    );
    vi.mocked(updateVideoThumbnail).mockResolvedValue(video);
    vi.mocked(deletePostMedia).mockResolvedValue(undefined);
    const { onNotesChanged } = renderWithNotes([...notesOn(51, 2, 30), ...notesOn(50, 1, 40)]);
    fireEvent.click(await screen.findByRole('button', { name: 'Usar como capa do Reel' }));
    expect(
      await screen.findByText('Marcar como resolvidos os 2 comentários deste slide?'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Marcar como resolvidos' }));
    await waitFor(() => expect(setMediaNoteStatus).toHaveBeenCalledWith([30, 31], 'resolved'));
    await waitFor(() => expect(onNotesChanged).toHaveBeenCalled());
    vi.unstubAllGlobals();
  });

  it('Reel cover: a failed thumbnail update offers no prompt', async () => {
    const video = slide(50, {
      kind: 'video',
      original_filename: 'reel.mp4',
      url: 'https://example.test/reel.mp4',
      thumbnail_url: 'https://example.test/reel-thumb.jpg',
      width: 1080,
      height: 1920,
    });
    const cover = slide(51, { original_filename: 'capa.jpg', width: 1080, height: 1920 });
    vi.mocked(listPostMedia).mockResolvedValue([video, cover]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob(['img'], { type: 'image/jpeg' }))),
    );
    vi.mocked(updateVideoThumbnail).mockRejectedValue(new Error('upload failed'));
    renderWithNotes(notesOn(51, 2, 30));
    fireEvent.click(await screen.findByRole('button', { name: 'Usar como capa do Reel' }));
    await waitFor(() => expect(updateVideoThumbnail).toHaveBeenCalled());
    expect(screen.queryByText(/deste slide/)).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('lightbox status changes go through setMediaNoteStatus, then refresh', async () => {
    vi.mocked(listPostMedia).mockResolvedValue([slide(5)]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onNotesChanged = vi.fn();
    render(
      <QueryClientProvider client={qc}>
        <PostMediaGallery
          postId={42}
          notes={[]}
          onNotesChanged={onNotesChanged}
          openLinkRequest={{ linkId: 5, nonce: 1 }}
        />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'stub-resolver-nota' }));
    await waitFor(() => expect(setMediaNoteStatus).toHaveBeenCalledWith([77], 'resolved'));
    await waitFor(() => expect(onNotesChanged).toHaveBeenCalled());
  });

  it('a failing status change shows a pt-BR toast, never the raw error', async () => {
    vi.mocked(listPostMedia).mockResolvedValue([slide(5)]);
    vi.mocked(setMediaNoteStatus).mockRejectedValueOnce(
      new Error('new row violates row-level security policy'),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <PostMediaGallery postId={42} notes={[]} openLinkRequest={{ linkId: 5, nonce: 1 }} />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'stub-resolver-nota' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith('Não foi possível atualizar a nota. Tente novamente.');
  });

  it('a failing confirm in the resolve prompt shows a pt-BR toast', async () => {
    vi.mocked(listPostMedia).mockResolvedValue([slide(5)]);
    vi.mocked(deletePostMedia).mockResolvedValue(undefined);
    vi.mocked(setMediaNoteStatus).mockRejectedValueOnce(new Error('rls'));
    renderWithNotes(notesOn(5, 2, 10));
    fireEvent.click(await screen.findByTitle('Remover'));
    fireEvent.click(await screen.findByRole('button', { name: 'Marcar como resolvidos' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Não foi possível atualizar a nota. Tente novamente.',
      ),
    );
  });

  it('a refresh failure after a successful change stays silent', async () => {
    vi.mocked(listPostMedia).mockResolvedValue([slide(5)]);
    vi.mocked(setMediaNoteStatus).mockResolvedValueOnce(undefined);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onNotesChanged = vi.fn().mockRejectedValue(new Error('refetch failed'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(
      <QueryClientProvider client={qc}>
        <PostMediaGallery
          postId={42}
          notes={[]}
          onNotesChanged={onNotesChanged}
          openLinkRequest={{ linkId: 5, nonce: 1 }}
        />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'stub-resolver-nota' }));
    await waitFor(() => expect(onNotesChanged).toHaveBeenCalled());
    expect(setMediaNoteStatus).toHaveBeenCalledWith([77], 'resolved');
    expect(toast.error).not.toHaveBeenCalled();
  });
});

// ── Oversized-video downscale (4K) ──────────────────────────────────────────────
const ds = vi.hoisted(() => ({
  probes: new Map<string, { width: number; height: number; duration_seconds: number } | null>(),
  inspectForDownscale: vi.fn(),
  downscaleVideo: vi.fn(),
  captureEvent: vi.fn(),
  planNull: false,
}));

// planDownscale only returns null for a budget under 100 kbps, which no video inside
// Instagram's duration limits reaches; the flag forces it to exercise the guard.
vi.mock('../../media-editor/downscalePlan', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../media-editor/downscalePlan')>();
  return {
    ...actual,
    planDownscale: (...args: Parameters<typeof actual.planDownscale>) =>
      ds.planNull ? null : actual.planDownscale(...args),
  };
});

vi.mock('../../media-editor/oversize', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../media-editor/oversize')>();
  return {
    ...actual,
    probeWithTimeout: vi.fn(async (f: File) =>
      ds.probes.has(f.name) ? ds.probes.get(f.name)! : actual.probeWithTimeout(f),
    ),
  };
});

vi.mock('../../media-editor/downscaleVideo', () => ({
  inspectForDownscale: ds.inspectForDownscale,
  downscaleVideo: ds.downscaleVideo,
  EngineUnavailable: class EngineUnavailable extends Error {
    name = 'EngineUnavailable';
  },
  DownscaleOutputInvalid: class DownscaleOutputInvalid extends Error {},
}));

vi.mock('@/lib/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/analytics')>()),
  captureEvent: ds.captureEvent,
}));

vi.mock('../DownscaleMediaDialog', () => ({
  DownscaleMediaDialog: ({ media }: { media: PostMedia | null }) =>
    media ? (
      <div data-testid="downscale-media-dialog">Reduzindo {media.original_filename}</div>
    ) : null,
}));

describe('PostMediaGallery oversized-video downscale at upload', () => {
  const FOUR_K = { width: 2160, height: 3840, duration_seconds: 30 };
  // A 9:16 video beside other files is a carousel slide and breaks the feed ratio too, so it
  // is not offered there; a 16:9 4K one only breaks the width.
  const FOUR_K_LANDSCAPE = { width: 3840, height: 2160, duration_seconds: 30 };
  const GB = 1024 * 1024 * 1024;

  function renderWith(props: Partial<ComponentProps<typeof PostMediaGallery>> = {}) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <PostMediaGallery postId={42} {...props} />
      </QueryClientProvider>,
    );
  }

  function bigFile(name: string, size: number) {
    const f = createFile(name, 'video/mp4');
    Object.defineProperty(f, 'size', { value: size });
    return f;
  }

  const converted = () => createFile('4k (1080p).mp4', 'video/mp4');

  beforeEach(() => {
    ds.probes.clear();
    ds.planNull = false;
    ds.inspectForDownscale.mockResolvedValue({ engine: 'webcodecs', hdr: false });
    ds.downscaleVideo.mockImplementation(async () => ({
      file: converted(),
      engine: 'webcodecs',
      hdr: false,
      width: 1080,
      height: 1920,
    }));
    vi.mocked(listPostMedia).mockResolvedValue([]);
  });

  async function reduceButton() {
    const btn = await screen.findByRole('button', { name: 'Reduzir e enviar' });
    await waitFor(() => expect(btn).toBeEnabled());
    return btn;
  }

  it('holds a 4K video back behind the offer, then converts and uploads it', async () => {
    ds.probes.set('4k.mp4', FOUR_K);
    renderWith();
    await pickFiles([createFile('4k.mp4', 'video/mp4')]);

    expect(await screen.findByText('Vídeo acima do limite do Instagram')).toBeInTheDocument();
    expect(uploadPostMediaMock).not.toHaveBeenCalled();

    fireEvent.click(await reduceButton());
    await waitFor(() => expect(uploadPostMediaMock).toHaveBeenCalledTimes(1));
    expect(ds.downscaleVideo).toHaveBeenCalledTimes(1);
    const call = uploadPostMediaMock.mock.calls[0][0];
    expect(call.file.name).toBe('4k (1080p).mp4');
    expect(call.sortOrder).toBe(0);
    expect(ds.captureEvent).toHaveBeenCalledWith(
      'video_downscaled',
      expect.objectContaining({ source: 'upload', outcome: 'ok', engine: 'webcodecs' }),
    );
  });

  it('uploads the passing files of a mixed batch right away, the 4K one after the decision', async () => {
    ds.probes.set('4k.mp4', FOUR_K_LANDSCAPE);
    renderWith();
    const img = createFile('a.jpg', 'image/jpeg');
    const ok = createFile('ok.mp4', 'video/mp4');
    await pickFiles([img, ok, createFile('4k.mp4', 'video/mp4')]);

    await waitFor(() => expect(uploadPostMediaMock).toHaveBeenCalledTimes(2));
    const first = uploadPostMediaMock.mock.calls.map((c) => [c[0].file.name, c[0].sortOrder]);
    expect(first).toEqual(
      expect.arrayContaining([
        ['a.jpg', 0],
        ['ok.mp4', 1],
      ]),
    );
    fireEvent.click(await reduceButton());
    await waitFor(() => expect(uploadPostMediaMock).toHaveBeenCalledTimes(3));
    expect(uploadPostMediaMock.mock.calls[2][0]).toMatchObject({ sortOrder: 2 });
    expect(uploadPostMediaMock.mock.calls[2][0].file.name).toBe('4k (1080p).mp4');
  });

  it('"Enviar original" uploads the original file', async () => {
    ds.probes.set('4k.mp4', FOUR_K);
    renderWith();
    const original = createFile('4k.mp4', 'video/mp4');
    await pickFiles([original]);
    fireEvent.click(await screen.findByRole('button', { name: 'Enviar original' }));
    await waitFor(() => expect(uploadPostMediaMock).toHaveBeenCalledTimes(1));
    expect(uploadPostMediaMock.mock.calls[0][0].file).toBe(original);
    expect(ds.downscaleVideo).not.toHaveBeenCalled();
  });

  it('dismissing uploads nothing for the held-back file, re-enables the tile and still reports the rest once', async () => {
    ds.probes.set('4k.mp4', FOUR_K_LANDSCAPE);
    renderWith();
    await pickFiles([createFile('a.jpg', 'image/jpeg'), createFile('4k.mp4', 'video/mp4')]);
    await screen.findByText('Vídeo acima do limite do Instagram');
    await waitFor(() => expect(uploadPostMediaMock).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Enviando…')).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalledWith('Upload concluído');

    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(screen.getByText('Adicionar')).toBeInTheDocument());
    expect(uploadPostMediaMock).toHaveBeenCalledTimes(1);
    expect(ds.downscaleVideo).not.toHaveBeenCalled();
    expect(
      vi.mocked(toast.success).mock.calls.filter((c) => c[0] === 'Upload concluído'),
    ).toHaveLength(1);
  });

  it('a failed conversion warns and uploads the original', async () => {
    ds.probes.set('4k.mp4', FOUR_K);
    ds.downscaleVideo.mockRejectedValue(new Error('boom'));
    renderWith();
    const original = createFile('4k.mp4', 'video/mp4');
    await pickFiles([original]);
    fireEvent.click(await reduceButton());
    await waitFor(() => expect(uploadPostMediaMock).toHaveBeenCalledTimes(1));
    expect(uploadPostMediaMock.mock.calls[0][0].file).toBe(original);
    expect(toast.error).toHaveBeenCalledWith(
      '4k.mp4: não foi possível reduzir o vídeo. Enviamos o original.',
    );
    expect(ds.captureEvent).toHaveBeenCalledWith(
      'video_downscaled',
      expect.objectContaining({ source: 'upload', outcome: 'error' }),
    );
  });

  it('a probe that fails uploads as today, without the offer', async () => {
    ds.probes.set('4k.mp4', null);
    renderWith();
    await pickFiles([createFile('4k.mp4', 'video/mp4')]);
    await waitFor(() => expect(uploadPostMediaMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Vídeo acima do limite do Instagram')).not.toBeInTheDocument();
  });

  it('a 4K video joining an existing image (carousel) is not offered', async () => {
    ds.probes.set('4k.mp4', FOUR_K);
    vi.mocked(listPostMedia).mockResolvedValue(makeMedia(1));
    renderWith();
    await screen.findByText('img0.jpg');
    await pickFiles([createFile('4k.mp4', 'video/mp4')]);
    await waitFor(() => expect(uploadPostMediaMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Vídeo acima do limite do Instagram')).not.toBeInTheDocument();
  });

  it('a post that does not target Instagram is not offered', async () => {
    ds.probes.set('4k.mp4', FOUR_K);
    renderWith({ targetsInstagram: false });
    await pickFiles([createFile('4k.mp4', 'video/mp4')]);
    await waitFor(() => expect(uploadPostMediaMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Vídeo acima do limite do Instagram')).not.toBeInTheDocument();
  });

  it('an over-2 GB video the browser cannot reduce is neither converted nor uploaded', async () => {
    ds.probes.set('huge.mp4', FOUR_K_LANDSCAPE);
    ds.inspectForDownscale.mockResolvedValue({ engine: 'none', hdr: false });
    renderWith();
    await pickFiles([createFile('a.jpg', 'image/jpeg'), bigFile('huge.mp4', 3 * GB)]);
    await waitFor(() => expect(uploadPostMediaMock).toHaveBeenCalledTimes(1));
    // Reduzir is disabled (no engine) and Enviar original too (over 2 GB): only closing is left.
    expect(await screen.findByRole('button', { name: 'Enviar original' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    await waitFor(() => expect(screen.getByText('Adicionar')).toBeInTheDocument());
    expect(ds.downscaleVideo).not.toHaveBeenCalled();
    expect(uploadPostMediaMock).toHaveBeenCalledTimes(1);
    expect(uploadPostMediaMock.mock.calls[0][0].file.name).toBe('a.jpg');
  });

  it('an over-2 GB video too long to fit the budget is skipped with an error, no dialog', async () => {
    ds.probes.set('longo.mp4', FOUR_K);
    ds.planNull = true;
    renderWith();
    await pickFiles([bigFile('longo.mp4', 3 * GB)]);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('longo.mp4: não foi possível reduzir o vídeo.'),
    );
    expect(screen.queryByText('Vídeo acima do limite do Instagram')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Adicionar')).toBeInTheDocument());
    expect(uploadPostMediaMock).not.toHaveBeenCalled();
    expect(ds.downscaleVideo).not.toHaveBeenCalled();
  });

  it('a converted file whose thumbnail cannot be extracted goes to the manual-thumbnail flow', async () => {
    ds.probes.set('4k.mp4', FOUR_K);
    extractVideoFrameMock.mockRejectedValue(new Error('decode failed'));
    renderWith();
    await pickFiles([createFile('4k.mp4', 'video/mp4')]);
    fireEvent.click(await reduceButton());
    expect(await screen.findByText('4k (1080p).mp4')).toBeInTheDocument();
    expect(screen.getByText('Escolher thumbnail')).toBeInTheDocument();
    expect(uploadPostMediaMock).not.toHaveBeenCalled();
  });

  it('reports "Upload concluído" once, after the held-back file finished', async () => {
    ds.probes.set('4k.mp4', FOUR_K_LANDSCAPE);
    renderWith();
    await pickFiles([createFile('a.jpg', 'image/jpeg'), createFile('4k.mp4', 'video/mp4')]);
    await waitFor(() => expect(uploadPostMediaMock).toHaveBeenCalledTimes(1));
    expect(toast.success).not.toHaveBeenCalledWith('Upload concluído');
    fireEvent.click(await reduceButton());
    await waitFor(() => expect(uploadPostMediaMock).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        vi.mocked(toast.success).mock.calls.filter((c) => c[0] === 'Upload concluído'),
      ).toHaveLength(1),
    );
  });
});

describe('PostMediaGallery warning box: oversized existing video', () => {
  const video4k = {
    id: 60,
    post_id: 42,
    kind: 'video',
    mime_type: 'video/mp4',
    original_filename: 'uhd.mp4',
    url: 'https://example.test/uhd.mp4',
    thumbnail_url: 'https://example.test/uhd.jpg',
    width: 2160,
    height: 3840,
    size_bytes: 1024,
    duration_seconds: 30,
    is_cover: true,
  } as PostMedia;

  it('offers "Reduzir resolução" with the width reason and opens the downscale dialog', async () => {
    vi.mocked(listPostMedia).mockResolvedValue([video4k]);
    renderGallery();
    const btn = await screen.findByRole('button', { name: 'Reduzir resolução de uhd.mp4' });
    expect(
      screen.getByText('Largura acima de 1920 px (ex.: 4K). O Instagram não aceita.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ajustar proporção de uhd.mp4' })).toBeNull();
    fireEvent.click(btn);
    expect(await screen.findByTestId('downscale-media-dialog')).toHaveTextContent('uhd.mp4');
  });

  it('keeps "Ajustar proporção" for a 9:16 4K video inside a carousel', async () => {
    vi.mocked(listPostMedia).mockResolvedValue([video4k, { ...makeMedia(2)[1], height: 1350 }]);
    renderGallery();
    expect(
      await screen.findByRole('button', { name: 'Ajustar proporção de uhd.mp4' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reduzir resolução de uhd.mp4' })).toBeNull();
  });
});

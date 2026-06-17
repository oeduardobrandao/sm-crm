import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    setPostMediaCover: vi.fn(),
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

import { uploadPostMedia } from '../../../../services/postMedia';
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

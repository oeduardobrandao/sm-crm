import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HubPost } from '../../../types';

const download = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('../../../lib/geralDownload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/geralDownload')>()),
  downloadGeralContent: download,
}));

import { PostDownloadButton } from '../PostDownloadButton';

const withMedia = {
  id: 7,
  titulo: 'Reel',
  status: 'enviado_cliente',
  targets: ['instagram'],
  media: [{ id: 1, kind: 'video', mime_type: 'video/mp4', url: 'https://cdn/v.mp4' }],
} as unknown as HubPost;

function click() {
  fireEvent.click(screen.getByRole('button', { name: 'Baixar mídia da postagem' }));
  return waitFor(() =>
    expect(screen.getByRole('button', { name: 'Baixar mídia da postagem' })).toBeEnabled(),
  );
}

describe('PostDownloadButton', () => {
  beforeEach(() => {
    download.mockReset();
    toastMock.mockReset();
    toastMock.error.mockReset();
  });

  it('renders nothing when the post has no downloadable media', () => {
    const { container } = render(
      <PostDownloadButton
        post={{ ...withMedia, media: [{ ...withMedia.media![0], url: null }] } as HubPost}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('downloads quietly when it worked', async () => {
    download.mockResolvedValueOnce('saved');
    render(<PostDownloadButton post={withMedia} />);
    await click();
    expect(download).toHaveBeenCalledWith(withMedia, expect.any(Function));
    expect(toastMock).not.toHaveBeenCalled();
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('asks for another tap when the share sheet could not open', async () => {
    download.mockResolvedValueOnce('pending');
    render(<PostDownloadButton post={withMedia} />);
    await click();
    expect(toastMock).toHaveBeenCalledWith(expect.stringMatching(/toque em baixar de novo/i));
  });

  it('shows an error toast when the download fails', async () => {
    download.mockRejectedValueOnce(new Error('HTTP 403'));
    render(<PostDownloadButton post={withMedia} />);
    await click();
    expect(toastMock.error).toHaveBeenCalled();
  });

  it('shows the percentage while the size is known and the label again when done', async () => {
    let finish!: (outcome: string) => void;
    download.mockImplementationOnce((_post: HubPost, onProgress: (f: number | null) => void) => {
      onProgress(null);
      onProgress(0.42);
      return new Promise((resolve) => (finish = resolve));
    });
    render(<PostDownloadButton post={withMedia} />);
    fireEvent.click(screen.getByRole('button', { name: 'Baixar mídia da postagem' }));
    expect(await screen.findByText('42%')).toBeInTheDocument();
    finish('saved');
    await waitFor(() => expect(screen.getByText('Baixar')).toBeInTheDocument());
    expect(screen.queryByText('42%')).not.toBeInTheDocument();
  });
});

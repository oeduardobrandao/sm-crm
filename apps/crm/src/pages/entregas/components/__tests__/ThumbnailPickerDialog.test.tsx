import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  captureFrameFromElement: vi.fn(),
  encodeImageAsJpeg: vi.fn(),
  updateVideoThumbnail: vi.fn(),
}));
vi.mock('@mesaas/ui/video/frame', () => ({ captureFrameFromElement: m.captureFrameFromElement }));
vi.mock('../../../../utils/imageJpeg', () => ({ encodeImageAsJpeg: m.encodeImageAsJpeg }));
vi.mock('../../../../services/postMedia', () => ({ updateVideoThumbnail: m.updateVideoThumbnail }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ThumbnailPickerDialog } from '../ThumbnailPickerDialog';
import type { PostMedia } from '../../../../store';

function makeVideoMedia(overrides: Partial<PostMedia> = {}): PostMedia {
  return {
    id: 1,
    post_id: 1,
    conta_id: 'c',
    r2_key: 'video/1.mp4',
    thumbnail_r2_key: null,
    kind: 'video',
    mime_type: 'video/mp4',
    size_bytes: 10_000,
    original_filename: 'video.mp4',
    width: 1080,
    height: 1920,
    duration_seconds: 12,
    is_cover: false,
    sort_order: 0,
    uploaded_by: null,
    created_at: '2026-01-01T00:00:00Z',
    url: 'https://media.test/video/1.mp4',
    thumbnail_url: 'https://media.test/video/1-thumb.jpg',
    ...overrides,
  };
}

describe('ThumbnailPickerDialog', () => {
  it('shows the unavailable placeholder instead of the video element for a permanently lost video', () => {
    render(
      <ThumbnailPickerDialog
        media={makeVideoMedia({ url: null, media_lost_at: '2026-08-14T03:00:00.000Z' })}
        onClose={vi.fn()}
        onUpdated={vi.fn()}
      />,
    );
    expect(screen.getByText('Mídia indisponível')).toBeInTheDocument();
    expect(document.querySelector('video')).not.toBeInTheDocument();
  });
});

describe('ThumbnailPickerDialog — frame for the TikTok cover', () => {
  const captured = new File(['c'], 'thumb.jpg', { type: 'image/jpeg' });
  const uploaded = new File(['u'], 'cover.jpg', { type: 'image/jpeg' });

  beforeEach(() => {
    vi.clearAllMocks();
    m.captureFrameFromElement.mockResolvedValue(captured);
    m.encodeImageAsJpeg.mockResolvedValue(uploaded);
    m.updateVideoThumbnail.mockResolvedValue({});
    // jsdom has no object URLs; the dialog only uses them for the preview <img>.
    URL.createObjectURL = vi.fn(() => 'blob:preview');
    URL.revokeObjectURL = vi.fn();
  });

  function renderDialog() {
    const onUpdated = vi.fn();
    render(
      <ThumbnailPickerDialog
        media={makeVideoMedia({ id: 3 })}
        onClose={vi.fn()}
        onUpdated={onUpdated}
      />,
    );
    return { onUpdated };
  }

  it('"Usar este frame" saves the paused moment as the frame', async () => {
    const { onUpdated } = renderDialog();
    const video = document.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      value: 12.3456,
      writable: true,
    });
    video.pause = vi.fn();

    fireEvent.click(screen.getByRole('button', { name: 'Usar este frame' }));
    await screen.findByAltText('Nova miniatura');
    fireEvent.click(screen.getByRole('button', { name: 'Salvar miniatura' }));

    await waitFor(() => expect(onUpdated).toHaveBeenCalled());
    expect(m.updateVideoThumbnail).toHaveBeenCalledWith(3, captured, 12346);
  });

  it('"Enviar imagem" saves no frame (TikTok will use its default)', async () => {
    const { onUpdated } = renderDialog();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [uploaded] } });
    await screen.findByAltText('Nova miniatura');
    fireEvent.click(screen.getByRole('button', { name: 'Salvar miniatura' }));

    await waitFor(() => expect(onUpdated).toHaveBeenCalled());
    expect(m.updateVideoThumbnail).toHaveBeenCalledWith(3, uploaded, null);
  });

  it('a capture after an upload switches back to a frame', async () => {
    const { onUpdated } = renderDialog();
    const video = document.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 2, writable: true });
    video.pause = vi.fn();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [uploaded] } });
    await screen.findByAltText('Nova miniatura');
    fireEvent.click(screen.getByRole('button', { name: 'Usar este frame' }));
    await waitFor(() => expect(m.captureFrameFromElement).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Salvar miniatura' }));

    await waitFor(() => expect(onUpdated).toHaveBeenCalled());
    expect(m.updateVideoThumbnail).toHaveBeenCalledWith(3, captured, 2000);
  });
});

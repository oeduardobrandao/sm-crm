import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock('@/utils/downloadMedia', () => ({ downloadMedia: vi.fn(async () => undefined) }));

import { toast } from 'sonner';
import { downloadMedia } from '@/utils/downloadMedia';
import type { PostMedia } from '../../../../store';
import { PostMediaLightbox } from '../PostMediaLightbox';

const downloadMediaMock = vi.mocked(downloadMedia);

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
    url: `https://media.test/img/${i}.jpg`,
  })) as PostMedia[];
}

function renderLightbox(media: PostMedia[], initialIndex = 0) {
  return render(
    <PostMediaLightbox media={media} initialIndex={initialIndex} open onOpenChange={() => {}} />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PostMediaLightbox download', () => {
  it('downloads the slide on screen, not the first one', async () => {
    renderLightbox(makeMedia(3), 2);

    fireEvent.click(screen.getByLabelText('Baixar'));

    await waitFor(() =>
      expect(downloadMediaMock).toHaveBeenCalledWith(
        expect.objectContaining({ original_filename: 'img2.jpg' }),
      ),
    );
  });

  it('follows navigation to the newly shown slide', async () => {
    renderLightbox(makeMedia(3), 0);

    fireEvent.click(screen.getByLabelText('Próximo'));
    fireEvent.click(screen.getByLabelText('Baixar'));

    await waitFor(() =>
      expect(downloadMediaMock).toHaveBeenCalledWith(
        expect.objectContaining({ original_filename: 'img1.jpg' }),
      ),
    );
  });

  // The button used to require an onDownloadAll prop, so callers that didn't pass one
  // (ArquivosPage) had no way to download at all.
  it('offers the button without any caller wiring', () => {
    renderLightbox(makeMedia(1));

    expect(screen.getByLabelText('Baixar')).toBeInTheDocument();
  });

  it('surfaces a failed download instead of failing silently', async () => {
    downloadMediaMock.mockRejectedValueOnce(new Error('boom'));
    renderLightbox(makeMedia(1));

    fireEvent.click(screen.getByLabelText('Baixar'));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });
});

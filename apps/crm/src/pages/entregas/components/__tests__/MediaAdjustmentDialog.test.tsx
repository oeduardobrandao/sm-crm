import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MediaAdjustmentDialog } from '../MediaAdjustmentDialog';
import { replacePostMedia } from '@/services/mediaAdjustment';
import type { PostMedia } from '@/store';

vi.mock('@/services/mediaAdjustment', () => ({ replacePostMedia: vi.fn() }));
vi.mock('@/services/postMedia', () => ({
  probeImage: vi.fn(async () => ({ width: 1080, height: 1440 })),
  probeVideo: vi.fn(),
}));
vi.mock('../../media-editor/render', () => ({
  drawAdjustment: vi.fn(),
  adjustedFilename: () => 'adjusted.jpg',
  jpegFromCanvas: vi.fn(async () => new File(['jpeg'], 'adjusted.jpg', { type: 'image/jpeg' })),
}));

const media = {
  id: 1,
  post_id: 42,
  kind: 'image',
  original_filename: 'photo.jpg',
  url: null,
  width: 1080,
  height: 1440,
} as PostMedia;

describe('MediaAdjustmentDialog', () => {
  it('shows all agreed feed ratios and black apply action', () => {
    render(
      <MediaAdjustmentDialog
        media={media}
        forStories={false}
        onClose={vi.fn()}
        onUpdated={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /3:4/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /1,91:1/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aplicar ajuste' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Aplicar ajuste' }).className).toContain(
      'bg-[#12151a]',
    );
  });
  it('offers background controls only for fit, and reset returns to crop', () => {
    render(
      <MediaAdjustmentDialog
        media={media}
        forStories={false}
        onClose={vi.fn()}
        onUpdated={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Encaixar' }));
    expect(screen.getByRole('button', { name: 'Desfocado' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Redefinir' }));
    expect(screen.queryByRole('button', { name: 'Desfocado' })).not.toBeInTheDocument();
  });
  it('uses the Story video size and duration independently of Reels', () => {
    render(
      <MediaAdjustmentDialog
        media={{ ...media, kind: 'video' }}
        forStories
        onClose={vi.fn()}
        onUpdated={vi.fn()}
      />,
    );
    expect(screen.getByText(/100 MB/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /9:16/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /3:4/ })).not.toBeInTheDocument();
  });
});

async function loadEditableImage(onClose = vi.fn(), onUpdated = vi.fn()) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob(['source'], { type: 'image/jpeg' }),
    })),
  );
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    {} as CanvasRenderingContext2D,
  );
  const view = render(
    <MediaAdjustmentDialog
      media={{ ...media, url: 'https://example.test/image.jpg' }}
      forStories={false}
      onClose={onClose}
      onUpdated={onUpdated}
    />,
  );
  await waitFor(() => expect(document.querySelector('img[src="blob:preview"]')).toBeTruthy());
  const image = document.querySelector('img[src="blob:preview"]')!;
  Object.defineProperties(image, { naturalWidth: { value: 1080 }, naturalHeight: { value: 1920 } });
  fireEvent.load(image);
  return { ...view, onClose, onUpdated };
}

it('closes and refreshes only after the adjusted file is saved', async () => {
  vi.mocked(replacePostMedia).mockResolvedValue(undefined);
  const { onClose, onUpdated } = await loadEditableImage();
  fireEvent.click(screen.getByRole('button', { name: 'Aplicar ajuste' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(onUpdated).toHaveBeenCalledOnce();
  expect(vi.mocked(replacePostMedia).mock.calls.at(-1)?.[1].type).toBe('image/jpeg');
});

it('keeps the editor open and offers another attempt when saving fails', async () => {
  vi.mocked(replacePostMedia).mockRejectedValue(new Error('Falha ao salvar'));
  const { onClose } = await loadEditableImage();
  fireEvent.click(screen.getByRole('button', { name: 'Aplicar ajuste' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Falha ao salvar');
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Aplicar ajuste' })).toBeEnabled();
});

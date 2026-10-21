import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReferenceItem } from '@/store/postReferences';
import { ReferenceViewerDialog, VIDEO_PLAYBACK_ERROR } from '../references/ReferenceViewerDialog';

const base: ReferenceItem = {
  id: 1,
  kind: 'file',
  file_kind: 'image',
  name: 'foto-praia.jpg',
  mime_type: 'image/jpeg',
  size_bytes: 1000,
  duration_seconds: null,
  width: null,
  height: null,
  url: 'https://r2.example.com/full.jpg',
  thumbnail_url: 'https://r2.example.com/thumb.webp',
  blur_data_url: null,
  download_url: 'https://r2.example.com/full.jpg?download=1',
  link_url: null,
  link_title: null,
  link_domain: null,
  note: 'Usar esta',
  post_approval_id: null,
  created_at: '2026-10-08T12:00:00.000Z',
  can_remove: false,
};
const video: ReferenceItem = {
  ...base,
  id: 2,
  file_kind: 'video',
  name: 'clip.mov',
  mime_type: 'video/quicktime',
  url: 'https://r2.example.com/clip.mov',
  download_url: 'https://r2.example.com/clip.mov?download=1',
};

describe('ReferenceViewerDialog', () => {
  it('renders nothing without an item', () => {
    render(<ReferenceViewerDialog item={null} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows an image with its note and a download link', async () => {
    render(<ReferenceViewerDialog item={base} onClose={vi.fn()} />);
    const dialog = await screen.findByRole('dialog', { name: 'foto-praia.jpg' });
    expect(within(dialog).getByRole('img', { name: 'foto-praia.jpg' })).toHaveAttribute(
      'src',
      'https://r2.example.com/full.jpg',
    );
    expect(within(dialog).getByText('Usar esta')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Baixar' })).toHaveAttribute(
      'href',
      'https://r2.example.com/full.jpg?download=1',
    );
  });

  it('plays a video inline with metadata preload', async () => {
    render(<ReferenceViewerDialog item={video} onClose={vi.fn()} />);
    const el = await screen.findByTestId('reference-viewer-video');
    expect(el).toHaveAttribute('src', 'https://r2.example.com/clip.mov');
    expect(el).toHaveAttribute('controls');
    expect(el).toHaveAttribute('playsinline');
    expect(el).toHaveAttribute('preload', 'metadata');
  });

  it('falls back to the download hint when the browser cannot play the video', async () => {
    render(<ReferenceViewerDialog item={video} onClose={vi.fn()} />);
    fireEvent.error(await screen.findByTestId('reference-viewer-video'));
    expect(screen.getByRole('alert')).toHaveTextContent(VIDEO_PLAYBACK_ERROR);
    expect(VIDEO_PLAYBACK_ERROR).toBe('Não foi possível reproduzir aqui. Baixe o arquivo.');
    expect(screen.queryByTestId('reference-viewer-video')).toBeNull();
    expect(screen.getByRole('link', { name: 'Baixar' })).toBeInTheDocument();
  });

  it('calls onClose when dismissed', async () => {
    const onClose = vi.fn();
    render(<ReferenceViewerDialog item={base} onClose={onClose} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});

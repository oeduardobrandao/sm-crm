import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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

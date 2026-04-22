import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PostMediaLightbox } from '../PostMediaLightbox';
import type { HubPostMedia } from '../../types';

function makeMedia(overrides: Partial<HubPostMedia> = {}): HubPostMedia {
  return {
    id: 1,
    post_id: 7,
    kind: 'image',
    mime_type: 'image/jpeg',
    url: 'https://cdn.example.com/image-1.jpg',
    thumbnail_url: null,
    width: 1080,
    height: 1350,
    duration_seconds: null,
    is_cover: false,
    sort_order: 0,
    ...overrides,
  };
}

describe('PostMediaLightbox', () => {
  it('navigates with buttons and keyboard, updates the counter, and supports all close controls', () => {
    const onClose = vi.fn();
    const media = [
      makeMedia({ id: 1, url: 'https://cdn.example.com/image-1.jpg' }),
      makeMedia({ id: 2, url: 'https://cdn.example.com/image-2.jpg' }),
      makeMedia({ id: 3, url: 'https://cdn.example.com/image-3.jpg' }),
    ];

    render(
      <PostMediaLightbox media={media} initialIndex={1} onClose={onClose} />,
    );

    expect(document.body.querySelector('img')).toHaveAttribute('src', 'https://cdn.example.com/image-2.jpg');
    expect(screen.getByText('2 / 3')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }));

    expect(document.body.querySelector('img')).toHaveAttribute('src', 'https://cdn.example.com/image-3.jpg');
    expect(screen.getByText('3 / 3')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'ArrowRight' });

    expect(document.body.querySelector('img')).toHaveAttribute('src', 'https://cdn.example.com/image-1.jpg');
    expect(screen.getByText('1 / 3')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'ArrowLeft' });

    expect(document.body.querySelector('img')).toHaveAttribute('src', 'https://cdn.example.com/image-3.jpg');
    expect(screen.getByText('3 / 3')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('dialog'));
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('changes media on horizontal swipes and ignores vertical-dominant gestures', () => {
    const media = [
      makeMedia({ id: 1, url: 'https://cdn.example.com/image-1.jpg' }),
      makeMedia({ id: 2, url: 'https://cdn.example.com/image-2.jpg' }),
    ];

    render(
      <PostMediaLightbox media={media} initialIndex={0} onClose={vi.fn()} />,
    );

    const dialog = screen.getByRole('dialog');

    expect(document.body.querySelector('img')).toHaveAttribute('src', 'https://cdn.example.com/image-1.jpg');

    fireEvent.touchStart(dialog, {
      touches: [{ clientX: 220, clientY: 120 }],
    });
    fireEvent.touchEnd(dialog, {
      changedTouches: [{ clientX: 120, clientY: 110 }],
    });

    expect(document.body.querySelector('img')).toHaveAttribute('src', 'https://cdn.example.com/image-2.jpg');

    fireEvent.touchStart(dialog, {
      touches: [{ clientX: 220, clientY: 120 }],
    });
    fireEvent.touchEnd(dialog, {
      changedTouches: [{ clientX: 140, clientY: 260 }],
    });

    expect(document.body.querySelector('img')).toHaveAttribute('src', 'https://cdn.example.com/image-2.jpg');

    fireEvent.touchStart(dialog, {
      touches: [{ clientX: 120, clientY: 120 }],
    });
    fireEvent.touchEnd(dialog, {
      changedTouches: [{ clientX: 210, clientY: 130 }],
    });

    expect(document.body.querySelector('img')).toHaveAttribute('src', 'https://cdn.example.com/image-1.jpg');
  });

  it('calls the stale URL callback when image and video media fail to load', () => {
    const onStaleUrl = vi.fn();
    const onClose = vi.fn();

    const { rerender } = render(
      <PostMediaLightbox
        media={[makeMedia({ id: 1, url: 'https://cdn.example.com/image-1.jpg' })]}
        initialIndex={0}
        onClose={onClose}
        onStaleUrl={onStaleUrl}
      />,
    );

    const image = document.body.querySelector('img');

    if (!image) {
      throw new Error('Image media was not rendered');
    }

    fireEvent.error(image);

    rerender(
      <PostMediaLightbox
        media={[
          makeMedia({
            id: 2,
            kind: 'video',
            mime_type: 'video/mp4',
            url: 'https://cdn.example.com/video.mp4',
            thumbnail_url: 'https://cdn.example.com/video-thumb.jpg',
          }),
        ]}
        initialIndex={0}
        onClose={onClose}
        onStaleUrl={onStaleUrl}
      />,
    );

    const video = document.body.querySelector('video');

    if (!video) {
      throw new Error('Video media was not rendered');
    }

    fireEvent.error(video);

    expect(onStaleUrl).toHaveBeenCalledTimes(2);
  });
});

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InstagramGrid } from '../index';
import type { GridItem } from '../types';

function makeItem(overrides: Partial<GridItem> = {}): GridItem {
  return {
    source: 'hub',
    mobility: 'movable',
    id: 'hub-1',
    postId: 1,
    status: 'agendado',
    thumbnailUrl: 'https://cdn.example.com/cover.jpg',
    videoUrl: null,
    mediaType: 'IMAGE',
    isCarousel: false,
    scheduledAt: '2026-08-20T10:00:00.000Z',
    sortTs: '2026-08-20T10:00:00.000Z',
    ...overrides,
  };
}

describe('InstagramGrid', () => {
  it('renders the neutral placeholder tile instead of a broken image when a tile has no thumbnail or video URL', () => {
    const { container } = render(
      <InstagramGrid
        items={[makeItem({ thumbnailUrl: null, videoUrl: null })]}
        onReorder={async () => {}}
      />,
    );
    expect(container.querySelector('img')).not.toBeInTheDocument();
    expect(container.querySelector('[data-grid-placeholder]')).toBeInTheDocument();
  });
});

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PostGrid } from '../PostGrid';
import type { HubPost, HubPostMedia } from '../../../types';

const MEDIA: HubPostMedia = {
  id: 1,
  post_id: 1,
  kind: 'image',
  mime_type: 'image/jpeg',
  url: 'https://cdn/a.jpg',
  thumbnail_url: null,
  width: 1080,
  height: 1350,
  duration_seconds: null,
  is_cover: false,
  sort_order: 0,
};

function post(over: Partial<HubPost>): HubPost {
  return {
    id: 1,
    titulo: 'Post',
    tipo: 'feed',
    status: 'enviado_cliente',
    ordem: 1,
    conteudo: null,
    conteudo_plain: 'texto',
    scheduled_at: null,
    ig_caption: null,
    instagram_permalink: null,
    published_at: null,
    publish_error: null,
    workflow_id: null,
    workflow_titulo: null,
    workflow_created_at: null,
    media: [MEDIA],
    cover_media: null,
    pending_suggestion: null,
    suggestion_rejected_at: null,
    ...over,
  };
}

describe('PostGrid', () => {
  const posts = [
    post({ id: 1, titulo: 'Feed A' }),
    post({ id: 2, titulo: 'Story B', tipo: 'stories' }),
    post({ id: 3, titulo: 'Texto C', media: [] }),
  ];

  it('puts stories in the rail and everything else in the grid, in order', () => {
    render(
      <PostGrid
        posts={posts}
        mode="browse"
        selectedIds={new Set()}
        onOpen={vi.fn()}
        onToggle={vi.fn()}
      />,
    );
    const rail = screen.getByRole('list', { name: 'Stories' });
    expect(rail).toHaveTextContent('Story B');
    const tiles = screen.getAllByRole('button', { name: /^Abrir / });
    expect(tiles.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Abrir Feed A',
      'Abrir Texto C',
    ]);
  });

  it('omits the rail when there are no stories', () => {
    render(
      <PostGrid
        posts={[posts[0]]}
        mode="browse"
        selectedIds={new Set()}
        onOpen={vi.fn()}
        onToggle={vi.fn()}
      />,
    );
    expect(screen.queryByRole('list', { name: 'Stories' })).not.toBeInTheDocument();
  });

  it('opens a story from the rail', () => {
    const onOpen = vi.fn();
    render(
      <PostGrid
        posts={posts}
        mode="browse"
        selectedIds={new Set()}
        onOpen={onOpen}
        onToggle={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ver story Story B' }));
    expect(onOpen).toHaveBeenCalledWith(2);
  });

  it('in select mode only the media tile is a checkbox and the rail is inert', () => {
    render(
      <PostGrid
        posts={posts}
        mode="select"
        selectedIds={new Set([1])}
        onOpen={vi.fn()}
        onToggle={vi.fn()}
      />,
    );
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: 'Ver story Story B' })).toBeDisabled();
  });
});

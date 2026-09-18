import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { isFeedSelectable, PostTile } from '../PostTile';
import type { HubPost, HubPostMedia } from '../../../types';

function media(over: Partial<HubPostMedia> = {}): HubPostMedia {
  return {
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
    ...over,
  };
}

function post(over: Partial<HubPost> = {}): HubPost {
  return {
    id: 7,
    titulo: 'Coleção de inverno',
    tipo: 'carrossel',
    status: 'enviado_cliente',
    ordem: 1,
    conteudo: null,
    conteudo_plain: 'Segunda-feira é dia de começar com tudo!',
    scheduled_at: '2026-04-28T10:00:00.000Z',
    ig_caption: null,
    instagram_permalink: null,
    published_at: null,
    publish_error: null,
    workflow_id: null,
    workflow_titulo: null,
    workflow_created_at: null,
    media: [media({ id: 1 }), media({ id: 2 })],
    cover_media: null,
    pending_suggestion: null,
    suggestion_rejected_at: null,
    ...over,
  };
}

const noop = vi.fn();

describe('PostTile', () => {
  it('uses cover_media over media[0] and opens on click', () => {
    const onOpen = vi.fn();
    render(
      <PostTile
        post={post({ cover_media: media({ id: 9, url: 'https://cdn/cover.jpg' }) })}
        mode="browse"
        selected={false}
        onOpen={onOpen}
        onToggle={noop}
      />,
    );
    const img = screen.getByRole('img', { hidden: true });
    expect(img).toHaveAttribute('src', 'https://cdn/cover.jpg');
    fireEvent.click(screen.getByRole('button', { name: /Abrir Coleção de inverno/ }));
    expect(onOpen).toHaveBeenCalledWith(7);
    expect(screen.getByText('Aguardando aprovação')).toBeInTheDocument();
  });

  it('uses thumbnail_url for a video cover', () => {
    render(
      <PostTile
        post={post({
          tipo: 'reels',
          media: [
            media({ kind: 'video', url: 'https://cdn/v.mp4', thumbnail_url: 'https://cdn/t.jpg' }),
          ],
        })}
        mode="browse"
        selected={false}
        onOpen={noop}
        onToggle={noop}
      />,
    );
    expect(screen.getByRole('img', { hidden: true })).toHaveAttribute('src', 'https://cdn/t.jpg');
  });

  it('renders a text tile with title and excerpt when there is no media', () => {
    render(
      <PostTile
        post={post({ media: [] })}
        mode="browse"
        selected={false}
        onOpen={noop}
        onToggle={noop}
      />,
    );
    expect(screen.getByText('Coleção de inverno')).toBeInTheDocument();
    expect(screen.getByText(/Segunda-feira é dia/)).toBeInTheDocument();
    expect(screen.queryByRole('img', { hidden: true })).not.toBeInTheDocument();
  });

  it('renders the "Mídia removida" tile for an autocleaned post', () => {
    render(
      <PostTile
        post={post({ media: [], status: 'postado', media_autocleaned_at: '2026-08-05T05:30:00Z' })}
        mode="browse"
        selected={false}
        onOpen={noop}
        onToggle={noop}
      />,
    );
    expect(screen.getByText('Mídia removida')).toBeInTheDocument();
  });

  it('renders MediaUnavailable when the cover was lost', () => {
    render(
      <PostTile
        post={post({ media: [media({ media_lost_at: '2026-08-01T00:00:00Z' })] })}
        mode="browse"
        selected={false}
        onOpen={noop}
        onToggle={noop}
      />,
    );
    expect(screen.getByText('Mídia indisponível')).toBeInTheDocument();
  });

  it('in select mode a media tile is a checkbox that toggles', () => {
    const onToggle = vi.fn();
    const onOpen = vi.fn();
    render(
      <PostTile post={post()} mode="select" selected={false} onOpen={onOpen} onToggle={onToggle} />,
    );
    const cb = screen.getByRole('checkbox');
    expect(cb).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(cb);
    expect(onToggle).toHaveBeenCalledWith(7);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('in select mode a text tile is inert', () => {
    const onToggle = vi.fn();
    render(
      <PostTile
        post={post({ media: [] })}
        mode="select"
        selected={false}
        onOpen={noop}
        onToggle={onToggle}
      />,
    );
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    const btn = screen.getByRole('button', { name: /Abrir/ });
    expect(btn).toBeDisabled();
  });

  it('does not render a type glyph badge for a single-image feed post', () => {
    const { container } = render(
      <PostTile
        post={post({ tipo: 'feed', media: [media({ id: 1 })] })}
        mode="browse"
        selected={false}
        onOpen={noop}
        onToggle={noop}
      />,
    );
    expect(container.querySelector('.bg-black\\/45')).not.toBeInTheDocument();
    expect(container.querySelector('svg.lucide-images')).not.toBeInTheDocument();
    expect(container.querySelector('svg.lucide-play')).not.toBeInTheDocument();
    expect(container.querySelector('svg.lucide-circle')).not.toBeInTheDocument();
  });

  it('renders a type glyph badge for a carrossel post (2+ media)', () => {
    const { container } = render(
      <PostTile post={post()} mode="browse" selected={false} onOpen={noop} onToggle={noop} />,
    );
    expect(container.querySelector('.bg-black\\/45')).toBeInTheDocument();
    expect(container.querySelector('svg.lucide-images')).toBeInTheDocument();
  });

  it('keeps the autoclean external link reachable and separate from the disabled open button', () => {
    const onOpen = vi.fn();
    render(
      <PostTile
        post={post({
          media: [],
          status: 'postado',
          media_autocleaned_at: '2026-08-05T05:30:00Z',
          instagram_permalink: 'https://instagram.com/p/abc',
        })}
        mode="select"
        selected={false}
        onOpen={onOpen}
        onToggle={noop}
      />,
    );
    const openButton = screen.getByRole('button', { name: /Abrir/ });
    expect(openButton).toBeDisabled();
    const link = screen.getByRole('link', { name: /Ver no Instagram/ });
    expect(link).toHaveAttribute('href', 'https://instagram.com/p/abc');
    expect(link.closest('button')).toBeNull();
    fireEvent.click(link);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('falls back to the TikTok link when the autocleaned post has no Instagram permalink', () => {
    render(
      <PostTile
        post={post({
          media: [],
          status: 'postado',
          media_autocleaned_at: '2026-08-05T05:30:00Z',
          instagram_permalink: null,
          tiktok_post_url: 'https://www.tiktok.com/@x/video/1',
        })}
        mode="browse"
        selected={false}
        onOpen={noop}
        onToggle={noop}
      />,
    );
    expect(screen.getByRole('link', { name: /Ver no TikTok/ })).toHaveAttribute(
      'href',
      'https://www.tiktok.com/@x/video/1',
    );
    expect(screen.queryByRole('link', { name: /Ver no Instagram/ })).not.toBeInTheDocument();
  });

  it('renders no autoclean link when the post has neither an Instagram nor a TikTok URL', () => {
    render(
      <PostTile
        post={post({
          media: [],
          status: 'postado',
          media_autocleaned_at: '2026-08-05T05:30:00Z',
          instagram_permalink: null,
          tiktok_post_url: null,
        })}
        mode="browse"
        selected={false}
        onOpen={noop}
        onToggle={noop}
      />,
    );
    expect(screen.getByText('Mídia removida')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('does not render the autoclean link when a cover image is present', () => {
    render(
      <PostTile
        post={post({
          media_autocleaned_at: '2026-08-05T05:30:00Z',
          instagram_permalink: 'https://instagram.com/p/abc',
        })}
        mode="browse"
        selected={false}
        onOpen={noop}
        onToggle={noop}
      />,
    );
    expect(screen.queryByRole('link', { name: /Ver no Instagram/ })).not.toBeInTheDocument();
  });

  it('gives a selected tile the blue selection ring, not the default ring', () => {
    const { container } = render(
      <PostTile post={post()} mode="select" selected={true} onOpen={noop} onToggle={noop} />,
    );
    const tile = container.querySelector('[role="checkbox"]');
    expect(tile).toHaveClass('ring-[3px]', 'ring-[#0095f6]');
    expect(tile).not.toHaveClass('ring-black/5');
  });

  describe('isFeedSelectable', () => {
    it('is false for stories even when media is present', () => {
      expect(isFeedSelectable(post({ tipo: 'stories', media: [media()] }))).toBe(false);
    });
  });
});

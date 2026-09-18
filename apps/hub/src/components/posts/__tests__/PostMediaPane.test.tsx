import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PostMediaPane } from '../PostMediaPane';
import type { HubPost, HubPostMedia } from '../../../types';

function m(id: number, over: Partial<HubPostMedia> = {}): HubPostMedia {
  return {
    id,
    post_id: 1,
    kind: 'image',
    mime_type: 'image/jpeg',
    url: `https://cdn/${id}.jpg`,
    thumbnail_url: null,
    width: 1080,
    height: 1350,
    duration_seconds: null,
    is_cover: false,
    sort_order: id,
    ...over,
  };
}

function post(over: Partial<HubPost> = {}): HubPost {
  return {
    id: 1,
    titulo: 'P',
    tipo: 'carrossel',
    status: 'enviado_cliente',
    ordem: 1,
    conteudo: null,
    conteudo_plain: '',
    scheduled_at: null,
    ig_caption: null,
    instagram_permalink: null,
    published_at: null,
    publish_error: null,
    workflow_id: null,
    workflow_titulo: null,
    workflow_created_at: null,
    media: [m(1), m(2), m(3)],
    cover_media: null,
    pending_suggestion: null,
    suggestion_rejected_at: null,
    ...over,
  };
}

describe('PostMediaPane', () => {
  it('renders every slide and advances with the on-media arrow', () => {
    render(<PostMediaPane post={post()} onOpenLightbox={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: /Abrir mídia/ })).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Slide anterior' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Próximo slide' }));
    expect(screen.getByRole('button', { name: 'Slide anterior' })).toBeInTheDocument();
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
  });

  it('opens the lightbox at the clicked slide', () => {
    const onOpenLightbox = vi.fn();
    render(<PostMediaPane post={post()} onOpenLightbox={onOpenLightbox} />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir mídia 2' }));
    expect(onOpenLightbox).toHaveBeenCalledWith(1);
  });

  it('renders story frames with tap zones', () => {
    render(
      <PostMediaPane
        post={post({ tipo: 'stories', media: [m(1), m(2)] })}
        onOpenLightbox={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Próximo' }));
    expect(screen.getByText('2 / 2')).toBeInTheDocument();
  });

  it('shows MediaUnavailable for a lost file', () => {
    render(
      <PostMediaPane
        post={post({ media: [m(1, { media_lost_at: '2026-08-01T00:00:00Z' })] })}
        onOpenLightbox={vi.fn()}
      />,
    );
    expect(screen.getByText('Mídia indisponível')).toBeInTheDocument();
  });
});

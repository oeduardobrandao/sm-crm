import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InstagramGridPreview } from '../InstagramGridPreview';
import type { HubPost, HubPostMedia, InstagramFeedProfile, InstagramFeedPost } from '../../types';

vi.mock('../../api', () => ({
  fetchInstagramFeed: vi.fn(),
}));

function makeMedia(overrides: Partial<HubPostMedia> = {}): HubPostMedia {
  return {
    id: 1, post_id: 7, kind: 'image', mime_type: 'image/jpeg',
    url: 'https://cdn.example.com/media-1.jpg', thumbnail_url: 'https://cdn.example.com/thumb-1.jpg',
    width: 1080, height: 1350, duration_seconds: null, is_cover: false, sort_order: 0,
    ...overrides,
  };
}

function makePost(overrides: Partial<HubPost> = {}): HubPost {
  return {
    id: 7, titulo: 'Post Teste', tipo: 'feed', status: 'enviado_cliente',
    ordem: 1, conteudo_plain: 'Legenda', scheduled_at: '2026-04-22T10:00:00.000Z',
    workflow_id: 42, workflow_titulo: 'Editorial',
    media: [makeMedia()], cover_media: null,
    ...overrides,
  };
}

const profile: InstagramFeedProfile = {
  username: 'studio_marca',
  profilePictureUrl: 'https://cdn.ig/pic.jpg',
  followerCount: 15300,
  followingCount: 892,
  mediaCount: 42,
};

const livePosts: InstagramFeedPost[] = [
  { id: 'ig-1', thumbnailUrl: 'https://cdn.ig/t1.jpg', mediaType: 'IMAGE', permalink: 'https://ig/p/1', postedAt: '2026-04-20T10:00:00Z', impressions: 5292 },
  { id: 'ig-2', thumbnailUrl: 'https://cdn.ig/t2.jpg', mediaType: 'CAROUSEL_ALBUM', permalink: 'https://ig/p/2', postedAt: '2026-04-18T10:00:00Z', impressions: 4555 },
  { id: 'ig-3', thumbnailUrl: null, mediaType: 'VIDEO', permalink: 'https://ig/p/3', postedAt: '2026-04-16T10:00:00Z', impressions: 1768 },
];

describe('InstagramGridPreview', () => {
  it('renders the profile header with username and stats', () => {
    render(
      <InstagramGridPreview
        selectedPosts={[makePost()]}
        feedProfile={profile}
        livePosts={livePosts}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('studio_marca')).toBeInTheDocument();
    expect(screen.getByText('15.3k')).toBeInTheDocument();
    expect(screen.getByText('892')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('renders pending posts with Novo badge', () => {
    render(
      <InstagramGridPreview
        selectedPosts={[makePost()]}
        feedProfile={profile}
        livePosts={livePosts}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Novo')).toBeInTheDocument();
  });

  it('renders live posts with view counts', () => {
    render(
      <InstagramGridPreview
        selectedPosts={[makePost()]}
        feedProfile={profile}
        livePosts={livePosts}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('5.292')).toBeInTheDocument();
    expect(screen.getByText('4.555')).toBeInTheDocument();
  });

  it('closes when the close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <InstagramGridPreview
        selectedPosts={[makePost()]}
        feedProfile={profile}
        livePosts={livePosts}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByLabelText('Fechar'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape key', () => {
    const onClose = vi.fn();
    render(
      <InstagramGridPreview
        selectedPosts={[makePost()]}
        feedProfile={profile}
        livePosts={livePosts}
        onClose={onClose}
      />,
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows gray placeholder for live posts with null thumbnail', () => {
    const { container } = render(
      <InstagramGridPreview
        selectedPosts={[makePost()]}
        feedProfile={profile}
        livePosts={livePosts}
        onClose={vi.fn()}
      />,
    );

    const placeholders = container.querySelectorAll('[data-grid-placeholder]');
    expect(placeholders.length).toBeGreaterThanOrEqual(1);
  });
});

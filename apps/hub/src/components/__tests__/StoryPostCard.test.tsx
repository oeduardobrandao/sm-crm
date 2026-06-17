import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StoryPostCard } from '../StoryPostCard';
import type { HubPost, HubPostMedia, InstagramProfile } from '../../types';

vi.mock('../../api', () => ({
  submitApproval: vi.fn(),
}));

vi.mock('../PostMediaLightbox', () => ({
  PostMediaLightbox: () => <div data-testid="post-media-lightbox" />,
}));

function makeMedia(overrides: Partial<HubPostMedia> = {}): HubPostMedia {
  return {
    id: 1,
    post_id: 7,
    kind: 'image',
    mime_type: 'image/jpeg',
    url: 'https://cdn.example.com/media-1.jpg',
    thumbnail_url: null,
    width: 1080,
    height: 1920,
    duration_seconds: null,
    is_cover: false,
    sort_order: 0,
    ...overrides,
  };
}

function makePost(overrides: Partial<HubPost> = {}): HubPost {
  return {
    id: 7,
    titulo: 'Story',
    tipo: 'stories',
    status: 'enviado_cliente',
    ordem: 1,
    conteudo_plain: 'Legenda',
    scheduled_at: '2026-04-22T10:00:00.000Z',
    workflow_id: 42,
    workflow_titulo: 'Editorial',
    media: [makeMedia()],
    cover_media: null,
    ...overrides,
  };
}

const profile: InstagramProfile = {
  username: 'studio_marca',
  profilePictureUrl: 'https://cdn.ig/pic.jpg',
};

describe('StoryPostCard', () => {
  it('prewarms the story video so the lightbox opens without stutter', () => {
    const { container } = render(
      <StoryPostCard
        post={makePost({
          media: [
            makeMedia({
              id: 5,
              kind: 'video',
              mime_type: 'video/quicktime',
              url: 'https://cdn.example.com/story.mov',
              thumbnail_url: 'https://cdn.example.com/story-thumb.jpg',
            }),
          ],
        })}
        token="token-publico"
        approvals={[]}
        instagramProfile={profile}
      />,
    );

    // jsdom has no IntersectionObserver, so VideoPrewarm warms immediately.
    expect(container.querySelector('video')).toHaveAttribute(
      'src',
      'https://cdn.example.com/story.mov',
    );
  });

  it('does not prewarm anything for an image-only story', () => {
    const { container } = render(
      <StoryPostCard
        post={makePost()}
        token="token-publico"
        approvals={[]}
        instagramProfile={profile}
      />,
    );

    expect(container.querySelector('video')).toBeNull();
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InstagramGridPreview } from '../InstagramGridPreview';
import { reorderPostSchedules } from '../../api';
import type { HubPost, HubPostMedia, InstagramFeedProfile, InstagramFeedPost } from '../../types';

vi.mock('../../api', () => ({
  fetchInstagramFeed: vi.fn(),
  reorderPostSchedules: vi.fn().mockResolvedValue({ ok: true, updated: 0 }),
}));

const mockedReorder = vi.mocked(reorderPostSchedules);

function makeMedia(overrides: Partial<HubPostMedia> = {}): HubPostMedia {
  return {
    id: 1,
    post_id: 7,
    kind: 'image',
    mime_type: 'image/jpeg',
    url: 'https://cdn.example.com/media-1.jpg',
    thumbnail_url: 'https://cdn.example.com/thumb-1.jpg',
    width: 1080,
    height: 1350,
    duration_seconds: null,
    is_cover: false,
    sort_order: 0,
    ...overrides,
  };
}

function makePost(overrides: Partial<HubPost> = {}): HubPost {
  return {
    id: 7,
    titulo: 'Post Teste',
    tipo: 'feed',
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

const profile: InstagramFeedProfile = {
  username: 'studio_marca',
  profilePictureUrl: 'https://cdn.ig/pic.jpg',
  followerCount: 15300,
  followingCount: 892,
  mediaCount: 42,
};

const livePosts: InstagramFeedPost[] = [
  {
    id: 'ig-1',
    thumbnailUrl: 'https://cdn.ig/t1.jpg',
    mediaType: 'IMAGE',
    permalink: 'https://ig/p/1',
    postedAt: '2026-04-20T10:00:00Z',
    impressions: 5292,
  },
  {
    id: 'ig-2',
    thumbnailUrl: 'https://cdn.ig/t2.jpg',
    mediaType: 'CAROUSEL_ALBUM',
    permalink: 'https://ig/p/2',
    postedAt: '2026-04-18T10:00:00Z',
    impressions: 4555,
  },
  {
    id: 'ig-3',
    thumbnailUrl: null,
    mediaType: 'VIDEO',
    permalink: 'https://ig/p/3',
    postedAt: '2026-04-16T10:00:00Z',
    impressions: 1768,
  },
];

describe('InstagramGridPreview', () => {
  it('renders the profile header with username and stats', () => {
    render(
      <InstagramGridPreview
        selectedPosts={[makePost()]}
        feedProfile={profile}
        livePosts={livePosts}
        token="test-token"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('studio_marca')).toBeInTheDocument();
    expect(screen.getByText('15.3k')).toBeInTheDocument();
    expect(screen.getByText('892')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('renders pending posts with date badge', () => {
    render(
      <InstagramGridPreview
        selectedPosts={[makePost()]}
        feedProfile={profile}
        livePosts={livePosts}
        token="test-token"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('22 de abr.')).toBeInTheDocument();
  });

  it('renders live posts with view counts', () => {
    render(
      <InstagramGridPreview
        selectedPosts={[makePost()]}
        feedProfile={profile}
        livePosts={livePosts}
        token="test-token"
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
        token="test-token"
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
        token="test-token"
        onClose={onClose}
      />,
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows gray placeholder for live posts with null thumbnail', () => {
    render(
      <InstagramGridPreview
        selectedPosts={[makePost()]}
        feedProfile={profile}
        livePosts={livePosts}
        token="test-token"
        onClose={vi.fn()}
      />,
    );

    const placeholders = document.body.querySelectorAll('[data-grid-placeholder]');
    expect(placeholders.length).toBeGreaterThanOrEqual(1);
  });

  it('swaps dates between two movable posts and excludes a published post from the save', async () => {
    mockedReorder.mockClear();
    mockedReorder.mockResolvedValue({ ok: true, updated: 2 } as never);

    const postA = makePost({ id: 1, status: 'enviado_cliente', scheduled_at: '2026-05-02T10:00:00.000Z' });
    const postB = makePost({ id: 2, status: 'enviado_cliente', scheduled_at: '2026-05-01T10:00:00.000Z' });
    const published = makePost({
      id: 3,
      status: 'postado',
      scheduled_at: '2026-04-01T10:00:00.000Z',
      published_at: '2026-04-01T10:00:00.000Z',
      instagram_permalink: 'https://ig/p/own',
    });

    render(
      <InstagramGridPreview
        selectedPosts={[postA, postB, published]}
        feedProfile={profile}
        livePosts={[]}
        token="test-token"
        onClose={vi.fn()}
        onScheduleUpdated={vi.fn()}
      />,
    );

    // Newest-first order: [0]=A (05-02), [1]=B (05-01), [2]=published (04-01).
    const cells = document.body.querySelectorAll('[data-grid-idx]');
    expect(cells[2].getAttribute('draggable')).toBe('false'); // published is fixed
    fireEvent.dragStart(cells[0]);
    fireEvent.dragOver(cells[1]);
    fireEvent.drop(cells[1]);

    const saveBtn = await screen.findByRole('button', { name: /salvar agendamento/i });
    fireEvent.click(saveBtn);

    await waitFor(() => expect(mockedReorder).toHaveBeenCalledTimes(1));
    const updates = mockedReorder.mock.calls[0][1] as { post_id: number; scheduled_at: string | null }[];
    const byId = Object.fromEntries(updates.map((u) => [u.post_id, u.scheduled_at]));
    expect(updates).toHaveLength(2);
    expect(byId[1]).toBe('2026-05-01T10:00:00.000Z'); // post A took B's date
    expect(byId[2]).toBe('2026-05-02T10:00:00.000Z'); // post B took A's date
    expect(byId[3]).toBeUndefined(); // the published post is never rescheduled
  });

  it('keeps the modal dirty and shows the error when the save fails', async () => {
    mockedReorder.mockClear();
    mockedReorder.mockRejectedValue(new Error('Não é possível reagendar posts em publicação.'));

    const postA = makePost({ id: 1, status: 'enviado_cliente', scheduled_at: '2026-05-02T10:00:00.000Z' });
    const postB = makePost({ id: 2, status: 'enviado_cliente', scheduled_at: '2026-05-01T10:00:00.000Z' });

    render(
      <InstagramGridPreview
        selectedPosts={[postA, postB]}
        feedProfile={profile}
        livePosts={[]}
        token="test-token"
        onClose={vi.fn()}
      />,
    );

    const cells = document.body.querySelectorAll('[data-grid-idx]');
    fireEvent.dragStart(cells[0]);
    fireEvent.dragOver(cells[1]);
    fireEvent.drop(cells[1]);

    fireEvent.click(await screen.findByRole('button', { name: /salvar agendamento/i }));

    expect(await screen.findByText(/não é possível reagendar/i)).toBeInTheDocument();
    // Still dirty → the save button remains available for a retry.
    expect(screen.getByRole('button', { name: /salvar agendamento/i })).toBeInTheDocument();
  });
});

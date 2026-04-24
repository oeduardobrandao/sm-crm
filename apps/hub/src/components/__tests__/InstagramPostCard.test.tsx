import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InstagramPostCard } from '../InstagramPostCard';
import { submitApproval } from '../../api';
import type { HubPost, HubPostMedia, InstagramProfile } from '../../types';

const submitApprovalMock = vi.hoisted(() => vi.fn());

vi.mock('../../api', () => ({
  submitApproval: submitApprovalMock,
}));

vi.mock('../PostMediaLightbox', () => ({
  PostMediaLightbox: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="post-media-lightbox">
      <button type="button" onClick={onClose}>Fechar lightbox</button>
    </div>
  ),
}));

const mockedSubmitApproval = vi.mocked(submitApproval);

function makeMedia(overrides: Partial<HubPostMedia> = {}): HubPostMedia {
  return {
    id: 1, post_id: 7, kind: 'image', mime_type: 'image/jpeg',
    url: 'https://cdn.example.com/media-1.jpg', thumbnail_url: null,
    width: 1080, height: 1350, duration_seconds: null, is_cover: false, sort_order: 0,
    ...overrides,
  };
}

function makePost(overrides: Partial<HubPost> = {}): HubPost {
  return {
    id: 7, titulo: 'Campanha de Páscoa', tipo: 'feed', status: 'enviado_cliente',
    ordem: 1, conteudo_plain: 'Legenda principal do post.',
    scheduled_at: '2026-04-22T10:00:00.000Z', workflow_id: 42, workflow_titulo: 'Editorial',
    media: [makeMedia()], cover_media: null,
    ...overrides,
  };
}

const profile: InstagramProfile = {
  username: 'studio_marca',
  profilePictureUrl: 'https://cdn.ig/pic.jpg',
};

describe('InstagramPostCard', () => {
  beforeEach(() => {
    mockedSubmitApproval.mockReset();
  });

  it('renders the Instagram-style header with username and profile picture', () => {
    render(
      <InstagramPostCard
        post={makePost()}
        token="token-publico"
        approvals={[]}
        instagramProfile={profile}
        isSelected={false}
        onToggleSelect={vi.fn()}
        onApprovalSubmitted={vi.fn()}
      />,
    );

    expect(screen.getByText('studio_marca')).toBeInTheDocument();
    expect(screen.getByAltText('studio_marca')).toHaveAttribute('src', 'https://cdn.ig/pic.jpg');
  });

  it('falls back to workspace name when instagramProfile is null', () => {
    render(
      <InstagramPostCard
        post={makePost()}
        token="token-publico"
        approvals={[]}
        instagramProfile={null}
        workspaceName="Mesaas"
        isSelected={false}
        onToggleSelect={vi.fn()}
        onApprovalSubmitted={vi.fn()}
      />,
    );

    expect(screen.getByText('Mesaas')).toBeInTheDocument();
  });

  it('shows carousel dots when post has multiple media items', () => {
    const media = [
      makeMedia({ id: 1, sort_order: 0 }),
      makeMedia({ id: 2, sort_order: 1, url: 'https://cdn.example.com/media-2.jpg' }),
      makeMedia({ id: 3, sort_order: 2, url: 'https://cdn.example.com/media-3.jpg' }),
    ];

    const { container } = render(
      <InstagramPostCard
        post={makePost({ media })}
        token="token-publico"
        approvals={[]}
        instagramProfile={profile}
        isSelected={false}
        onToggleSelect={vi.fn()}
        onApprovalSubmitted={vi.fn()}
      />,
    );

    const dots = container.querySelectorAll('[data-carousel-dot]');
    expect(dots.length).toBe(3);
  });

  it('calls onToggleSelect when the checkbox is clicked', () => {
    const onToggleSelect = vi.fn();

    render(
      <InstagramPostCard
        post={makePost()}
        token="token-publico"
        approvals={[]}
        instagramProfile={profile}
        isSelected={false}
        onToggleSelect={onToggleSelect}
        onApprovalSubmitted={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox'));
    expect(onToggleSelect).toHaveBeenCalledWith(7);
  });

  it('submits an approval when Aprovar is clicked', async () => {
    mockedSubmitApproval.mockResolvedValue({ ok: true } as never);
    const onApprovalSubmitted = vi.fn();

    render(
      <InstagramPostCard
        post={makePost()}
        token="token-publico"
        approvals={[]}
        instagramProfile={profile}
        isSelected={false}
        onToggleSelect={vi.fn()}
        onApprovalSubmitted={onApprovalSubmitted}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Aprovar/i }));

    await waitFor(() => {
      expect(mockedSubmitApproval).toHaveBeenCalledWith('token-publico', 7, 'aprovado', undefined);
    });
    expect(onApprovalSubmitted).toHaveBeenCalledTimes(1);
  });

  it('opens the lightbox when the image is clicked', () => {
    render(
      <InstagramPostCard
        post={makePost()}
        token="token-publico"
        approvals={[]}
        instagramProfile={profile}
        isSelected={false}
        onToggleSelect={vi.fn()}
        onApprovalSubmitted={vi.fn()}
      />,
    );

    const img = screen.getByAltText('');
    fireEvent.click(img);
    expect(screen.getByTestId('post-media-lightbox')).toBeInTheDocument();
  });
});

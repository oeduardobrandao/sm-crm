import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TextPostCard } from '../TextPostCard';
import { submitApproval } from '../../api';
import type { HubPost, PostApproval } from '../../types';

const submitApprovalMock = vi.hoisted(() => vi.fn());

vi.mock('../../api', () => ({
  submitApproval: submitApprovalMock,
}));

const mockedSubmitApproval = vi.mocked(submitApproval);

function makePost(overrides: Partial<HubPost> = {}): HubPost {
  return {
    id: 10,
    titulo: 'Texto motivacional segunda-feira',
    tipo: 'feed',
    status: 'enviado_cliente',
    ordem: 1,
    conteudo_plain: 'Segunda-feira é dia de começar com tudo! 💪\n\nNada de preguiça.',
    scheduled_at: '2026-04-28T10:00:00.000Z',
    workflow_id: 42,
    workflow_titulo: 'Editorial',
    media: [],
    cover_media: null,
    ...overrides,
  };
}

describe('TextPostCard', () => {
  beforeEach(() => {
    mockedSubmitApproval.mockReset();
  });

  it('renders collapsed by default with title, type badge, and truncated text', () => {
    render(
      <TextPostCard
        post={makePost()}
        token="token-publico"
        approvals={[]}
        onApprovalSubmitted={vi.fn()}
      />,
    );

    expect(screen.getByText('Texto motivacional segunda-feira')).toBeInTheDocument();
    expect(screen.getByText('Feed')).toBeInTheDocument();
    expect(screen.queryByText('Nada de preguiça.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Aprovar/i })).not.toBeInTheDocument();
  });

  it('expands to show full text and approval buttons when clicked', () => {
    render(
      <TextPostCard
        post={makePost()}
        token="token-publico"
        approvals={[]}
        onApprovalSubmitted={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('Texto motivacional segunda-feira'));

    expect(screen.getByText(/Nada de preguiça/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Aprovar/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Solicitar correção/i })).toBeInTheDocument();
  });

  it('collapses when clicked again', () => {
    render(
      <TextPostCard
        post={makePost()}
        token="token-publico"
        approvals={[]}
        onApprovalSubmitted={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('Texto motivacional segunda-feira'));
    expect(screen.getByText(/Nada de preguiça/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Texto motivacional segunda-feira'));
    expect(screen.queryByRole('button', { name: /Aprovar/i })).not.toBeInTheDocument();
  });

  it('submits an approval and calls onApprovalSubmitted', async () => {
    mockedSubmitApproval.mockResolvedValue({ ok: true } as never);
    const onApprovalSubmitted = vi.fn();

    render(
      <TextPostCard
        post={makePost()}
        token="token-publico"
        approvals={[]}
        onApprovalSubmitted={onApprovalSubmitted}
      />,
    );

    fireEvent.click(screen.getByText('Texto motivacional segunda-feira'));
    fireEvent.click(screen.getByRole('button', { name: /Aprovar/i }));

    await waitFor(() => {
      expect(mockedSubmitApproval).toHaveBeenCalledWith('token-publico', 10, 'aprovado', undefined);
    });
    expect(onApprovalSubmitted).toHaveBeenCalledTimes(1);
  });

  it('shows a "TikTok" platform badge for platform=tiktok', () => {
    render(
      <TextPostCard post={makePost({ platform: 'tiktok' })} token="token-publico" approvals={[]} />,
    );

    expect(screen.getByText('TikTok')).toBeInTheDocument();
  });

  it('shows an "Instagram" platform badge when platform is undefined', () => {
    render(<TextPostCard post={makePost()} token="token-publico" approvals={[]} />);

    expect(screen.getByText('Instagram')).toBeInTheDocument();
  });
});

// Storage auto-clean placeholder (spec 2026-08-10): a published post whose
// media was deleted routes to the text card; the banner must say why and keep
// a path to the live publication.
describe('TextPostCard auto-clean banner', () => {
  it('shows the removal banner with the Instagram link', () => {
    render(
      <TextPostCard
        post={makePost({
          status: 'postado',
          media_autocleaned_at: '2026-08-05T05:30:00Z',
          instagram_permalink: 'https://www.instagram.com/p/abc/',
        })}
        token="token-publico"
        approvals={[]}
        onApprovalSubmitted={vi.fn()}
      />,
    );

    expect(screen.getByText('Mídia removida para liberar espaço')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Ver no Instagram/ });
    expect(link).toHaveAttribute('href', 'https://www.instagram.com/p/abc/');
  });

  it('falls back to the TikTok link and hides the CTA when no URL exists', () => {
    const { rerender } = render(
      <TextPostCard
        post={makePost({
          status: 'postado',
          media_autocleaned_at: '2026-08-05T05:30:00Z',
          instagram_permalink: null,
          tiktok_post_url: 'https://www.tiktok.com/@x/video/1',
        })}
        token="token-publico"
        approvals={[]}
        onApprovalSubmitted={vi.fn()}
      />,
    );
    expect(screen.getByRole('link', { name: /Ver no TikTok/ })).toHaveAttribute(
      'href',
      'https://www.tiktok.com/@x/video/1',
    );

    rerender(
      <TextPostCard
        post={makePost({
          status: 'postado',
          media_autocleaned_at: '2026-08-05T05:30:00Z',
          instagram_permalink: null,
          tiktok_post_url: null,
        })}
        token="token-publico"
        approvals={[]}
        onApprovalSubmitted={vi.fn()}
      />,
    );
    expect(screen.getByText('Mídia removida para liberar espaço')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('never shows the banner on a post that was not cleaned', () => {
    render(
      <TextPostCard
        post={makePost()}
        token="token-publico"
        approvals={[]}
        onApprovalSubmitted={vi.fn()}
      />,
    );
    expect(screen.queryByText('Mídia removida para liberar espaço')).not.toBeInTheDocument();
  });
});

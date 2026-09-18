import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TextPostCard } from '../TextPostCard';
import { fetchPostHistory, submitApproval } from '../../api';
import type { HubPost, PostApproval } from '../../types';

const submitApprovalMock = vi.hoisted(() => vi.fn());

vi.mock('../../api', () => ({
  submitApproval: submitApprovalMock,
  fetchPostHistory: vi.fn().mockResolvedValue({ events: [], approvals: [] }),
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
    expect(screen.getByRole('button', { name: /Correção/i })).toBeInTheDocument();
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

  it('mostra o chip Reel de teste quando ig_trial_strategy está definido', () => {
    render(
      <TextPostCard
        post={makePost({ tipo: 'reels', ig_trial_strategy: 'auto' })}
        token="token-publico"
        approvals={[]}
        onApprovalSubmitted={vi.fn()}
      />,
    );

    expect(screen.getByText('Reel de teste')).toBeTruthy();
  });

  it('não mostra o chip em post normal', () => {
    render(
      <TextPostCard
        post={makePost()}
        token="token-publico"
        approvals={[]}
        onApprovalSubmitted={vi.fn()}
      />,
    );

    expect(screen.queryByText('Reel de teste')).toBeNull();
  });

  it('opens the Corrigir panel and sends a correction without requiring a motivo', async () => {
    mockedSubmitApproval.mockResolvedValue({ ok: true } as never);
    render(
      <TextPostCard
        post={makePost()}
        token="token-publico"
        approvals={[]}
        onApprovalSubmitted={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Texto motivacional segunda-feira'));
    fireEvent.click(screen.getByRole('button', { name: /Correção/i }));

    const correctionButton = screen.getByRole('button', { name: /Enviar correção/i });
    expect(correctionButton).toBeEnabled();
    fireEvent.change(screen.getByPlaceholderText(/Descreva o que precisa mudar/), {
      target: { value: 'Trocar a data' },
    });
    fireEvent.click(correctionButton);

    await waitFor(() =>
      expect(mockedSubmitApproval).toHaveBeenCalledWith(
        'token-publico',
        10,
        'correcao',
        'Trocar a data',
        undefined,
      ),
    );
  });

  it('sends the chosen motivo when one is selected', async () => {
    mockedSubmitApproval.mockResolvedValue({ ok: true } as never);
    render(
      <TextPostCard
        post={makePost()}
        token="token-publico"
        approvals={[]}
        onApprovalSubmitted={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Texto motivacional segunda-feira'));
    fireEvent.click(screen.getByRole('button', { name: /Correção/i }));
    fireEvent.change(screen.getByPlaceholderText(/Descreva o que precisa mudar/), {
      target: { value: 'Trocar a data' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Texto' }));
    fireEvent.click(screen.getByRole('button', { name: /Enviar correção/i }));

    await waitFor(() =>
      expect(mockedSubmitApproval).toHaveBeenCalledWith(
        'token-publico',
        10,
        'correcao',
        'Trocar a data',
        'texto',
      ),
    );
  });

  it('Fechar discards a staged caption edit so Aprovar is not left disabled', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(
      <TextPostCard
        post={makePost({ ig_caption: 'Legenda original' })}
        token="token-publico"
        approvals={[]}
        onApprovalSubmitted={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Texto motivacional segunda-feira'));
    fireEvent.click(screen.getByRole('button', { name: /Correção/i }));

    fireEvent.change(screen.getByDisplayValue('Legenda original'), {
      target: { value: 'Legenda editada' },
    });
    expect(screen.getByRole('button', { name: /Fechar/i })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /Fechar/i }));

    expect(screen.getByRole('button', { name: /Aprovar/i })).toBeEnabled();
  });

  it('Fechar returns to the collapsed buttons and discards an untouched comentario', () => {
    render(
      <TextPostCard
        post={makePost()}
        token="token-publico"
        approvals={[]}
        onApprovalSubmitted={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Texto motivacional segunda-feira'));
    fireEvent.click(screen.getByRole('button', { name: /Correção/i }));
    expect(screen.getByRole('button', { name: /Fechar/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Fechar/i }));
    expect(screen.getByRole('button', { name: /Aprovar/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Enviar correção/i })).not.toBeInTheDocument();
  });

  it('renders the history panel toggle when expanded, also in read-only mode', () => {
    render(
      <TextPostCard
        post={makePost({ status: 'postado' })}
        token="token-publico"
        approvals={[]}
        readOnly
      />,
    );
    fireEvent.click(screen.getByText('Texto motivacional segunda-feira'));
    expect(screen.getByRole('button', { name: /Histórico e comentários/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Aprovar/i })).not.toBeInTheDocument();
  });

  it('resets the history panel (open state and unsent draft) when the post changes', async () => {
    vi.mocked(fetchPostHistory).mockResolvedValue({ events: [], approvals: [] });
    const renderCard = (id: number) => (
      <TextPostCard
        post={makePost({ id, status: 'postado' })}
        token="token-publico"
        approvals={[]}
        readOnly
      />
    );
    const placeholder = 'Escreva um comentário sobre este post';
    const { rerender } = render(renderCard(1));
    fireEvent.click(screen.getByText('Texto motivacional segunda-feira'));
    fireEvent.click(screen.getByRole('button', { name: /Histórico e comentários/ }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Comentários' }));
    fireEvent.change(screen.getByPlaceholderText(placeholder), {
      target: { value: 'rascunho do post 1' },
    });

    // Same card kind, different post (back/forward, pasted deep link): React reuses the card instance.
    rerender(renderCard(2));
    if (!screen.queryByRole('button', { name: /Histórico e comentários/ })) {
      fireEvent.click(screen.getByText('Texto motivacional segunda-feira'));
    }
    expect(screen.queryByPlaceholderText(placeholder)).not.toBeInTheDocument();
    expect(screen.queryByText('rascunho do post 1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Histórico e comentários/ }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Comentários' }));
    expect(screen.getByPlaceholderText(placeholder)).toHaveValue('');
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

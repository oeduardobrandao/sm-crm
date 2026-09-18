import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEditSuggestionFailuresForTests } from '../../hooks/useEditSuggestion';
import { InstagramPostCard } from '../InstagramPostCard';
import { fetchPostHistory, submitApproval } from '../../api';
import type { HubPost, HubPostMedia, InstagramProfile } from '../../types';

const submitApprovalMock = vi.hoisted(() => vi.fn());
const submitEditSuggestionMock = vi.hoisted(() => vi.fn());

vi.mock('../../api', () => ({
  submitApproval: submitApprovalMock,
  submitEditSuggestion: submitEditSuggestionMock,
  fetchPostHistory: vi.fn().mockResolvedValue({ events: [], approvals: [] }),
}));

vi.mock('../PostMediaLightbox', () => ({
  PostMediaLightbox: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="post-media-lightbox">
      <button type="button" onClick={onClose}>
        Fechar lightbox
      </button>
    </div>
  ),
}));

const mockedSubmitApproval = vi.mocked(submitApproval);

function makeMedia(overrides: Partial<HubPostMedia> = {}): HubPostMedia {
  return {
    id: 1,
    post_id: 7,
    kind: 'image',
    mime_type: 'image/jpeg',
    url: 'https://cdn.example.com/media-1.jpg',
    thumbnail_url: null,
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
    titulo: 'Campanha de Páscoa',
    tipo: 'feed',
    status: 'enviado_cliente',
    ordem: 1,
    conteudo_plain: 'Legenda principal do post.',
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

describe('InstagramPostCard', () => {
  beforeEach(() => {
    mockedSubmitApproval.mockReset();
    submitEditSuggestionMock.mockReset();
    resetEditSuggestionFailuresForTests();
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

    expect(screen.getAllByText('studio_marca').length).toBeGreaterThanOrEqual(1);
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

    expect(screen.getAllByText('Mesaas').length).toBeGreaterThanOrEqual(1);
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

  it('prewarms the post video so the lightbox opens without stutter', () => {
    const { container } = render(
      <InstagramPostCard
        post={makePost({
          tipo: 'reels',
          media: [
            makeMedia({
              id: 5,
              kind: 'video',
              mime_type: 'video/quicktime',
              url: 'https://cdn.example.com/reel.mov',
              thumbnail_url: 'https://cdn.example.com/reel-thumb.jpg',
            }),
          ],
        })}
        token="token-publico"
        approvals={[]}
        instagramProfile={profile}
        isSelected={false}
        onToggleSelect={vi.fn()}
        onApprovalSubmitted={vi.fn()}
      />,
    );

    // jsdom has no IntersectionObserver, so VideoPrewarm warms immediately.
    expect(container.querySelector('video')).toHaveAttribute(
      'src',
      'https://cdn.example.com/reel.mov',
    );
  });

  it('does not prewarm anything for an image-only post', () => {
    const { container } = render(
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

    expect(container.querySelector('video')).toBeNull();
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

  it('collapses a long caption behind a "mais" toggle that expands and collapses', () => {
    const longCaption =
      'A maternidade transforma, mas ela não deveria exigir que você deixasse de existir. ' +
      'Se você sentiu falta de si mesma ao ler essas falas, se você se identificou, este post é para você.';

    render(
      <InstagramPostCard
        post={makePost({ status: 'aprovado_cliente', ig_caption: longCaption })}
        token="token-publico"
        approvals={[]}
        instagramProfile={profile}
        readOnly
      />,
    );

    const moreBtn = screen.getByRole('button', { name: /^…?\s*mais$/i });
    expect(moreBtn).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ver menos/i })).not.toBeInTheDocument();

    fireEvent.click(moreBtn);
    const lessBtn = screen.getByRole('button', { name: /ver menos/i });
    expect(lessBtn).toBeInTheDocument();

    fireEvent.click(lessBtn);
    expect(screen.getByRole('button', { name: /^…?\s*mais$/i })).toBeInTheDocument();
  });

  it('does not show a caption toggle for a short caption', () => {
    render(
      <InstagramPostCard
        post={makePost({ status: 'aprovado_cliente', ig_caption: 'Legenda curta.' })}
        token="token-publico"
        approvals={[]}
        instagramProfile={profile}
        readOnly
      />,
    );

    expect(screen.queryByRole('button', { name: /mais/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ver menos/i })).not.toBeInTheDocument();
  });

  it('reads a pending caption first, with no open editor until Correção is opened', () => {
    render(
      <InstagramPostCard
        post={makePost({ status: 'enviado_cliente', ig_caption: 'Olá pessoal do feed' })}
        token="token-publico"
        approvals={[]}
        instagramProfile={profile}
        onApprovalSubmitted={vi.fn()}
      />,
    );

    expect(screen.getByText(/Olá pessoal do feed/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Correção/ })).toBeInTheDocument();
    // The caption editor is a distinct, labelled textarea — closed by default.
    expect(screen.queryByLabelText(/legenda do post/i)).not.toBeInTheDocument();
  });

  it('reveals the caption editor on "Correção" and closes it on "Fechar"', () => {
    render(
      <InstagramPostCard
        post={makePost({ status: 'enviado_cliente', ig_caption: 'Olá' })}
        token="token-publico"
        approvals={[]}
        instagramProfile={profile}
        onApprovalSubmitted={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Correção/ }));
    expect(screen.getByLabelText(/legenda do post/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Salvar edição/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Fechar/ }));
    expect(screen.queryByLabelText(/legenda do post/i)).not.toBeInTheDocument();
  });

  it('opens the lightbox at the tapped media slide via its accessible label', () => {
    render(
      <InstagramPostCard
        post={makePost({ status: 'aprovado_cliente' })}
        token="token-publico"
        approvals={[]}
        instagramProfile={profile}
        readOnly
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /abrir mídia 1/i }));
    expect(screen.getByTestId('post-media-lightbox')).toBeInTheDocument();
  });

  it('shows a "TikTok" platform badge for platform=tiktok', () => {
    render(
      <InstagramPostCard
        post={makePost({ platform: 'tiktok' })}
        token="token-publico"
        approvals={[]}
        instagramProfile={profile}
      />,
    );

    expect(screen.getByText('TikTok')).toBeInTheDocument();
  });

  it('shows an "Instagram" platform badge when platform is undefined', () => {
    render(
      <InstagramPostCard
        post={makePost()}
        token="token-publico"
        approvals={[]}
        instagramProfile={profile}
      />,
    );

    expect(screen.getByText('Instagram')).toBeInTheDocument();
  });

  it('shows the unavailable placeholder instead of a broken image for a permanently lost slide', () => {
    render(
      <InstagramPostCard
        post={makePost({
          media: [makeMedia({ id: 1, media_lost_at: '2026-08-14T03:00:00.000Z', url: null })],
        })}
        token="token-publico"
        approvals={[]}
        instagramProfile={profile}
        isSelected={false}
        onToggleSelect={vi.fn()}
        onApprovalSubmitted={vi.fn()}
      />,
    );
    expect(screen.getByText('Mídia indisponível')).toBeInTheDocument();
    // Scoped to the slide button itself since the card header always renders
    // its own (unrelated) profile-picture <img>.
    const slideButton = screen.getByRole('button', { name: /abrir mídia 1/i });
    expect(slideButton.querySelector('img')).not.toBeInTheDocument();
  });

  it('mostra o chip Reel de teste quando ig_trial_strategy está definido', () => {
    render(
      <InstagramPostCard
        post={makePost({ media: [makeMedia()], tipo: 'reels', ig_trial_strategy: 'auto' })}
        token="token-publico"
        approvals={[]}
        instagramProfile={profile}
        isSelected={false}
        onToggleSelect={vi.fn()}
        onApprovalSubmitted={vi.fn()}
      />,
    );

    expect(screen.getByText('Reel de teste')).toBeTruthy();
  });

  it('não mostra o chip em post normal', () => {
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

    expect(screen.queryByText('Reel de teste')).toBeNull();
  });

  it('opens the Corrigir panel and sends a correction without requiring a motivo', async () => {
    mockedSubmitApproval.mockResolvedValue({ ok: true } as never);
    render(
      <InstagramPostCard
        post={makePost()}
        token="token-publico"
        approvals={[]}
        instagramProfile={profile}
        onApprovalSubmitted={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Correção/ }));
    const sendButton = screen.getByRole('button', { name: /Enviar correção/ });
    expect(sendButton).toBeEnabled();
    fireEvent.change(screen.getByPlaceholderText(/Descreva o que precisa mudar/), {
      target: { value: 'Ajustar legenda' },
    });
    fireEvent.click(sendButton);
    await waitFor(() =>
      expect(mockedSubmitApproval).toHaveBeenCalledWith(
        'token-publico',
        7,
        'correcao',
        'Ajustar legenda',
        undefined,
      ),
    );
  });

  it('sends the chosen motivo when one is selected', async () => {
    mockedSubmitApproval.mockResolvedValue({ ok: true } as never);
    render(
      <InstagramPostCard
        post={makePost()}
        token="token-publico"
        approvals={[]}
        instagramProfile={profile}
        onApprovalSubmitted={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Correção/ }));
    fireEvent.change(screen.getByPlaceholderText(/Descreva o que precisa mudar/), {
      target: { value: 'Ajustar legenda' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Legenda' }));
    fireEvent.click(screen.getByRole('button', { name: /Enviar correção/ }));
    await waitFor(() =>
      expect(mockedSubmitApproval).toHaveBeenCalledWith(
        'token-publico',
        7,
        'correcao',
        'Ajustar legenda',
        'legenda',
      ),
    );
  });

  it('renders the history panel toggle in read-only mode', () => {
    render(
      <InstagramPostCard
        post={makePost({ status: 'agendado' })}
        token="token-publico"
        approvals={[]}
        instagramProfile={profile}
        readOnly
      />,
    );
    expect(screen.getByRole('button', { name: /Histórico e comentários/ })).toBeInTheDocument();
  });

  it('resets the history panel (open state and unsent draft) when the post changes', async () => {
    vi.mocked(fetchPostHistory).mockResolvedValue({ events: [], approvals: [] });
    const renderCard = (id: number) => (
      <InstagramPostCard
        post={makePost({ id, status: 'agendado' })}
        token="token-publico"
        approvals={[]}
        instagramProfile={profile}
        readOnly
      />
    );
    const { rerender } = render(renderCard(1));
    fireEvent.click(screen.getByRole('button', { name: /Histórico e comentários/ }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Comentários' }));
    const placeholder = 'Escreva um comentário sobre este post';
    fireEvent.change(screen.getByPlaceholderText(placeholder), {
      target: { value: 'rascunho do post 1' },
    });
    expect(screen.getByPlaceholderText(placeholder)).toHaveValue('rascunho do post 1');

    // Same card kind, different post (back/forward, pasted deep link): React reuses the card instance.
    rerender(renderCard(2));
    expect(screen.queryByPlaceholderText(placeholder)).not.toBeInTheDocument();
    expect(screen.queryByText('rascunho do post 1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Histórico e comentários/ }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Comentários' }));
    expect(screen.getByPlaceholderText(placeholder)).toHaveValue('');
  });

  describe('failed edit save', () => {
    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    const original = 'Legenda original';
    const edited = 'Legenda editada pelo cliente';
    const makeEditPost = () => makePost({ ig_caption: original });

    function renderCard(post: HubPost) {
      return render(
        <InstagramPostCard
          post={post}
          token="token-publico"
          approvals={[]}
          instagramProfile={profile}
          onApprovalSubmitted={vi.fn()}
        />,
      );
    }

    // Opens the correction panel, types an edit and fires the debounced save.
    async function editAndSave() {
      fireEvent.click(screen.getByRole('button', { name: /Correção/ }));
      fireEvent.change(screen.getByDisplayValue(original), { target: { value: edited } });
      fireEvent.click(screen.getByRole('button', { name: /Salvar edição|Tentar novamente/ }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
    }

    async function retry() {
      fireEvent.click(screen.getByRole('button', { name: /Tentar novamente/ }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
    }

    it('shows the failure banner and a retry action right after a single failed save', async () => {
      vi.useFakeTimers();
      submitEditSuggestionMock.mockRejectedValueOnce(new Error('network'));
      renderCard(makeEditPost());

      fireEvent.click(screen.getByRole('button', { name: /Correção/ }));
      fireEvent.change(screen.getByDisplayValue(original), { target: { value: edited } });
      fireEvent.click(screen.getByRole('button', { name: /Salvar edição/ }));

      // Debounce window: the request has not gone out, so this is not a failure yet.
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      expect(screen.getByRole('alert')).toHaveTextContent(/Não foi possível salvar/);
      expect(screen.getByRole('button', { name: /Tentar novamente/ })).toBeEnabled();
      expect(screen.getByRole('button', { name: /Descartar edição/ })).toBeEnabled();
      // The unsent edit is protected: nothing can leave the panel or move on.
      expect(screen.getByRole('button', { name: /Fechar/ })).toBeDisabled();
      expect(screen.getByRole('button', { name: /Enviar correção/ })).toBeDisabled();
    });

    it('resubmits the same content on retry and unblocks approval once it succeeds', async () => {
      vi.useFakeTimers();
      submitEditSuggestionMock
        .mockRejectedValueOnce(new Error('network'))
        .mockResolvedValueOnce({ ok: true, pending_suggestion: null });
      const post = makeEditPost();
      const { rerender } = renderCard(post);

      await editAndSave();
      expect(submitEditSuggestionMock).toHaveBeenCalledTimes(1);

      await retry();

      expect(submitEditSuggestionMock).toHaveBeenCalledTimes(2);
      expect(submitEditSuggestionMock.mock.calls[1]).toEqual(
        submitEditSuggestionMock.mock.calls[0],
      );
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();

      // The server now returns the saved caption (onSaved triggers a refetch in the app).
      rerender(
        <InstagramPostCard
          post={{ ...post, ig_caption: edited }}
          token="token-publico"
          approvals={[]}
          instagramProfile={profile}
          onApprovalSubmitted={vi.fn()}
        />,
      );
      expect(screen.getByRole('button', { name: /Aprovar/ })).toBeEnabled();
    });

    it('lets the user discard a failed edit, which restores the original and unblocks Fechar', async () => {
      vi.useFakeTimers();
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      submitEditSuggestionMock.mockRejectedValueOnce(new Error('network'));
      renderCard(makeEditPost());

      await editAndSave();

      fireEvent.click(screen.getByRole('button', { name: /Descartar edição/ }));

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByDisplayValue(original)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Fechar/ })).toBeEnabled();
      expect(submitEditSuggestionMock).toHaveBeenCalledTimes(1);
    });

    it('does not bring back a stale comment or motivo after a saved edit auto-closes the panel', async () => {
      vi.useFakeTimers();
      submitEditSuggestionMock.mockResolvedValueOnce({ ok: true, pending_suggestion: null });
      renderCard(makeEditPost());

      fireEvent.click(screen.getByRole('button', { name: /Correção/ }));
      fireEvent.change(screen.getByPlaceholderText(/Descreva o que precisa mudar/), {
        target: { value: 'Comentário antigo' },
      });
      fireEvent.change(screen.getByDisplayValue(original), { target: { value: edited } });
      fireEvent.click(screen.getByRole('button', { name: /Salvar edição/ }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      // Saved: the panel closed itself.
      expect(screen.queryByPlaceholderText(/Descreva o que precisa mudar/)).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /Correção/ }));

      expect(screen.getByPlaceholderText(/Descreva o que precisa mudar/)).toHaveValue('');
    });

    it('keeps the failed edit when the discard confirmation is declined', async () => {
      vi.useFakeTimers();
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      submitEditSuggestionMock.mockRejectedValueOnce(new Error('network'));
      renderCard(makeEditPost());

      await editAndSave();

      fireEvent.click(screen.getByRole('button', { name: /Descartar edição/ }));

      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByDisplayValue(edited)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Fechar/ })).toBeDisabled();
    });
  });
});

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEditSuggestionFailuresForTests } from '../../hooks/useEditSuggestion';
import { StoryPostCard } from '../StoryPostCard';
import { fetchPostHistory, submitApproval } from '../../api';
import type { HubPost, HubPostMedia, InstagramProfile } from '../../types';

const submitApprovalMock = vi.hoisted(() => vi.fn());
const submitEditSuggestionMock = vi.hoisted(() => vi.fn());

vi.mock('../../api', () => ({
  submitApproval: submitApprovalMock,
  submitEditSuggestion: submitEditSuggestionMock,
  fetchPostHistory: vi.fn().mockResolvedValue({ events: [], approvals: [] }),
}));

const mockedSubmitApproval = vi.mocked(submitApproval);

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
  beforeEach(() => {
    mockedSubmitApproval.mockReset();
    submitEditSuggestionMock.mockReset();
    resetEditSuggestionFailuresForTests();
  });

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

  it('shows an "Instagram + TikTok" platform badge for platform=both', () => {
    render(
      <StoryPostCard
        post={makePost({ platform: 'both' })}
        token="token-publico"
        approvals={[]}
        instagramProfile={profile}
      />,
    );

    expect(screen.getByText('Instagram + TikTok')).toBeInTheDocument();
  });

  it('shows the unavailable placeholder instead of a broken image for a permanently lost story', () => {
    render(
      <StoryPostCard
        post={makePost({
          media: [makeMedia({ id: 1, media_lost_at: '2026-08-14T03:00:00.000Z', url: null })],
        })}
        token="token-publico"
        approvals={[]}
        instagramProfile={profile}
      />,
    );
    expect(screen.getByText('Mídia indisponível')).toBeInTheDocument();
  });

  it('opens the Corrigir panel and sends a correction without requiring a motivo', async () => {
    mockedSubmitApproval.mockResolvedValue({ ok: true });
    render(
      <StoryPostCard
        post={makePost()}
        token="token-publico"
        approvals={[]}
        instagramProfile={null}
        workspaceName="Mesaas"
        onApprovalSubmitted={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Correção/ }));
    const sendButton = screen.getByRole('button', { name: /Enviar correção/ });
    expect(sendButton).toBeEnabled();
    fireEvent.change(screen.getByPlaceholderText(/Descreva o que precisa mudar/), {
      target: { value: 'Trocar a imagem' },
    });
    fireEvent.click(sendButton);
    await waitFor(() =>
      expect(mockedSubmitApproval).toHaveBeenCalledWith(
        'token-publico',
        7,
        'correcao',
        'Trocar a imagem',
        undefined,
      ),
    );
  });

  it('sends the chosen motivo when one is selected', async () => {
    mockedSubmitApproval.mockResolvedValue({ ok: true });
    render(
      <StoryPostCard
        post={makePost()}
        token="token-publico"
        approvals={[]}
        instagramProfile={null}
        workspaceName="Mesaas"
        onApprovalSubmitted={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Correção/ }));
    fireEvent.change(screen.getByPlaceholderText(/Descreva o que precisa mudar/), {
      target: { value: 'Trocar a imagem' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Mídia' }));
    fireEvent.click(screen.getByRole('button', { name: /Enviar correção/ }));
    await waitFor(() =>
      expect(mockedSubmitApproval).toHaveBeenCalledWith(
        'token-publico',
        7,
        'correcao',
        'Trocar a imagem',
        'midia',
      ),
    );
  });

  it('renders the history panel toggle in read-only mode', () => {
    render(
      <StoryPostCard
        post={makePost({ status: 'aprovado_cliente' })}
        token="token-publico"
        approvals={[]}
        instagramProfile={null}
        workspaceName="Mesaas"
        readOnly
      />,
    );
    expect(screen.getByRole('button', { name: /Histórico e comentários/ })).toBeInTheDocument();
  });

  it('resets the history panel (open state and unsent draft) when the post changes', async () => {
    vi.mocked(fetchPostHistory).mockResolvedValue({ events: [], approvals: [] });
    const renderCard = (id: number) => (
      <StoryPostCard
        post={makePost({ id, status: 'aprovado_cliente' })}
        token="token-publico"
        approvals={[]}
        instagramProfile={null}
        workspaceName="Mesaas"
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
        <StoryPostCard
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
        <StoryPostCard
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

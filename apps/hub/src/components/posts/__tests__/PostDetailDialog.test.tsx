import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { HubContext } from '../../../HubContext';
import { resetEditSuggestionFailuresForTests } from '../../../hooks/useEditSuggestion';
import { PostDetailDialog } from '../PostDetailDialog';
import type { HubPost, HubPostMedia } from '../../../types';

const submitApprovalMock = vi.hoisted(() => vi.fn());
const submitEditSuggestionMock = vi.hoisted(() => vi.fn());
const fetchPostHistoryMock = vi.hoisted(() => vi.fn());
vi.mock('../../../api', () => ({
  submitApproval: submitApprovalMock,
  submitEditSuggestion: submitEditSuggestionMock,
  fetchPostHistory: fetchPostHistoryMock,
}));

const hubValue = {
  bootstrap: {
    workspace: { name: 'Mesaas', logo_url: '', brand_color: '#0f766e' },
    cliente_nome: 'C',
    is_active: true,
    cliente_id: 1,
  },
  token: 'token-publico',
  workspace: 'mesaas',
} as never;

const MEDIA: HubPostMedia = {
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
};

function post(over: Partial<HubPost>): HubPost {
  return {
    id: 1,
    titulo: 'Post',
    tipo: 'feed',
    status: 'enviado_cliente',
    ordem: 1,
    conteudo: null,
    conteudo_plain: 'Corpo',
    scheduled_at: '2026-04-28T10:00:00.000Z',
    ig_caption: 'Legenda um',
    instagram_permalink: null,
    published_at: null,
    publish_error: null,
    workflow_id: 1,
    workflow_titulo: 'Editorial',
    workflow_created_at: null,
    media: [MEDIA],
    cover_media: null,
    pending_suggestion: null,
    suggestion_rejected_at: null,
    ...over,
  };
}

const posts = [
  post({ id: 1, titulo: 'Primeiro', ig_caption: 'Legenda um' }),
  post({ id: 2, titulo: 'Segundo', status: 'aprovado_cliente', ig_caption: 'Legenda dois' }),
  post({
    id: 3,
    titulo: 'Terceiro',
    media: [],
    ig_caption: null,
    conteudo_plain: 'Texto do terceiro',
  }),
];

function renderDialog(
  currentId: number | null,
  over: Partial<React.ComponentProps<typeof PostDetailDialog>> = {},
) {
  const onNavigate = vi.fn();
  const onApprovalSubmitted = vi.fn();
  render(
    <HubContext.Provider value={hubValue}>
      <MemoryRouter>
        <PostDetailDialog
          posts={posts}
          currentId={currentId}
          token="token-publico"
          approvals={[]}
          instagramProfile={null}
          isAutoPublish={() => false}
          onNavigate={onNavigate}
          onApprovalSubmitted={onApprovalSubmitted}
          {...over}
        />
      </MemoryRouter>
    </HubContext.Provider>,
  );
  return { onNavigate, onApprovalSubmitted };
}

describe('PostDetailDialog', () => {
  beforeEach(() => {
    submitApprovalMock.mockReset();
    submitEditSuggestionMock.mockReset();
    // The failed-save memory is module-level in useEditSuggestion (survives unmounts on
    // purpose); wipe it so one test's failure never leaks into the next.
    resetEditSuggestionFailuresForTests();
    vi.restoreAllMocks();
    fetchPostHistoryMock.mockReset();
    fetchPostHistoryMock.mockResolvedValue({ events: [], approvals: [] });
  });

  it('is closed when currentId is null', () => {
    renderDialog(null);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the post with caption, chips, footer actions and the strip', () => {
    renderDialog(1);
    expect(screen.getByRole('dialog', { name: 'Primeiro' })).toBeInTheDocument();
    expect(screen.getByText('Legenda um')).toBeInTheDocument();
    expect(screen.getByText('Aguardando aprovação')).toBeInTheDocument();
    expect(screen.getByText('Editorial')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Aprovar/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Corrigir/ })).toBeInTheDocument();
    expect(screen.getByText('1 de 3')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Outros posts' })).toBeInTheDocument();
  });

  it('hides Aprovar/Corrigir for a non-pending post and shows the status once', () => {
    renderDialog(2);
    expect(screen.queryByRole('button', { name: /Aprovar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Corrigir/ })).not.toBeInTheDocument();
    expect(screen.getAllByText('Aprovado')).toHaveLength(1);
  });

  it('renders exactly one prev and one next control', () => {
    renderDialog(2);
    expect(screen.getAllByRole('button', { name: 'Post anterior' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Próximo post' })).toHaveLength(1);
  });

  it('navigates with arrows, keys and the strip', () => {
    const { onNavigate } = renderDialog(2);
    fireEvent.click(screen.getByRole('button', { name: 'Post anterior' }));
    expect(onNavigate).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onNavigate).toHaveBeenLastCalledWith(3);
    fireEvent.click(screen.getByRole('button', { name: 'Ir para Terceiro' }));
    expect(onNavigate).toHaveBeenLastCalledWith(3);
  });

  it('disables prev at the start and next at the end', () => {
    renderDialog(1);
    expect(screen.getByRole('button', { name: 'Post anterior' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Próximo post' })).toBeEnabled();
  });

  it('renders a text post in reading mode with the rich body', () => {
    renderDialog(3);
    expect(screen.getByText('Texto do terceiro')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Texto' })).toBeInTheDocument();
  });

  it('Corrigir opens the panel; Fechar with a typed comentário asks to discard', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { onNavigate } = renderDialog(1);
    fireEvent.click(screen.getByRole('button', { name: /Corrigir/ }));
    expect(screen.getByRole('button', { name: /Enviar correção/ })).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Descreva o que precisa mudar/), {
      target: { value: 'x' },
    });
    expect(screen.getByRole('button', { name: /Aprovar/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(confirm).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Enviar correção/ })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('Corrigir from the Histórico tab switches back to the content tab and shows the panel', () => {
    renderDialog(1);
    fireEvent.click(screen.getByRole('tab', { name: 'Histórico e comentários' }));
    fireEvent.click(screen.getByRole('button', { name: /Corrigir/ }));
    expect(screen.getByRole('tab', { name: 'Legenda' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: /Enviar correção/ })).toBeInTheDocument();
  });

  it('Fechar without changes returns to the reading mode and re-enables Aprovar', () => {
    renderDialog(1);
    fireEvent.click(screen.getByRole('button', { name: /Corrigir/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByRole('button', { name: /Enviar correção/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Aprovar/ })).toBeEnabled();
  });

  it('Aprovar submits, then auto-advances to the next pending post before invalidating', async () => {
    submitApprovalMock.mockResolvedValue({ ok: true, scheduled: false });
    const calls: string[] = [];
    const { onNavigate, onApprovalSubmitted } = renderDialog(3, {
      posts: [
        post({ id: 3, titulo: 'A' }),
        post({ id: 4, titulo: 'B', status: 'postado' }),
        post({ id: 5, titulo: 'C' }),
      ],
    });
    onNavigate.mockImplementation(() => calls.push('navigate'));
    onApprovalSubmitted.mockImplementation(() => calls.push('invalidate'));
    fireEvent.click(screen.getByRole('button', { name: /Aprovar/ }));
    await waitFor(() =>
      expect(submitApprovalMock).toHaveBeenCalledWith('token-publico', 3, 'aprovado', undefined),
    );
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith(5));
    expect(calls).toEqual(['navigate', 'invalidate']);
    expect(screen.getByText('Post aprovado!')).toBeInTheDocument();
  });

  it('shows the scheduled flash when the approval auto-scheduled the post', async () => {
    submitApprovalMock.mockResolvedValue({ ok: true, scheduled: true });
    renderDialog(1);
    fireEvent.click(screen.getByRole('button', { name: /Aprovar/ }));
    expect(
      await screen.findByText('Post aprovado e agendado para publicação!'),
    ).toBeInTheDocument();
  });

  it('restarts the flash timer when the same flash fires again within 3s', async () => {
    submitApprovalMock.mockResolvedValue({ ok: true });
    renderDialog(1);
    vi.useFakeTimers();
    try {
      const approve = async () => {
        fireEvent.click(screen.getByRole('button', { name: /Aprovar/ }));
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });
      };
      await approve();
      expect(screen.getByText('Post aprovado!')).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      await approve();
      // 4s after the first flash, 2s after the second: the second timer is still running.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(screen.getByText('Post aprovado!')).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });
      expect(screen.queryByText('Post aprovado!')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('Esc with the lightbox open closes only the lightbox', () => {
    const { onNavigate } = renderDialog(1);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir mídia 1' }));
    // PostMediaLightbox is its own role="dialog" (unnamed) portalled into body.
    expect(screen.getAllByRole('dialog')).toHaveLength(2);
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Primeiro' }), { key: 'Escape' });
    expect(onNavigate).not.toHaveBeenCalled();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Primeiro' })).toBeInTheDocument();
  });

  it('closes after the action when no other pending post remains', async () => {
    submitApprovalMock.mockResolvedValue({ ok: true });
    const { onNavigate } = renderDialog(1, {
      posts: [post({ id: 1 }), post({ id: 2, status: 'postado' })],
    });
    fireEvent.click(screen.getByRole('button', { name: /Corrigir/ }));
    fireEvent.click(screen.getByRole('button', { name: /Enviar correção/ }));
    await waitFor(() =>
      expect(submitApprovalMock).toHaveBeenCalledWith(
        'token-publico',
        1,
        'correcao',
        '',
        undefined,
      ),
    );
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith(null));
  });

  it('shows the correction flash on the next post', async () => {
    submitApprovalMock.mockResolvedValue({ ok: true });
    renderDialog(1);
    fireEvent.click(screen.getByRole('button', { name: /Corrigir/ }));
    fireEvent.click(screen.getByRole('button', { name: /Enviar correção/ }));
    expect(await screen.findByText('Correção enviada!')).toBeInTheDocument();
  });

  it('shows the error and stays when submit fails', async () => {
    submitApprovalMock.mockRejectedValue(new Error('boom'));
    const { onNavigate } = renderDialog(1);
    fireEvent.click(screen.getByRole('button', { name: /Aprovar/ }));
    expect(
      await screen.findByText('Não foi possível enviar. Tente novamente.'),
    ).toBeInTheDocument();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Aprovar/ })).toBeEnabled();
  });

  it('renders the notAvailable state for an unknown id', () => {
    const { onNavigate } = renderDialog(99);
    expect(screen.getByText('Esta postagem não está disponível.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onNavigate).toHaveBeenCalledWith(null);
  });

  it('Esc closes when nothing is dirty', () => {
    const { onNavigate } = renderDialog(1);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onNavigate).toHaveBeenCalledWith(null);
  });

  it('shows the "Reel de teste" chip when ig_trial_strategy is set', () => {
    renderDialog(1, {
      posts: [post({ id: 1, tipo: 'reels', ig_trial_strategy: 'auto' })],
    });
    expect(screen.getByText('Reel de teste')).toBeInTheDocument();
  });

  it('does not show the "Reel de teste" chip on a normal post', () => {
    renderDialog(1);
    expect(screen.queryByText('Reel de teste')).not.toBeInTheDocument();
  });

  // Storage auto-clean placeholder (spec 2026-08-10): a published post whose
  // media was deleted reads as a text post; the banner must say why and keep a
  // path to the live publication.
  describe('auto-clean banner', () => {
    function cleaned(over: Partial<HubPost>): HubPost[] {
      return [
        post({
          id: 1,
          status: 'postado',
          media: [],
          ig_caption: null,
          media_autocleaned_at: '2026-08-05T05:30:00Z',
          ...over,
        }),
      ];
    }
    const BANNER = 'Mídia removida para liberar espaço';

    it('shows the removal banner with the Instagram link', () => {
      renderDialog(1, {
        posts: cleaned({ instagram_permalink: 'https://www.instagram.com/p/abc/' }),
      });
      const banner = screen.getByText(BANNER).parentElement as HTMLElement;
      expect(within(banner).getByRole('link', { name: /Ver no Instagram/ })).toHaveAttribute(
        'href',
        'https://www.instagram.com/p/abc/',
      );
    });

    it('falls back to the TikTok link when there is no Instagram permalink', () => {
      renderDialog(1, {
        posts: cleaned({
          instagram_permalink: null,
          tiktok_post_url: 'https://www.tiktok.com/@x/video/1',
        }),
      });
      const banner = screen.getByText(BANNER).parentElement as HTMLElement;
      expect(within(banner).getByRole('link', { name: /Ver no TikTok/ })).toHaveAttribute(
        'href',
        'https://www.tiktok.com/@x/video/1',
      );
      expect(within(banner).queryByRole('link', { name: /Ver no Instagram/ })).toBeNull();
    });

    it('shows the banner without any link when no URL exists', () => {
      renderDialog(1, {
        posts: cleaned({ instagram_permalink: null, tiktok_post_url: null }),
      });
      const banner = screen.getByText(BANNER).parentElement as HTMLElement;
      expect(within(banner).queryByRole('link')).toBeNull();
    });

    it('never shows the banner on a post that was not cleaned', () => {
      renderDialog(1, {
        posts: [post({ id: 1, media: [], ig_caption: null, instagram_permalink: 'https://x/p/1' })],
      });
      expect(screen.queryByText(BANNER)).not.toBeInTheDocument();
    });
  });
  describe('failed edit save (no lockout)', () => {
    const FAILED = 'Não foi possível salvar. Tente novamente.';

    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    // Opens the panel on post 1, edits the caption and clicks Salvar edição.
    function stageAndSave() {
      fireEvent.click(screen.getByRole('button', { name: /Corrigir/ }));
      fireEvent.change(screen.getByDisplayValue('Legenda um'), {
        target: { value: 'Legenda editada' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Salvar edição/ }));
    }

    async function settleDebounce() {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
    }

    async function openWithFailedSave(over: Parameters<typeof renderDialog>[1] = {}) {
      submitEditSuggestionMock.mockRejectedValue(new Error('boom'));
      const view = renderDialog(1, over);
      stageAndSave();
      await settleDebounce();
      expect(screen.getByText(FAILED)).toBeInTheDocument();
      return view;
    }

    it('keeps navigation blocked and shows no failure UI while the save is debounced or in flight', async () => {
      submitEditSuggestionMock.mockReturnValue(new Promise(() => {}));
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
      const { onNavigate } = renderDialog(1);
      stageAndSave();

      const expectBlockedAndQuiet = () => {
        expect(screen.getByRole('button', { name: 'Próximo post' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Ir para Segundo' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Fechar' })).toBeDisabled();
        expect(screen.queryByText(FAILED)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Tentar novamente' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Descartar edição' })).not.toBeInTheDocument();
      };
      // Debounce window.
      expectBlockedAndQuiet();
      // In flight (the request never settles).
      await settleDebounce();
      expect(submitEditSuggestionMock).toHaveBeenCalledTimes(1);
      expectBlockedAndQuiet();

      // The guard blocks the keyboard/X/Esc paths too, without even asking.
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      fireEvent.click(screen.getByRole('button', { name: 'Fechar postagem' }));
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      expect(confirm).not.toHaveBeenCalled();
      expect(onNavigate).not.toHaveBeenCalled();
    });

    it('after a failed save, Fechar/X/next/strip are enabled and ask to discard; cancelling stays, confirming leaves', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      const { onNavigate } = await openWithFailedSave();

      const next = screen.getByRole('button', { name: 'Próximo post' });
      const strip = screen.getByRole('button', { name: 'Ir para Segundo' });
      const fechar = screen.getByRole('button', { name: 'Fechar' });
      expect(next).toBeEnabled();
      expect(strip).toBeEnabled();
      expect(fechar).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Fechar postagem' })).toBeEnabled();

      // Cancelling stays put, everywhere.
      fireEvent.click(next);
      fireEvent.click(strip);
      fireEvent.click(fechar);
      fireEvent.click(screen.getByRole('button', { name: 'Fechar postagem' }));
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      expect(confirm).toHaveBeenCalledTimes(6);
      expect(confirm).toHaveBeenCalledWith('Descartar as alterações não enviadas?');
      expect(onNavigate).not.toHaveBeenCalled();
      expect(screen.getByText(FAILED)).toBeInTheDocument();

      // Confirming navigates, exactly one confirm for that click.
      confirm.mockClear();
      confirm.mockReturnValue(true);
      fireEvent.click(next);
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(onNavigate).toHaveBeenCalledWith(2);
    });

    it('confirming the discard on X closes and forgets the failure (no second confirm on the next attempt)', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
      const { onNavigate } = await openWithFailedSave();
      fireEvent.click(screen.getByRole('button', { name: 'Fechar postagem' }));
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(onNavigate).toHaveBeenCalledWith(null);
      // The failure was discarded on the hook, so the failed message is gone. The panel's
      // own staged edit is still there (the mocked onNavigate never unmounts it), which
      // is the panelDirty confirm, not a second confirm for the same click.
      expect(screen.queryByText(FAILED)).not.toBeInTheDocument();
    });

    it('asks only once when both a failed save and other unsent input exist', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
      const { onNavigate } = await openWithFailedSave();
      fireEvent.change(screen.getByPlaceholderText(/Descreva o que precisa mudar/), {
        target: { value: 'comentário' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Fechar postagem' }));
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(onNavigate).toHaveBeenCalledWith(null);
    });

    it('the panel offers Tentar novamente and Descartar edição; Descartar resets the text and re-enables Aprovar', async () => {
      await openWithFailedSave();
      expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeEnabled();
      expect(screen.getByRole('button', { name: /Aprovar/ })).toBeDisabled();

      fireEvent.click(screen.getByRole('button', { name: 'Descartar edição' }));

      expect(screen.queryByText(FAILED)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Tentar novamente' })).not.toBeInTheDocument();
      expect(screen.getByDisplayValue('Legenda um')).toBeInTheDocument();
      expect(screen.queryByDisplayValue('Legenda editada')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Aprovar/ })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Próximo post' })).toBeEnabled();
      // No confirm is needed to leave now that nothing is unsent.
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      fireEvent.click(screen.getByRole('button', { name: 'Fechar postagem' }));
      expect(confirm).not.toHaveBeenCalled();
    });

    it('Tentar novamente resubmits the staged content', async () => {
      await openWithFailedSave();
      submitEditSuggestionMock.mockResolvedValue({ ok: true, pending_suggestion: null });
      fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
      // Failure UI hides right away (no flash while the retry is queued).
      expect(screen.queryByText(FAILED)).not.toBeInTheDocument();
      await settleDebounce();
      expect(submitEditSuggestionMock).toHaveBeenCalledTimes(2);
      expect(submitEditSuggestionMock.mock.calls[1]).toEqual(
        submitEditSuggestionMock.mock.calls[0],
      );
      expect(submitEditSuggestionMock.mock.calls[1][4]).toBe('Legenda editada');
    });

    it('a retry that fails again still leaves the client a way out', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
      const { onNavigate } = await openWithFailedSave();
      fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
      await settleDebounce();
      expect(submitEditSuggestionMock).toHaveBeenCalledTimes(2);
      expect(screen.getByText(FAILED)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Fechar postagem' }));
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(onNavigate).toHaveBeenCalledWith(null);
    });

    it('reopening the post after a failed save shows the failure (module memory) and it is dismissible', async () => {
      submitEditSuggestionMock.mockRejectedValue(new Error('boom'));
      renderDialog(1);
      stageAndSave();
      await settleDebounce();
      cleanup();

      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
      const { onNavigate } = renderDialog(1);
      // Remembered from the previous mount: Aprovar is blocked, but no exit is.
      expect(screen.getByRole('button', { name: /Aprovar/ })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Próximo post' })).toBeEnabled();
      fireEvent.click(screen.getByRole('button', { name: /Corrigir/ }));
      expect(screen.getByText(FAILED)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Descartar edição' }));
      expect(screen.queryByText(FAILED)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Aprovar/ })).toBeEnabled();
      fireEvent.click(screen.getByRole('button', { name: 'Próximo post' }));
      expect(confirm).not.toHaveBeenCalled();
      expect(onNavigate).toHaveBeenCalledWith(2);
    });
  });
  describe('unsent history comment', () => {
    const DRAFT_PLACEHOLDER = 'Escreva um comentário sobre este post';

    async function typeHistoryDraft(value = 'rascunho') {
      fireEvent.click(screen.getByRole('tab', { name: 'Histórico e comentários' }));
      fireEvent.click(await screen.findByRole('tab', { name: 'Comentários' }));
      fireEvent.change(await screen.findByPlaceholderText(DRAFT_PLACEHOLDER), {
        target: { value },
      });
    }

    it.each([
      ['next', () => screen.getByRole('button', { name: 'Próximo post' }), 2],
      ['strip', () => screen.getByRole('button', { name: 'Ir para Segundo' }), 2],
      ['close (X)', () => screen.getByRole('button', { name: 'Fechar postagem' }), null],
    ])('asks to discard on %s; cancel stays, confirm leaves', async (_label, getBtn, target) => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      const { onNavigate } = renderDialog(1);
      await typeHistoryDraft();
      fireEvent.click(getBtn());
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(confirm).toHaveBeenCalledWith('Descartar as alterações não enviadas?');
      expect(onNavigate).not.toHaveBeenCalled();
      expect(screen.getByPlaceholderText(DRAFT_PLACEHOLDER)).toHaveValue('rascunho');

      confirm.mockClear();
      confirm.mockReturnValue(true);
      fireEvent.click(getBtn());
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(onNavigate).toHaveBeenCalledWith(target);
    });

    it('asks to discard on prev', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      const { onNavigate } = renderDialog(2);
      await typeHistoryDraft();
      fireEvent.click(screen.getByRole('button', { name: 'Post anterior' }));
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(onNavigate).not.toHaveBeenCalled();
    });

    it('asks once when both the history draft and the correction panel are dirty', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
      const { onNavigate } = renderDialog(1);
      fireEvent.click(screen.getByRole('button', { name: /Corrigir/ }));
      fireEvent.change(screen.getByPlaceholderText(/Descreva o que precisa mudar/), {
        target: { value: 'x' },
      });
      await typeHistoryDraft();
      fireEvent.click(screen.getByRole('button', { name: 'Próximo post' }));
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(onNavigate).toHaveBeenCalledWith(2);
    });

    it('navigates without a confirm when the composer is empty or whitespace', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      const { onNavigate } = renderDialog(1);
      await typeHistoryDraft('   ');
      fireEvent.click(screen.getByRole('button', { name: 'Próximo post' }));
      expect(confirm).not.toHaveBeenCalled();
      expect(onNavigate).toHaveBeenCalledWith(2);
    });

    it('keeps the draft and the loaded history across Conteúdo -> Histórico -> Conteúdo -> Histórico', async () => {
      renderDialog(1);
      await typeHistoryDraft('meu rascunho');
      expect(fetchPostHistoryMock).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole('tab', { name: 'Legenda' }));
      // Hidden, not unmounted: the panel's own content is out of the accessibility tree.
      expect(screen.queryByPlaceholderText(DRAFT_PLACEHOLDER)).not.toBeVisible();
      expect(screen.getByText('Legenda um')).toBeVisible();
      fireEvent.click(screen.getByRole('tab', { name: 'Histórico e comentários' }));

      expect(screen.getByPlaceholderText(DRAFT_PLACEHOLDER)).toBeVisible();
      expect(screen.getByPlaceholderText(DRAFT_PLACEHOLDER)).toHaveValue('meu rascunho');
      expect(fetchPostHistoryMock).toHaveBeenCalledTimes(1);
    });

    it('does not fetch the history until the Histórico tab is first visited', () => {
      renderDialog(1);
      expect(fetchPostHistoryMock).not.toHaveBeenCalled();
    });

    it('still guards a draft typed while the panel is hidden behind the Conteúdo tab', async () => {
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
      const { onNavigate } = renderDialog(1);
      await typeHistoryDraft();
      fireEvent.click(screen.getByRole('tab', { name: 'Legenda' }));
      fireEvent.click(screen.getByRole('button', { name: 'Próximo post' }));
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(onNavigate).not.toHaveBeenCalled();
    });
  });
  describe('pending / rejected suggestion notice in the reading view', () => {
    const PENDING_NOTICE = 'Sugestão enviada para revisão da equipe';
    const REJECTED_NOTICE = /Sua sugestão anterior foi rejeitada pela equipe/;
    const suggestion = {
      id: 9,
      suggested_conteudo: null,
      suggested_conteudo_plain: 'Corpo editado',
      suggested_ig_caption: 'Legenda editada',
      changed_fields: ['ig_caption'],
      updated_at: '2026-04-28T10:00:00.000Z',
    };

    it('explains a pending suggestion without opening Corrigir, with both actions disabled', () => {
      renderDialog(1, { posts: [post({ id: 1, pending_suggestion: suggestion })] });
      expect(screen.getByText(PENDING_NOTICE)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Corrigir/ })).toBeDisabled();
      expect(screen.getByRole('button', { name: /Aprovar/ })).toBeDisabled();
      expect(screen.queryByText(REJECTED_NOTICE)).not.toBeInTheDocument();
    });

    it('nudges after a rejected suggestion in the reading view while Corrigir stays enabled', () => {
      renderDialog(1, {
        posts: [post({ id: 1, suggestion_rejected_at: '2026-04-27T10:00:00.000Z' })],
      });
      expect(screen.getByText(REJECTED_NOTICE)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Corrigir/ })).toBeEnabled();
      expect(screen.queryByText(PENDING_NOTICE)).not.toBeInTheDocument();
    });

    it('shows neither notice for a normal pending post', () => {
      renderDialog(1, { posts: [post({ id: 1 })] });
      expect(screen.queryByText(PENDING_NOTICE)).not.toBeInTheDocument();
      expect(screen.queryByText(REJECTED_NOTICE)).not.toBeInTheDocument();
    });

    it('shows neither notice for a non-pending post, even with a stale suggestion', () => {
      renderDialog(1, {
        posts: [
          post({
            id: 1,
            status: 'aprovado_cliente',
            pending_suggestion: suggestion,
            suggestion_rejected_at: '2026-04-27T10:00:00.000Z',
          }),
        ],
      });
      expect(screen.queryByText(PENDING_NOTICE)).not.toBeInTheDocument();
      expect(screen.queryByText(REJECTED_NOTICE)).not.toBeInTheDocument();
    });
  });
});

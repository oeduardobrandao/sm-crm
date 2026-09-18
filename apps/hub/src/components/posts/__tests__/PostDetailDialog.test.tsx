import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { HubContext } from '../../../HubContext';
import { PostDetailDialog } from '../PostDetailDialog';
import type { HubPost, HubPostMedia } from '../../../types';

const submitApprovalMock = vi.hoisted(() => vi.fn());
vi.mock('../../../api', () => ({
  submitApproval: submitApprovalMock,
  submitEditSuggestion: vi.fn(),
  fetchPostHistory: vi.fn().mockResolvedValue({ events: [], approvals: [] }),
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
    vi.restoreAllMocks();
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
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { HubContext } from '../../../HubContext';
import { resetEditSuggestionFailuresForTests } from '../../../hooks/useEditSuggestion';
import { PostDetailDialog } from '../PostDetailDialog';
import type { HubMediaNote, HubPost, HubPostMedia } from '../../../types';

const submitApprovalMock = vi.hoisted(() => vi.fn());
const fetchPostHistoryMock = vi.hoisted(() => vi.fn());
const createMediaNoteMock = vi.hoisted(() => vi.fn());
const replyMediaNoteMock = vi.hoisted(() => vi.fn());
vi.mock('../../../api', () => ({
  submitApproval: submitApprovalMock,
  submitEditSuggestion: vi.fn(),
  fetchPostHistory: fetchPostHistoryMock,
}));
vi.mock('../../PostMediaLightbox', () => ({
  PostMediaLightbox: ({
    initialIndex,
    initialSeek,
    onCreateNote,
  }: {
    initialIndex: number;
    initialSeek?: number;
    onCreateNote?: (input: { link_id: number; t_seconds: number; body: string }) => Promise<void>;
  }) => (
    <div data-testid="lightbox">
      lightbox {initialIndex} seek {String(initialSeek)}
      <button
        type="button"
        onClick={() => void onCreateNote?.({ link_id: 12, t_seconds: 7, body: 'Do vídeo' })}
      >
        stub-create
      </button>
    </div>
  ),
}));
vi.mock('../../../services/mediaNotes', () => ({
  createMediaNote: createMediaNoteMock,
  replyMediaNote: replyMediaNoteMock,
}));
vi.mock('../../../hooks/usePostReferences', async () => {
  const { makePostReferencesStub } = await import('../../../hooks/__tests__/postReferencesStub');
  const stub = makePostReferencesStub();
  return { usePostReferences: () => stub };
});

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
  id: 11,
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

function post(over: Partial<HubPost> = {}): HubPost {
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

function note(over: Partial<HubMediaNote> = {}): HubMediaNote {
  return {
    id: 1,
    post_id: 1,
    media_kind: 'image',
    link_id: 11,
    slide_index: 0,
    is_previous_version: false,
    t_seconds: null,
    x: 0.3,
    y: 0.3,
    author: 'client',
    author_name: null,
    body: 'Trocar a cor',
    status: 'open',
    resolved_at: null,
    created_at: '2026-10-23T00:00:00Z',
    replies: [],
    ...over,
  };
}

function renderDialog(
  p: HubPost,
  notes: HubMediaNote[] = [],
  over: Partial<React.ComponentProps<typeof PostDetailDialog>> = {},
) {
  const onApprovalSubmitted = vi.fn();
  render(
    <HubContext.Provider value={hubValue}>
      <MemoryRouter>
        <PostDetailDialog
          posts={[p]}
          currentId={p.id}
          token="token-publico"
          approvals={[]}
          mediaNotes={notes}
          instagramProfile={null}
          isAutoPublish={() => false}
          onNavigate={vi.fn()}
          onApprovalSubmitted={onApprovalSubmitted}
          {...over}
        />
      </MemoryRouter>
    </HubContext.Provider>,
  );
  return { onApprovalSubmitted };
}

// jsdom has no PointerEvent: a MouseEvent named like one carries clientX/clientY.
const pointer = (el: Element, type: string, x: number, y: number) =>
  fireEvent(el, new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));

describe('PostDetailDialog media notes', () => {
  beforeEach(() => {
    resetEditSuggestionFailuresForTests();
    submitApprovalMock.mockReset().mockResolvedValue({ ok: true });
    createMediaNoteMock.mockReset().mockResolvedValue({ ok: true, note_id: 9 });
    replyMediaNoteMock.mockReset().mockResolvedValue({ ok: true, reply_id: 3 });
    fetchPostHistoryMock
      .mockReset()
      .mockResolvedValue({ events: [], approvals: [], media_notes: [] });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 400,
      bottom: 400,
      width: 400,
      height: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('Comentar hidden when post is em_producao', () => {
    renderDialog(post({ em_producao: 'correcao' }));
    expect(screen.queryByRole('button', { name: 'Comentar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Comentar o slide inteiro' })).toBeNull();
  });

  it('Comentar is offered on an image slide of a visible post', () => {
    renderDialog(post());
    expect(screen.getByRole('button', { name: 'Comentar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Comentar o slide inteiro' })).toBeInTheDocument();
  });

  it('Comentar is hidden on a lost image slide', () => {
    renderDialog(post({ media: [{ ...MEDIA, media_lost_at: '2026-08-01T00:00:00Z' }] }));
    expect(screen.queryByRole('button', { name: 'Comentar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Comentar o slide inteiro' })).toBeNull();
  });

  it('a video slide offers Comentar (no whole-slide button) and it opens the lightbox there', () => {
    renderDialog(
      post({
        tipo: 'reels',
        media: [{ ...MEDIA, kind: 'video', thumbnail_url: 'https://cdn/t.jpg' }],
      }),
    );
    expect(screen.queryByRole('button', { name: 'Comentar o slide inteiro' })).toBeNull();
    const comment = screen.getByRole('button', { name: 'Comentar' });
    // Not a placing toggle: the moment is picked in the lightbox.
    expect(comment).not.toHaveAttribute('aria-pressed');
    fireEvent.click(comment);
    expect(screen.getByTestId('lightbox')).toHaveTextContent('lightbox 0 seek undefined');
  });

  it('Comentar on the video slide of a carousel opens the lightbox on that slide', () => {
    renderDialog(
      post({
        media: [
          MEDIA,
          { ...MEDIA, id: 12, kind: 'video', thumbnail_url: 'https://cdn/t.jpg', sort_order: 1 },
        ],
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Próximo slide' }));
    expect(screen.queryByRole('button', { name: 'Comentar o slide inteiro' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Comentar' }));
    expect(screen.getByTestId('lightbox')).toHaveTextContent('lightbox 1 seek undefined');
  });

  it('Comentar is hidden on a lost video slide', () => {
    const video = { ...MEDIA, kind: 'video' as const, thumbnail_url: 'https://cdn/t.jpg' };
    renderDialog(
      post({ tipo: 'reels', media: [{ ...video, media_lost_at: '2026-08-01T00:00:00Z' }] }),
    );
    expect(screen.queryByRole('button', { name: 'Comentar' })).toBeNull();
  });

  it('Comentar is hidden on a video post in production', () => {
    const video = { ...MEDIA, kind: 'video' as const, thumbnail_url: 'https://cdn/t.jpg' };
    renderDialog(post({ tipo: 'reels', media: [video], em_producao: 'correcao' }));
    expect(screen.queryByRole('button', { name: 'Comentar' })).toBeNull();
  });

  it('pin then send calls createMediaNote with link id and coords, then onApprovalSubmitted', async () => {
    const { onApprovalSubmitted } = renderDialog(post());
    fireEvent.click(screen.getByRole('button', { name: 'Comentar' }));
    expect(screen.getByRole('status')).toHaveTextContent('Toque na imagem para marcar um ponto');
    const capture = screen.getByRole('button', { name: 'Toque na imagem para marcar um ponto' });
    pointer(capture, 'pointerdown', 200, 200);
    pointer(capture, 'pointerup', 200, 200);
    const field = await screen.findByPlaceholderText('O que você quer mudar aqui?');
    fireEvent.change(field, { target: { value: '  Mais contraste  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar comentário' }));
    await waitFor(() =>
      expect(createMediaNoteMock).toHaveBeenCalledWith('token-publico', {
        post_id: 1,
        link_id: 11,
        x: 0.5,
        y: 0.5,
        body: 'Mais contraste',
      }),
    );
    await waitFor(() => expect(onApprovalSubmitted).toHaveBeenCalled());
  });

  it('cancelling the composer clears the pending pin', async () => {
    renderDialog(post());
    fireEvent.click(screen.getByRole('button', { name: 'Comentar' }));
    const capture = screen.getByRole('button', { name: 'Toque na imagem para marcar um ponto' });
    pointer(capture, 'pointerdown', 200, 200);
    pointer(capture, 'pointerup', 200, 200);
    await screen.findByPlaceholderText('O que você quer mudar aqui?');
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() =>
      expect(screen.queryByPlaceholderText('O que você quer mudar aqui?')).toBeNull(),
    );
    expect(createMediaNoteMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('media-pin-pending')).toBeNull();
  });

  it('Comentar o slide inteiro sends a note with no coordinates', async () => {
    renderDialog(post());
    fireEvent.click(screen.getByRole('button', { name: 'Comentar o slide inteiro' }));
    const field = await screen.findByPlaceholderText('O que você quer mudar aqui?');
    fireEvent.change(field, { target: { value: 'Refazer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar comentário' }));
    await waitFor(() =>
      expect(createMediaNoteMock).toHaveBeenCalledWith('token-publico', {
        post_id: 1,
        link_id: 11,
        body: 'Refazer',
      }),
    );
  });

  it('Aprovar with 2 open notes asks for confirmation, confirm calls submitApproval aprovado', async () => {
    renderDialog(post(), [note({ id: 1 }), note({ id: 2, body: 'Outra' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Aprovar' }));
    expect(submitApprovalMock).not.toHaveBeenCalled();
    expect((await screen.findAllByText('Você tem 2 comentários em aberto')).length).toBeGreaterThan(
      0,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Aprovar mesmo assim' }));
    await waitFor(() =>
      expect(submitApprovalMock).toHaveBeenCalledWith('token-publico', 1, 'aprovado', undefined),
    );
  });

  it('cancelling the approve confirmation does not approve', async () => {
    renderDialog(post(), [note()]);
    fireEvent.click(screen.getByRole('button', { name: 'Aprovar' }));
    expect((await screen.findAllByText('Você tem 1 comentário em aberto')).length).toBeGreaterThan(
      0,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByText('Aprovar mesmo assim')).toBeNull());
    expect(submitApprovalMock).not.toHaveBeenCalled();
  });

  it('Aprovar with no open notes approves directly', async () => {
    renderDialog(post(), [note({ status: 'resolved', resolved_at: '2026-10-24T00:00:00Z' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Aprovar' }));
    await waitFor(() =>
      expect(submitApprovalMock).toHaveBeenCalledWith('token-publico', 1, 'aprovado', undefined),
    );
    expect(screen.queryByText('Aprovar mesmo assim')).toBeNull();
  });

  it('notes list renders in content tab', () => {
    renderDialog(post(), [note({ body: 'Trocar a cor da fonte' })]);
    expect(screen.getByText('Comentários na mídia')).toBeInTheDocument();
    expect(screen.getAllByText('Trocar a cor da fonte').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Slide 1 · ponto 1' })).toBeInTheDocument();
  });

  it('jumping to an image note moves the pane to its slide', () => {
    const second = { ...MEDIA, id: 12, sort_order: 1 };
    renderDialog(post({ media: [MEDIA, second] }), [
      note({ id: 7, link_id: 12, slide_index: 1, x: null, y: null, body: 'Segundo slide' }),
    ]);
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Slide 2' }));
    expect(screen.getByText('2 / 2')).toBeInTheDocument();
  });

  it('jumping to a video note opens the lightbox at it', () => {
    const video = {
      ...MEDIA,
      id: 12,
      kind: 'video' as const,
      thumbnail_url: 'https://cdn/t.jpg',
      sort_order: 1,
    };
    renderDialog(post({ media: [MEDIA, video] }), [
      note({
        id: 8,
        link_id: 12,
        media_kind: 'video',
        slide_index: 1,
        t_seconds: 5,
        x: null,
        y: null,
        body: 'Na cena',
      }),
    ]);
    fireEvent.click(screen.getByRole('button', { name: '0:05' }));
    expect(screen.getByTestId('lightbox')).toHaveTextContent('lightbox 1 seek 5');
  });

  it('a plain open of the lightbox does not seek', () => {
    renderDialog(post());
    fireEvent.click(screen.getByRole('button', { name: 'Abrir mídia 1' }));
    expect(screen.getByTestId('lightbox')).toHaveTextContent('seek undefined');
  });

  it('a moment note made in the lightbox goes through the dialog write path', async () => {
    const video = {
      ...MEDIA,
      id: 12,
      kind: 'video' as const,
      thumbnail_url: 'https://cdn/t.jpg',
      sort_order: 1,
    };
    const { onApprovalSubmitted } = renderDialog(post({ media: [MEDIA, video] }), [
      note({ id: 8, link_id: 12, media_kind: 'video', t_seconds: 5, x: null, y: null }),
    ]);
    fireEvent.click(screen.getByRole('button', { name: '0:05' }));
    fireEvent.click(screen.getByRole('button', { name: 'stub-create' }));
    await waitFor(() =>
      expect(createMediaNoteMock).toHaveBeenCalledWith('token-publico', {
        post_id: 1,
        link_id: 12,
        t_seconds: 7,
        body: 'Do vídeo',
      }),
    );
    await waitFor(() => expect(onApprovalSubmitted).toHaveBeenCalled());
  });

  it('approving a post that is no longer pending shows the server message and refetches', async () => {
    submitApprovalMock.mockRejectedValue(new Error('Post não está mais aguardando aprovação.'));
    const { onApprovalSubmitted } = renderDialog(post());
    fireEvent.click(screen.getByRole('button', { name: 'Aprovar' }));
    expect(await screen.findByText('Post não está mais aguardando aprovação.')).toBeInTheDocument();
    expect(onApprovalSubmitted).toHaveBeenCalled();
  });

  it('any other approve failure keeps the generic message and does not refetch', async () => {
    submitApprovalMock.mockRejectedValue(new Error('HTTP 500'));
    const { onApprovalSubmitted } = renderDialog(post());
    fireEvent.click(screen.getByRole('button', { name: 'Aprovar' }));
    expect(
      await screen.findByText('Não foi possível enviar. Tente novamente.'),
    ).toBeInTheDocument();
    expect(onApprovalSubmitted).not.toHaveBeenCalled();
  });

  it('replying sends replyMediaNote then onApprovalSubmitted', async () => {
    const { onApprovalSubmitted } = renderDialog(post(), [note({ id: 5 })]);
    fireEvent.change(screen.getByRole('textbox', { name: 'Responder' }), {
      target: { value: 'Combinado' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Responder' }));
    await waitFor(() =>
      expect(replyMediaNoteMock).toHaveBeenCalledWith('token-publico', 5, 'Combinado'),
    );
    await waitFor(() => expect(onApprovalSubmitted).toHaveBeenCalled());
  });

  it('em_producao: the list is read-only (no reply field)', () => {
    renderDialog(post({ em_producao: 'ajuste' }), [note()]);
    expect(screen.queryByRole('textbox', { name: 'Responder' })).toBeNull();
  });
});

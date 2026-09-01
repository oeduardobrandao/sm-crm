import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComponentProps } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConversationThread } from '../ConversationThread';
import type { MensagemConversa, MensagemFeedItem } from '@/store';

const { mockPreview, mockMedia } = vi.hoisted(() => ({
  mockPreview: vi.fn(),
  mockMedia: vi.fn(),
}));

vi.mock('@/store', () => ({ getPostChipPreview: mockPreview }));
vi.mock('@/services/postMedia', () => ({ listPostMedia: mockMedia }));

// The repo's global afterEach calls vi.restoreAllMocks(), which strips a
// mockResolvedValue set only once at module scope — re-arm every test so a
// later test doesn't see these resolve to bare undefined (PostChip's
// useQuery flags that as an error, and it's order-dependent: only breaks
// when this file runs after another test already triggered the reset).
beforeEach(() => {
  mockPreview.mockResolvedValue(null);
  mockMedia.mockResolvedValue([]);
});

const CONVERSA: MensagemConversa = {
  cliente_id: 14,
  cliente_nome: 'ACME',
  cliente_foto_url: null,
  last_source: 'mensagem',
  last_action: null,
  last_content: 'Obrigado!',
  last_is_workspace_user: false,
  last_author_name: null,
  last_created_at: '2026-07-30T12:00:00.000Z',
  unread_count: 0,
};

const ITEMS: MensagemFeedItem[] = [
  {
    source: 'post_feedback',
    item_id: 1,
    cliente_id: 14,
    cliente_nome: 'ACME',
    post_id: 7,
    workflow_id: 3,
    post_titulo: 'Post de julho',
    action: 'correcao',
    content: 'Trocar a foto',
    is_workspace_user: false,
    author_user_id: null,
    author_name: null,
    author_avatar_url: null,
    created_at: '2026-07-30T10:00:00.000Z',
  },
  {
    source: 'mensagem',
    item_id: 2,
    cliente_id: 14,
    cliente_nome: 'ACME',
    post_id: null,
    workflow_id: null,
    post_titulo: null,
    action: null,
    content: 'Obrigado!',
    is_workspace_user: false,
    author_user_id: null,
    author_name: null,
    author_avatar_url: null,
    created_at: '2026-07-30T12:00:00.000Z',
  },
];

function makeFeed(overrides: Record<string, unknown> = {}) {
  return {
    data: { pages: [ITEMS] },
    isLoading: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
    ...overrides,
  } as unknown as ComponentProps<typeof ConversationThread>['feed'];
}

function makeMutation(overrides: Record<string, unknown> = {}) {
  return {
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
    ...overrides,
  } as unknown as ComponentProps<typeof ConversationThread>['sendGeneral'];
}

function renderThread(overrides: Partial<ComponentProps<typeof ConversationThread>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const sendGeneral = makeMutation();
  const replyToPost = makeMutation();
  const utils = render(
    <BrowserRouter>
      <QueryClientProvider client={qc}>
        <ConversationThread
          conversa={CONVERSA}
          feed={makeFeed()}
          sendGeneral={sendGeneral}
          replyToPost={replyToPost}
          clientesById={new Map()}
          {...overrides}
        />
      </QueryClientProvider>
    </BrowserRouter>,
  );
  return { ...utils, sendGeneral, replyToPost };
}

describe('ConversationThread', () => {
  it('renders the header and messages in chronological order', () => {
    renderThread();
    expect(screen.getByText('ACME')).toBeInTheDocument();
    const bolhas = screen.getAllByText(/Trocar a foto|Obrigado!/);
    expect(bolhas[0]).toHaveTextContent('Trocar a foto');
  });

  it('shows a back button only when onBack is provided', () => {
    renderThread();
    expect(
      screen.queryByRole('button', { name: 'Voltar para as conversas' }),
    ).not.toBeInTheDocument();
    const onBack = vi.fn();
    renderThread({ onBack });
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para as conversas' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('filters visible items by tipo', () => {
    renderThread();
    fireEvent.click(screen.getByRole('button', { name: 'Aprovações' }));
    expect(screen.queryByText('Obrigado!')).not.toBeInTheDocument();
    expect(screen.getByText('Trocar a foto')).toBeInTheDocument();
  });

  it('sends a general message from the composer', async () => {
    const { sendGeneral } = renderThread();
    const input = screen.getByPlaceholderText('Enviar mensagem…');
    fireEvent.change(input, { target: { value: 'Olá' } });
    // enviar() is async (awaits mutateAsync before its own setState calls) —
    // wrap the triggering event in act() so those updates settle inside the
    // test instead of firing after it returns (that's what an un-awaited
    // fireEvent.keyDown here produces: a real "not wrapped in act(...)"
    // warning, not just theoretical noise).
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(sendGeneral.mutateAsync).toHaveBeenCalledWith({ cliente: 14, content: 'Olá' });
  });

  it('switches to the reply composer via Responder', () => {
    renderThread();
    fireEvent.click(screen.getByRole('button', { name: 'Responder' }));
    expect(screen.getByPlaceholderText('Responder sobre o post…')).toBeInTheDocument();
  });

  it('sends a reply with the post context via the composer', async () => {
    const { replyToPost, sendGeneral } = renderThread();
    fireEvent.click(screen.getByRole('button', { name: 'Responder' }));
    const input = screen.getByPlaceholderText('Responder sobre o post…');
    fireEvent.change(input, { target: { value: 'Feito' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(replyToPost.mutateAsync).toHaveBeenCalledWith({
      postId: 7,
      workflowId: 3,
      content: 'Feito',
    });
    expect(sendGeneral.mutateAsync).not.toHaveBeenCalled();
  });

  it('shows a retriable error, not "no messages", when the feed fails to load', () => {
    const feed = makeFeed({ isError: true, data: undefined });
    renderThread({ feed });
    expect(screen.getByText('Não foi possível carregar as mensagens.')).toBeInTheDocument();
    expect(screen.queryByText('Nenhuma mensagem nesta conversa ainda.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(feed.refetch).toHaveBeenCalledTimes(1);
  });

  it('shows the hover preview with tipo, status and fluxo on the post chip', async () => {
    mockPreview.mockResolvedValueOnce({
      id: 7,
      titulo: 'Post de julho',
      tipo: 'feed',
      status: 'aprovado_cliente',
      scheduled_at: null,
      workflow_id: 3,
      workflow_titulo: 'Fluxo de agosto',
    });
    renderThread();
    const chip = screen.getByRole('link', { name: 'Post de julho' });
    fireEvent.mouseEnter(chip.parentElement!);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    const card = await screen.findByTestId('post-hover-preview');
    expect(card).toHaveTextContent('Feed');
    expect(card).toHaveTextContent('Fluxo de agosto');
    fireEvent.mouseLeave(chip.parentElement!);
    await waitFor(() => expect(screen.queryByTestId('post-hover-preview')).not.toBeInTheDocument());
  });

  it('links the post chip to the post inside its fluxo, not just the fluxo', () => {
    renderThread();
    const chip = screen.getByRole('link', { name: 'Post de julho' });
    expect(chip).toHaveAttribute('href', '/entregas?drawer=3&post=7');
  });

  it('shows the post chip and lets replying on a post avulso (workflow_id null), gated only on post_id', async () => {
    const avulsoItems: MensagemFeedItem[] = [
      {
        source: 'post_feedback',
        item_id: 9,
        cliente_id: 14,
        cliente_nome: 'ACME',
        post_id: 21,
        workflow_id: null,
        post_titulo: 'Post avulso',
        action: 'correcao',
        content: 'Trocar a legenda',
        is_workspace_user: false,
        author_user_id: null,
        author_name: null,
        author_avatar_url: null,
        created_at: '2026-07-30T11:00:00.000Z',
      },
    ];
    const { replyToPost } = renderThread({ feed: makeFeed({ data: { pages: [avulsoItems] } }) });

    const chip = screen.getByRole('link', { name: 'Post avulso' });
    expect(chip).toHaveAttribute('href', '/entregas?post=21');

    fireEvent.click(screen.getByRole('button', { name: 'Responder' }));
    const input = screen.getByPlaceholderText('Responder sobre o post…');
    fireEvent.change(input, { target: { value: 'Feito' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(replyToPost.mutateAsync).toHaveBeenCalledWith({
      postId: 21,
      workflowId: null,
      content: 'Feito',
    });
  });
});

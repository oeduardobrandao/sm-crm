import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { mockFeed, mockConversas, mockClientes, mockSend, mockReply, mockSeen } = vi.hoisted(() => ({
  mockFeed: vi.fn(),
  mockConversas: vi.fn(),
  mockClientes: vi.fn(),
  mockSend: vi.fn().mockResolvedValue(undefined),
  mockReply: vi.fn().mockResolvedValue(undefined),
  mockSeen: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/store', () => ({
  getMensagensFeed: mockFeed,
  getMensagensConversas: mockConversas,
  getClientes: mockClientes,
  sendMensagem: mockSend,
  replyToPostApproval: mockReply,
  markMensagensSeen: mockSeen,
}));

// PostChip's own hover-preview queries are covered by ConversationThread.test.tsx.
// Mocked here only so the real (Supabase-touching) module never loads.
vi.mock('@/services/postMedia', () => ({ listPostMedia: vi.fn() }));

// This file only exercises the pre-existing Clientes-only behavior, so the
// workspace is mocked with feature_mensagens on / feature_team_chat off
// (mirrors every workspace before team chat existed) and the entitlement
// check pre-resolved, the same way ProtectedRoute already gates the route in
// production. The Equipe-tab / dual-flag behavior has its own coverage in
// MensagensPage.flags.test.tsx.
let mockWorkspaceFeatures: Record<string, boolean> = {
  feature_mensagens: true,
  feature_team_chat: false,
};
let mockLimitsLoading = false;
vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({ features: mockWorkspaceFeatures, isLoading: mockLimitsLoading }),
}));

import MensagensPage from '../MensagensPage';

const CONVERSAS = [
  {
    cliente_id: 14,
    cliente_nome: 'ACME',
    cliente_foto_url: null,
    last_source: 'mensagem',
    last_action: null,
    last_content: 'Obrigado!',
    last_is_workspace_user: false,
    last_author_name: null,
    last_created_at: '2026-07-30T12:00:00.000Z',
    unread_count: 2,
  },
  {
    cliente_id: 15,
    cliente_nome: 'Beta Corp',
    cliente_foto_url: 'https://cdn.example.com/beta.png',
    last_source: 'post_feedback',
    last_action: 'mensagem',
    last_content: 'Segue o ajuste combinado.',
    last_is_workspace_user: true,
    last_author_name: 'Ana',
    last_created_at: '2026-07-31T09:00:00.000Z',
    unread_count: 0,
  },
];

const ITEMS_14 = [
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

function PathProbe() {
  const location = useLocation();
  return <div data-testid="current-path">{location.pathname}</div>;
}

function mockMatchMedia(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function renderPage(initialPath = '/mensagens') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route
            path="/mensagens"
            element={
              <>
                <MensagensPage />
                <PathProbe />
              </>
            }
          />
          <Route
            path="/mensagens/:clienteId"
            element={
              <>
                <MensagensPage />
                <PathProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, qc };
}

describe('MensagensPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspaceFeatures = { feature_mensagens: true, feature_team_chat: false };
    mockLimitsLoading = false;
    mockFeed.mockImplementation(({ clienteId }: { clienteId?: number }) =>
      Promise.resolve(clienteId === 14 ? ITEMS_14 : []),
    );
    mockConversas.mockResolvedValue(CONVERSAS);
    mockClientes.mockResolvedValue([
      { id: 14, nome: 'ACME', sigla: 'AC', cor: '#3ecf8e' },
      { id: 15, nome: 'Beta Corp', sigla: 'BC', cor: '#42c8f5' },
    ]);
    mockSend.mockResolvedValue(undefined);
    mockReply.mockResolvedValue(undefined);
    mockSeen.mockResolvedValue(undefined);
  });

  it('mobile (default): shows only the list, opens a thread by URL, and returns via back', async () => {
    renderPage();
    expect(await screen.findByText('ACME')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Enviar mensagem…')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('conversa-14'));
    expect(screen.getByTestId('current-path')).toHaveTextContent('/mensagens/14');
    await screen.findByText('Trocar a foto');
    expect(mockFeed).toHaveBeenCalledWith(expect.objectContaining({ clienteId: 14 }));
    expect(screen.queryByTestId('conversa-15')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Voltar para as conversas' }));
    expect(screen.getByTestId('current-path')).toHaveTextContent('/mensagens');
    expect(await screen.findByTestId('conversa-15')).toBeInTheDocument();
  });

  it('desktop: renders the list and the thread at the same time, with a placeholder until one is picked', async () => {
    mockMatchMedia(true);
    renderPage();
    expect(await screen.findByText('ACME')).toBeInTheDocument();
    expect(screen.getByText('Selecione uma conversa')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('conversa-14'));
    await screen.findByText('Trocar a foto');
    expect(screen.getByTestId('conversa-15')).toBeInTheDocument();
    expect(screen.queryByText('Selecione uma conversa')).not.toBeInTheDocument();
  });

  it('/mensagens/999 (unknown id) shows the not-found state with a link back', async () => {
    mockMatchMedia(true);
    renderPage('/mensagens/999');
    expect(await screen.findByText('Conversa não encontrada.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar para as conversas' })).toHaveAttribute(
      'href',
      '/mensagens',
    );
    expect(mockFeed).not.toHaveBeenCalled();
  });

  it('/mensagens/abc (non-numeric id) shows not-found immediately without fetching', async () => {
    renderPage('/mensagens/abc');
    expect(await screen.findByText('Conversa não encontrada.')).toBeInTheDocument();
    expect(mockFeed).not.toHaveBeenCalled();
  });

  it('shows a retriable error, not "not found", when the conversation list fails to load', async () => {
    mockConversas.mockRejectedValueOnce(new Error('network'));
    renderPage('/mensagens/14');
    expect(await screen.findByText('Não foi possível carregar as conversas.')).toBeInTheDocument();
    expect(screen.queryByText('Conversa não encontrada.')).not.toBeInTheDocument();

    mockConversas.mockResolvedValueOnce(CONVERSAS);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await screen.findByText('Trocar a foto');
  });

  it('does not tear down an open thread or the list when a background conversas refetch fails', async () => {
    mockMatchMedia(true);
    const { qc } = renderPage('/mensagens/14');
    await screen.findByText('Trocar a foto');
    expect(screen.getByTestId('conversa-15')).toBeInTheDocument();

    // Simulate a background refetch (window refocus, the seen-marker's
    // post-mount invalidation, ...) that fails on top of already-cached,
    // still-valid data — `conversas.data` stays populated, only
    // `conversas.isError` flips true.
    mockConversas.mockRejectedValueOnce(new Error('network'));
    await act(async () => {
      await qc.refetchQueries({ queryKey: ['mensagens-conversas'] });
    });

    // The open thread and its draft-bearing composer stay mounted...
    expect(screen.getByText('Trocar a foto')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enviar mensagem…')).toBeInTheDocument();
    // ...and the list keeps showing its (still-valid, cached) rows instead
    // of a self-contradictory "couldn't load" message above them.
    expect(screen.getByTestId('conversa-14')).toBeInTheDocument();
    expect(screen.getByTestId('conversa-15')).toBeInTheDocument();
    expect(screen.queryByText('Não foi possível carregar as conversas.')).not.toBeInTheDocument();
  });

  it('resets thread-scoped state (reply target, draft) when switching conversations', async () => {
    mockMatchMedia(true);
    renderPage('/mensagens/14');
    await screen.findByText('Trocar a foto');
    fireEvent.click(screen.getByRole('button', { name: 'Responder' }));
    expect(screen.getByPlaceholderText('Responder sobre o post…')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('conversa-15'));
    await waitFor(() =>
      expect(screen.getByPlaceholderText('Enviar mensagem…')).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByPlaceholderText('Enviar mensagem…'), { target: { value: 'Olá' } });
    fireEvent.keyDown(screen.getByPlaceholderText('Enviar mensagem…'), { key: 'Enter' });
    await waitFor(() => expect(mockSend).toHaveBeenCalledWith(15, 'Olá'));
    expect(mockReply).not.toHaveBeenCalled();
  });

  it('does not disturb an open thread when the list is filtered to a different client', async () => {
    mockMatchMedia(true);
    renderPage('/mensagens/14');
    await screen.findByText('Trocar a foto');

    fireEvent.change(screen.getByLabelText('Buscar cliente'), { target: { value: 'beta' } });
    expect(screen.queryByTestId('conversa-14')).not.toBeInTheDocument();
    expect(screen.getByText('Trocar a foto')).toBeInTheDocument();
  });

  it('marks the feed seen on mount', async () => {
    renderPage();
    await waitFor(() => expect(mockSeen).toHaveBeenCalledTimes(1));
  });

  it('does not fetch the feed when no conversation is selected', async () => {
    renderPage();
    await screen.findByText('ACME');
    expect(mockFeed).not.toHaveBeenCalled();
  });

  it('fetches the feed for a deep-linked conversation and scrolls to the newest message', async () => {
    let resolveFeed!: (items: typeof ITEMS_14) => void;
    mockFeed.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFeed = resolve;
        }),
    );

    renderPage('/mensagens/14');
    const scrollEl = await screen.findByTestId('thread-scroll');
    Object.defineProperty(scrollEl, 'scrollHeight', { value: 999, configurable: true });
    const scrollTopSpy = vi.fn();
    Object.defineProperty(scrollEl, 'scrollTop', {
      get: () => 0,
      set: scrollTopSpy,
      configurable: true,
    });

    await act(async () => {
      resolveFeed(ITEMS_14);
      await Promise.resolve();
    });
    await screen.findByText('Trocar a foto');

    expect(scrollTopSpy).toHaveBeenCalledWith(999);
  });

  it('replies to a post via the Responder flow', async () => {
    renderPage('/mensagens/14');
    await screen.findByText('Trocar a foto');
    fireEvent.click(screen.getByRole('button', { name: 'Responder' }));
    const input = screen.getByPlaceholderText('Responder sobre o post…');
    fireEvent.change(input, { target: { value: 'Feito' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(mockReply).toHaveBeenCalledWith(7, 3, 'Feito'));
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('does not send twice on a rapid double Enter', async () => {
    let resolveSend!: () => void;
    mockSend.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = resolve;
        }),
    );
    renderPage('/mensagens/14');
    await screen.findByText('Trocar a foto');
    const input = screen.getByPlaceholderText('Enviar mensagem…');
    fireEvent.change(input, { target: { value: 'Olá' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Enviar mensagem' })).toBeDisabled(),
    );
    fireEvent.keyDown(input, { key: 'Enter' });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    resolveSend();
    await waitFor(() => expect(input).toHaveValue(''));
  });

  it('keeps the reply draft when the send fails', async () => {
    mockReply.mockRejectedValueOnce(new Error('network error'));
    renderPage('/mensagens/14');
    await screen.findByText('Trocar a foto');
    fireEvent.click(screen.getByRole('button', { name: 'Responder' }));
    const input = screen.getByPlaceholderText('Responder sobre o post…');
    fireEvent.change(input, { target: { value: 'Feito' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(mockReply).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByPlaceholderText('Responder sobre o post…')).toHaveValue('Feito');
  });
});

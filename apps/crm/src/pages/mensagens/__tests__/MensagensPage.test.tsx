import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const {
  mockFeed,
  mockConversas,
  mockClientes,
  mockSend,
  mockReply,
  mockSeen,
  mockPreview,
  mockMedia,
} = vi.hoisted(() => ({
  mockFeed: vi.fn(),
  mockConversas: vi.fn(),
  mockClientes: vi.fn(),
  mockSend: vi.fn().mockResolvedValue(undefined),
  mockReply: vi.fn().mockResolvedValue(undefined),
  mockSeen: vi.fn().mockResolvedValue(undefined),
  mockPreview: vi.fn(),
  mockMedia: vi.fn(),
}));

vi.mock('@/store', () => ({
  getMensagensFeed: mockFeed,
  getMensagensConversas: mockConversas,
  getClientes: mockClientes,
  sendMensagem: mockSend,
  replyToPostApproval: mockReply,
  markMensagensSeen: mockSeen,
  getPostChipPreview: mockPreview,
}));

vi.mock('@/services/postMedia', () => ({
  listPostMedia: mockMedia,
}));

import MensagensPage from '../MensagensPage';

const CONVERSAS = [
  {
    cliente_id: 14,
    cliente_nome: 'ACME',
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
    last_source: 'post_feedback',
    last_action: 'mensagem',
    last_content: 'Segue o ajuste combinado.',
    last_is_workspace_user: true,
    last_author_name: 'Ana',
    last_created_at: '2026-07-31T09:00:00.000Z',
    unread_count: 0,
  },
];

const ITEMS = [
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

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/mensagens']}>
        <MensagensPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function abrirConversaAcme() {
  renderPage();
  fireEvent.click(await screen.findByTestId('conversa-14'));
  await screen.findByText('Trocar a foto');
}

describe('MensagensPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFeed.mockResolvedValue(ITEMS);
    mockConversas.mockResolvedValue(CONVERSAS);
    mockClientes.mockResolvedValue([
      { id: 14, nome: 'ACME', sigla: 'AC', cor: '#3ecf8e' },
      { id: 15, nome: 'Beta Corp', sigla: 'BC', cor: '#42c8f5' },
    ]);
    // The repo's global afterEach calls vi.restoreAllMocks(); re-arm everything.
    mockSend.mockResolvedValue(undefined);
    mockReply.mockResolvedValue(undefined);
    mockSeen.mockResolvedValue(undefined);
    mockPreview.mockResolvedValue({
      id: 7,
      titulo: 'Post de julho',
      tipo: 'feed',
      status: 'aprovado_cliente',
      scheduled_at: null,
      workflow_id: 3,
      workflow_titulo: 'Fluxo de agosto',
    });
    mockMedia.mockResolvedValue([]);
  });

  it('renders the conversation list with preview, unread badge and agency prefix', async () => {
    renderPage();
    expect(await screen.findByText('ACME')).toBeInTheDocument();
    expect(screen.getByText('Obrigado!')).toBeInTheDocument();
    expect(screen.getByText('Ana: Segue o ajuste combinado.')).toBeInTheDocument();
    const acmeRow = screen.getByTestId('conversa-14');
    expect(acmeRow).toHaveTextContent('2');
  });

  it('sorts conversations by recency by default and flips to oldest', async () => {
    renderPage();
    await screen.findByText('ACME');
    const nomes = () =>
      [screen.getByTestId('conversa-15'), screen.getByTestId('conversa-14')].map((el) =>
        el.compareDocumentPosition(screen.getByTestId('conversa-14')),
      );
    // recentes: Beta Corp (jul 31) before ACME (jul 30)
    expect(
      screen.getByTestId('conversa-15').compareDocumentPosition(screen.getByTestId('conversa-14')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Mais recentes/ }));
    await waitFor(() =>
      expect(
        screen
          .getByTestId('conversa-14')
          .compareDocumentPosition(screen.getByTestId('conversa-15')) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy(),
    );
    void nomes;
  });

  it('opens a thread in chronological order and returns via back', async () => {
    await abrirConversaAcme();
    expect(mockFeed).toHaveBeenCalledWith(expect.objectContaining({ clienteId: 14 }));
    const bolhas = screen.getAllByText(/Trocar a foto|Obrigado!/);
    expect(bolhas[0]).toHaveTextContent('Trocar a foto');
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para as conversas' }));
    expect(await screen.findByTestId('conversa-15')).toBeInTheDocument();
  });

  it('sends a general message from the thread composer', async () => {
    await abrirConversaAcme();
    const input = screen.getByPlaceholderText('Enviar mensagem…');
    fireEvent.change(input, { target: { value: 'Olá' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(mockSend).toHaveBeenCalledWith(14, 'Olá'));
  });

  it('replies to a post via the Responder flow', async () => {
    await abrirConversaAcme();
    fireEvent.click(screen.getByRole('button', { name: 'Responder' }));
    const input = screen.getByPlaceholderText('Responder sobre o post…');
    fireEvent.change(input, { target: { value: 'Feito' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(mockReply).toHaveBeenCalledWith(7, 3, 'Feito'));
  });

  it('marks the feed seen on mount', async () => {
    renderPage();
    await waitFor(() => expect(mockSeen).toHaveBeenCalledTimes(1));
  });

  it('does not send twice on a rapid double Enter', async () => {
    let resolveSend!: () => void;
    mockSend.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = resolve;
        }),
    );
    await abrirConversaAcme();
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
    await abrirConversaAcme();
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

  it('shows the hover preview with tipo, status and fluxo on the post chip', async () => {
    await abrirConversaAcme();
    const chip = screen.getByRole('link', { name: 'Post de julho' });
    fireEvent.mouseEnter(chip.parentElement!);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    await waitFor(() => expect(mockPreview).toHaveBeenCalledWith(7));
    const card = await screen.findByTestId('post-hover-preview');
    expect(card).toHaveTextContent('Feed');
    expect(card).toHaveTextContent('Fluxo de agosto');
    fireEvent.mouseLeave(chip.parentElement!);
    await waitFor(() => expect(screen.queryByTestId('post-hover-preview')).not.toBeInTheDocument());
  });
});

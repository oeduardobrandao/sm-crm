import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { mockFeed, mockUnread, mockClientes, mockSend, mockReply, mockSeen } = vi.hoisted(() => ({
  mockFeed: vi.fn(),
  mockUnread: vi.fn(),
  mockClientes: vi.fn(),
  mockSend: vi.fn().mockResolvedValue(undefined),
  mockReply: vi.fn().mockResolvedValue(undefined),
  mockSeen: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/store', () => ({
  getMensagensFeed: mockFeed,
  getMensagensUnread: mockUnread,
  getClientes: mockClientes,
  sendMensagem: mockSend,
  replyToPostApproval: mockReply,
  markMensagensSeen: mockSeen,
}));

import MensagensPage from '../MensagensPage';

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

describe('MensagensPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFeed.mockResolvedValue(ITEMS);
    mockUnread.mockResolvedValue([]);
    mockClientes.mockResolvedValue([{ id: 14, nome: 'ACME' }]);
    // The repo's global afterEach calls vi.restoreAllMocks(), which strips the
    // implementation off vi.hoisted mocks after the first test runs — so every
    // resolved-value mock (not just the ones read via assertions) has to be
    // re-armed here, not only once at module scope.
    mockSend.mockResolvedValue(undefined);
    mockReply.mockResolvedValue(undefined);
    mockSeen.mockResolvedValue(undefined);
  });

  it('renders feed items with the post deep link', async () => {
    renderPage();
    expect(await screen.findByText('Trocar a foto')).toBeInTheDocument();
    expect(screen.getByText('Obrigado!')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Post de julho' })).toHaveAttribute(
      'href',
      '/entregas?drawer=3',
    );
  });

  it('shows the general composer only after selecting a client, then sends', async () => {
    renderPage();
    await screen.findByText('Obrigado!');
    expect(screen.queryByPlaceholderText(/mensagem geral/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filtrar por cliente'), { target: { value: '14' } });
    const input = await screen.findByPlaceholderText(/mensagem geral/);
    fireEvent.change(input, { target: { value: 'Olá' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(mockSend).toHaveBeenCalledWith(14, 'Olá'));
  });

  it('replies inline to a post item', async () => {
    renderPage();
    await screen.findByText('Trocar a foto');
    fireEvent.click(screen.getByRole('button', { name: 'Responder' }));
    const replyInput = screen.getByPlaceholderText('Responder ao cliente…');
    fireEvent.change(replyInput, { target: { value: 'Feito' } });
    fireEvent.keyDown(replyInput, { key: 'Enter' });
    await waitFor(() => expect(mockReply).toHaveBeenCalledWith(7, 3, 'Feito'));
  });

  it('marks the feed seen on mount', async () => {
    renderPage();
    await waitFor(() => expect(mockSeen).toHaveBeenCalledTimes(1));
  });

  it('does not send the general message twice on a rapid double Enter', async () => {
    let resolveSend!: () => void;
    mockSend.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = resolve;
        }),
    );
    renderPage();
    await screen.findByText('Obrigado!');
    fireEvent.change(screen.getByLabelText('Filtrar por cliente'), { target: { value: '14' } });
    const input = await screen.findByPlaceholderText(/mensagem geral/);
    fireEvent.change(input, { target: { value: 'Olá' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // Wait for the mutation's pending state to flush before firing the second
    // Enter — this is what a real double keydown looks like (there is always
    // some time between the two), and it is exactly the window the re-entry
    // guard has to hold up in: sendGeneral.isPending must be true here.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Enviar mensagem' })).toBeDisabled(),
    );
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockSend).toHaveBeenCalledTimes(1);
    resolveSend();
    await waitFor(() => expect(input).toHaveValue(''));
  });

  it('does not send the inline reply twice on a rapid double Enter', async () => {
    let resolveReply!: () => void;
    mockReply.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveReply = resolve;
        }),
    );
    renderPage();
    await screen.findByText('Trocar a foto');
    fireEvent.click(screen.getByRole('button', { name: 'Responder' }));
    const replyInput = screen.getByPlaceholderText('Responder ao cliente…');
    fireEvent.change(replyInput, { target: { value: 'Feito' } });
    fireEvent.keyDown(replyInput, { key: 'Enter' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Enviar resposta' })).toBeDisabled(),
    );
    fireEvent.keyDown(replyInput, { key: 'Enter' });
    expect(mockReply).toHaveBeenCalledTimes(1);
    resolveReply();
  });
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MensagensPage } from '../MensagensPage';
import { HubContext } from '../../HubContext';
import type { HubBootstrap } from '../../types';

const { mockFetchMensagens, mockSend, mockSeen, mockSubmitApproval } = vi.hoisted(() => ({
  mockFetchMensagens: vi.fn(),
  mockSend: vi.fn().mockResolvedValue({ ok: true }),
  mockSeen: vi.fn().mockResolvedValue({ ok: true }),
  mockSubmitApproval: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock('../../api', () => ({
  fetchMensagens: mockFetchMensagens,
  sendHubMensagem: mockSend,
  markMensagensSeen: mockSeen,
  submitApproval: mockSubmitApproval,
}));

const BOOTSTRAP: HubBootstrap = {
  workspace: { name: 'Café da Manhã', logo_url: null, brand_color: '#171717' },
  cliente_nome: 'Débora Lima',
  is_active: true,
  cliente_id: 1,
  feature_mensagens: true,
};

const ITEMS = [
  {
    source: 'post_feedback',
    item_id: 1,
    cliente_id: 14,
    cliente_nome: 'ACME',
    post_id: 7,
    workflow_id: 3,
    post_titulo: 'Post de julho',
    action: 'mensagem',
    content: 'Podemos ajustar o CTA?',
    is_workspace_user: false,
    author_user_id: null,
    author_name: null,
    author_avatar_url: null,
    created_at: '2026-07-30T10:00:00.000Z',
  },
  {
    source: 'post_feedback',
    item_id: 2,
    cliente_id: 14,
    cliente_nome: 'ACME',
    post_id: 7,
    workflow_id: 3,
    post_titulo: 'Post de julho',
    action: 'mensagem',
    content: 'Claro, ajustado!',
    is_workspace_user: true,
    author_user_id: 'u-1',
    author_name: 'Ana',
    author_avatar_url: null,
    created_at: '2026-07-30T11:00:00.000Z',
  },
  {
    source: 'mensagem',
    item_id: 3,
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

function renderPage(bootstrapOverrides: Partial<HubBootstrap> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const bootstrap: HubBootstrap = { ...BOOTSTRAP, ...bootstrapOverrides };
  return render(
    <QueryClientProvider client={qc}>
      <HubContext.Provider
        value={{
          bootstrap,
          token: 'tok',
          workspace: 'ws',
          theme: 'light',
          toggleTheme: vi.fn(),
        }}
      >
        <MemoryRouter initialEntries={['/ws/hub/tok/mensagens']}>
          <Routes>
            <Route path="/:workspace/hub/:token/mensagens" element={<MensagensPage />} />
          </Routes>
        </MemoryRouter>
      </HubContext.Provider>
    </QueryClientProvider>,
  );
}

describe('MensagensPage', () => {
  it('shows an unavailable message instead of the chat when feature_mensagens is false', () => {
    renderPage({ feature_mensagens: false });
    expect(screen.queryByPlaceholderText(/enviar mensagem/i)).not.toBeInTheDocument();
    expect(screen.getByText(/não está disponível/i)).toBeInTheDocument();
  });

  describe('real feed', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockFetchMensagens.mockResolvedValue({ items: ITEMS, unread: 0 });
      mockSend.mockResolvedValue({ ok: true });
      mockSeen.mockResolvedValue({ ok: true });
      mockSubmitApproval.mockResolvedValue({ ok: true });
    });

    it('renders client and agency bubbles with author identity and post chip', async () => {
      renderPage({ feature_mensagens: true });
      expect(await screen.findByText('Podemos ajustar o CTA?')).toBeInTheDocument();
      expect(screen.getByText('Claro, ajustado!')).toBeInTheDocument();
      expect(screen.getByText('Ana')).toBeInTheDocument();
      const chips = screen.getAllByRole('link', { name: /Post de julho/ });
      expect(chips[0]).toHaveAttribute('href', expect.stringContaining('/postagens/7'));
    });

    it('sends a general message via the composer', async () => {
      renderPage({ feature_mensagens: true });
      await screen.findByText('Obrigado!');
      const input = screen.getByPlaceholderText('Enviar mensagem…');
      fireEvent.change(input, { target: { value: 'Nova msg' } });
      fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
      await waitFor(() => expect(mockSend).toHaveBeenCalledWith(expect.any(String), 'Nova msg'));
    });

    it('replies to a post via the Responder flow', async () => {
      renderPage({ feature_mensagens: true });
      await screen.findByText('Podemos ajustar o CTA?');
      fireEvent.click(screen.getAllByRole('button', { name: 'Responder' })[0]);
      const input = screen.getByPlaceholderText('Responder sobre o post…');
      fireEvent.change(input, { target: { value: 'Feito' } });
      fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
      await waitFor(() =>
        expect(mockSubmitApproval).toHaveBeenCalledWith(expect.any(String), 7, 'mensagem', 'Feito'),
      );
    });

    it('marks the thread seen on mount', async () => {
      renderPage({ feature_mensagens: true });
      await waitFor(() => expect(mockSeen).toHaveBeenCalledTimes(1));
    });
  });
});

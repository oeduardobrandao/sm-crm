import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Covers the feature-flag-driven behavior of MensagensPage (tab pills,
// deep links into each section, and the redirect that keeps a flagged-off
// section's data from ever rendering) — split out from MensagensPage.test.tsx
// because it needs a materially different mock surface: a controllable
// useWorkspaceLimits result plus the equipe-chat store functions on top of
// the clientes ones that file already mocks.

const {
  mockFeed,
  mockConversas,
  mockClientes,
  mockSend,
  mockReply,
  mockSeen,
  mockEquipeConversas,
  mockEquipeMensagens,
  mockEquipeSeen,
  mockEquipeSend,
} = vi.hoisted(() => ({
  mockFeed: vi.fn(),
  mockConversas: vi.fn(),
  mockClientes: vi.fn(),
  mockSend: vi.fn().mockResolvedValue(undefined),
  mockReply: vi.fn().mockResolvedValue(undefined),
  mockSeen: vi.fn().mockResolvedValue(undefined),
  mockEquipeConversas: vi.fn(),
  mockEquipeMensagens: vi.fn().mockResolvedValue([]),
  mockEquipeSeen: vi.fn().mockResolvedValue(undefined),
  mockEquipeSend: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/store', () => ({
  getMensagensFeed: mockFeed,
  getMensagensConversas: mockConversas,
  getClientes: mockClientes,
  sendMensagem: mockSend,
  replyToPostApproval: mockReply,
  markMensagensSeen: mockSeen,
  getEquipeConversas: mockEquipeConversas,
  getEquipeMensagens: mockEquipeMensagens,
  markEquipeConversaSeen: mockEquipeSeen,
  sendEquipeMensagem: mockEquipeSend,
}));

// PostChip's own hover-preview queries are covered by ConversationThread.test.tsx.
// Mocked here only so the real (Supabase-touching) module never loads.
vi.mock('@/services/postMedia', () => ({ listPostMedia: vi.fn() }));

let mockWorkspaceFeatures: Record<string, boolean> | null = {
  feature_mensagens: true,
  feature_team_chat: true,
};
let mockLimitsLoading = false;
let mockIsUnlimited = false;
vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({
    features: mockWorkspaceFeatures,
    isLoading: mockLimitsLoading,
    isUnlimited: mockIsUnlimited,
  }),
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
    unread_count: 0,
  },
];

const EQUIPE_CONVERSAS = [
  {
    conversa_id: 42,
    tipo: 'grupo' as const,
    nome: 'Time de Design',
    display_nome: 'Time de Design',
    avatar_url: null,
    participantes_count: 3,
    last_author_name: 'Ana',
    last_content: 'Vamos revisar o brief',
    last_has_anexo: false,
    last_created_at: '2026-07-30T12:00:00.000Z',
    last_message_id: 5,
    unread_count: 0,
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
            path="/mensagens/equipe/:conversaId"
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

describe('MensagensPage — feature-flag behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspaceFeatures = { feature_mensagens: true, feature_team_chat: true };
    mockLimitsLoading = false;
    mockIsUnlimited = false;
    mockFeed.mockResolvedValue([]);
    mockConversas.mockResolvedValue(CONVERSAS);
    mockClientes.mockResolvedValue([{ id: 14, nome: 'ACME', sigla: 'AC', cor: '#3ecf8e' }]);
    mockSend.mockResolvedValue(undefined);
    mockReply.mockResolvedValue(undefined);
    mockSeen.mockResolvedValue(undefined);
    mockEquipeConversas.mockResolvedValue(EQUIPE_CONVERSAS);
    mockEquipeMensagens.mockResolvedValue([]);
    mockEquipeSeen.mockResolvedValue(undefined);
    mockEquipeSend.mockResolvedValue(undefined);
  });

  it('(a) both flags on: tab pills render and switch between the clientes and equipe lists', async () => {
    mockMatchMedia(true); // desktop, so both columns render at once
    renderPage('/mensagens');

    expect(await screen.findByText('ACME')).toBeInTheDocument();
    expect(screen.getByTestId('mensagens-tab-clientes')).toBeInTheDocument();
    expect(screen.getByTestId('mensagens-tab-equipe')).toBeInTheDocument();
    expect(screen.queryByText('Time de Design')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('mensagens-tab-equipe'));
    expect(await screen.findByText('Time de Design')).toBeInTheDocument();
    expect(screen.queryByText('ACME')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('mensagens-tab-clientes'));
    expect(await screen.findByText('ACME')).toBeInTheDocument();
    expect(screen.queryByText('Time de Design')).not.toBeInTheDocument();
  });

  it('(b1) deep link to /mensagens/equipe/42 with both flags on shows the equipe list, not clientes', async () => {
    mockMatchMedia(true); // desktop: list renders alongside the thread slot
    renderPage('/mensagens/equipe/42');

    expect(await screen.findByText('Time de Design')).toBeInTheDocument();
    expect(screen.queryByText('ACME')).not.toBeInTheDocument();
  });

  it('(b2) mobile back navigation from a deep-linked equipe thread keeps the Equipe tab active', async () => {
    // Mobile (default matchMedia stub) + an unknown conversa id so
    // ThreadNotFound (which does render a back button) is reachable —
    // the real EquipeThread isn't wired in until Task 10.
    renderPage('/mensagens/equipe/999');

    expect(await screen.findByText('Conversa não encontrada.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para as conversas' }));

    expect(screen.getByTestId('current-path')).toHaveTextContent('/mensagens');
    // If the local tab state had reset to its mount-time default instead of
    // tracking the URL, this would show the clientes list (ACME) instead.
    expect(await screen.findByText('Time de Design')).toBeInTheDocument();
    expect(screen.queryByText('ACME')).not.toBeInTheDocument();
  });

  it('(c) feature_mensagens off + team chat on: /mensagens/14 never renders the clientes pane, redirects to the equipe tab', async () => {
    mockWorkspaceFeatures = { feature_mensagens: false, feature_team_chat: true };
    renderPage('/mensagens/14');

    expect(await screen.findByTestId('current-path')).toHaveTextContent('/mensagens');
    expect(screen.queryByText('ACME')).not.toBeInTheDocument();
    expect(mockFeed).not.toHaveBeenCalled();
    expect(await screen.findByText('Time de Design')).toBeInTheDocument();
  });

  it('(d) equipe URL with feature_team_chat off redirects to /mensagens (clientes)', async () => {
    mockWorkspaceFeatures = { feature_mensagens: true, feature_team_chat: false };
    renderPage('/mensagens/equipe/42');

    expect(await screen.findByTestId('current-path')).toHaveTextContent('/mensagens');
    expect(screen.queryByText('Time de Design')).not.toBeInTheDocument();
    expect(await screen.findByText('ACME')).toBeInTheDocument();
  });

  it('(e) unlimited workspace (features: null, isUnlimited: true): bare /mensagens gets both tab pills and the clientes list', async () => {
    // The real shape useWorkspaceLimits returns for an unlimited workspace —
    // `features` is null, never a features object with every flag true.
    mockWorkspaceFeatures = null;
    mockIsUnlimited = true;
    mockMatchMedia(true); // desktop, so both columns render at once

    renderPage('/mensagens');

    expect(await screen.findByText('ACME')).toBeInTheDocument();
    expect(screen.getByTestId('mensagens-tab-clientes')).toBeInTheDocument();
    expect(screen.getByTestId('mensagens-tab-equipe')).toBeInTheDocument();
  });

  it('(e) unlimited workspace (features: null, isUnlimited: true): /mensagens/14 does not redirect', async () => {
    mockWorkspaceFeatures = null;
    mockIsUnlimited = true;
    mockMatchMedia(true); // desktop, so the list (ACME) stays visible alongside the thread

    renderPage('/mensagens/14');

    // "ACME" appears twice once the thread opens (list row + thread header),
    // so assert on the list row's testid instead of the ambiguous text.
    expect(await screen.findByTestId('conversa-14')).toBeInTheDocument();
    expect(screen.getByTestId('current-path')).toHaveTextContent('/mensagens/14');
  });
});

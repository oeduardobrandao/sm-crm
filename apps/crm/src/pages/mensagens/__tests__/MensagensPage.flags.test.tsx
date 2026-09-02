import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  mockMembros,
  mockTarefas,
  mockSearchPosts,
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
  // EquipeThread's composer renders MentionTextarea (Task 10), which always
  // mounts useMentionSearch -> useQuery(['membros'|'clientes'|'tarefas']) even
  // when the user never types "@" -- stub the two this file doesn't otherwise
  // cover so that query resolves instead of hitting the real module.
  mockMembros: vi.fn().mockResolvedValue([]),
  mockTarefas: vi.fn().mockResolvedValue([]),
  mockSearchPosts: vi.fn().mockResolvedValue([]),
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
  getMembros: mockMembros,
  getTarefas: mockTarefas,
  // NovaConversaDialog / EquipeDetalhesSheet (Task 11) always mount once
  // feature_team_chat is on (their own `open`/`detalhesOpen` gates keep the
  // actual RPCs from firing in these tests), but the mocked @/store module
  // must still expose these bindings or referencing them at render time
  // throws "No export is defined on the mock".
  getEquipeChatMembers: vi.fn().mockResolvedValue([]),
  getEquipeConversaParticipantes: vi.fn().mockResolvedValue([]),
  createEquipeConversa: vi.fn(),
  manageEquipeConversa: vi.fn(),
}));

// Same rationale as above: useMentionSearch's post section hits this module.
vi.mock('@/store/posts', () => ({ searchPostsForMention: mockSearchPosts }));

// PostChip's own hover-preview queries are covered by ConversationThread.test.tsx.
// Mocked here only so the real (Supabase-touching) module never loads.
vi.mock('@/services/postMedia', () => ({ listPostMedia: vi.fn() }));

// The equipe thread slot (b1) now mounts the real EquipeThread (Task 10), which
// reads the current user id via useAuth() to align bubbles. This file renders
// MensagensPage directly (no AuthProvider ancestor, unlike production's
// App.tsx), so the hook needs the same minimal mock other page tests use.
// Keeps the real `AuthContext` export via importOriginal -- useEquipeChatRealtime
// reads it directly with useContext(AuthContext), not through useAuth().
vi.mock('@/context/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAuth: () => ({ user: { id: 'user-1' }, role: 'owner', loading: false, profile: null }),
  };
});

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
    mockMembros.mockResolvedValue([]);
    mockTarefas.mockResolvedValue([]);
    mockSearchPosts.mockResolvedValue([]);
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

    // "Time de Design" now appears twice once the real EquipeThread (Task 10)
    // opens alongside the list (list row + thread header), so assert on the
    // list row's testid instead of the ambiguous text — same fix as the
    // clientes-side (e) test below.
    expect(await screen.findByTestId('equipe-conversa-42')).toBeInTheDocument();
    expect(screen.getAllByText('Time de Design').length).toBeGreaterThan(0);
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

  it('(f) limits resolve to team-chat-only after loading: bare /mensagens snaps to the equipe list instead of staying blank', async () => {
    // Mount time: useWorkspaceLimits is still loading, so both flags read
    // false (the real shape isLoading returns) -- the `tab` state initializer
    // defaults to 'clientes' under that reading. Neither pane's `Boolean &&`
    // gate is on yet, so this first render is legitimately blank.
    mockWorkspaceFeatures = null;
    mockLimitsLoading = true;
    mockIsUnlimited = false;

    const utils = renderPage('/mensagens');
    expect(screen.queryByText('ACME')).not.toBeInTheDocument();
    expect(screen.queryByText('Time de Design')).not.toBeInTheDocument();

    // Limits resolve: feature_mensagens off, feature_team_chat on. Without
    // the snap-to-enabled effect, `tab` would stay stuck at its mount-time
    // 'clientes' default and the page would stay blank forever (clientesOn
    // is false so the clientes pane never mounts either).
    mockWorkspaceFeatures = { feature_mensagens: false, feature_team_chat: true };
    mockLimitsLoading = false;
    utils.rerender(
      <QueryClientProvider client={utils.qc}>
        <MemoryRouter initialEntries={['/mensagens']}>
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

    expect(await screen.findByText('Time de Design')).toBeInTheDocument();
    expect(screen.queryByText('ACME')).not.toBeInTheDocument();
  });

  it('(g) team-chat-only workspace: bare /mensagens never queries or writes the clientes side', async () => {
    // feature_mensagens off entirely (not just redirected away from a
    // clientes URL, as in (c)) -- the clientes pane never mounts at all on
    // bare /mensagens, so useMensagensData must not fire its conversas/
    // clientes queries or its mark-seen write just because MensagensPage
    // still calls the hook unconditionally under the hood.
    mockWorkspaceFeatures = { feature_mensagens: false, feature_team_chat: true };

    renderPage('/mensagens');

    expect(await screen.findByText('Time de Design')).toBeInTheDocument();
    expect(screen.queryByText('ACME')).not.toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(mockConversas).not.toHaveBeenCalled();
    expect(mockClientes).not.toHaveBeenCalled();
    expect(mockSeen).not.toHaveBeenCalled();
    expect(mockFeed).not.toHaveBeenCalled();
  });

  it('(h) both flags on: a deep-linked equipe thread never marks clientes mensagens seen', async () => {
    // Prefetching the clientes conversas/clientes queries in the background
    // is fine here (that's `enabled`, not `seenEnabled`) -- what must not
    // happen is the mark-seen WRITE, since the clientes pane never rendered
    // (e.g. the user followed a team_message notification straight in).
    mockMatchMedia(true); // desktop: list renders alongside the thread slot
    renderPage('/mensagens/equipe/42');

    expect(await screen.findByTestId('equipe-conversa-42')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(mockSeen).not.toHaveBeenCalled();
  });

  it('(i) both flags on: bare /mensagens (clientes default tab) marks clientes mensagens seen once', async () => {
    mockMatchMedia(true); // desktop, so both columns render at once
    renderPage('/mensagens');

    expect(await screen.findByText('ACME')).toBeInTheDocument();
    await waitFor(() => expect(mockSeen).toHaveBeenCalledTimes(1));
  });

  it('(j) switching from Equipe to the Clientes pill marks clientes mensagens seen at that moment', async () => {
    mockMatchMedia(true); // desktop: both the list and pills render on the equipe deep link too
    renderPage('/mensagens/equipe/42');

    expect(await screen.findByTestId('equipe-conversa-42')).toBeInTheDocument();
    expect(mockSeen).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('mensagens-tab-clientes'));

    await waitFor(() => expect(mockSeen).toHaveBeenCalledTimes(1));
  });
});

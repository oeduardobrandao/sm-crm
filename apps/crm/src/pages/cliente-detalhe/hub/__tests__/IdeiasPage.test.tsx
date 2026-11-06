import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Cliente } from '@/store';
import type { ClienteDetalheOutletContext } from '../../clienteTabs.model';

// IdeiasPage is a pure move of HubTab.tsx's IdeiasTab (git history at
// d30adeea), already local (its own query never lived at the HubTab level).
// HubTab.test.tsx never exercised this tab directly, so this is new coverage
// — a smoke test that the route renders and is wired to the real store, not
// a full port of pre-existing assertions. Unlike the other four pages,
// IdeiasTab never depended on `conta_id`, so this page renders without the
// `if (!cliente.conta_id) return null;` guard the others carry.

vi.mock('@/context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/store/ideias');

// Desktop layout by default; the phone describe flips it (jsdom's matchMedia is false).
const { desktop } = vi.hoisted(() => ({ desktop: { value: true } }));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => desktop.value }));

// IdeiaDrawer has suites of its own; this page only opens it.
vi.mock('@/components/ideias/IdeiaDrawer', () => ({
  IdeiaDrawer: ({
    ideia,
    initialAction,
  }: {
    ideia: { titulo: string };
    initialAction?: string;
  }) => (
    <div data-testid="ideia-drawer">
      {ideia.titulo}:{initialAction ?? 'none'}
    </div>
  ),
}));

import { useAuth } from '@/context/AuthContext';
import { makeCan, fakeMembership } from '@/test/makeCan';
import IdeiasPage from '../IdeiasPage';
import * as ideiasStore from '@/store/ideias';

const mockedUseAuth = vi.mocked(useAuth);

const CLIENTE: Cliente = {
  id: 15,
  nome: 'Aurora Estética',
  sigla: 'AE',
  cor: '#ffbf30',
  plano: 'Plano Ouro',
  email: 'contato@aurora.com.br',
  telefone: '(85) 99999-0000',
  status: 'ativo',
  valor_mensal: 1500,
  conta_id: 'ws-1',
};

/**
 * O gate do portal (HubRoleGate) lê `can('configuracoes', 'editar')`, tri-estado,
 * e nao mais o `workspaceRole` grosseiro. Derivar o `can` do papel via
 * `makeCan`/`fakeMembership` faz estes testes exercitarem a MESMA tabela-verdade
 * (`derivePermission`) que roda em producao. `null` produz 'unknown' em todos os
 * modulos, espelhando um AuthContext ainda nao resolvido.
 */
function setAuth(workspaceRole: 'owner' | 'admin' | 'agent' | null) {
  mockedUseAuth.mockReturnValue({
    workspaceRole,
    can: makeCan(workspaceRole === null ? null : fakeMembership({ role: workspaceRole })),
  } as never);
}

function OutletContextProvider({ cliente }: { cliente: Cliente }) {
  return (
    <Outlet context={{ clienteId: cliente.id!, cliente } satisfies ClienteDetalheOutletContext} />
  );
}

function renderPage(cliente: Cliente = CLIENTE, queryClient?: QueryClient) {
  const client = queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<OutletContextProvider cliente={cliente} />}>
            <Route path="/" element={<IdeiasPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const NOW = '2026-08-01T12:00:00Z';

// Seeds the QueryClient cache directly (same technique BriefingPage.test.tsx uses for
// renderBriefing) instead of relying on the mocked queryFn resolving on a later tick --
// this is what lets the brief's own test bodies use plain screen.getByTestId(...) with
// no await/findBy right after calling renderIdeias. Fixtures are intentionally loose
// (Record<string, unknown>, cast at the boundary) so callers can pass only the fields
// IdeiasPage actually reads, matching the brief's test snippets verbatim.
//
// staleTime: Infinity keeps these seeded fixtures from being silently replaced. beforeEach
// leaves the mocked getIdeias resolving `[]`, and with the default staleTime (0) the query
// is refetched on mount; that refetch resolves on a later microtask, so any test that
// awaits/findBy after this call would see the fixtures wiped out from under it.
function renderIdeias(ideias: Array<Record<string, unknown>>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(['hub-ideias-crm', CLIENTE.id], ideias);
  return renderPage(CLIENTE, queryClient);
}

describe('IdeiasPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setAuth('owner');
    vi.mocked(ideiasStore.getIdeias).mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the page header and the ideias list for an owner', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 2, name: 'Ideias' })).toBeInTheDocument();
    expect(await screen.findByText('Nenhuma ideia encontrada.')).toBeInTheDocument();
  });

  it('renders the RoleRestrictionNotice (not the list) for an agent', async () => {
    setAuth('agent');
    renderPage();
    expect(await screen.findByRole('heading', { level: 2, name: 'Ideias' })).toBeInTheDocument();
    expect(screen.queryByText('Ideias do cliente')).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'O gerenciamento do Hub do Cliente está disponível apenas para proprietários e administradores do workspace.',
      ),
    ).toBeInTheDocument();
  });

  it('mostra a contagem por estado nos chips', () => {
    renderIdeias([
      { id: 1, status: 'nova', titulo: 'A', descricao: 'd', ideia_reactions: [], created_at: NOW },
      { id: 2, status: 'nova', titulo: 'B', descricao: 'd', ideia_reactions: [], created_at: NOW },
      {
        id: 3,
        status: 'aprovada',
        titulo: 'C',
        descricao: 'd',
        ideia_reactions: [],
        created_at: NOW,
      },
    ]);
    // Regex (not a substring match): `toHaveTextContent('2')` would also accept "12", and
    // would keep passing even if the chip's onClick set the wrong status.
    expect(screen.getByTestId('chip-nova')).toHaveTextContent(/^Nova\s*2$/);
    expect(screen.getByTestId('chip-aprovada')).toHaveTextContent(/^Aprovada\s*1$/);
    expect(screen.getByTestId('chip-todas')).toHaveTextContent(/^Todas\s*3$/);
  });

  it('não renderiza chip de estado sem nenhuma ideia', () => {
    renderIdeias([
      { id: 1, status: 'nova', titulo: 'A', descricao: 'd', ideia_reactions: [], created_at: NOW },
    ]);
    expect(screen.queryByTestId('chip-descartada')).not.toBeInTheDocument();
  });

  it('filtra a lista ao clicar num chip, sem afetar a contagem dos demais chips', () => {
    renderIdeias([
      { id: 1, status: 'nova', titulo: 'A', descricao: 'd', ideia_reactions: [], created_at: NOW },
      { id: 2, status: 'nova', titulo: 'B', descricao: 'd', ideia_reactions: [], created_at: NOW },
      {
        id: 3,
        status: 'aprovada',
        titulo: 'C',
        descricao: 'd',
        ideia_reactions: [],
        created_at: NOW,
      },
    ]);

    fireEvent.click(screen.getByTestId('chip-aprovada'));

    expect(screen.getByText('C')).toBeInTheDocument();
    expect(screen.queryByText('A')).not.toBeInTheDocument();
    expect(screen.queryByText('B')).not.toBeInTheDocument();

    expect(screen.getByTestId('chip-aprovada')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('chip-nova')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('chip-todas')).toHaveAttribute('aria-pressed', 'false');
    // The chip a user didn't click keeps reading its own full count, unaffected by the
    // now-filtered list below it.
    expect(screen.getByTestId('chip-nova')).toHaveTextContent(/^Nova\s*2$/);
  });
});

describe('IdeiasPage no celular', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    desktop.value = false;
    setAuth('owner');
    vi.mocked(ideiasStore.getIdeias).mockResolvedValue([]);
  });
  afterEach(() => {
    desktop.value = true;
    cleanup();
  });

  const IDEIAS = [
    {
      id: 1,
      status: 'nova',
      tipo: 'solicitacao',
      titulo: 'Reels de bastidores',
      descricao: 'd',
      ideia_reactions: [],
      created_at: NOW,
    },
    {
      id: 3,
      status: 'aprovada',
      tipo: 'ideia',
      titulo: 'Carrossel de dicas',
      descricao: 'd',
      ideia_reactions: [],
      created_at: NOW,
    },
  ];

  it('filters with chips and lists ideias as rows', () => {
    renderIdeias(IDEIAS);
    expect(screen.queryByRole('heading', { level: 2, name: 'Ideias' })).not.toBeInTheDocument();
    const chips = screen.getByRole('group', { name: 'Filtrar por status' });
    fireEvent.click(within(chips).getByRole('button', { name: /Aprovada/ }));
    expect(screen.getByText('Carrossel de dicas')).toBeInTheDocument();
    expect(screen.queryByText('Reels de bastidores')).not.toBeInTheDocument();
  });

  it('a row opens the ideia; swipe actions open it on Responder / Virar tarefa', () => {
    renderIdeias(IDEIAS);
    fireEvent.click(screen.getByRole('button', { name: /Reels de bastidores/ }));
    expect(screen.getByTestId('ideia-drawer')).toHaveTextContent('Reels de bastidores:none');

    cleanup();
    renderIdeias(IDEIAS);
    fireEvent.click(screen.getAllByRole('button', { name: 'Virar tarefa' })[0]);
    expect(screen.getByTestId('ideia-drawer')).toHaveTextContent('Reels de bastidores:converter');
    // Only a solicitação in a convertible status offers Virar tarefa.
    expect(screen.getAllByRole('button', { name: 'Virar tarefa' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Responder' })).toHaveLength(2);
  });
});

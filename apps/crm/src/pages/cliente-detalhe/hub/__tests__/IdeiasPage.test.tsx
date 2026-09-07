import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
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

import { useAuth } from '@/context/AuthContext';
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

function setAuth(workspaceRole: 'owner' | 'admin' | 'agent' | null) {
  mockedUseAuth.mockReturnValue({ workspaceRole } as never);
}

function OutletContextProvider({ cliente }: { cliente: Cliente }) {
  return (
    <Outlet context={{ clienteId: cliente.id!, cliente } satisfies ClienteDetalheOutletContext} />
  );
}

function renderPage(cliente: Cliente = CLIENTE) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
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
});

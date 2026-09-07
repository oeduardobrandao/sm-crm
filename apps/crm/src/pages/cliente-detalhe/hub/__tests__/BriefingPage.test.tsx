import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes, Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Cliente } from '@/store';
import type { ClienteDetalheOutletContext } from '../../clienteTabs.model';

// BriefingPage is a pure move of HubTab.tsx's BriefingEditor (git history at
// d30adeea), already local (its own `useQueryClient()` and queries never
// lived at the HubTab level). HubTab.test.tsx never exercised this tab
// directly, so this is new coverage — a smoke test that the route renders
// and is wired to the real store, not a full port of pre-existing assertions.

vi.mock('@/context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/store/hub');

import { useAuth } from '@/context/AuthContext';
import { makeCan, fakeMembership } from '@/test/makeCan';
import BriefingPage from '../BriefingPage';
import * as hubStore from '@/store/hub';

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

function renderPage(cliente: Cliente = CLIENTE) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<OutletContextProvider cliente={cliente} />}>
            <Route path="/" element={<BriefingPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('BriefingPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setAuth('owner');
    vi.mocked(hubStore.getBriefings).mockResolvedValue([]);
    vi.mocked(hubStore.getHubBriefingQuestions).mockResolvedValue([]);
    vi.mocked(hubStore.getBriefingTemplates).mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the page header and the briefing editor for an owner', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 2, name: 'Briefing' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Briefings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Novo briefing/ })).toBeInTheDocument();
  });

  it('renders the RoleRestrictionNotice (not the editor) for an agent', async () => {
    setAuth('agent');
    renderPage();
    expect(await screen.findByRole('heading', { level: 2, name: 'Briefing' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Briefings' })).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'O gerenciamento do Hub do Cliente está disponível apenas para proprietários e administradores do workspace.',
      ),
    ).toBeInTheDocument();
  });
});

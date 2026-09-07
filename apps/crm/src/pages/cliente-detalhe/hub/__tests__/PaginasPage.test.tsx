import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Cliente } from '@/store';
import type { ClienteDetalheOutletContext } from '../../clienteTabs.model';

// PaginasPage is a pure move of HubTab.tsx's PagesEditor + mdComponents (git
// history at d30adeea) plus the `hub-pages-crm` query that used to live at
// the top of HubTab. This suite carries over HubTab.test.tsx's "stacks the
// page editor and preview" assertion.

vi.mock('@/context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/store/hub');

import { useAuth } from '@/context/AuthContext';
import { makeCan, fakeMembership } from '@/test/makeCan';
import PaginasPage from '../PaginasPage';
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
            <Route path="/" element={<PaginasPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PaginasPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setAuth('owner');
    vi.mocked(hubStore.getHubPages).mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it('stacks the page editor and preview until the tablet breakpoint', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Nova página' }));

    const dialog = await screen.findByRole('dialog', { name: 'Nova página' });
    expect(dialog.querySelector('.hub-page-editor__workspace')).toHaveClass(
      'flex-col',
      'md:flex-row',
    );
    expect(dialog.querySelector('.hub-page-editor__input')).toHaveClass('w-full', 'md:w-1/2');
    expect(dialog.querySelector('.hub-page-editor__preview')).toHaveClass('w-full', 'md:w-1/2');
  });

  // Regression guard: the hub-pages-crm useQuery call sits above <HubRoleGate> in the
  // component body, so without `enabled: canLoadPortalData` it fires for every role — an
  // agent would fetch pages data that HubRoleGate exists to withhold, even though it
  // never reaches the screen.
  it('does not fire the hub-pages-crm query for an agent', async () => {
    setAuth('agent');
    renderPage();

    await screen.findByText('Hub do Cliente');
    expect(hubStore.getHubPages).not.toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Cliente } from '@/store';
import type { ClienteDetalheOutletContext } from '../../clienteTabs.model';
import { makeCan, fakeMembership } from '@/test/makeCan';

// HubClienteTab wraps the pre-existing HubTab.tsx (ported unchanged from the
// pre-split ClienteDetalhePage, see git history at d30adeea) with two
// responsibilities that never lived inside HubTab itself:
//  1. Loading `getWorkspaceSlug` — a page-level query in the historical file,
//     now scoped to only this route.
//  2. An internal role check. Unlike most other tabs (e.g. RelatoriosTab,
//     STAFF-gated at the route layer in clienteTabs.model.ts, so it never
//     re-checks role), `hub`'s route access is deliberately ALL — every role
//     reaches /clientes/:id/hub, and this tab decides for itself whether to
//     render the real HubTab or a RoleRestrictionNotice.
//
// HubTab itself already has a dedicated, thorough suite (HubTab.test.tsx)
// covering token valid/expired/absent and every internal sub-tab — that
// suite is untouched and keeps exercising the real component directly. It
// is intentionally out of scope to duplicate here: this suite mocks HubTab
// (same convention RedesSociaisTab.test.tsx uses for InstagramSection) so it
// can focus on what actually belongs to the adapter — role gating, prop
// wiring, and query isolation.

const { getWorkspaceSlugMock } = vi.hoisted(() => ({ getWorkspaceSlugMock: vi.fn() }));
vi.mock('@/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store')>()),
  getWorkspaceSlug: (...args: unknown[]) => getWorkspaceSlugMock(...args),
}));

vi.mock('@/context/AuthContext', () => ({ useAuth: vi.fn() }));

vi.mock('../../HubTab', () => ({
  HubTab: ({
    clienteId,
    contaId,
    workspaceSlug,
  }: {
    clienteId: number;
    contaId: string;
    workspaceSlug: string;
  }) => (
    <div data-testid="hub-tab">
      hub-{clienteId}-{contaId}-{workspaceSlug}
    </div>
  ),
}));

import { useAuth } from '@/context/AuthContext';
import HubClienteTab from '../HubClienteTab';

const mockedUseAuth = vi.mocked(useAuth);

const CLIENTE: Cliente = {
  id: 42,
  nome: 'Aurora Estética',
  sigla: 'AE',
  cor: '#ffbf30',
  plano: 'Plano Ouro',
  email: 'contato@aurora.com.br',
  telefone: '(85) 99999-0000',
  status: 'ativo',
  valor_mensal: 1500,
  conta_id: 'conta-42',
};

/**
 * Task 14: the internal restriction check moved from the coarse
 * `workspaceRole === 'agent'` to `can('configuracoes', 'editar') !== true`.
 * Passing a legacy `workspaceRole` here derives a real, preset-backed `can`
 * (role_id: null) so the owner/admin/agent cases below exercise the exact
 * same truth table `derivePermission` does in production; pass `can`
 * directly to simulate a custom role instead.
 */
function setAuth(
  workspaceRole: 'owner' | 'admin' | 'agent' | null,
  can?: ReturnType<typeof makeCan>,
) {
  mockedUseAuth.mockReturnValue({
    workspaceRole,
    can: can ?? makeCan(workspaceRole === null ? null : fakeMembership({ role: workspaceRole })),
  } as never);
}

function OutletContextProvider({ cliente }: { cliente: Cliente }) {
  return (
    <Outlet context={{ clienteId: cliente.id!, cliente } satisfies ClienteDetalheOutletContext} />
  );
}

function renderTab(cliente: Cliente = CLIENTE) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<OutletContextProvider cliente={cliente} />}>
            <Route path="/" element={<HubClienteTab />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, queryClient };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('HubClienteTab', () => {
  it('renders the real HubTab with clienteId/contaId/workspaceSlug for an owner', async () => {
    setAuth('owner');
    getWorkspaceSlugMock.mockResolvedValue('dk-marketing-medico');
    renderTab();

    // The whole card — heading included — waits on workspaceSlug, mirroring
    // the historical `!isAgent && cliente... && workspaceSlug &&` guard,
    // which gated the entire block (not just <HubTab>) on the slug query.
    expect(await screen.findByTestId('hub-tab')).toHaveTextContent(
      'hub-42-conta-42-dk-marketing-medico',
    );
    expect(screen.getByText('Hub do Cliente')).toBeInTheDocument();
    expect(
      screen.getByText('Link permanente de acesso do cliente ao hub de conteúdo.'),
    ).toBeInTheDocument();
  });

  it('renders the real HubTab for an admin too', async () => {
    setAuth('admin');
    getWorkspaceSlugMock.mockResolvedValue('dk-marketing-medico');
    renderTab();

    expect(await screen.findByTestId('hub-tab')).toHaveTextContent(
      'hub-42-conta-42-dk-marketing-medico',
    );
  });

  it('renders RoleRestrictionNotice (not HubTab) for an agent', async () => {
    setAuth('agent');
    getWorkspaceSlugMock.mockResolvedValue('dk-marketing-medico');
    renderTab();

    // "Hub do Cliente" appears twice for an agent: once as the card heading
    // (rendered regardless of role) and once as RoleRestrictionNotice's own
    // `title` prop — both ported verbatim from the historical JSX, which
    // happened to reuse the same string in both places.
    expect(await screen.findAllByText('Hub do Cliente')).toHaveLength(2);
    expect(
      screen.getByText(
        'O gerenciamento do Hub do Cliente está disponível apenas para proprietários e administradores do workspace.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('hub-tab')).not.toBeInTheDocument();
  });

  /**
   * The bug this task fixes: a custom role's chassis `workspaceRole` reads
   * 'agent' (Task 11), but if its role_id permissions grant
   * `configuracoes:editar` it already passes the ROUTE-level guard
   * (clienteTabs.model.ts, Task 12) to reach this component. Before this
   * fix, the notice below still fired because it read the coarse
   * `workspaceRole` instead of `can()` — contradicting the route guard that
   * just let the member through. Supersedes the pending chip
   * task_7b0968a7, which flagged exactly this.
   */
  it('renders the real HubTab for a custom role with configuracoes:editar (the fix)', async () => {
    setAuth(
      'agent',
      makeCan(
        fakeMembership({
          role: 'agent',
          role_id: 'role-1',
          permissions: { configuracoes: 'editar' },
        }),
      ),
    );
    getWorkspaceSlugMock.mockResolvedValue('dk-marketing-medico');
    renderTab();

    expect(await screen.findByTestId('hub-tab')).toHaveTextContent(
      'hub-42-conta-42-dk-marketing-medico',
    );
    expect(
      screen.queryByText(/apenas para proprietários e administradores/),
    ).not.toBeInTheDocument();
  });

  it('still shows RoleRestrictionNotice for a custom role without configuracoes:editar', async () => {
    setAuth(
      'agent',
      makeCan(
        fakeMembership({ role: 'agent', role_id: 'role-1', permissions: { configuracoes: 'ver' } }),
      ),
    );
    getWorkspaceSlugMock.mockResolvedValue('dk-marketing-medico');
    renderTab();

    expect(await screen.findAllByText('Hub do Cliente')).toHaveLength(2);
    expect(screen.queryByTestId('hub-tab')).not.toBeInTheDocument();
  });

  it('does not render HubTab until workspaceSlug resolves, for an owner', () => {
    setAuth('owner');
    getWorkspaceSlugMock.mockReturnValue(new Promise(() => {})); // never resolves
    renderTab();

    expect(screen.queryByTestId('hub-tab')).not.toBeInTheDocument();
  });

  it('fires only the workspace-slug query — nothing from Entregas/Arquivos/Financeiro/Instagram', async () => {
    setAuth('owner');
    getWorkspaceSlugMock.mockResolvedValue('dk-marketing-medico');
    const { queryClient } = renderTab();
    await screen.findByTestId('hub-tab');

    const keys = queryClient
      .getQueryCache()
      .getAll()
      .map((q) => q.queryKey[0]);
    expect(keys).toEqual(['workspace-slug']);
  });
});

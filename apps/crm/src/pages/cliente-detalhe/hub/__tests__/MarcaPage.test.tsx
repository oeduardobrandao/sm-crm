import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes, Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Cliente } from '@/store';
import type { ClienteDetalheOutletContext } from '../../clienteTabs.model';

// MarcaPage is a pure move of HubTab.tsx's BrandEditor (git history at
// d30adeea) plus the `hub-brand-crm` query that used to live at the top of
// HubTab — zero behaviour change, see task-2-brief.md. This suite carries
// over HubTab.test.tsx's "stacks the brand editor fields" assertion.

vi.mock('@/context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/store/hub');

import { useAuth } from '@/context/AuthContext';
import MarcaPage from '../MarcaPage';
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
            <Route path="/" element={<MarcaPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MarcaPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setAuth('owner');
    vi.mocked(hubStore.getHubBrand).mockResolvedValue({ brand: null, files: [] });
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the page header and the brand editor section, both titled Marca', async () => {
    renderPage();
    // The new route header (h2) and BrandEditor's own section heading (h3,
    // moved verbatim from HubTab.tsx) intentionally both say "Marca" — this
    // task is a structural move, not a redesign, so the duplication stays
    // until a later task revisits the page's visual design.
    expect(await screen.findByRole('heading', { level: 2, name: 'Marca' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Marca' })).toBeInTheDocument();
  });

  it('stacks the brand editor fields until the tablet breakpoint', async () => {
    renderPage();
    await waitFor(() =>
      expect(document.querySelector('.hub-brand-editor__grid')).toBeInTheDocument(),
    );
    expect(document.querySelector('.hub-brand-editor__grid')).toHaveClass(
      'grid-cols-1',
      'md:grid-cols-2',
    );
  });

  // Regression guard: the hub-brand-crm useQuery call sits above <HubRoleGate> in the
  // component body, so without `enabled: !isRestricted` it fires for every role — an
  // agent would fetch brand data that HubRoleGate exists to withhold, even though it
  // never reaches the screen.
  it('does not fire the hub-brand-crm query for an agent', async () => {
    setAuth('agent');
    renderPage();

    await screen.findByText('Hub do Cliente');
    expect(hubStore.getHubBrand).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes, Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Cliente, HubBrandRow } from '@/store';
import type { ClienteDetalheOutletContext } from '../../clienteTabs.model';

// MarcaPage is a pure move of HubTab.tsx's BrandEditor (git history at
// d30adeea) plus the `hub-brand-crm` query that used to live at the top of
// HubTab — zero behaviour change, see task-2-brief.md. This suite carries
// over HubTab.test.tsx's "stacks the brand editor fields" assertion.

vi.mock('@/context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/store/hub');

import { useAuth } from '@/context/AuthContext';
import { makeCan, fakeMembership } from '@/test/makeCan';
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
  // component body, so without `enabled: canLoadPortalData` it fires for every role — an
  // agent would fetch brand data that HubRoleGate exists to withhold, even though it
  // never reaches the screen.
  it('does not fire the hub-brand-crm query for an agent', async () => {
    setAuth('agent');
    renderPage();

    await screen.findByText('Hub do Cliente');
    expect(hubStore.getHubBrand).not.toHaveBeenCalled();
  });

  // Finding 3 (task-11, fix round 3): `useEffect(() => { if (brand) setForm(brand); },
  // [brand])` never cleared the form when `brand` resolved to `null` -- switching from a
  // client WITH a hub_brand row to one WITHOUT kept the previous client's logo/cores/
  // fontes on screen, and "Salvar" upserted them under the NEW clienteId, copying one
  // client's branding onto another. Pre-existing (identical code at 947f418b), but live
  // and data-corrupting, so covered here.
  //
  // `rerender` with a DIFFERENT `cliente` in the outlet context, on the SAME rendered
  // tree, is what actually exercises the bug: it's exactly what a route param change
  // (`/clientes/15/hub/marca` -> `/clientes/99/hub/marca`) does WITHOUT remounting
  // `MarcaPage` -- nothing in the router keys this subtree by `clienteId`.
  it('limpa o formulário ao trocar para um cliente sem marca (Finding 3, fix round 3)', async () => {
    const CLIENTE_COM_MARCA = CLIENTE;
    const CLIENTE_SEM_MARCA: Cliente = { ...CLIENTE, id: 99, conta_id: 'ws-2' };
    const BRAND_AURORA: HubBrandRow = {
      id: 'b1',
      cliente_id: 15,
      logo_url: 'https://aurora.com.br/logo.png',
      primary_color: '#ff0000',
      secondary_color: '#00ff00',
      font_primary: 'Georgia',
      font_secondary: 'Georgia Sans',
    };
    vi.mocked(hubStore.getHubBrand).mockImplementation(async (clienteId: number) =>
      clienteId === CLIENTE_COM_MARCA.id
        ? { brand: BRAND_AURORA, files: [] }
        : { brand: null, files: [] },
    );

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (cliente: Cliente) => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route element={<OutletContextProvider cliente={cliente} />}>
              <Route path="/" element={<MarcaPage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    const { rerender } = render(tree(CLIENTE_COM_MARCA));

    await waitFor(() =>
      expect(screen.getByPlaceholderText('https://...')).toHaveValue(
        'https://aurora.com.br/logo.png',
      ),
    );
    expect(screen.getByPlaceholderText('Inter')).toHaveValue('Georgia');

    rerender(tree(CLIENTE_SEM_MARCA));

    await waitFor(() => expect(hubStore.getHubBrand).toHaveBeenCalledWith(CLIENTE_SEM_MARCA.id));
    await waitFor(() => expect(screen.getByPlaceholderText('https://...')).toHaveValue(''));
    expect(screen.getByPlaceholderText('Inter')).toHaveValue('');
    expect(screen.getByPlaceholderText('Playfair Display')).toHaveValue('');
  });
});

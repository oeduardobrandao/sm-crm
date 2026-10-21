import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Phone layout (below 768px): jsdom's matchMedia reports false, so useIsDesktop is
// false here without a mock. The desktop layout lives in ClienteDetalhePage.test.tsx.
vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({ features: {}, isLoading: false }),
}));
vi.mock('../../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));
vi.mock('../../../store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../store')>()),
  getCliente: vi.fn(),
  updateCliente: vi.fn(),
}));

import { useAuth } from '../../../context/AuthContext';
import { getCliente, type Cliente } from '../../../store';
import ClienteDetalhePage from '../ClienteDetalhePage';
import ClienteDetalheIndexRedirect from '../ClienteDetalheIndexRedirect';
import { makeCan, fakeMembership } from '@/test/makeCan';

const mockedUseAuth = vi.mocked(useAuth);
const mockedGetCliente = vi.mocked(getCliente);

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
  data_pagamento: 10,
  dia_entrega: 5,
  especialidade: 'Estética',
};

function setAuth(role: 'owner' | 'agent', canSeeFinancials = role === 'owner') {
  mockedUseAuth.mockReturnValue({
    user: { id: 'u1', email: 'a@b.c' },
    profile: { nome: 'Débora Kristin' },
    role,
    workspaceRole: role,
    membershipResolved: true,
    canSeeFinancials,
    can: makeCan(fakeMembership({ role, can_see_financials: canSeeFinancials })),
    loading: false,
    signOut: vi.fn(),
    refetchProfile: vi.fn(),
  } as never);
}

function PathProbe() {
  const location = useLocation();
  return <span data-testid="path">{location.pathname + location.search}</span>;
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/clientes" element={<div>lista de clientes</div>} />
          <Route path="/clientes/:id" element={<ClienteDetalhePage />}>
            <Route index element={<ClienteDetalheIndexRedirect />} />
            <Route path="visao-geral" element={<div>conteudo visao-geral</div>} />
            <Route path="entregas" element={<div>conteudo entregas</div>} />
            <Route path="redes-sociais" element={<div>conteudo redes-sociais</div>} />
            <Route path="relatorios" element={<div>conteudo relatorios</div>} />
            <Route path="hub">
              <Route path="acesso" element={<div>conteudo acesso</div>} />
            </Route>
            <Route path="arquivos" element={<div>conteudo arquivos</div>} />
            <Route path="financeiro" element={<div>conteudo financeiro</div>} />
            <Route path="*" element={null} />
          </Route>
        </Routes>
        <PathProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ClienteDetalhePage on phones', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetCliente.mockResolvedValue(CLIENTE);
  });

  it('renders the sections index at /clientes/:id instead of redirecting', async () => {
    setAuth('owner');
    renderAt('/clientes/42');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Aurora Estética' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('path')).toHaveTextContent('/clientes/42');
    // No desktop header or pill strip on phones.
    expect(document.querySelector('.cliente-tabs-nav')).toBeNull();
    expect(document.querySelector('.cliente-detalhe-header')).toBeNull();

    for (const group of ['Cliente', 'Canais e análise', 'Portal do cliente', 'Gestão']) {
      expect(screen.getByRole('heading', { level: 2, name: group })).toBeInTheDocument();
    }
    const nav = screen.getByRole('navigation', { name: 'Navegação da página' });
    const links = within(nav)
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'));
    expect(links).toEqual([
      '/clientes/42/visao-geral',
      '/clientes/42/entregas',
      '/clientes/42/redes-sociais',
      '/clientes/42/relatorios',
      '/clientes/42/hub/acesso',
      '/clientes/42/hub/briefing',
      '/clientes/42/hub/marca',
      '/clientes/42/hub/paginas',
      '/clientes/42/hub/ideias',
      '/clientes/42/arquivos',
      '/clientes/42/financeiro',
    ]);

    const facts = screen.getByRole('group', { name: 'Resumo do cliente' });
    expect(facts).toHaveTextContent('Dia 10');
    expect(facts).toHaveTextContent('Dia 5');
    expect(facts).toHaveTextContent('Estética');
  });

  it('lists only the sections the member can open', async () => {
    setAuth('agent');
    renderAt('/clientes/42');

    await screen.findByRole('heading', { level: 1, name: 'Aurora Estética' });
    expect(screen.queryByRole('heading', { level: 2, name: 'Portal do cliente' })).toBeNull();
    expect(screen.queryByRole('link', { name: /Financeiro/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Visão geral/ })).toBeInTheDocument();
  });

  it('still sends an OAuth callback to Redes sociais, keeping the query string', async () => {
    setAuth('owner');
    renderAt('/clientes/42?ig_connected=1&foo=bar');

    expect(await screen.findByText('conteudo redes-sociais')).toBeInTheDocument();
    expect(screen.getByTestId('path')).toHaveTextContent(
      '/clientes/42/redes-sociais?ig_connected=1&foo=bar',
    );
  });

  it('keeps redirecting an unknown segment to Visão geral', async () => {
    setAuth('owner');
    renderAt('/clientes/42/nao-existe');

    expect(await screen.findByText('conteudo visao-geral')).toBeInTheDocument();
    expect(screen.getByTestId('path')).toHaveTextContent('/clientes/42/visao-geral');
  });

  it('renders a section under one nav bar with its large title', async () => {
    setAuth('owner');
    renderAt('/clientes/42/entregas');

    expect(await screen.findByText('conteudo entregas')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Entregas' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Voltar/ })).toHaveLength(1);
  });

  it('Back from a section opened directly replaces it with the index', async () => {
    setAuth('owner');
    renderAt('/clientes/42/arquivos');

    fireEvent.click(await screen.findByRole('button', { name: 'Voltar para Aurora Estética' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Aurora Estética' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/clientes\/42$/);
  });

  it('Back from a section opened from the index pops back to it', async () => {
    setAuth('owner');
    renderAt('/clientes/42');

    fireEvent.click(await screen.findByRole('link', { name: /Relatórios/ }));
    expect(await screen.findByText('conteudo relatorios')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Voltar para Aurora Estética' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Aurora Estética' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/clientes\/42$/);
  });

  it('"…" offers Editar cliente and the photo actions; Editar opens the edit dialog', async () => {
    setAuth('owner');
    renderAt('/clientes/42');

    fireEvent.click(await screen.findByRole('button', { name: 'Mais ações do cliente' }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByRole('button', { name: 'Alterar foto' })).toBeInTheDocument();
    // No photo yet: nothing to remove.
    expect(within(sheet).queryByRole('button', { name: 'Remover foto' })).toBeNull();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Editar cliente' }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: /Editar/ })).toBeInTheDocument());
  });
});

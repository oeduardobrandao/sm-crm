import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store')>()),
  getClienteDatas: vi.fn(),
  getClienteEnderecos: vi.fn(),
}));

import { getClienteDatas, getClienteEnderecos, type Cliente } from '@/store';
import type { ClienteDetalheOutletContext } from '../../clienteTabs.model';
import VisaoGeralTab from '../VisaoGeralTab';

const mockedGetDatas = vi.mocked(getClienteDatas);
const mockedGetEnderecos = vi.mocked(getClienteEnderecos);

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
  especialidade: 'Dermatologia',
  data_aniversario: '03-15',
  notion_page_url: 'https://notion.so/aurora',
};

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
            <Route path="/" element={<VisaoGeralTab />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, queryClient };
}

describe('VisaoGeralTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetDatas.mockResolvedValue([]);
    mockedGetEnderecos.mockResolvedValue([]);
  });

  it('renders the cadastral info fields from the outlet-context cliente', async () => {
    renderTab();
    expect(await screen.findByText('contato@aurora.com.br')).toBeInTheDocument();
    expect(screen.getByText('(85) 99999-0000')).toBeInTheDocument();
    expect(screen.getByText('Dia 10')).toBeInTheDocument();
    expect(screen.getByText('Dia 5')).toBeInTheDocument();
    expect(screen.getByText('Dermatologia')).toBeInTheDocument();
    expect(screen.getByText('15 de Março')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir no Notion' })).toHaveAttribute(
      'href',
      'https://notion.so/aurora',
    );
  });

  it('renders em-dash placeholders when optional cadastral fields are unset', async () => {
    renderTab({
      ...CLIENTE,
      data_pagamento: undefined,
      dia_entrega: undefined,
      especialidade: undefined,
      data_aniversario: undefined,
      notion_page_url: undefined,
      email: '',
      telefone: '',
    });
    await waitFor(() => expect(screen.getAllByText('—').length).toBeGreaterThan(0));
    expect(screen.queryByRole('link', { name: 'Abrir no Notion' })).not.toBeInTheDocument();
  });

  it('renders both the important-dates and addresses empty states', async () => {
    renderTab();
    expect(await screen.findByText('Nenhuma data importante cadastrada')).toBeInTheDocument();
    expect(screen.getByText('Nenhum endereço cadastrado')).toBeInTheDocument();
  });

  it('queries only clienteDatas and clienteEnderecos — nothing from Entregas, Instagram, Hub or Financeiro', async () => {
    const { queryClient } = renderTab();
    await screen.findByText('Nenhuma data importante cadastrada');
    await screen.findByText('Nenhum endereço cadastrado');

    await waitFor(() => {
      const keys = queryClient
        .getQueryCache()
        .getAll()
        .map((q) => q.queryKey[0]);
      expect(new Set(keys)).toEqual(new Set(['clienteDatas', 'clienteEnderecos']));
    });
  });
});

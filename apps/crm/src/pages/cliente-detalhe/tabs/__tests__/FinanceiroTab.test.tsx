import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Cliente, Contrato, Transacao } from '@/store';
import { MASKED_BRL } from '@/lib/financialAccess';
import type { ClienteDetalheOutletContext } from '../../clienteTabs.model';

// FinanceiroTab is the most security-sensitive tab in the cliente-detalhe
// split. Route-level access (owner/admin-authorized vs admin-restricted vs
// agent, direct URL access, the 'unknown' loading state) is already
// thoroughly covered by ClienteDetalhePage.test.tsx and
// clienteTabs.model.test.ts (financeiroTabGuardOutcome / canAccessClienteTab)
// — this component never re-implements that three-state check, it only ever
// mounts once the route guard has resolved `canSeeFinancials === true`.
//
// What THIS suite proves is the second, independent layer: the redundant
// query-level guard inside FinanceiroTab itself (`enabled` + read-time
// filter on `contratos`/`transacoes`), including the "live revocation"
// scenario the route guard alone cannot cover — cached data surviving a
// permission flip while the component stays mounted.
const { getContratosMock, getTransacoesMock } = vi.hoisted(() => ({
  getContratosMock: vi.fn(),
  getTransacoesMock: vi.fn(),
}));
vi.mock('@/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store')>()),
  getContratos: (...args: unknown[]) => getContratosMock(...args),
  getTransacoes: (...args: unknown[]) => getTransacoesMock(...args),
}));

vi.mock('@/context/AuthContext', () => ({ useAuth: vi.fn() }));

import { useAuth } from '@/context/AuthContext';
import FinanceiroTab from '../FinanceiroTab';

const mockedUseAuth = vi.mocked(useAuth);

function setAuth(canSeeFinancials: boolean | 'unknown') {
  mockedUseAuth.mockReturnValue({ canSeeFinancials } as never);
}

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
};

const CONTRATOS: Contrato[] = [
  {
    id: 1,
    cliente_id: 42,
    cliente_nome: 'Aurora Estética',
    titulo: 'Contrato Anual',
    data_inicio: '2026-01-01',
    data_fim: '2026-12-31',
    status: 'vigente',
    valor_total: 18000,
  },
  {
    id: 2,
    cliente_id: 99,
    cliente_nome: 'Outro Cliente',
    titulo: 'Contrato de outro cliente',
    data_inicio: '2026-01-01',
    data_fim: '2026-12-31',
    status: 'vigente',
    valor_total: 5000,
  },
];

const TRANSACOES: Transacao[] = [
  {
    id: 1,
    cliente_id: 42,
    data: '2026-08-01',
    descricao: 'Mensalidade Agosto',
    detalhe: '',
    categoria: 'mensalidade',
    tipo: 'entrada',
    valor: 1500,
    status: 'pago',
  },
  {
    id: 2,
    cliente_id: 42,
    data: '2026-08-10',
    descricao: 'Serviço extra',
    detalhe: '',
    categoria: 'extra',
    tipo: 'entrada',
    valor: 300,
    status: 'pago',
  },
  {
    id: 3,
    cliente_id: 42,
    data: '2026-09-01',
    descricao: 'Mensalidade Setembro',
    detalhe: '',
    categoria: 'mensalidade',
    tipo: 'entrada',
    valor: 800,
    status: 'agendado',
  },
  {
    id: 4,
    cliente_id: 42,
    data: '2026-08-05',
    descricao: 'Reembolso',
    detalhe: '',
    categoria: 'reembolso',
    tipo: 'saida',
    valor: 200,
    status: 'pago',
  },
  {
    id: 5,
    cliente_id: 99,
    data: '2026-08-01',
    descricao: 'Transação de outro cliente',
    detalhe: '',
    categoria: 'mensalidade',
    tipo: 'entrada',
    valor: 999,
    status: 'pago',
  },
];

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
            <Route path="/" element={<FinanceiroTab />} />
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

describe('FinanceiroTab', () => {
  it('renders KPIs, contracts and transactions scoped to this client when canSeeFinancials is true (owner/admin-authorized)', async () => {
    setAuth(true);
    getContratosMock.mockResolvedValue(CONTRATOS);
    getTransacoesMock.mockResolvedValue(TRANSACOES);
    renderTab();

    expect(await screen.findByText('Contrato Anual')).toBeInTheDocument();
    // Other clients' rows never render, even though the underlying queries
    // return the whole workspace.
    expect(screen.queryByText('Contrato de outro cliente')).not.toBeInTheDocument();
    expect(screen.queryByText('Transação de outro cliente')).not.toBeInTheDocument();

    expect(screen.getByText('Mensalidade Agosto')).toBeInTheDocument();
    expect(screen.getByText('Serviço extra')).toBeInTheDocument();
    expect(screen.getByText('Mensalidade Setembro')).toBeInTheDocument();
    expect(screen.getByText('Reembolso')).toBeInTheDocument();

    // Monthly value comes straight from `cliente`, unmasked when authorized.
    expect(screen.getByText('R$ 1.500,00')).toBeInTheDocument();

    expect(getContratosMock).toHaveBeenCalledTimes(1);
    expect(getTransacoesMock).toHaveBeenCalledTimes(1);
  });

  it('computes receitaTotal (entrada+pago) and pendente (entrada+agendado), excluding saida and other clients', async () => {
    setAuth(true);
    getContratosMock.mockResolvedValue([]);
    getTransacoesMock.mockResolvedValue(TRANSACOES);
    renderTab();

    await waitFor(() => expect(getTransacoesMock).toHaveBeenCalledTimes(1));

    // receitaTotal = 1500 (pago) + 300 (pago) = 1800; excludes the 200 saida,
    // the 800 agendado, and the 999 belonging to cliente 99.
    expect(await screen.findByText('R$ 1.800,00')).toBeInTheDocument();
    // pendente = 800 (agendado); excludes everything else.
    expect(screen.getByText('R$ 800,00')).toBeInTheDocument();
  });

  it('renders empty states for zero contracts and zero transactions', async () => {
    setAuth(true);
    getContratosMock.mockResolvedValue([]);
    getTransacoesMock.mockResolvedValue([]);
    renderTab();

    await waitFor(() => expect(getContratosMock).toHaveBeenCalledTimes(1));

    expect(screen.getByText('Nenhum contrato cadastrado')).toBeInTheDocument();
    expect(
      screen.getByText('Os contratos vinculados a este cliente aparecerão aqui.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Gerenciar contratos/ })).toHaveAttribute(
      'href',
      '/contratos',
    );

    expect(screen.getByText('Nenhuma transação registrada')).toBeInTheDocument();
    expect(
      screen.getByText('Os lançamentos financeiros deste cliente aparecerão aqui.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ver financeiro/ })).toHaveAttribute(
      'href',
      '/financeiro',
    );

    // receitaTotal/pendente are both 0 with no transactions, but still masked
    // through formatFinancialBRL rather than a raw "R$ 0,00" special-case.
    expect(screen.getAllByText('R$ 0,00').length).toBeGreaterThanOrEqual(1);
  });

  it('never calls getContratos/getTransacoes when canSeeFinancials is false (restricted admin or agent), and masks every value', async () => {
    setAuth(false);
    renderTab();

    // Give any accidental fetch a chance to fire before asserting silence.
    await waitFor(() => expect(screen.getAllByText(MASKED_BRL).length).toBe(3));

    expect(getContratosMock).not.toHaveBeenCalled();
    expect(getTransacoesMock).not.toHaveBeenCalled();
    expect(screen.getByText('Nenhum contrato cadastrado')).toBeInTheDocument();
    expect(screen.getByText('Nenhuma transação registrada')).toBeInTheDocument();
  });

  it('never calls getContratos/getTransacoes while canSeeFinancials is unknown', async () => {
    setAuth('unknown');
    renderTab();

    await waitFor(() => expect(screen.getAllByText(MASKED_BRL).length).toBe(3));

    expect(getContratosMock).not.toHaveBeenCalled();
    expect(getTransacoesMock).not.toHaveBeenCalled();
  });

  it('live revocation: cached data from an earlier authorized render stops showing once canSeeFinancials flips to false, without a new fetch', async () => {
    setAuth(true);
    getContratosMock.mockResolvedValue(CONTRATOS);
    getTransacoesMock.mockResolvedValue(TRANSACOES);
    const { rerender, queryClient } = renderTab();

    expect(await screen.findByText('Contrato Anual')).toBeInTheDocument();
    expect(getContratosMock).toHaveBeenCalledTimes(1);
    expect(getTransacoesMock).toHaveBeenCalledTimes(1);
    // Confirm the cache genuinely holds the real rows before revoking —
    // otherwise the next assertion would pass for the wrong reason.
    expect(queryClient.getQueryData(['contratos'])).toEqual(CONTRATOS);
    expect(queryClient.getQueryData(['transacoes'])).toEqual(TRANSACOES);

    // Simulate a live revocation event: the membership row changes and
    // AuthContext now reports canSeeFinancials === false, while the SAME
    // QueryClient instance (and thus its cache) is reused — this is the
    // exact scenario the read-time ternary guard exists for. `enabled:
    // false` alone would not clear this already-cached data.
    setAuth(false);
    rerender(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route element={<OutletContextProvider cliente={CLIENTE} />}>
              <Route path="/" element={<FinanceiroTab />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.queryByText('Contrato Anual')).not.toBeInTheDocument();
    expect(screen.queryByText('Mensalidade Agosto')).not.toBeInTheDocument();
    expect(screen.getByText('Nenhum contrato cadastrado')).toBeInTheDocument();
    expect(screen.getByText('Nenhuma transação registrada')).toBeInTheDocument();
    expect(screen.getAllByText(MASKED_BRL).length).toBe(3);

    // No new fetch was triggered by the flip — the cache still holds the
    // stale data (`enabled: false` never clears it), only the read is gated.
    expect(getContratosMock).toHaveBeenCalledTimes(1);
    expect(getTransacoesMock).toHaveBeenCalledTimes(1);
  });

  it('fires only the contratos/transacoes queries — no queries from other tabs', async () => {
    setAuth(true);
    getContratosMock.mockResolvedValue(CONTRATOS);
    getTransacoesMock.mockResolvedValue(TRANSACOES);
    const { queryClient } = renderTab();

    await waitFor(() => expect(screen.getByText('Contrato Anual')).toBeInTheDocument());

    const keys = queryClient
      .getQueryCache()
      .getAll()
      .map((q) => q.queryKey[0])
      .sort();
    expect(keys).toEqual(['contratos', 'transacoes']);
  });
});

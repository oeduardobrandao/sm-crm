import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { planilha } from '../../../financeiro/v2/__tests__/fixtures/planilha';
import type { Cliente } from '@/store';
import type { ClienteVersao, Rentabilidade } from '@/store/financeiroV2';
import type { ClienteDetalheOutletContext } from '../../clienteTabs.model';

beforeAll(() => {
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () =>
    false;
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
});

vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));
const { useAuthMock, v2, store } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  v2: { ativo: true },
  store: {
    getContratos: vi.fn(),
    getTransacoes: vi.fn(),
    getRentabilidade: vi.fn(),
    getClienteVersoes: vi.fn(),
    getPeriodosEditaveis: vi.fn(),
    salvarAtribuicoes: vi.fn(),
    salvarCliente: vi.fn(),
  },
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: useAuthMock }));
vi.mock('@/hooks/useFinanceiroV2', () => ({
  useFinanceiroV2: () => ({ ativo: v2.ativo, isLoading: false }),
}));
vi.mock('@/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store')>()),
  ...store,
}));

import FinanceiroTab from '../FinanceiroTab';

const CLIENTE: Cliente = {
  id: 9,
  nome: 'Talitha',
  sigla: 'TA',
  cor: '#ffbf30',
  plano: 'Ouro',
  email: 't@t.com',
  telefone: '',
  status: 'ativo',
  valor_mensal: 2400,
  data_pagamento: 5,
};

function versao(over: Partial<ClienteVersao>): ClienteVersao {
  return {
    id: 1,
    cliente_id: 9,
    vale_desde: '2026-10-01',
    valor_mensal: 2500,
    dia_pagamento: 10,
    status: 'ativo',
    created_by: null,
    ...over,
  };
}

function setAuth(opts: { financials?: boolean | 'unknown'; editar?: boolean } = {}) {
  useAuthMock.mockReturnValue({
    canSeeFinancials: opts.financials ?? true,
    can: (m: string, a: string) =>
      m === 'financeiro' && a === 'editar' ? (opts.editar ?? true) : true,
    profile: { conta_id: 'w1' },
  });
}

function renderTab(cliente: Cliente = CLIENTE) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route
            element={
              <Outlet
                context={{ clienteId: cliente.id!, cliente } satisfies ClienteDetalheOutletContext}
              />
            }
          >
            <Route path="/" element={<FinanceiroTab />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const kpi = (label: string) => screen.getByText(label).closest('.kpi-card') as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  v2.ativo = true;
  setAuth();
  store.getContratos.mockResolvedValue([]);
  store.getTransacoes.mockResolvedValue([]);
  store.getRentabilidade.mockResolvedValue(structuredClone(planilha) as Rentabilidade);
  store.getClienteVersoes.mockResolvedValue([
    versao({ id: 1, vale_desde: '2026-08-01', dia_pagamento: 3 }),
    versao({ id: 2, vale_desde: '2026-10-01', dia_pagamento: 10 }),
    versao({ id: 3, vale_desde: '2026-11-01', dia_pagamento: 20 }),
  ]);
  store.getPeriodosEditaveis.mockResolvedValue([
    {
      inicio: '2026-10-01',
      fim: '2026-11-01',
      rotulo: 'out 2026',
      status: 'aberto',
      transicao: false,
    },
  ]);
});

describe('FinanceiroTab with Financeiro v2', () => {
  it('shows the four v2 KPIs from the client entry', async () => {
    renderTab();

    expect(await screen.findByText('Vence todo dia 10')).toBeVisible();
    expect(within(kpi('Mensalidade')).getByText(/R\$\s2\.500,00/)).toBeVisible();
    expect(within(kpi('Custo da equipe')).getByText(/R\$\s1\.180,00/)).toBeVisible();
    expect(screen.getByText('4 pessoas atendem')).toBeVisible();
    expect(within(kpi('Lucro mensal')).getByText(/R\$\s1\.320,00/)).toBeVisible();
    expect(screen.getByText(/LL anual R\$\s15\.840,00/)).toBeVisible();
    expect(within(kpi('Margem')).getByText('52,8%')).toBeVisible();
    expect(screen.getByText('Meta da agência: 55%')).toBeVisible();
    // The legacy cards are gone and the team card is there.
    expect(screen.queryByText('Total recebido')).not.toBeInTheDocument();
    expect(screen.getByText('Equipe neste cliente')).toBeVisible();
  });

  it('falls back to the legacy payment day when the client has no version yet', async () => {
    store.getClienteVersoes.mockResolvedValue([]);
    renderTab();
    expect(await screen.findByText('Vence todo dia 5')).toBeVisible();
  });

  it('omits the due-day line when there is no payment day anywhere', async () => {
    store.getClienteVersoes.mockResolvedValue([]);
    renderTab({ ...CLIENTE, data_pagamento: undefined });
    await screen.findByText('Equipe neste cliente');
    expect(screen.queryByText(/Vence todo dia/)).not.toBeInTheDocument();
  });

  it('shows dashes and a note when the client is not in the current period', async () => {
    renderTab({ ...CLIENTE, id: 999 });

    expect(await screen.findByText('Este cliente não entra no período atual.')).toBeVisible();
    expect(within(kpi('Mensalidade')).getByText('-')).toBeVisible();
    expect(within(kpi('Margem')).getByText('-')).toBeVisible();
    expect(screen.queryByText('Equipe neste cliente')).not.toBeInTheDocument();
  });

  it('says the client is encerrado when its version in force is', async () => {
    store.getClienteVersoes.mockResolvedValue([
      versao({ id: 1, vale_desde: '2026-08-01' }),
      versao({ id: 2, vale_desde: '2026-10-01', status: 'encerrado' }),
    ]);
    renderTab({ ...CLIENTE, id: 999 });

    expect(await screen.findByText('Cliente encerrado neste período.')).toBeVisible();
    expect(screen.queryByText('Este cliente não entra no período atual.')).not.toBeInTheDocument();
  });

  it('marks a paused client with a badge and a dash margin', async () => {
    const r = structuredClone(planilha) as typeof planilha;
    const c = r.clientes.find((x) => x.cliente_id === 9)!;
    Object.assign(c, { status: 'pausado', receita: 0, margem: null, lucro: -c.custo });
    store.getRentabilidade.mockResolvedValue(r);
    renderTab();

    await screen.findByText('Equipe neste cliente');
    expect(within(kpi('Margem')).getByText('-')).toBeVisible();
    expect(within(kpi('Margem')).getByText('Pausado')).toBeVisible();
  });

  it('opens the mensalidade dialog from the Editar button', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(await screen.findByRole('button', { name: 'Editar mensalidade' }));
    expect(await screen.findByRole('spinbutton', { name: 'Valor mensal' })).toHaveValue(2500);
  });

  it('hides the Editar button without financeiro/editar', async () => {
    setAuth({ editar: false });
    renderTab();
    await screen.findByText('Equipe neste cliente');
    expect(screen.queryByRole('button', { name: 'Editar mensalidade' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('keeps the legacy cards and fires no v2 query with the flag off', async () => {
    v2.ativo = false;
    renderTab();

    expect(await screen.findByText('Total recebido')).toBeVisible();
    expect(screen.queryByText('Equipe neste cliente')).not.toBeInTheDocument();
    expect(store.getRentabilidade).not.toHaveBeenCalled();
    expect(store.getClienteVersoes).not.toHaveBeenCalled();
  });

  it('keeps the legacy cards when the user cannot see financials', async () => {
    setAuth({ financials: false });
    renderTab();

    expect(await screen.findByText('Total recebido')).toBeVisible();
    expect(store.getRentabilidade).not.toHaveBeenCalled();
  });

  it('keeps the legacy cards before the financeiro is set up', async () => {
    store.getRentabilidade.mockResolvedValue({ seeded: false });
    renderTab();

    expect(await screen.findByText('Total recebido')).toBeVisible();
    expect(screen.queryByText('Equipe neste cliente')).not.toBeInTheDocument();
  });

  it('formats a fractional agency goal with a comma', async () => {
    const r = structuredClone(planilha) as typeof planilha;
    r.meta_margem = 55.5;
    store.getRentabilidade.mockResolvedValue(r);
    renderTab();

    expect(await screen.findByText('Meta da agência: 55,5%')).toBeVisible();
  });
});

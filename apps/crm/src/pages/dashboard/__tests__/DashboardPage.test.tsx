import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { useAuthMock, useQueriesMock, useQueryMock, onboardingBannerMock } = vi.hoisted(
  () => ({
    useAuthMock: vi.fn(),
    useQueriesMock: vi.fn(),
    useQueryMock: vi.fn(),
    onboardingBannerMock: vi.fn(),
  }),
);

vi.mock('@tanstack/react-query', () => ({
  useQueries: useQueriesMock,
  useQuery: useQueryMock,
}));

vi.mock('../../../context/AuthContext', () => ({
  useAuth: useAuthMock,
}));

vi.mock('../../../components/OnboardingBanner', () => ({
  OnboardingBanner: onboardingBannerMock,
}));

vi.mock('../../../store', () => ({
  getDashboardStats: vi.fn(),
  getLeads: vi.fn(),
  getMembros: vi.fn(),
  getClientes: vi.fn(),
  getWorkflows: vi.fn(),
  getWorkflowEtapas: vi.fn(),
  getAllClienteDatas: vi.fn(),
  formatBRL: (value: number) => `R$ ${Number(value).toLocaleString('pt-BR')}`,
  formatDate: (value: string) => value,
}));

vi.mock('../../../services/analytics', () => ({
  getPortfolioSummary: vi.fn(),
}));

// Mock ClientHealthMonitor so DashboardPage tests aren't coupled to its internals
vi.mock('../components/ClientHealthMonitor', () => ({
  ClientHealthMonitor: () => <div data-testid="client-health-monitor">Saúde dos clientes</div>,
}));

import DashboardPage from '../DashboardPage';

const mockedUseAuth = vi.mocked(useAuthMock);
const mockedUseQueries = vi.mocked(useQueriesMock);
const mockedUseQuery = vi.mocked(useQueryMock);
const mockedOnboardingBanner = vi.mocked(onboardingBannerMock);

const frozenNow = new Date('2026-04-18T12:00:00-03:00');

function renderDashboardPage() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

function makeQueryResult<T>(data: T, isLoading = false) {
  return { data, isLoading };
}

// New useQueries order: [statsRes, membrosRes, clientesRes, workflowsRes, leadsRes, portfolioRes]
function makeDefaultUseQueries(overrides: Partial<Record<number, ReturnType<typeof makeQueryResult<unknown>>>> = {}) {
  const defaults = [
    makeQueryResult(null),                              // 0: dashboardStats
    makeQueryResult([]),                                // 1: membros
    makeQueryResult([]),                                // 2: clientes
    makeQueryResult([]),                                // 3: workflows
    makeQueryResult([]),                                // 4: leads
    makeQueryResult({ accounts: [], summary: {} }),     // 5: portfolioSummary
  ];
  return Object.entries(overrides).reduce((acc, [idx, val]) => {
    acc[Number(idx)] = val;
    return acc;
  }, defaults);
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(frozenNow);

    mockedUseAuth.mockReset();
    mockedUseQueries.mockReset();
    mockedUseQuery.mockReset();
    mockedOnboardingBanner.mockReset();

    mockedUseAuth.mockReturnValue({ role: 'admin' } as never);
    mockedUseQueries.mockReturnValue(makeDefaultUseQueries() as never);
    mockedUseQuery.mockImplementation(({ queryKey }: { queryKey: readonly unknown[] }) => {
      if (queryKey[0] === 'allClienteDatas') return makeQueryResult([]);
      if (queryKey[0] === 'calendar-deadlines') return makeQueryResult([]);
      return makeQueryResult([]);
    });
    mockedOnboardingBanner.mockImplementation(() => <div data-testid="onboarding-banner" />);
  });

  it('always renders ClientHealthMonitor and TodayCard regardless of loading state', () => {
    // Even with all queries loading, the health monitor and today card shell should mount
    mockedUseQueries.mockReturnValue(
      makeDefaultUseQueries({ 0: makeQueryResult(null, true) }) as never,
    );

    renderDashboardPage();

    expect(screen.getByTestId('client-health-monitor')).toBeInTheDocument();
    expect(screen.getByText('Hoje')).toBeInTheDocument();
  });

  it('renders the agent branch without onboarding banner or finance strip', () => {
    mockedUseAuth.mockReturnValue({ role: 'agent' } as never);
    mockedUseQueries.mockReturnValue(
      makeDefaultUseQueries({
        0: makeQueryResult({
          transacoes: [
            { id: 'tx-1', tipo: 'entrada', status: 'agendado', valor: 1200, descricao: 'Receita A' },
          ],
          receitaMensal: 0,
          despesaTotal: 0,
          saldo: 0,
          clientesAtivos: [],
          clientes: [],
        }),
        1: makeQueryResult([
          { id: 'mem-1', nome: 'Membro 1', tipo: 'clt', custo_mensal: 5000, data_pagamento: 18 },
        ]),
        2: makeQueryResult([
          { id: 'cli-1', nome: 'Cliente 1', status: 'ativo', cor: '#111', data_pagamento: 18, data_aniversario: '04-18' },
        ]),
        3: makeQueryResult([]),
        4: makeQueryResult([]),
        5: makeQueryResult({ accounts: [], summary: {} }),
      }) as never,
    );

    renderDashboardPage();

    // Agent: no onboarding, no finance strip
    expect(screen.queryByTestId('onboarding-banner')).not.toBeInTheDocument();
    expect(screen.queryByText('A RECEBER')).not.toBeInTheDocument();
    expect(screen.queryByText('RECEITA MENSAL')).not.toBeInTheDocument();
    // Health monitor and today card are always present
    expect(screen.getByTestId('client-health-monitor')).toBeInTheDocument();
    expect(screen.getByText('Hoje')).toBeInTheDocument();
    // Agent: income/expense events are suppressed; birthday still shows
    expect(screen.queryByText('Recebimento')).not.toBeInTheDocument();
    expect(screen.queryByText('Despesa')).not.toBeInTheDocument();
    expect(screen.getByText('Aniversário')).toBeInTheDocument();
  });

  it('shows onboarding, today events, and finance KPIs for non-agent', () => {
    mockedUseQueries.mockReturnValue(
      makeDefaultUseQueries({
        0: makeQueryResult({
          transacoes: [
            { id: 'tx-1', tipo: 'entrada', status: 'agendado', valor: 1200, descricao: 'Receita A' },
            { id: 'tx-2', tipo: 'saida', status: 'agendado', valor: 450, descricao: 'Despesa B' },
            { id: 'tx-3', tipo: 'entrada', status: 'concluido', valor: 300, descricao: 'Receita antiga' },
          ],
          receitaMensal: 1800,
          despesaTotal: 450,
          saldo: 1350,
          clientesAtivos: [{ id: 'cli-1' }],
          clientes: [{ id: 'cli-1' }, { id: 'cli-2' }],
        }),
        1: makeQueryResult([
          { id: 'mem-1', nome: 'Ana', tipo: 'clt', custo_mensal: 5000, data_pagamento: 18 },
        ]),
        2: makeQueryResult([
          { id: 'cli-1', nome: 'Cliente Hoje', status: 'ativo', cor: '#111', data_pagamento: 18, data_aniversario: '04-18' },
          { id: 'cli-2', nome: 'Cliente Futuro', status: 'ativo', cor: '#222', data_pagamento: 25, data_aniversario: '01-01' },
        ]),
        3: makeQueryResult([]),
        4: makeQueryResult([]),
        5: makeQueryResult({ accounts: [], summary: {} }),
      }) as never,
    );

    mockedUseQuery.mockImplementation(({ queryKey }: { queryKey: readonly unknown[] }) => {
      if (queryKey[0] === 'allClienteDatas') {
        return makeQueryResult([{ id: 'data-1', titulo: 'Lançamento', data: '2026-04-18', cliente_id: 'cli-1' }]);
      }
      if (queryKey[0] === 'calendar-deadlines') {
        return makeQueryResult([]);
      }
      return makeQueryResult([]);
    });

    renderDashboardPage();

    // Onboarding banner present for non-agent
    expect(screen.getByTestId('onboarding-banner')).toBeInTheDocument();

    // Health monitor always present
    expect(screen.getByTestId('client-health-monitor')).toBeInTheDocument();

    // Today events from TodayCard
    expect(screen.getAllByText('Cliente Hoje').length).toBeGreaterThan(0);
    expect(screen.getByText('Recebimento')).toBeInTheDocument();
    expect(screen.getByText('Despesa')).toBeInTheDocument();
    expect(screen.getByText('Aniversário')).toBeInTheDocument();
    expect(screen.getByText('Lançamento')).toBeInTheDocument();

    // Finance KPI strip (FinanceKpiStrip component)
    expect(screen.getByText('A RECEBER')).toBeInTheDocument();
    expect(screen.getByText('A PAGAR')).toBeInTheDocument();
    expect(screen.getByText('SALDO')).toBeInTheDocument();
    expect(screen.getByText('RECEITA MENSAL')).toBeInTheDocument();
  });

  it('shows the empty today card when there are no events', () => {
    mockedUseQueries.mockReturnValue(
      makeDefaultUseQueries({
        0: makeQueryResult({
          transacoes: [],
          receitaMensal: 0,
          despesaTotal: 0,
          saldo: 0,
          clientesAtivos: [],
          clientes: [],
        }),
      }) as never,
    );
    mockedUseQuery.mockReturnValue(makeQueryResult([]));

    renderDashboardPage();

    expect(screen.getByText('Nenhum evento hoje.')).toBeInTheDocument();
  });
});

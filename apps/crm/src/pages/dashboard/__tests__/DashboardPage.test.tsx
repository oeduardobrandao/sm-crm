import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  useAuthMock,
  useQueriesMock,
  useQueryMock,
  useQueryClientMock,
  onboardingBannerMock,
  toastSuccessMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useQueriesMock: vi.fn(),
  useQueryMock: vi.fn(),
  useQueryClientMock: vi.fn(),
  onboardingBannerMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: toastSuccessMock, error: toastErrorMock },
}));

vi.mock('@tanstack/react-query', () => ({
  useQueries: useQueriesMock,
  useQuery: useQueryMock,
  useQueryClient: useQueryClientMock,
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

// Same for the agent variant — it owns its own queries and is tested separately
vi.mock('../components/AgentPendingSection', () => ({
  AgentPendingSection: () => <div data-testid="agent-pending-section">Minhas pendências</div>,
}));

// TodayCard owns its role-aware queries (useTodayAgenda) and is tested separately
vi.mock('../components/TodayCard', () => ({
  TodayCard: () => <div data-testid="today-card">Hoje</div>,
}));

import DashboardPage from '../DashboardPage';

const mockedUseAuth = vi.mocked(useAuthMock);
const mockedUseQueries = vi.mocked(useQueriesMock);
const mockedUseQuery = vi.mocked(useQueryMock);
const mockedUseQueryClient = vi.mocked(useQueryClientMock);
const mockedOnboardingBanner = vi.mocked(onboardingBannerMock);

const frozenNow = new Date('2026-04-18T12:00:00-03:00');

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
}

function renderDashboardPage(entry = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <DashboardPage />
      <LocationProbe />
    </MemoryRouter>,
  );
}

function makeQueryResult<T>(data: T, isLoading = false) {
  return { data, isLoading };
}

// New useQueries order: [statsRes, membrosRes, clientesRes, workflowsRes, leadsRes, portfolioRes]
function makeDefaultUseQueries(
  overrides: Partial<Record<number, ReturnType<typeof makeQueryResult<unknown>>>> = {},
) {
  const defaults = [
    makeQueryResult(null), // 0: dashboardStats
    makeQueryResult([]), // 1: membros
    makeQueryResult([]), // 2: clientes
    makeQueryResult([]), // 3: workflows
    makeQueryResult([]), // 4: leads
    makeQueryResult({ accounts: [], summary: {} }), // 5: portfolioSummary
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
    mockedUseQueryClient.mockReset();
    mockedOnboardingBanner.mockReset();

    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();

    mockedUseQueryClient.mockReturnValue({ invalidateQueries: vi.fn() } as never);
    mockedUseAuth.mockReturnValue({ role: 'admin', canSeeFinancials: true } as never);
    mockedUseQueries.mockReturnValue(makeDefaultUseQueries() as never);
    mockedUseQuery.mockImplementation(() => makeQueryResult([]));
    mockedOnboardingBanner.mockImplementation(() => <div data-testid="onboarding-banner" />);
  });

  it('always renders ClientHealthMonitor and TodayCard regardless of loading state', () => {
    // Even with all queries loading, the health monitor and today card shell should mount
    mockedUseQueries.mockReturnValue(
      makeDefaultUseQueries({ 0: makeQueryResult(null, true) }) as never,
    );

    renderDashboardPage();

    expect(screen.getByTestId('client-health-monitor')).toBeInTheDocument();
    expect(screen.getByTestId('today-card')).toBeInTheDocument();
  });

  it('renders TodayCard as the first section, above the role-specific block', () => {
    renderDashboardPage();

    const today = screen.getByTestId('today-card');
    const health = screen.getByTestId('client-health-monitor');
    // DOCUMENT_POSITION_FOLLOWING (4): health comes after today in DOM order
    expect(today.compareDocumentPosition(health) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders the agent branch without onboarding banner or finance strip', () => {
    mockedUseAuth.mockReturnValue({
      role: 'agent',
      workspaceRole: 'agent',
      canSeeFinancials: false,
    } as never);
    mockedUseQueries.mockReturnValue(
      makeDefaultUseQueries({
        0: makeQueryResult({
          transacoes: [
            {
              id: 'tx-1',
              tipo: 'entrada',
              status: 'agendado',
              valor: 1200,
              descricao: 'Receita A',
            },
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
          {
            id: 'cli-1',
            nome: 'Cliente 1',
            status: 'ativo',
            cor: '#111',
            data_pagamento: 18,
            data_aniversario: '04-18',
          },
        ]),
        3: makeQueryResult([]),
        4: makeQueryResult([]),
        5: makeQueryResult({ accounts: [], summary: {} }),
      }) as never,
    );

    renderDashboardPage();

    // Agent: no onboarding, no finance strip
    expect(screen.queryByTestId('onboarding-banner')).not.toBeInTheDocument();
    expect(screen.queryByText('A receber')).not.toBeInTheDocument();
    expect(screen.queryByText('Receita mensal')).not.toBeInTheDocument();
    // Agent sees their pending-work section INSTEAD of the health monitor
    expect(screen.getByTestId('agent-pending-section')).toBeInTheDocument();
    expect(screen.queryByTestId('client-health-monitor')).not.toBeInTheDocument();
    // Today card still mounts first (its agent scoping is covered by its own tests)
    expect(screen.getByTestId('today-card')).toBeInTheDocument();
  });

  // The dashboard variant follows the ACTIVE workspace role, not the
  // profile-level role, which goes stale across workspace switches.
  it('shows the agent panel when the active workspace role is agent despite a stale owner profile role', () => {
    mockedUseAuth.mockReturnValue({
      role: 'owner',
      workspaceRole: 'agent',
      canSeeFinancials: false,
    } as never);

    renderDashboardPage();

    expect(screen.getByTestId('agent-pending-section')).toBeInTheDocument();
    expect(screen.queryByTestId('client-health-monitor')).not.toBeInTheDocument();
  });

  it('shows client health when the active workspace role is owner despite a stale agent profile role', () => {
    mockedUseAuth.mockReturnValue({
      role: 'agent',
      workspaceRole: 'owner',
      canSeeFinancials: true,
    } as never);

    renderDashboardPage();

    expect(screen.getByTestId('client-health-monitor')).toBeInTheDocument();
    expect(screen.queryByTestId('agent-pending-section')).not.toBeInTheDocument();
  });

  it('shows onboarding, today card, and finance KPIs for non-agent', () => {
    mockedUseQueries.mockReturnValue(
      makeDefaultUseQueries({
        0: makeQueryResult({
          transacoes: [
            {
              id: 'tx-1',
              tipo: 'entrada',
              status: 'agendado',
              valor: 1200,
              descricao: 'Receita A',
            },
            { id: 'tx-2', tipo: 'saida', status: 'agendado', valor: 450, descricao: 'Despesa B' },
            {
              id: 'tx-3',
              tipo: 'entrada',
              status: 'concluido',
              valor: 300,
              descricao: 'Receita antiga',
            },
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
          {
            id: 'cli-1',
            nome: 'Cliente Hoje',
            status: 'ativo',
            cor: '#111',
            data_pagamento: 18,
            data_aniversario: '04-18',
          },
          {
            id: 'cli-2',
            nome: 'Cliente Futuro',
            status: 'ativo',
            cor: '#222',
            data_pagamento: 25,
            data_aniversario: '01-01',
          },
        ]),
        3: makeQueryResult([]),
        4: makeQueryResult([]),
        5: makeQueryResult({ accounts: [], summary: {} }),
      }) as never,
    );

    renderDashboardPage();

    // Onboarding banner present for non-agent
    expect(screen.getByTestId('onboarding-banner')).toBeInTheDocument();

    // Health monitor always present
    expect(screen.getByTestId('client-health-monitor')).toBeInTheDocument();

    // Today card mounts (its content is covered by TodayCard/todayAgenda tests)
    expect(screen.getByTestId('today-card')).toBeInTheDocument();

    // Finance KPI strip (FinanceKpiStrip component)
    expect(screen.getByText('A receber')).toBeInTheDocument();
    expect(screen.getByText('A pagar')).toBeInTheDocument();
    expect(screen.getByText('Saldo')).toBeInTheDocument();
    expect(screen.getByText('Receita mensal')).toBeInTheDocument();
  });

  // The Stripe checkout return leg. This is the only surface that turns a
  // completed checkout into a visible plan change, so the exact invalidation
  // keys are asserted: a key that matches nothing leaves entitlements stale for
  // the full 5 minute staleTime, and the user who just started a trial to
  // unlock relatórios walks into the upgrade paywall instead.
  describe('the ?trial= return handler', () => {
    it('toasts, invalidates billing and workspace-limits, and strips the param on ?trial=started', () => {
      const invalidateQueries = vi.fn();
      mockedUseQueryClient.mockReturnValue({ invalidateQueries } as never);

      renderDashboardPage('/dashboard?trial=started');

      expect(toastSuccessMock).toHaveBeenCalledWith(
        'Teste de 30 dias ativado! Atualizando seu plano…',
      );
      // The re-reads are on an interval, so nothing has been invalidated yet.
      expect(invalidateQueries).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(2000);
      });

      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['billing'] });
      // ['workspace-limits'], NOT ['workspaceLimits'] — useWorkspaceLimits keys
      // its cache ['workspace-limits', workspaceId] and the prefix is what
      // reaches it.
      expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['workspace-limits'] });

      expect(screen.getByTestId('location-search')).toHaveTextContent('');
    });

    it('re-reads five times and then stops', () => {
      const invalidateQueries = vi.fn();
      mockedUseQueryClient.mockReturnValue({ invalidateQueries } as never);

      renderDashboardPage('/dashboard?trial=started');

      act(() => {
        vi.advanceTimersByTime(2000 * 10);
      });

      // 5 ticks x 2 keys.
      expect(invalidateQueries).toHaveBeenCalledTimes(10);
    });

    it('shows no toast and strips the param on ?trial=skipped', () => {
      const invalidateQueries = vi.fn();
      mockedUseQueryClient.mockReturnValue({ invalidateQueries } as never);

      renderDashboardPage('/dashboard?trial=skipped');

      expect(toastSuccessMock).not.toHaveBeenCalled();
      expect(toastErrorMock).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(2000 * 10);
      });

      expect(invalidateQueries).not.toHaveBeenCalled();
      expect(screen.getByTestId('location-search')).toHaveTextContent('');
    });

    it('leaves an unrelated query string alone when there is no trial param', () => {
      renderDashboardPage('/dashboard?foo=bar');

      expect(toastSuccessMock).not.toHaveBeenCalled();
      expect(screen.getByTestId('location-search')).toHaveTextContent('?foo=bar');
    });
  });
});

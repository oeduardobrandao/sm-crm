import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { useAuthMock, useQueriesMock, useQueryMock, onboardingBannerMock, spinnerMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useQueriesMock: vi.fn(),
  useQueryMock: vi.fn(),
  onboardingBannerMock: vi.fn(),
  spinnerMock: vi.fn(),
}));

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

vi.mock('@/components/ui/spinner', () => ({
  Spinner: spinnerMock,
}));

vi.mock('../../../store', () => ({
  getDashboardStats: vi.fn(),
  getLeads: vi.fn(),
  getContratos: vi.fn(),
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

import DashboardPage from '../DashboardPage';

const mockedUseAuth = vi.mocked(useAuthMock);
const mockedUseQueries = vi.mocked(useQueriesMock);
const mockedUseQuery = vi.mocked(useQueryMock);
const mockedOnboardingBanner = vi.mocked(onboardingBannerMock);
const mockedSpinner = vi.mocked(spinnerMock);

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

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(frozenNow);

    mockedUseAuth.mockReset();
    mockedUseQueries.mockReset();
    mockedUseQuery.mockReset();
    mockedOnboardingBanner.mockReset();
    mockedSpinner.mockReset();

    mockedUseAuth.mockReturnValue({ role: 'admin' } as never);
    mockedUseQueries.mockReturnValue([
      makeQueryResult(null),
      makeQueryResult([]),
      makeQueryResult([]),
      makeQueryResult([]),
      makeQueryResult([]),
      makeQueryResult({ accounts: [], summary: {} }),
      makeQueryResult([]),
    ] as never);
    mockedUseQuery.mockImplementation(({ queryKey }: { queryKey: readonly unknown[] }) => {
      if (queryKey[0] === 'allClienteDatas') return makeQueryResult([]);
      if (queryKey[0] === 'calendar-deadlines') return makeQueryResult([]);
      return makeQueryResult([]);
    });
    mockedSpinner.mockImplementation(({ size }: { size?: string }) => <div data-testid="spinner">Spinner {size}</div>);
    mockedOnboardingBanner.mockImplementation(() => <div data-testid="onboarding-banner" />);
  });

  it('shows the loading shell and keeps the onboarding banner hidden while any query is loading', () => {
    mockedUseQueries.mockReturnValue([
      makeQueryResult(null, true),
      makeQueryResult([]),
      makeQueryResult([]),
      makeQueryResult([]),
      makeQueryResult([]),
      makeQueryResult({ accounts: [], summary: {} }),
      makeQueryResult([]),
    ] as never);

    renderDashboardPage();

    expect(screen.getByTestId('spinner')).toHaveTextContent('Spinner lg');
    expect(screen.queryByTestId('onboarding-banner')).not.toBeInTheDocument();
  });

  it('renders the agent branch without onboarding or finance/contract cards', () => {
    mockedUseAuth.mockReturnValue({ role: 'agent' } as never);
    mockedUseQueries.mockReturnValue([
      makeQueryResult({
        transacoes: [
          { id: 'tx-1', tipo: 'entrada', status: 'agendado', valor: 1200, descricao: 'Receita A' },
        ],
        receitaMensal: 0,
        despesaTotal: 0,
        saldo: 0,
        clientesAtivos: [],
        clientes: [],
      }),
      makeQueryResult([
        { id: 'lead-1', nome: 'Lead 1', status: 'novo' },
        { id: 'lead-2', nome: 'Lead 2', status: 'contatado' },
        { id: 'lead-3', nome: 'Lead 3', status: 'qualificado' },
      ]),
      makeQueryResult([
        { id: 'con-1', titulo: 'Contrato 1', status: 'vigente', data_fim: '2026-04-25' },
      ]),
      makeQueryResult([
        { id: 'mem-1', nome: 'Membro 1', tipo: 'clt', custo_mensal: 5000, data_pagamento: 18 },
      ]),
      makeQueryResult([
        { id: 'cli-1', nome: 'Cliente 1', status: 'ativo', cor: '#111111', data_pagamento: 18, data_aniversario: '04-18' },
      ]),
      makeQueryResult({
        accounts: [
          {
            instagram_account_id: 'acc-1',
            client_name: 'Conta A',
            username: 'conta_a',
            follower_count: 1000,
            reach_28d: 2000,
            website_clicks_28d: 30,
            engagement_rate_avg: 4.2,
            client_cor: '#111111',
            client_sigla: 'CA',
          },
        ],
        summary: {
          bestByEngagement: { client_name: 'Conta A', engagement_rate_avg: 4.2 },
          mostImproved: { client_name: 'Conta A', follower_delta: 50 },
          growing: 1,
          stagnant: 0,
          declining: 0,
        },
      }),
      makeQueryResult([
        { id: 'wf-1', titulo: 'Workflow 1', status: 'ativo', cliente_id: 'cli-1' },
      ]),
    ] as never);

    renderDashboardPage();

    expect(screen.queryByTestId('onboarding-banner')).not.toBeInTheDocument();
    expect(screen.getByText('Leads')).toBeInTheDocument();
    expect(screen.getByText('Lead 1')).toBeInTheDocument();
    expect(screen.getByText('CLT: 1')).toBeInTheDocument();
    expect(screen.getAllByText('Conta A').length).toBeGreaterThan(0);
    expect(screen.getByText('Workflow 1')).toBeInTheDocument();
    expect(screen.queryByText('Contratos')).not.toBeInTheDocument();
    expect(screen.queryByText('Financeiro')).not.toBeInTheDocument();
    expect(screen.queryByText('CUSTO/MÊS')).not.toBeInTheDocument();
  });

  it('shows onboarding for non-agents and surfaces today events plus summary cards', () => {
    mockedUseQueries.mockReturnValue([
      makeQueryResult({
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
      makeQueryResult([
        { id: 'lead-1', nome: 'Lead 1', status: 'novo' },
        { id: 'lead-2', nome: 'Lead 2', status: 'contatado' },
        { id: 'lead-3', nome: 'Lead 3', status: 'qualificado' },
        { id: 'lead-4', nome: 'Lead 4', status: 'novo' },
      ]),
      makeQueryResult([
        { id: 'con-1', titulo: 'Contrato 1', status: 'vigente', data_fim: '2026-04-25' },
        { id: 'con-2', titulo: 'Contrato 2', status: 'a_assinar', data_fim: '2026-06-01' },
      ]),
      makeQueryResult([
        { id: 'mem-1', nome: 'Ana', tipo: 'clt', custo_mensal: 5000, data_pagamento: 18 },
        { id: 'mem-2', nome: 'Bia', tipo: 'freelancer_mensal', custo_mensal: 1500, data_pagamento: 20 },
        { id: 'mem-3', nome: 'Caio', tipo: 'freelancer_demanda', custo_mensal: 0, data_pagamento: 19 },
      ]),
      makeQueryResult([
        { id: 'cli-1', nome: 'Cliente Hoje', status: 'ativo', cor: '#111111', data_pagamento: 18, data_aniversario: '04-18' },
        { id: 'cli-2', nome: 'Cliente Futuro', status: 'ativo', cor: '#222222', data_pagamento: 25, data_aniversario: '01-01' },
      ]),
      makeQueryResult({
        accounts: [
          {
            instagram_account_id: 'acc-1',
            client_name: 'Conta A',
            username: 'conta_a',
            follower_count: 1000,
            reach_28d: 2000,
            website_clicks_28d: 30,
            engagement_rate_avg: 4.2,
            client_cor: '#111111',
            client_sigla: 'CA',
          },
          {
            instagram_account_id: 'acc-2',
            client_name: 'Conta B',
            username: 'conta_b',
            follower_count: 500,
            reach_28d: 800,
            website_clicks_28d: 10,
            engagement_rate_avg: 1.2,
            client_cor: '#222222',
            client_sigla: 'CB',
          },
        ],
        summary: {
          bestByEngagement: { client_name: 'Conta A', engagement_rate_avg: 4.2 },
          mostImproved: { client_name: 'Conta B', follower_delta: 75 },
          growing: 1,
          stagnant: 1,
          declining: 0,
        },
      }),
      makeQueryResult([
        { id: 'wf-1', titulo: 'Entrega 1', status: 'ativo', cliente_id: 'cli-1' },
        { id: 'wf-2', titulo: 'Entrega 2', status: 'ativo', cliente_id: 'cli-2' },
        { id: 'wf-3', titulo: 'Entrega 3', status: 'pausado', cliente_id: 'cli-2' },
      ]),
    ] as never);

    mockedUseQuery.mockImplementation(({ queryKey }: { queryKey: readonly unknown[] }) => {
      if (queryKey[0] === 'allClienteDatas') {
        return makeQueryResult([
          { id: 'data-1', titulo: 'Lançamento', data: '2026-04-18' },
        ]);
      }
      if (queryKey[0] === 'calendar-deadlines') {
        return makeQueryResult([
          {
            workflowTitle: 'Entrega 1',
            etapaNome: 'Etapa Hoje',
            clienteNome: 'Cliente Hoje',
            clienteCor: '#111111',
            deadlineDate: new Date('2026-04-18T00:00:00-03:00'),
            diasRestantes: 0,
            estourado: false,
          },
        ]);
      }
      return makeQueryResult([]);
    });

    renderDashboardPage();

    expect(screen.getByTestId('onboarding-banner')).toBeInTheDocument();
    expect(screen.getAllByText('Cliente Hoje').length).toBeGreaterThan(0);
    expect(screen.getByText('Aniversário')).toBeInTheDocument();
    expect(screen.getByText('Lançamento')).toBeInTheDocument();
    expect(screen.getByText('Recebimento')).toBeInTheDocument();
    expect(screen.getByText('Despesa')).toBeInTheDocument();
    expect(screen.getAllByText('R$ 1.200').length).toBeGreaterThan(0);
    expect(screen.getAllByText('R$ 450').length).toBeGreaterThan(0);
    expect(screen.getByText('R$ 6.500')).toBeInTheDocument();
    expect(screen.getByText('R$ 1.350')).toBeInTheDocument();
    expect(screen.getByText('RECEITA MENSAL')).toBeInTheDocument();
    expect(screen.getByText('EXPIRANDO EM 30 DIAS')).toBeInTheDocument();
    expect(screen.getAllByText('Conta A').length).toBeGreaterThan(0);
    expect(screen.getAllByText('4.20%').length).toBeGreaterThan(0);
    expect(screen.getByText('1 crescendo')).toBeInTheDocument();
    expect(screen.getByText('1 estável')).toBeInTheDocument();
    expect(screen.getByText('MELHOR ENG.')).toBeInTheDocument();
    expect(screen.getByText('MAIS CRESCEU')).toBeInTheDocument();
    expect(screen.getByText('CUSTO/MÊS')).toBeInTheDocument();
  });

  it('shows the empty today card when there are no events', () => {
    mockedUseQueries.mockReturnValue([
      makeQueryResult({ transacoes: [], receitaMensal: 0, despesaTotal: 0, saldo: 0, clientesAtivos: [], clientes: [] }),
      makeQueryResult([]),
      makeQueryResult([]),
      makeQueryResult([]),
      makeQueryResult([]),
      makeQueryResult({ accounts: [], summary: {} }),
      makeQueryResult([]),
    ] as never);
    mockedUseQuery.mockReturnValue(makeQueryResult([]));

    renderDashboardPage();

    expect(screen.getByText('Nenhum evento hoje.')).toBeInTheDocument();
    expect(screen.getByText('Nenhuma conta conectada')).toBeInTheDocument();
    expect(screen.getByText('Nenhum workflow ativo.')).toBeInTheDocument();
  });
});

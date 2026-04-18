import { Children, isValidElement, type ReactNode } from 'react';
import { act, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const analyticsTestState = vi.hoisted(() => ({
  queryFixtures: new Map<number, {
    data?: unknown;
    isLoading: boolean;
    error: Error | null;
    refetch: ReturnType<typeof vi.fn>;
  }>(),
  defaultQueryResult: {
    data: undefined,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  },
  chartRegister: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn((options: { queryKey?: [string, number] }) => {
    const days = options?.queryKey?.[1] ?? 28;
    return analyticsTestState.queryFixtures.get(days) ?? analyticsTestState.defaultQueryResult;
  }),
}));

vi.mock('chart.js', () => ({
  Chart: class MockChart {
    static register = analyticsTestState.chartRegister;
    destroy = vi.fn();

    constructor() {
      return this;
    }
  },
  registerables: [],
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    size,
    variant,
  }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    size?: string;
    variant?: string;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled} data-size={size} data-variant={variant}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children, variant }: { children: ReactNode; variant?: string }) => (
    <span data-variant={variant}>{children}</span>
  ),
}));

vi.mock('@/components/ui/spinner', () => ({
  Spinner: ({ size }: { size?: string }) => <div role="status" data-size={size}>Loading</div>,
}));

vi.mock('@/components/ui/table', () => ({
  Table: ({ children }: { children: ReactNode }) => <table>{children}</table>,
  TableBody: ({ children }: { children: ReactNode }) => <tbody>{children}</tbody>,
  TableCell: ({ children, ...props }: { children: ReactNode }) => <td {...props}>{children}</td>,
  TableHead: ({ children, ...props }: { children: ReactNode }) => <th scope="col" {...props}>{children}</th>,
  TableHeader: ({ children }: { children: ReactNode }) => <thead>{children}</thead>,
  TableRow: ({ children, ...props }: { children: ReactNode }) => <tr {...props}>{children}</tr>,
}));

vi.mock('@/components/ui/select', () => {
  function getNodeText(node: ReactNode): string {
    return Children.toArray(node)
      .map((child) => {
        if (typeof child === 'string' || typeof child === 'number') return String(child);
        if (isValidElement(child)) return getNodeText(child.props.children);
        return '';
      })
      .join('')
      .trim();
  }

  function SelectItem() {
    return null;
  }

  function SelectContent() {
    return null;
  }

  function SelectTrigger() {
    return null;
  }

  function SelectValue() {
    return null;
  }

  function collectItems(children: ReactNode): Array<{ value: string; label: string }> {
    const items: Array<{ value: string; label: string }> = [];

    Children.forEach(children, (child) => {
      if (!isValidElement(child)) return;

      if (child.type === SelectItem) {
        items.push({
          value: String(child.props.value),
          label: getNodeText(child.props.children),
        });
        return;
      }

      if (child.props?.children) {
        items.push(...collectItems(child.props.children));
      }
    });

    return items;
  }

  function Select({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    children: ReactNode;
  }) {
    const items = collectItems(children);

    return (
      <select aria-label="select" value={value} onChange={(event) => onValueChange(event.target.value)}>
        {items.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
    );
  }

  return {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
  };
});

vi.mock('../../../services/analytics', () => ({
  getPortfolioAIAnalysis: vi.fn(),
  getPortfolioSummary: vi.fn(),
}));

vi.mock('../../../services/instagram', () => ({
  syncInstagramData: vi.fn(),
}));

import { useQuery } from '@tanstack/react-query';
import { getPortfolioAIAnalysis } from '../../../services/analytics';
import { syncInstagramData } from '../../../services/instagram';
import AnalyticsPage from '../AnalyticsPage';
import type { PortfolioAccount, PortfolioSummary } from '../../../services/analytics';

const mockedUseQuery = vi.mocked(useQuery);
const mockedGetPortfolioAIAnalysis = vi.mocked(getPortfolioAIAnalysis);
const mockedSyncInstagramData = vi.mocked(syncInstagramData);

function makeAccount(overrides: Partial<PortfolioAccount> & Pick<PortfolioAccount, 'client_id' | 'client_name' | 'client_sigla' | 'client_cor' | 'client_especialidade' | 'instagram_account_id' | 'username' | 'profile_picture_url' | 'follower_count' | 'follower_delta' | 'reach_28d' | 'impressions_28d' | 'profile_views_28d' | 'website_clicks_28d' | 'media_count' | 'last_synced_at' | 'last_post_at' | 'posts_last_30d' | 'engagement_rate_avg'>): PortfolioAccount {
  return overrides;
}

function makeSummary(accounts: PortfolioAccount[]): PortfolioSummary {
  const bestByEngagement = accounts.reduce<PortfolioAccount | null>((best, account) => {
    if (!best || account.engagement_rate_avg > best.engagement_rate_avg) return account;
    return best;
  }, null);
  const mostImproved = accounts.reduce<PortfolioAccount | null>((best, account) => {
    if (!best || account.follower_delta > best.follower_delta) return account;
    return best;
  }, null);

  return {
    accounts,
    summary: {
      total: accounts.length,
      connected: accounts.length,
      growing: accounts.filter((account) => account.follower_delta > 0).length,
      stagnant: accounts.filter((account) => account.follower_delta === 0).length,
      declining: accounts.filter((account) => account.follower_delta < 0).length,
      bestByEngagement: bestByEngagement
        ? {
            client_name: bestByEngagement.client_name,
            engagement_rate_avg: bestByEngagement.engagement_rate_avg,
          }
        : null,
      mostImproved: mostImproved
        ? {
            client_name: mostImproved.client_name,
            follower_delta: mostImproved.follower_delta,
          }
        : null,
    },
  };
}

function makeQueryResult(data: PortfolioSummary, overrides: Partial<{ isLoading: boolean; error: Error | null }> = {}) {
  return {
    data,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  };
}

function setQueryFixture(days: number, data: PortfolioSummary, overrides: Partial<{ isLoading: boolean; error: Error | null }> = {}) {
  const result = makeQueryResult(data, overrides);
  analyticsTestState.queryFixtures.set(days, result);
  return result;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/analytics']}>
      <AnalyticsPage />
    </MemoryRouter>,
  );
}

function getKpiCard(label: string) {
  return screen.getByText(label).closest('.kpi-card') as HTMLElement;
}

function buildBaseAccounts() {
  return [
    makeAccount({
      client_id: 1,
      client_name: 'Alpha Studio',
      client_sigla: 'AS',
      client_cor: '#f97316',
      client_especialidade: 'Design',
      instagram_account_id: 101,
      username: 'alpha.studio',
      profile_picture_url: '',
      follower_count: 1000,
      follower_delta: 25,
      reach_28d: 5000,
      impressions_28d: 8200,
      profile_views_28d: 340,
      website_clicks_28d: 18,
      media_count: 44,
      last_synced_at: '2026-04-17T12:00:00.000Z',
      last_post_at: '2026-04-09T12:00:00.000Z',
      posts_last_30d: 3,
      engagement_rate_avg: 1.2,
    }),
    makeAccount({
      client_id: 2,
      client_name: 'Bravo Health',
      client_sigla: 'BH',
      client_cor: '#0f766e',
      client_especialidade: 'Saúde',
      instagram_account_id: 102,
      username: 'bravo.health',
      profile_picture_url: '',
      follower_count: 2500,
      follower_delta: 90,
      reach_28d: 12000,
      impressions_28d: 16800,
      profile_views_28d: 620,
      website_clicks_28d: 27,
      media_count: 63,
      last_synced_at: '2026-04-18T09:00:00.000Z',
      last_post_at: '2026-04-17T12:00:00.000Z',
      posts_last_30d: 8,
      engagement_rate_avg: 4.5,
    }),
    makeAccount({
      client_id: 3,
      client_name: 'Zeta Labs',
      client_sigla: 'ZL',
      client_cor: '#2563eb',
      client_especialidade: 'Tecnologia',
      instagram_account_id: 103,
      username: 'zeta.labs',
      profile_picture_url: '',
      follower_count: 1500,
      follower_delta: -10,
      reach_28d: 7000,
      impressions_28d: 9900,
      profile_views_28d: 410,
      website_clicks_28d: 21,
      media_count: 51,
      last_synced_at: '2026-04-14T12:00:00.000Z',
      last_post_at: '2026-04-13T12:00:00.000Z',
      posts_last_30d: 5,
      engagement_rate_avg: 2.1,
    }),
  ];
}

describe('AnalyticsPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    analyticsTestState.queryFixtures.clear();
    analyticsTestState.defaultQueryResult = makeQueryResult(undefined as never);
    analyticsTestState.chartRegister.mockClear();
    mockedUseQuery.mockClear();
    mockedGetPortfolioAIAnalysis.mockReset();
    mockedSyncInstagramData.mockReset();
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-04-18T12:00:00.000Z'));
  });

  it('shows a loading state while the portfolio summary is hydrating', () => {
    setQueryFixture(28, makeSummary([]), { isLoading: true });

    renderPage();

    expect(screen.getByRole('status')).toHaveTextContent('Loading');
  });

  it('shows a friendly error state when the portfolio summary fails', () => {
    setQueryFixture(28, makeSummary([]), { error: new Error('falha no backend') });

    renderPage();

    expect(screen.getByText('Erro ao carregar analytics: falha no backend')).toBeInTheDocument();
  });

  it('renders summary cards, the silent-account callout, and the default engagement sort', () => {
    const accounts = buildBaseAccounts();
    setQueryFixture(28, makeSummary(accounts));

    renderPage();

    expect(screen.getByText('CONTAS CONECTADAS')).toBeInTheDocument();
    expect(getKpiCard('CONTAS CONECTADAS')).toHaveTextContent('3 / 3');
    expect(screen.getByText('24.000')).toBeInTheDocument();
    expect(screen.getByText('2.60%')).toBeInTheDocument();
    expect(screen.getByText('Contas Silenciosas')).toBeInTheDocument();
    expect(screen.getByText('9d sem postar')).toBeInTheDocument();

    const rows = screen.getAllByRole('row');
    expect(within(rows[1]).getByText('Bravo Health')).toBeInTheDocument();
    expect(within(rows[1]).getByText('4.50%')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Zeta Labs')).toBeInTheDocument();
    expect(within(rows[3]).getByText('Alpha Studio')).toBeInTheDocument();
  });

  it('supports sorting, filtering, and day-range changes', async () => {
    const allAccounts = buildBaseAccounts();
    const sevenDayAccounts = [
      makeAccount({
        client_id: 2,
        client_name: 'Bravo Health',
        client_sigla: 'BH',
        client_cor: '#0f766e',
        client_especialidade: 'Saúde',
        instagram_account_id: 102,
        username: 'bravo.health',
        profile_picture_url: '',
        follower_count: 2550,
        follower_delta: 100,
        reach_28d: 13200,
        impressions_28d: 18200,
        profile_views_28d: 700,
        website_clicks_28d: 31,
        media_count: 66,
        last_synced_at: '2026-04-18T09:00:00.000Z',
        last_post_at: '2026-04-18T08:00:00.000Z',
        posts_last_30d: 2,
        engagement_rate_avg: 4.9,
      }),
    ];

    setQueryFixture(28, makeSummary(allAccounts));
    setQueryFixture(7, makeSummary(sevenDayAccounts));

    renderPage();

    const clientHeader = screen.getByRole('columnheader', { name: 'Cliente' });
    fireEvent.click(clientHeader);

    let rows = screen.getAllByRole('row');
    expect(within(rows[1]).getByText('Zeta Labs')).toBeInTheDocument();

    fireEvent.click(clientHeader);

    rows = screen.getAllByRole('row');
    expect(within(rows[1]).getByText('Alpha Studio')).toBeInTheDocument();

    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: '2' } });

    expect(getKpiCard('SEGUIDORES TOTAIS')).toHaveTextContent('2.500');
    expect(getKpiCard('ALCANCE TOTAL (28D)')).toHaveTextContent('12.000');
    expect(screen.getAllByRole('row')).toHaveLength(2);

    fireEvent.change(selects[1], { target: { value: '7' } });

    await waitFor(() => {
      expect(screen.getByText('Visão geral de todas as contas conectadas · últimos 7 dias.')).toBeInTheDocument();
    });
    expect(mockedUseQuery).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['portfolio-summary', 7] }));
    expect(getKpiCard('SEGUIDORES TOTAIS')).toHaveTextContent('2.550');
    expect(getKpiCard('CONTAS CONECTADAS')).toHaveTextContent('1 / 1');
  });

  it('syncs all accounts and shows the success summary', async () => {
    const accounts = buildBaseAccounts();
    const queryResult = setQueryFixture(28, makeSummary(accounts));
    const first = deferred<void>();
    const second = deferred<void>();
    const third = deferred<void>();

    mockedSyncInstagramData
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
      .mockImplementationOnce(() => third.promise);

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Sincronizar Tudo' }));
    expect(screen.getByRole('button', { name: 'Sincronizando...' })).toBeDisabled();

    await act(async () => {
      first.resolve();
      second.resolve();
      third.reject(new Error('sync failed'));
    });

    await waitFor(() => {
      expect(screen.getByText('2 sincronizadas, 1 falhou')).toBeInTheDocument();
    });

    expect(mockedSyncInstagramData).toHaveBeenCalledWith(1);
    expect(mockedSyncInstagramData).toHaveBeenCalledWith(2);
    expect(mockedSyncInstagramData).toHaveBeenCalledWith(3);
    expect(queryResult.refetch).toHaveBeenCalledTimes(1);
  });

  it('renders the AI analysis result when generation succeeds', async () => {
    setQueryFixture(28, makeSummary([buildBaseAccounts()[0]]));

    mockedGetPortfolioAIAnalysis.mockResolvedValue({
      generatedAt: '2026-04-18T15:30:00.000Z',
      analysis: {
        portfolioHealth: {
          score: 82,
          summary: 'Portfólio saudável e com boa consistência.',
        },
        accountRanking: [
          {
            username: 'bravo.health',
            status: 'destaque',
            keyMetric: '4.9% de engajamento',
          },
        ],
        crossAccountInsights: 'Foque em consistência semanal • Aproveite o bom desempenho dos reels',
        resourceAllocation: 'Priorize 70% da rotina em conteúdos de alto alcance',
        monthlyDigest: 'Mês fechado com crescimento contínuo.',
        priorityActions: [
          {
            prioridade: 'alta',
            conta: 'Bravo Health',
            acao: 'Dobrar a frequência de reels',
            impacto: 'Aumenta alcance e descoberta orgânica.',
          },
        ],
      },
    });

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Gerar Análise IA' }));

    await waitFor(() => {
      expect(screen.getByText('Saúde do Portfólio')).toBeInTheDocument();
    });

    expect(screen.getByText('82')).toBeInTheDocument();
    expect(screen.getByText('Portfólio saudável e com boa consistência.')).toBeInTheDocument();
    expect(screen.getByText('bravo.health')).toBeInTheDocument();
    expect(screen.getByText('Foque em consistência semanal')).toBeInTheDocument();
    expect(screen.getByText('Aproveite o bom desempenho dos reels')).toBeInTheDocument();
    expect(screen.getByText('Priorize 70% da rotina em conteúdos de alto alcance')).toBeInTheDocument();
    expect(screen.getByText('Dobrar a frequência de reels')).toBeInTheDocument();
    expect(screen.getByText((_content, element) => element?.textContent?.startsWith('Gerado em') ?? false)).toBeInTheDocument();
  });

  it('shows a friendly AI error when the service returns an error payload', async () => {
    setQueryFixture(28, makeSummary([buildBaseAccounts()[0]]));

    mockedGetPortfolioAIAnalysis.mockResolvedValue({
      generatedAt: '2026-04-18T15:30:00.000Z',
      analysis: {
        error: 'Sem contexto suficiente para gerar a análise.',
      },
    });

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Gerar Análise IA' }));

    await waitFor(() => {
      expect(screen.getByText('Não foi possível gerar a análise. Tente novamente.')).toBeInTheDocument();
    });
  });

  it('shows a friendly AI error when generation throws', async () => {
    setQueryFixture(28, makeSummary([buildBaseAccounts()[0]]));

    mockedGetPortfolioAIAnalysis.mockRejectedValue(new Error('timeout'));

    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Gerar Análise IA' }));

    await waitFor(() => {
      expect(screen.getByText('Erro ao gerar análise. Tente novamente.')).toBeInTheDocument();
    });
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

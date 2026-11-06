import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  PortfolioAccount,
  PortfolioSummary,
  PortfolioTopPost,
} from '../../../services/analytics';

// jsdom's matchMedia matches nothing, so the page renders its phone branch (below 768px).

const state = vi.hoisted(() => ({
  byDays: new Map<number, unknown>(),
  refetch: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn((options: { queryKey?: [string, number] }) => ({
    data: state.byDays.get(options?.queryKey?.[1] ?? 28),
    isLoading: false,
    error: null,
    refetch: state.refetch,
  })),
}));

vi.mock('chart.js', () => ({
  Chart: class {
    static register = vi.fn();
    destroy = vi.fn();
  },
  registerables: [],
}));

// The shell's bell and help links need the KB and notification queries; their suites cover them.
vi.mock('@/components/layout/PhoneShellHeader', () => ({
  PhoneShellActions: () => <div data-testid="shell-actions" />,
}));

vi.mock('../../../services/analytics', () => ({
  getPortfolioAIAnalysis: vi.fn(),
  getPortfolioSummary: vi.fn(),
}));
vi.mock('../../../services/instagram', () => ({ syncInstagramData: vi.fn() }));

import { useQuery } from '@tanstack/react-query';
import { getPortfolioAIAnalysis } from '../../../services/analytics';
import { syncInstagramData } from '../../../services/instagram';
import AnalyticsPage from '../AnalyticsPage';

const DAY = 86400000;

function account(
  id: number,
  name: string,
  extra: Partial<PortfolioAccount> = {},
): PortfolioAccount {
  return {
    client_id: id,
    client_name: name,
    client_sigla: name.slice(0, 2).toUpperCase(),
    client_cor: '#2563eb',
    client_especialidade: 'Saúde',
    instagram_account_id: 100 + id,
    username: name.toLowerCase().replace(/\s/g, ''),
    profile_picture_url: '',
    follower_count: 1000 * id,
    follower_delta: 10 * id,
    reach_28d: 500 * id,
    impressions_28d: 800 * id,
    profile_views_28d: 0,
    website_clicks_28d: id,
    media_count: 10,
    last_synced_at: new Date().toISOString(),
    last_post_at: new Date(Date.now() - 2 * DAY).toISOString(),
    posts_last_30d: id,
    engagement_rate_avg: id,
    ...extra,
  };
}

function post(id: number, client: string, views: number, extra: Partial<PortfolioTopPost> = {}) {
  return {
    id,
    thumbnail_url: null,
    media_type: 'IMAGE',
    permalink: `https://instagram.com/p/${id}`,
    posted_at: new Date(Date.now() - (5 + id) * DAY).toISOString(),
    likes: 1,
    comments: 2,
    reach: 10,
    saved: 3,
    shares: 0,
    views,
    rates: { share_rate: null, like_rate: null, save_rate: null, comment_rate: null },
    unavailable_metrics: [],
    engagement_rate: 2,
    client_name: client,
    client_id: 1,
    ...extra,
  } as PortfolioTopPost;
}

const accounts = [
  account(1, 'Alpha Studio'),
  account(2, 'Bravo Health'),
  account(3, 'Zeta Labs', { last_post_at: new Date(Date.now() - 12 * DAY).toISOString() }),
];
const posts = [
  post(1, 'Alpha Studio', 900, { media_type: 'VIDEO' }),
  post(2, 'Bravo Health', 800),
  post(3, 'Zeta Labs', 700),
  post(4, 'Alpha Studio', 600, { media_type: 'VIDEO' }),
  post(5, 'Bravo Health', 500),
  post(6, 'Zeta Labs', 400),
  post(7, 'Alpha Studio', 300),
];

function summary(list = accounts): PortfolioSummary {
  return {
    accounts: list,
    topPosts: posts.slice(0, 5),
    worstPosts: [],
    allRankedPosts: posts,
    summary: {
      total: list.length,
      connected: list.length,
      growing: list.length,
      stagnant: 0,
      declining: 0,
      bestByEngagement: { client_name: 'Zeta Labs', engagement_rate_avg: 3 },
      mostImproved: { client_name: 'Zeta Labs', follower_delta: 30 },
    },
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/analytics']}>
      <AnalyticsPage />
    </MemoryRouter>,
  );
}

describe('AnalyticsPage (phone)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.byDays.clear();
    state.byDays.set(28, summary());
    state.byDays.set(90, summary([accounts[0]]));
  });

  it('renders the phone page header instead of the desktop header', () => {
    const { container } = renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Analytics' })).toHaveClass(
      'phone-large-title__title',
    );
    expect(screen.getByText(/3 contas · 28 dias/)).toBeInTheDocument();
    expect(container.querySelector('.header')).toBeNull();
    expect(container.querySelector('.phone-stat-grid--scroll')).not.toBeNull();
  });

  it('shows the explanations that are tooltips on desktop as visible footers', () => {
    renderPage();
    expect(
      screen.getByText('Top 5 posts com mais visualizações no período selecionado.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Posts com pelo menos 48h desde a publicação e menos visualizações no período.',
      ),
    ).toBeInTheDocument();
  });

  it('syncs every account and names the failed ones under the title', async () => {
    vi.mocked(syncInstagramData).mockImplementation(async (id: number) => {
      if (id === 2) throw new Error('boom');
      return {} as never;
    });
    renderPage();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sincronizar todas as contas' }));
    });
    expect(syncInstagramData).toHaveBeenCalledTimes(3);
    expect(await screen.findByText('2 sincronizadas, 1 falhou: Bravo Health')).toBeInTheDocument();
    expect(state.refetch).toHaveBeenCalled();
  });

  it('lists the silent accounts with how long they have been quiet', () => {
    renderPage();
    const callout = screen.getByRole('status', { name: 'Contas silenciosas' });
    expect(within(callout).getByText('1 conta sem postar no período')).toBeInTheDocument();
    expect(within(callout).getByRole('link', { name: /Zeta Labs/ })).toHaveAttribute(
      'href',
      '/analytics/3',
    );
  });

  it('filters by client and changes the period through picker sheets', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Cliente: Todos' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Bravo Health' }));
    const list = screen.getByRole('list', { name: 'Todas as contas' });
    await waitFor(() => expect(within(list).getAllByRole('link')).toHaveLength(1));
    expect(within(list).getByRole('link', { name: /Bravo Health/ })).toHaveAttribute(
      'href',
      '/analytics/2',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Período: 28 dias' }));
    fireEvent.click(await screen.findByRole('button', { name: '90 dias' }));
    await waitFor(() =>
      expect(vi.mocked(useQuery)).toHaveBeenLastCalledWith(
        expect.objectContaining({ queryKey: ['portfolio-summary', 90] }),
      ),
    );
  });

  it('sorts the account list from an action sheet and shows the sorted metric', async () => {
    renderPage();
    const list = () => screen.getByRole('list', { name: 'Todas as contas' });
    // Default: engagement, highest first.
    expect(within(list()).getAllByRole('link')[0]).toHaveTextContent('Zeta Labs');

    fireEvent.click(screen.getByRole('button', { name: /Ordenar contas: Engajamento/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Nome' }));
    await waitFor(() =>
      expect(within(list()).getAllByRole('link')[0]).toHaveTextContent('Zeta Labs'),
    );
    fireEvent.click(screen.getByRole('button', { name: /Ordenar contas: Nome/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ordem crescente' }));
    await waitFor(() =>
      expect(within(list()).getAllByRole('link')[0]).toHaveTextContent('Alpha Studio'),
    );
  });

  it('opens "Todos os posts" with a filters sub-sheet that narrows the list', async () => {
    renderPage();
    fireEvent.click(screen.getAllByRole('button', { name: 'Ver mais' })[0]);
    const sheet = await screen.findByRole('dialog', { name: 'Todos os posts' });
    expect(within(sheet).getAllByRole('link')).toHaveLength(7);

    fireEvent.click(within(sheet).getByRole('button', { name: 'Filtros' }));
    const filters = await screen.findByRole('dialog', { name: 'Filtros' });
    fireEvent.click(within(filters).getByRole('button', { name: /Formato/ }));
    fireEvent.click(within(filters).getByRole('button', { name: 'Reels' }));
    // The posts sheet sits behind the filters sheet (aria-hidden while it is open).
    await waitFor(() =>
      expect(within(sheet).getAllByRole('link', { hidden: true })).toHaveLength(2),
    );
    expect(within(filters).getByRole('button', { name: 'Ver 2' })).toBeInTheDocument();
  });

  it('generates the portfolio AI analysis', async () => {
    vi.mocked(getPortfolioAIAnalysis).mockResolvedValue({
      analysis: {
        portfolioHealth: { score: 82, summary: 'Portfólio saudável' },
        accountRanking: [{ status: 'destaque', username: 'zeta', keyMetric: '3% eng.' }],
        crossAccountInsights: 'Reels engajam mais',
        monthlyDigest: 'Mês estável',
        priorityActions: [
          { prioridade: 'alta', conta: 'alpha', acao: 'Postar mais', impacto: '+20%' },
        ],
      },
      generatedAt: '2026-10-01T12:00:00.000Z',
    } as never);
    renderPage();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Gerar Análise IA' }));
    });
    expect(await screen.findByText('82')).toBeInTheDocument();
    expect(screen.getByText('Portfólio saudável')).toBeInTheDocument();
    expect(screen.getByText('alpha: Postar mais')).toBeInTheDocument();
  });
});

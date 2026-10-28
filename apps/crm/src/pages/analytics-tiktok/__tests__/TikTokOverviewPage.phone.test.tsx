import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { portfolio, registerTikTokI18n, row } from './fixtures';

// jsdom's matchMedia matches nothing, so the page renders its phone branch (below 768px).

vi.mock('../../../hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({ features: { feature_tiktok: true }, isLoading: false }),
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
vi.mock('../../../services/tiktokAnalytics', () => ({
  getTikTokPortfolio: vi.fn(),
  getTikTokPortfolioAI: vi.fn(),
}));
vi.mock('../../../services/tiktok', () => ({ syncTikTokData: vi.fn() }));

import { getTikTokPortfolio, getTikTokPortfolioAI } from '../../../services/tiktokAnalytics';
import { syncTikTokData } from '../../../services/tiktok';
import TikTokOverviewPage from '../TikTokOverviewPage';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/analytics/tiktok']}>
        <TikTokOverviewPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TikTokOverviewPage (phone)', () => {
  beforeAll(registerTikTokI18n);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getTikTokPortfolio).mockResolvedValue(portfolio());
  });

  it('phone variant below 768px', async () => {
    const { container } = renderPage();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Analytics do TikTok' }),
    ).toHaveClass('phone-large-title__title');
    expect(screen.getByText(/3 contas · 28 dias/)).toBeInTheDocument();
    expect(container.querySelector('.header')).toBeNull();
    expect(container.querySelector('.phone-stat-grid--scroll')).not.toBeNull();
    // The accounts are a grouped list whose rows go to the account's TikTok page.
    const list = screen.getByRole('list', { name: 'Todas as contas' });
    expect(within(list).getByRole('link', { name: /Alpha Studio/ })).toHaveAttribute(
      'href',
      '/analytics/1/tiktok',
    );
  });

  it('shows the explanations that are tooltips on desktop as visible footers', async () => {
    renderPage();
    expect(
      await screen.findByText('Os 5 vídeos com mais visualizações no período selecionado.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Vídeos com mais de 48 horas e poucas visualizações'),
    ).toBeInTheDocument();
  });

  it('lists the silent accounts with how long they have been quiet', async () => {
    renderPage();
    const callout = await screen.findByRole('status', {
      name: 'Contas sem vídeo há mais de 7 dias',
    });
    expect(within(callout).getByText('1 conta silenciosa')).toBeInTheDocument();
    expect(within(callout).getByRole('link', { name: /Zeta Labs/ })).toHaveAttribute(
      'href',
      '/analytics/3/tiktok',
    );
    expect(within(callout).getByText('60d sem postar')).toBeInTheDocument();
  });

  it('changes the period through a picker sheet and refetches', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Período: 28 dias' }));
    fireEvent.click(await screen.findByRole('button', { name: '7 dias' }));
    await waitFor(() => expect(getTikTokPortfolio).toHaveBeenLastCalledWith(7));
  });

  it('opens the all-videos sheet; its filters have no format option', async () => {
    renderPage();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Ver todos' }))[0]);
    const sheet = await screen.findByRole('dialog', { name: 'Todos os vídeos' });
    expect(within(sheet).getAllByRole('link')).toHaveLength(18);

    fireEvent.click(within(sheet).getByRole('button', { name: 'Filtros' }));
    const filters = await screen.findByRole('dialog', { name: 'Filtros' });
    expect(within(filters).queryByRole('button', { name: /Formato/ })).toBeNull();
    fireEvent.click(within(filters).getByRole('button', { name: /Cliente/ }));
    fireEvent.click(within(filters).getByRole('button', { name: 'Zeta Labs' }));
    // The videos sheet sits behind the filters sheet (aria-hidden while it is open).
    await waitFor(() =>
      expect(within(sheet).getAllByRole('link', { hidden: true })).toHaveLength(1),
    );
  });

  it('syncs the active accounts and names the failed ones under the title', async () => {
    vi.mocked(getTikTokPortfolio).mockResolvedValue(
      portfolio([row(1, 'Alpha Studio'), row(2, 'Bravo Health')]),
    );
    vi.mocked(syncTikTokData).mockImplementation(async (id: number) => {
      if (id === 2) throw new Error('boom');
      return {} as never;
    });
    renderPage();
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Sincronizar todas as contas' }));
    });
    expect(syncTikTokData).toHaveBeenCalledTimes(2);
    expect(await screen.findByText('1 sincronizada, 1 falhou: Bravo Health')).toBeInTheDocument();
  });

  it('shows the connect hint when no client has TikTok', async () => {
    vi.mocked(getTikTokPortfolio).mockResolvedValue(portfolio([]));
    renderPage();
    expect(await screen.findByText('Nenhum cliente com TikTok conectado')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir para clientes' })).toHaveAttribute(
      'href',
      '/clientes',
    );
  });

  it('generates the portfolio AI analysis', async () => {
    vi.mocked(getTikTokPortfolioAI).mockResolvedValue({
      analysis: {
        portfolioHealth: { score: 82, summary: 'Contas saudáveis' },
        crossAccountInsights: 'Vídeos curtos engajam mais',
        monthlyDigest: 'Mês estável',
      },
      generatedAt: '2026-10-01T12:00:00.000Z',
    });
    renderPage();
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Gerar Análise IA' }));
    });
    expect(await screen.findByText('82')).toBeInTheDocument();
    expect(screen.getByText('Contas saudáveis')).toBeInTheDocument();
    expect(getTikTokPortfolioAI).toHaveBeenCalledWith(28);
  });
});

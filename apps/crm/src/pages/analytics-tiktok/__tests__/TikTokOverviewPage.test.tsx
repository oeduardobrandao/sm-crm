import { Children, isValidElement, type ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { portfolio, registerTikTokI18n, row } from './fixtures';

const limits = vi.hoisted(() => ({
  value: {
    features: { feature_tiktok: true } as Record<string, boolean> | null,
    isLoading: false,
  },
}));

vi.mock('../../../hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => limits.value,
}));

// The route guard renders the shared paywall; its own suite covers it.
vi.mock('@/components/paywall/UpgradeLockedScreen', () => ({
  UpgradeLockedScreen: ({ featureLabel, feature }: { featureLabel: string; feature?: string }) => (
    <div data-testid="locked" data-feature={feature}>
      {featureLabel}
    </div>
  ),
}));

// These cases cover the desktop layout; TikTokOverviewPage.phone.test.tsx covers the phone one.
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));

vi.mock('chart.js', () => ({
  Chart: class {
    static register = vi.fn();
    destroy = vi.fn();
  },
  registerables: [],
}));

// A native <select> stands in for Radix: the trigger's aria-label names it.
vi.mock('@/components/ui/select', () => {
  const textOf = (node: ReactNode): string =>
    Children.toArray(node)
      .map((c) =>
        typeof c === 'string' || typeof c === 'number'
          ? String(c)
          : isValidElement(c)
            ? textOf((c.props as { children?: ReactNode }).children)
            : '',
      )
      .join('')
      .trim();
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
  function collect(children: ReactNode, out: { label?: string; items: [string, string][] }) {
    Children.forEach(children, (child) => {
      if (!isValidElement(child)) return;
      const props = child.props as Record<string, unknown>;
      if (child.type === SelectItem) {
        out.items.push([String(props.value), textOf(props.children as ReactNode)]);
      } else if (child.type === SelectTrigger) {
        out.label = props['aria-label'] as string | undefined;
      } else if (props.children) {
        collect(props.children as ReactNode, out);
      }
    });
    return out;
  }
  function Select({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    children: ReactNode;
  }) {
    const { label, items } = collect(children, { items: [] });
    return (
      <select aria-label={label} value={value} onChange={(e) => onValueChange(e.target.value)}>
        {items.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    );
  }
  return { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
});

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

const kpi = (label: string) =>
  screen.getByText(label).closest('.kpi-card, .phone-stat-tile') as HTMLElement;

describe('TikTokOverviewPage', () => {
  beforeAll(registerTikTokI18n);

  beforeEach(() => {
    vi.clearAllMocks();
    limits.value = { features: { feature_tiktok: true }, isLoading: false };
    vi.mocked(getTikTokPortfolio).mockResolvedValue(portfolio());
  });

  it('renders totals and account rows', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Analytics do TikTok' });

    expect(within(kpi('Contas conectadas')).getByText('3')).toBeInTheDocument();
    expect(within(kpi('Seguidores totais')).getByText('23.000')).toBeInTheDocument();
    expect(
      within(kpi('Visualizações (vídeos do período)')).getByText('70.000'),
    ).toBeInTheDocument();
    expect(
      within(kpi('Engajamento médio por visualização')).getByText('3,80%'),
    ).toBeInTheDocument();
    expect(within(kpi('Vídeos publicados')).getByText('9')).toBeInTheDocument();

    const table = screen.getByRole('table');
    expect(within(table).getByText('Alpha Studio')).toBeInTheDocument();
    expect(within(table).getByText('@alphastudio')).toBeInTheDocument();
    expect(within(table).getByText('12.000')).toBeInTheDocument();
    // No views yet: the rate and the views read "—", never 0%.
    const zeta = within(table).getByText('Zeta Labs').closest('tr') as HTMLElement;
    expect(within(zeta).getAllByText('—')).toHaveLength(2);
    expect(within(zeta).queryByText('0,00%')).toBeNull();
    expect(getTikTokPortfolio).toHaveBeenCalledWith(28);
  });

  it('row links to /analytics/:id/tiktok', async () => {
    renderPage();
    await screen.findByRole('table');
    const table = screen.getByRole('table');
    expect(within(table).getByRole('link', { name: 'Alpha Studio' })).toHaveAttribute(
      'href',
      '/analytics/1/tiktok',
    );
    // The card variant (shown below the table breakpoint) links the same way.
    const cards = screen
      .getAllByRole('link', { name: /Bravo Health/ })
      .map((a) => a.getAttribute('href'));
    expect(cards).toContain('/analytics/2/tiktok');
  });

  it('empty state when no accounts', async () => {
    vi.mocked(getTikTokPortfolio).mockResolvedValue(portfolio([]));
    renderPage();
    expect(await screen.findByText('Nenhum cliente com TikTok conectado')).toBeInTheDocument();
    expect(screen.getByText(/aba Redes sociais/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir para clientes' })).toHaveAttribute(
      'href',
      '/clientes',
    );
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Gerar Análise IA' })).toBeNull();
  });

  it('period change refetches with days=7', async () => {
    renderPage();
    await screen.findByRole('table');
    fireEvent.change(screen.getByRole('combobox', { name: 'Período' }), {
      target: { value: '7' },
    });
    await waitFor(() => expect(getTikTokPortfolio).toHaveBeenLastCalledWith(7));
  });

  it('silent accounts listed', async () => {
    renderPage();
    await screen.findByRole('table');
    const callout = screen.getByRole('status');
    expect(within(callout).getByText('Contas sem vídeo há mais de 7 dias')).toBeInTheDocument();
    expect(within(callout).getByText('1 conta silenciosa')).toBeInTheDocument();
    const chip = within(callout).getByRole('link', { name: /Zeta Labs/ });
    expect(chip).toHaveAttribute('href', '/analytics/3/tiktok');
    expect(within(callout).getByText('12d sem postar')).toBeInTheDocument();
    // Bravo posted 5 days ago and Alpha 2: neither is silent.
    expect(within(callout).queryByText(/Bravo/)).toBeNull();
  });

  it('filters the page down to one client', async () => {
    renderPage();
    await screen.findByRole('table');
    fireEvent.change(screen.getByRole('combobox', { name: 'Cliente' }), {
      target: { value: '2' },
    });
    const table = screen.getByRole('table');
    expect(within(table).queryByText('Alpha Studio')).toBeNull();
    expect(within(table).getByText('Bravo Health')).toBeInTheDocument();
    // Totals follow the filter: only Bravo's numbers.
    expect(within(kpi('Seguidores totais')).getByText('8.000')).toBeInTheDocument();
    expect(
      within(kpi('Visualizações (vídeos do período)')).getByText('20.000'),
    ).toBeInTheDocument();
    expect(
      within(kpi('Engajamento médio por visualização')).getByText('1,50%'),
    ).toBeInTheDocument();
  });

  it('sorts the table by a column header', async () => {
    renderPage();
    const table = await screen.findByRole('table');
    const firstName = () =>
      within(within(table).getAllByRole('row')[1]).getAllByRole('link')[0].textContent;
    // Default: engagement, highest first.
    expect(firstName()).toBe('Alpha Studio');
    fireEvent.click(within(table).getByText('Seguidores'));
    expect(firstName()).toBe('Alpha Studio');
    fireEvent.click(within(table).getByText('Seguidores'));
    expect(firstName()).toBe('Zeta Labs');
  });

  it('ranks the best and worst videos and opens the all-videos sheet', async () => {
    renderPage();
    const best = (await screen.findByRole('heading', { name: /Melhores vídeos/ })).closest(
      '.card',
    ) as HTMLElement;
    // Top 5 by views.
    expect(within(best).getAllByRole('link')).toHaveLength(5);
    expect(within(best).getAllByRole('link')[0]).toHaveAttribute(
      'href',
      'https://www.tiktok.com/@x/video/t1',
    );

    const worst = screen
      .getByRole('heading', { name: /Precisam de atenção/ })
      .closest('.card') as HTMLElement;
    // The 48h-old video (b5) is left out, so the fewest views is b1.
    expect(within(worst).getAllByRole('link')[0]).toHaveAttribute(
      'href',
      'https://www.tiktok.com/@x/video/b1',
    );
    expect(within(worst).queryByRole('link', { name: /Video b5/ })).toBeNull();

    fireEvent.click(within(best).getByRole('button', { name: /Ver todos/ }));
    const sheet = await screen.findByRole('heading', { name: 'Todos os vídeos' });
    const panel = sheet.closest('[role="dialog"]') as HTMLElement;
    // 5 top + b1..b4 + b5 (young, but "best" ranks every video) = 10 unique.
    expect(within(panel).getByText('10 de 10 vídeos')).toBeInTheDocument();
    // There is no format filter: no video/photo type is stored.
    expect(within(panel).queryByRole('combobox', { name: 'Formato' })).toBeNull();

    fireEvent.change(within(panel).getByRole('combobox', { name: 'Cliente' }), {
      target: { value: '3' },
    });
    expect(within(panel).getByText('1 de 10 vídeos')).toBeInTheDocument();
  });

  it('shows the paywall without feature_tiktok and never fetches', () => {
    limits.value = { features: { feature_tiktok: false }, isLoading: false };
    renderPage();
    const locked = screen.getByTestId('locked');
    expect(locked).toHaveTextContent('Analytics do TikTok');
    expect(locked).toHaveAttribute('data-feature', 'feature_tiktok');
    expect(getTikTokPortfolio).not.toHaveBeenCalled();
  });

  it('syncs every active account and names the failed ones', async () => {
    vi.mocked(getTikTokPortfolio).mockResolvedValue(
      portfolio([
        row(1, 'Alpha Studio'),
        row(2, 'Bravo Health'),
        row(3, 'Zeta Labs', { authorization_status: 'expired' }),
      ]),
    );
    vi.mocked(syncTikTokData).mockImplementation(async (id: number) => {
      if (id === 2) throw new Error('boom');
      return {} as never;
    });
    renderPage();
    await screen.findByRole('table');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sincronizar' }));
    });
    // The expired account cannot sync, so it is not tried.
    expect(syncTikTokData).toHaveBeenCalledTimes(2);
    expect(await screen.findByText('1 sincronizada, 1 falhou: Bravo Health')).toBeInTheDocument();
    await waitFor(() => expect(getTikTokPortfolio).toHaveBeenCalledTimes(2));
  });

  it('generates the portfolio AI analysis from the TikTok loader', async () => {
    vi.mocked(getTikTokPortfolioAI).mockResolvedValue({
      analysis: {
        portfolioHealth: { score: 77, summary: 'Contas saudáveis' },
        crossAccountInsights: 'Vídeos curtos engajam mais',
        monthlyDigest: 'Mês estável',
      },
      generatedAt: '2026-10-01T12:00:00.000Z',
    });
    renderPage();
    await screen.findByRole('table');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Gerar Análise IA/ }));
    });
    expect(await screen.findByText('Contas saudáveis')).toBeInTheDocument();
    expect(getTikTokPortfolioAI).toHaveBeenCalledWith(28);
  });
});

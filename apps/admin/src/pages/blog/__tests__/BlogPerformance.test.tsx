import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('react-chartjs-2', () => ({
  Bar: ({
    data,
  }: {
    data: { labels: string[]; datasets: { label: string; data: number[] }[] };
  }) => (
    <div
      data-testid="bar-chart"
      data-labels={JSON.stringify(data.labels)}
      data-values={JSON.stringify(data.datasets.map((d) => d.data))}
    />
  ),
  Line: ({ data }: { data: { datasets: { label: string }[] } }) => (
    <div
      data-testid="line-chart"
      data-datasets={JSON.stringify(data.datasets.map((d) => d.label))}
    />
  ),
}));

const getBlogPostMetrics = vi.fn();
vi.mock('../../../lib/api', () => ({
  getBlogPostMetrics: (...a: unknown[]) => getBlogPostMetrics(...a),
}));

import { BlogPerformance } from '../BlogPerformance';
import type { PostMetrics } from '../blog-view';

const metrics: PostMetrics = {
  views_7d: 12,
  views_30d: 1240,
  views_total: 20500,
  search: null,
  index: null,
};

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  getBlogPostMetrics.mockReset();
  getBlogPostMetrics.mockResolvedValue({
    views: [
      { day: '2026-10-26', views: 3 },
      { day: '2026-10-27', views: 9 },
    ],
    search: [],
  });
});

describe('BlogPerformance', () => {
  it('shows the three view tiles with Brazilian formatting and the not-configured line', async () => {
    wrap(<BlogPerformance slug="post" metrics={metrics} gscUpdatedAt={null} />);
    expect(screen.getByText('Views 7 dias')).toBeInTheDocument();
    expect(screen.getByText('Views 30 dias')).toBeInTheDocument();
    expect(screen.getByText('Views total')).toBeInTheDocument();
    expect(screen.getByText('1.240')).toBeInTheDocument();
    expect(screen.getByText('20.500')).toBeInTheDocument();
    expect(screen.getByText('Search Console não configurado.')).toBeInTheDocument();
    expect(await screen.findByTestId('bar-chart')).toBeInTheDocument();
    expect(screen.getByText('Views por dia')).toBeInTheDocument();
    expect(getBlogPostMetrics).toHaveBeenCalledWith('post', 90);
  });

  it('shows zeros for a post with no metrics yet', () => {
    wrap(<BlogPerformance slug="post" metrics={undefined} gscUpdatedAt={null} />);
    expect(screen.getAllByText('0')).toHaveLength(3);
  });

  it('says so when the daily series fails to load, keeping the tiles', async () => {
    getBlogPostMetrics.mockRejectedValue(new Error('boom'));
    wrap(<BlogPerformance slug="post" metrics={metrics} gscUpdatedAt={null} />);
    expect(await screen.findByText('Não foi possível carregar o gráfico.')).toBeInTheDocument();
    expect(screen.getByText('Views total')).toBeInTheDocument();
  });

  describe('with Search Console', () => {
    const GSC_AT = '2026-10-27T18:04:00Z';
    const gscMetrics: PostMetrics = {
      ...metrics,
      search: { clicks: 38, impressions: 1250, ctr: 0.0304, position: 12.4 },
      index: {
        verdict: 'PASS',
        coverage_state: 'Submitted and indexed',
        last_crawl_time: '2026-10-25T10:00:00Z',
        inspection_link: 'https://search.google.com/search-console/inspect?resource_id=x',
        checked_at: '2026-10-27T03:00:00Z',
      },
    };

    beforeEach(() => {
      getBlogPostMetrics.mockResolvedValue({
        views: [{ day: '2026-10-27', views: 9 }],
        search: [
          { day: '2026-10-24', clicks: 1, impressions: 10 },
          { day: '2026-10-25', clicks: 2, impressions: 30 },
        ],
      });
    });

    it('shows the four Search Console tiles', () => {
      wrap(<BlogPerformance slug="post" metrics={gscMetrics} gscUpdatedAt={GSC_AT} />);
      expect(screen.getByText('Cliques 28 dias')).toBeInTheDocument();
      expect(screen.getByText('Impressões 28 dias')).toBeInTheDocument();
      expect(screen.getByText('CTR')).toBeInTheDocument();
      expect(screen.getByText('Posição média')).toBeInTheDocument();
      expect(screen.getByText('38')).toBeInTheDocument();
      expect(screen.getByText('1.250')).toBeInTheDocument();
      expect(screen.getByText('3,0%')).toBeInTheDocument();
      expect(screen.getByText('12,4')).toBeInTheDocument();
      expect(screen.queryByText('Search Console não configurado.')).not.toBeInTheDocument();
    });

    it('draws clicks and impressions in their own chart, apart from the views chart', async () => {
      wrap(<BlogPerformance slug="post" metrics={gscMetrics} gscUpdatedAt={GSC_AT} />);
      expect(
        screen.getByText('Cliques e impressões por dia (datas do Google)'),
      ).toBeInTheDocument();
      const line = await screen.findByTestId('line-chart');
      expect(line.getAttribute('data-datasets')).toBe(JSON.stringify(['Cliques', 'Impressões']));
      expect(screen.getByTestId('bar-chart').getAttribute('data-labels')).toBe(
        JSON.stringify(['27/10']),
      );
    });

    it('shows the index card with label, last crawl, a new-tab link and the hint', () => {
      wrap(<BlogPerformance slug="post" metrics={gscMetrics} gscUpdatedAt={GSC_AT} />);
      expect(screen.getByText('Indexada')).toBeInTheDocument();
      expect(screen.getByText('Último rastreio: 25/10/2026')).toBeInTheDocument();
      const link = screen.getByRole('link', { name: /Ver no Search Console/ });
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      expect(link).toHaveAttribute(
        'href',
        'https://search.google.com/search-console/inspect?resource_id=x',
      );
      expect(
        screen.getByText(
          'Para pedir indexação, clique em Solicitar indexação na página do Google.',
        ),
      ).toBeInTheDocument();
    });

    it('says "Ainda não verificado pelo Google" and has no link before the first inspection', () => {
      const unchecked = {
        ...gscMetrics,
        index: { ...gscMetrics.index!, inspection_link: null, coverage_state: null, verdict: null },
      };
      wrap(<BlogPerformance slug="post" metrics={unchecked} gscUpdatedAt={GSC_AT} />);
      expect(screen.getByText('Ainda não verificado pelo Google')).toBeInTheDocument();
      expect(screen.getByText('Ainda não verificada')).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /Ver no Search Console/ })).not.toBeInTheDocument();
    });

    it('with a checked row but no link, shows neither the link nor "Ainda não verificado"', () => {
      const noLink = { ...gscMetrics, index: { ...gscMetrics.index!, inspection_link: null } };
      wrap(<BlogPerformance slug="post" metrics={noLink} gscUpdatedAt={GSC_AT} />);
      expect(screen.getByText('Indexada')).toBeInTheDocument();
      expect(screen.queryByText('Ainda não verificado pelo Google')).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /Ver no Search Console/ })).not.toBeInTheDocument();
      expect(
        screen.queryByText(
          'Para pedir indexação, clique em Solicitar indexação na página do Google.',
        ),
      ).not.toBeInTheDocument();
    });

    it('shows the footer with the sync time in São Paulo', () => {
      wrap(<BlogPerformance slug="post" metrics={gscMetrics} gscUpdatedAt={GSC_AT} />);
      expect(
        screen.getByText(
          'Search Console atualizado em 27/10/2026 15:04. Os dados do Google chegam com 2 a 3 dias de atraso.',
        ),
      ).toBeInTheDocument();
    });

    it('shows zeros and a hyphen for a post Google has not reported yet', () => {
      wrap(
        <BlogPerformance
          slug="post"
          metrics={{ ...metrics, search: null, index: null }}
          gscUpdatedAt={GSC_AT}
        />,
      );
      const tile = screen.getByText('Posição média').parentElement!;
      expect(within(tile).getByText('-')).toBeInTheDocument();
      expect(screen.getByText('Ainda não verificado pelo Google')).toBeInTheDocument();
    });
  });

  it('keeps the views part and shows one not-configured line, with no errors, before Search Console syncs', async () => {
    wrap(<BlogPerformance slug="post" metrics={metrics} gscUpdatedAt={null} />);
    expect(screen.getByText('Views total')).toBeInTheDocument();
    expect(await screen.findByTestId('bar-chart')).toBeInTheDocument();
    expect(screen.getByText('Search Console não configurado.')).toBeInTheDocument();
    expect(screen.queryByText('Cliques 28 dias')).not.toBeInTheDocument();
    expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument();
    expect(screen.queryByText(/Ver no Search Console/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Search Console atualizado/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Não foi possível/)).not.toBeInTheDocument();
  });
});

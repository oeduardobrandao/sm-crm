import { render, screen } from '@testing-library/react';
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
});

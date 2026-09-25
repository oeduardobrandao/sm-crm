import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('react-chartjs-2', () => ({
  Bar: ({ data }: { data: { labels: string[]; datasets: { label: string }[] } }) => (
    <div
      data-testid="bar-chart"
      data-labels={JSON.stringify(data.labels)}
      data-datasets={JSON.stringify(data.datasets.map((d) => d.label))}
    />
  ),
  Line: ({ data }: { data: { datasets: { label: string }[] } }) => (
    <div
      data-testid="line-chart"
      data-datasets={JSON.stringify(data.datasets.map((d) => d.label))}
    />
  ),
}));

vi.mock('../../lib/api', () => ({ getMetricsHistory: vi.fn() }));

import { getMetricsHistory, type MetricsHistoryResponse } from '../../lib/api';
import { RevenueSection } from '../metricas/RevenueSection';
import { MovementSection } from '../metricas/MovementSection';

const wrap = (ui: ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

const DATA: MetricsHistoryResponse = {
  generated_at: '2026-09-25T12:00:00Z',
  first_month: '2026-08',
  months: [
    {
      month: '2026-08',
      missing: false,
      close_date: '2026-08-31',
      closed: true,
      source: 'backfill',
      mrr_cents: 10000,
      arr_cents: 120000,
      paying_count: 1,
      by_provider: { stripe: 10000, pagarme: 0 },
      by_plan: [{ plan_id: 'pro', name: 'Pro', mrr_cents: 10000 }],
      movements_since: null,
      movements: null,
      churn: null,
    },
    {
      month: '2026-09',
      missing: false,
      close_date: '2026-09-24',
      closed: false,
      source: 'cron',
      mrr_cents: 15000,
      arr_cents: 180000,
      paying_count: 2,
      by_provider: { stripe: 10000, pagarme: 5000 },
      by_plan: [
        { plan_id: 'pro', name: 'Pro', mrr_cents: 10000 },
        { plan_id: 'max', name: 'Max', mrr_cents: 5000 },
      ],
      movements_since: '2026-08',
      movements: {
        new: 5000,
        expansion: 0,
        contraction: 0,
        past_due: 0,
        recovered: 0,
        churn: 0,
        switch: 0,
      },
      churn: {
        logos: 0,
        lost_cents: 0,
        base_logos: 1,
        base_cents: 10000,
        logo_pct: 0,
        revenue_pct: 0,
      },
    },
  ],
};

beforeEach(() => vi.mocked(getMetricsHistory).mockReset());

describe('RevenueSection', () => {
  it('shows the current MRR, ARR, paying count and delta, and toggles the stack', async () => {
    vi.mocked(getMetricsHistory).mockResolvedValue(DATA);
    wrap(<RevenueSection />);
    expect(await screen.findByText('MRR atual')).toBeInTheDocument();
    expect(screen.getByTestId('revenue-mrr')).toHaveTextContent('150,00');
    expect(screen.getByTestId('revenue-arr')).toHaveTextContent('1.800,00');
    expect(screen.getByTestId('revenue-paying')).toHaveTextContent('2');
    expect(screen.getByTestId('revenue-delta')).toHaveTextContent('50,00');
    expect(JSON.parse(screen.getByTestId('bar-chart').dataset.datasets!)).toEqual([
      'Stripe',
      'Pagar.me',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Por plano' }));
    expect(JSON.parse(screen.getByTestId('bar-chart').dataset.datasets!)).toEqual(['Pro', 'Max']);
  });

  it('shows the empty state when there is no history yet', async () => {
    vi.mocked(getMetricsHistory).mockResolvedValue({
      generated_at: '',
      first_month: null,
      months: [],
    });
    wrap(<RevenueSection />);
    expect(await screen.findByText('Histórico ainda vazio')).toBeInTheDocument();
  });

  it('shows the error state with retry', async () => {
    vi.mocked(getMetricsHistory).mockRejectedValue(new Error('boom'));
    wrap(<RevenueSection />);
    expect(await screen.findByRole('button', { name: /tentar novamente/i })).toBeInTheDocument();
  });
});

describe('MovementSection', () => {
  it('renders the movement bars, the churn line and the table', async () => {
    vi.mocked(getMetricsHistory).mockResolvedValue(DATA);
    wrap(<MovementSection />);
    expect(await screen.findByTestId('bar-chart')).toBeInTheDocument();
    expect(JSON.parse(screen.getByTestId('line-chart').dataset.datasets!)).toEqual([
      'Churn de logos (%)',
      'Churn de receita (%)',
    ]);
    expect(screen.getByRole('columnheader', { name: 'Novo' })).toBeInTheDocument();
    expect(screen.getByText('Setembro de 2026 (até hoje)')).toBeInTheDocument();
  });

  it('explains when there is only one month (nothing to compare)', async () => {
    vi.mocked(getMetricsHistory).mockResolvedValue({ ...DATA, months: [DATA.months[0]] });
    wrap(<MovementSection />);
    expect(
      await screen.findByText('Movimento aparece a partir do segundo mês'),
    ).toBeInTheDocument();
  });
});

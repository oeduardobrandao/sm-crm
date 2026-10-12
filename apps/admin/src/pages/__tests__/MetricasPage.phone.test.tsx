import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { mockPhone } from '../../__tests__/phone';

vi.mock('../../lib/api', () => ({
  getDeposits: vi.fn(),
  getMetricsHistory: vi.fn(),
  backfillMetrics: vi.fn(),
}));
vi.mock('react-chartjs-2', () => ({
  Bar: ({ data }: { data: { datasets: { label: string }[] } }) => (
    <div
      data-testid="bar-chart"
      data-datasets={JSON.stringify(data.datasets.map((d) => d.label))}
    />
  ),
  Line: () => <div data-testid="line-chart" />,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import {
  backfillMetrics,
  getDeposits,
  getMetricsHistory,
  type DepositsResponse,
  type MetricsHistoryResponse,
  type ProviderDeposits,
} from '../../lib/api';
import MetricasPage from '../MetricasPage';

const HISTORY: MetricsHistoryResponse = {
  generated_at: '2026-09-25T12:00:00Z',
  first_month: '2026-08',
  months: [
    {
      month: '2026-08',
      missing: false,
      close_date: '2026-08-31',
      closed: true,
      source: 'cron',
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

function provider(over: Partial<ProviderDeposits> = {}): ProviderDeposits {
  return {
    configured: true,
    ok: true,
    truncated: false,
    balance: { available_cents: 12345, pending_cents: 50000, currency: 'brl' },
    meta: { schedule_interval: 'daily', delay_days: 30 },
    upcoming: { next30: [], byMonth: [] },
    in_transit: [],
    recent: [],
    ...over,
  };
}

const DEPOSITS: DepositsResponse = {
  generated_at: '2026-09-24T12:00:00.000Z',
  currency: 'brl',
  summary: {
    next: { date: '2026-09-25', amount_cents: 293500, provider: 'pagarme' },
    next_30d_cents: 1263500,
    waiting_cents: 5000000,
    partial: false,
  },
  stripe: provider({
    upcoming: {
      next30: [
        {
          date: '2026-09-26',
          deposit_on: '2026-09-28',
          net_cents: 950000,
          gross_cents: 1000000,
          fee_cents: 50000,
          count: 3,
          kind: 'projected',
        },
      ],
      byMonth: [],
    },
    recent: [{ id: 'po_2', date: '2026-09-23', amount_cents: 18000, status: 'paid' }],
  }),
  pagarme: provider({ configured: false, ok: false, balance: null }),
};

function renderPage(entry = '/') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>
        <MetricasPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

let restorePhone: () => void;

beforeEach(() => {
  restorePhone = mockPhone();
  vi.mocked(getMetricsHistory).mockResolvedValue(HISTORY);
  vi.mocked(getDeposits).mockResolvedValue(DEPOSITS);
});

afterEach(() => {
  restorePhone();
  vi.restoreAllMocks();
});

describe('MetricasPage (phone)', () => {
  it('shows the large title, the section tabs and the revenue KPIs', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Métricas' })).toBeInTheDocument();
    const tabs = screen.getByRole('tablist', { name: 'Seção' });
    expect(within(tabs).getByRole('tab', { name: 'Receita' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(within(tabs).getByRole('tab', { name: 'Movimento e churn' })).toBeInTheDocument();
    expect(within(tabs).getByRole('tab', { name: 'Depósitos' })).toBeInTheDocument();
    expect(await screen.findByText('MRR atual')).toBeInTheDocument();
    expect(screen.getByTestId('revenue-mrr')).toHaveTextContent('150,00');
    expect(screen.getByTestId('revenue-paying')).toHaveTextContent('2');
    fireEvent.click(screen.getByRole('radio', { name: 'Por plano' }));
    expect(JSON.parse(screen.getByTestId('bar-chart').dataset.datasets!)).toEqual(['Pro', 'Max']);
  });

  it('switches to movement and churn with the month rows as a grouped list', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Movimento e churn' }));
    expect(await screen.findByText('Movimento do MRR')).toBeInTheDocument();
    expect(screen.getByTestId('line-chart')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Por mês' });
    expect(within(list).getByText('Setembro de 2026 (até hoje)')).toBeInTheDocument();
    expect(within(list).getByText(/churn 0,0% logos/)).toBeInTheDocument();
  });

  it('opens the deposits tab with the summary and the provider rows', async () => {
    renderPage('/#depositos');
    expect(screen.getByRole('tab', { name: 'Depósitos' })).toHaveAttribute('aria-selected', 'true');
    const summary = await screen.findByTestId('deposits-summary');
    expect(within(summary).getByText('Próximo depósito')).toBeInTheDocument();
    expect(within(summary).getByText('R$ 2.935,00')).toBeInTheDocument();
    const stripe = screen.getByTestId('deposits-card-stripe');
    expect(within(stripe).getByText('Disponível')).toBeInTheDocument();
    expect(within(stripe).getByText('R$ 123,45')).toBeInTheDocument();
    expect(within(stripe).getByText('Deposita em seg, 28/09')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('deposits-card-pagarme')).getByText('Não configurado'),
    ).toBeInTheDocument();
  });

  it('rebuilds the history after confirmation from the header button', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(backfillMetrics).mockResolvedValue({
      months_written: 1,
      months_kept_cron: 0,
      rows_written: 1,
      skipped: { stripe_unmapped: 0, pagarme_unmapped: 0, pagarme_divergent: 0 },
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Reconstruir histórico' }));
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => expect(backfillMetrics).toHaveBeenCalled());
  });
});

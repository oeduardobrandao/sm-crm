import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

vi.mock('../../lib/api', () => ({ getMetricsHistory: vi.fn(), getAcquisitionChannels: vi.fn() }));

const phone = vi.hoisted(() => ({ value: false }));
vi.mock('../../hooks/useIsPhone', () => ({ useIsPhone: () => phone.value }));

import {
  getAcquisitionChannels,
  getMetricsHistory,
  type AcquisitionChannelRow,
  type MetricsHistoryResponse,
  type MetricsMonth,
} from '../../lib/api';
import { ChannelsSection } from '../metricas/ChannelsSection';
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

beforeEach(() => {
  vi.mocked(getMetricsHistory).mockReset();
  phone.value = false;
});

const usdMonth = (over: Partial<MetricsMonth> = {}): MetricsMonth => ({
  month: '2026-09',
  missing: false,
  close_date: '2026-09-24',
  closed: false,
  source: 'cron',
  mrr_cents: 4900,
  arr_cents: 58800,
  paying_count: 1,
  by_provider: { stripe: 4900, pagarme: 0 },
  by_plan: [{ plan_id: 'pro', name: 'Pro', mrr_cents: 4900 }],
  movements_since: null,
  movements: null,
  churn: null,
  ...over,
});

describe('USD history', () => {
  it('hides the USD block when every USD month is zero', async () => {
    vi.mocked(getMetricsHistory).mockResolvedValue({
      ...DATA,
      months_usd: [usdMonth({ mrr_cents: 0, arr_cents: 0, paying_count: 0, by_plan: [] })],
    });
    wrap(<RevenueSection />);
    await screen.findByText('MRR atual');
    expect(screen.queryByTestId('revenue-usd')).not.toBeInTheDocument();
    expect(screen.queryByText('MRR atual (USD)')).not.toBeInTheDocument();
  });

  it('hides the USD block when months_usd is absent (older payload)', async () => {
    vi.mocked(getMetricsHistory).mockResolvedValue(DATA);
    wrap(<RevenueSection />);
    await screen.findByText('MRR atual');
    expect(screen.queryByTestId('revenue-usd')).not.toBeInTheDocument();
  });

  it('shows the USD MRR in dollars next to the BRL one', async () => {
    vi.mocked(getMetricsHistory).mockResolvedValue({ ...DATA, months_usd: [usdMonth()] });
    wrap(<RevenueSection />);
    expect(await screen.findByText('MRR atual (USD)')).toBeInTheDocument();
    expect(screen.getByTestId('revenue-mrr-usd')).toHaveTextContent('US$ 49,00');
    expect(screen.getByTestId('revenue-paying-usd')).toHaveTextContent('1');
    expect(screen.getByTestId('revenue-mrr')).toHaveTextContent('R$ 150,00');
  });

  it('shows USD movement and churn only when USD months have movements', async () => {
    const usdWithMovement = usdMonth({
      month: '2026-10',
      movements: {
        new: 4900,
        expansion: 0,
        contraction: 0,
        past_due: 0,
        recovered: 0,
        churn: 0,
        switch: 0,
      },
      movements_since: '2026-09',
      churn: {
        logos: 0,
        lost_cents: 0,
        base_logos: 1,
        base_cents: 4900,
        logo_pct: 0,
        revenue_pct: 0,
      },
    });
    vi.mocked(getMetricsHistory).mockResolvedValue({
      ...DATA,
      months_usd: [usdMonth(), usdWithMovement],
    });
    wrap(<MovementSection />);
    expect(await screen.findByTestId('movement-usd')).toBeInTheDocument();
    expect(screen.getAllByText('US$ 49,00').length).toBeGreaterThan(0);
  });
});

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
    fireEvent.click(screen.getByRole('radio', { name: 'Por plano' }));
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

const CHANNELS: AcquisitionChannelRow[] = [
  {
    channel: 'meta_ads',
    signups: 10,
    ever_paid: 4,
    paying_now: 3,
    mrr_cents: { brl: 30000, usd: 0 },
    campaigns: [
      {
        campaign: 'black-friday',
        signups: 10,
        ever_paid: 4,
        paying_now: 3,
        mrr_cents: { brl: 30000, usd: 0 },
      },
    ],
  },
  {
    channel: 'direct',
    signups: 5,
    ever_paid: 1,
    paying_now: 1,
    mrr_cents: { brl: 10000, usd: 500 },
    campaigns: [],
  },
];

describe('ChannelsSection', () => {
  it('renders the columns, the merged direct row and the total', async () => {
    vi.mocked(getAcquisitionChannels).mockResolvedValue({ channels: CHANNELS });
    wrap(<ChannelsSection />);
    expect(await screen.findByText('Meta Ads')).toBeInTheDocument();
    for (const name of [
      'Canal',
      'Cadastros',
      'Assinaram',
      'Pagando hoje',
      'MRR (R$)',
      'MRR (US$)',
    ]) {
      expect(screen.getByRole('columnheader', { name })).toBeInTheDocument();
    }
    expect(screen.getByText('Direto / desconhecido')).toBeInTheDocument();
    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getByText(/Clique num canal para ver as campanhas/)).toBeInTheDocument();
  });

  it('reveals the campaign rows when a channel is clicked', async () => {
    vi.mocked(getAcquisitionChannels).mockResolvedValue({ channels: CHANNELS });
    wrap(<ChannelsSection />);
    await screen.findByText('Meta Ads');
    expect(screen.queryByText('black-friday')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Meta Ads, campanhas' }));
    expect(screen.getByText('black-friday')).toBeInTheDocument();
  });

  it('refetches with the new months when the range changes', async () => {
    vi.mocked(getAcquisitionChannels).mockResolvedValue({ channels: CHANNELS });
    wrap(<ChannelsSection />);
    await screen.findByText('Meta Ads');
    const [from, to] = vi.mocked(getAcquisitionChannels).mock.calls[0];
    expect(from).toBe(to);
    fireEvent.change(screen.getByLabelText('Cadastros de'), { target: { value: '2026-01' } });
    await waitFor(() => expect(getAcquisitionChannels).toHaveBeenCalledWith('2026-01', to));
  });

  it('blocks a range over 24 months with its own message, without calling the API', async () => {
    vi.mocked(getAcquisitionChannels).mockReset();
    vi.mocked(getAcquisitionChannels).mockResolvedValue({ channels: CHANNELS });
    wrap(<ChannelsSection />);
    await screen.findByText('Meta Ads');
    fireEvent.change(screen.getByLabelText('até'), { target: { value: '2026-12' } });
    // 2025-01..2026-12 is exactly 24 months: allowed.
    fireEvent.change(screen.getByLabelText('Cadastros de'), { target: { value: '2025-01' } });
    await waitFor(() => expect(getAcquisitionChannels).toHaveBeenCalledWith('2025-01', '2026-12'));
    const calls = vi.mocked(getAcquisitionChannels).mock.calls.length;
    // 2024-12..2026-12 is 25 months: blocked.
    fireEvent.change(screen.getByLabelText('Cadastros de'), { target: { value: '2024-12' } });
    expect(await screen.findByText('Período longo demais')).toBeInTheDocument();
    expect(screen.getByText('Escolha até 24 meses.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /tentar/i })).not.toBeInTheDocument();
    expect(vi.mocked(getAcquisitionChannels).mock.calls.length).toBe(calls);
  });

  it('on a phone shows the direct/unknown split as a visible line and expands campaigns', async () => {
    phone.value = true;
    vi.mocked(getAcquisitionChannels).mockResolvedValue({
      channels: [
        ...CHANNELS,
        {
          channel: 'unknown',
          signups: 2,
          ever_paid: 0,
          paying_now: 0,
          mrr_cents: { brl: 0, usd: 0 },
          campaigns: [],
        },
      ],
    });
    wrap(<ChannelsSection />);
    const card = await screen.findByTestId('channel-card-direct_unknown');
    expect(card).toHaveTextContent('Direto: 5 · Não capturado: 2');
    expect(screen.queryByRole('columnheader')).not.toBeInTheDocument();
    expect(screen.queryByText('black-friday')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Meta Ads, campanhas' }));
    expect(screen.getByTestId('channel-card-meta_ads')).toHaveTextContent('black-friday');
  });

  it('shows the error state when the request fails', async () => {
    vi.mocked(getAcquisitionChannels).mockRejectedValue(new Error('boom'));
    wrap(<ChannelsSection />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar os canais de aquisição.',
    );
  });
});

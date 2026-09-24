import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/api', () => ({ getDeposits: vi.fn() }));

import { getDeposits, type DepositsResponse, type ProviderDeposits } from '../../lib/api';
import { DepositsSection } from '../metricas/DepositsSection';

function provider(over: Partial<ProviderDeposits> = {}): ProviderDeposits {
  return {
    configured: true,
    ok: true,
    truncated: false,
    balance: { available_cents: 12345, pending_cents: 50000, currency: 'brl' },
    meta: {},
    upcoming: { next30: [], byMonth: [] },
    in_transit: [],
    recent: [],
    ...over,
  };
}

const RESPONSE: DepositsResponse = {
  generated_at: '2026-09-24T12:00:00.000Z',
  currency: 'brl',
  summary: {
    next: { date: '2026-09-25', amount_cents: 293500, provider: 'pagarme' },
    next_30d_cents: 1263500,
    waiting_cents: 5000000,
    partial: false,
  },
  stripe: provider({
    meta: { schedule_interval: 'daily', delay_days: 30 },
    upcoming: {
      next30: [
        {
          date: '2026-09-25',
          deposit_on: '2026-09-25',
          net_cents: 20000,
          gross_cents: 20000,
          fee_cents: 0,
          count: 1,
          kind: 'payout',
        },
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
      byMonth: [
        { month: '2026-11', net_cents: 97000, gross_cents: 100000, fee_cents: 3000, count: 1 },
      ],
    },
    recent: [{ id: 'po_2', date: '2026-09-23', amount_cents: 18000, status: 'paid' }],
  }),
  pagarme: provider({
    balance: { available_cents: 0, pending_cents: 4000000, currency: 'brl' },
    meta: {
      transfer_enabled: true,
      transfer_interval: 'daily',
      transfer_day: null,
      anticipation_enabled: false,
      anticipation_type: null,
    },
    upcoming: {
      next30: [
        {
          date: '2026-09-25',
          deposit_on: '2026-09-25',
          net_cents: 293500,
          gross_cents: 309000,
          fee_cents: 15500,
          count: 100,
          kind: 'projected',
          manual_withdrawal: false,
        },
      ],
      byMonth: [
        { month: '2026-10', net_cents: 293500, gross_cents: 309000, fee_cents: 15500, count: 100 },
        { month: '2026-11', net_cents: 293500, gross_cents: 309000, fee_cents: 15500, count: 100 },
      ],
    },
    in_transit: [
      { id: 'tr_1', amount_cents: 4000, expected_on: '2026-09-25', status: 'processing' },
    ],
  }),
};

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DepositsSection />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(getDeposits).mockReset();
});

describe('DepositsSection', () => {
  it('shows skeletons while loading', () => {
    vi.mocked(getDeposits).mockReturnValue(new Promise(() => {}));
    renderSection();
    expect(screen.getAllByTestId('deposits-skeleton').length).toBeGreaterThan(0);
  });

  it('renders the summary strip and both provider cards with data', async () => {
    vi.mocked(getDeposits).mockResolvedValue(RESPONSE);
    renderSection();
    expect(await screen.findByText('Próximo depósito')).toBeInTheDocument();
    const summary = screen.getByTestId('deposits-summary');
    expect(within(summary).getByText('R$ 2.935,00')).toBeInTheDocument();
    expect(within(summary).getByText(/Pagar\.me · sex, 25\/09/)).toBeInTheDocument();
    expect(within(summary).getByText('R$ 12.635,00')).toBeInTheDocument();
    expect(within(summary).getByText('R$ 50.000,00')).toBeInTheDocument();
    expect(within(summary).getByText('A receber (total)')).toBeInTheDocument();

    const stripe = screen.getByTestId('deposits-card-stripe');
    expect(within(stripe).getByRole('heading', { name: 'Stripe' })).toBeInTheDocument();
    expect(within(stripe).getByText('Repasse automático diário, D+30')).toBeInTheDocument();
    expect(within(stripe).getByText('R$ 123,45')).toBeInTheDocument(); // disponível
    expect(within(stripe).getByText('R$ 500,00')).toBeInTheDocument(); // a compensar
    expect(within(stripe).getByText('Deposita em sex, 25/09')).toBeInTheDocument();
    expect(within(stripe).getByText('Deposita em seg, 28/09')).toBeInTheDocument();
    expect(within(stripe).getByText('R$ 9.500,00')).toBeInTheDocument();
    expect(within(stripe).getByText('novembro de 2026')).toBeInTheDocument();
    expect(within(stripe).getByText('Pago')).toBeInTheDocument();

    const pagarme = screen.getByTestId('deposits-card-pagarme');
    expect(within(pagarme).getByRole('heading', { name: 'Pagar.me' })).toBeInTheDocument();
    expect(within(pagarme).getByText('Transferência automática diária')).toBeInTheDocument();
    expect(within(pagarme).getByText('outubro de 2026')).toBeInTheDocument();
    expect(within(pagarme).getByText('Transferências em andamento')).toBeInTheDocument();
    expect(within(pagarme).getByText('Em trânsito')).toBeInTheDocument(); // the processing badge
    expect(within(pagarme).getByText('R$ 40,00')).toBeInTheDocument();
  });

  it('a payout row exposes gross and fee through the tooltip trigger label', async () => {
    vi.mocked(getDeposits).mockResolvedValue(RESPONSE);
    renderSection();
    const stripe = await screen.findByTestId('deposits-card-stripe');
    expect(
      within(stripe).getByLabelText('Bruto R$ 10.000,00, taxas R$ 500,00'),
    ).toBeInTheDocument();
  });

  it('shows the not-configured state naming the secret', async () => {
    vi.mocked(getDeposits).mockResolvedValue({
      ...RESPONSE,
      pagarme: { ...provider(), configured: false, ok: false, balance: null },
    });
    renderSection();
    const pagarme = await screen.findByTestId('deposits-card-pagarme');
    expect(within(pagarme).getByText('Não configurado')).toBeInTheDocument();
    expect(within(pagarme).getByText(/PAGARME_RECIPIENT_ID/)).toBeInTheDocument();
  });

  it('shows a per-provider error state with retry when ok is false, and labels the total as partial', async () => {
    vi.mocked(getDeposits).mockResolvedValue({
      ...RESPONSE,
      summary: { ...RESPONSE.summary, partial: true },
      stripe: { ...provider(), ok: false, error: 'unavailable', balance: null },
    });
    renderSection();
    const stripe = await screen.findByTestId('deposits-card-stripe');
    expect(within(stripe).getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('A receber (parcial: Stripe indisponível)')).toBeInTheDocument();
    fireEvent.click(within(stripe).getByRole('button', { name: 'Tentar novamente' }));
    expect(getDeposits).toHaveBeenCalledTimes(2);
  });

  it('warns when a provider list is truncated', async () => {
    vi.mocked(getDeposits).mockResolvedValue({
      ...RESPONSE,
      pagarme: { ...RESPONSE.pagarme, truncated: true },
    });
    renderSection();
    const pagarme = await screen.findByTestId('deposits-card-pagarme');
    expect(within(pagarme).getByText(/Lista parcial/)).toBeInTheDocument();
    expect(
      within(screen.getByTestId('deposits-card-stripe')).queryByText(/Lista parcial/),
    ).toBeNull();
  });

  it('shows the section-level error when the request itself fails', async () => {
    vi.mocked(getDeposits).mockRejectedValue(new Error('boom'));
    renderSection();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('boom')).not.toBeInTheDocument();
  });

  it('shows "Nada previsto" when a provider has no upcoming rows', async () => {
    vi.mocked(getDeposits).mockResolvedValue({ ...RESPONSE, stripe: provider() });
    renderSection();
    const stripe = await screen.findByTestId('deposits-card-stripe');
    expect(within(stripe).getByText('Nada previsto')).toBeInTheDocument();
  });

  it('the "Atualizar" button refetches', async () => {
    vi.mocked(getDeposits).mockResolvedValue(RESPONSE);
    renderSection();
    await screen.findByTestId('deposits-summary');
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }));
    expect(getDeposits).toHaveBeenCalledTimes(2);
  });
});

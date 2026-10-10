import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AffiliatesPage from '../AffiliatesPage';
import AffiliateDetailPage from '../AffiliateDetailPage';
import {
  getAffiliate,
  listAffiliates,
  updateAffiliateCommissionRule,
  updateAffiliateStatus,
} from '../../lib/api';
import { formatRateBps, parsePercentToBps, stripeConnectState } from '../../lib/affiliates';

vi.mock('../../lib/api', () => ({
  listAffiliates: vi.fn(),
  getAffiliate: vi.fn(),
  updateAffiliateStatus: vi.fn(),
  updateAffiliateCommissionRule: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const SUMMARY = {
  referrals_count: 3,
  trialing_count: 1,
  paying_count: 2,
  pending_cents: 500,
  available_cents: 7491,
  paid_out_cents: 0,
  lifetime_cents: 7991,
};

const RULES = [
  {
    plan_id: 'start',
    plan_name: 'Start',
    price_brl: 4990,
    rate_bps: 3000,
    months: 3,
    configured: true,
  },
  {
    plan_id: 'pro',
    plan_name: 'Pro',
    price_brl: 9990,
    rate_bps: 2500,
    months: 3,
    configured: true,
  },
  {
    plan_id: 'max',
    plan_name: 'Max',
    price_brl: 19990,
    rate_bps: 2000,
    months: 3,
    configured: true,
  },
];

function wrap(ui: React.ReactNode, path = '/admin/afiliados') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/afiliados" element={ui} />
          <Route path="/admin/afiliados/:id" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('affiliate helpers', () => {
  it('parses a percent into basis points', () => {
    expect(parsePercentToBps('30')).toBe(3000);
    expect(parsePercentToBps('12,5')).toBe(1250);
    expect(parsePercentToBps('12.5%')).toBe(1250);
    expect(parsePercentToBps('101')).toBeNull();
    expect(parsePercentToBps('abc')).toBeNull();
  });

  it('formats basis points and derives the Stripe state', () => {
    expect(formatRateBps(3000)).toBe('30%');
    expect(formatRateBps(1250)).toBe('12,5%');
    const base = {
      stripe_account_id: 'acct_1',
      stripe_details_submitted: false,
      stripe_transfers_active: false,
    };
    expect(stripeConnectState({ ...base, stripe_account_id: null })).toBe('none');
    expect(stripeConnectState(base)).toBe('onboarding');
    expect(stripeConnectState({ ...base, stripe_details_submitted: true })).toBe('review');
    expect(stripeConnectState({ ...base, stripe_transfers_active: true })).toBe('ready');
  });
});

describe('AffiliatesPage', () => {
  beforeEach(() => {
    vi.mocked(listAffiliates).mockReset();
    vi.mocked(updateAffiliateCommissionRule)
      .mockReset()
      .mockResolvedValue({ rule: {} as never });
  });

  it('lists affiliates with balances and the Stripe state', async () => {
    vi.mocked(listAffiliates).mockResolvedValue({
      affiliates: [
        {
          id: 'a1',
          code: 'ana7k3f',
          nome: 'Ana',
          email: 'ana@x.com',
          status: 'active',
          stripe_account_id: null,
          stripe_details_submitted: false,
          stripe_transfers_active: false,
          created_at: '2026-10-01T00:00:00Z',
          summary: SUMMARY,
        },
      ],
      rules: RULES,
    });
    wrap(<AffiliatesPage />);
    const links = await screen.findAllByRole('link', { name: 'Ana' });
    expect(links[0]).toHaveAttribute('href', '/admin/afiliados/a1');
    expect(screen.getByText('ana7k3f')).toBeInTheDocument();
    expect(screen.getByText('Sem conta Stripe')).toBeInTheDocument();
  });

  it('edits a commission rule from the table', async () => {
    vi.mocked(listAffiliates).mockResolvedValue({ affiliates: [], rules: RULES });
    const user = userEvent.setup();
    wrap(<AffiliatesPage />);
    const rate = await screen.findByLabelText('Comissão do plano Pro');
    expect(rate).toHaveValue('25');
    await user.clear(rate);
    await user.type(rate, '22,5');
    const row = rate.closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(updateAffiliateCommissionRule).toHaveBeenCalledWith({
        plan_id: 'pro',
        rate_bps: 2250,
        months: 3,
      }),
    );
  });

  it('shows the empty state', async () => {
    vi.mocked(listAffiliates).mockResolvedValue({ affiliates: [], rules: RULES });
    wrap(<AffiliatesPage />);
    expect(await screen.findByText('Nenhum afiliado ainda')).toBeInTheDocument();
  });
});

describe('AffiliateDetailPage', () => {
  beforeEach(() => {
    vi.mocked(getAffiliate)
      .mockReset()
      .mockResolvedValue({
        affiliate: {
          id: 'a1',
          code: 'ana7k3f',
          nome: 'Ana Souza',
          email: 'ana@x.com',
          telefone: null,
          status: 'active',
          stripe_account_id: 'acct_1',
          stripe_details_submitted: true,
          stripe_transfers_active: true,
          stripe_status_checked_at: '2026-11-05T11:47:00Z',
          terms_accepted_at: '2026-10-01T00:00:00Z',
          created_at: '2026-10-01T00:00:00Z',
        },
        summary: SUMMARY,
        referrals: [
          {
            workspace_id: 'ws-1',
            workspace_name: 'Agência X',
            created_at: '2026-09-01T00:00:00Z',
            provider: 'stripe',
            status: 'active',
            plan_id: 'pro',
            billing_interval: 'month',
          },
        ],
        commissions: [],
        payouts: [
          {
            id: 'p1',
            amount_cents: 7491,
            status: 'failed',
            stripe_account_id: 'acct_1',
            stripe_transfer_id: null,
            failure_code: 'balance_insufficient',
            created_at: '2026-11-05T11:47:00Z',
            paid_at: null,
          },
        ],
      });
    vi.mocked(updateAffiliateStatus)
      .mockReset()
      .mockResolvedValue({ affiliate: {} as never });
  });

  it('shows the Stripe account, the referred workspace and payout failures', async () => {
    wrap(<AffiliateDetailPage />, '/admin/afiliados/a1');
    expect(await screen.findByText('Ana Souza', { selector: 'h1' })).toBeInTheDocument();
    expect(screen.getByText('Recebe pelo Stripe')).toBeInTheDocument();
    expect(screen.getByText('acct_1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Agência X' })).toHaveAttribute(
      'href',
      '/admin/workspaces/ws-1',
    );
    expect(screen.getByText('balance_insufficient')).toBeInTheDocument();
  });

  it('suspends the affiliate', async () => {
    const user = userEvent.setup();
    wrap(<AffiliateDetailPage />, '/admin/afiliados/a1');
    await user.click(await screen.findByRole('button', { name: 'Suspender' }));
    await waitFor(() => expect(updateAffiliateStatus).toHaveBeenCalledWith('a1', 'suspended'));
  });
});

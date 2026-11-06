import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AffiliateDetailPage from '../AffiliateDetailPage';
import { getAffiliate, updateAffiliateStatus } from '../../lib/api';
import { mockPhone } from '../../__tests__/phone';

vi.mock('../../lib/api', () => ({
  getAffiliate: vi.fn(),
  updateAffiliateStatus: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const DETAIL = {
  affiliate: {
    id: 'a1',
    code: 'ana7k3f',
    nome: 'Ana Souza',
    email: 'ana@x.com',
    telefone: null,
    status: 'active' as const,
    stripe_account_id: 'acct_1',
    stripe_details_submitted: true,
    stripe_transfers_active: true,
    stripe_status_checked_at: '2026-11-05T11:47:00Z',
    terms_accepted_at: '2026-10-01T00:00:00Z',
    created_at: '2026-10-01T00:00:00Z',
  },
  summary: {
    referrals_count: 3,
    trialing_count: 1,
    paying_count: 2,
    pending_cents: 500,
    available_cents: 7491,
    paid_out_cents: 0,
    lifetime_cents: 7991,
  },
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
  commissions: [
    {
      id: 'c1',
      workspace_id: 'ws-1',
      workspace_name: 'Agência X',
      stripe_invoice_id: 'in_1',
      invoice_amount_cents: 9990,
      plan_id: 'pro',
      billing_reason: 'subscription_cycle',
      commissionable_cents: 9990,
      covered_months: 1,
      rate_bps: 3000,
      commission_cents: 2997,
      refunded_amount_cents: 0,
      disputed: false,
      net_cents: 2997,
      paid_at: '2026-09-05T00:00:00Z',
      available_at: '2026-09-12T00:00:00Z',
    },
  ],
  payouts: [
    {
      id: 'p1',
      amount_cents: 7491,
      status: 'failed' as const,
      stripe_account_id: 'acct_1',
      stripe_transfer_id: null,
      failure_code: 'balance_insufficient',
      created_at: '2026-11-05T11:47:00Z',
      paid_at: null,
    },
  ],
};

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/admin/afiliados/a1']}>
        <Routes>
          <Route path="/admin/afiliados/:id" element={<AffiliateDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AffiliateDetailPage (phone)', () => {
  let restore: () => void;
  beforeEach(() => {
    restore = mockPhone();
    vi.mocked(getAffiliate).mockReset().mockResolvedValue(DETAIL);
    vi.mocked(updateAffiliateStatus)
      .mockReset()
      .mockResolvedValue({ affiliate: {} as never });
  });
  afterEach(() => restore());

  it('shows the hero, a back button to Afiliados and the Stripe Connect state', async () => {
    wrap();
    expect(await screen.findByRole('heading', { level: 1, name: /Ana Souza/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Voltar para Afiliados' })).toBeInTheDocument();
    expect(screen.getByText('Recebe pelo Stripe')).toBeInTheDocument();
    expect(screen.getByText('acct_1')).toBeInTheDocument();
  });

  it('switches the history between referrals, commissions and payouts', async () => {
    const user = userEvent.setup();
    wrap();
    await screen.findByRole('heading', { level: 1, name: /Ana Souza/ });
    await user.click(screen.getByRole('tab', { name: 'Indicações' }));
    expect(screen.getByRole('link', { name: /Agência X/ })).toHaveAttribute(
      'href',
      '/admin/workspaces/ws-1',
    );
    await user.click(screen.getByRole('tab', { name: 'Repasses' }));
    expect(screen.getByText('balance_insufficient')).toBeInTheDocument();
  });

  it('suspends the affiliate', async () => {
    const user = userEvent.setup();
    wrap();
    await user.click(await screen.findByRole('button', { name: 'Suspender' }));
    await waitFor(() => expect(updateAffiliateStatus).toHaveBeenCalledWith('a1', 'suspended'));
  });
});

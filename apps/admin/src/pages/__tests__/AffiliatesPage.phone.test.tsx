import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AffiliatesPage from '../AffiliatesPage';
import { listAffiliates, updateAffiliateCommissionRule } from '../../lib/api';
import { mockPhone } from '../../__tests__/phone';

vi.mock('../../lib/api', () => ({
  listAffiliates: vi.fn(),
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
    plan_id: 'pro',
    plan_name: 'Pro',
    price_brl: 9990,
    rate_bps: 3000,
    months: 6,
    configured: true,
  },
  {
    plan_id: 'max',
    plan_name: 'Max',
    price_brl: 19990,
    rate_bps: 3000,
    months: 6,
    configured: true,
  },
  { plan_id: 'free', plan_name: 'Free', price_brl: 0, rate_bps: 0, months: 0, configured: false },
];

const ANA = {
  id: 'a1',
  code: 'ana7k3f',
  nome: 'Ana',
  email: 'ana@x.com',
  status: 'active' as const,
  stripe_account_id: null,
  stripe_details_submitted: false,
  stripe_transfers_active: false,
  created_at: '2026-10-01T00:00:00Z',
  summary: SUMMARY,
};

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/admin/afiliados']}>
        <Routes>
          <Route path="/admin/afiliados" element={<AffiliatesPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AffiliatesPage (phone)', () => {
  let restore: () => void;
  beforeEach(() => {
    restore = mockPhone();
    vi.mocked(listAffiliates)
      .mockReset()
      .mockResolvedValue({ affiliates: [ANA], rules: RULES });
    vi.mocked(updateAffiliateCommissionRule)
      .mockReset()
      .mockResolvedValue({ rule: {} as never });
  });
  afterEach(() => restore());

  it('shows the large title and the affiliates as links', async () => {
    wrap();
    expect(screen.getByRole('heading', { level: 1, name: 'Afiliados' })).toBeInTheDocument();
    const link = await screen.findByRole('link', { name: /^Ana/ });
    expect(link).toHaveAttribute('href', '/admin/afiliados/a1');
    expect(within(link).getByText('3 indicações · 2 assinantes')).toBeInTheDocument();
    expect(within(link).getByText('Sem conta Stripe')).toBeInTheDocument();
  });

  it('summarises the commission table and opens the rules sheet', async () => {
    const user = userEvent.setup();
    wrap();
    const cell = await screen.findByRole('button', { name: /Tabela de comissões/ });
    expect(within(cell).getByText('30% por 6 meses no Pro e no Max')).toBeInTheDocument();
    await user.click(cell);
    expect(await screen.findByRole('dialog', { name: 'Comissões' })).toBeInTheDocument();
  });

  it('saves every edited rule from the sheet header', async () => {
    const user = userEvent.setup();
    wrap();
    await user.click(await screen.findByRole('button', { name: /Tabela de comissões/ }));
    const rate = await screen.findByLabelText('Comissão do plano Pro');
    await user.clear(rate);
    await user.type(rate, '25');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(updateAffiliateCommissionRule).toHaveBeenCalledWith({
        plan_id: 'pro',
        rate_bps: 2500,
        months: 6,
      }),
    );
    expect(updateAffiliateCommissionRule).toHaveBeenCalledTimes(1);
  });
});

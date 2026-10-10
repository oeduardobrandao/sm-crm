import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AfiliadoPainelPage from '../AfiliadoPainelPage';
import { listPublicPricingPlans } from '@/services/billing';
import {
  AffiliateApiError,
  getAffiliateDashboard,
  listCommissionRules,
  openAffiliateStripeDashboard,
  startAffiliateStripeConnect,
  type AffiliateDashboard,
} from '@/services/affiliates';

vi.mock('@/services/affiliates', async (orig) => ({
  ...(await orig<typeof import('@/services/affiliates')>()),
  getAffiliateDashboard: vi.fn(),
  startAffiliateStripeConnect: vi.fn(),
  openAffiliateStripeDashboard: vi.fn(),
  listCommissionRules: vi.fn(),
}));
vi.mock('@/services/billing', () => ({ listPublicPricingPlans: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const DASHBOARD: AffiliateDashboard = {
  affiliate: {
    nome: 'Ana Souza',
    email: 'ana@x.com',
    code: 'ana7k3f',
    status: 'active',
    stripe: { connected: false, details_submitted: false, transfers_active: false },
  },
  min_payout_cents: 5000,
  summary: {
    referrals_count: 2,
    trialing_count: 1,
    paying_count: 1,
    pending_cents: 2497,
    available_cents: 0,
    paid_out_cents: 0,
    lifetime_cents: 2497,
  },
  referrals: [
    { numero: 1, created_at: '2026-09-01T00:00:00Z', situacao: 'ativo' },
    { numero: 2, created_at: '2026-09-05T00:00:00Z', situacao: 'trial' },
  ],
  commissions: [
    {
      paid_at: '2026-10-01T12:00:00Z',
      invoice_amount_cents: 9990,
      plan_id: 'pro',
      rate_bps: 2500,
      commission_cents: 2497,
      net_cents: 2497,
      available_at: '2026-10-31T12:00:00Z',
      situacao: 'pendente',
    },
  ],
  payouts: [],
};

const assign = vi.fn();

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/afiliados/painel/:token" element={<AfiliadoPainelPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AfiliadoPainelPage', () => {
  beforeEach(() => {
    vi.mocked(getAffiliateDashboard).mockReset();
    vi.mocked(startAffiliateStripeConnect).mockReset();
    vi.mocked(openAffiliateStripeDashboard).mockReset();
    vi.mocked(listPublicPricingPlans).mockResolvedValue([
      { id: 'pro', name: 'Pro', price_brl: 9990 },
    ] as never);
    vi.mocked(listCommissionRules).mockResolvedValue([
      { plan_id: 'pro', rate_bps: 2500, months: 3 },
    ]);
    assign.mockReset();
    vi.stubGlobal('location', { ...window.location, assign });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('shows the referral link, totals, commissions and anonymised referrals', async () => {
    vi.mocked(getAffiliateDashboard).mockResolvedValue(DASHBOARD);
    renderAt('/afiliados/painel/tok123');
    expect(await screen.findByText('Olá, Ana!')).toBeInTheDocument();
    expect(getAffiliateDashboard).toHaveBeenCalledWith('tok123');
    expect(screen.getByLabelText('Seu link')).toHaveValue('https://www.mesaas.com.br/?ref=ana7k3f');
    expect(screen.getByText('Indicação #1')).toBeInTheDocument();
    expect(screen.getByText('Em teste grátis', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getAllByText('Pendente').length).toBeGreaterThan(0);
  });

  it('not connected: the Stripe button opens onboarding', async () => {
    vi.mocked(getAffiliateDashboard).mockResolvedValue(DASHBOARD);
    vi.mocked(startAffiliateStripeConnect).mockResolvedValue({
      url: 'https://connect.stripe.com/x',
    });
    const user = userEvent.setup();
    renderAt('/afiliados/painel/tok123');
    expect(await screen.findByText('Conecte sua conta para receber')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Conectar com Stripe' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://connect.stripe.com/x'));
    expect(startAffiliateStripeConnect).toHaveBeenCalledWith('tok123');
  });

  it('ready: opens the Stripe Express dashboard', async () => {
    vi.mocked(getAffiliateDashboard).mockResolvedValue({
      ...DASHBOARD,
      affiliate: {
        ...DASHBOARD.affiliate,
        stripe: { connected: true, details_submitted: true, transfers_active: true },
      },
    });
    vi.mocked(openAffiliateStripeDashboard).mockResolvedValue({
      url: 'https://connect.stripe.com/e',
    });
    const user = userEvent.setup();
    renderAt('/afiliados/painel/tok123');
    expect(await screen.findByText('Pronto para receber')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Abrir painel do Stripe/ }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://connect.stripe.com/e'));
  });

  it('submitted but not active: shows the review state', async () => {
    vi.mocked(getAffiliateDashboard).mockResolvedValue({
      ...DASHBOARD,
      affiliate: {
        ...DASHBOARD.affiliate,
        stripe: { connected: true, details_submitted: true, transfers_active: false },
      },
    });
    renderAt('/afiliados/painel/tok123');
    expect(await screen.findByText('Cadastro em análise pelo Stripe')).toBeInTheDocument();
  });

  it('flags a suspended affiliate', async () => {
    vi.mocked(getAffiliateDashboard).mockResolvedValue({
      ...DASHBOARD,
      affiliate: { ...DASHBOARD.affiliate, status: 'suspended' },
    });
    renderAt('/afiliados/painel/tok123');
    expect(await screen.findByRole('alert')).toHaveTextContent('suspensa');
  });

  it('invalid link offers a new one', async () => {
    vi.mocked(getAffiliateDashboard).mockRejectedValue(new AffiliateApiError('x', 404));
    renderAt('/afiliados/painel/bad');
    expect(await screen.findByText('Link inválido ou expirado')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pedir novo link' })).toHaveAttribute(
      'href',
      '/afiliados#cadastro',
    );
  });
});

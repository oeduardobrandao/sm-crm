import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AfiliadoPainelPage from '../AfiliadoPainelPage';
import { listPublicPricingPlans } from '@/services/billing';
import {
  AffiliateApiError,
  getAffiliateDashboard,
  type AffiliateDashboard,
} from '@/services/affiliates';

vi.mock('@/services/affiliates', async (orig) => ({
  ...(await orig<typeof import('@/services/affiliates')>()),
  getAffiliateDashboard: vi.fn(),
  updateAffiliatePayout: vi.fn(),
}));
vi.mock('@/services/billing', () => ({ listPublicPricingPlans: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const DASHBOARD: AffiliateDashboard = {
  affiliate: {
    nome: 'Ana Souza',
    email: 'ana@x.com',
    code: 'ana7k3f',
    status: 'active',
    commission_rate_bps: 2000,
    pix_key_type: null,
    pix_key: null,
    documento_mascarado: null,
    titular_nome: null,
  },
  summary: {
    referrals_count: 2,
    trialing_count: 1,
    paying_count: 1,
    pending_cents: 1998,
    available_cents: 0,
    paid_out_cents: 0,
    lifetime_cents: 1998,
  },
  referrals: [
    { numero: 1, created_at: '2026-09-01T00:00:00Z', situacao: 'ativo' },
    { numero: 2, created_at: '2026-09-05T00:00:00Z', situacao: 'trial' },
  ],
  commissions: [
    {
      paid_at: '2026-10-01T12:00:00Z',
      invoice_amount_cents: 9990,
      commission_cents: 1998,
      net_cents: 1998,
      available_at: '2026-10-31T12:00:00Z',
      situacao: 'pendente',
    },
  ],
  payouts: [],
};

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
    vi.mocked(listPublicPricingPlans).mockResolvedValue([]);
  });

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

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AffiliatesPage from '../AffiliatesPage';
import AffiliateDetailPage from '../AffiliateDetailPage';
import {
  createAffiliatePayout,
  getAffiliate,
  listAffiliates,
  updateAffiliate,
} from '../../lib/api';
import { formatRateBps, parseBRLToCents } from '../../lib/affiliates';

vi.mock('../../lib/api', () => ({
  listAffiliates: vi.fn(),
  getAffiliate: vi.fn(),
  updateAffiliate: vi.fn(),
  createAffiliatePayout: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const SUMMARY = {
  referrals_count: 3,
  trialing_count: 1,
  paying_count: 2,
  pending_cents: 500,
  available_cents: 1998,
  paid_out_cents: 0,
  lifetime_cents: 2498,
};

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
  it('parses BRL input into cents', () => {
    expect(parseBRLToCents('19,98')).toBe(1998);
    expect(parseBRLToCents('R$ 1.234,56')).toBe(123456);
    expect(parseBRLToCents('19.98')).toBe(1998);
    expect(parseBRLToCents('0')).toBeNull();
    expect(parseBRLToCents('abc')).toBeNull();
    expect(parseBRLToCents('1,234')).toBeNull();
  });

  it('formats basis points', () => {
    expect(formatRateBps(2000)).toBe('20%');
    expect(formatRateBps(1250)).toBe('12,5%');
  });
});

describe('AffiliatesPage', () => {
  beforeEach(() => vi.mocked(listAffiliates).mockReset());

  it('lists affiliates with balances and flags missing PIX', async () => {
    vi.mocked(listAffiliates).mockResolvedValue({
      affiliates: [
        {
          id: 'a1',
          code: 'ana7k3f',
          nome: 'Ana',
          email: 'ana@x.com',
          status: 'active',
          commission_rate_bps: 2000,
          has_pix: false,
          created_at: '2026-10-01T00:00:00Z',
          summary: SUMMARY,
        },
      ],
    });
    wrap(<AffiliatesPage />);
    const table = within(await screen.findByRole('table'));
    expect(table.getByRole('link', { name: 'Ana' })).toHaveAttribute('href', '/admin/afiliados/a1');
    expect(table.getByText('ana7k3f')).toBeInTheDocument();
    expect(table.getByText('Sem PIX')).toBeInTheDocument();
    expect(table.getByText('Ativo · 20%')).toBeInTheDocument();
  });

  it('shows the empty state', async () => {
    vi.mocked(listAffiliates).mockResolvedValue({ affiliates: [] });
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
          commission_rate_bps: 2000,
          pix_key_type: 'cpf',
          pix_key: '52998224725',
          documento: '52998224725',
          titular_nome: 'Ana Souza',
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
        payouts: [],
      });
    vi.mocked(createAffiliatePayout)
      .mockReset()
      .mockResolvedValue({ payout: {} as never });
    vi.mocked(updateAffiliate)
      .mockReset()
      .mockResolvedValue({ affiliate: {} as never });
  });

  it('shows PIX data and the referred workspace for the admin', async () => {
    wrap(<AffiliateDetailPage />, '/admin/afiliados/a1');
    expect(await screen.findByText('Ana Souza', { selector: 'h1' })).toBeInTheDocument();
    expect(screen.getByText('529.982.247-25', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Agência X' })).toHaveAttribute(
      'href',
      '/admin/workspaces/ws-1',
    );
  });

  it('registers a payout in cents', async () => {
    const user = userEvent.setup();
    wrap(<AffiliateDetailPage />, '/admin/afiliados/a1');
    await user.click(await screen.findByRole('button', { name: 'Registrar repasse' }));
    await user.type(screen.getByLabelText('Valor (R$)'), '19,98');
    await user.type(screen.getByLabelText('ID da transação PIX (opcional)'), 'E2E1');
    await user.click(screen.getByRole('button', { name: 'Registrar' }));
    await waitFor(() =>
      expect(createAffiliatePayout).toHaveBeenCalledWith('a1', {
        amount_cents: 1998,
        reference: 'E2E1',
        note: undefined,
      }),
    );
  });

  it('suspends the affiliate', async () => {
    const user = userEvent.setup();
    wrap(<AffiliateDetailPage />, '/admin/afiliados/a1');
    await user.click(await screen.findByRole('button', { name: 'Suspender' }));
    await waitFor(() =>
      expect(updateAffiliate).toHaveBeenCalledWith('a1', { status: 'suspended' }),
    );
  });
});

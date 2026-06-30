import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const startCheckout = vi.fn();
const openBillingPortal = vi.fn();
const getWorkspaceSubscription = vi.fn();
const getEffectivePlanId = vi.fn();
const getWorkspaceSeats = vi.fn();
const changeSeats = vi.fn();
const listActivePlans = vi.fn();

vi.mock('@/services/billing', () => ({
  startCheckout: (...a: unknown[]) => startCheckout(...a),
  openBillingPortal: (...a: unknown[]) => openBillingPortal(...a),
  getWorkspaceSubscription: (...a: unknown[]) => getWorkspaceSubscription(...a),
  getEffectivePlanId: (...a: unknown[]) => getEffectivePlanId(...a),
  getWorkspaceSeats: (...a: unknown[]) => getWorkspaceSeats(...a),
  changeSeats: (...a: unknown[]) => changeSeats(...a),
  listActivePlans: (...a: unknown[]) => listActivePlans(...a),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ role: 'owner' }),
}));

// confirm() backs the proration confirmation on the active-subscriber control.
vi.stubGlobal('confirm', vi.fn(() => true));

import CobrancaPage from '../CobrancaPage';

const AGENCY = {
  id: 'agency',
  name: 'Agency',
  price_brl: 17900,
  price_brl_annual: 179000,
  sort_order: 20,
  max_clients: 30,
  max_team_members: 5,
  storage_quota_bytes: null,
  feature_hub_portal: true,
  feature_analytics_reports: true,
  feature_brand_customization: true,
  included_seats: 5,
  seat_addon_brl: 2500,
  seat_addon_brl_annual: 25000,
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CobrancaPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CobrancaPage seats', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    startCheckout.mockReset().mockResolvedValue('https://checkout.stripe.com/x');
    openBillingPortal.mockReset();
    changeSeats.mockReset().mockResolvedValue(undefined);
    getWorkspaceSubscription.mockReset().mockResolvedValue(null);
    getEffectivePlanId.mockReset().mockResolvedValue(null);
    getWorkspaceSeats.mockReset().mockResolvedValue(null);
    listActivePlans.mockReset().mockResolvedValue([AGENCY]);
    (globalThis.confirm as ReturnType<typeof vi.fn>).mockReset?.();
    vi.stubGlobal('confirm', vi.fn(() => true));
    // jsdom: stub navigation used by handleUpgrade
    Object.defineProperty(window, 'location', {
      value: { assign: vi.fn() },
      writable: true,
    });
  });

  it('shows the "Tudo incluído" + clients + seats + add-on copy', async () => {
    renderPage();
    const card = await screen.findByText('Agency');
    const li = within(card.closest('.plan-card') as HTMLElement);
    expect(li.getByText('Tudo incluído')).toBeInTheDocument();
    expect(li.getByText('30 clientes')).toBeInTheDocument();
    expect(li.getByText('5 usuários incluídos')).toBeInTheDocument();
    expect(li.getByText(/\+R\$\s?25,00\/usuário extra/)).toBeInTheDocument();
  });

  it('renders the Recomendado badge on the agency tier', async () => {
    renderPage();
    expect(await screen.findByText('Recomendado')).toBeInTheDocument();
  });

  it('defaults the upgrade selector to included seats and increments add extra cost', async () => {
    renderPage();
    const selector = await screen.findByTestId('seat-selector');
    expect(within(selector).getByTestId('seat-count')).toHaveTextContent('5');
    fireEvent.click(within(selector).getByRole('button', { name: 'Adicionar assento' }));
    expect(within(selector).getByTestId('seat-count')).toHaveTextContent('6');
    // 1 extra × R$25 → breakdown shows the extra line and the new total
    expect(screen.getByTestId('seat-extra-cost')).toHaveTextContent('R$ 25,00');
    expect(screen.getByTestId('plan-total-cost')).toHaveTextContent('R$ 204,00');
  });

  it('does not let the upgrade selector drop below the included floor', async () => {
    renderPage();
    const selector = await screen.findByTestId('seat-selector');
    const minus = within(selector).getByRole('button', { name: 'Remover assento' });
    fireEvent.click(minus);
    expect(within(selector).getByTestId('seat-count')).toHaveTextContent('5');
  });

  it('passes extraSeats to startCheckout on upgrade', async () => {
    renderPage();
    const selector = await screen.findByTestId('seat-selector');
    fireEvent.click(within(selector).getByRole('button', { name: 'Adicionar assento' }));
    fireEvent.click(within(selector).getByRole('button', { name: 'Adicionar assento' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fazer upgrade' }));
    await waitFor(() => expect(startCheckout).toHaveBeenCalled());
    expect(startCheckout).toHaveBeenCalledWith('agency', 'month', undefined, 2);
  });

  it('active subscriber: seat control defaults to total seats and changeSeats(extra) on confirm', async () => {
    getWorkspaceSubscription.mockResolvedValue({
      status: 'active',
      plan_id: 'agency',
      current_period_end: '2026-12-01T00:00:00Z',
      cancel_at_period_end: false,
      seats: 2,
    });
    getEffectivePlanId.mockResolvedValue('agency');
    // included 5 + purchased 2 = 7 effective; 4 used
    getWorkspaceSeats.mockResolvedValue({ included: 5, purchased: 2, effective: 7, used: 4 });
    renderPage();
    const selector = await screen.findByTestId('active-seat-selector');
    // total seats = included 5 + purchased 2 = 7
    expect(within(selector).getByTestId('active-seat-count')).toHaveTextContent('7');
    // add one → extra beyond included = 2 (current purchased) + 1 = 3
    fireEvent.click(within(selector).getByRole('button', { name: 'Adicionar assento' }));
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar assentos' }));
    await waitFor(() => expect(changeSeats).toHaveBeenCalled());
    expect(changeSeats).toHaveBeenCalledWith(3);
  });

  it('active subscriber: floors the seat control at seats.used', async () => {
    getWorkspaceSubscription.mockResolvedValue({
      status: 'active',
      plan_id: 'agency',
      current_period_end: '2026-12-01T00:00:00Z',
      cancel_at_period_end: false,
      seats: 2,
    });
    getEffectivePlanId.mockResolvedValue('agency');
    // 6 seats in use against 7 effective → cannot drop below 6
    getWorkspaceSeats.mockResolvedValue({ included: 5, purchased: 2, effective: 7, used: 6 });
    renderPage();
    const selector = await screen.findByTestId('active-seat-selector');
    const minus = within(selector).getByRole('button', { name: 'Remover assento' });
    fireEvent.click(minus); // 7 → 6 (ok)
    fireEvent.click(minus); // 6 → clamped at used=6
    expect(within(selector).getByTestId('active-seat-count')).toHaveTextContent('6');
  });
});

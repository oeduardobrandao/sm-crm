import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/services/billing', () => ({
  listActivePlans: vi.fn(),
  getWorkspaceSubscription: vi.fn(),
  startCheckout: vi.fn(),
}));
vi.mock('@/lib/analytics', () => ({ captureEvent: vi.fn() }));

import { useAuth } from '@/context/AuthContext';
import { getWorkspaceSubscription, listActivePlans, startCheckout } from '@/services/billing';
import ComecarPage from '../ComecarPage';

const assign = vi.fn();

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    price_brl: 0,
    price_brl_annual: 0,
    sort_order: 0,
    max_clients: 1,
    max_team_members: 1,
    storage_quota_bytes: null,
    feature_hub_portal: false,
    feature_analytics_reports: false,
    feature_brand_customization: false,
  },
  {
    id: 'pro',
    name: 'Pro',
    price_brl: 9990,
    price_brl_annual: 95900,
    sort_order: 2,
    max_clients: 20,
    max_team_members: 3,
    storage_quota_bytes: null,
    feature_hub_portal: true,
    feature_analytics_reports: true,
    feature_brand_customization: true,
  },
];

const NEVER_SUBSCRIBED = {
  status: null,
  plan_id: null,
  current_period_end: null,
  cancel_at_period_end: false,
  past_due_since: null,
  next_payment_attempt: null,
  hasEverSubscribed: false,
};

beforeEach(() => {
  assign.mockReset();
  vi.stubGlobal('location', { ...window.location, assign });
  vi.mocked(useAuth).mockReturnValue({ role: 'owner', loading: false } as never);
  vi.mocked(listActivePlans).mockResolvedValue(PLANS as never);
  vi.mocked(getWorkspaceSubscription).mockResolvedValue(NEVER_SUBSCRIBED as never);
  vi.mocked(startCheckout).mockResolvedValue('https://checkout.stripe.com/abc');
});

function renderPage(search = '') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/comecar${search}`]}>
        <Routes>
          <Route path="/comecar" element={<ComecarPage />} />
          <Route path="/dashboard" element={<div>Painel</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ComecarPage', () => {
  it('redirects a non-owner to the dashboard', async () => {
    vi.mocked(useAuth).mockReturnValue({ role: 'agent', loading: false } as never);
    renderPage();
    expect(await screen.findByText('Painel')).toBeInTheDocument();
  });

  it('redirects a workspace that has subscribed before', async () => {
    vi.mocked(getWorkspaceSubscription).mockResolvedValue({
      ...NEVER_SUBSCRIBED,
      hasEverSubscribed: true,
    } as never);
    renderPage();
    expect(await screen.findByText('Painel')).toBeInTheDocument();
  });

  it('stays on the step after an abandoned checkout left a status-less row', async () => {
    renderPage();
    expect(await screen.findByText('Comece com 30 dias grátis')).toBeInTheDocument();
  });

  it('lists paid plans only, never Free', async () => {
    renderPage();
    expect(await screen.findByText('Pro')).toBeInTheDocument();
    expect(screen.queryByText('Free')).not.toBeInTheDocument();
  });

  it('starts checkout exactly once when the url carries an intent', async () => {
    renderPage('?plan=pro&interval=year');
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/abc'));
    expect(startCheckout).toHaveBeenCalledTimes(1);
    expect(startCheckout).toHaveBeenCalledWith('pro', 'year', 'onboarding');
  });

  it('falls back to the plan list when the intent checkout fails', async () => {
    vi.mocked(startCheckout).mockRejectedValue(new Error('Stripe indisponível'));
    renderPage('?plan=pro&interval=month');
    expect(await screen.findByText('Comece com 30 dias grátis')).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });

  it('ignores an intent naming a plan nobody can self-serve', async () => {
    renderPage('?plan=lifetime');
    expect(await screen.findByText('Comece com 30 dias grátis')).toBeInTheDocument();
    expect(startCheckout).not.toHaveBeenCalled();
  });
});

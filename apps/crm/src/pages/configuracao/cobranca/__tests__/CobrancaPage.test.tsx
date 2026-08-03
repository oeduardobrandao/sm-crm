import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/services/billing', () => ({
  listActivePlans: vi.fn(),
  getWorkspaceSubscription: vi.fn(),
  getEffectivePlanId: vi.fn(),
  startCheckout: vi.fn(),
  openBillingPortal: vi.fn(),
}));
vi.mock('@/lib/checkout-analytics', () => ({ captureCheckoutStarted: vi.fn() }));

import { useAuth } from '@/context/AuthContext';
import {
  listActivePlans,
  getWorkspaceSubscription,
  getEffectivePlanId,
  type BillingPlan,
  type WorkspaceSubscription,
} from '@/services/billing';
import CobrancaPage from '../CobrancaPage';

const PRO_PLAN: BillingPlan = {
  id: 'pro',
  name: 'Pro',
  price_brl: 9990,
  price_brl_annual: 99900,
  sort_order: 2,
  max_clients: null,
  max_team_members: null,
  storage_quota_bytes: null,
  feature_hub_portal: true,
  feature_analytics_reports: true,
  feature_brand_customization: true,
};

function subscription(overrides: Partial<WorkspaceSubscription>): WorkspaceSubscription {
  return {
    status: null,
    plan_id: null,
    current_period_end: null,
    cancel_at_period_end: false,
    past_due_since: null,
    next_payment_attempt: null,
    hasEverSubscribed: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(useAuth).mockReturnValue({ role: 'owner' } as never);
  vi.mocked(listActivePlans).mockResolvedValue([PRO_PLAN]);
  vi.mocked(getEffectivePlanId).mockResolvedValue('free');
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CobrancaPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const HINT = /Seus primeiros 30 dias são grátis/i;

describe('CobrancaPage', () => {
  it('shows "Começar teste de 30 dias" and the first-time hint for a workspace that never subscribed', async () => {
    // No active Stripe subscription and no subscription history at all: canUpgradeTo('pro',
    // 'free', hasActiveSub=false) is true, so the CTA renders and must read as a trial start.
    vi.mocked(getWorkspaceSubscription).mockResolvedValue(
      subscription({ hasEverSubscribed: false }),
    );
    renderPage();

    const cta = await screen.findByRole('button', { name: 'Começar teste de 30 dias' });
    expect(cta).toBeInTheDocument();
    expect(screen.getByText(HINT)).toBeInTheDocument();
  });

  it('shows "Fazer upgrade" and hides the first-time hint for a workspace that subscribed before', async () => {
    // hasEverSubscribed: true but status is 'canceled' (not active/trialing), so hasActiveSub
    // is false and canUpgradeTo still returns true — the CTA renders, just with the returning
    // subscriber's label instead of the trial one.
    vi.mocked(getWorkspaceSubscription).mockResolvedValue(
      subscription({ hasEverSubscribed: true, status: 'canceled', plan_id: 'free' }),
    );
    renderPage();

    const cta = await screen.findByRole('button', { name: 'Fazer upgrade' });
    expect(cta).toBeInTheDocument();
    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
  });
});

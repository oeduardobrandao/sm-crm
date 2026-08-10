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
// UsagePanel (rendered by CobrancaPage) reaches AuthContext via useContext directly, which the
// bare useAuth mock above doesn't provide. Mock its hooks the same way ProtectedRoute.test.tsx
// mocks useWorkspaceLimits, and keep it a no-op (isUnlimited) since these tests aren't about it.
vi.mock('@/hooks/useWorkspaceLimits', () => ({ useWorkspaceLimits: vi.fn() }));
vi.mock('@/hooks/useWorkspaceUsage', () => ({ useWorkspaceUsage: vi.fn() }));
vi.mock('@/hooks/useIsWorkspaceOwner', () => ({ useIsWorkspaceOwner: vi.fn() }));

import { useAuth } from '@/context/AuthContext';
import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';
import { useWorkspaceUsage } from '@/hooks/useWorkspaceUsage';
import { useIsWorkspaceOwner } from '@/hooks/useIsWorkspaceOwner';
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
  // workspaceRole is what the page actually gates on: it falls back to the
  // profile-level role only while membership is unresolved. Both are set here
  // so these tests exercise the resolved owner path, not the fallback.
  vi.mocked(useAuth).mockReturnValue({ role: 'owner', workspaceRole: 'owner' } as never);
  vi.mocked(listActivePlans).mockResolvedValue([PRO_PLAN]);
  vi.mocked(getEffectivePlanId).mockResolvedValue('free');
  // UsagePanel is covered by its own test suite; keep it a no-op here (isUnlimited: true).
  vi.mocked(useWorkspaceLimits).mockReturnValue({
    limits: null,
    planName: null,
    isLoading: false,
    isUnlimited: true,
  } as never);
  vi.mocked(useWorkspaceUsage).mockReturnValue({ usage: null, isLoading: false, isError: false });
  vi.mocked(useIsWorkspaceOwner).mockReturnValue(true);
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

  it('locks the page for an agent in the active workspace whose profile role is still owner', async () => {
    // The stale-role case: profiles.role is a GLOBAL role that switch_workspace never
    // rewrites, so an owner of workspace A who is only an agent in the active workspace B
    // keeps role === 'owner'. The page must follow workspaceRole (workspace_members for the
    // ACTIVE workspace), which is what the workspace_subscriptions RLS policy and
    // billing-checkout/billing-portal both authorize on.
    //
    // This is the only test in CI that can distinguish the current gate from the bare
    // `role === 'owner'` it replaced: revert CobrancaPage to `role` and this one fails while
    // the two above still pass. Do not "fix" it by setting workspaceRole to 'owner'.
    vi.mocked(useAuth).mockReturnValue({ role: 'owner', workspaceRole: 'agent' } as never);
    vi.mocked(getWorkspaceSubscription).mockResolvedValue(
      subscription({ hasEverSubscribed: false }),
    );
    renderPage();

    expect(
      await screen.findByText('Apenas o proprietário da conta pode gerenciar a assinatura.'),
    ).toBeInTheDocument();
    // The whole plan grid is gone, not merely the CTA: the notice returns early.
    expect(
      screen.queryByRole('button', { name: 'Começar teste de 30 dias' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fazer upgrade' })).not.toBeInTheDocument();
    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
  });
});

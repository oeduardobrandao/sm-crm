import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/context/AuthContext', () => ({ useAuth: vi.fn() }));
// importOriginal keeps BillingApiError and the Pagar.me checkout/update-card calls real:
// PagarmeCheckoutDialog (mounted by CobrancaPage) imports them from this same module, and
// these tests never submit its form, so nothing here needs a dedicated mock for them.
vi.mock('@/services/billing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/billing')>();
  return {
    ...actual,
    listActivePlans: vi.fn(),
    getWorkspaceSubscription: vi.fn(),
    getEffectivePlanId: vi.fn(),
    startCheckout: vi.fn(),
    openBillingPortal: vi.fn(),
    cancelPagarmeSubscription: vi.fn(),
  };
});
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
  startCheckout,
  cancelPagarmeSubscription,
  type BillingPlan,
  type WorkspaceSubscription,
} from '@/services/billing';
import { captureCheckoutStarted } from '@/lib/checkout-analytics';
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
  pagarme_12x_enabled: false,
};

const PRO_PLAN_PAGARME: BillingPlan = { ...PRO_PLAN, pagarme_12x_enabled: true };

function subscription(overrides: Partial<WorkspaceSubscription>): WorkspaceSubscription {
  return {
    status: null,
    plan_id: null,
    current_period_end: null,
    cancel_at_period_end: false,
    past_due_since: null,
    next_payment_attempt: null,
    provider: null,
    installments: null,
    hasEverSubscribed: false,
    ...overrides,
  };
}

const assign = vi.fn();

beforeEach(() => {
  // workspaceRole is what the page actually gates on: it falls back to the
  // profile-level role only while membership is unresolved. Both are set here
  // so these tests exercise the resolved owner path, not the fallback.
  vi.mocked(useAuth).mockReturnValue({ role: 'owner', workspaceRole: 'owner' } as never);
  vi.mocked(listActivePlans).mockResolvedValue([PRO_PLAN]);
  vi.mocked(getEffectivePlanId).mockResolvedValue('free');
  vi.mocked(startCheckout).mockResolvedValue('https://checkout.stripe.com/abc');
  // UsagePanel is covered by its own test suite; keep it a no-op here (isUnlimited: true).
  vi.mocked(useWorkspaceLimits).mockReturnValue({
    limits: null,
    planName: null,
    isLoading: false,
    isUnlimited: true,
  } as never);
  vi.mocked(useWorkspaceUsage).mockReturnValue({ usage: null, isLoading: false, isError: false });
  vi.mocked(useIsWorkspaceOwner).mockReturnValue(true);
  assign.mockReset();
  vi.stubGlobal('location', { ...window.location, assign });
});

afterEach(() => {
  vi.unstubAllEnvs();
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

  describe('Pagar.me 12x', () => {
    it('gate ON: a year upgrade opens the checkout dialog instead of calling startCheckout', async () => {
      vi.stubEnv('VITE_PAGARME_PUBLIC_KEY', 'pk_test_abc');
      vi.mocked(listActivePlans).mockResolvedValue([PRO_PLAN_PAGARME]);
      vi.mocked(getWorkspaceSubscription).mockResolvedValue(
        subscription({ hasEverSubscribed: false }),
      );
      renderPage();

      fireEvent.click(await screen.findByRole('button', { name: 'Anual' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Começar teste de 30 dias' }));

      expect(await screen.findByText('Assinar o plano Pro')).toBeInTheDocument();
      expect(startCheckout).not.toHaveBeenCalled();
      expect(captureCheckoutStarted).toHaveBeenCalledWith('pro', 'year', 'billing', 'pagarme');
    });

    it('gate OFF: a year upgrade still calls startCheckout and never opens the dialog', async () => {
      // Env key present but the plan's own admin flag is off: the gate needs both.
      vi.stubEnv('VITE_PAGARME_PUBLIC_KEY', 'pk_test_abc');
      vi.mocked(listActivePlans).mockResolvedValue([PRO_PLAN]);
      vi.mocked(getWorkspaceSubscription).mockResolvedValue(
        subscription({ hasEverSubscribed: false }),
      );
      renderPage();

      fireEvent.click(await screen.findByRole('button', { name: 'Anual' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Começar teste de 30 dias' }));

      await waitFor(() => expect(startCheckout).toHaveBeenCalledWith('pro', 'year', 'billing'));
      expect(screen.queryByText('Assinar o plano Pro')).not.toBeInTheDocument();
    });

    it('shows "em 12x de" only when gated on, "cobrado anualmente," otherwise', async () => {
      vi.mocked(getWorkspaceSubscription).mockResolvedValue(
        subscription({ hasEverSubscribed: false }),
      );

      // Gate off: today's Stripe-annual copy correction.
      vi.mocked(listActivePlans).mockResolvedValue([PRO_PLAN]);
      const { unmount } = renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Anual' }));
      expect(await screen.findByText('cobrado anualmente,')).toBeInTheDocument();
      expect(screen.queryByText('em 12x de')).not.toBeInTheDocument();
      unmount();

      // Gate on: the 12x lead.
      vi.stubEnv('VITE_PAGARME_PUBLIC_KEY', 'pk_test_abc');
      vi.mocked(listActivePlans).mockResolvedValue([PRO_PLAN_PAGARME]);
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Anual' }));
      expect(await screen.findByText('em 12x de')).toBeInTheDocument();
      expect(screen.queryByText('cobrado anualmente,')).not.toBeInTheDocument();
    });

    it('a pagarme subscriber sees "Atualizar cartão" / "Cancelar assinatura", never "Gerenciar assinatura"', async () => {
      vi.mocked(getWorkspaceSubscription).mockResolvedValue(
        subscription({
          status: 'active',
          provider: 'pagarme',
          plan_id: 'pro',
          hasEverSubscribed: true,
        }),
      );
      renderPage();

      expect(await screen.findByRole('button', { name: 'Atualizar cartão' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cancelar assinatura' })).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Gerenciar assinatura' }),
      ).not.toBeInTheDocument();
    });

    it('a pagarme past_due subscriber also sees the manage controls plus the warning line', async () => {
      // The dunning-recovery case: a new checkout is 409-blocked while past_due, so
      // update-card must stay reachable, and the warning explains why the card is needed.
      vi.mocked(getWorkspaceSubscription).mockResolvedValue(
        subscription({
          status: 'past_due',
          provider: 'pagarme',
          plan_id: 'pro',
          hasEverSubscribed: true,
        }),
      );
      renderPage();

      expect(await screen.findByRole('button', { name: 'Atualizar cartão' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cancelar assinatura' })).toBeInTheDocument();
      expect(
        screen.getByText(
          'Não conseguimos cobrar seu cartão. Atualize os dados para manter o acesso.',
        ),
      ).toBeInTheDocument();
    });

    it('a stripe subscriber never gains the pagarme-specific controls, including in past_due/unpaid', async () => {
      vi.mocked(getWorkspaceSubscription).mockResolvedValue(
        subscription({
          status: 'active',
          provider: 'stripe',
          plan_id: 'pro',
          hasEverSubscribed: true,
        }),
      );
      const { unmount } = renderPage();
      expect(
        await screen.findByRole('button', { name: 'Gerenciar assinatura' }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Atualizar cartão' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Cancelar assinatura' })).not.toBeInTheDocument();
      // Active carries no dunning warning — only past_due/unpaid do.
      expect(
        screen.queryByText(
          'Não conseguimos cobrar seu cartão. Atualize os dados para manter o acesso.',
        ),
      ).not.toBeInTheDocument();
      unmount();

      vi.mocked(getWorkspaceSubscription).mockResolvedValue(
        subscription({
          status: 'past_due',
          provider: 'stripe',
          plan_id: 'pro',
          hasEverSubscribed: true,
        }),
      );
      const { unmount: unmount2 } = renderPage();
      // Wait for the manage card to settle before asserting on absence, so this isn't just
      // catching the pre-load state.
      await screen.findByRole('button', { name: 'Gerenciar assinatura' });
      expect(screen.queryByRole('button', { name: 'Atualizar cartão' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Cancelar assinatura' })).not.toBeInTheDocument();
      unmount2();

      vi.mocked(getWorkspaceSubscription).mockResolvedValue(
        subscription({
          status: 'unpaid',
          provider: 'stripe',
          plan_id: 'pro',
          hasEverSubscribed: true,
        }),
      );
      renderPage();
      await screen.findByRole('button', { name: 'Gerenciar assinatura' });
      expect(screen.queryByRole('button', { name: 'Atualizar cartão' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Cancelar assinatura' })).not.toBeInTheDocument();
    });

    it('a stripe past_due subscriber sees the Billing Portal button plus the dunning warning', async () => {
      // The Portal accepts any row with a stripe_customer_id and IS the Stripe recovery path
      // (update card / cancel), so the manage card — and its "Gerenciar assinatura" entry
      // point — must render even though hasActiveSub is false for past_due. Upgrade CTAs on
      // the plan grid stay suppressed (checkoutBlocked, provider-agnostic).
      vi.mocked(getWorkspaceSubscription).mockResolvedValue(
        subscription({
          status: 'past_due',
          provider: 'stripe',
          plan_id: 'pro',
          hasEverSubscribed: true,
        }),
      );
      renderPage();

      expect(
        await screen.findByRole('button', { name: 'Gerenciar assinatura' }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          'Não conseguimos cobrar seu cartão. Atualize os dados para manter o acesso.',
        ),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Fazer upgrade' })).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Começar teste de 30 dias' }),
      ).not.toBeInTheDocument();
    });

    it('a stripe unpaid subscriber sees the same Billing Portal recovery affordance as past_due', async () => {
      vi.mocked(getWorkspaceSubscription).mockResolvedValue(
        subscription({
          status: 'unpaid',
          provider: 'stripe',
          plan_id: 'pro',
          hasEverSubscribed: true,
        }),
      );
      renderPage();

      expect(
        await screen.findByRole('button', { name: 'Gerenciar assinatura' }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          'Não conseguimos cobrar seu cartão. Atualize os dados para manter o acesso.',
        ),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Fazer upgrade' })).not.toBeInTheDocument();
    });

    it('a pagarme past_due subscriber sees the blocked-checkout note instead of an upgrade CTA', async () => {
      // The 409-avoidance case: past_due is not active/trialing, so hasActiveSub is false and
      // canUpgradeTo alone would still offer "Fazer upgrade" on the Pro card — but the backend's
      // pagarmeCheckoutBlocked gate 409s a new checkout while in-force, so the note must show
      // instead, and no upgrade CTA of any kind should render anywhere on the grid.
      vi.mocked(getWorkspaceSubscription).mockResolvedValue(
        subscription({
          status: 'past_due',
          provider: 'pagarme',
          plan_id: 'pro',
          hasEverSubscribed: true,
        }),
      );
      renderPage();

      expect(
        await screen.findByText('Cancele ou aguarde o fim do período atual para trocar de plano.'),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Fazer upgrade' })).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Começar teste de 30 dias' }),
      ).not.toBeInTheDocument();
    });

    it('a canceled-but-paid-through row sees the blocked-checkout note instead of an upgrade CTA', async () => {
      // status: canceled with cancel_at_period_end + a future current_period_end: still paid
      // through the period (e.g. a 12x subscriber who canceled after the year was fully
      // charged). Same 409-avoidance as past_due, on either provider.
      vi.mocked(getWorkspaceSubscription).mockResolvedValue(
        subscription({
          status: 'canceled',
          provider: 'pagarme',
          plan_id: 'pro',
          cancel_at_period_end: true,
          current_period_end: '2099-01-01T00:00:00.000Z',
          hasEverSubscribed: true,
        }),
      );
      renderPage();

      expect(
        await screen.findByText('Cancele ou aguarde o fim do período atual para trocar de plano.'),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Fazer upgrade' })).not.toBeInTheDocument();
    });

    it('a canceled row WITHOUT paid-through access keeps the normal re-subscribe CTA', async () => {
      // cancel_at_period_end is false (or current_period_end already passed): the workspace
      // has no remaining paid access, so re-subscribing must stay reachable, not blocked.
      vi.mocked(getWorkspaceSubscription).mockResolvedValue(
        subscription({
          status: 'canceled',
          provider: 'pagarme',
          plan_id: 'pro',
          cancel_at_period_end: false,
          hasEverSubscribed: true,
        }),
      );
      renderPage();

      expect(await screen.findByRole('button', { name: 'Fazer upgrade' })).toBeInTheDocument();
      expect(
        screen.queryByText('Cancele ou aguarde o fim do período atual para trocar de plano.'),
      ).not.toBeInTheDocument();
    });

    it('confirming the cancel dialog calls cancelPagarmeSubscription', async () => {
      vi.mocked(getWorkspaceSubscription).mockResolvedValue(
        subscription({
          status: 'active',
          provider: 'pagarme',
          plan_id: 'pro',
          hasEverSubscribed: true,
        }),
      );
      vi.mocked(cancelPagarmeSubscription).mockResolvedValue({
        status: 'canceled',
        access_until: null,
      });
      renderPage();

      fireEvent.click(await screen.findByRole('button', { name: 'Cancelar assinatura' }));
      const confirmBtn = await screen.findByRole('button', { name: 'Sim, cancelar assinatura' });
      fireEvent.click(confirmBtn);

      await waitFor(() => expect(cancelPagarmeSubscription).toHaveBeenCalledTimes(1));
      // Success closes the dialog.
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    });

    it('keeps the cancel dialog open while the request is pending, closing only once it resolves', async () => {
      // Reviewer's probe scenario: AlertDialogAction is Radix's DialogPrimitive.Close under the
      // hood, so without preventDefault the dialog closes synchronously on click, before this
      // promise ever settles. A controlled, deliberate close is the only thing that should be
      // able to dismiss it while a cancel is in flight.
      vi.mocked(getWorkspaceSubscription).mockResolvedValue(
        subscription({
          status: 'active',
          provider: 'pagarme',
          plan_id: 'pro',
          hasEverSubscribed: true,
        }),
      );
      let resolveCancel: (v: { status: string; access_until: string | null }) => void = () => {};
      vi.mocked(cancelPagarmeSubscription).mockReturnValue(
        new Promise((resolve) => {
          resolveCancel = resolve;
        }),
      );
      renderPage();

      fireEvent.click(await screen.findByRole('button', { name: 'Cancelar assinatura' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Sim, cancelar assinatura' }));

      // Still pending: the dialog is still on screen, showing the busy state.
      expect(await screen.findByRole('button', { name: 'Cancelando…' })).toBeInTheDocument();
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();

      resolveCancel({ status: 'canceled', access_until: null });

      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    });

    it('keeps the cancel dialog open and re-enables the button when the cancel request fails', async () => {
      vi.mocked(getWorkspaceSubscription).mockResolvedValue(
        subscription({
          status: 'active',
          provider: 'pagarme',
          plan_id: 'pro',
          hasEverSubscribed: true,
        }),
      );
      vi.mocked(cancelPagarmeSubscription).mockRejectedValue(new Error('Falha ao cancelar'));
      renderPage();

      fireEvent.click(await screen.findByRole('button', { name: 'Cancelar assinatura' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Sim, cancelar assinatura' }));

      await waitFor(() => expect(cancelPagarmeSubscription).toHaveBeenCalledTimes(1));

      // A failed cancel is not a dead end: the dialog is still open with a usable retry button,
      // not just a toast the user could miss.
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
      const retryBtn = await screen.findByRole('button', { name: 'Sim, cancelar assinatura' });
      expect(retryBtn).toBeEnabled();
    });

    it('falls back to the no-date cancel description, without crashing, when current_period_end is malformed', async () => {
      vi.mocked(getWorkspaceSubscription).mockResolvedValue(
        subscription({
          status: 'active',
          provider: 'pagarme',
          plan_id: 'pro',
          hasEverSubscribed: true,
          current_period_end: 'not-a-real-date',
        }),
      );
      renderPage();

      fireEvent.click(await screen.findByRole('button', { name: 'Cancelar assinatura' }));
      expect(await screen.findByText('Sua assinatura será cancelada.')).toBeInTheDocument();
    });

    it('renders a pagarme current_period_end as the UTC calendar date, not shifted by local timezone', async () => {
      // Pagar.me returns current_period_end as a midnight-UTC calendar-date boundary (the same
      // hazard formatUtcDateBR exists for in PagarmeCheckoutDialog's trial_ends_at). Formatting
      // it through the browser's local timezone would print 11/09/2026 in Brazil (UTC-3); both
      // the renewal meta line and the cancel-dialog description must read 12/09/2026.
      vi.mocked(getWorkspaceSubscription).mockResolvedValue(
        subscription({
          status: 'active',
          provider: 'pagarme',
          plan_id: 'pro',
          hasEverSubscribed: true,
          current_period_end: '2026-09-12T00:00:00.000Z',
        }),
      );
      renderPage();

      expect(
        await screen.findByText((_content, node) => node?.textContent === 'Renova em 12/09/2026'),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Cancelar assinatura' }));
      expect(
        await screen.findByText(
          'Seu acesso continua até 12/09/2026. Depois disso, o workspace volta ao plano gratuito.',
        ),
      ).toBeInTheDocument();
    });
  });
});

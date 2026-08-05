import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/services/billing', () => ({
  listActivePlans: vi.fn(),
  getWorkspaceSubscription: vi.fn(),
  getEffectivePlanId: vi.fn(),
  startCheckout: vi.fn(),
}));
vi.mock('@/lib/analytics', () => ({ captureEvent: vi.fn() }));
vi.mock('@/components/support/WhatsAppSupportButton', () => ({
  WhatsAppSupportButton: ({ label, className }: { label: string; className?: string }) => (
    <a href="https://wa.me/" className={className}>
      {label}
    </a>
  ),
}));

import { useAuth } from '@/context/AuthContext';
import {
  getEffectivePlanId,
  getWorkspaceSubscription,
  listActivePlans,
  startCheckout,
} from '@/services/billing';
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
  // A brand-new workspace has workspaces.plan_id = NULL; it resolves to 'free'.
  vi.mocked(getEffectivePlanId).mockResolvedValue(null);
  vi.mocked(startCheckout).mockResolvedValue('https://checkout.stripe.com/abc');
});

function renderPage(search = '') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/comecar${search}`]}>
        <Routes>
          <Route path="/comecar" element={<ComecarPage />} />
          <Route path="/dashboard" element={<div>Painel</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, client };
}

async function renderPageWithEnv(whatsAppNumber: string | undefined) {
  // The whatsapp module reads import.meta.env at module scope, so we must reset
  // and dynamically import to test different env values.
  vi.resetModules();
  vi.stubEnv('VITE_WHATSAPP_SUPPORT_NUMBER', whatsAppNumber ?? '');

  // Re-mock after module reset
  vi.doMock('@/context/AuthContext', () => ({ useAuth: vi.fn() }));
  vi.doMock('@/services/billing', () => ({
    listActivePlans: vi.fn(),
    getWorkspaceSubscription: vi.fn(),
    getEffectivePlanId: vi.fn(),
    startCheckout: vi.fn(),
  }));
  vi.doMock('@/lib/analytics', () => ({ captureEvent: vi.fn() }));
  vi.doMock('@/components/support/WhatsAppSupportButton', () => ({
    WhatsAppSupportButton: ({ label, className }: { label: string; className?: string }) => (
      <a href="https://wa.me/" className={className}>
        {label}
      </a>
    ),
  }));

  // Dynamically import to get fresh module with new env
  const { useAuth: useAuthDynamic } = await import('@/context/AuthContext');
  const {
    listActivePlans: listActivePlansDynamic,
    getWorkspaceSubscription: getWorkspaceSubscriptionDynamic,
    getEffectivePlanId: getEffectivePlanIdDynamic,
    startCheckout: startCheckoutDynamic,
  } = await import('@/services/billing');
  const { default: ComecarPageDynamic } = await import('../ComecarPage');

  vi.mocked(useAuthDynamic).mockReturnValue({ role: 'owner', loading: false } as never);
  vi.mocked(listActivePlansDynamic).mockResolvedValue(PLANS as never);
  vi.mocked(getWorkspaceSubscriptionDynamic).mockResolvedValue(NEVER_SUBSCRIBED as never);
  vi.mocked(getEffectivePlanIdDynamic).mockResolvedValue(null);
  vi.mocked(startCheckoutDynamic).mockResolvedValue('https://checkout.stripe.com/abc');

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/comecar']}>
        <Routes>
          <Route path="/comecar" element={<ComecarPageDynamic />} />
          <Route path="/dashboard" element={<div>Painel</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return result;
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

  // A comp/internal plan (Lifetime) has no Stripe subscription, so
  // hasEverSubscribed is false and the trial guard alone lets it through. The
  // effective plan id is what catches it — the same invariant canUpgradeTo
  // enforces on Plano e Cobrança.
  it('redirects a workspace on a comp/internal plan', async () => {
    vi.mocked(getEffectivePlanId).mockResolvedValue('lifetime');
    renderPage();
    expect(await screen.findByText('Painel')).toBeInTheDocument();
    expect(startCheckout).not.toHaveBeenCalled();
  });

  it('does not auto-start checkout for a comp/internal plan carrying an intent', async () => {
    vi.mocked(getEffectivePlanId).mockResolvedValue('lifetime');
    renderPage('?plan=pro&interval=month');
    expect(await screen.findByText('Painel')).toBeInTheDocument();
    expect(startCheckout).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it('redirects a workspace already on a paid plan', async () => {
    vi.mocked(getEffectivePlanId).mockResolvedValue('pro');
    renderPage();
    expect(await screen.findByText('Painel')).toBeInTheDocument();
    expect(startCheckout).not.toHaveBeenCalled();
  });

  it('shows the step when workspaceRole is owner despite a stale profile-level agent role', async () => {
    vi.mocked(useAuth).mockReturnValue({
      role: 'agent',
      workspaceRole: 'owner',
      loading: false,
    } as never);
    renderPage();
    expect(await screen.findByText('Comece com 30 dias grátis')).toBeInTheDocument();
  });

  it('redirects when workspaceRole is agent despite a stale profile-level owner role', async () => {
    vi.mocked(useAuth).mockReturnValue({
      role: 'owner',
      workspaceRole: 'agent',
      loading: false,
    } as never);
    renderPage();
    expect(await screen.findByText('Painel')).toBeInTheDocument();
  });

  it('disables the CTA for a plan with no price on the selected interval', async () => {
    vi.mocked(listActivePlans).mockResolvedValue([
      { ...PLANS[1], price_brl_annual: null },
    ] as never);
    renderPage();

    const monthly = await screen.findByRole('button', { name: 'Começar teste' });
    expect(monthly).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Anual' }));

    await waitFor(() => expect(screen.getByText(/Sob consulta/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Começar teste' })).toBeDisabled();
    expect(startCheckout).not.toHaveBeenCalled();
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

  it('does not start a second checkout when the subscription query re-settles after the first attempt', async () => {
    // Regression coverage for the `autoStarted` latch: force the subscription
    // query back through a loading state (as a background reset or refocus
    // refetch would) with the same eventual data. `eligible` flips
    // false -> true a second time even though the intent never changed. The
    // effect's dependency array sees that transition and would re-run the
    // checkout callback if the ref latch were removed - without it, this
    // scenario opens a second Stripe Checkout session.
    const { client } = renderPage('?plan=pro&interval=year');
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(startCheckout).toHaveBeenCalledTimes(1);

    await client.resetQueries({ queryKey: ['billing', 'subscription'] });
    await waitFor(() => expect(vi.mocked(getWorkspaceSubscription)).toHaveBeenCalledTimes(2));

    expect(startCheckout).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledTimes(1);
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

  it('disables every plan CTA, not just the clicked one, while a checkout is in flight', async () => {
    // Two selectable paid plans, so clicking one leaves a second live button
    // to assert against - the bug was that only the clicked card's button
    // disabled, letting a second card start a concurrent Stripe session.
    const TWO_PAID_PLANS = [
      PLANS[1],
      { ...PLANS[1], id: 'max', name: 'Max', price_brl: 19990, price_brl_annual: 191900 },
    ];
    vi.mocked(listActivePlans).mockResolvedValue(TWO_PAID_PLANS as never);
    let resolveCheckout: (url: string) => void = () => {};
    vi.mocked(startCheckout).mockReturnValue(
      new Promise((resolve) => {
        resolveCheckout = resolve;
      }),
    );
    renderPage();

    const buttons = await screen.findAllByRole('button', { name: 'Começar teste' });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0]);

    await waitFor(() => {
      const all = screen.getAllByRole('button', { name: /Começar teste|Aguarde/ });
      expect(all).toHaveLength(2);
      for (const btn of all) expect(btn).toBeDisabled();
    });
    expect(startCheckout).toHaveBeenCalledTimes(1);

    resolveCheckout('https://checkout.stripe.com/abc');
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/abc'));
  });

  it('renders an error state and does not start checkout when the subscription query fails', async () => {
    vi.mocked(getWorkspaceSubscription).mockRejectedValue(new Error('network error'));
    renderPage();
    expect(await screen.findByText('Não foi possível carregar seu plano')).toBeInTheDocument();
    expect(screen.queryByText('Comece com 30 dias grátis')).not.toBeInTheDocument();
    expect(startCheckout).not.toHaveBeenCalled();
  });

  it('does not auto-start checkout when the subscription query fails, even with an intent in the url', async () => {
    vi.mocked(getWorkspaceSubscription).mockRejectedValue(new Error('network error'));
    renderPage('?plan=pro&interval=year');
    expect(await screen.findByText('Não foi possível carregar seu plano')).toBeInTheDocument();
    expect(startCheckout).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it('retries both queries from the error state', async () => {
    vi.mocked(getWorkspaceSubscription).mockRejectedValueOnce(new Error('network error'));
    renderPage();
    const retryButton = await screen.findByRole('button', { name: 'Tentar novamente' });

    vi.mocked(getWorkspaceSubscription).mockResolvedValue(NEVER_SUBSCRIBED as never);
    fireEvent.click(retryButton);

    expect(await screen.findByText('Comece com 30 dias grátis')).toBeInTheDocument();
  });

  it('does not render the WhatsApp support section when support is not configured', async () => {
    // By default, VITE_WHATSAPP_SUPPORT_NUMBER is unset, so isWhatsAppSupportEnabled() returns false
    renderPage();
    await screen.findByText('Comece com 30 dias grátis');
    expect(screen.queryByText('Fale com a gente no WhatsApp')).not.toBeInTheDocument();
    expect(screen.queryByText('Prefere falar com uma pessoa?')).not.toBeInTheDocument();
  });

  it('renders the WhatsApp support link when VITE_WHATSAPP_SUPPORT_NUMBER is set to a valid digits-only value', async () => {
    await renderPageWithEnv('5511999999999');
    expect(await screen.findByText('Fale com a gente no WhatsApp')).toBeInTheDocument();
    expect(screen.getByText('Prefere falar com uma pessoa?')).toBeInTheDocument();
    vi.unstubAllEnvs();
  });

  it('does not render the WhatsApp support section when VITE_WHATSAPP_SUPPORT_NUMBER is an empty string', async () => {
    await renderPageWithEnv('');
    await screen.findByText('Comece com 30 dias grátis');
    expect(screen.queryByText('Fale com a gente no WhatsApp')).not.toBeInTheDocument();
    expect(screen.queryByText('Prefere falar com uma pessoa?')).not.toBeInTheDocument();
    vi.unstubAllEnvs();
  });
});

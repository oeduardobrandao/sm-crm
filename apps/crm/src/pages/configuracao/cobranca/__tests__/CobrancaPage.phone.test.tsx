import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Phone branch: jsdom's matchMedia already reports false, made explicit here.
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => false }));
vi.mock('@/components/layout/PhoneShellHeader', () => ({
  PhoneShellActions: () => <div data-testid="shell-actions" />,
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/services/billing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/billing')>();
  return {
    ...actual,
    listActivePlans: vi.fn(),
    getWorkspaceSubscription: vi.fn(),
    getEffectivePlanWithSource: vi.fn(),
    startCheckout: vi.fn(),
    openBillingPortal: vi.fn(),
    cancelPagarmeSubscription: vi.fn(),
  };
});
vi.mock('@/lib/checkout-analytics', () => ({ captureCheckoutStarted: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useWorkspaceLimits', () => ({ useWorkspaceLimits: vi.fn() }));
vi.mock('@/hooks/useWorkspaceUsage', () => ({ useWorkspaceUsage: vi.fn() }));
vi.mock('@/hooks/useIsWorkspaceOwner', () => ({ useIsWorkspaceOwner: vi.fn() }));

import { useAuth } from '@/context/AuthContext';
import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';
import { useWorkspaceUsage } from '@/hooks/useWorkspaceUsage';
import { useIsWorkspaceOwner } from '@/hooks/useIsWorkspaceOwner';
import { toast } from 'sonner';
import {
  listActivePlans,
  getWorkspaceSubscription,
  getEffectivePlanWithSource,
  startCheckout,
  openBillingPortal,
  cancelPagarmeSubscription,
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
  max_hub_tokens: null,
  rate_report_generations_per_month: null,
  pagarme_12x_enabled: false,
  pagarme_installment_cents: null,
};

const STARTER_PLAN: BillingPlan = {
  ...PRO_PLAN,
  id: 'starter',
  name: 'Starter',
  price_brl: 4990,
  price_brl_annual: 49900,
  sort_order: 1,
  max_clients: 5,
};

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
    billingInterval: null,
    switchScheduled: false,
    hasEverSubscribed: false,
    ...overrides,
  };
}

const PAGARME_ACTIVE = subscription({
  status: 'active',
  provider: 'pagarme',
  plan_id: 'pro',
  installments: 12,
  hasEverSubscribed: true,
  current_period_end: '2026-09-16T00:00:00Z',
});

const assign = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue({ role: 'owner', workspaceRole: 'owner' } as never);
  vi.mocked(listActivePlans).mockResolvedValue([STARTER_PLAN, PRO_PLAN]);
  vi.mocked(getEffectivePlanWithSource).mockResolvedValue({
    planId: 'free',
    planSource: 'system',
    wasDemo: false,
  });
  vi.mocked(startCheckout).mockResolvedValue('https://checkout.stripe.com/abc');
  vi.mocked(useWorkspaceLimits).mockReturnValue({
    limits: null,
    planName: null,
    isLoading: false,
    isUnlimited: true,
  } as never);
  vi.mocked(useWorkspaceUsage).mockReturnValue({ usage: null, isLoading: false, isError: false });
  vi.mocked(useIsWorkspaceOwner).mockReturnValue(true);
  vi.stubGlobal('location', { ...window.location, assign });
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

describe('CobrancaPage (phone)', () => {
  it('shows the demo note and "Assinar" on the current plan for a demo workspace', async () => {
    vi.mocked(getEffectivePlanWithSource).mockResolvedValue({
      planId: 'pro',
      planSource: 'demo',
      wasDemo: true,
    });
    vi.mocked(getWorkspaceSubscription).mockResolvedValue(subscription({}));
    renderPage();

    expect(
      await screen.findByText(
        'Conta demo: você está usando o plano Pro sem custo. Para continuar depois, é só assinar um plano.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assinar' })).toBeInTheDocument();
    expect(screen.queryByText(/Seus primeiros 30 dias/)).toBeNull();
  });

  it('renders the nav bar, the title and the plan cards in the phone column, without the desktop toggle', async () => {
    vi.mocked(getWorkspaceSubscription).mockResolvedValue(subscription({}));
    const { container } = renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Plano & Cobrança' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Voltar para Configurações' })).toBeInTheDocument();
    await screen.findByText('Starter');
    expect(container.querySelector('.phone-cobranca-plans .plan-grid')).not.toBeNull();
    expect(container.querySelectorAll('.phone-cobranca-plans .plan-card')).toHaveLength(2);
    expect(container.querySelector('.billing-toggle')).toBeNull();
    // Never subscribed: no "Seu plano" group, the trial hint is visible text.
    expect(screen.queryByRole('heading', { name: 'Seu plano' })).not.toBeInTheDocument();
    expect(screen.getByText('Seus primeiros 30 dias são grátis')).toBeInTheDocument();
  });

  it('the Mensal / Anual segmented control drives the same interval state, with the savings hint visible', async () => {
    vi.mocked(getWorkspaceSubscription).mockResolvedValue(subscription({}));
    renderPage();
    await screen.findByText('Starter');

    const group = screen.getByRole('radiogroup', { name: 'Período de cobrança' });
    const mensal = within(group).getByRole('radio', { name: 'Mensal' });
    const anual = within(group).getByRole('radio', { name: 'Anual' });
    expect(mensal).toHaveAttribute('aria-checked', 'true');
    // Pro: 1 - 99900 / (9990 * 12) = 17%.
    expect(screen.getByText('Economize até 17% no anual')).toBeInTheDocument();
    expect(screen.getAllByText('/mês').length).toBeGreaterThan(0);

    fireEvent.click(anual);
    expect(anual).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByText('/mês')).not.toBeInTheDocument();
    expect(screen.getAllByText('cobrado anualmente,').length).toBe(2);

    // The plan CTA still goes through the same Stripe upgrade path, at the chosen interval.
    fireEvent.click(screen.getAllByRole('button', { name: 'Começar teste de 30 dias' })[1]);
    await waitFor(() => expect(startCheckout).toHaveBeenCalledWith('pro', 'year', 'billing'));
  });

  it('a pagarme subscriber sees "Seu plano" as value rows plus Atualizar cartão and Cancelar assinatura', async () => {
    vi.mocked(getEffectivePlanWithSource).mockResolvedValue({
      planId: 'pro',
      planSource: 'pagarme',
      wasDemo: false,
    });
    vi.mocked(getWorkspaceSubscription).mockResolvedValue(PAGARME_ACTIVE);
    renderPage();

    const group = (await screen.findByRole('heading', { name: 'Seu plano' })).closest('section')!;
    expect(within(group).getByText('Plano')).toBeInTheDocument();
    expect(within(group).getByText('Pro')).toBeInTheDocument();
    expect(within(group).getByText('Ativo')).toBeInTheDocument();
    expect(within(group).getByText('Renova em')).toBeInTheDocument();
    expect(within(group).getByText('16/09/2026')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Atualizar cartão' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar assinatura' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Gerenciar assinatura' })).not.toBeInTheDocument();
  });

  it('Atualizar cartão opens the checkout full screen in update-card mode', async () => {
    vi.mocked(getEffectivePlanWithSource).mockResolvedValue({
      planId: 'pro',
      planSource: 'pagarme',
      wasDemo: false,
    });
    vi.mocked(getWorkspaceSubscription).mockResolvedValue(PAGARME_ACTIVE);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Atualizar cartão' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveClass('phone-pagarme-checkout');
    expect(within(dialog).getByRole('button', { name: 'Salvar novo cartão' })).toBeInTheDocument();
  });

  it('a stripe past_due subscriber gets the Billing Portal row and the dunning line', async () => {
    vi.mocked(getWorkspaceSubscription).mockResolvedValue(
      subscription({ status: 'past_due', provider: 'stripe', plan_id: 'pro' }),
    );
    vi.mocked(openBillingPortal).mockResolvedValue('https://billing.stripe.com/p');
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Gerenciar assinatura' }));
    expect(
      screen.getByText(
        'Não conseguimos cobrar seu cartão. Atualize os dados para manter o acesso.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Pagamento pendente')).toBeInTheDocument();
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://billing.stripe.com/p'));
    expect(screen.queryByRole('button', { name: 'Cancelar assinatura' })).not.toBeInTheDocument();
  });

  it('cancel confirms through the phone sheet (desktop copy) and calls cancelPagarmeSubscription', async () => {
    vi.mocked(getEffectivePlanWithSource).mockResolvedValue({
      planId: 'pro',
      planSource: 'pagarme',
      wasDemo: false,
    });
    vi.mocked(getWorkspaceSubscription).mockResolvedValue(PAGARME_ACTIVE);
    vi.mocked(cancelPagarmeSubscription).mockResolvedValue({ status: 'canceled' } as never);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar assinatura' }));
    const sheet = await screen.findByRole('dialog');
    expect(sheet).toHaveClass('phone-action-sheet');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(
      within(sheet).getByText(
        'Seu acesso continua até 16/09/2026. Depois disso, o workspace volta ao plano gratuito.',
      ),
    ).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Manter assinatura' })).toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Sim, cancelar assinatura' }));
    await waitFor(() => expect(cancelPagarmeSubscription).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Assinatura cancelada.'));
  });

  it('Manter assinatura dismisses without cancelling', async () => {
    vi.mocked(getEffectivePlanWithSource).mockResolvedValue({
      planId: 'pro',
      planSource: 'pagarme',
      wasDemo: false,
    });
    vi.mocked(getWorkspaceSubscription).mockResolvedValue(PAGARME_ACTIVE);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar assinatura' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Manter assinatura' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(cancelPagarmeSubscription).not.toHaveBeenCalled();
  });

  it('after a failed cancel the row reopens the confirm for a retry', async () => {
    vi.mocked(getEffectivePlanWithSource).mockResolvedValue({
      planId: 'pro',
      planSource: 'pagarme',
      wasDemo: false,
    });
    vi.mocked(getWorkspaceSubscription).mockResolvedValue(PAGARME_ACTIVE);
    vi.mocked(cancelPagarmeSubscription).mockRejectedValueOnce(new Error('Falhou.'));
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar assinatura' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sim, cancelar assinatura' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Falhou.'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const row = screen.getByRole('button', { name: 'Cancelar assinatura' });
    await waitFor(() => expect(row).not.toBeDisabled());
    fireEvent.click(row);
    expect(
      await screen.findByRole('button', { name: 'Sim, cancelar assinatura' }),
    ).toBeInTheDocument();
  });

  it('during the switch window the destructive row reads "Desfazer a troca"', async () => {
    vi.mocked(getEffectivePlanWithSource).mockResolvedValue({
      planId: 'pro',
      planSource: 'pagarme',
      wasDemo: false,
    });
    vi.mocked(getWorkspaceSubscription).mockResolvedValue(
      subscription({
        provider: 'pagarme',
        status: 'trialing',
        switchScheduled: true,
        installments: 12,
        plan_id: 'pro',
        current_period_end: '2026-09-16T00:00:00Z',
      }),
    );
    renderPage();

    expect(await screen.findByRole('button', { name: 'Desfazer a troca' })).toBeInTheDocument();
    expect(screen.getByText('Troca agendada')).toBeInTheDocument();
    expect(screen.getByText('Primeira cobrança em')).toBeInTheDocument();
  });

  it('a non-owner sees the locked notice on the phone screen', () => {
    vi.mocked(useAuth).mockReturnValue({ role: 'owner', workspaceRole: 'agent' } as never);
    vi.mocked(getWorkspaceSubscription).mockResolvedValue(subscription({}));
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Plano & Cobrança' })).toBeInTheDocument();
    expect(
      screen.getByText('Apenas o proprietário da conta pode gerenciar a assinatura.'),
    ).toBeInTheDocument();
    expect(listActivePlans).not.toHaveBeenCalled();
  });
});

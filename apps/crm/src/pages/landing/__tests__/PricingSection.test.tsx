import { act, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { PublicPricingPlan } from '@/services/billing';

const authState = vi.hoisted(() => ({
  user: null as { id: string } | null,
}));

vi.mock('@/services/billing', () => ({
  listPublicPricingPlans: vi.fn(),
  getEffectivePlanWithSource: vi.fn(),
  getWorkspaceSubscription: vi.fn(),
  hasUsedTrial: (
    sub: { hasEverSubscribed?: boolean } | null | undefined,
    plan: { wasDemo?: boolean } | null | undefined,
  ) => Boolean(sub?.hasEverSubscribed || plan?.wasDemo),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: authState.user, loading: false, profile: null, role: 'owner' }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import {
  getEffectivePlanWithSource,
  getWorkspaceSubscription,
  listPublicPricingPlans,
} from '@/services/billing';
import { PricingSection } from '../PricingSection';

const FREE: PublicPricingPlan = {
  id: 'free',
  name: 'Free',
  price_brl: 0,
  price_brl_annual: 0,
  sort_order: 0,
  max_clients: 2,
  max_team_members: 1,
  max_workflow_templates: 1,
  max_instagram_accounts: 1,
  max_hub_tokens: 0,
  rate_report_generations_per_month: 0,
  storage_quota_bytes: 100 * 1024 ** 2,
  feature_analytics_reports: false,
  feature_post_scheduling: true,
  feature_tiktok: true,
  feature_leads: false,
  feature_financial: false,
  feature_contracts: false,
  feature_brand_customization: false,
  feature_mcp: false,
  feature_instagram_automation: false,
  feature_briefing_audio: false,
  pagarme_12x_enabled: false,
  pagarme_installment_cents: null,
};

const PRO: PublicPricingPlan = {
  ...FREE,
  id: 'pro',
  name: 'Pro',
  price_brl: 13990,
  price_brl_annual: 134300,
  sort_order: 2,
  max_clients: 15,
  max_team_members: 5,
  max_hub_tokens: 15,
  rate_report_generations_per_month: 30,
  feature_analytics_reports: true,
};

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  readonly observe = vi.fn();
  readonly unobserve = vi.fn();
  readonly disconnect = vi.fn();
  readonly takeRecords = vi.fn(() => []);
  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options: IntersectionObserverInit = {},
  ) {
    MockIntersectionObserver.instances.push(this);
  }
}

function renderPricing() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PricingSection />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const observer = MockIntersectionObserver.instances[0];
  const section = document.getElementById('pricing');
  act(() => {
    observer.callback(
      [{ isIntersecting: true, target: section } as IntersectionObserverEntry],
      observer as unknown as IntersectionObserver,
    );
  });
  return view;
}

function planCard(name: string): HTMLElement {
  const card = screen.getByRole('heading', { name, level: 3 }).closest('.plan-card');
  if (!card) throw new Error(`no card for ${name}`);
  return card as HTMLElement;
}

describe('PricingSection', () => {
  beforeEach(() => {
    authState.user = null;
    MockIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    vi.mocked(listPublicPricingPlans).mockResolvedValue([FREE, PRO]);
    vi.mocked(getEffectivePlanWithSource).mockReset();
    vi.mocked(getWorkspaceSubscription).mockReset();
  });

  it('logged out: states the 30-day trial and offers "Usar o Free"', async () => {
    renderPricing();
    await screen.findByRole('heading', { name: 'Pro', level: 3 });

    expect(
      screen.getByText(
        'Teste qualquer plano pago por 30 dias e só pague se continuar. Sem fidelidade, cancele quando quiser.',
      ),
    ).toBeInTheDocument();
    expect(within(planCard('Free')).getByRole('link', { name: 'Usar o Free' })).toHaveAttribute(
      'href',
      '/login?tab=register',
    );
    expect(within(planCard('Pro')).getByText('30 dias grátis para começar')).toBeInTheDocument();
    expect(
      within(planCard('Pro')).getByRole('link', { name: 'Começar teste grátis' }),
    ).toBeInTheDocument();
    // Signed-out visitors never trigger the subscription lookups.
    expect(getEffectivePlanWithSource).not.toHaveBeenCalled();
    expect(getWorkspaceSubscription).not.toHaveBeenCalled();
  });

  it('logged in after a past subscription: paid CTAs read "Assinar" and the trial note is gone', async () => {
    authState.user = { id: 'user-1' };
    vi.mocked(getEffectivePlanWithSource).mockResolvedValue({
      planId: 'free',
      planSource: 'system',
      wasDemo: false,
      trialOfferSeenAt: null,
    });
    vi.mocked(getWorkspaceSubscription).mockResolvedValue({
      hasEverSubscribed: true,
    } as Awaited<ReturnType<typeof getWorkspaceSubscription>>);
    renderPricing();
    await screen.findByRole('heading', { name: 'Pro', level: 3 });

    await waitFor(() =>
      expect(within(planCard('Pro')).getByRole('link', { name: 'Assinar Pro' })).toHaveAttribute(
        'href',
        '/configuracao/cobranca',
      ),
    );
    expect(screen.queryByText('30 dias grátis para começar')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Começar teste grátis' })).not.toBeInTheDocument();
    expect(within(planCard('Free')).getByRole('link', { name: 'Acessar painel' })).toBeVisible();
  });

  it('logged in and still eligible: keeps the trial copy', async () => {
    authState.user = { id: 'user-1' };
    vi.mocked(getEffectivePlanWithSource).mockResolvedValue({
      planId: 'free',
      planSource: 'system',
      wasDemo: false,
      trialOfferSeenAt: null,
    });
    vi.mocked(getWorkspaceSubscription).mockResolvedValue(null);
    renderPricing();
    await screen.findByRole('heading', { name: 'Pro', level: 3 });

    expect(
      await within(planCard('Pro')).findByRole('link', { name: 'Começar teste grátis' }),
    ).toBeInTheDocument();
    expect(within(planCard('Pro')).getByText('30 dias grátis para começar')).toBeInTheDocument();
  });

  it('comparison table: Free shows a dash for "Relatórios por mês"', async () => {
    renderPricing();
    await screen.findByRole('heading', { name: 'Pro', level: 3 });

    const row = screen.getByRole('row', { name: /Relatórios por mês/ });
    expect(within(row).getAllByRole('cell')[0]).toHaveTextContent('—');
    expect(within(row).getAllByRole('cell')[1]).toHaveTextContent('30');
  });
});

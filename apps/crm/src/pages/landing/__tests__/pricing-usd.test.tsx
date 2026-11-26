import { act, fireEvent, render, screen, within } from '@testing-library/react';
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

import { listPublicPricingPlans } from '@/services/billing';
import { PricingSection } from '../PricingSection';

const BASE: PublicPricingPlan = {
  id: 'free',
  name: 'Free',
  price_brl: 0,
  price_brl_annual: 0,
  price_usd: 0,
  price_usd_annual: 0,
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
  pagarme_12x_enabled: true,
  pagarme_installment_cents: 11000,
};
const paid = (
  id: string,
  name: string,
  sort: number,
  brl: number,
  brlYear: number,
  usd: number | null,
  usdYear: number | null,
): PublicPricingPlan => ({
  ...BASE,
  id,
  name,
  sort_order: sort,
  price_brl: brl,
  price_brl_annual: brlYear,
  price_usd: usd,
  price_usd_annual: usdYear,
});
const FREE = BASE;
const START = paid('start', 'Start', 1, 6990, 67100, 2900, 27900);
const PRO = paid('pro', 'Pro', 2, 13990, 134300, 4900, 46900);
const MAX = paid('max', 'Max', 3, 24990, 239900, 7900, 75900);

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  readonly observe = vi.fn();
  readonly unobserve = vi.fn();
  readonly disconnect = vi.fn();
  readonly takeRecords = vi.fn(() => []);
  constructor(readonly callback: IntersectionObserverCallback) {
    MockIntersectionObserver.instances.push(this);
  }
}

function renderPricing(locale?: 'pt' | 'en') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PricingSection {...(locale ? { locale } : {})} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const observer = MockIntersectionObserver.instances[0];
  act(() => {
    observer.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
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

describe('PricingSection in USD (en)', () => {
  beforeEach(() => {
    authState.user = null;
    MockIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    vi.mocked(listPublicPricingPlans).mockResolvedValue([FREE, START, PRO, MAX]);
  });

  it('shows monthly USD prices and no BRL, 12x or Pagar.me', async () => {
    const { container } = renderPricing('en');
    await screen.findByRole('heading', { name: 'Max', level: 3 });
    expect(planCard('Free')).toHaveTextContent('$0');
    expect(within(planCard('Start')).getByText('$29')).toBeInTheDocument();
    expect(within(planCard('Pro')).getByText('$49')).toBeInTheDocument();
    expect(within(planCard('Max')).getByText('$79')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Yearly/ }));
    expect(planCard('Start')).toHaveTextContent('$279');
    expect(planCard('Pro')).toHaveTextContent('$469');
    expect(planCard('Max')).toHaveTextContent('$759');
    const text = container.textContent ?? '';
    expect(text).not.toContain('R$');
    expect(text).not.toMatch(/12x|Pagar\.?me/i);
    expect(text).toContain('Create your account and use Pro for 14 days, no card required.');
  });

  it('every plan CTA links with market=us (cards and comparison)', async () => {
    renderPricing('en');
    await screen.findByRole('heading', { name: 'Max', level: 3 });
    const hrefs = screen
      .getAllByRole('link')
      .map((a) => a.getAttribute('href') ?? '')
      .filter((h) => h.startsWith('/login'));
    expect(hrefs.length).toBeGreaterThanOrEqual(8);
    for (const href of hrefs) expect(href).toContain('market=us');
  });

  it('drops a paid plan missing a USD price from cards and comparison', async () => {
    vi.mocked(listPublicPricingPlans).mockResolvedValue([
      FREE,
      START,
      PRO,
      { ...MAX, price_usd_annual: null },
    ]);
    renderPricing('en');
    await screen.findByRole('heading', { name: 'Pro', level: 3 });
    expect(screen.queryByRole('heading', { name: 'Max' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Max' })).not.toBeInTheDocument();
  });

  it('with no paid plan priced in USD shows only Free and the coming-soon line', async () => {
    vi.mocked(listPublicPricingPlans).mockResolvedValue([
      FREE,
      { ...START, price_usd: null, price_usd_annual: null },
      { ...PRO, price_usd: null, price_usd_annual: null },
    ]);
    renderPricing('en');
    await screen.findByRole('heading', { name: 'Free', level: 3 });
    expect(screen.queryByRole('heading', { name: 'Pro', level: 3 })).not.toBeInTheDocument();
    expect(screen.getByText('Paid plans in US dollars are coming soon.')).toBeInTheDocument();
  });
});

describe('PricingSection default locale (pt)', () => {
  beforeEach(() => {
    authState.user = null;
    MockIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    vi.mocked(listPublicPricingPlans).mockResolvedValue([FREE, PRO]);
  });

  it('keeps BRL output and links without market=us', async () => {
    const { container } = renderPricing();
    await screen.findByRole('heading', { name: 'Pro', level: 3 });
    const text = container.textContent ?? '';
    expect(text).toContain('R$');
    expect(text).not.toContain('$49');
    expect(text).not.toContain('coming soon');
    for (const a of container.querySelectorAll('a[href^="/login"]')) {
      expect(a.getAttribute('href')).not.toContain('market=us');
    }
  });
});

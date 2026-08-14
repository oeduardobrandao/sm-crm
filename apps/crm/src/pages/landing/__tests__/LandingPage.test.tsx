import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { PublicPricingPlan } from '@/services/billing';

const authState = vi.hoisted(() => ({
  user: null as { id: string } | null,
}));

vi.mock('@/services/billing', () => ({
  listPublicPricingPlans: vi.fn(),
}));

import { listPublicPricingPlans } from '@/services/billing';
import LandingPage from '../LandingPage';

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: authState.user, loading: false, profile: null, role: 'owner' }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const PAID_FEATURES = {
  feature_analytics_reports: true,
  feature_post_scheduling: true,
  feature_leads: true,
  feature_financial: true,
  feature_contracts: true,
  feature_brand_customization: true,
  feature_mcp: true,
} as const;

const PRICING_PLANS: PublicPricingPlan[] = [
  {
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
    storage_quota_bytes: 100 * 1024 ** 2,
    feature_analytics_reports: false,
    feature_post_scheduling: false,
    feature_leads: false,
    feature_financial: false,
    feature_contracts: false,
    feature_brand_customization: false,
    feature_mcp: false,
    pagarme_12x_enabled: false,
    pagarme_installment_cents: null,
  },
  {
    id: 'start',
    name: 'Start',
    price_brl: 9990,
    price_brl_annual: 95900,
    sort_order: 1,
    max_clients: 5,
    max_team_members: 2,
    max_workflow_templates: 3,
    max_instagram_accounts: 5,
    max_hub_tokens: 5,
    storage_quota_bytes: 5 * 1024 ** 3,
    ...PAID_FEATURES,
    pagarme_12x_enabled: false,
    pagarme_installment_cents: null,
  },
  {
    id: 'pro',
    name: 'Pro',
    price_brl: 13990,
    price_brl_annual: 134300,
    sort_order: 2,
    max_clients: 15,
    max_team_members: 5,
    max_workflow_templates: null,
    max_instagram_accounts: 15,
    max_hub_tokens: 15,
    storage_quota_bytes: 10 * 1024 ** 3,
    ...PAID_FEATURES,
    pagarme_12x_enabled: false,
    pagarme_installment_cents: null,
  },
  {
    id: 'max',
    name: 'Max',
    price_brl: 19990,
    price_brl_annual: 191900,
    sort_order: 3,
    max_clients: null,
    max_team_members: null,
    max_workflow_templates: null,
    max_instagram_accounts: null,
    max_hub_tokens: null,
    storage_quota_bytes: 25 * 1024 ** 3,
    ...PAID_FEATURES,
    pagarme_12x_enabled: false,
    pagarme_installment_cents: null,
  },
];

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  readonly root = null;
  readonly rootMargin: string;
  readonly thresholds: readonly number[];
  readonly observe = vi.fn();
  readonly unobserve = vi.fn();
  readonly disconnect = vi.fn();
  readonly takeRecords = vi.fn(() => []);

  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options: IntersectionObserverInit = {},
  ) {
    this.rootMargin = options.rootMargin ?? '0px';
    this.thresholds = Array.isArray(options.threshold)
      ? options.threshold
      : [options.threshold ?? 0];
    MockIntersectionObserver.instances.push(this);
  }
}

function triggerPricingIntersection() {
  const observer = MockIntersectionObserver.instances.find(
    (instance) => instance.options.rootMargin === '600px 0px',
  );
  const section = document.getElementById('pricing');
  if (!observer || !section) throw new Error('Pricing observer was not registered');
  act(() => {
    observer.callback(
      [{ isIntersecting: true, target: section } as IntersectionObserverEntry],
      observer as unknown as IntersectionObserver,
    );
  });
}

function renderLandingPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function mockSectionScroll(id: string) {
  const element = document.getElementById(id) as HTMLElement & {
    scrollIntoView: ReturnType<typeof vi.fn>;
  };
  const scrollSpy = vi.fn();
  element.scrollIntoView = scrollSpy;
  return scrollSpy;
}

describe('LandingPage', () => {
  beforeEach(() => {
    authState.user = null;
    MockIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
    vi.mocked(listPublicPricingPlans).mockResolvedValue(PRICING_PLANS);
    document.body.classList.remove('landing-page');
    document.documentElement.removeAttribute('data-theme');
    localStorage.clear();
  });

  it('adds the landing-page body class on mount and removes it on unmount', () => {
    const { unmount } = renderLandingPage();

    expect(document.body).toHaveClass('landing-page');

    unmount();

    expect(document.body).not.toHaveClass('landing-page');
  });

  it('toggles the document theme between light and dark', () => {
    renderLandingPage();

    fireEvent.click(screen.getByRole('button', { name: 'Alternar tema' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');

    fireEvent.click(screen.getByRole('button', { name: 'Alternar tema' }));
    expect(document.documentElement).not.toHaveAttribute('data-theme');
  });

  it('shows the promo banner and hides it (persisted) after dismissing', () => {
    renderLandingPage();

    // Scope to the banner region: the promo code also appears in the pricing callout.
    const banner = screen.getByRole('region', { name: 'Oferta de lançamento' });
    expect(banner).toHaveTextContent('30 dias');
    expect(banner).not.toHaveTextContent('BEMVINDO');

    fireEvent.click(screen.getByRole('button', { name: 'Fechar aviso' }));

    expect(screen.queryByRole('region', { name: 'Oferta de lançamento' })).not.toBeInTheDocument();
    expect(localStorage.getItem('mesaas_promo_dismissed')).toBe('1');
  });

  it('wires scroll buttons to the right sections and exposes the auth CTAs', async () => {
    renderLandingPage();
    triggerPricingIntersection();
    await screen.findByRole('heading', { name: 'Start', level: 3 });

    const featuresScroll = mockSectionScroll('features');
    const agenteScroll = mockSectionScroll('agente');
    const pricingScroll = mockSectionScroll('pricing');
    const faqScroll = mockSectionScroll('faq');

    fireEvent.click(screen.getByRole('button', { name: /Ver como funciona/i }));
    expect(featuresScroll).toHaveBeenCalledWith({ behavior: 'smooth' });

    fireEvent.click(screen.getByRole('button', { name: 'Agente IA' }));
    expect(agenteScroll).toHaveBeenCalledWith({ behavior: 'smooth' });

    fireEvent.click(screen.getByRole('button', { name: 'Preços' }));
    expect(pricingScroll).toHaveBeenCalledWith({ behavior: 'smooth' });

    fireEvent.click(screen.getByRole('button', { name: 'FAQ' }));
    expect(faqScroll).toHaveBeenCalledWith({ behavior: 'smooth' });

    const registerLinks = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('href')?.startsWith('/login?tab=register'));

    // Promo banner + header + hero + agent section + final CTA each link straight
    // to signup, and so does the free pricing CTA and free comparison action.
    // The 3 paid pricing CTAs and 3 paid comparison actions carry plan intent.
    expect(registerLinks).toHaveLength(13);

    const plainRegisterLinks = registerLinks.filter(
      (link) => link.getAttribute('href') === '/login?tab=register',
    );
    expect(plainRegisterLinks).toHaveLength(7);

    const planIntentHrefs = registerLinks
      .map((link) => link.getAttribute('href'))
      .filter((href): href is string => !!href && href.includes('&plan='))
      .sort();
    expect(planIntentHrefs).toEqual([
      '/login?tab=register&plan=max&interval=month',
      '/login?tab=register&plan=max&interval=month',
      '/login?tab=register&plan=pro&interval=month',
      '/login?tab=register&plan=pro&interval=month',
      '/login?tab=register&plan=start&interval=month',
      '/login?tab=register&plan=start&interval=month',
    ]);

    expect(screen.getByRole('link', { name: 'Entrar' })).toHaveAttribute('href', '/login');
  });

  it('routes authenticated pricing and comparison actions to the dashboard or billing', async () => {
    authState.user = { id: 'user-123' };
    renderLandingPage();
    triggerPricingIntersection();
    await screen.findByRole('heading', { name: 'Start', level: 3 });

    const freeCard = screen.getByRole('heading', { name: 'Free', level: 3 }).closest('.plan-card');
    const startCard = screen
      .getByRole('heading', { name: 'Start', level: 3 })
      .closest('.plan-card');
    expect(freeCard).not.toBeNull();
    expect(startCard).not.toBeNull();
    expect(
      within(freeCard as HTMLElement).getByRole('link', { name: 'Acessar painel' }),
    ).toHaveAttribute('href', '/dashboard');
    expect(
      within(startCard as HTMLElement).getByRole('link', { name: 'Começar teste grátis' }),
    ).toHaveAttribute('href', '/configuracao/cobranca');

    const comparison = screen.getByRole('table', { name: 'Comparação detalhada dos planos' });
    expect(within(comparison).getByRole('link', { name: 'Acessar painel' })).toHaveAttribute(
      'href',
      '/dashboard',
    );
    // Start, Pro and Max all share the "Começar teste grátis" label for logged-in users.
    const paidComparisonLinks = within(comparison).getAllByRole('link', {
      name: 'Começar teste grátis',
    });
    expect(paidComparisonLinks).toHaveLength(3);
    paidComparisonLinks.forEach((link) => {
      expect(link).toHaveAttribute('href', '/configuracao/cobranca');
    });
  });

  it('defers the plan request until pricing approaches the viewport', async () => {
    renderLandingPage();

    expect(listPublicPricingPlans).not.toHaveBeenCalled();
    expect(document.querySelectorAll('.plan-card-skeleton')).toHaveLength(4);
    expect(document.querySelector('.plans-grid')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Carregando planos');

    triggerPricingIntersection();

    await waitFor(() => expect(listPublicPricingPlans).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('heading', { name: 'Start', level: 3 })).toBeInTheDocument();
    expect(document.querySelector('.plans-grid')).toHaveAttribute('aria-busy', 'false');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('starts the plan request when IntersectionObserver is unavailable', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);

    renderLandingPage();

    await waitFor(() => expect(listPublicPricingPlans).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('heading', { name: 'Start', level: 3 })).toBeInTheDocument();
  });

  it('renders the comparison from the same successful deferred plan result', async () => {
    renderLandingPage();

    expect(screen.queryByRole('heading', { name: 'Compare os planos' })).not.toBeInTheDocument();
    triggerPricingIntersection();

    expect(
      await screen.findByRole('table', { name: 'Comparação detalhada dos planos' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Contas do Instagram/ })).toHaveTextContent(
      '1515Ilimitado',
    );
    expect(screen.getByRole('row', { name: /Armazenamento/ })).toHaveTextContent(
      '100 MB5 GB10 GB25 GB',
    );
  });

  it('renders Admin order, prices, and only client/user limits', async () => {
    renderLandingPage();
    triggerPricingIntersection();

    await screen.findByRole('heading', { name: 'Max', level: 3 });
    const names = Array.from(document.querySelectorAll('.plans-grid .plan-card h3')).map(
      (heading) => heading.textContent,
    );
    expect(names).toEqual(['Free', 'Start', 'Pro', 'Max']);

    const startCard = screen
      .getByRole('heading', { name: 'Start', level: 3 })
      .closest('.plan-card');
    expect(startCard).not.toBeNull();
    expect(within(startCard as HTMLElement).getByText('R$ 99,90')).toBeInTheDocument();
    expect(within(startCard as HTMLElement).getByText('5')).toBeInTheDocument();
    expect(within(startCard as HTMLElement).getByText('2')).toBeInTheDocument();

    const maxCard = screen.getByRole('heading', { name: 'Max', level: 3 }).closest('.plan-card');
    expect(maxCard).not.toBeNull();
    expect(within(maxCard as HTMLElement).getAllByText('Ilimitado')).toHaveLength(2);
    expect(screen.queryByText('Templates')).not.toBeInTheDocument();
    expect(screen.queryByText('Features')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Lifetime', level: 3 })).not.toBeInTheDocument();
  });

  it('uses annual catalog prices and derives the savings hint', async () => {
    renderLandingPage();
    triggerPricingIntersection();
    await screen.findByRole('heading', { name: 'Start', level: 3 });

    expect(screen.getByText('Economize até 20% no plano anual')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Anual' }));

    const startCard = screen
      .getByRole('heading', { name: 'Start', level: 3 })
      .closest('.plan-card');
    expect(startCard).not.toBeNull();
    expect(within(startCard as HTMLElement).getByText('R$ 79,92')).toBeInTheDocument();
    expect(
      within(startCard as HTMLElement).getByText('cobrado anualmente (R$ 959,00/ano)'),
    ).toBeInTheDocument();
    expect(
      within(startCard as HTMLElement).getByRole('link', { name: 'Começar teste grátis' }),
    ).toHaveAttribute('href', '/login?tab=register&plan=start&interval=year');
  });

  describe('Pagar.me 12x', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('PRIMARY AMOUNT RULE: renders the parcela as the big number plus the à vista price and computed discount', async () => {
      vi.stubEnv('VITE_PAGARME_PUBLIC_KEY', 'pk_test_abc');
      // pagarme_installment_cents (12990) is the Pro plan's OWN 12x price, deliberately NOT
      // price_brl_annual / 12 (134300 / 12 = 11191.67 -> R$ 111,92). Rendering the latter would
      // contradict the exact figure the checkout dialog charges.
      const gatedPro = {
        ...PRICING_PLANS[2],
        pagarme_12x_enabled: true,
        pagarme_installment_cents: 12990,
      };
      vi.mocked(listPublicPricingPlans).mockResolvedValue([PRICING_PLANS[0], gatedPro]);
      renderLandingPage();
      triggerPricingIntersection();
      await screen.findByRole('heading', { name: 'Pro', level: 3 });

      fireEvent.click(screen.getByRole('button', { name: 'Anual' }));

      const proCard = screen.getByRole('heading', { name: 'Pro', level: 3 }).closest('.plan-card');
      expect(proCard).not.toBeNull();
      expect(within(proCard as HTMLElement).getByText('R$ 129,90')).toBeInTheDocument();
      expect(within(proCard as HTMLElement).queryByText('R$ 111,92')).not.toBeInTheDocument();
      // X = round((1 - 134300 / (12 * 13990)) * 100) = 20.
      expect(
        within(proCard as HTMLElement).getByText(
          '12x no cartão, sem juros · ou R$ 1.343,00 à vista (20% off)',
        ),
      ).toBeInTheDocument();
    });

    it("leaves a non-gated plan's derivation and copy unchanged", async () => {
      vi.stubEnv('VITE_PAGARME_PUBLIC_KEY', 'pk_test_abc');
      // pagarme_12x_enabled is false: the env key alone must not gate anything on.
      renderLandingPage();
      triggerPricingIntersection();
      await screen.findByRole('heading', { name: 'Start', level: 3 });

      fireEvent.click(screen.getByRole('button', { name: 'Anual' }));

      const startCard = screen
        .getByRole('heading', { name: 'Start', level: 3 })
        .closest('.plan-card');
      expect(startCard).not.toBeNull();
      expect(within(startCard as HTMLElement).getByText('R$ 79,92')).toBeInTheDocument();
      expect(
        within(startCard as HTMLElement).getByText('cobrado anualmente (R$ 959,00/ano)'),
      ).toBeInTheDocument();
      expect(within(startCard as HTMLElement).queryByText(/12x no cartão/)).not.toBeInTheDocument();
    });
  });

  it('shows paid plans with a null annual price as unavailable in annual mode', async () => {
    vi.mocked(listPublicPricingPlans).mockResolvedValue([
      PRICING_PLANS[0],
      { ...PRICING_PLANS[1], price_brl_annual: null },
    ]);
    renderLandingPage();
    triggerPricingIntersection();
    await screen.findByRole('heading', { name: 'Start', level: 3 });

    fireEvent.click(screen.getByRole('button', { name: 'Anual' }));

    const startCard = screen
      .getByRole('heading', { name: 'Start', level: 3 })
      .closest('.plan-card');
    expect(startCard).not.toBeNull();
    expect(within(startCard as HTMLElement).getByText('Sob consulta')).toBeInTheDocument();
    expect(within(startCard as HTMLElement).queryByText('/mês')).not.toBeInTheDocument();
    expect(
      within(startCard as HTMLElement).queryByText(/cobrado anualmente/i),
    ).not.toBeInTheDocument();

    const freeCard = screen.getByRole('heading', { name: 'Free', level: 3 }).closest('.plan-card');
    expect(freeCard).not.toBeNull();
    expect(within(freeCard as HTMLElement).getByText('R$ 0')).toBeInTheDocument();
  });

  it('shows paid plans with a zero annual price as unavailable in annual mode', async () => {
    vi.mocked(listPublicPricingPlans).mockResolvedValue([
      { ...PRICING_PLANS[1], price_brl_annual: 0 },
    ]);
    renderLandingPage();
    triggerPricingIntersection();
    await screen.findByRole('heading', { name: 'Start', level: 3 });

    fireEvent.click(screen.getByRole('button', { name: 'Anual' }));

    const startCard = screen
      .getByRole('heading', { name: 'Start', level: 3 })
      .closest('.plan-card');
    expect(startCard).not.toBeNull();
    expect(within(startCard as HTMLElement).getByText('Sob consulta')).toBeInTheDocument();
    expect(within(startCard as HTMLElement).queryByText('/mês')).not.toBeInTheDocument();
    expect(
      within(startCard as HTMLElement).queryByText(/cobrado anualmente/i),
    ).not.toBeInTheDocument();
  });

  it('hides the savings hint when annual billing has no positive saving', async () => {
    vi.mocked(listPublicPricingPlans).mockResolvedValue([
      { ...PRICING_PLANS[1], price_brl_annual: PRICING_PLANS[1].price_brl! * 12 },
    ]);
    renderLandingPage();
    triggerPricingIntersection();

    await screen.findByRole('heading', { name: 'Start', level: 3 });

    expect(screen.queryByText(/Economize até/i)).not.toBeInTheDocument();
  });

  it('renders the empty catalog state', async () => {
    vi.mocked(listPublicPricingPlans).mockResolvedValue([]);
    renderLandingPage();
    triggerPricingIntersection();

    expect(
      await screen.findByText('Os planos estão temporariamente indisponíveis.'),
    ).toBeInTheDocument();
    expect(document.querySelectorAll('.plan-card')).toHaveLength(0);
    expect(screen.queryByRole('heading', { name: 'Compare os planos' })).not.toBeInTheDocument();
  });

  it('uses safe generic marketing metadata for an unknown public plan', async () => {
    vi.mocked(listPublicPricingPlans).mockResolvedValue([
      {
        id: 'enterprise',
        name: 'Enterprise',
        price_brl: null,
        price_brl_annual: null,
        sort_order: 9,
        max_clients: null,
        max_team_members: null,
        max_workflow_templates: null,
        max_instagram_accounts: null,
        max_hub_tokens: null,
        storage_quota_bytes: null,
        ...PAID_FEATURES,
      },
    ]);
    renderLandingPage();
    triggerPricingIntersection();

    const heading = await screen.findByRole('heading', { name: 'Enterprise', level: 3 });
    const card = heading.closest('.plan-card');
    expect(card).not.toBeNull();
    expect(
      within(card as HTMLElement).getByText('Conheça o plano Enterprise.'),
    ).toBeInTheDocument();
    expect(
      within(card as HTMLElement).getByRole('link', { name: 'Assinar Enterprise' }),
    ).toHaveAttribute('href', '/login?tab=register&plan=enterprise&interval=month');
  });

  it('shows a retryable error without stale plan values', async () => {
    vi.mocked(listPublicPricingPlans).mockRejectedValueOnce(new Error('offline'));
    renderLandingPage();
    triggerPricingIntersection();

    expect(
      await screen.findByText('Não foi possível carregar os planos agora.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Start', level: 3 })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Compare os planos' })).not.toBeInTheDocument();

    vi.mocked(listPublicPricingPlans).mockResolvedValueOnce(PRICING_PLANS);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    expect(await screen.findByRole('heading', { name: 'Start', level: 3 })).toBeInTheDocument();
  });

  it('opens one FAQ answer at a time', () => {
    renderLandingPage();

    const freeQuestion = screen.getByRole('button', { name: 'O Mesaas tem plano gratuito?' });
    const installQuestion = screen.getByRole('button', { name: 'Preciso instalar alguma coisa?' });

    fireEvent.click(freeQuestion);

    expect(freeQuestion).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByText(
        'Sim. O plano Free permite começar sem custo. Para ver os limites, recursos e condições atuais de cada opção, compare os planos exibidos acima e escolha o que melhor atende à sua operação.',
      ),
    ).toBeInTheDocument();

    fireEvent.click(installQuestion);

    expect(freeQuestion).toHaveAttribute('aria-expanded', 'false');
    expect(installQuestion).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByText(/permite começar sem custo/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'Não. O Mesaas é 100% web e funciona em qualquer navegador moderno, no computador ou no celular. Nada para baixar, nada para configurar.',
      ),
    ).toBeInTheDocument();
  });
});

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { PublicPricingPlan } from '@/services/billing';

vi.mock('@/services/billing', () => ({
  listPublicPricingPlans: vi.fn(),
}));

import { listPublicPricingPlans } from '@/services/billing';
import LandingPage from '../LandingPage';

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: null, loading: false, profile: null, role: 'owner' }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const PRICING_PLANS: PublicPricingPlan[] = [
  {
    id: 'free',
    name: 'Free',
    price_brl: 0,
    price_brl_annual: 0,
    sort_order: 0,
    max_clients: 2,
    max_team_members: 1,
  },
  {
    id: 'start',
    name: 'Start',
    price_brl: 9990,
    price_brl_annual: 95900,
    sort_order: 1,
    max_clients: 5,
    max_team_members: 2,
  },
  {
    id: 'pro',
    name: 'Pro',
    price_brl: 13990,
    price_brl_annual: 134300,
    sort_order: 2,
    max_clients: 15,
    max_team_members: 5,
  },
  {
    id: 'max',
    name: 'Max',
    price_brl: 19990,
    price_brl_annual: 191900,
    sort_order: 3,
    max_clients: null,
    max_team_members: null,
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
    expect(banner).toHaveTextContent('BEMVINDO');

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
      .filter((link) => link.getAttribute('href') === '/login?tab=register');

    // Promo banner + header + hero + agent section + final CTA each link to signup,
    // plus all 4 pricing CTAs.
    expect(registerLinks).toHaveLength(9);
    expect(screen.getByRole('link', { name: 'Entrar' })).toHaveAttribute('href', '/login');
  });

  it('defers the plan request until pricing approaches the viewport', async () => {
    renderLandingPage();

    expect(listPublicPricingPlans).not.toHaveBeenCalled();
    expect(document.querySelectorAll('.plan-card-skeleton')).toHaveLength(4);

    triggerPricingIntersection();

    await waitFor(() => expect(listPublicPricingPlans).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('heading', { name: 'Start', level: 3 })).toBeInTheDocument();
  });

  it('renders Admin order, prices, and only client/user limits', async () => {
    renderLandingPage();
    triggerPricingIntersection();

    await screen.findByRole('heading', { name: 'Max', level: 3 });
    const names = Array.from(document.querySelectorAll('.plans-grid .plan-card h3')).map(
      (heading) => heading.textContent,
    );
    expect(names).toEqual(['Free', 'Start', 'Pro', 'Max']);

    const startCard = screen.getByRole('heading', { name: 'Start', level: 3 }).closest('.plan-card');
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

    const startCard = screen.getByRole('heading', { name: 'Start', level: 3 }).closest('.plan-card');
    expect(startCard).not.toBeNull();
    expect(within(startCard as HTMLElement).getByText('R$ 79,92')).toBeInTheDocument();
    expect(
      within(startCard as HTMLElement).getByText('cobrado anualmente (R$ 959,00/ano)'),
    ).toBeInTheDocument();
  });

  it('shows a retryable error without stale plan values', async () => {
    vi.mocked(listPublicPricingPlans).mockRejectedValueOnce(new Error('offline'));
    renderLandingPage();
    triggerPricingIntersection();

    expect(await screen.findByText('Não foi possível carregar os planos agora.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Start', level: 3 })).not.toBeInTheDocument();

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
        'Sim. O plano Free é gratuito para sempre, com limites para você conhecer a plataforma — 2 clientes e 1 usuário. Quando precisar de mais clientes, usuários ou recursos como integração com Instagram e portal do cliente, é só assinar um plano pago, a partir de R$ 99,90/mês.',
      ),
    ).toBeInTheDocument();

    fireEvent.click(installQuestion);

    expect(freeQuestion).toHaveAttribute('aria-expanded', 'false');
    expect(installQuestion).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByText(/gratuito para sempre/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'Não. O Mesaas é 100% web e funciona em qualquer navegador moderno, no computador ou no celular. Nada para baixar, nada para configurar.',
      ),
    ).toBeInTheDocument();
  });
});

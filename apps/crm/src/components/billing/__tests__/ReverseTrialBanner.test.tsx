import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/services/billing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/billing')>();
  return {
    ...actual,
    getWorkspaceSubscription: vi.fn(),
    getEffectivePlanWithSource: vi.fn(),
    listActivePlans: vi.fn(),
  };
});
vi.mock('@/hooks/useWorkspaceUsage', () => ({
  useWorkspaceUsage: () => ({
    usage: { clients: 6, hub_tokens: 4, team_members: 2 },
    isLoading: false,
    isError: false,
  }),
}));
vi.mock('@/lib/analytics', () => ({ captureEvent: vi.fn() }));

import { useAuth } from '@/context/AuthContext';
import {
  getEffectivePlanWithSource,
  getWorkspaceSubscription,
  listActivePlans,
} from '@/services/billing';
import { captureEvent } from '@/lib/analytics';
import { ReverseTrialBanner } from '../ReverseTrialBanner';

// 2026-12-08 17:00 UTC = 14:00 in São Paulo.
const ENDS_AT = '2026-12-08T17:00:00Z';

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    price_brl: 0,
    price_brl_annual: 0,
    max_clients: 2,
    max_team_members: 1,
    rate_report_generations_per_month: 2,
  },
  {
    id: 'pro',
    name: 'Pro',
    price_brl: 13990,
    price_brl_annual: 139900,
    max_clients: 15,
    max_team_members: 5,
    rate_report_generations_per_month: 15,
  },
];

function trialPlan(over: Record<string, unknown> = {}) {
  return {
    planId: 'pro',
    planSource: 'trial',
    wasDemo: false,
    trialOfferSeenAt: '2026-11-24T17:00:00Z',
    hasWorkspace: true,
    reverseTrial: {
      startedAt: '2026-11-24T17:00:00Z',
      endsAt: ENDS_AT,
      endedAt: null,
      outcome: null,
      cardAddedAt: null,
      firstPaidAt: null,
    },
    ...over,
  };
}

function setAuth(role: 'owner' | 'admin' | 'agent') {
  vi.mocked(useAuth).mockReturnValue({
    role,
    workspaceRole: role,
    profile: { conta_id: 'ws-1' },
  } as never);
}

function renderBanner() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ReverseTrialBanner />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  setAuth('owner');
  vi.mocked(getEffectivePlanWithSource).mockResolvedValue(trialPlan() as never);
  vi.mocked(getWorkspaceSubscription).mockResolvedValue(null);
  vi.mocked(listActivePlans).mockResolvedValue(PLANS as never);
});

afterEach(() => {
  vi.useRealTimers();
  (window as unknown as { Capacitor?: unknown }).Capacitor = undefined;
});

describe('ReverseTrialBanner', () => {
  it('banner_normal_copy_and_dismiss', async () => {
    vi.setSystemTime(new Date('2026-11-28T15:00:00Z'));
    renderBanner();
    expect(await screen.findByText('Pro grátis: faltam 10 dias.')).toBeInTheDocument();
    expect(
      screen.getByText(/Adicione um cartão para continuar no Pro depois de 8 de dezembro\./),
    ).toBeInTheDocument();
    expect(captureEvent).toHaveBeenCalledWith('reverse_trial_banner_viewed', {
      days_left: 10,
      phase: 'normal',
    });
    await userEvent.click(screen.getByRole('button', { name: 'Ocultar aviso' }));
    expect(screen.queryByText('Pro grátis: faltam 10 dias.')).toBeNull();
    expect(sessionStorage.getItem('reverse_trial_banner_dismissed_ws-1')).toBe('1');
  });

  it('logs the banner view at most once a day', async () => {
    vi.setSystemTime(new Date('2026-11-28T15:00:00Z'));
    const first = renderBanner();
    await screen.findByText('Pro grátis: faltam 10 dias.');
    expect(captureEvent).toHaveBeenCalledTimes(1);
    first.unmount();
    renderBanner();
    await screen.findByText('Pro grátis: faltam 10 dias.');
    expect(captureEvent).toHaveBeenCalledTimes(1);
  });

  it('banner_ending_not_dismissible', async () => {
    vi.setSystemTime(new Date('2026-12-05T12:00:00Z'));
    sessionStorage.setItem('reverse_trial_banner_dismissed_ws-1', '1');
    sessionStorage.setItem('reverse_trial_end_dialog_ws-1', '1');
    renderBanner();
    expect(
      await screen.findByText('Seu teste do Pro termina em 3 dias (8 de dezembro).'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ocultar aviso' })).toBeNull();
  });

  it('shows the hour on the last day', async () => {
    vi.setSystemTime(new Date('2026-12-08T10:00:00Z'));
    sessionStorage.setItem('reverse_trial_end_dialog_ws-1', '1');
    renderBanner();
    expect(await screen.findByText('Seu teste do Pro termina hoje às 14h.')).toBeInTheDocument();
  });

  it('add_card_link_does_not_autostart_checkout', async () => {
    vi.setSystemTime(new Date('2026-11-28T15:00:00Z'));
    renderBanner();
    const link = await screen.findByRole('link', { name: 'Adicionar cartão' });
    const href = link.getAttribute('href') ?? '';
    expect(href).toBe('/comecar?recomendado=pro');
    expect(href).not.toMatch(/[?&](plan|interval)=/);
    await userEvent.click(link);
    expect(captureEvent).toHaveBeenCalledWith('reverse_trial_add_card_clicked', {
      surface: 'banner',
    });
  });

  it('banner_card_added_shows_amount_date', async () => {
    vi.setSystemTime(new Date('2026-11-30T12:00:00Z'));
    vi.mocked(getEffectivePlanWithSource).mockResolvedValue(
      trialPlan({
        planSource: 'stripe',
        reverseTrial: {
          startedAt: '2026-11-24T17:00:00Z',
          endsAt: ENDS_AT,
          endedAt: '2026-11-29T10:00:00Z',
          outcome: 'converted',
          cardAddedAt: '2026-11-29T10:00:00Z',
          firstPaidAt: null,
        },
      }) as never,
    );
    vi.mocked(getWorkspaceSubscription).mockResolvedValue({
      status: 'trialing',
      provider: 'stripe',
      billingInterval: 'month',
      current_period_end: ENDS_AT,
    } as never);
    renderBanner();
    expect(await screen.findByText('Pro garantido.')).toBeInTheDocument();
    expect(
      await screen.findByText(/Primeira cobrança de R\$\s139,90 em 8 de dezembro\./),
    ).toBeInTheDocument();
  });

  it('hides the card-added banner after 3 days', async () => {
    vi.setSystemTime(new Date('2026-12-03T12:00:00Z'));
    vi.mocked(getEffectivePlanWithSource).mockResolvedValue(
      trialPlan({
        planSource: 'stripe',
        reverseTrial: {
          startedAt: '2026-11-24T17:00:00Z',
          endsAt: ENDS_AT,
          endedAt: '2026-11-29T10:00:00Z',
          outcome: 'converted',
          cardAddedAt: '2026-11-29T10:00:00Z',
          firstPaidAt: null,
        },
      }) as never,
    );
    const { container } = renderBanner();
    await waitFor(() => expect(getEffectivePlanWithSource).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });

  it('banner_hidden_for_agent', async () => {
    vi.setSystemTime(new Date('2026-11-28T15:00:00Z'));
    setAuth('agent');
    const { container } = renderBanner();
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
    expect(getEffectivePlanWithSource).not.toHaveBeenCalled();
  });

  it('shows admins the countdown without the add-card button', async () => {
    vi.setSystemTime(new Date('2026-11-28T15:00:00Z'));
    setAuth('admin');
    renderBanner();
    expect(await screen.findByText('Pro grátis: faltam 10 dias.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Adicionar cartão' })).toBeNull();
  });

  it('banner_native_no_button_no_price', async () => {
    vi.setSystemTime(new Date('2026-11-28T15:00:00Z'));
    (window as unknown as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    renderBanner();
    expect(await screen.findByText('Pro até 8 de dezembro.')).toBeInTheDocument();
    expect(screen.getByText(/Faltam 10 dias\. Gerencie seu plano pelo site\./)).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText(/R\$/)).toBeNull();
  });

  it('end_dialog_once_per_session', async () => {
    vi.setSystemTime(new Date('2026-12-06T12:00:00Z'));
    const first = renderBanner();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Continue no Pro depois de 8 de dezembro')).toBeInTheDocument();
    expect(within(dialog).getByText('Faltam 2 dias')).toBeInTheDocument();
    expect(within(dialog).getByText('6 clientes')).toBeInTheDocument();
    expect(await within(dialog).findByText('Cadastra até 2 clientes')).toBeInTheDocument();
    expect(within(dialog).getByText(/Pro: R\$\s139,90 por mês/)).toBeInTheDocument();
    const primary = within(dialog).getByRole('link', {
      name: 'Adicionar cartão e continuar no Pro',
    });
    expect(primary.getAttribute('href')).toBe('/comecar?recomendado=pro');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Decidir depois' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    first.unmount();

    renderBanner();
    await screen.findByText(/Seu teste do Pro termina em 2 dias/);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('end_dialog_never_for_admin', async () => {
    vi.setSystemTime(new Date('2026-12-06T12:00:00Z'));
    setAuth('admin');
    renderBanner();
    await screen.findByText(/Seu teste do Pro termina em 2 dias/);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('end_dialog_never_on_native', async () => {
    vi.setSystemTime(new Date('2026-12-06T12:00:00Z'));
    (window as unknown as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    renderBanner();
    await screen.findByText('Pro até 8 de dezembro.');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders nothing once the end has passed (before the sweep)', async () => {
    vi.setSystemTime(new Date('2026-12-08T18:00:00Z'));
    const { container } = renderBanner();
    await waitFor(() => expect(getEffectivePlanWithSource).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });
});

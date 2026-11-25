import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { usage } = vi.hoisted(() => ({
  usage: { value: { clients: 8, hub_tokens: 4, team_members: 2 } as Record<string, number> },
}));

vi.mock('@/context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/services/billing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/billing')>();
  return { ...actual, getEffectivePlanWithSource: vi.fn(), listActivePlans: vi.fn() };
});
vi.mock('@/hooks/useWorkspaceUsage', () => ({
  useWorkspaceUsage: () => ({ usage: usage.value, isLoading: false, isError: false }),
}));
vi.mock('@/lib/analytics', () => ({ captureEvent: vi.fn() }));

import { useAuth } from '@/context/AuthContext';
import { getEffectivePlanWithSource, listActivePlans } from '@/services/billing';
import { ReverseTrialEndedBanner } from '../ReverseTrialEndedBanner';

// Ended 2026-12-08 17:00 UTC; Hub links pause 7 days later (15/12).
const ENDED_AT = '2026-12-08T17:00:00Z';

const exTrial = (over: Record<string, unknown> = {}) => ({
  planId: null,
  planSource: 'system',
  wasDemo: false,
  hasWorkspace: true,
  trialOfferSeenAt: '2026-11-24T17:00:00Z',
  reverseTrial: {
    startedAt: '2026-11-24T17:00:00Z',
    endsAt: ENDED_AT,
    endedAt: ENDED_AT,
    outcome: 'downgraded',
    cardAddedAt: null,
    firstPaidAt: null,
  },
  ...over,
});

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
        <ReverseTrialEndedBanner />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  usage.value = { clients: 8, hub_tokens: 4, team_members: 2 };
  setAuth('owner');
  vi.mocked(getEffectivePlanWithSource).mockResolvedValue(exTrial() as never);
  vi.mocked(listActivePlans).mockResolvedValue([
    { id: 'free', name: 'Free', max_clients: 2, rate_report_generations_per_month: 2 },
  ] as never);
});

afterEach(() => {
  vi.useRealTimers();
  (window as unknown as { Capacitor?: unknown }).Capacitor = undefined;
});

describe('ReverseTrialEndedBanner', () => {
  it('ended_banner_shows_pause_date_then_paused', async () => {
    vi.setSystemTime(new Date('2026-12-10T12:00:00Z'));
    localStorage.setItem(`reverse_trial_ended_dialog_ws-1_${ENDED_AT}`, '1');
    const first = renderBanner();
    expect(
      await screen.findByText(
        'Seu workspace voltou para o Free em 8 de dezembro. Nada foi apagado.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Seus links do portal pausam em 15 de dezembro\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Recuperar o Pro' })).toHaveAttribute(
      'href',
      '/comecar?recomendado=pro',
    );
    first.unmount();

    vi.setSystemTime(new Date('2026-12-16T12:00:00Z'));
    renderBanner();
    expect(await screen.findByText(/Os links do portal estão pausados\./)).toBeInTheDocument();
  });

  it('omits the pause line when the workspace has no Hub links', async () => {
    vi.setSystemTime(new Date('2026-12-10T12:00:00Z'));
    localStorage.setItem(`reverse_trial_ended_dialog_ws-1_${ENDED_AT}`, '1');
    usage.value = { clients: 1, hub_tokens: 0, team_members: 1 };
    renderBanner();
    await screen.findByText(/Seu workspace voltou para o Free/);
    expect(screen.queryByText(/links do portal/)).toBeNull();
  });

  it('ended_dialog_once', async () => {
    vi.setSystemTime(new Date('2026-12-10T12:00:00Z'));
    const first = renderBanner();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Seu teste do Pro terminou')).toBeInTheDocument();
    expect(within(dialog).getByText('8 clientes.')).toBeInTheDocument();
    expect(
      await within(dialog).findByText(
        /Os 8 continuam aqui e editáveis, mas o Free só cadastra até 2\./,
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/Funcionam até 15 de dezembro/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Financeiro e contratos ficam só para consulta/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continuar no Free' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    first.unmount();

    renderBanner();
    await screen.findByText(/Seu workspace voltou para o Free/);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ended_native_text_only', async () => {
    vi.setSystemTime(new Date('2026-12-10T12:00:00Z'));
    (window as unknown as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    renderBanner();
    expect(
      await screen.findByText('Seu workspace está no Free desde 8 de dezembro.'),
    ).toBeInTheDocument();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('link')).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Entendi' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Recuperar o Pro' })).toBeNull();
  });

  it('shows nothing for agents or for a converted trial', async () => {
    setAuth('agent');
    const agent = renderBanner();
    expect(agent.container).toBeEmptyDOMElement();
    agent.unmount();

    setAuth('owner');
    vi.mocked(getEffectivePlanWithSource).mockResolvedValue(
      exTrial({
        planId: 'pro',
        planSource: 'stripe',
        reverseTrial: { ...exTrial().reverseTrial, outcome: 'converted' },
      }) as never,
    );
    const { container } = renderBanner();
    await waitFor(() => expect(getEffectivePlanWithSource).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });
});

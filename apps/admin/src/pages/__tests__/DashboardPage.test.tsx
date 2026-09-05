import { render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '../../components/ui/tooltip';

vi.mock('../../lib/api', () => ({
  listWorkspaces: vi.fn(),
  listPlans: vi.fn(),
  getMrr: vi.fn(),
  getTrials: vi.fn(),
}));

import {
  getMrr,
  getTrials,
  listPlans,
  listWorkspaces,
  type ListWorkspacesParams,
} from '../../lib/api';
import DashboardPage from '../DashboardPage';

const DAY = 86_400_000;
const soon = (days: number) => new Date(Date.now() + days * DAY).toISOString();

const RECENT = {
  total: 7,
  total_members: 12,
  total_clients: 31,
  total_with_overrides: 4,
  workspaces: [
    {
      id: 'a',
      name: 'A',
      member_count: 3,
      client_count: 4,
      has_overrides: false,
      created_at: soon(-10),
      last_activity_at: null,
      subscription: null,
      plan_name: 'Pro',
      owner: null,
      logo_url: null,
    },
    {
      id: 'b',
      name: 'B',
      member_count: 2,
      client_count: 2,
      has_overrides: true,
      created_at: soon(-10),
      last_activity_at: null,
      subscription: null,
      plan_name: 'Pro',
      owner: null,
      logo_url: null,
    },
  ],
};

const PENDING = {
  total: 6,
  total_members: 0,
  total_clients: 0,
  total_with_overrides: 0,
  workspaces: [
    {
      id: 'p1',
      name: 'Agência Norte',
      plan_name: 'Pro',
      logo_url: null,
      owner: null,
      member_count: 1,
      client_count: 1,
      has_overrides: false,
      created_at: soon(-200),
      last_activity_at: soon(-47),
      subscription: {
        status: 'past_due',
        plan_name: 'Pro',
        billing_interval: 'month',
        amount_cents: 19700,
        currency: 'brl',
        interval: 'month',
        discount_label: null,
        failed_payment_count: 3,
        provider: 'stripe',
        current_period_end: null,
      },
    },
  ],
};

// Implementations live in beforeEach: the global test setup runs
// vi.restoreAllMocks() after each test, wiping factory-time mocks.
beforeEach(() => {
  vi.mocked(listWorkspaces).mockImplementation(((params?: ListWorkspacesParams) =>
    Promise.resolve(params?.status === 'pendente' ? PENDING : RECENT)) as never);
  vi.mocked(listPlans).mockResolvedValue({ plans: [{ id: 'p1' }, { id: 'p2' }] } as never);
  // The Stripe-backed queries never resolve by default: the other cards must not wait for them.
  vi.mocked(getMrr).mockReturnValue(new Promise(() => {}) as never);
  vi.mocked(getTrials).mockReturnValue(new Promise(() => {}) as never);
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <MemoryRouter>
          <DashboardPage />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

/** The KPI card element whose label text is `label` (labels are <p>; table headers are <span>). */
function kpiCard(label: string): HTMLElement {
  return screen.getByText(label, { selector: 'p' }).closest('div')!;
}

describe('DashboardPage per-card loading', () => {
  it('shows workspace and plan KPIs while the Stripe-backed queries are still loading', async () => {
    renderPage();
    await waitFor(() => expect(kpiCard('Workspaces').textContent).toContain('7'));
    expect(kpiCard('Usuários').textContent).toContain('12');
    expect(kpiCard('Clientes').textContent).toContain('31');
    expect(kpiCard('Planos ativos').textContent).toContain('2');
    expect(kpiCard('Com overrides').textContent).toContain('4');
  });

  it('keeps the MRR-dependent cards on their placeholder while pending', async () => {
    renderPage();
    await waitFor(() => expect(kpiCard('Workspaces').textContent).toContain('7'));
    expect(kpiCard('MRR').textContent).toContain('—');
    expect(kpiCard('Testes').textContent).toContain('—');
    expect(kpiCard('MRR total').textContent).toContain('—');
    expect(kpiCard('Em risco').textContent).toContain('—');
  });

  it('recent workspace names are real links to the detail page', async () => {
    renderPage();
    const links = await screen.findAllByRole('link', { name: 'A' });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toHaveAttribute('href', '/admin/workspaces/a');
    }
  });
});

describe('DashboardPage at-risk card', () => {
  it('sums trials ending soon and pending subscriptions into the Em risco KPI', async () => {
    vi.mocked(getTrials).mockResolvedValue({
      trial_count: 3,
      trial_mrr_cents: 0,
      currency: 'brl',
      trials: [
        {
          workspace_id: 't1',
          name: 'Nova Onda',
          plan_name: 'Pro',
          interval: 'month',
          trial_ends_at: soon(1),
          monthly_cents: 19700,
          owner_name: null,
          owner_email: null,
          owner_telefone: null,
          owner_marketing_opt_in: false,
          created_at: soon(-5),
          last_activity_at: soon(-1),
        },
        {
          workspace_id: 't2',
          name: 'Longe',
          plan_name: 'Pro',
          interval: 'month',
          trial_ends_at: soon(20),
          monthly_cents: 19700,
          owner_name: null,
          owner_email: null,
          owner_telefone: null,
          owner_marketing_opt_in: false,
          created_at: soon(-5),
          last_activity_at: null,
        },
      ],
    } as never);
    renderPage();
    await waitFor(() => expect(kpiCard('Em risco').textContent).toContain('7')); // 1 trial + 6 pending
    expect(kpiCard('Em risco').textContent).toContain('1 teste vencendo');
    expect(kpiCard('Em risco').textContent).toContain('6 pendentes');

    // Scoped to the risk card: the legacy "Testes" list further down the page
    // renders the same trialsData, so an unscoped query would see it twice.
    const riskCard = within(await screen.findByTestId('risk-card'));
    expect(riskCard.getByText('Nova Onda')).toBeInTheDocument();
    expect(riskCard.queryByText('Longe')).toBeNull();
    expect(riskCard.getByText('amanhã')).toBeInTheDocument();
    expect(riskCard.getByText('Agência Norte')).toBeInTheDocument();
    expect(riskCard.getByText('3ª tentativa')).toBeInTheDocument();
    expect(riskCard.getByText('+5 workspaces')).toBeInTheDocument();
  });

  it('exposes a keyboard-reachable link on each risk row to the workspace detail page', async () => {
    vi.mocked(getTrials).mockResolvedValue({
      trial_count: 3,
      trial_mrr_cents: 0,
      currency: 'brl',
      trials: [
        {
          workspace_id: 't1',
          name: 'Nova Onda',
          plan_name: 'Pro',
          interval: 'month',
          trial_ends_at: soon(1),
          monthly_cents: 19700,
          owner_name: null,
          owner_email: null,
          owner_telefone: null,
          owner_marketing_opt_in: false,
          created_at: soon(-5),
          last_activity_at: soon(-1),
        },
      ],
    } as never);
    renderPage();

    const riskCard = within(await screen.findByTestId('risk-card'));
    await riskCard.findByText('Nova Onda');
    const links = riskCard.getAllByRole('link');
    expect(links.length).toBeGreaterThan(0);
    expect(links.some((link) => link.getAttribute('href')?.startsWith('/admin/workspaces/'))).toBe(
      true,
    );
    expect(riskCard.getByRole('link', { name: 'Nova Onda' })).toHaveAttribute(
      'href',
      '/admin/workspaces/t1',
    );
    expect(riskCard.getByRole('link', { name: 'Agência Norte' })).toHaveAttribute(
      'href',
      '/admin/workspaces/p1',
    );
  });

  it('shows "Tudo em ordem" when both groups are empty', async () => {
    vi.mocked(getTrials).mockResolvedValue({
      trial_count: 0,
      trial_mrr_cents: 0,
      currency: 'brl',
      trials: [],
    } as never);
    vi.mocked(listWorkspaces).mockImplementation(((params?: ListWorkspacesParams) =>
      Promise.resolve(
        params?.status === 'pendente' ? { ...PENDING, total: 0, workspaces: [] } : RECENT,
      )) as never);
    renderPage();
    expect(await screen.findByText(/Tudo em ordem/)).toBeInTheDocument();
  });

  it('keeps the Em risco KPI on the placeholder when a source fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getTrials).mockRejectedValue(new Error('boom'));
    renderPage();
    await waitFor(() =>
      expect(kpiCard('Em risco').textContent).toContain('Não foi possível carregar'),
    );
    expect(kpiCard('Em risco').textContent).toContain('—');
    expect(kpiCard('Em risco').textContent).not.toMatch(/\b0 testes vencendo/);
    consoleErrorSpy.mockRestore();
  });
});

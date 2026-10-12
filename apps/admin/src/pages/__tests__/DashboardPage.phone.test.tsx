import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '../../components/ui/tooltip';
import { mockPhone } from '../../__tests__/phone';

vi.mock('../../lib/api', () => ({
  listWorkspaces: vi.fn(),
  getMrr: vi.fn(),
  getTrials: vi.fn(),
}));

import { getMrr, getTrials, listWorkspaces, type ListWorkspacesParams } from '../../lib/api';
import DashboardPage from '../DashboardPage';

const DAY = 86_400_000;
const soon = (days: number) => new Date(Date.now() + days * DAY).toISOString();

const RECENT = {
  total: 7,
  total_members: 12,
  total_clients: 31,
  total_with_overrides: 4,
  total_instagram_accounts: 18,
  total_instagram_accounts_active: 15,
  workspaces: [
    {
      id: 'a',
      name: 'Ateliê Digital',
      member_count: 3,
      client_count: 4,
      has_overrides: false,
      created_at: soon(-10),
      last_activity_at: null,
      subscription: null,
      plan_name: 'Pro',
      owner: { name: 'Marina' },
      logo_url: null,
    },
  ],
};

const PENDING = {
  ...RECENT,
  total: 1,
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

const TRIAL = {
  workspace_id: 't1',
  name: 'Social Bee',
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
};

let restorePhone: () => void;

beforeEach(() => {
  restorePhone = mockPhone();
  vi.mocked(listWorkspaces).mockImplementation(((params?: ListWorkspacesParams) =>
    Promise.resolve(params?.status === 'pendente' ? PENDING : RECENT)) as never);
  vi.mocked(getMrr).mockResolvedValue({
    mrr_cents: 29700,
    paying_count: 1,
    currency: 'brl',
    workspaces: [
      {
        workspace_id: 'w1',
        name: 'DK Marketing Médico',
        plan_name: 'Max',
        status: 'active',
        interval: 'year',
        monthly_cents: 29700,
        discount_label: null,
        amount_source: 'stripe',
        owner_name: null,
        owner_email: null,
        owner_telefone: null,
        owner_marketing_opt_in: false,
        created_at: soon(-300),
        last_activity_at: soon(-1),
      },
    ],
  } as never);
  vi.mocked(getTrials).mockResolvedValue({
    trial_count: 1,
    trial_mrr_cents: 19700,
    currency: 'brl',
    trials: [TRIAL],
  } as never);
});

afterEach(() => restorePhone());

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

describe('DashboardPage on phones', () => {
  it('shows the large title and the KPI tiles', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    expect(await screen.findByText('Em risco')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('18')).toBeInTheDocument());
    expect(screen.getByText('3 precisam reconectar')).toBeInTheDocument();
  });

  it('links the MRR tiles to the Métricas MRR section', async () => {
    renderPage();
    await screen.findByText('MRR projetado');
    const tiles = screen
      .getAllByRole('link')
      .filter((a) => a.getAttribute('href') === '/admin/metricas#mrr');
    expect(tiles).toHaveLength(3);
  });

  it('lists the at-risk workspaces as links to the workspace detail', async () => {
    renderPage();
    const risk = within(await screen.findByTestId('risk-card'));
    expect(await risk.findByRole('link', { name: /Social Bee/ })).toHaveAttribute(
      'href',
      '/admin/workspaces/t1',
    );
    expect(risk.getByRole('link', { name: /Agência Norte/ })).toHaveAttribute(
      'href',
      '/admin/workspaces/p1',
    );
    expect(risk.getByText('amanhã')).toBeInTheDocument();
    expect(risk.getByText('3ª tentativa')).toBeInTheDocument();
  });

  it('filters the risk groups with the segmented control', async () => {
    const user = userEvent.setup();
    renderPage();
    const risk = within(await screen.findByTestId('risk-card'));
    await risk.findByRole('link', { name: /Social Bee/ });
    await user.click(risk.getByRole('tab', { name: /^Pendentes/ }));
    expect(risk.queryByRole('link', { name: /Social Bee/ })).toBeNull();
    expect(risk.getByRole('link', { name: /Agência Norte/ })).toBeInTheDocument();
  });

  it('renders the paying, trial and recent workspace lists as links', async () => {
    renderPage();
    expect(await screen.findByRole('link', { name: /DK Marketing Médico/ })).toHaveAttribute(
      'href',
      '/admin/workspaces/w1',
    );
    expect(screen.getByRole('link', { name: /Ateliê Digital/ })).toHaveAttribute(
      'href',
      '/admin/workspaces/a',
    );
    const trialLinks = screen.getAllByRole('link', { name: /Social Bee/ });
    expect(trialLinks.length).toBeGreaterThan(0);
  });

  it('offers no CSV export on phones', async () => {
    renderPage();
    await screen.findByRole('link', { name: /DK Marketing Médico/ });
    expect(screen.queryByRole('button', { name: /Exportar CSV/ })).toBeNull();
  });
});

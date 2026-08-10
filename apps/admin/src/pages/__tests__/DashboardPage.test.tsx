import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/api', () => ({
  listWorkspaces: vi.fn(),
  listPlans: vi.fn(),
  getMrr: vi.fn(),
  getTrials: vi.fn(),
}));

import { getMrr, getTrials, listPlans, listWorkspaces } from '../../lib/api';
import DashboardPage from '../DashboardPage';

// Implementations live in beforeEach: the global test setup runs
// vi.restoreAllMocks() after each test, wiping factory-time mocks.
beforeEach(() => {
  vi.mocked(listWorkspaces).mockResolvedValue({
    total: 7,
    // Platform-wide, deliberately different from what the page's rows imply
    // (member_count sum 5, client_count sum 6, one has_overrides): the Total
    // Users, Total Clients and With Overrides cards must read these, not
    // derive from the fetched page.
    total_members: 12,
    total_clients: 31,
    total_with_overrides: 4,
    workspaces: [
      { id: 'a', member_count: 3, client_count: 4, has_overrides: false },
      { id: 'b', member_count: 2, client_count: 2, has_overrides: true },
    ],
  } as never);
  vi.mocked(listPlans).mockResolvedValue({ plans: [{ id: 'p1' }, { id: 'p2' }] } as never);
  // The Stripe-backed queries never resolve in these tests: the point is that
  // the other cards must not wait for them.
  vi.mocked(getMrr).mockReturnValue(new Promise(() => {}) as never);
  vi.mocked(getTrials).mockReturnValue(new Promise(() => {}) as never);
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
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
    expect(kpiCard('Total Users').textContent).toContain('12'); // platform-wide total_members
    expect(kpiCard('Total Clients').textContent).toContain('31'); // platform-wide total_clients
    expect(kpiCard('Active Plans').textContent).toContain('2');
    expect(kpiCard('With Overrides').textContent).toContain('4'); // platform-wide total_with_overrides
  });

  it('keeps the MRR-dependent cards on their placeholder while pending', async () => {
    renderPage();
    await waitFor(() => expect(kpiCard('Workspaces').textContent).toContain('7'));
    expect(kpiCard('MRR').textContent).toContain('—');
    expect(kpiCard('Trials').textContent).toContain('—');
    expect(kpiCard('Total MRR').textContent).toContain('—');
  });
});

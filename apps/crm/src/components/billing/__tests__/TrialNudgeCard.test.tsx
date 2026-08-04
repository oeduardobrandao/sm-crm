import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/services/billing', () => ({
  getWorkspaceSubscription: vi.fn(),
  getEffectivePlanId: vi.fn(),
}));
vi.mock('@/lib/analytics', () => ({ captureEvent: vi.fn() }));

import { useAuth } from '@/context/AuthContext';
import { getEffectivePlanId, getWorkspaceSubscription } from '@/services/billing';
import { TrialNudgeCard } from '../TrialNudgeCard';

const NEVER_SUBSCRIBED = { hasEverSubscribed: false } as never;

beforeEach(() => {
  localStorage.clear();
  // Call counts, not just return values: the dismissal test asserts the gate
  // stops the fetches from ever being issued.
  vi.clearAllMocks();
  vi.mocked(useAuth).mockReturnValue({ role: 'owner', profile: { conta_id: 'ws-1' } } as never);
  vi.mocked(getEffectivePlanId).mockResolvedValue('free');
  vi.mocked(getWorkspaceSubscription).mockResolvedValue(NEVER_SUBSCRIBED);
});

function renderCard(seedCache?: { planId: string | null; hasEverSubscribed: boolean }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (seedCache) {
    client.setQueryData(['billing', 'effective-plan'], seedCache.planId);
    client.setQueryData(['billing', 'subscription'], {
      hasEverSubscribed: seedCache.hasEverSubscribed,
    });
  }
  return {
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <TrialNudgeCard />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
    client,
  };
}

/**
 * Positive anchor for the negative assertions below. The card renders nothing
 * when a gate closes, so `queryByText(...).not.toBeInTheDocument()` on its own
 * passes just as happily while the queries are still in flight — it would keep
 * passing with the gate deleted. Waiting for both queries to actually reach
 * `success` is what makes the absence mean something.
 */
async function waitForBillingQueriesToSettle(client: QueryClient) {
  await waitFor(() => {
    expect(client.getQueryState(['billing', 'effective-plan'])?.status).toBe('success');
    expect(client.getQueryState(['billing', 'subscription'])?.status).toBe('success');
  });
}

const TITLE = /30 dias grátis ainda estão disponíveis/i;

describe('TrialNudgeCard', () => {
  it('shows for a never-subscribed Free owner', async () => {
    renderCard();
    expect(await screen.findByText(TITLE)).toBeInTheDocument();
  });

  it('hides for a non-owner', async () => {
    // Seeded for the same reason as the dismissal case: the role gate disables
    // both queries, so without cached data the absence would prove nothing.
    vi.mocked(useAuth).mockReturnValue({ role: 'agent', profile: { conta_id: 'ws-1' } } as never);
    renderCard({ planId: 'free', hasEverSubscribed: false });
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
    expect(getEffectivePlanId).not.toHaveBeenCalled();
    expect(getWorkspaceSubscription).not.toHaveBeenCalled();
  });

  it('hides on a paid plan', async () => {
    vi.mocked(getEffectivePlanId).mockResolvedValue('pro');
    const { client } = renderCard();
    await waitForBillingQueriesToSettle(client);
    expect(client.getQueryData(['billing', 'effective-plan'])).toBe('pro');
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
  });

  it('hides for a workspace that subscribed before', async () => {
    vi.mocked(getWorkspaceSubscription).mockResolvedValue({ hasEverSubscribed: true } as never);
    const { client } = renderCard();
    await waitForBillingQueriesToSettle(client);
    expect(client.getQueryData(['billing', 'subscription'])).toEqual({ hasEverSubscribed: true });
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
  });

  it('stays hidden within seven days of a dismissal', async () => {
    // A dismissal disables both queries, so there is nothing async to wait for.
    // Seeding the cache with the exact data that DOES render the card removes
    // the loading escape hatch: react-query serves cached data on the first
    // render, so the dismissal gate is the only thing left holding the card
    // back. Delete the gate and this test fails.
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
    localStorage.setItem('trial_nudge_dismissed_ws-1', twoDaysAgo);
    const { client } = renderCard({ planId: 'free', hasEverSubscribed: false });
    expect(client.getQueryData(['billing', 'effective-plan'])).toBe('free');
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
    // The gate must also stop the fetches, not merely hide their result.
    expect(getEffectivePlanId).not.toHaveBeenCalled();
    expect(getWorkspaceSubscription).not.toHaveBeenCalled();
  });

  it('resurfaces more than seven days after a dismissal', async () => {
    const longAgo = new Date(Date.now() - 8 * 86_400_000).toISOString();
    localStorage.setItem('trial_nudge_dismissed_ws-1', longAgo);
    renderCard();
    expect(await screen.findByText(TITLE)).toBeInTheDocument();
  });

  it('shows when the stored dismissal value is unparseable', async () => {
    localStorage.setItem('trial_nudge_dismissed_ws-1', 'not-a-date');
    renderCard();
    expect(await screen.findByText(TITLE)).toBeInTheDocument();
  });

  it('shows for a brand-new workspace whose effective plan id is still null', async () => {
    // handle_new_user never sets workspaces.plan_id and there's no DB default, so a
    // never-touched-billing workspace has plan_id = NULL. That must resolve to
    // 'free', not be compared against it directly.
    vi.mocked(getEffectivePlanId).mockResolvedValue(null);
    renderCard();
    expect(await screen.findByText(TITLE)).toBeInTheDocument();
  });

  it('shows when workspaceRole is owner despite a stale profile-level agent role', async () => {
    vi.mocked(useAuth).mockReturnValue({
      role: 'agent',
      workspaceRole: 'owner',
      profile: { conta_id: 'ws-1' },
    } as never);
    renderCard();
    expect(await screen.findByText(TITLE)).toBeInTheDocument();
  });
});

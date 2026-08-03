import { render, screen } from '@testing-library/react';
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
  vi.mocked(useAuth).mockReturnValue({ role: 'owner', profile: { conta_id: 'ws-1' } } as never);
  vi.mocked(getEffectivePlanId).mockResolvedValue('free');
  vi.mocked(getWorkspaceSubscription).mockResolvedValue(NEVER_SUBSCRIBED);
});

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TrialNudgeCard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const TITLE = /30 dias grátis ainda estão disponíveis/i;

describe('TrialNudgeCard', () => {
  it('shows for a never-subscribed Free owner', async () => {
    renderCard();
    expect(await screen.findByText(TITLE)).toBeInTheDocument();
  });

  it('hides for a non-owner', async () => {
    vi.mocked(useAuth).mockReturnValue({ role: 'agent', profile: { conta_id: 'ws-1' } } as never);
    renderCard();
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
  });

  it('hides on a paid plan', async () => {
    vi.mocked(getEffectivePlanId).mockResolvedValue('pro');
    renderCard();
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
  });

  it('hides for a workspace that subscribed before', async () => {
    vi.mocked(getWorkspaceSubscription).mockResolvedValue({ hasEverSubscribed: true } as never);
    renderCard();
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
  });

  it('stays hidden within seven days of a dismissal', async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
    localStorage.setItem('trial_nudge_dismissed_ws-1', twoDaysAgo);
    renderCard();
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
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

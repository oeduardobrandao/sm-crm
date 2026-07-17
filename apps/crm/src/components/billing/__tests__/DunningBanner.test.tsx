import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DunningBanner } from '../DunningBanner';

const { getWorkspaceSubscriptionMock, useAuthMock } = vi.hoisted(() => ({
  getWorkspaceSubscriptionMock: vi.fn(),
  useAuthMock: vi.fn(),
}));

vi.mock('../../../services/billing', () => ({
  getWorkspaceSubscription: getWorkspaceSubscriptionMock,
}));

vi.mock('../../../context/AuthContext', () => ({
  useAuth: useAuthMock,
}));

function renderBanner() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DunningBanner />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DunningBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({ profile: { role: 'owner', conta_id: 'ws-1' } });
  });

  it('warns the owner when the subscription is past_due', async () => {
    getWorkspaceSubscriptionMock.mockResolvedValue({
      status: 'past_due',
      plan_id: 'pro',
      current_period_end: null,
      cancel_at_period_end: false,
      past_due_since: '2026-07-17T10:00:00.000Z',
      next_payment_attempt: '2026-07-24T10:00:00.000Z',
    });
    renderBanner();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/não conseguimos processar/i)).toBeInTheDocument();
  });

  it('stays silent when the subscription is healthy', async () => {
    getWorkspaceSubscriptionMock.mockResolvedValue({
      status: 'active',
      plan_id: 'pro',
      current_period_end: null,
      cancel_at_period_end: false,
      past_due_since: null,
      next_payment_attempt: null,
    });
    renderBanner();
    await waitFor(() => expect(getWorkspaceSubscriptionMock).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not query or render for a non-owner', async () => {
    // RLS already hides the row from non-owners; this keeps agents from seeing a billing problem
    // they cannot act on, and avoids a guaranteed-empty request on every page load.
    useAuthMock.mockReturnValue({ profile: { role: 'agent', conta_id: 'ws-1' } });
    renderBanner();
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(getWorkspaceSubscriptionMock).not.toHaveBeenCalled();
  });
});

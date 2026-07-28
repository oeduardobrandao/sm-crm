import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { useAuthMock, storeMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  storeMock: {
    getInitials: vi.fn((name: string) => (name ? name[0].toUpperCase() : '?')),
    getWorkspaceUsers: vi.fn(async () => []),
    removeWorkspaceUser: vi.fn(async () => {}),
    updateWorkspaceUserRole: vi.fn(async () => {}),
  },
}));

vi.mock('../../../../context/AuthContext', () => ({
  useAuth: useAuthMock,
}));

vi.mock('../../../../store', () => storeMock);

vi.mock('@/lib/analytics', () => ({ captureEvent: vi.fn() }));

vi.mock('../../../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { access_token: 'tok' } } })),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          in: () => ({
            order: async () => ({ data: [] }),
          }),
        }),
      }),
    }),
  },
}));

import MembrosTab from '../MembrosTab';

function renderTab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MembrosTab />
    </QueryClientProvider>,
  );
}

/**
 * `profile.role`/`role` (from `profiles.role`) goes stale on workspace switch —
 * no switch path writes it. `workspaceRole` (from `workspace_members`) is the
 * correct, per-workspace source. These tests pin the motivation for Task 9:
 * the member query and management actions must key off `workspaceRole`, not
 * the stale `role`, in both directions.
 */
function setAuth({
  workspaceRole,
  staleProfileRole,
}: {
  workspaceRole: 'owner' | 'admin' | 'agent' | null;
  staleProfileRole: 'owner' | 'admin' | 'agent';
}) {
  useAuthMock.mockReturnValue({
    user: { id: 'me', email: 'me@exemplo.com' },
    profile: { id: 'me', nome: 'Eu', conta_id: 'ws-1', role: staleProfileRole },
    role: staleProfileRole,
    workspaceRole,
    loading: false,
    signOut: vi.fn(),
    refetchProfile: vi.fn(),
  });
}

describe('MembrosTab — member query gated on workspaceRole', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeMock.getWorkspaceUsers.mockResolvedValue([
      { id: 'u1', nome: 'Ana Owner', role: 'owner', avatar_url: null, created_at: '2026-01-01' },
      { id: 'u2', nome: 'Beto Admin', role: 'admin', avatar_url: null, created_at: '2026-01-02' },
    ]);
  });

  it('lets a genuine owner see the member list even when profiles.role is stale ("agent")', async () => {
    setAuth({ workspaceRole: 'owner', staleProfileRole: 'agent' });
    renderTab();

    await waitFor(() => {
      expect(screen.getByText('Ana Owner')).toBeInTheDocument();
    });
    expect(screen.getByText('Beto Admin')).toBeInTheDocument();
    expect(storeMock.getWorkspaceUsers).toHaveBeenCalled();
  });

  it('blocks the member query for a real agent even when profiles.role says "owner"', async () => {
    setAuth({ workspaceRole: 'agent', staleProfileRole: 'owner' });
    renderTab();

    // Give the query a tick to run if it were (incorrectly) enabled.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(storeMock.getWorkspaceUsers).not.toHaveBeenCalled();
    expect(screen.queryByText('Ana Owner')).not.toBeInTheDocument();
  });
});

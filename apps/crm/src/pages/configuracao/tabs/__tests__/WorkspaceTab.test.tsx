import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCan, fakeMembership } from '@/test/makeCan';

const { useAuthMock, storeMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  storeMock: {
    getCurrentWorkspace: vi.fn(async () => ({
      id: 'ws-1',
      name: 'Workspace Teste',
      logo_url: null,
    })),
    updateWorkspace: vi.fn(async () => {}),
  },
}));

vi.mock('../../../../context/AuthContext', () => ({
  useAuth: useAuthMock,
}));

vi.mock('../../../../store', () => storeMock);

vi.mock('../../../../lib/supabase', () => ({
  supabase: {
    storage: {
      from: () => ({
        upload: vi.fn(async () => ({ error: null })),
        getPublicUrl: vi.fn(() => ({ data: { publicUrl: 'https://cdn.example.com/logo.png' } })),
      }),
    },
    from: () => ({
      select: () => ({ eq: async () => ({ data: [] }) }),
      update: () => ({ in: async () => ({ error: null }) }),
    }),
  },
}));

import WorkspaceTab from '../WorkspaceTab';

function renderTab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <WorkspaceTab />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * Task 14: `isOwnerOrAdmin = role === 'owner' || role === 'admin'` collapsed
 * onto `can('configuracoes', 'ver') === true`, gating both this tab's
 * queries (`currentWorkspace`, `igAccountsForSync`). `AGENT_ROLE_PRESET.
 * configuracoes` is 'none' and admin resolves to `true` for every
 * non-financial module (lib/permissions.ts), so the two legacy-preset cases
 * below reproduce the OLD isOwnerOrAdmin gate byte-for-byte -- only a CUSTOM
 * role (role_id set) can now diverge from its chassis role.
 */
describe('WorkspaceTab — queries gated on configuracoes:ver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeMock.getCurrentWorkspace.mockResolvedValue({
      id: 'ws-1',
      name: 'Workspace Teste',
      logo_url: null,
    });
  });

  it('keeps a legacy agent blocked (configuracoes preset is none, matches the old isOwnerOrAdmin gate)', async () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'user-1', conta_id: 'ws-1' },
      can: makeCan(fakeMembership({ role: 'agent' })),
    });
    renderTab();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(storeMock.getCurrentWorkspace).not.toHaveBeenCalled();
    expect(screen.queryByText('Workspace')).not.toBeInTheDocument();
  });

  it('keeps a legacy admin unchanged (configuracoes preset resolves to true)', async () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'user-1', conta_id: 'ws-1' },
      can: makeCan(fakeMembership({ role: 'admin' })),
    });
    renderTab();

    await waitFor(() => {
      expect(storeMock.getCurrentWorkspace).toHaveBeenCalled();
    });
    expect(await screen.findByText('Workspace')).toBeInTheDocument();
  });

  it('blocks the queries for a custom role with no configuracoes grant at all', async () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'user-1', conta_id: 'ws-1' },
      can: makeCan(fakeMembership({ role: 'agent', role_id: 'role-1', permissions: {} })),
    });
    renderTab();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(storeMock.getCurrentWorkspace).not.toHaveBeenCalled();
  });

  it('unblocks the queries for a custom role with configuracoes:ver alone', async () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'user-1', conta_id: 'ws-1' },
      can: makeCan(
        fakeMembership({ role: 'agent', role_id: 'role-1', permissions: { configuracoes: 'ver' } }),
      ),
    });
    renderTab();

    await waitFor(() => {
      expect(storeMock.getCurrentWorkspace).toHaveBeenCalled();
    });
  });

  it('unblocks the queries for a custom role with configuracoes:editar (the fix)', async () => {
    useAuthMock.mockReturnValue({
      profile: { id: 'user-1', conta_id: 'ws-1' },
      can: makeCan(
        fakeMembership({
          role: 'agent',
          role_id: 'role-1',
          permissions: { configuracoes: 'editar' },
        }),
      ),
    });
    renderTab();

    await waitFor(() => {
      expect(storeMock.getCurrentWorkspace).toHaveBeenCalled();
    });
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { useAuthMock, storeMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  storeMock: {
    getInitials: vi.fn((name: string) => (name ? name[0].toUpperCase() : '?')),
    getWorkspaceUsers: vi.fn(async () => []),
    removeWorkspaceUser: vi.fn(async () => {}),
    updateWorkspaceUserRole: vi.fn(async () => {}),
    setWorkspaceUserFinancialAccess: vi.fn(async () => {}),
  },
}));

vi.mock('../../../../context/AuthContext', () => ({
  useAuth: useAuthMock,
}));

vi.mock('../../../../store', () => storeMock);

vi.mock('@/lib/analytics', () => ({ captureEvent: vi.fn() }));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// Radix Switch — mocked to a plain native checkbox (checked/onCheckedChange/
// disabled/aria-label), same convention as TikTokSettingsPanel.test.tsx's
// Switch mock, so toggling can be driven with a plain fireEvent.click.
vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    checked,
    onCheckedChange,
    disabled,
    'aria-label': ariaLabel,
  }: {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    disabled?: boolean;
    'aria-label'?: string;
  }) => (
    <input
      type="checkbox"
      role="switch"
      aria-label={ariaLabel}
      checked={checked ?? false}
      disabled={disabled}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
}));

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

import { toast } from 'sonner';
import MembrosTab from '../MembrosTab';
import { makeCan, fakeMembership } from '@/test/makeCan';
import type { PermissionAction, PermissionCheck, PermissionModule } from '@/lib/permissions';

type CanFn = (module: PermissionModule, action?: PermissionAction) => PermissionCheck;

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
  can,
}: {
  workspaceRole: 'owner' | 'admin' | 'agent' | null;
  staleProfileRole: 'owner' | 'admin' | 'agent';
  /**
   * Override for a custom-role scenario. Defaults to a real
   * derivePermission-backed `can` for a LEGACY membership of `workspaceRole`
   * (never derived from the stale `staleProfileRole`, mirroring the real
   * AuthContext) — pass this explicitly to simulate a custom role_id/permissions
   * membership instead.
   */
  can?: CanFn;
}) {
  useAuthMock.mockReturnValue({
    user: { id: 'me', email: 'me@exemplo.com' },
    profile: { id: 'me', nome: 'Eu', conta_id: 'ws-1', role: staleProfileRole },
    role: staleProfileRole,
    workspaceRole,
    can: can ?? makeCan(workspaceRole === null ? null : fakeMembership({ role: workspaceRole })),
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

/**
 * Financial-access toggle (Task 14). The switch is meaningful only for admin
 * targets and only for an owner viewer: the setter rejects any other target,
 * and the flag is a no-op for owners (always allowed) and agents (never
 * allowed). Rendering it elsewhere would offer a control that always errors.
 */
describe('MembrosTab — financial access toggle', () => {
  const membersRow = [
    { id: 'u1', nome: 'Ana Owner', role: 'owner', avatar_url: null, created_at: '2026-01-01' },
    {
      id: 'u2',
      nome: 'Beto Admin',
      role: 'admin',
      can_see_financials: false,
      avatar_url: null,
      created_at: '2026-01-02',
    },
    {
      id: 'u3',
      nome: 'Clara Agente',
      role: 'agent',
      can_see_financials: false,
      avatar_url: null,
      created_at: '2026-01-03',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    storeMock.getWorkspaceUsers.mockResolvedValue(membersRow);
  });

  it('renders the switch only on the admin row when the viewer is the owner', async () => {
    setAuth({ workspaceRole: 'owner', staleProfileRole: 'owner' });
    renderTab();

    await screen.findByText('Beto Admin');
    await screen.findByText('Clara Agente');

    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(1);
    expect(switches[0]).toHaveAccessibleName('Acesso financeiro de Beto Admin');
  });

  it('renders no switch at all for a non-owner viewer, even though admin rows are visible', async () => {
    setAuth({ workspaceRole: 'admin', staleProfileRole: 'admin' });
    renderTab();

    await screen.findByText('Beto Admin');

    expect(screen.queryAllByRole('switch')).toHaveLength(0);
  });

  it('toggling the switch calls setWorkspaceUserFinancialAccess with the target id and new value, then refetches', async () => {
    setAuth({ workspaceRole: 'owner', staleProfileRole: 'owner' });
    storeMock.setWorkspaceUserFinancialAccess.mockResolvedValueOnce(undefined);
    renderTab();

    await screen.findByText('Beto Admin');
    expect(storeMock.getWorkspaceUsers).toHaveBeenCalledTimes(1);

    const toggle = screen.getByRole('switch', { name: 'Acesso financeiro de Beto Admin' });
    expect(toggle).not.toBeChecked();

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(storeMock.setWorkspaceUserFinancialAccess).toHaveBeenCalledWith('u2', true);
    });
    expect(toast.success).toHaveBeenCalledWith('Acesso financeiro liberado.');
    expect(toast.error).not.toHaveBeenCalled();
    // A refetch, not an optimistic local flip, is what is expected to reflect
    // the new state — the mocked getWorkspaceUsers call count is the proxy.
    await waitFor(() => {
      expect(storeMock.getWorkspaceUsers).toHaveBeenCalledTimes(2);
    });
  });

  it('does not flip the switch before the server call resolves (no optimistic update)', async () => {
    setAuth({ workspaceRole: 'owner', staleProfileRole: 'owner' });
    let resolveSet: () => void = () => {};
    storeMock.setWorkspaceUserFinancialAccess.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSet = resolve;
        }),
    );
    // Second call is the post-toggle refetch; only then does the row report
    // the new value.
    storeMock.getWorkspaceUsers
      .mockResolvedValueOnce(membersRow)
      .mockResolvedValueOnce(
        membersRow.map((m) => (m.id === 'u2' ? { ...m, can_see_financials: true } : m)),
      );
    renderTab();

    await screen.findByText('Beto Admin');
    const toggle = screen.getByRole('switch', { name: 'Acesso financeiro de Beto Admin' });
    expect(toggle).not.toBeChecked();

    fireEvent.click(toggle);

    // The mutation is in flight (unresolved) — the switch must still show the
    // pre-toggle, server-backed state, not a locally-flipped optimistic one.
    expect(toggle).not.toBeChecked();

    resolveSet();

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Acesso financeiro de Beto Admin' })).toBeChecked();
    });
  });

  it('shows an error toast, not a success toast, when the server rejects the change', async () => {
    setAuth({ workspaceRole: 'owner', staleProfileRole: 'owner' });
    storeMock.setWorkspaceUserFinancialAccess.mockRejectedValueOnce(new Error('not_owner'));
    renderTab();

    await screen.findByText('Beto Admin');
    const toggle = screen.getByRole('switch', { name: 'Acesso financeiro de Beto Admin' });

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Não foi possível atualizar o acesso.');
    });
    expect(toast.success).not.toHaveBeenCalled();
    // The switch reflects server state only, and the server call failed, so it
    // must remain exactly as it was before the click.
    expect(toggle).not.toBeChecked();
  });
});

/**
 * configTabs.ts gates the `membros` TAB itself on `equipe:ver` (Task 12), a
 * strictly broader condition than the OLD staff-only role gate: a custom role
 * granted only `equipe:ver` (not `editar`) can now reach this component,
 * which must therefore stop rendering the mutation controls it cannot
 * actually use — the invite-user / manage-workspace-user edge functions
 * already enforce `equipe:editar` server-side (Task 11), so this is a UI
 * consistency fix, not the real authorization boundary.
 */
describe('MembrosTab — action buttons gated on equipe:editar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeMock.getWorkspaceUsers.mockResolvedValue([
      { id: 'u1', nome: 'Ana Owner', role: 'owner', avatar_url: null, created_at: '2026-01-01' },
      { id: 'u2', nome: 'Beto Admin', role: 'admin', avatar_url: null, created_at: '2026-01-02' },
    ]);
  });

  it('loads the list but hides Convidar/Função/Remover for a custom role with equipe:ver only', async () => {
    setAuth({
      workspaceRole: 'agent',
      staleProfileRole: 'agent',
      can: makeCan(
        fakeMembership({ role: 'agent', role_id: 'role-1', permissions: { equipe: 'ver' } }),
      ),
    });
    renderTab();

    await screen.findByText('Ana Owner');
    expect(storeMock.getWorkspaceUsers).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Convidar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Função' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remover' })).not.toBeInTheDocument();
  });

  it('shows Convidar/Função/Remover for a custom role with equipe:editar', async () => {
    setAuth({
      workspaceRole: 'agent',
      staleProfileRole: 'agent',
      can: makeCan(
        fakeMembership({ role: 'agent', role_id: 'role-1', permissions: { equipe: 'editar' } }),
      ),
    });
    renderTab();

    await screen.findByText('Ana Owner');
    expect(screen.getByRole('button', { name: /Convidar/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Função' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Remover' }).length).toBeGreaterThan(0);
  });

  it('a legacy owner/admin (unconditional equipe:editar) still sees every action button — no regression', async () => {
    setAuth({ workspaceRole: 'admin', staleProfileRole: 'admin' });
    renderTab();

    await screen.findByText('Ana Owner');
    expect(screen.getByRole('button', { name: /Convidar/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Função' }).length).toBeGreaterThan(0);
  });
});

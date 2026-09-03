import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { useAuthMock, storeMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  storeMock: {
    getInitials: vi.fn((name: string) => (name ? name[0].toUpperCase() : '?')),
    getWorkspaceUsers: vi.fn(async () => []),
    getWorkspaceRoles: vi.fn(async () => [] as { id: string; nome: string }[]),
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

// Radix Select requires pointer-capture/scrollIntoView APIs jsdom doesn't
// implement — mocked the same way PapeisTab.test.tsx does, so the role
// SelectItems (including the custom-papel ones) render as plain clickable
// buttons instead of fighting jsdom's missing portal/pointer-capture
// behaviour. MembrosTab drives these Selects with plain useState (no
// react-hook-form Controller involved here), so a bare value/onValueChange
// passthrough is enough.
vi.mock('@/components/ui/select', async () => {
  const ReactModule = await vi.importActual<typeof import('react')>('react');

  interface SelectContextValue {
    value?: string;
    onValueChange?: (value: string) => void;
  }
  const SelectContext = ReactModule.createContext<SelectContextValue>({});

  function Select({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children: React.ReactNode;
  }) {
    return (
      <SelectContext.Provider value={{ value, onValueChange }}>
        <div>{children}</div>
      </SelectContext.Provider>
    );
  }
  function SelectTrigger({ children }: { children: React.ReactNode }) {
    return <button type="button">{children}</button>;
  }
  function SelectValue({ placeholder }: { placeholder?: string }) {
    const { value } = ReactModule.useContext(SelectContext);
    return <span>{value || placeholder || ''}</span>;
  }
  function SelectContent({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>;
  }
  function SelectItem({ value, children }: { value: string; children: React.ReactNode }) {
    const { onValueChange } = ReactModule.useContext(SelectContext);
    return (
      <button type="button" onClick={() => onValueChange?.(value)}>
        {children}
      </button>
    );
  }

  return { Select, SelectTrigger, SelectValue, SelectContent, SelectItem };
});

// Mutable holder so individual tests can supply `invites` rows (e.g. for
// "Reenviar") without redefining the whole vi.mock factory. vi.hoisted (not a
// plain const) because the vi.mock factory below runs before ordinary
// top-level statements execute — see the identical pattern/comment on
// useAuthMock/storeMock above.
const { invitesRowsHolder } = vi.hoisted(() => ({
  invitesRowsHolder: { current: [] as Record<string, unknown>[] },
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
            order: async () => ({ data: invitesRowsHolder.current }),
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

  it('shows Convidar/Remover for a custom role with equipe:editar', async () => {
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
    expect(screen.getAllByRole('button', { name: 'Remover' }).length).toBeGreaterThan(0);
  });

  /**
   * Task 14 fix round 2 (external review, P2 confirmed): `update-role` is a
   * STRICTER server-side gate than `equipe:editar` alone --
   * manage-workspace-user/index.ts requires the caller's CHASSIS role to be
   * owner/admin for that action specifically ("atribuição segue dono e
   * admin"), so a custom equipe:editar actor (chassis 'agent') who saw the
   * Função button would get a 403 on click. Remover/Convidar stay on
   * canManageTeam alone -- only `update-role` carries the extra chassis
   * requirement.
   */
  it('hides Função (but keeps Remover) for a custom role with equipe:editar whose chassis is agent', async () => {
    setAuth({
      workspaceRole: 'agent',
      staleProfileRole: 'agent',
      can: makeCan(
        fakeMembership({ role: 'agent', role_id: 'role-1', permissions: { equipe: 'editar' } }),
      ),
    });
    renderTab();

    await screen.findByText('Ana Owner');
    expect(screen.queryByRole('button', { name: 'Função' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Remover' }).length).toBeGreaterThan(0);
  });

  it('a legacy owner/admin (unconditional equipe:editar) still sees every action button — no regression', async () => {
    setAuth({ workspaceRole: 'admin', staleProfileRole: 'admin' });
    renderTab();

    await screen.findByText('Ana Owner');
    expect(screen.getByRole('button', { name: /Convidar/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Função' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Remover' }).length).toBeGreaterThan(0);
  });
});

/**
 * Task 13: papel (custom-role) assignment in the UI. `wsUsers` rows now carry
 * `role_id`/`papel_nome` (getWorkspaceUsers, store/workspace.ts), and the
 * função select encodes 'admin' | 'agent' | 'custom:<uuid>'.
 */
describe('MembrosTab — atribuição de papel custom', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invitesRowsHolder.current = [];
    storeMock.getWorkspaceRoles.mockResolvedValue([
      { id: 'role-1', nome: 'Editor de Conteúdo', permissions: {}, created_at: '2026-01-01' },
      { id: 'role-2', nome: 'Financeiro Only', permissions: {}, created_at: '2026-01-01' },
    ]);
  });

  it('shows the papel name badge (not the legacy RoleBadge label) for a member with a custom papel', async () => {
    setAuth({ workspaceRole: 'owner', staleProfileRole: 'owner' });
    storeMock.getWorkspaceUsers.mockResolvedValue([
      {
        id: 'u1',
        nome: 'Carla Editora',
        role: 'agent',
        role_id: 'role-1',
        papel_nome: 'Editor de Conteúdo',
        avatar_url: null,
        created_at: '2026-01-01',
      },
    ]);
    renderTab();

    await screen.findByText('Carla Editora');
    expect(screen.getByText('Editor de Conteúdo')).toBeInTheDocument();
    // RoleBadge's legacy label for 'agent' must NOT appear alongside it.
    expect(screen.queryByText('Agente')).not.toBeInTheDocument();
  });

  it('a legacy member (no role_id) keeps the ordinary RoleBadge label', async () => {
    setAuth({ workspaceRole: 'owner', staleProfileRole: 'owner' });
    storeMock.getWorkspaceUsers.mockResolvedValue([
      { id: 'u1', nome: 'Beto Admin', role: 'admin', role_id: null, avatar_url: null },
    ]);
    renderTab();

    await screen.findByText('Beto Admin');
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  it('opening "Função" for a custom-papel member pre-selects custom:<roleId>, and saving a different preset calls updateWorkspaceUserRole with { role }', async () => {
    setAuth({ workspaceRole: 'owner', staleProfileRole: 'owner' });
    storeMock.getWorkspaceUsers.mockResolvedValue([
      {
        id: 'u1',
        nome: 'Carla Editora',
        role: 'agent',
        role_id: 'role-1',
        papel_nome: 'Editor de Conteúdo',
        avatar_url: null,
      },
    ]);
    renderTab();

    await screen.findByText('Carla Editora');
    fireEvent.click(screen.getByRole('button', { name: 'Função' }));

    // The select's mocked SelectValue renders the current value as text.
    expect(await screen.findByText('custom:role-1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Admin' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => {
      expect(storeMock.updateWorkspaceUserRole).toHaveBeenCalledWith('u1', { role: 'admin' });
    });
    expect(toast.success).toHaveBeenCalledWith('Função atualizada!');
  });

  it('selecting a custom papel for a legacy member calls updateWorkspaceUserRole with { roleId }', async () => {
    setAuth({ workspaceRole: 'owner', staleProfileRole: 'owner' });
    storeMock.getWorkspaceUsers.mockResolvedValue([
      { id: 'u2', nome: 'Beto Admin', role: 'admin', role_id: null, avatar_url: null },
    ]);
    renderTab();

    await screen.findByText('Beto Admin');
    fireEvent.click(screen.getByRole('button', { name: 'Função' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Editor de Conteúdo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => {
      expect(storeMock.updateWorkspaceUserRole).toHaveBeenCalledWith('u2', { roleId: 'role-1' });
    });
  });

  it('the invite modal lists custom papéis and sends role: agent + role_id when one is picked', async () => {
    setAuth({ workspaceRole: 'owner', staleProfileRole: 'owner' });
    storeMock.getWorkspaceUsers.mockResolvedValue([]);

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, message: 'Convite enviado!' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      renderTab();
      await waitFor(() => expect(storeMock.getWorkspaceUsers).toHaveBeenCalled());

      fireEvent.click(screen.getByRole('button', { name: /Convidar/ }));
      // The invite modal's <Label>Email *</Label> has no htmlFor/id pairing
      // with the <Input> beside it, so getByLabelText can't resolve it — the
      // email field is the only textbox rendered in the dialog at this point.
      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'nova@equipe.com' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Financeiro Only' }));
      fireEvent.click(screen.getByRole('button', { name: 'Enviar Convite' }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
      expect(body).toEqual({
        email: 'nova@equipe.com',
        role: 'agent',
        role_id: 'role-2',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('the invite modal sends role_id: null (never omitted) when a preset role is chosen', async () => {
    // Round-2 fix: role_id must be sent EXPLICITLY as null for a preset
    // choice, never omitted — invite-actions.ts treats an absent key as
    // "legacy caller, inherit from a prior pending invite for this email",
    // which would silently resurrect a stale custom papel from an unrelated
    // earlier invite instead of the plain role just picked here.
    setAuth({ workspaceRole: 'owner', staleProfileRole: 'owner' });
    storeMock.getWorkspaceUsers.mockResolvedValue([]);

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, message: 'Convite enviado!' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      renderTab();
      await waitFor(() => expect(storeMock.getWorkspaceUsers).toHaveBeenCalled());

      fireEvent.click(screen.getByRole('button', { name: /Convidar/ }));
      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'nova@equipe.com' },
      });
      // Default select value is already 'agent' (a preset) — no papel click.
      fireEvent.click(screen.getByRole('button', { name: 'Enviar Convite' }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
      expect(body).toEqual({
        email: 'nova@equipe.com',
        role: 'agent',
        role_id: null,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('"Reenviar" sends the pending invite\'s role_id explicitly (custom papel case)', async () => {
    setAuth({ workspaceRole: 'owner', staleProfileRole: 'owner' });
    storeMock.getWorkspaceUsers.mockResolvedValue([]);
    invitesRowsHolder.current = [
      {
        id: 'inv-1',
        email: 'pendente-custom@x.com',
        role: 'agent',
        role_id: 'role-1',
        status: 'pending',
        expires_at: '2099-01-01T00:00:00Z',
      },
    ];

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, message: 'Convite reenviado!' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      renderTab();
      fireEvent.click(await screen.findByRole('button', { name: 'Reenviar' }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
      expect(body).toEqual({
        email: 'pendente-custom@x.com',
        role: 'agent',
        role_id: 'role-1',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('"Reenviar" sends role_id: null explicitly (never omitted) for a legacy pending invite with no custom papel', async () => {
    // Round-2 fix: the resend path must never rely on the server's inherit
    // fallback (reserved for legacy/stale callers) even for its own
    // no-custom-role case -- MembrosTab always knows the row's actual value
    // and must say so explicitly.
    setAuth({ workspaceRole: 'owner', staleProfileRole: 'owner' });
    storeMock.getWorkspaceUsers.mockResolvedValue([]);
    invitesRowsHolder.current = [
      {
        id: 'inv-2',
        email: 'pendente-legado@x.com',
        role: 'admin',
        role_id: null,
        status: 'pending',
        expires_at: '2099-01-01T00:00:00Z',
      },
    ];

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, message: 'Convite reenviado!' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      renderTab();
      fireEvent.click(await screen.findByRole('button', { name: 'Reenviar' }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
      expect(body).toEqual({
        email: 'pendente-legado@x.com',
        role: 'admin',
        role_id: null,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

/**
 * Revisão externa (P2): the invite dialog's função select offered Admin and
 * every custom papel to ANY `equipe:editar` actor. `invite-user/index.ts`
 * rejects both shapes unless the caller's CHASSIS role is owner/admin
 * (`isPrivilegedActor`; "Apenas donos e admins podem convidar com função
 * elevada ou papel."), so those options were a dead end that only failed after
 * the invite was submitted. The select now mirrors `canAssignRoles`, the same
 * chassis check that already gated the Função button.
 */
describe('MembrosTab — invite dialog role options follow the chassis rule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invitesRowsHolder.current = [];
    storeMock.getWorkspaceUsers.mockResolvedValue([]);
    storeMock.getWorkspaceRoles.mockResolvedValue([
      { id: 'role-1', nome: 'Editor de Conteúdo', permissions: {}, created_at: '2026-01-01' },
      { id: 'role-2', nome: 'Financeiro Only', permissions: {}, created_at: '2026-01-01' },
    ]);
  });

  it('a custom equipe:editar actor (chassis agent) sees ONLY Agente', async () => {
    setAuth({
      workspaceRole: 'agent',
      staleProfileRole: 'agent',
      can: makeCan(
        fakeMembership({ role: 'agent', role_id: 'role-9', permissions: { equipe: 'editar' } }),
      ),
    });
    renderTab();
    await waitFor(() => expect(storeMock.getWorkspaceUsers).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /Convidar/ }));

    expect(screen.getByRole('button', { name: 'Agente' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Admin' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editor de Conteúdo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Financeiro Only' })).not.toBeInTheDocument();
    expect(
      screen.getByText('Apenas donos e admins convidam com função elevada ou papel.'),
    ).toBeInTheDocument();
  });

  it('a legacy admin still sees Admin, Agente and every custom papel', async () => {
    setAuth({ workspaceRole: 'admin', staleProfileRole: 'admin' });
    renderTab();
    await waitFor(() => expect(storeMock.getWorkspaceUsers).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /Convidar/ }));

    expect(screen.getByRole('button', { name: 'Admin' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Agente' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editor de Conteúdo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Financeiro Only' })).toBeInTheDocument();
    expect(
      screen.queryByText('Apenas donos e admins convidam com função elevada ou papel.'),
    ).not.toBeInTheDocument();
  });

  it('a legacy owner sees every option too (regression)', async () => {
    setAuth({ workspaceRole: 'owner', staleProfileRole: 'owner' });
    renderTab();
    await waitFor(() => expect(storeMock.getWorkspaceUsers).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /Convidar/ }));

    expect(screen.getByRole('button', { name: 'Admin' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editor de Conteúdo' })).toBeInTheDocument();
  });

  it('the non-privileged actor can still send an agent invite (role=agent, role_id=null)', async () => {
    setAuth({
      workspaceRole: 'agent',
      staleProfileRole: 'agent',
      can: makeCan(
        fakeMembership({ role: 'agent', role_id: 'role-9', permissions: { equipe: 'editar' } }),
      ),
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, message: 'Convite enviado!' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      renderTab();
      await waitFor(() => expect(storeMock.getWorkspaceUsers).toHaveBeenCalled());

      fireEvent.click(screen.getByRole('button', { name: /Convidar/ }));
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'nova@equipe.com' } });
      fireEvent.click(screen.getByRole('button', { name: 'Enviar Convite' }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      // Exactly the shape invite-user accepts from a non-privileged actor.
      expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
        email: 'nova@equipe.com',
        role: 'agent',
        role_id: null,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

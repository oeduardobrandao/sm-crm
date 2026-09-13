import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { makeCan, fakeMembership } from '@/test/makeCan';

// HubRoleGate is the one place that owns the "a member without
// configuracoes:editar sees a restriction notice instead of the real screen"
// behaviour for all five portal routes. Ported out of the pre-split
// HubClienteTab.tsx (origin/main), whose own suite this replaces.
//
// The gate is NOT `workspaceRole === 'agent'`: it is a tri-state read of
// `can('configuracoes', 'editar')`, the same permission clienteTabs.model.ts
// puts on the five `hub/*` tabs, so the screen inside can never contradict
// the route guard that let the member through.
//  - `false`     -> RoleRestrictionNotice
//  - `'unknown'` -> Spinner (membership still resolving)
//  - `true`      -> the real content

vi.mock('@/context/AuthContext', () => ({ useAuth: vi.fn() }));

import { useAuth } from '@/context/AuthContext';
import { HubRoleGate } from '../HubRoleGate';

const mockedUseAuth = vi.mocked(useAuth);

const RESTRICTION_TEXT =
  'O gerenciamento do Hub do Cliente está disponível apenas para proprietários e administradores do workspace.';

/**
 * Passing a legacy `workspaceRole` derives a real, preset-backed `can`
 * (role_id: null) so the owner/admin/agent cases exercise the exact same
 * truth table `derivePermission` does in production; pass `can` directly to
 * simulate a custom role instead. Passing `null` (with no `can` override)
 * drives `can()` to 'unknown' for every module, mirroring a real unresolved
 * AuthContext.
 */
function setAuth(
  workspaceRole: 'owner' | 'admin' | 'agent' | null,
  can?: ReturnType<typeof makeCan>,
) {
  mockedUseAuth.mockReturnValue({
    workspaceRole,
    can: can ?? makeCan(workspaceRole === null ? null : fakeMembership({ role: workspaceRole })),
  } as never);
}

function renderGate() {
  return render(
    <HubRoleGate>
      <div data-testid="child">conteúdo</div>
    </HubRoleGate>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('HubRoleGate', () => {
  it('renders children for an owner', () => {
    setAuth('owner');
    renderGate();
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('renders children for an admin', () => {
    setAuth('admin');
    renderGate();
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('renders RoleRestrictionNotice (not children) for an agent', () => {
    setAuth('agent');
    renderGate();
    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
    expect(screen.getByText('Hub do Cliente')).toBeInTheDocument();
    expect(screen.getByText(RESTRICTION_TEXT)).toBeInTheDocument();
  });

  /**
   * The bug origin/main's Task 14 fixed, carried over here: a custom role's
   * chassis `workspaceRole` reads 'agent' (Task 11), but if its role_id
   * permissions grant `configuracoes:editar` it already passes the
   * ROUTE-level guard (clienteTabs.model.ts) to reach these pages. A coarse
   * `workspaceRole` check would still fire the notice — contradicting the
   * route guard that just let the member through.
   */
  it('renders children for a custom role with configuracoes:editar (the fix)', () => {
    setAuth(
      'agent',
      makeCan(
        fakeMembership({
          role: 'agent',
          role_id: 'role-1',
          permissions: { configuracoes: 'editar' },
        }),
      ),
    );
    renderGate();
    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(
      screen.queryByText(/apenas para proprietários e administradores/),
    ).not.toBeInTheDocument();
  });

  it('still shows RoleRestrictionNotice for a custom role without configuracoes:editar', () => {
    setAuth(
      'agent',
      makeCan(
        fakeMembership({ role: 'agent', role_id: 'role-1', permissions: { configuracoes: 'ver' } }),
      ),
    );
    renderGate();
    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
    expect(screen.getByText(RESTRICTION_TEXT)).toBeInTheDocument();
  });

  /**
   * origin/main's Task 14 round 2 (external review, hydration): `can()` is
   * tri-state ('unknown' before membership resolves). Reading `!== true`
   * treats 'unknown' as an explicit `false` and flashed the restriction
   * notice at EVERY viewer — owner/admin included — for the first render or
   * two. `setAuth(null)` drives `can()` to 'unknown' for every module.
   */
  it('shows a loading spinner (no notice, no children) while membership/can() is unresolved', () => {
    setAuth(null);
    const { container } = renderGate();

    expect(container.querySelector('.animate-spin')).not.toBeNull();
    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
    expect(screen.queryByText(RESTRICTION_TEXT)).not.toBeInTheDocument();
  });
});

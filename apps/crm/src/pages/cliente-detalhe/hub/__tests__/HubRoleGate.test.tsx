import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

// HubRoleGate is the one place that owns the "agent sees a restriction
// notice instead of the real screen" behaviour for all five portal routes
// (clienteTabs.model.ts gives `hub/*` `roles: ALL` on purpose — the route
// guard lets an agent through, and this component is what stops them).
// Ported out of the pre-split HubClienteTab.tsx (git history at d30adeea),
// which did this same `workspaceRole === 'agent'` check once for the whole
// (then single) Hub tab.

vi.mock('@/context/AuthContext', () => ({ useAuth: vi.fn() }));

import { useAuth } from '@/context/AuthContext';
import { HubRoleGate } from '../HubRoleGate';

const mockedUseAuth = vi.mocked(useAuth);

function setAuth(workspaceRole: 'owner' | 'admin' | 'agent' | null) {
  mockedUseAuth.mockReturnValue({ workspaceRole } as never);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('HubRoleGate', () => {
  it('renders children for an owner', () => {
    setAuth('owner');
    render(
      <HubRoleGate>
        <div data-testid="child">conteúdo</div>
      </HubRoleGate>,
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('renders children for an admin', () => {
    setAuth('admin');
    render(
      <HubRoleGate>
        <div data-testid="child">conteúdo</div>
      </HubRoleGate>,
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('renders RoleRestrictionNotice (not children) for an agent', () => {
    setAuth('agent');
    render(
      <HubRoleGate>
        <div data-testid="child">conteúdo</div>
      </HubRoleGate>,
    );
    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
    expect(screen.getByText('Hub do Cliente')).toBeInTheDocument();
    expect(
      screen.getByText(
        'O gerenciamento do Hub do Cliente está disponível apenas para proprietários e administradores do workspace.',
      ),
    ).toBeInTheDocument();
  });
});

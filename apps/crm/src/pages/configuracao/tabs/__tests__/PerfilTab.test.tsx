import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCan, fakeMembership } from '@/test/makeCan';

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));

vi.mock('../../../../context/AuthContext', () => ({
  useAuth: useAuthMock,
}));

vi.mock('../../../../store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../store')>()),
  getInitials: (nome: string) => nome.slice(0, 2).toUpperCase(),
}));

vi.mock('../../../../lib/supabase', () => ({
  supabase: {
    from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }),
    auth: { updateUser: vi.fn(async () => ({ error: null })) },
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import PerfilTab from '../PerfilTab';

function renderTab() {
  return render(<PerfilTab />);
}

const RESTRICTION_TEXT =
  'As configurações de workspace, sincronização do Instagram e gerenciamento de membros estão disponíveis apenas para proprietários e administradores.';

function baseAuth(can: ReturnType<typeof makeCan>) {
  return {
    user: { id: 'user-1', email: 'ana@exemplo.com' },
    profile: { id: 'user-1', nome: 'Ana Souza' },
    can,
    signOut: vi.fn(),
    refetchProfile: vi.fn(),
  };
}

/**
 * Task 14: `isOwnerOrAdmin = role === 'owner' || role === 'admin'` collapsed
 * onto `can('configuracoes', 'ver') === true`, gating the "outros ajustes
 * ficam em outra aba" restriction notice. `AGENT_ROLE_PRESET.configuracoes`
 * is 'none' and admin resolves to `true` for every non-financial module
 * (lib/permissions.ts), so the two legacy-preset cases below reproduce the
 * OLD isOwnerOrAdmin gate byte-for-byte -- only a CUSTOM role (role_id set)
 * can now diverge from its chassis role.
 */
describe('PerfilTab — restriction notice gated on configuracoes:ver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the notice showing for a legacy agent (configuracoes preset is none)', () => {
    useAuthMock.mockReturnValue(baseAuth(makeCan(fakeMembership({ role: 'agent' }))));
    renderTab();

    expect(screen.getByText(RESTRICTION_TEXT)).toBeInTheDocument();
  });

  it('hides the notice for a legacy admin (configuracoes preset resolves to true)', () => {
    useAuthMock.mockReturnValue(baseAuth(makeCan(fakeMembership({ role: 'admin' }))));
    renderTab();

    expect(screen.queryByText(RESTRICTION_TEXT)).not.toBeInTheDocument();
  });

  it('shows the notice for a custom role with no configuracoes grant at all', () => {
    useAuthMock.mockReturnValue(
      baseAuth(makeCan(fakeMembership({ role: 'agent', role_id: 'role-1', permissions: {} }))),
    );
    renderTab();

    expect(screen.getByText(RESTRICTION_TEXT)).toBeInTheDocument();
  });

  it('hides the notice for a custom role with configuracoes:editar (the fix)', () => {
    useAuthMock.mockReturnValue(
      baseAuth(
        makeCan(
          fakeMembership({
            role: 'agent',
            role_id: 'role-1',
            permissions: { configuracoes: 'editar' },
          }),
        ),
      ),
    );
    renderTab();

    expect(screen.queryByText(RESTRICTION_TEXT)).not.toBeInTheDocument();
  });
});

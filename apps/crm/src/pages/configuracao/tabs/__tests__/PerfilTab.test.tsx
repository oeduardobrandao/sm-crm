import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCan, fakeMembership } from '@/test/makeCan';

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));

// The upload hook needs a QueryClient; the page only cares which target it gets.
const useFotoPessoaMock = vi.hoisted(() =>
  vi.fn((_alvo: unknown) => ({
    uploading: false,
    pick: vi.fn(),
    pickCamera: vi.fn(),
    upload: vi.fn(async () => true),
    remove: vi.fn(async () => {}),
    inputProps: {
      ref: { current: null },
      type: 'file' as const,
      accept: 'image/*',
      disabled: false,
      onChange: vi.fn(),
    },
    cameraInputProps: {
      ref: { current: null },
      type: 'file' as const,
      accept: 'image/*',
      capture: 'user' as const,
      disabled: false,
      onChange: vi.fn(),
    },
  })),
);
vi.mock('@/hooks/useFotoPessoa', () => ({ useFotoPessoa: useFotoPessoaMock }));

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

// Desktop markup; the phone branch has its own suite (PerfilTab.phone.test.tsx).
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));

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

describe('PerfilTab photo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the photo editor for self', () => {
    const auth = baseAuth(makeCan(fakeMembership({ role: 'agent' })));
    useAuthMock.mockReturnValue({
      ...auth,
      profile: { ...auth.profile, avatar_url: 'https://cdn.exemplo.com/ana.jpg' },
    });
    const { container } = renderTab();

    expect(screen.getByRole('button', { name: 'Alterar foto de Ana Souza' })).toBeInTheDocument();
    expect(useFotoPessoaMock).toHaveBeenCalledWith({ kind: 'self', userId: 'user-1' });
    expect(container.querySelector('img.avatar--photo')).toHaveAttribute(
      'src',
      'https://cdn.exemplo.com/ana.jpg',
    );
    expect(
      screen.getByText(
        'Aparece para a sua equipe em todo o CRM: Entregas, Tarefas, Agenda e Mensagens. Os clientes não veem.',
      ),
    ).toBeInTheDocument();
  });

  it('offers to add a photo when the profile has none', () => {
    useAuthMock.mockReturnValue(baseAuth(makeCan(fakeMembership({ role: 'agent' }))));
    renderTab();

    expect(screen.getByRole('button', { name: 'Adicionar foto de Ana Souza' })).toBeInTheDocument();
  });
});

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCan, fakeMembership } from '@/test/makeCan';

const { useAuthMock, updateMock, updateUserMock, consentMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  updateMock: vi.fn(),
  updateUserMock: vi.fn(),
  consentMock: vi.fn(),
}));

vi.mock('../../../../context/AuthContext', () => ({ useAuth: useAuthMock }));

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

vi.mock('../../../../store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../store')>()),
  getInitials: (nome: string) => nome.slice(0, 2).toUpperCase(),
}));

vi.mock('../../../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      update: (payload: unknown) => {
        updateMock(payload);
        return { eq: async () => ({ error: null }) };
      },
    }),
    auth: { updateUser: updateUserMock },
  },
}));

vi.mock('@/lib/consent', () => ({ openConsentPreferences: consentMock }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/layout/PhoneShellHeader', () => ({
  PhoneShellActions: () => <div data-testid="shell-actions" />,
}));

import PerfilTab from '../PerfilTab';

const signOut = vi.fn();
const refetchProfile = vi.fn();

function setAuth(role: 'owner' | 'agent' = 'owner') {
  useAuthMock.mockReturnValue({
    user: { id: 'user-1-aaaaaaaaaaaaaaaaaaaa', email: 'ana@exemplo.com' },
    profile: { id: 'user-1', nome: 'Ana Souza', empresa: 'Norte' },
    can: makeCan(fakeMembership({ role })),
    signOut,
    refetchProfile,
  });
}

function renderTab() {
  return render(
    <MemoryRouter>
      <PerfilTab />
    </MemoryRouter>,
  );
}

describe('PerfilTab on phones', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateUserMock.mockResolvedValue({ error: null });
  });

  it('renders the grouped form under a nav bar with Salvar', () => {
    setAuth();
    renderTab();
    expect(screen.getByRole('heading', { level: 1, name: 'Perfil' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Voltar para Configurações' })).toBeInTheDocument();
    expect(screen.getByLabelText('Nome')).toHaveValue('Ana Souza');
    expect(screen.getByLabelText('Empresa')).toHaveValue('Norte');
    expect(screen.getByText('Conta Ativa')).toBeInTheDocument();
    // No desktop cards.
    expect(screen.queryByRole('button', { name: /Salvar Perfil/ })).toBeNull();
  });

  it('saves the profile through the same update, marketing switch included', async () => {
    setAuth();
    renderTab();
    fireEvent.change(screen.getByLabelText('Telefone'), { target: { value: '1199' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Comunicações de marketing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar perfil' }));
    await waitFor(() =>
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({ nome: 'Ana Souza', telefone: '1199', marketing_opt_in: true }),
      ),
    );
    expect(refetchProfile).toHaveBeenCalled();
  });

  it('changes the password on its own pushed screen', async () => {
    setAuth();
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Alterar senha' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Alterar senha' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: 'segredo123' } });
    fireEvent.change(screen.getByLabelText('Confirmar'), { target: { value: 'segredo123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar senha' }));
    await waitFor(() => expect(updateUserMock).toHaveBeenCalledWith({ password: 'segredo123' }));
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Perfil' })).toBeInTheDocument();
  });

  it('explains the missing sections to an agent, opens cookies and signs out', () => {
    setAuth('agent');
    renderTab();
    expect(
      screen.getByText(/disponíveis apenas para proprietários e administradores/),
    ).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Preferências de cookies' }));
    expect(consentMock).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Sair da conta' }));
    expect(signOut).toHaveBeenCalled();
  });

  it('shows the photo editor for self', () => {
    setAuth();
    renderTab();
    expect(screen.getByRole('button', { name: 'Adicionar foto de Ana Souza' })).toBeInTheDocument();
    expect(useFotoPessoaMock).toHaveBeenCalledWith({
      kind: 'self',
      userId: 'user-1-aaaaaaaaaaaaaaaaaaaa',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar foto' }));
    const sheet = screen.getByRole('dialog', { name: 'Foto de perfil' });
    expect(within(sheet).getByRole('button', { name: 'Escolher da galeria' })).toBeInTheDocument();
  });
});

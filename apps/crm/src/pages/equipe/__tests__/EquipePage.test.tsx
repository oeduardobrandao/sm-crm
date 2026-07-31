import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom has no scrollIntoView; Radix's Select calls it when committing a
// selection, which otherwise throws inside a passive effect.
Element.prototype.scrollIntoView = vi.fn();

const { mockNavigate, toastSuccessMock, toastErrorMock, mockUseAuth, mockUseWorkspaceLimits } =
  vi.hoisted(() => ({
    mockNavigate: vi.fn(),
    toastSuccessMock: vi.fn(),
    toastErrorMock: vi.fn(),
    mockUseAuth: vi.fn(),
    mockUseWorkspaceLimits: vi.fn(),
  }));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('sonner', () => ({
  toast: { success: toastSuccessMock, error: toastErrorMock },
}));

vi.mock('@/lib/analytics', () => ({ captureEvent: vi.fn() }));

vi.mock('@/context/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/context/AuthContext')>();
  return { ...actual, useAuth: mockUseAuth };
});

vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: mockUseWorkspaceLimits,
}));

vi.mock('@/store', async () => {
  const actual = await vi.importActual<typeof import('@/store')>('@/store');
  return {
    ...actual,
    getMembros: vi.fn(),
    addMembro: vi.fn(),
    updateMembro: vi.fn(),
    removeMembro: vi.fn(),
    getWorkspaceUsers: vi.fn(),
    setMembroCrmUser: vi.fn(),
  };
});

vi.mock('@/services/invite', () => ({
  inviteUser: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(async () => ({ data: [] })),
        })),
      })),
    })),
  },
}));

import * as store from '@/store';
import * as inviteService from '@/services/invite';
import EquipePage from '../EquipePage';

const mockedGetMembros = vi.mocked(store.getMembros);
const mockedAddMembro = vi.mocked(store.addMembro);
const mockedUpdateMembro = vi.mocked(store.updateMembro);
const mockedSetMembroCrmUser = vi.mocked(store.setMembroCrmUser);
const mockedGetWorkspaceUsers = vi.mocked(store.getWorkspaceUsers);
const mockedInviteUser = vi.mocked(inviteService.inviteUser);

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <EquipePage />
    </QueryClientProvider>,
  );
  return { queryClient };
}

describe('EquipePage — onSubmit invite orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      role: 'owner',
      canSeeFinancials: true,
      workspaceRole: 'owner',
      membershipResolved: true,
      profile: { id: 'me', nome: 'Eu', conta_id: 'ws-1' },
    });
    mockUseWorkspaceLimits.mockReturnValue({
      limits: { max_team_members: 10 },
      features: null,
      planName: 'Pro',
      isLoading: false,
      isUnlimited: false,
    });
    mockedGetMembros.mockResolvedValue([]);
    mockedGetWorkspaceUsers.mockResolvedValue([{ id: 'u1', nome: 'Ana' }] as never);
  });

  it('keeps the saved membro when the invite call fails: no membro-save toast is lost, and the invite failure never masquerades as a save failure', async () => {
    mockedAddMembro.mockResolvedValueOnce({
      id: 42,
      nome: 'Nova Pessoa',
      cargo: 'Redator',
      tipo: 'clt',
      avatar_url: '',
      crm_user_id: null,
    } as never);
    mockedInviteUser.mockRejectedValueOnce(new Error('rede caiu'));

    const { queryClient } = renderPage();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    fireEvent.click(await screen.findByRole('button', { name: 'Adicionar Membro' }));

    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Nome *'), {
      target: { value: 'Nova Pessoa' },
    });
    fireEvent.change(within(dialog).getByLabelText('Cargo *'), {
      target: { value: 'Redator' },
    });

    // Turn on the invite switch, which reveals the email field.
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Convidar para o workspace' }));
    fireEvent.change(within(dialog).getByLabelText('Email *'), {
      target: { value: 'nova@exemplo.com' },
    });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar e convidar' }));

    // The membro save must go through and resolve before the invite call runs.
    await waitFor(() => {
      expect(mockedAddMembro).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(mockedInviteUser).toHaveBeenCalledWith('nova@exemplo.com', 'agent', 42);
    });

    // The invite failure is reported as its own toast — it must never be
    // conflated with (or overwritten by) a generic membro-save failure.
    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('Membro salvo, mas o convite falhou: rede caiu');
    });
    expect(toastErrorMock).not.toHaveBeenCalledWith('Erro ao salvar');
    expect(toastSuccessMock).not.toHaveBeenCalled();

    // The dialog still closes and the membro list is still invalidated — the
    // save is not rolled back or hidden by the invite failure.
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['membros'] });
  });

  it('never fires an invite when an existing user was just linked via Conta CRM in the same submission', async () => {
    mockedGetMembros.mockResolvedValue([
      {
        id: 7,
        nome: 'Pessoa Existente',
        cargo: 'Designer',
        tipo: 'clt',
        avatar_url: '',
        crm_user_id: null,
      },
    ] as never);
    mockedUpdateMembro.mockResolvedValueOnce(undefined as never);
    mockedSetMembroCrmUser.mockResolvedValueOnce(undefined as never);

    renderPage();

    const nameEl = await screen.findByText('Pessoa Existente');
    // The name itself is also a button (navigates to the detail page) and is
    // first in DOM order; the edit action is the icon-only pencil button
    // (no accessible name) that follows it, before the delete button.
    const card = nameEl.closest('.team-card') as HTMLElement;
    const editButton = within(card).getAllByRole('button')[1];
    fireEvent.click(editButton);

    const dialog = await screen.findByRole('dialog');

    // Turn on the invite switch first (as an admin might, before deciding to
    // link an existing account instead) — the section only renders while
    // still unlinked, so this is available alongside Conta CRM.
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Convidar para o workspace' }));
    fireEvent.change(within(dialog).getByLabelText('Email *'), {
      target: { value: 'nova@exemplo.com' },
    });

    // Then pick an existing workspace user in Conta CRM.
    fireEvent.click(within(dialog).getByRole('combobox', { name: 'Conta CRM' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Ana' }));

    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => {
      expect(mockedSetMembroCrmUser).toHaveBeenCalledWith(7, 'u1');
    });
    await waitFor(() => {
      expect(mockedUpdateMembro).toHaveBeenCalledTimes(1);
    });

    // The membro was just linked in this same submission — the invite must
    // never fire, regardless of the switch's leftover on state.
    expect(mockedInviteUser).not.toHaveBeenCalled();
    expect(toastErrorMock).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith('Membro atualizado');
    });
  });
});

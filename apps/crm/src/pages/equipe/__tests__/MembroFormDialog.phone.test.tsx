import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCan, fakeMembership } from '@/test/makeCan';
import { PhoneLayoutProvider } from '@/components/layout/PhoneLayoutContext';

// MembroFormDialog inside the phone shell (PLAN F2d): grouped rows, checkmark pickers and
// a switch cell for "Convidar para o workspace", over the same submit logic.

const { mockUseAuth, mockUseWorkspaceLimits, toastSuccessMock, pending } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockUseWorkspaceLimits: vi.fn(),
  toastSuccessMock: vi.fn(),
  pending: { rows: [] as unknown[] },
}));

vi.mock('sonner', () => ({ toast: { success: toastSuccessMock, error: vi.fn() } }));
vi.mock('@/lib/analytics', () => ({ captureEvent: vi.fn() }));
vi.mock('@/context/AuthContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/context/AuthContext')>()),
  useAuth: mockUseAuth,
}));
vi.mock('@/hooks/useWorkspaceLimits', () => ({ useWorkspaceLimits: mockUseWorkspaceLimits }));
vi.mock('@/store', async () => ({
  ...(await vi.importActual<typeof import('@/store')>('@/store')),
  addMembro: vi.fn(),
  updateMembro: vi.fn(),
  getWorkspaceUsers: vi.fn(),
  getWorkspaceRoles: vi.fn(),
  updateWorkspaceUserRole: vi.fn(),
  setMembroCrmUser: vi.fn(),
}));
vi.mock('@/services/invite', () => ({ inviteUser: vi.fn() }));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ eq: vi.fn(async () => ({ data: pending.rows })) })),
      })),
    })),
  },
}));

import * as store from '@/store';
import * as inviteService from '@/services/invite';
import type { Membro } from '@/store';
import { MembroFormDialog } from '../MembroFormDialog';

function renderDialog(membro: Membro | null, membros: Membro[] = []) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <PhoneLayoutProvider isPhone>
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <MembroFormDialog open membro={membro} membros={membros} onOpenChange={vi.fn()} />
        </QueryClientProvider>
      </MemoryRouter>
    </PhoneLayoutProvider>,
  );
  return screen.getByRole('dialog', { name: membro ? 'Editar Membro' : 'Adicionar Membro' });
}

async function pick(dialog: HTMLElement, row: RegExp, sheetName: string, option: string) {
  fireEvent.click(within(dialog).getByRole('button', { name: row }));
  const sheet = await screen.findByRole('dialog', { name: sheetName });
  fireEvent.click(within(sheet).getByRole('button', { name: option }));
}

beforeEach(() => {
  vi.clearAllMocks();
  pending.rows = [];
  mockUseAuth.mockReturnValue({
    canSeeFinancials: true,
    can: makeCan(fakeMembership({ role: 'owner' })),
    workspaceRole: 'owner',
    user: { id: 'me' },
    profile: { id: 'me', nome: 'Eu', conta_id: 'ws-1' },
  });
  mockUseWorkspaceLimits.mockReturnValue({
    limits: { max_team_members: 10 },
    isLoading: false,
    isUnlimited: false,
  });
  vi.mocked(store.getWorkspaceUsers).mockResolvedValue([
    { id: 'u1', nome: 'Ana', role: 'agent', role_id: null },
  ] as never);
  vi.mocked(store.getWorkspaceRoles).mockResolvedValue([
    { id: 'r1', nome: 'Social', permissions: {}, created_at: '' },
  ]);
});

describe('MembroFormDialog in the phone shell', () => {
  it('adds a member with a Tipo picked from the list and invites them from the switch cell', async () => {
    vi.mocked(store.addMembro).mockResolvedValueOnce({ id: 42 } as never);
    vi.mocked(inviteService.inviteUser).mockResolvedValueOnce({
      success: true,
      message: 'Convite enviado',
    });
    const dialog = renderDialog(null);

    fireEvent.change(within(dialog).getByLabelText('Nome *'), { target: { value: 'Nova' } });
    fireEvent.change(within(dialog).getByLabelText('Cargo *'), { target: { value: 'Redatora' } });
    expect(within(dialog).getByLabelText('Custo Mensal (R$)')).toBeInTheDocument();
    await pick(dialog, /^Tipo/, 'Tipo', 'Freelancer Mensal');

    expect(within(dialog).queryByLabelText('Email *')).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Convidar para o workspace' }));
    fireEvent.change(within(dialog).getByLabelText('Email *'), {
      target: { value: 'nova@exemplo.com' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /Salvar e convidar/ }));

    await waitFor(() =>
      expect(store.addMembro).toHaveBeenCalledWith(
        expect.objectContaining({ nome: 'Nova', cargo: 'Redatora', tipo: 'freelancer_mensal' }),
      ),
    );
    await waitFor(() =>
      expect(inviteService.inviteUser).toHaveBeenCalledWith('nova@exemplo.com', 'agent', 42),
    );
  });

  it('hides Custo Mensal without financial access', () => {
    mockUseAuth.mockReturnValue({
      canSeeFinancials: false,
      can: makeCan(fakeMembership({ role: 'owner' })),
      workspaceRole: 'owner',
      user: { id: 'me' },
      profile: { id: 'me', nome: 'Eu', conta_id: 'ws-1' },
    });
    // canSeeFinancials !== true closes the dialog on mount; render it anyway and look.
    const queryClient = new QueryClient();
    render(
      <PhoneLayoutProvider isPhone>
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <MembroFormDialog open membro={null} membros={[]} onOpenChange={() => {}} />
          </QueryClientProvider>
        </MemoryRouter>
      </PhoneLayoutProvider>,
    );
    expect(screen.queryByLabelText('Custo Mensal (R$)')).not.toBeInTheDocument();
  });

  it("changes a linked member's função from the checkmark list", async () => {
    vi.mocked(store.updateMembro).mockResolvedValue(undefined as never);
    vi.mocked(store.updateWorkspaceUserRole).mockResolvedValue(undefined);
    const linked = {
      id: 7,
      nome: 'Pessoa Vinculada',
      cargo: 'Designer',
      tipo: 'clt',
      avatar_url: '',
      crm_user_id: 'u1',
    } as Membro;
    const dialog = renderDialog(linked, [linked]);

    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: /Conta CRM/ })).toHaveTextContent('Ana'),
    );
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: /Função no workspace/ })).toHaveTextContent(
        'Agente',
      ),
    );
    await pick(dialog, /Função no workspace/, 'Função no workspace', 'Social');
    fireEvent.click(within(dialog).getByRole('button', { name: /^\s*Salvar$/ }));

    await waitFor(() =>
      expect(store.updateWorkspaceUserRole).toHaveBeenCalledWith('u1', { roleId: 'r1' }),
    );
  });

  it('shows the pending invite instead of the switch', async () => {
    pending.rows = [
      {
        id: 'i1',
        email: 'diego@exemplo.com',
        role: 'agent',
        membro_id: 4,
        expires_at: new Date(Date.now() + 2 * 86_400_000).toISOString(),
        status: 'pending',
      },
    ];
    const membro = {
      id: 4,
      nome: 'Diego',
      cargo: 'Editor',
      tipo: 'clt',
      avatar_url: '',
      crm_user_id: null,
    } as Membro;
    const dialog = renderDialog(membro, [membro]);

    expect(await within(dialog).findByText('Convite pendente')).toBeInTheDocument();
    expect(within(dialog).getByText('diego@exemplo.com')).toBeInTheDocument();
    expect(within(dialog).getByText(/Reenviar ou cancelar em Configurações/)).toBeInTheDocument();
    expect(
      within(dialog).queryByRole('switch', { name: 'Convidar para o workspace' }),
    ).not.toBeInTheDocument();
  });
});

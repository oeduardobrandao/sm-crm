import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCan, fakeMembership } from '@/test/makeCan';

// jsdom has no scrollIntoView; Radix's Select calls it when committing a
// selection, which otherwise throws inside a passive effect.
Element.prototype.scrollIntoView = vi.fn();

const {
  mockNavigate,
  toastSuccessMock,
  toastErrorMock,
  mockUseAuth,
  mockUseWorkspaceLimits,
  viewport,
  pendingInvites,
} = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  mockUseAuth: vi.fn(),
  mockUseWorkspaceLimits: vi.fn(),
  // jsdom's matchMedia reports false, so the page renders its phone branch unless a
  // test flips this to the desktop layout.
  viewport: { desktop: false },
  pendingInvites: { rows: [] as unknown[] },
}));

vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => viewport.desktop }));

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
    getWorkspaceRoles: vi.fn(),
    updateWorkspaceUserRole: vi.fn(),
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
          eq: vi.fn(async () => ({ data: pendingInvites.rows })),
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
const mockedGetWorkspaceRoles = vi.mocked(store.getWorkspaceRoles);
const mockedUpdateWorkspaceUserRole = vi.mocked(store.updateWorkspaceUserRole);

function renderPage(initialEntry = '/equipe') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={queryClient}>
        <EquipePage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { queryClient };
}

/** Phone: the ink "+" opens an action sheet; "Adicionar Membro" opens the form. */
async function openAddFromPhone() {
  fireEvent.click(
    await screen.findByRole('button', { name: 'Adicionar: Adicionar Membro ou Importar CSV' }),
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Adicionar Membro' }));
  return screen.findByRole('dialog', { name: 'Adicionar Membro' });
}

/** Phone: each row carries its swipe actions in the DOM (the keyboard path). */
async function openEditFromPhone(nome: string) {
  const nameEl = await screen.findByText(nome);
  const row = nameEl.closest('li') as HTMLElement;
  fireEvent.click(within(row).getByRole('button', { name: 'Editar' }));
  return screen.findByRole('dialog', { name: 'Editar Membro' });
}

describe('EquipePage — onSubmit invite orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viewport.desktop = false;
    pendingInvites.rows = [];
    mockUseAuth.mockReturnValue({
      canSeeFinancials: true,
      can: makeCan(fakeMembership({ role: 'owner' })),
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
    mockedGetWorkspaceRoles.mockResolvedValue([]);
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

    const dialog = await openAddFromPhone();
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

    const dialog = await openEditFromPhone('Pessoa Existente');

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

describe('EquipePage — função no workspace for a linked membro', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viewport.desktop = false;
    pendingInvites.rows = [];
    mockUseAuth.mockReturnValue({
      canSeeFinancials: true,
      can: makeCan(fakeMembership({ role: 'owner' })),
      workspaceRole: 'owner',
      user: { id: 'me' },
      profile: { id: 'me', nome: 'Eu', conta_id: 'ws-1' },
    });
    mockUseWorkspaceLimits.mockReturnValue({
      limits: { max_team_members: 10 },
      features: null,
      planName: 'Pro',
      isLoading: false,
      isUnlimited: false,
    });
    mockedGetMembros.mockResolvedValue([
      {
        id: 7,
        nome: 'Pessoa Vinculada',
        cargo: 'Designer',
        tipo: 'clt',
        avatar_url: '',
        crm_user_id: 'u1',
      },
    ] as never);
    mockedGetWorkspaceUsers.mockResolvedValue([
      { id: 'u1', nome: 'Ana', role: 'agent', role_id: null },
    ] as never);
    mockedGetWorkspaceRoles.mockResolvedValue([
      { id: 'r1', nome: 'Social', permissions: {}, created_at: '' },
    ]);
    mockedUpdateMembro.mockResolvedValue(undefined as never);
    mockedUpdateWorkspaceUserRole.mockResolvedValue(undefined);
  });

  const openEdit = () => openEditFromPhone('Pessoa Vinculada');

  it('changes the linked account role on save', async () => {
    renderPage();
    const dialog = await openEdit();

    fireEvent.click(await within(dialog).findByRole('combobox', { name: 'Função no workspace' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Social' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => {
      expect(mockedUpdateWorkspaceUserRole).toHaveBeenCalledWith('u1', { roleId: 'r1' });
    });
    expect(mockedUpdateMembro).toHaveBeenCalledTimes(1);
  });

  it('does not call update-role when the função is left untouched', async () => {
    renderPage();
    const dialog = await openEdit();
    await within(dialog).findByRole('combobox', { name: 'Função no workspace' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => {
      expect(mockedUpdateMembro).toHaveBeenCalledTimes(1);
    });
    expect(mockedUpdateWorkspaceUserRole).not.toHaveBeenCalled();
  });

  it('hides the função select for a non owner/admin caller', async () => {
    mockUseAuth.mockReturnValue({
      canSeeFinancials: true,
      can: makeCan(fakeMembership({ role: 'owner' })),
      workspaceRole: 'agent',
      user: { id: 'me' },
      profile: { id: 'me', nome: 'Eu', conta_id: 'ws-1' },
    });
    renderPage();
    const dialog = await openEdit();
    await within(dialog).findByRole('combobox', { name: 'Conta CRM' });

    expect(
      within(dialog).queryByRole('combobox', { name: 'Função no workspace' }),
    ).not.toBeInTheDocument();
  });
});

/**
 * Task 14: `isAgent = role === 'agent'` / `canManageWorkspace = owner||admin`
 * both collapsed onto `canEditTeam = can('equipe', 'editar') === true`.
 * `AGENT_ROLE_PRESET.equipe` is 'none' and admin resolves to `true` for every
 * non-financial module (lib/permissions.ts), so the two legacy-preset cases
 * below must reproduce the OLD isAgent/canManageWorkspace behaviour
 * byte-for-byte — only a CUSTOM role (role_id set) can now diverge from its
 * chassis role.
 */
describe('EquipePage — mutation buttons gated on equipe:editar (desktop)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viewport.desktop = true;
    pendingInvites.rows = [];
    mockUseWorkspaceLimits.mockReturnValue({
      limits: { max_team_members: 10 },
      features: null,
      planName: 'Pro',
      isLoading: false,
      isUnlimited: false,
    });
    mockedGetMembros.mockResolvedValue([]);
    mockedGetWorkspaceUsers.mockResolvedValue([]);
  });

  function renderWithCan(can: ReturnType<typeof makeCan>) {
    mockUseAuth.mockReturnValue({
      canSeeFinancials: true,
      can,
      profile: { id: 'me', nome: 'Eu', conta_id: 'ws-1' },
    });
    return renderPage();
  }

  it('keeps a legacy agent blocked (equipe preset is none, matches the old isAgent gate)', async () => {
    renderWithCan(makeCan(fakeMembership({ role: 'agent' })));

    await screen.findByText('Equipe');
    expect(screen.queryByRole('button', { name: 'Adicionar Membro' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Importar CSV' })).not.toBeInTheDocument();
    expect(mockedGetWorkspaceUsers).not.toHaveBeenCalled();
  });

  it('keeps a legacy admin unchanged (equipe preset resolves to true, matches the old canManageWorkspace gate)', async () => {
    renderWithCan(makeCan(fakeMembership({ role: 'admin' })));

    await screen.findByText('Equipe');
    expect(screen.getByRole('button', { name: 'Adicionar Membro' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Importar CSV' })).toBeInTheDocument();
    await waitFor(() => {
      expect(mockedGetWorkspaceUsers).toHaveBeenCalled();
    });
  });

  it('blocks Adicionar Membro/Importar CSV for a custom role with equipe:ver only', async () => {
    renderWithCan(
      makeCan(fakeMembership({ role: 'agent', role_id: 'role-1', permissions: { equipe: 'ver' } })),
    );

    await screen.findByText('Equipe');
    expect(screen.queryByRole('button', { name: 'Adicionar Membro' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Importar CSV' })).not.toBeInTheDocument();
    expect(mockedGetWorkspaceUsers).not.toHaveBeenCalled();
  });

  it('unblocks Adicionar Membro/Importar CSV for a custom role with equipe:editar (the fix)', async () => {
    renderWithCan(
      makeCan(
        fakeMembership({ role: 'agent', role_id: 'role-1', permissions: { equipe: 'editar' } }),
      ),
    );

    await screen.findByText('Equipe');
    expect(screen.getByRole('button', { name: 'Adicionar Membro' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Importar CSV' })).toBeInTheDocument();
    await waitFor(() => {
      expect(mockedGetWorkspaceUsers).toHaveBeenCalled();
    });
  });
});

describe('EquipePage — mutation actions gated on equipe:editar (phone)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viewport.desktop = false;
    pendingInvites.rows = [];
    mockUseWorkspaceLimits.mockReturnValue({
      limits: { max_team_members: 10 },
      features: null,
      planName: 'Pro',
      isLoading: false,
      isUnlimited: false,
    });
    mockedGetMembros.mockResolvedValue([
      { id: 3, nome: 'Bruno', cargo: 'Redator', tipo: 'clt', avatar_url: '', crm_user_id: null },
    ] as never);
    mockedGetWorkspaceUsers.mockResolvedValue([]);
  });

  function renderWithCan(can: ReturnType<typeof makeCan>) {
    mockUseAuth.mockReturnValue({
      canSeeFinancials: true,
      can,
      profile: { id: 'me', nome: 'Eu', conta_id: 'ws-1' },
    });
    return renderPage();
  }

  it('keeps a legacy agent read-only: notice, no "+", no swipe actions', async () => {
    renderWithCan(makeCan(fakeMembership({ role: 'agent' })));

    expect(await screen.findByText('Bruno')).toBeInTheDocument();
    expect(screen.getByText('Visualização limitada')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Adicionar: Adicionar Membro ou Importar CSV' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
    expect(screen.queryByText('sem conta vinculada')).not.toBeInTheDocument();
  });

  it('gives a custom role with equipe:editar the "+" sheet with Adicionar Membro and Importar CSV', async () => {
    renderWithCan(
      makeCan(
        fakeMembership({ role: 'agent', role_id: 'role-1', permissions: { equipe: 'editar' } }),
      ),
    );

    fireEvent.click(
      await screen.findByRole('button', { name: 'Adicionar: Adicionar Membro ou Importar CSV' }),
    );
    const sheet = await screen.findByRole('dialog', { name: 'Adicionar' });
    expect(within(sheet).getByRole('button', { name: 'Adicionar Membro' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Importar CSV' })).toBeInTheDocument();
    expect(within(sheet).getByText(/Colunas CSV: nome\*, cargo\*/)).toBeInTheDocument();
  });
});

describe('EquipePage on phones', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viewport.desktop = false;
    pendingInvites.rows = [];
    mockUseWorkspaceLimits.mockReturnValue({
      limits: { max_team_members: 10 },
      features: null,
      planName: 'Pro',
      isLoading: false,
      isUnlimited: false,
    });
    mockUseAuth.mockReturnValue({
      canSeeFinancials: true,
      can: makeCan(fakeMembership({ role: 'owner' })),
      profile: { id: 'me', nome: 'Eu', conta_id: 'ws-1' },
    });
    mockedGetWorkspaceUsers.mockResolvedValue([]);
    mockedGetWorkspaceRoles.mockResolvedValue([]);
    mockedGetMembros.mockResolvedValue([
      {
        id: 1,
        nome: 'Ana',
        cargo: 'Designer',
        tipo: 'clt',
        avatar_url: '',
        crm_user_id: 'u1',
        custo_mensal: 3000,
      },
      {
        id: 2,
        nome: 'Bruno',
        cargo: 'Redator',
        tipo: 'freelancer_mensal',
        avatar_url: '',
        crm_user_id: null,
        custo_mensal: 1800,
      },
      {
        id: 4,
        nome: 'Diego',
        cargo: 'Editor de vídeo',
        tipo: 'freelancer_demanda',
        avatar_url: '',
        crm_user_id: null,
        custo_mensal: 900,
      },
    ] as never);
  });

  it('renders the phone header, the link badges and the Membros vs Usuários footnote', async () => {
    pendingInvites.rows = [
      {
        id: 'i1',
        email: 'diego@exemplo.com',
        role: 'agent',
        membro_id: 4,
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        status: 'pending',
      },
    ];
    renderPage();

    expect(await screen.findByText('Bruno')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Equipe' })).toBeInTheDocument();
    expect(document.querySelector('.header')).toBeNull();
    expect(screen.getByText('Redator · Freelancer Mensal')).toBeInTheDocument();
    const bruno = screen.getByText('Bruno').closest('li') as HTMLElement;
    expect(within(bruno).getByText('sem conta vinculada')).toBeInTheDocument();
    const diego = screen.getByText('Diego').closest('li') as HTMLElement;
    expect(await within(diego).findByText('convite pendente')).toBeInTheDocument();
    const ana = screen.getByText('Ana').closest('li') as HTMLElement;
    expect(within(ana).queryByText('sem conta vinculada')).not.toBeInTheDocument();
    expect(screen.getByText(/Usuários do workspace são contas com acesso ao CRM/)).toBeVisible();
  });

  it('opens the member when a row is tapped', async () => {
    renderPage();

    fireEvent.click(await screen.findByText('Bruno'));
    expect(mockNavigate).toHaveBeenCalledWith('/equipe/2');
  });

  it('filters by Tipo and sorts by cost from the filters sheet', async () => {
    renderPage();
    await screen.findByText('Bruno');

    fireEvent.click(screen.getByRole('button', { name: 'Filtros: Tipo e Ordenar por' }));
    const sheet = await screen.findByRole('dialog', { name: 'Filtros' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'CLT' }));
    expect(within(sheet).getByRole('button', { name: 'Ver 1' })).toBeInTheDocument();
    expect(screen.queryByText('Bruno')).not.toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Todos' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Custo (menor)' }));
    // The sheet is modal (the page behind it is aria-hidden), so read the rows by class.
    const names = Array.from(document.querySelectorAll('.phone-crud-row__title')).map(
      (el) => el.textContent,
    );
    expect(names).toEqual(['Diego', 'Bruno', 'Ana']);
    expect(
      screen.getByRole('button', { name: 'Filtros: Tipo e Ordenar por, 1 ativos', hidden: true }),
    ).toBeInTheDocument();
  });

  it('offers no cost sort without financial access', async () => {
    mockUseAuth.mockReturnValue({
      canSeeFinancials: false,
      can: makeCan(fakeMembership({ role: 'owner' })),
      profile: { id: 'me', nome: 'Eu', conta_id: 'ws-1' },
    });
    renderPage();
    await screen.findByText('Bruno');

    fireEvent.click(screen.getByRole('button', { name: 'Filtros: Tipo e Ordenar por' }));
    const sheet = await screen.findByRole('dialog', { name: 'Filtros' });
    expect(within(sheet).getByRole('button', { name: 'Nome' })).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Custo (maior)' })).not.toBeInTheDocument();
    expect(screen.queryByText('Custo mensal total')).not.toBeInTheDocument();
  });

  it('keeps the ?novo deep link opening the add form', async () => {
    renderPage('/equipe?novo=1');

    expect(await screen.findByRole('dialog', { name: 'Adicionar Membro' })).toBeInTheDocument();
  });

  it('asks before removing a member from the swipe action', async () => {
    renderPage();
    const row = (await screen.findByText('Bruno')).closest('li') as HTMLElement;

    fireEvent.click(within(row).getByRole('button', { name: 'Remover' }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Remover este membro?');
  });
});

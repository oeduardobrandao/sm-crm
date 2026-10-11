import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCan, fakeMembership } from '@/test/makeCan';

// No useIsDesktop mock: jsdom's matchMedia is false, so the tab renders its phone branch.

const { useAuthMock, storeMock, invitesRowsHolder } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  storeMock: {
    getInitials: vi.fn((name: string) => (name ? name[0].toUpperCase() : '?')),
    getWorkspaceUsers: vi.fn(async () => [] as Record<string, unknown>[]),
    getWorkspaceRoles: vi.fn(async () => [] as { id: string; nome: string }[]),
    removeWorkspaceUser: vi.fn(async () => {}),
    updateWorkspaceUserRole: vi.fn(async () => {}),
    setWorkspaceUserFinancialAccess: vi.fn(async () => {}),
  },
  invitesRowsHolder: { current: [] as Record<string, unknown>[] },
}));

vi.mock('../../../../context/AuthContext', () => ({ useAuth: useAuthMock }));
vi.mock('../../../../store', () => storeMock);
vi.mock('@/lib/analytics', () => ({ captureEvent: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/components/layout/PhoneShellHeader', () => ({
  PhoneShellActions: () => <div data-testid="shell-actions" />,
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

const MEMBERS = [
  { id: 'me', nome: 'Ana Dona', role: 'owner' },
  { id: 'u2', nome: 'Beto Admin', role: 'admin', can_see_financials: true },
  { id: 'u3', nome: 'Carla Agente', role: 'agent' },
  {
    id: 'u4',
    nome: 'Diego Editor',
    role: 'agent',
    role_id: 'role-1',
    papel_nome: 'Editor de conteúdo',
  },
];
const ROLES = [
  { id: 'role-1', nome: 'Editor de conteúdo' },
  { id: 'role-2', nome: 'Financeiro Only' },
];

function setAuth(
  workspaceRole: 'owner' | 'admin' | 'agent',
  can = makeCan(fakeMembership({ role: workspaceRole })),
) {
  useAuthMock.mockReturnValue({
    user: { id: 'me', email: 'me@exemplo.com' },
    profile: { id: 'me', nome: 'Ana Dona', conta_id: 'ws-1', role: workspaceRole },
    role: workspaceRole,
    workspaceRole,
    can,
    loading: false,
    signOut: vi.fn(),
    refetchProfile: vi.fn(),
  });
}

function renderTab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <MembrosTab />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const fetchMock = vi.fn(async (..._args: unknown[]) => ({
  ok: true,
  json: async () => ({ success: true, message: 'Convite enviado!' }),
}));

describe('MembrosTab (phone)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeMock.getInitials.mockImplementation((name: string) =>
      name ? name[0].toUpperCase() : '?',
    );
    storeMock.getWorkspaceUsers.mockResolvedValue(MEMBERS);
    storeMock.getWorkspaceRoles.mockResolvedValue(ROLES);
    storeMock.removeWorkspaceUser.mockResolvedValue(undefined);
    storeMock.updateWorkspaceUserRole.mockResolvedValue(undefined);
    storeMock.setWorkspaceUserFinancialAccess.mockResolvedValue(undefined);
    invitesRowsHolder.current = [];
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
    setAuth('owner');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the roster under the nav bar with the "+" invite button', async () => {
    renderTab();
    expect(screen.getByRole('heading', { level: 1, name: 'Membros' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Voltar para Configurações' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Convidar' })).toBeInTheDocument();

    expect(await screen.findByText('Ana Dona (você)')).toBeInTheDocument();
    expect(screen.getByText('Admin · vê o financeiro')).toBeInTheDocument();
    expect(screen.getByText('Editor de conteúdo')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Toque em um membro para mudar a função, ligar o acesso ao financeiro ou remover.',
      ),
    ).toBeInTheDocument();
    // Self is not actionable; the others are.
    expect(screen.queryByRole('button', { name: /Ana Dona/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Carla Agente/ })).toBeInTheDocument();
    // No desktop row markup.
    expect(document.querySelector('.config-member-row')).toBeNull();
  });

  it('changes a member role from the member screen through the same update', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: /Carla Agente/ }));
    expect(screen.getByRole('heading', { level: 1, name: 'Carla Agente' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Função/ }));
    const picker = await screen.findByRole('dialog', { name: 'Função' });
    fireEvent.click(within(picker).getByRole('button', { name: 'Editor de conteúdo' }));

    await waitFor(() =>
      expect(storeMock.updateWorkspaceUserRole).toHaveBeenCalledWith('u3', { roleId: 'role-1' }),
    );
    expect(toast.success).toHaveBeenCalledWith('Função atualizada!');

    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Membros' })).toBeInTheDocument();
  });

  it('the owner toggles an admin financial access from the member screen', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: /Beto Admin/ }));
    const toggle = screen.getByRole('switch', { name: 'Ver financeiro' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(storeMock.setWorkspaceUserFinancialAccess).toHaveBeenCalledWith('u2', false),
    );
  });

  it('an admin viewer gets no "Ver financeiro" switch (owner-only lever)', async () => {
    setAuth('admin');
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: /Beto Admin/ }));
    expect(screen.getByRole('heading', { level: 1, name: 'Beto Admin' })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Ver financeiro' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remover do workspace' })).toBeInTheDocument();
  });

  it('removes a member after the confirm, then returns to the list', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: /Carla Agente/ }));
    storeMock.getWorkspaceUsers.mockResolvedValue(MEMBERS.filter((m) => m.id !== 'u3'));

    fireEvent.click(screen.getByRole('button', { name: 'Remover do workspace' }));
    const confirm = await screen.findByRole('dialog', { name: 'Remover membro?' });
    expect(storeMock.removeWorkspaceUser).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remover' }));

    await waitFor(() => expect(storeMock.removeWorkspaceUser).toHaveBeenCalledWith('u3'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Membros' })).toBeInTheDocument();
    expect(screen.queryByText('Carla Agente')).not.toBeInTheDocument();
  });

  it('sends an invite from the sheet with the picked custom papel', async () => {
    renderTab();
    await screen.findByText('Ana Dona (você)');
    fireEvent.click(screen.getByRole('button', { name: 'Convidar' }));
    const sheet = await screen.findByRole('dialog', { name: 'Convidar Membro' });

    // Same validation as desktop.
    fireEvent.click(within(sheet).getByRole('button', { name: 'Enviar Convite' }));
    expect(toast.error).toHaveBeenCalledWith('Email é obrigatório.');
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(within(sheet).getByLabelText('Email'), {
      target: { value: 'nova@equipe.com' },
    });
    fireEvent.click(within(sheet).getByRole('button', { name: /Função/ }));
    const picker = await screen.findByRole('dialog', { name: 'Função' });
    fireEvent.click(within(picker).getByRole('button', { name: 'Financeiro Only' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Função' })).not.toBeInTheDocument(),
    );

    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Convidar Membro' })).getByRole('button', {
        name: 'Enviar Convite',
      }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/functions/v1/invite-user');
    expect(JSON.parse(String(init.body))).toEqual({
      email: 'nova@equipe.com',
      role: 'agent',
      role_id: 'role-2',
    });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Convidar Membro' })).not.toBeInTheDocument(),
    );
  });

  it('cancels an invite from the swipe action after the confirm', async () => {
    invitesRowsHolder.current = [
      {
        id: 'inv-1',
        email: 'gabi@agencia.com',
        role: 'agent',
        role_id: null,
        status: 'pending',
        expires_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ];
    renderTab();
    expect(await screen.findByText('gabi@agencia.com')).toBeInTheDocument();
    expect(screen.getByText('Pendente')).toBeInTheDocument();
    expect(screen.getByText('agente')).toBeInTheDocument();
    expect(screen.getByText(/restantes$/)).toBeInTheDocument();
    expect(screen.getByText('Deslize um convite para reenviar ou cancelar.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    const confirm = await screen.findByRole('dialog', { name: 'Cancelar convite?' });
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Sim' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('invite-user?id=inv-1');
    expect(init.method).toBe('DELETE');
  });

  it('resends an invite from the context menu trigger', async () => {
    invitesRowsHolder.current = [
      {
        id: 'inv-2',
        email: 'hugo@cafe.com',
        role: 'admin',
        role_id: null,
        status: 'pending',
        expires_at: '2020-01-01T00:00:00Z',
      },
    ];
    renderTab();
    // Past expires_at: shown as expired, as on desktop.
    expect(await screen.findByText('Expirado')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Mais ações do convite para hugo@cafe.com' }),
    );
    const menu = await screen.findByRole('menu', { name: 'Ações do convite para hugo@cafe.com' });
    expect(within(menu).getByRole('menuitem', { name: 'Cancelar convite' })).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Reenviar' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      email: 'hugo@cafe.com',
      role: 'admin',
      role_id: null,
    });
  });

  it('a view-only role sees the roster and invites without any action', async () => {
    setAuth(
      'agent',
      makeCan(fakeMembership({ role: 'agent', role_id: 'role-x', permissions: { equipe: 'ver' } })),
    );
    invitesRowsHolder.current = [
      {
        id: 'inv-1',
        email: 'gabi@agencia.com',
        role: 'agent',
        status: 'pending',
        expires_at: null,
      },
    ];
    renderTab();
    expect(await screen.findByText('gabi@agencia.com')).toBeInTheDocument();
    expect(screen.getByText('Beto Admin')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Convidar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Beto Admin/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Toque em um membro/)).not.toBeInTheDocument();
  });
});

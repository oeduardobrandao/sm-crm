import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_ROLE_PRESET, PERMISSION_MODULES } from '@/lib/permissions';

// jsdom's matchMedia is false: the tab renders its phone branch.
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => false }));

const { useAuthMock, storeMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  storeMock: {
    getWorkspaceRoles: vi.fn(async () => [] as unknown[]),
    getWorkspaceRoleMemberCounts: vi.fn(async () => ({}) as Record<string, number>),
    createWorkspaceRole: vi.fn(async () => {}),
    updateWorkspaceRole: vi.fn(async () => {}),
    deleteWorkspaceRole: vi.fn(async () => {}),
  },
}));

vi.mock('../../../../context/AuthContext', () => ({ useAuth: useAuthMock }));
vi.mock('../../../../store', () => storeMock);
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/components/layout/PhoneShellHeader', () => ({
  PhoneShellActions: () => <div data-testid="shell-actions" />,
}));

import { toast } from 'sonner';
import PapeisTab from '../PapeisTab';

const EDITOR_PERMISSIONS = Object.fromEntries(
  PERMISSION_MODULES.map((m) => [m, m === 'entregas' ? 'editar' : 'none']),
);

const ROLES = [{ id: 'role-1', nome: 'Editor de conteúdo', permissions: EDITOR_PERMISSIONS }];

function setAuth(workspaceRole: 'owner' | 'admin' | 'agent') {
  useAuthMock.mockReturnValue({
    user: { id: 'me', email: 'me@exemplo.com' },
    profile: { id: 'me', nome: 'Eu', conta_id: 'ws-1', role: workspaceRole },
    role: workspaceRole,
    workspaceRole,
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
        <PapeisTab />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function heading() {
  return screen.getByRole('heading', { level: 1 });
}

async function openEditor() {
  fireEvent.click(await screen.findByRole('button', { name: /Editor de conteúdo/ }));
  await waitFor(() => expect(heading()).toHaveTextContent('Editor de conteúdo'));
}

beforeEach(() => {
  vi.clearAllMocks();
  storeMock.getWorkspaceRoles.mockResolvedValue(ROLES);
  storeMock.getWorkspaceRoleMemberCounts.mockResolvedValue({ 'role-1': 3 });
  setAuth('owner');
});

describe('PapeisTab (phone): list', () => {
  it('renders the nav bar, the title and the roles with their subtitles', async () => {
    renderTab();
    expect(heading()).toHaveTextContent('Papéis');
    expect(screen.getByRole('button', { name: 'Voltar para Configurações' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Novo papel' })).toBeInTheDocument();

    expect(screen.getByRole('button', { name: /Administrador/ })).toHaveTextContent(
      'Padrão do sistema',
    );
    expect(screen.getByRole('button', { name: /^Agente/ })).toHaveTextContent('Padrão do sistema');
    const custom = await screen.findByRole('button', { name: /Editor de conteúdo/ });
    expect(custom).toHaveTextContent('3 membros · 1 editar · 13 sem acesso');
    // The desktop Dialog/AlertDialog never mount on phones.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the system rows and shows a skeleton (no empty hint) while the custom roles load', () => {
    storeMock.getWorkspaceRoles.mockReturnValue(new Promise(() => {}));
    renderTab();
    expect(screen.getByRole('button', { name: /Administrador/ })).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(
      screen.queryByText('Toque em + para criar um papel personalizado.'),
    ).not.toBeInTheDocument();
  });

  it('renders nothing for a non-owner', () => {
    setAuth('admin');
    const { container } = renderTab();
    expect(container).toBeEmptyDOMElement();
  });
});

describe('PapeisTab (phone): system roles', () => {
  it('Administrador opens a read-only screen with its levels and the Financeiro note; Back returns', async () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /Administrador/ }));

    expect(heading()).toHaveTextContent('Administrador');
    expect(screen.getByText('Conforme o acesso financeiro de cada admin')).toBeInTheDocument();
    expect(screen.getAllByText('Pode editar').length).toBe(PERMISSION_MODULES.length - 1);
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Excluir papel' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(heading()).toHaveTextContent('Papéis');
  });

  it('Agente shows the agent preset levels', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: /^Agente/ }));
    expect(heading()).toHaveTextContent('Agente');
    const editar = Object.values(AGENT_ROLE_PRESET).filter((l) => l === 'editar').length;
    expect(screen.getAllByText('Pode editar')).toHaveLength(editar);
  });
});

describe('PapeisTab (phone): editing a custom role', () => {
  it('opens the role screen with the subtitle, the warning and one segmented control per module', async () => {
    renderTab();
    await openEditor();

    expect(screen.getByText('Papel personalizado · 3 membros')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'As mudanças valem na hora para os 3 membros com este papel.',
    );
    expect(screen.getByLabelText('Nome')).toHaveValue('Editor de conteúdo');
    expect(screen.getAllByRole('radiogroup', { name: /^Nível de acesso para / })).toHaveLength(
      PERMISSION_MODULES.length,
    );
    expect(
      within(screen.getByRole('radiogroup', { name: 'Nível de acesso para Entregas' })).getByRole(
        'radio',
        { name: 'Editar' },
      ),
    ).toHaveAttribute('aria-checked', 'true');
    expect(screen.getAllByText('servidor').length).toBeGreaterThan(0);
    expect(
      screen.getByText(
        'Módulos com selo "servidor" são aplicados no banco. Os demais são aplicados na interface do CRM.',
      ),
    ).toBeInTheDocument();
    // "Começar de" is only for a new role.
    expect(screen.queryByRole('radiogroup', { name: 'Começar de' })).not.toBeInTheDocument();
  });

  it('a level change is saved through updateWorkspaceRole and the screen closes on success', async () => {
    renderTab();
    await openEditor();

    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: 'Nível de acesso para Leads' })).getByRole(
        'radio',
        { name: 'Ver' },
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    await waitFor(() => expect(storeMock.updateWorkspaceRole).toHaveBeenCalledTimes(1));
    const [roleId, nome, permissions] = storeMock.updateWorkspaceRole.mock.calls[0] as unknown as [
      string,
      string,
      Record<string, string>,
    ];
    expect(roleId).toBe('role-1');
    expect(nome).toBe('Editor de conteúdo');
    expect(permissions).toEqual({ ...EDITOR_PERMISSIONS, leads: 'ver' });
    await waitFor(() => expect(heading()).toHaveTextContent('Papéis'));
    expect(toast.success).toHaveBeenCalledWith('Papel atualizado!');
  });

  it('Back drops the unsaved edits: reopening shows the stored role', async () => {
    renderTab();
    await openEditor();
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Outro nome' } });
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(heading()).toHaveTextContent('Papéis');

    await openEditor();
    expect(screen.getByLabelText('Nome')).toHaveValue('Editor de conteúdo');
    expect(storeMock.updateWorkspaceRole).not.toHaveBeenCalled();
  });

  it('"Excluir papel" confirms with the desktop copy, deletes and returns to the list', async () => {
    renderTab();
    await openEditor();

    fireEvent.click(screen.getByRole('button', { name: 'Excluir papel' }));
    const sheet = await screen.findByRole('dialog', {
      name: 'Excluir papel "Editor de conteúdo"?',
    });
    expect(within(sheet).getByText('Esta ação não pode ser desfeita.')).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Excluir' }));

    await waitFor(() => expect(storeMock.deleteWorkspaceRole).toHaveBeenCalledWith('role-1'));
    await waitFor(() => expect(heading()).toHaveTextContent('Papéis'));
  });

  it('cancelling the delete keeps the role screen', async () => {
    renderTab();
    await openEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Excluir papel' }));
    const sheet = await screen.findByRole('dialog', { name: /Excluir papel/ });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancelar' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(storeMock.deleteWorkspaceRole).not.toHaveBeenCalled();
    expect(heading()).toHaveTextContent('Editor de conteúdo');
  });
});

describe('PapeisTab (phone): creating a role', () => {
  it('"+" opens the create screen; a preset fills the levels and Criar papel creates it', async () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Novo papel' }));
    expect(heading()).toHaveTextContent('Novo papel');

    const presets = screen.getByRole('radiogroup', { name: 'Começar de' });
    expect(within(presets).getByRole('radio', { name: 'Em branco' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    fireEvent.click(within(presets).getByRole('radio', { name: 'Agente' }));
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: '  Social media  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar papel' }));

    await waitFor(() =>
      expect(storeMock.createWorkspaceRole).toHaveBeenCalledWith('Social media', AGENT_ROLE_PRESET),
    );
    await waitFor(() => expect(heading()).toHaveTextContent('Papéis'));
  });

  it('an empty name is rejected with the desktop message and nothing is sent', () => {
    renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Novo papel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Criar papel' }));

    expect(toast.error).toHaveBeenCalledWith('Informe um nome para o papel.');
    expect(storeMock.createWorkspaceRole).not.toHaveBeenCalled();
    expect(heading()).toHaveTextContent('Novo papel');
  });
});

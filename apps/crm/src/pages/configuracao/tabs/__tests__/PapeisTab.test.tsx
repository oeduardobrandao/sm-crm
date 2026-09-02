import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { useAuthMock, storeMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  storeMock: {
    getWorkspaceRoles: vi.fn(async () => []),
    getWorkspaceRoleMemberCounts: vi.fn(async () => ({})),
    createWorkspaceRole: vi.fn(async () => {}),
    updateWorkspaceRole: vi.fn(async () => {}),
    deleteWorkspaceRole: vi.fn(async () => {}),
  },
}));

vi.mock('../../../../context/AuthContext', () => ({
  useAuth: useAuthMock,
}));

vi.mock('../../../../store', () => storeMock);

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// Radix Select requires pointer-capture/scrollIntoView APIs jsdom doesn't
// implement — mocked the same way TikTokSettingsPanel.test.tsx / WorkflowModals.test.tsx
// do, so onValueChange is still exercised without fighting jsdom.
vi.mock('@/components/ui/select', async () => {
  const ReactModule = await vi.importActual<typeof import('react')>('react');

  interface SelectContextValue {
    value?: string;
    onValueChange?: (value: string) => void;
  }
  const SelectContext = ReactModule.createContext<SelectContextValue>({});

  function Select({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children: React.ReactNode;
  }) {
    return (
      <SelectContext.Provider value={{ value, onValueChange }}>
        <div>{children}</div>
      </SelectContext.Provider>
    );
  }
  function SelectTrigger({ children }: { children: React.ReactNode }) {
    return <button type="button">{children}</button>;
  }
  function SelectValue({ placeholder }: { placeholder?: string }) {
    const { value } = ReactModule.useContext(SelectContext);
    return <span>{value || placeholder || ''}</span>;
  }
  function SelectContent({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>;
  }
  function SelectItem({ value, children }: { value: string; children: React.ReactNode }) {
    const { onValueChange } = ReactModule.useContext(SelectContext);
    return (
      <button type="button" onClick={() => onValueChange?.(value)}>
        {children}
      </button>
    );
  }

  return { Select, SelectTrigger, SelectValue, SelectContent, SelectItem };
});

import { toast } from 'sonner';
import PapeisTab from '../PapeisTab';

function renderTab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PapeisTab />
    </QueryClientProvider>,
  );
}

function setAuth(workspaceRole: 'owner' | 'admin' | 'agent' | null) {
  useAuthMock.mockReturnValue({
    user: { id: 'me', email: 'me@exemplo.com' },
    profile: { id: 'me', nome: 'Eu', conta_id: 'ws-1', role: workspaceRole ?? 'agent' },
    role: workspaceRole ?? 'agent',
    workspaceRole,
    loading: false,
    signOut: vi.fn(),
    refetchProfile: vi.fn(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  storeMock.getWorkspaceRoles.mockResolvedValue([]);
  storeMock.getWorkspaceRoleMemberCounts.mockResolvedValue({});
});

describe('PapeisTab — presets', () => {
  it('renders Administrador and Agente as read-only system presets, with no Editar/Excluir buttons', async () => {
    setAuth('owner');
    renderTab();

    await screen.findByText('Administrador');
    expect(screen.getByText('Agente')).toBeInTheDocument();
    expect(screen.getAllByText('Padrão do sistema')).toHaveLength(2);

    // No edit/delete controls anywhere yet — only the two system cards are rendered.
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument();
  });
});

describe('PapeisTab — custom roles list', () => {
  it('renders custom roles from getWorkspaceRoles with their member count', async () => {
    setAuth('owner');
    storeMock.getWorkspaceRoles.mockResolvedValue([
      {
        id: 'role-1',
        nome: 'Social Media',
        permissions: { clientes: 'editar', financeiro: 'none' },
        created_at: '2026-01-01T00:00:00Z',
      },
    ]);
    storeMock.getWorkspaceRoleMemberCounts.mockResolvedValue({ 'role-1': 3 });
    renderTab();

    await screen.findByText('Social Media');
    expect(screen.getByText('3 membros')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Excluir' })).toBeInTheDocument();
  });

  it('shows 0 membros for a custom role absent from the member-count map', async () => {
    setAuth('owner');
    storeMock.getWorkspaceRoles.mockResolvedValue([
      {
        id: 'role-2',
        nome: 'Financeiro Only',
        permissions: {},
        created_at: '2026-01-01T00:00:00Z',
      },
    ]);
    renderTab();

    await screen.findByText('Financeiro Only');
    expect(screen.getByText('0 membros')).toBeInTheDocument();
  });
});

describe('PapeisTab — create dialog', () => {
  it('shows the 14 modules with 3 level options each, and "Criar papel" calls createWorkspaceRole with the assembled permissions', async () => {
    setAuth('owner');
    renderTab();

    fireEvent.click(await screen.findByRole('button', { name: 'Novo papel' }));

    const dialog = screen.getByRole('dialog');

    // 14 module labels (system preset cards behind the dialog repeat these
    // labels too, so scope to the dialog itself).
    for (const label of [
      'Clientes',
      'Entregas',
      'Calendário',
      'Aprovações',
      'Arquivos',
      'Ideias',
      'Tarefas',
      'Leads',
      'Financeiro',
      'Contratos',
      'Equipe',
      'Analytics e Relatórios',
      'Automações',
      'Configurações do workspace',
    ]) {
      expect(within(dialog).getByText(label)).toBeInTheDocument();
    }

    // 3 level options per module row (14 modules), present as buttons via the Select mock.
    expect(within(dialog).getAllByRole('button', { name: 'Sem acesso' })).toHaveLength(14);
    expect(within(dialog).getAllByRole('button', { name: 'Pode ver' })).toHaveLength(14);
    expect(within(dialog).getAllByRole('button', { name: 'Pode editar' })).toHaveLength(14);

    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Social Media' } });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Criar papel' }));

    await waitFor(() => {
      expect(storeMock.createWorkspaceRole).toHaveBeenCalledTimes(1);
    });
    const [nome, permissions] = storeMock.createWorkspaceRole.mock.calls[0];
    expect(nome).toBe('Social Media');
    expect(Object.keys(permissions)).toHaveLength(14);
    expect(permissions.clientes).toBe('none');
    expect(permissions.financeiro).toBe('none');
  });

  it('filling the preset "Agente" fills the grade with the AGENT_ROLE_PRESET levels before submit', async () => {
    setAuth('owner');
    renderTab();

    fireEvent.click(await screen.findByRole('button', { name: 'Novo papel' }));
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Copia do Agente' } });

    fireEvent.click(screen.getByRole('button', { name: 'Agente' }));
    fireEvent.click(screen.getByRole('button', { name: 'Criar papel' }));

    await waitFor(() => {
      expect(storeMock.createWorkspaceRole).toHaveBeenCalledWith(
        'Copia do Agente',
        expect.objectContaining({
          clientes: 'editar',
          financeiro: 'none',
          equipe: 'none',
          analytics: 'ver',
        }),
      );
    });
  });
});

describe('PapeisTab — delete', () => {
  it('shows the role_in_use error as a toast with the reassign-members message', async () => {
    setAuth('owner');
    storeMock.getWorkspaceRoles.mockResolvedValue([
      { id: 'role-1', nome: 'Social Media', permissions: {}, created_at: '2026-01-01T00:00:00Z' },
    ]);
    storeMock.getWorkspaceRoleMemberCounts.mockResolvedValue({ 'role-1': 2 });
    storeMock.deleteWorkspaceRole.mockRejectedValueOnce(new Error('role_in_use'));
    renderTab();

    await screen.findByText('Social Media');
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }));

    const confirmDialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(confirmDialog).getByRole('button', { name: 'Excluir' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Reatribua os membros antes de excluir este papel.');
    });
  });
});

describe('PapeisTab — non-owner guard', () => {
  it('renders nothing when workspaceRole is not owner', () => {
    setAuth('admin');
    const { container } = renderTab();

    expect(container).toBeEmptyDOMElement();
    expect(storeMock.getWorkspaceRoles).not.toHaveBeenCalled();
  });
});

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSION_MODULES } from '@/lib/permissions';

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

/** Scopes into a role's row-card by its name (the row-toggle button's accessible
 * name concatenates nome + badge/member-count + summary with no separators, so
 * callers matching by name should use a substring regex, not an exact string). */
async function getRoleRow(nome: string) {
  const nameEl = await screen.findByText(nome);
  const row = nameEl.closest('.config-member-row');
  expect(row).not.toBeNull();
  return row as HTMLElement;
}

/** Expands a role row by clicking its chevron/name toggle button — always the
 * first button in the row (Editar/Excluir, when present, come after it). */
function expandRow(row: HTMLElement) {
  fireEvent.click(within(row).getAllByRole('button')[0]);
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

    // No edit/delete controls anywhere yet — only the two system rows are rendered.
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument();
  });

  it('Administrador row expands to a "conforme o acesso" chip for Financeiro instead of a fixed level (real access is per-admin)', async () => {
    // Real Financeiro access for a restricted admin depends on that member's
    // own "Ver financeiro" switch on the Equipe tab, so the read-only
    // Administrador row must not claim a fixed "editar" chip for it.
    setAuth('owner');
    renderTab();

    const adminRow = await getRoleRow('Administrador');
    expandRow(adminRow);
    expect(
      within(adminRow).getByText('Conforme o acesso financeiro de cada admin'),
    ).toBeInTheDocument();
    // The override replaces the module's normal chip — no plain "Financeiro" chip alongside it.
    expect(within(adminRow).queryByText('Financeiro')).not.toBeInTheDocument();

    // The Agente row is unaffected — Financeiro renders as a normal "sem acesso" chip.
    const agenteRow = await getRoleRow('Agente');
    expandRow(agenteRow);
    expect(
      within(agenteRow).queryByText('Conforme o acesso financeiro de cada admin'),
    ).not.toBeInTheDocument();
    expect(within(agenteRow).getByText('Financeiro')).toBeInTheDocument();
  });
});

describe('PapeisTab — summary line', () => {
  it('Administrador shows the fixed override summary, Agente shows computed counts, and a role with only "editar" omits the zero segments', async () => {
    setAuth('owner');
    storeMock.getWorkspaceRoles.mockResolvedValue([
      {
        id: 'role-1',
        nome: 'Tudo Editar',
        permissions: Object.fromEntries(PERMISSION_MODULES.map((m) => [m, 'editar'])),
        created_at: '2026-01-01T00:00:00Z',
      },
    ]);
    renderTab();

    await screen.findByText('Administrador');
    expect(
      screen.getByText('Edita tudo · Financeiro conforme o acesso de cada admin'),
    ).toBeInTheDocument();
    expect(screen.getByText('8 editar · 1 ver · 5 sem acesso')).toBeInTheDocument();

    await screen.findByText('Tudo Editar');
    expect(screen.getByText('14 editar')).toBeInTheDocument();
  });
});

describe('PapeisTab — list expand/collapse', () => {
  it('chevron toggles the three grouped chip rows (Pode editar / Pode ver / Sem acesso) for a custom role', async () => {
    setAuth('owner');
    storeMock.getWorkspaceRoles.mockResolvedValue([
      {
        id: 'role-1',
        nome: 'Social Media',
        permissions: {
          entregas: 'editar',
          calendario: 'editar',
          aprovacoes: 'editar',
          ideias: 'editar',
          tarefas: 'editar',
          clientes: 'ver',
          arquivos: 'ver',
          analytics: 'ver',
          leads: 'none',
          financeiro: 'none',
          contratos: 'none',
          equipe: 'none',
          automacoes: 'none',
          configuracoes: 'none',
        },
        created_at: '2026-01-01T00:00:00Z',
      },
    ]);
    storeMock.getWorkspaceRoleMemberCounts.mockResolvedValue({ 'role-1': 3 });
    renderTab();

    await screen.findByText('Social Media');
    expect(screen.getByText('5 editar · 3 ver · 6 sem acesso')).toBeInTheDocument();

    // Collapsed by default — no chip content yet.
    expect(screen.queryByText('Pode editar')).not.toBeInTheDocument();
    expect(screen.queryByText('Aprovações')).not.toBeInTheDocument();

    const row = screen.getByText('Social Media').closest('.config-member-row') as HTMLElement;
    const toggle = within(row).getAllByRole('button')[0];
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(within(row).getByText('Pode editar')).toBeInTheDocument();
    expect(within(row).getByText('Pode ver')).toBeInTheDocument();
    expect(within(row).getByText('Sem acesso')).toBeInTheDocument();
    expect(within(row).getByText('Aprovações')).toBeInTheDocument();
    expect(within(row).getByText('Clientes')).toBeInTheDocument();
    expect(within(row).getByText('Leads')).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(row).queryByText('Aprovações')).not.toBeInTheDocument();
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
  it('groups the 14 modules into Trabalho / Clientes e análise / Gestão (mockup order), each with a 3-state segmented control', async () => {
    setAuth('owner');
    renderTab();

    fireEvent.click(await screen.findByRole('button', { name: 'Novo papel' }));
    const dialog = screen.getByRole('dialog');

    expect(within(dialog).getByText('Trabalho')).toBeInTheDocument();
    expect(within(dialog).getByText('Clientes e análise')).toBeInTheDocument();
    expect(within(dialog).getByText('Gestão')).toBeInTheDocument();

    const nodes = Array.from(
      dialog.querySelectorAll<HTMLElement>('.papeis-form-group-label, .papeis-form-row'),
    );
    const structure: { group: string; modules: string[] }[] = [];
    for (const node of nodes) {
      if (node.classList.contains('papeis-form-group-label')) {
        structure.push({ group: node.textContent ?? '', modules: [] });
      } else {
        const label = node.querySelector('label');
        structure[structure.length - 1].modules.push(
          (label?.childNodes[0]?.textContent ?? '').trim(),
        );
      }
    }

    expect(structure).toEqual([
      {
        group: 'Trabalho',
        modules: ['Entregas', 'Calendário', 'Aprovações', 'Ideias', 'Tarefas', 'Arquivos'],
      },
      { group: 'Clientes e análise', modules: ['Clientes', 'Analytics e Relatórios', 'Leads'] },
      {
        group: 'Gestão',
        modules: ['Financeiro', 'Contratos', 'Equipe', 'Automações', 'Configurações do workspace'],
      },
    ]);

    // 3-state segmented control per module row (14 modules), as accessible radios.
    expect(within(dialog).getAllByRole('radio', { name: 'Sem acesso' })).toHaveLength(14);
    expect(within(dialog).getAllByRole('radio', { name: 'Ver' })).toHaveLength(14);
    expect(within(dialog).getAllByRole('radio', { name: 'Editar' })).toHaveLength(14);
  });

  it('shows the "servidor" tag on exactly leads, financeiro, contratos, equipe, automacoes and configuracoes', async () => {
    setAuth('owner');
    renderTab();

    fireEvent.click(await screen.findByRole('button', { name: 'Novo papel' }));
    const dialog = screen.getByRole('dialog');

    const serverLabels = [
      'Leads',
      'Financeiro',
      'Contratos',
      'Equipe',
      'Automações',
      'Configurações do workspace',
    ];
    const nonServerLabels = [
      'Clientes',
      'Entregas',
      'Calendário',
      'Aprovações',
      'Arquivos',
      'Ideias',
      'Tarefas',
      'Analytics e Relatórios',
    ];

    for (const label of serverLabels) {
      const row = within(dialog).getByText(label).closest('.papeis-form-row') as HTMLElement;
      expect(within(row).getByText('servidor')).toBeInTheDocument();
    }
    for (const label of nonServerLabels) {
      const row = within(dialog).getByText(label).closest('.papeis-form-row') as HTMLElement;
      expect(within(row).queryByText('servidor')).not.toBeInTheDocument();
    }
  });

  it('"Criar papel" calls createWorkspaceRole with the assembled permissions', async () => {
    setAuth('owner');
    renderTab();

    fireEvent.click(await screen.findByRole('button', { name: 'Novo papel' }));
    const dialog = screen.getByRole('dialog');

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

  it("clicking a module's segmented control updates the create payload for that module only", async () => {
    setAuth('owner');
    renderTab();

    fireEvent.click(await screen.findByRole('button', { name: 'Novo papel' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Custom' } });

    const clientesRow = within(dialog)
      .getByText('Clientes')
      .closest('.papeis-form-row') as HTMLElement;
    fireEvent.click(within(clientesRow).getByRole('radio', { name: 'Editar' }));

    const financeiroRow = within(dialog)
      .getByText('Financeiro')
      .closest('.papeis-form-row') as HTMLElement;
    fireEvent.click(within(financeiroRow).getByRole('radio', { name: 'Ver' }));

    fireEvent.click(within(dialog).getByRole('button', { name: 'Criar papel' }));

    await waitFor(() => {
      expect(storeMock.createWorkspaceRole).toHaveBeenCalledTimes(1);
    });
    const [, permissions] = storeMock.createWorkspaceRole.mock.calls[0];
    expect(permissions.clientes).toBe('editar');
    expect(permissions.financeiro).toBe('ver');
    // Untouched modules stay at the "Em branco" default.
    expect(permissions.entregas).toBe('none');
  });

  it('filling the preset "Agente" fills the grade with the AGENT_ROLE_PRESET levels before submit', async () => {
    setAuth('owner');
    renderTab();

    fireEvent.click(await screen.findByRole('button', { name: 'Novo papel' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Copia do Agente' } });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Agente' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Criar papel' }));

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

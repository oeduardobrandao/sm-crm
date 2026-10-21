import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCan, fakeMembership } from '@/test/makeCan';

const { useAuthMock, storeMock, igUpdateMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  storeMock: {
    getCurrentWorkspace: vi.fn(),
    updateWorkspace: vi.fn(async () => {}),
  },
  igUpdateMock: vi.fn(),
}));

vi.mock('../../../../context/AuthContext', () => ({ useAuth: useAuthMock }));
vi.mock('../../../../store', () => storeMock);
vi.mock('../../../../lib/supabase', () => ({
  supabase: {
    storage: { from: () => ({ upload: vi.fn(), getPublicUrl: vi.fn() }) },
    from: () => ({
      select: () => ({
        eq: async () => ({ data: [{ id: 'ig-1', auto_sync_enabled: false }] }),
      }),
      update: (payload: unknown) => {
        igUpdateMock(payload);
        return { in: async () => ({ error: null }) };
      },
    }),
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/layout/PhoneShellHeader', () => ({
  PhoneShellActions: () => <div data-testid="shell-actions" />,
}));

import WorkspaceTab from '../WorkspaceTab';

function renderTab(role: 'owner' | 'agent-ver' = 'owner') {
  useAuthMock.mockReturnValue({
    profile: { id: 'user-1', conta_id: 'ws-1' },
    can: makeCan(
      role === 'owner'
        ? fakeMembership({ role: 'owner' })
        : fakeMembership({ role: 'agent', role_id: 'r1', permissions: { configuracoes: 'ver' } }),
    ),
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <WorkspaceTab />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('WorkspaceTab on phones', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeMock.getCurrentWorkspace.mockResolvedValue({
      id: 'ws-1',
      name: 'Agência Norte',
      logo_url: 'https://cdn.example.com/logo.png',
    });
  });

  it('renames the workspace from the nav bar Salvar', async () => {
    renderTab();
    const nome = await screen.findByLabelText('Nome do Workspace');
    expect(nome).toHaveValue('Agência Norte');
    fireEvent.change(nome, { target: { value: 'Agência Sul' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar nome do workspace' }));
    await waitFor(() =>
      expect(storeMock.updateWorkspace).toHaveBeenCalledWith('ws-1', { name: 'Agência Sul' }),
    );
  });

  it('removes the logo through the action sheet and a confirm', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: /Logo/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remover' }));
    // The confirm sheet replaces the action sheet.
    const confirm = await screen.findByRole('dialog', { name: 'Remover logo?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remover' }));
    await waitFor(() =>
      expect(storeMock.updateWorkspace).toHaveBeenCalledWith('ws-1', { logo_url: null }),
    );
  });

  it('toggles Instagram auto-sync and links the import wizard', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('switch', { name: 'Sincronização automática' }));
    await waitFor(() => expect(igUpdateMock).toHaveBeenCalledWith({ auto_sync_enabled: true }));
    expect(screen.getByRole('link', { name: /Abrir assistente de importação/ })).toHaveAttribute(
      'href',
      '/importar',
    );
  });

  it('is read-only for a role that can only see the settings', async () => {
    renderTab('agent-ver');
    expect(await screen.findByText('Somente leitura')).toBeInTheDocument();
    expect(screen.getByLabelText('Nome do Workspace')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Salvar nome do workspace' })).toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/api')>()),
  previewDeleteWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

import { toast } from 'sonner';
import {
  deleteWorkspace,
  previewDeleteWorkspace,
  type DeleteWorkspacePreview,
} from '../../../lib/api';
import { DeleteWorkspaceDialog, deleteResultMessage } from '../DeleteWorkspaceDialog';

const PREVIEW: DeleteWorkspacePreview = {
  workspace: { id: 'ws1', name: 'Social Bee' },
  counts: { clientes: 12, posts: 340, arquivos: 1, membros: 3 },
  members: [
    {
      user_id: 'u1',
      role: 'owner',
      email: 'ana@socialbee.com.br',
      name: 'Ana',
      login_deleted: true,
    },
    { user_id: 'u2', role: 'agent', email: 'bia@outra.com', name: null, login_deleted: false },
  ],
  blocker: null,
};

function renderDialog(onOpenChange = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/admin/workspaces/ws1']}>
        <Routes>
          <Route
            path="/admin/workspaces/:id"
            element={
              <DeleteWorkspaceDialog
                workspaceId="ws1"
                workspaceName="Social Bee"
                open
                onOpenChange={onOpenChange}
              />
            }
          />
          <Route path="/admin/workspaces" element={<p>lista de workspaces</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

const confirmButton = () => screen.getByRole('button', { name: 'Excluir workspace' });
const confirmInput = () => screen.getByLabelText(/Para confirmar, digite/);

describe('DeleteWorkspaceDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(previewDeleteWorkspace).mockResolvedValue(PREVIEW);
  });

  it('shows what goes and whose login goes with it', async () => {
    renderDialog();
    expect(await screen.findByText('12 clientes')).toBeTruthy();
    expect(screen.getByText('340 posts')).toBeTruthy();
    expect(screen.getByText('1 arquivo')).toBeTruthy();
    expect(
      screen.getByText(/Não têm nada em outro workspace: ana@socialbee\.com\.br/),
    ).toBeTruthy();
    expect(screen.getByText(/admins da plataforma: bia@outra\.com/)).toBeTruthy();
  });

  it('stays disabled until the exact word is typed', async () => {
    renderDialog();
    await screen.findByText('12 clientes');
    expect(confirmButton()).toBeDisabled();
    for (const wrong of ['del', 'Delete', 'DELETE', 'excluir', 'Social Bee']) {
      fireEvent.change(confirmInput(), { target: { value: wrong } });
      expect(confirmButton()).toBeDisabled();
      // Enter in the field must not get around the disabled button.
      fireEvent.submit(confirmButton().closest('form')!);
    }
    expect(deleteWorkspace).not.toHaveBeenCalled();
    fireEvent.change(confirmInput(), { target: { value: 'delete' } });
    expect(confirmButton()).toBeEnabled();
  });

  it('blocks with the billing message and never arms when a subscription is active', async () => {
    vi.mocked(previewDeleteWorkspace).mockResolvedValue({
      ...PREVIEW,
      blocker: {
        reason: 'active_subscription',
        message: 'Este workspace tem uma assinatura ativa.',
      },
    });
    renderDialog();
    expect(await screen.findByRole('alert')).toHaveTextContent('assinatura ativa');
    expect(confirmInput()).toBeDisabled();
    expect(confirmButton()).toBeDisabled();
  });

  it('deletes, toasts and leaves the page', async () => {
    vi.mocked(deleteWorkspace).mockResolvedValue({
      workspace_id: 'ws1',
      workspace_name: 'Social Bee',
      logins_deleted: 1,
      logins_kept: [],
      logins_failed: [],
    });
    const { onOpenChange } = renderDialog();
    await screen.findByText('12 clientes');
    fireEvent.change(confirmInput(), { target: { value: 'delete' } });
    fireEvent.click(confirmButton());
    await waitFor(() => expect(deleteWorkspace).toHaveBeenCalledWith('ws1', 'delete'));
    expect(await screen.findByText('lista de workspaces')).toBeTruthy();
    expect(toast.success).toHaveBeenCalledWith(
      'Workspace "Social Bee" excluído. 1 login excluído.',
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows the server error inline and stays open', async () => {
    vi.mocked(deleteWorkspace).mockRejectedValue(
      new Error('O workspace mudou durante a exclusão.'),
    );
    renderDialog();
    await screen.findByText('12 clientes');
    fireEvent.change(confirmInput(), { target: { value: 'delete' } });
    fireEvent.click(confirmButton());
    expect(await screen.findByText('O workspace mudou durante a exclusão.')).toBeTruthy();
    expect(screen.queryByText('lista de workspaces')).toBeNull();
  });
});

describe('deleteResultMessage', () => {
  it('reports kept and failed logins', () => {
    expect(
      deleteResultMessage({
        workspace_id: 'ws1',
        workspace_name: 'X',
        logins_deleted: 2,
        logins_kept: ['a@x.com'],
        logins_failed: ['b@x.com'],
      }),
    ).toBe(
      'Workspace "X" excluído. 2 logins excluídos. Mantido (entrou em outro workspace): a@x.com. Não foi possível excluir o login de b@x.com.',
    );
  });
});

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/api', () => ({
  listAdmins: vi.fn(),
  inviteAdmin: vi.fn(),
  removeAdmin: vi.fn(),
}));
vi.mock('../../context/AdminAuthContext', () => ({
  useAdminAuth: () => ({ user: { id: 'me' } }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { inviteAdmin, listAdmins, removeAdmin } from '../../lib/api';
import AdminsPage from '../AdminsPage';

const admins = [
  {
    id: 'a1',
    user_id: 'me',
    email: 'eu@mesaas.com.br',
    invited_by: null,
    invited_by_email: null,
    created_at: '2026-01-10T00:00:00.000Z',
  },
  {
    id: 'a2',
    user_id: 'u2',
    email: 'outra@mesaas.com.br',
    invited_by: 'me',
    invited_by_email: 'dono@mesaas.com.br',
    created_at: '2026-02-10T00:00:00.000Z',
  },
];

beforeEach(() => {
  vi.mocked(listAdmins).mockResolvedValue({ admins } as never);
  vi.mocked(inviteAdmin).mockResolvedValue({ admin: admins[1] } as never);
  vi.mocked(removeAdmin).mockResolvedValue({ ok: true } as never);
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AdminsPage />
    </QueryClientProvider>,
  );
}

describe('AdminsPage', () => {
  it('lists admins in a table and hides the remove button for the current user', async () => {
    renderPage();
    const table = within(await screen.findByRole('table'));
    expect(table.getByText('eu@mesaas.com.br')).toBeInTheDocument();
    expect(table.getByText('outra@mesaas.com.br')).toBeInTheDocument();
    expect(table.getAllByRole('button', { name: 'Remover admin' })).toHaveLength(1);
  });

  it('removing calls the API with the admin id', async () => {
    renderPage();
    const table = within(await screen.findByRole('table'));
    fireEvent.click(table.getByRole('button', { name: 'Remover admin' }));
    await waitFor(() => expect(removeAdmin).toHaveBeenCalledWith('a2'));
  });

  it('inviting submits the typed e-mail', async () => {
    renderPage();
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('E-mail do novo admin'), {
      target: { value: 'nova@mesaas.com.br' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Convidar admin' }));
    await waitFor(() => expect(inviteAdmin).toHaveBeenCalledWith('nova@mesaas.com.br'));
  });

  it('shows an empty state when there are no admins', async () => {
    vi.mocked(listAdmins).mockResolvedValue({ admins: [] } as never);
    renderPage();
    expect(await screen.findByText('Nenhum admin cadastrado')).toBeInTheDocument();
  });

  it('shows an error state with retry when the query fails', async () => {
    vi.mocked(listAdmins).mockRejectedValueOnce(new Error('boom'));
    renderPage();
    expect(await screen.findByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
  });
});

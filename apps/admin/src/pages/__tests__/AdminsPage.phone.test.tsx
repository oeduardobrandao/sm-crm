import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { mockPhone } from '../../__tests__/phone';

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

let restorePhone: () => void;

beforeEach(() => {
  restorePhone = mockPhone();
  vi.mocked(listAdmins).mockResolvedValue({ admins } as never);
  vi.mocked(inviteAdmin).mockResolvedValue({ admin: admins[1] } as never);
  vi.mocked(removeAdmin).mockResolvedValue({ ok: true } as never);
});

afterEach(() => restorePhone());

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AdminsPage />
    </QueryClientProvider>,
  );
}

describe('AdminsPage (phone)', () => {
  it('shows the large title and the admins as list rows, no table', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Admins' })).toBeInTheDocument();
    expect(await screen.findByText('outra@mesaas.com.br')).toBeInTheDocument();
    expect(screen.getByText('eu@mesaas.com.br')).toBeInTheDocument();
    expect(screen.getByText(/^Por dono@mesaas\.com\.br · \d{2}\/\d{2}\/2026$/)).toBeInTheDocument();
    expect(screen.getByText('Você')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('Deslize um admin para a esquerda para remover.')).toBeInTheDocument();
  });

  it('only other admins have the Remover swipe action, and it calls the API', async () => {
    renderPage();
    await screen.findByText('outra@mesaas.com.br');
    const remove = screen.getAllByRole('button', { name: /^Remover/ });
    expect(remove).toHaveLength(1);
    expect(remove[0]).toHaveAccessibleName('Remover outra@mesaas.com.br');
    fireEvent.click(remove[0]);
    await waitFor(() => expect(removeAdmin).toHaveBeenCalledWith('a2'));
  });

  it('inviting submits the typed e-mail', async () => {
    renderPage();
    await screen.findByText('outra@mesaas.com.br');
    fireEvent.change(screen.getByLabelText('E-mail do novo admin'), {
      target: { value: 'nova@mesaas.com.br' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Convidar' }));
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
    const retry = await screen.findByRole('button', { name: 'Tentar novamente' });
    expect(within(retry.parentElement as HTMLElement).getByRole('button')).toBe(retry);
  });
});

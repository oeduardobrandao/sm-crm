import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { mockPhone } from '../../__tests__/phone';

vi.mock('../../lib/api', () => ({
  listAdminMcpGrants: vi.fn(),
  revokeAdminMcpGrant: vi.fn(),
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { listAdminMcpGrants, revokeAdminMcpGrant } from '../../lib/api';
import IntegrationsPage from '../IntegrationsPage';

const activeGrant = {
  id: 'g1',
  user_id: 'u1',
  email: 'admin1@mesaas.com.br',
  client_id: 'client-abcdefghijklmnop',
  scopes: ['kb:read', 'banners:write'],
  created_at: '2026-09-01T00:00:00.000Z',
  revoked_at: null,
};

const revokedGrant = {
  id: 'g2',
  user_id: 'u2',
  email: 'admin2@mesaas.com.br',
  client_id: 'client-zyxwvutsrqponml',
  scopes: ['platform:read'],
  created_at: '2026-08-01T00:00:00.000Z',
  revoked_at: '2026-08-15T00:00:00.000Z',
};

let restorePhone: () => void;

beforeEach(() => {
  restorePhone = mockPhone();
  vi.stubEnv('VITE_SUPABASE_URL', 'https://mesaas.supabase.co');
  vi.mocked(listAdminMcpGrants).mockResolvedValue({ grants: [activeGrant, revokedGrant] } as never);
  vi.mocked(revokeAdminMcpGrant).mockResolvedValue({ ok: true } as never);
});

afterEach(() => {
  restorePhone();
  vi.restoreAllMocks();
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <IntegrationsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('IntegrationsPage (phone)', () => {
  it('shows the large title, the connector URL and the permission chips', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Integrações' })).toBeInTheDocument();
    expect(screen.getByDisplayValue(/\/functions\/v1\/mcp-admin$/)).toBeInTheDocument();
    expect(screen.getByText('banners:read')).toBeInTheDocument();
    expect(screen.getByText('Banners (leitura)')).toBeVisible();
    await screen.findByText('admin1@mesaas.com.br');
    expect(
      screen.getByText('Deslize uma conexão ativa para a esquerda para revogar.'),
    ).toBeVisible();
  });

  it('lists connections as rows, no table, and only the active one has Revogar', async () => {
    renderPage();
    expect(await screen.findByText('admin1@mesaas.com.br')).toBeInTheDocument();
    expect(screen.getByText('admin2@mesaas.com.br')).toBeInTheDocument();
    expect(screen.getByText('Ativa')).toBeInTheDocument();
    expect(screen.getByText('Revogada')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Revogar/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: /^Revogar/ })).toHaveAccessibleName(
      'Revogar admin1@mesaas.com.br',
    );
  });

  it('Revogar confirms and calls the API with the grant id', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    await screen.findByText('admin1@mesaas.com.br');
    fireEvent.click(screen.getByRole('button', { name: /^Revogar/ }));
    expect(confirm).toHaveBeenCalled();
    await waitFor(() => expect(revokeAdminMcpGrant).toHaveBeenCalledWith('g1'));
  });

  it('Copiar writes the connector URL to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderPage();
    await screen.findByText('admin1@mesaas.com.br');
    fireEvent.click(screen.getByRole('button', { name: 'Copiar URL' }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\/functions\/v1\/mcp-admin$/)),
    );
  });

  it('Como conectar switches between the three clients', async () => {
    renderPage();
    await screen.findByText('admin1@mesaas.com.br');
    fireEvent.click(screen.getByRole('tab', { name: 'Claude Code' }));
    expect(screen.getByText(/claude mcp add --transport http mesaas-admin/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Codex' }));
    expect(screen.getByText(/mcp_servers\.mesaas_admin/)).toBeInTheDocument();
  });
});

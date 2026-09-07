import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://mesaas.supabase.co');
  vi.mocked(listAdminMcpGrants).mockResolvedValue({ grants: [activeGrant, revokedGrant] } as never);
  vi.mocked(revokeAdminMcpGrant).mockResolvedValue({ ok: true } as never);
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

describe('IntegrationsPage', () => {
  it('mostra a URL do conector MCP do Admin', async () => {
    renderPage();
    await screen.findByRole('table');
    const input = screen.getByDisplayValue(/\/functions\/v1\/mcp-admin$/) as HTMLInputElement;
    expect(input.value).toContain('/functions/v1/mcp-admin');
  });

  it('lista uma conexão ativa e uma revogada', async () => {
    renderPage();
    const table = within(await screen.findByRole('table'));
    expect(table.getByText('admin1@mesaas.com.br')).toBeInTheDocument();
    expect(table.getByText('admin2@mesaas.com.br')).toBeInTheDocument();
    expect(table.getByText('Ativa')).toBeInTheDocument();
    expect(table.getByText('Revogada')).toBeInTheDocument();
  });

  it('mostra estado vazio quando não há conexões', async () => {
    vi.mocked(listAdminMcpGrants).mockResolvedValue({ grants: [] } as never);
    renderPage();
    expect(await screen.findByText('Nenhuma conexão autorizada')).toBeInTheDocument();
  });

  it('clicar em Revogar na conexão ativa confirma e chama a API com o id', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    const table = within(await screen.findByRole('table'));
    const revokeButtons = table.getAllByRole('button', { name: /Revogar/ });
    expect(revokeButtons).toHaveLength(1); // só a conexão ativa tem o botão
    fireEvent.click(revokeButtons[0]);
    await waitFor(() => expect(revokeAdminMcpGrant).toHaveBeenCalledWith('g1'));
  });

  it('cancelar a confirmação não chama a API', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();
    const table = within(await screen.findByRole('table'));
    fireEvent.click(table.getByRole('button', { name: /Revogar/ }));
    expect(revokeAdminMcpGrant).not.toHaveBeenCalled();
  });

  it('a conexão revogada não tem botão Revogar', async () => {
    renderPage();
    const table = within(await screen.findByRole('table'));
    const revokeButtons = table.getAllByRole('button', { name: /Revogar/ });
    expect(revokeButtons).toHaveLength(1);
  });

  it('mostra erro com botão de tentar novamente quando a busca falha', async () => {
    vi.mocked(listAdminMcpGrants).mockRejectedValueOnce(new Error('network down'));
    renderPage();
    expect(await screen.findByText('Não foi possível carregar as conexões.')).toBeInTheDocument();
    expect(screen.queryByText('Nenhuma conexão autorizada')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
  });
});

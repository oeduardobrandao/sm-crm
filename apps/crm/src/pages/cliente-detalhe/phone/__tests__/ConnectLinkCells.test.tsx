import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { getConnectLink, createConnectLink, revokeConnectLink } = vi.hoisted(() => ({
  getConnectLink: vi.fn(),
  createConnectLink: vi.fn(),
  revokeConnectLink: vi.fn(),
}));
vi.mock('@/services/connectLink', () => ({
  getConnectLink,
  createConnectLink,
  revokeConnectLink,
  emailConnectLink: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ConnectLinkCells } from '../ConnectLinkCells';

const LINK = {
  url: 'https://mesaas.com.br/conectar/tok',
  expires_at: '2026-11-10T00:00:00Z',
};

function renderCells() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ConnectLinkCells clienteId={42} clienteEmail="a@b.c" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ConnectLinkCells', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('offers to generate a link when there is none', async () => {
    getConnectLink.mockResolvedValue(null);
    createConnectLink.mockResolvedValue(LINK);
    renderCells();
    fireEvent.click(await screen.findByRole('button', { name: /Gerar link para o cliente/ }));
    await waitFor(() => expect(createConnectLink).toHaveBeenCalledWith(42));
  });

  it('revokes only after the confirm sheet, never through window.confirm', async () => {
    getConnectLink.mockResolvedValue(LINK);
    revokeConnectLink.mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, 'confirm');
    renderCells();

    expect(await screen.findByText(/Link de conexão ativo até/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Revogar' }));
    expect(revokeConnectLink).not.toHaveBeenCalled();

    const sheet = await screen.findByRole('dialog');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Revogar' }));
    await waitFor(() => expect(revokeConnectLink).toHaveBeenCalledWith(42));
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/api', () => ({ setWorkspaceAffiliate: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { setWorkspaceAffiliate } from '../../lib/api';
import { AffiliateRow } from '../workspace-detail/AffiliateRow';

const mocked = vi.mocked(setWorkspaceAffiliate);
const AFF = { id: 'a1', name: 'Bia Parceira', code: 'bia2026' };

function renderRow(affiliate: typeof AFF | null) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AffiliateRow workspaceId="ws1" affiliate={affiliate} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AffiliateRow', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the current affiliate with a link to its page', () => {
    renderRow(AFF);
    expect(screen.getByRole('link', { name: /Bia Parceira/ })).toHaveAttribute(
      'href',
      '/admin/afiliados/a1',
    );
    expect(screen.getByText('bia2026')).toBeInTheDocument();
  });

  it('shows "Sem afiliado" when none', () => {
    renderRow(null);
    expect(screen.getByText('Sem afiliado')).toBeInTheDocument();
  });

  it('saves a new code', async () => {
    mocked.mockResolvedValue({ affiliate: { id: 'a2', name: 'Caio', code: 'caio1234' } });
    renderRow(AFF);
    fireEvent.click(screen.getByRole('button', { name: 'Editar afiliado' }));
    fireEvent.change(screen.getByLabelText('Código de afiliado'), {
      target: { value: ' caio1234 ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(mocked).toHaveBeenCalledWith('ws1', 'caio1234'));
  });

  it('clears the affiliate with a null code', async () => {
    mocked.mockResolvedValue({ affiliate: null });
    renderRow(AFF);
    fireEvent.click(screen.getByRole('button', { name: 'Editar afiliado' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remover afiliado' }));
    await waitFor(() => expect(mocked).toHaveBeenCalledWith('ws1', null));
  });

  it('shows the server error inline', async () => {
    mocked.mockRejectedValue(new Error('Código de afiliado não encontrado ou inativo.'));
    renderRow(null);
    fireEvent.click(screen.getByRole('button', { name: 'Editar afiliado' }));
    fireEvent.change(screen.getByLabelText('Código de afiliado'), { target: { value: 'zzzz' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Código de afiliado não encontrado ou inativo.',
    );
  });
});

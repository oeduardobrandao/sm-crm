import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { v2 } = vi.hoisted(() => ({ v2: { ativo: true } }));
vi.mock('@/hooks/useFinanceiroV2', () => ({
  useFinanceiroV2: () => ({ ativo: v2.ativo, isLoading: false }),
}));
vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({ features: {}, isLoading: false }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../store')>()),
  updateCliente: vi.fn(),
}));
vi.mock('../../../context/AuthContext', () => ({ useAuth: vi.fn() }));

import { updateCliente, type Cliente } from '../../../store';
import { useAuth } from '../../../context/AuthContext';
import { ClienteEditDialog } from '../ClienteEditDialog';

const mockedUpdateCliente = vi.mocked(updateCliente);
const mockedUseAuth = vi.mocked(useAuth);

const CLIENTE: Cliente = {
  id: 42,
  nome: 'Aurora Estética',
  sigla: 'AE',
  cor: '#ffbf30',
  plano: 'Plano Ouro',
  email: 'contato@aurora.com.br',
  telefone: '(85) 99999-0000',
  status: 'ativo',
  valor_mensal: 1500,
  data_pagamento: 12,
};

function renderDialog(onOpenChange = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ClienteEditDialog cliente={CLIENTE} open onOpenChange={onOpenChange} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  v2.ativo = true;
  mockedUseAuth.mockReturnValue({ canSeeFinancials: true } as never);
  mockedUpdateCliente.mockResolvedValue(undefined);
});

describe('ClienteEditDialog with Financeiro v2', () => {
  it('edit_dialog_hides_valor_when_v2', () => {
    renderDialog();

    expect(screen.queryByText('Valor Mensal')).not.toBeInTheDocument();
    expect(screen.queryByText('Dia de Pagamento')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('1500')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('12')).not.toBeInTheDocument();
    const link = screen.getByRole('link', {
      name: 'A mensalidade e o status agora ficam na aba Financeiro.',
    });
    expect(link).toHaveAttribute('href', '/clientes/42/financeiro');
  });

  it('omits valor_mensal and data_pagamento from the write payload', async () => {
    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(mockedUpdateCliente).toHaveBeenCalledTimes(1));
    const payload = mockedUpdateCliente.mock.calls[0][1];
    expect(payload).not.toHaveProperty('valor_mensal');
    expect(payload).not.toHaveProperty('data_pagamento');
    expect(payload).toMatchObject({ nome: 'Aurora Estética', plano: 'Plano Ouro' });
  });

  it('hides status and omits it from the write payload (it is versioned in the Financeiro tab)', async () => {
    renderDialog();

    expect(screen.queryByText('Status')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(mockedUpdateCliente).toHaveBeenCalledTimes(1));
    expect(mockedUpdateCliente.mock.calls[0][1]).not.toHaveProperty('status');
  });

  it('closes the dialog when the link is followed', () => {
    const onOpenChange = vi.fn();
    renderDialog(onOpenChange);

    fireEvent.click(screen.getByRole('link', { name: /A mensalidade e o status agora ficam/ }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps today's fields and payload with the flag off", async () => {
    v2.ativo = false;
    renderDialog();

    expect(screen.getByText('Valor Mensal')).toBeInTheDocument();
    expect(screen.getByDisplayValue('1500')).toBeInTheDocument();
    expect(screen.getByDisplayValue('12')).toBeInTheDocument();
    expect(screen.queryByText(/A mensalidade e o status agora ficam/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(mockedUpdateCliente).toHaveBeenCalledTimes(1));
    expect(mockedUpdateCliente.mock.calls[0][1]).toMatchObject({
      valor_mensal: 1500,
      data_pagamento: 12,
      status: 'ativo',
    });
    expect(screen.getByText('Status')).toBeInTheDocument();
  });

  it("keeps today's fields when the flag is on but financials are hidden", () => {
    mockedUseAuth.mockReturnValue({ canSeeFinancials: false } as never);
    renderDialog();

    expect(screen.queryByText(/A mensalidade e o status agora ficam/)).not.toBeInTheDocument();
    expect(screen.getByText('Dia de Pagamento')).toBeInTheDocument();
  });
});

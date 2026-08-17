import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState, type ReactElement } from 'react';

vi.mock('../../../store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../store')>()),
  updateCliente: vi.fn(),
}));

vi.mock('../../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

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
};

function setAuth(canSeeFinancials: boolean | 'unknown' = true) {
  mockedUseAuth.mockReturnValue({ canSeeFinancials } as never);
}

function renderDialog(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const utils = render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
  return { ...utils, invalidateSpy };
}

/**
 * Wires `open` to real React state instead of a hardcoded literal, so
 * "click a trigger to open it" reproduces the actual bug scenario: `open`
 * flipping true is what fires the effect, not a value handed in already-open.
 */
function StatefulTrigger({ cliente }: { cliente: Cliente }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Abrir edição</button>
      <ClienteEditDialog cliente={cliente} open={open} onOpenChange={setOpen} />
    </>
  );
}

describe('ClienteEditDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAuth(true);
  });

  it('seeds the form from the cliente prop when opened', () => {
    renderDialog(<ClienteEditDialog cliente={CLIENTE} open onOpenChange={vi.fn()} />);
    expect(screen.getByDisplayValue('Aurora Estética')).toBeInTheDocument();
    expect(screen.getByDisplayValue('contato@aurora.com.br')).toBeInTheDocument();
    expect(screen.getByDisplayValue('1500')).toBeInTheDocument();
  });

  it('shows the monthly value field only when canSeeFinancials is true', () => {
    setAuth(false);
    renderDialog(<ClienteEditDialog cliente={CLIENTE} open onOpenChange={vi.fn()} />);
    expect(screen.queryByText('Valor Mensal')).not.toBeInTheDocument();
  });

  it('rejects a blank name without calling updateCliente', async () => {
    renderDialog(
      <ClienteEditDialog cliente={{ ...CLIENTE, nome: '' }} open onOpenChange={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(mockedUpdateCliente).not.toHaveBeenCalled());
  });

  it('saves, invalidates both query keys, closes, and toasts on success', async () => {
    mockedUpdateCliente.mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    const { invalidateSpy } = renderDialog(
      <ClienteEditDialog cliente={CLIENTE} open onOpenChange={onOpenChange} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(mockedUpdateCliente).toHaveBeenCalledTimes(1));
    expect(mockedUpdateCliente).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ nome: 'Aurora Estética' }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['cliente', 42] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clientes'] });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('keeps the dialog open and shows an error toast when the save fails', async () => {
    mockedUpdateCliente.mockRejectedValue(new Error('boom'));
    const onOpenChange = vi.fn();
    renderDialog(<ClienteEditDialog cliente={CLIENTE} open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(mockedUpdateCliente).toHaveBeenCalledTimes(1));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('strips valor_mensal from the write payload when access is not true', async () => {
    setAuth(false);
    mockedUpdateCliente.mockResolvedValue(undefined);
    renderDialog(<ClienteEditDialog cliente={CLIENTE} open onOpenChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(mockedUpdateCliente).toHaveBeenCalledTimes(1));
    const [, payload] = mockedUpdateCliente.mock.calls[0];
    expect(payload).not.toHaveProperty('valor_mensal');
  });

  it('closes the dialog when financial access is revoked while it is open', () => {
    const onOpenChange = vi.fn();
    const { rerender } = renderDialog(
      <ClienteEditDialog cliente={CLIENTE} open onOpenChange={onOpenChange} />,
    );
    expect(onOpenChange).not.toHaveBeenCalled();

    setAuth(false);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={queryClient}>
        <ClienteEditDialog cliente={CLIENTE} open onOpenChange={onOpenChange} />
      </QueryClientProvider>,
    );

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('stays open when an agent opens it via a real "Editar" trigger (regression: open must not itself trigger the revoke-close effect)', () => {
    setAuth(false); // agent: canSeeFinancials is false from the very start, never a transition
    renderDialog(<StatefulTrigger cliente={CLIENTE} />);

    fireEvent.click(screen.getByRole('button', { name: 'Abrir edição' }));

    // The dialog rendered and stayed open — it did not flash-close itself
    // the instant `open` flipped to true.
    expect(screen.getByDisplayValue(CLIENTE.nome)).toBeInTheDocument();
  });

  it('stays open when an owner opens it while canSeeFinancials is still "unknown" (hydration window)', () => {
    setAuth('unknown');
    renderDialog(<StatefulTrigger cliente={CLIENTE} />);

    fireEvent.click(screen.getByRole('button', { name: 'Abrir edição' }));

    expect(screen.getByDisplayValue(CLIENTE.nome)).toBeInTheDocument();
  });

  it('does not close on financial revocation when the dialog is not open', () => {
    const onOpenChange = vi.fn();
    const { rerender } = renderDialog(
      <ClienteEditDialog cliente={CLIENTE} open={false} onOpenChange={onOpenChange} />,
    );

    setAuth(false);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={queryClient}>
        <ClienteEditDialog cliente={CLIENTE} open={false} onOpenChange={onOpenChange} />
      </QueryClientProvider>,
    );

    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

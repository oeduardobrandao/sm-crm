import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { addTarefaMock, toastErrorMock } = vi.hoisted(() => ({
  addTarefaMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('../../../store', () => ({
  addTarefa: addTarefaMock,
  updateTarefa: vi.fn(),
  setTarefaTags: vi.fn(),
  addTarefaTag: vi.fn(),
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: toastErrorMock },
}));

import { TarefaFormDialog } from '../components/TarefaFormDialog';

const CLIENTES = [
  { id: 7, nome: 'Cliente Sete', status: 'ativo' },
  { id: 9, nome: 'Cliente Pausado', status: 'pausado' },
] as never[];

describe('TarefaFormDialog convert mode', () => {
  it('prefills initialValues, locks cliente, and submits through onCreate instead of addTarefa', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(
      <TarefaFormDialog
        open
        onClose={() => {}}
        editing={null}
        membros={[]}
        clientes={CLIENTES}
        tags={[]}
        onSaved={() => {}}
        onTagCreated={() => {}}
        initialValues={{
          titulo: 'Trocar arte do feed',
          descricao: 'Pedido do cliente',
          cliente_id: 9,
        }}
        lockCliente
        onCreate={onCreate}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Converter em tarefa' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Trocar arte do feed')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Pedido do cliente')).toBeInTheDocument();
    // Cliente pausado ainda aparece (esta travado no da solicitacao). Radix Select
    // mirrors each item into a visually-hidden native <option> in addition to the
    // portaled trigger label, so more than one match is expected here.
    expect(screen.getAllByText('Cliente Pausado').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /criar tarefa/i }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0][0]).toMatchObject({
      titulo: 'Trocar arte do feed',
      cliente_id: 9,
    });
    expect(addTarefaMock).not.toHaveBeenCalled();
  });
});

describe('TarefaFormDialog error handling', () => {
  it('shows the generic pt-BR fallback (not the raw PostgREST message) in plain create mode', async () => {
    addTarefaMock.mockRejectedValueOnce(
      new Error('duplicate key value violates unique constraint "tarefas_pkey"'),
    );
    render(
      <TarefaFormDialog
        open
        onClose={() => {}}
        editing={null}
        membros={[]}
        clientes={CLIENTES}
        tags={[]}
        onSaved={() => {}}
        onTagCreated={() => {}}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('O que precisa ser feito?'), {
      target: { value: 'Nova tarefa' },
    });
    fireEvent.click(screen.getByRole('button', { name: /criar tarefa/i }));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledTimes(1));
    expect(toastErrorMock).toHaveBeenCalledWith('Erro ao criar tarefa');
  });
});

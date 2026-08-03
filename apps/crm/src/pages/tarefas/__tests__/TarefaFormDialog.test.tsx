import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  addTarefaMock,
  toastErrorMock,
  getMembrosMock,
  getClientesMock,
  getTarefasMock,
  searchPostsForMentionMock,
} = vi.hoisted(() => ({
  addTarefaMock: vi.fn(),
  toastErrorMock: vi.fn(),
  // MentionTextarea (the descricao field, since Task 5 of the at-mentions feature)
  // pulls these in via useMentionSearch -- this file's '../../../store' mock fully
  // replaces the module (no importOriginal), so they need an explicit stand-in or
  // useQuery blows up on an undefined queryFn. Named vi.hoisted refs (not inline
  // vi.fn() literals in the mock factory below) so beforeEach can re-arm their
  // resolved value every test -- the repo's global afterEach runs
  // vi.restoreAllMocks(), which strips a bare vi.fn()'s mockResolvedValue back to
  // "returns undefined" between tests.
  getMembrosMock: vi.fn(),
  getClientesMock: vi.fn(),
  getTarefasMock: vi.fn(),
  searchPostsForMentionMock: vi.fn(),
}));

vi.mock('../../../store', () => ({
  addTarefa: addTarefaMock,
  updateTarefa: vi.fn(),
  setTarefaTags: vi.fn(),
  addTarefaTag: vi.fn(),
  getMembros: getMembrosMock,
  getClientes: getClientesMock,
  getTarefas: getTarefasMock,
}));
vi.mock('@/store/posts', () => ({
  searchPostsForMention: searchPostsForMentionMock,
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: toastErrorMock },
}));

import { TarefaFormDialog } from '../components/TarefaFormDialog';

beforeEach(() => {
  getMembrosMock.mockResolvedValue([]);
  getClientesMock.mockResolvedValue([]);
  getTarefasMock.mockResolvedValue([]);
  searchPostsForMentionMock.mockResolvedValue([]);
});

// MentionTextarea's useMentionSearch calls useQuery, which needs a QueryClient
// ancestor -- TarefaFormDialog didn't depend on react-query before wiring in
// @-mentions (Task 5).
function renderDialog(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const CLIENTES = [
  { id: 7, nome: 'Cliente Sete', status: 'ativo' },
  { id: 9, nome: 'Cliente Pausado', status: 'pausado' },
] as never[];

describe('TarefaFormDialog convert mode', () => {
  it('prefills initialValues, locks cliente, and submits through onCreate instead of addTarefa', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    renderDialog(
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
    renderDialog(
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

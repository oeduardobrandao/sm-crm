import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest';
import type { Cliente } from '@/store';

// Radix Select requires pointer-capture/scrollIntoView APIs jsdom doesn't implement --
// same stubs used by MigrateTemplateDialog.test.tsx / EquipePage.test.tsx.
beforeAll(() => {
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () =>
    false;
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
});

const { createAvulsoPostMock, toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
  createAvulsoPostMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('@/store', () => ({ createAvulsoPost: createAvulsoPostMock }));
vi.mock('sonner', () => ({ toast: { success: toastSuccessMock, error: toastErrorMock } }));

import { NewAvulsoDialog } from '../NewAvulsoDialog';

const CLIENTES: Cliente[] = [
  { id: 7, nome: 'Clínica Aurora', status: 'ativo' } as Cliente,
  { id: 8, nome: 'Cliente Encerrado', status: 'encerrado' } as Cliente,
];

function renderDialog(overrides: Partial<React.ComponentProps<typeof NewAvulsoDialog>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
  const onClose = vi.fn();
  const onCreated = vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}>
      <NewAvulsoDialog
        open
        onClose={onClose}
        clientes={CLIENTES}
        onCreated={onCreated}
        {...overrides}
      />
    </QueryClientProvider>,
  );
  return { ...utils, onClose, onCreated, invalidateSpy };
}

async function selectCliente(nome: string) {
  fireEvent.click(screen.getByRole('combobox', { name: 'Cliente' }));
  fireEvent.click(await screen.findByRole('option', { name: nome }));
}

beforeEach(() => {
  createAvulsoPostMock.mockReset();
  toastSuccessMock.mockReset();
  toastErrorMock.mockReset();
});

describe('NewAvulsoDialog', () => {
  it('only offers active clientes', async () => {
    renderDialog();
    fireEvent.click(screen.getByRole('combobox', { name: 'Cliente' }));
    expect(await screen.findByRole('option', { name: 'Clínica Aurora' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Cliente Encerrado' })).not.toBeInTheDocument();
  });

  it('does not submit without a cliente selected', async () => {
    renderDialog();
    fireEvent.change(screen.getByPlaceholderText('Título do post'), {
      target: { value: 'Post sem cliente' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Criar post' }));

    await waitFor(() => expect(screen.getByText('Selecione um cliente')).toBeInTheDocument());
    expect(createAvulsoPostMock).not.toHaveBeenCalled();
  });

  it('creates the post, toasts, invalidates active-posts, and hands the post to onCreated', async () => {
    const created = { id: 55, cliente_id: 7, titulo: 'Story do dia', tipo: 'stories' };
    createAvulsoPostMock.mockResolvedValue(created);
    const { onClose, onCreated, invalidateSpy } = renderDialog();

    await selectCliente('Clínica Aurora');
    fireEvent.change(screen.getByPlaceholderText('Título do post'), {
      target: { value: 'Story do dia' },
    });
    fireEvent.click(screen.getByRole('combobox', { name: 'Tipo' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Stories' }));
    fireEvent.click(screen.getByRole('button', { name: 'Criar post' }));

    await waitFor(() => expect(createAvulsoPostMock).toHaveBeenCalledTimes(1));
    expect(createAvulsoPostMock).toHaveBeenCalledWith({
      cliente_id: 7,
      titulo: 'Story do dia',
      tipo: 'stories',
    });
    expect(toastSuccessMock).toHaveBeenCalledWith('Post avulso criado');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['active-posts'] });
    expect(onCreated).toHaveBeenCalledWith(created);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('defaults tipo to feed when left untouched', async () => {
    createAvulsoPostMock.mockResolvedValue({ id: 1, cliente_id: 7, titulo: 'X', tipo: 'feed' });
    renderDialog();
    await selectCliente('Clínica Aurora');
    fireEvent.change(screen.getByPlaceholderText('Título do post'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar post' }));

    await waitFor(() =>
      expect(createAvulsoPostMock).toHaveBeenCalledWith({
        cliente_id: 7,
        titulo: 'X',
        tipo: 'feed',
      }),
    );
  });

  it('shows a generic error toast and does not close on failure', async () => {
    createAvulsoPostMock.mockRejectedValue(new Error('duplicate key value violates constraint'));
    const { onClose, onCreated } = renderDialog();

    await selectCliente('Clínica Aurora');
    fireEvent.change(screen.getByPlaceholderText('Título do post'), {
      target: { value: 'Vai falhar' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Criar post' }));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('Erro ao criar post avulso'));
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('cancels without creating anything', () => {
    const { onClose } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(createAvulsoPostMock).not.toHaveBeenCalled();
  });
});

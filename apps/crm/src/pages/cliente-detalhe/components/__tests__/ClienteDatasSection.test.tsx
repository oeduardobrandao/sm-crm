import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store')>()),
  getClienteDatas: vi.fn(),
  addClienteData: vi.fn(),
  updateClienteData: vi.fn(),
  removeClienteData: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  getClienteDatas,
  addClienteData,
  updateClienteData,
  removeClienteData,
  type ClienteData,
} from '@/store';
import { toast } from 'sonner';
import { ClienteDatasSection } from '../ClienteDatasSection';

const mockedGet = vi.mocked(getClienteDatas);
const mockedAdd = vi.mocked(addClienteData);
const mockedUpdate = vi.mocked(updateClienteData);
const mockedRemove = vi.mocked(removeClienteData);
const mockedToast = vi.mocked(toast);

const CLIENTE_ID = 42;

function clienteData(overrides: Partial<ClienteData> = {}): ClienteData {
  return {
    id: 1,
    cliente_id: CLIENTE_ID,
    titulo: 'Inauguração',
    data: '2026-03-15',
    ...overrides,
  };
}

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ClienteDatasSection clienteId={CLIENTE_ID} />
    </QueryClientProvider>,
  );
  return { ...utils, invalidateSpy, queryClient };
}

async function openAddModal() {
  fireEvent.click(await screen.findByRole('button', { name: 'Adicionar' }));
  return screen.findByRole('dialog', { name: 'Nova Data Importante' });
}

describe('ClienteDatasSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGet.mockResolvedValue([]);
  });

  it('shows the empty state when there are no important dates', async () => {
    renderSection();
    expect(await screen.findByText('Nenhuma data importante cadastrada')).toBeInTheDocument();
    expect(
      screen.getByText('Clique em "Adicionar" para registrar datas relevantes.'),
    ).toBeInTheDocument();
  });

  it('renders the dates list when data is present', async () => {
    mockedGet.mockResolvedValue([clienteData()]);
    renderSection();
    expect(await screen.findByText('Inauguração')).toBeInTheDocument();
  });

  it('rejects submission missing title or date', async () => {
    renderSection();
    const dialog = await openAddModal();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Adicionar' }));

    await waitFor(() => expect(mockedToast.error).toHaveBeenCalledWith('Preencha título e data.'));
    expect(mockedAdd).not.toHaveBeenCalled();
  });

  it('adds a new important date, invalidates the query, toasts, and closes the dialog', async () => {
    mockedAdd.mockResolvedValue(clienteData({ id: 2 }));
    const { invalidateSpy } = renderSection();

    const dialog = await openAddModal();
    fireEvent.change(within(dialog).getByPlaceholderText('Ex: Dia de inauguração'), {
      target: { value: 'Aniversário da loja' },
    });
    const dateInput = dialog.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2026-05-20' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Adicionar' }));

    await waitFor(() => expect(mockedAdd).toHaveBeenCalledTimes(1));
    expect(mockedAdd).toHaveBeenCalledWith({
      cliente_id: CLIENTE_ID,
      titulo: 'Aniversário da loja',
      data: '2026-05-20',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clienteDatas', CLIENTE_ID] });
    expect(mockedToast.success).toHaveBeenCalledWith('Data adicionada!');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('edits an existing important date and invalidates the query', async () => {
    const existing = clienteData();
    mockedGet.mockResolvedValue([existing]);
    mockedUpdate.mockResolvedValue({ ...existing, titulo: 'Reinauguração' });
    const { invalidateSpy } = renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Editar Data: Inauguração' }));
    const titleInput = await screen.findByDisplayValue('Inauguração');
    fireEvent.change(titleInput, { target: { value: 'Reinauguração' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(1));
    expect(mockedUpdate).toHaveBeenCalledWith(1, {
      titulo: 'Reinauguração',
      data: '2026-03-15',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clienteDatas', CLIENTE_ID] });
    expect(mockedToast.success).toHaveBeenCalledWith('Data atualizada!');
  });

  it('shows a generic error toast and keeps the dialog open when the write fails', async () => {
    mockedAdd.mockRejectedValue(new Error('falhou'));
    renderSection();

    const dialog = await openAddModal();
    fireEvent.change(within(dialog).getByPlaceholderText('Ex: Dia de inauguração'), {
      target: { value: 'Aniversário da loja' },
    });
    const dateInput = dialog.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2026-05-20' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Adicionar' }));

    await waitFor(() => expect(mockedToast.error).toHaveBeenCalledWith('Erro: falhou'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('deletes an important date only after the confirm dialog is accepted', async () => {
    mockedGet.mockResolvedValue([clienteData()]);
    mockedRemove.mockResolvedValue(undefined);
    const { invalidateSpy } = renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Remover Data: Inauguração' }));
    expect(mockedRemove).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remover' }));

    await waitFor(() => expect(mockedRemove).toHaveBeenCalledWith(1));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clienteDatas', CLIENTE_ID] });
    expect(mockedToast.success).toHaveBeenCalledWith('Data removida!');
  });

  it('shows a generic error toast when the delete fails', async () => {
    mockedGet.mockResolvedValue([clienteData()]);
    mockedRemove.mockRejectedValue(new Error('boom'));
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Remover Data: Inauguração' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remover' }));

    await waitFor(() => expect(mockedToast.error).toHaveBeenCalledWith('Erro: boom'));
  });

  it('only queries the clienteDatas key', async () => {
    mockedGet.mockResolvedValue([]);
    const { queryClient } = renderSection();
    await screen.findByText('Nenhuma data importante cadastrada');
    await waitFor(() =>
      expect(
        queryClient
          .getQueryCache()
          .getAll()
          .map((q) => q.queryKey),
      ).toEqual([['clienteDatas', CLIENTE_ID]]),
    );
  });
});

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store')>()),
  getClienteEnderecos: vi.fn(),
  addClienteEndereco: vi.fn(),
  updateClienteEndereco: vi.fn(),
  removeClienteEndereco: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  getClienteEnderecos,
  addClienteEndereco,
  updateClienteEndereco,
  removeClienteEndereco,
  type ClienteEndereco,
} from '@/store';
import { toast } from 'sonner';
import { ClienteEnderecosSection } from '../ClienteEnderecosSection';

const mockedGet = vi.mocked(getClienteEnderecos);
const mockedAdd = vi.mocked(addClienteEndereco);
const mockedUpdate = vi.mocked(updateClienteEndereco);
const mockedRemove = vi.mocked(removeClienteEndereco);
const mockedToast = vi.mocked(toast);

const CLIENTE_ID = 42;

function endereco(overrides: Partial<ClienteEndereco> = {}): ClienteEndereco {
  return {
    id: 1,
    cliente_id: CLIENTE_ID,
    tipo: 'comercial',
    logradouro: 'Rua das Flores',
    numero: '100',
    complemento: '',
    bairro: 'Centro',
    cidade: 'Fortaleza',
    estado: 'CE',
    cep: '60000-000',
    ...overrides,
  };
}

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ClienteEnderecosSection clienteId={CLIENTE_ID} />
    </QueryClientProvider>,
  );
  return { ...utils, invalidateSpy, queryClient };
}

async function openAddModal() {
  fireEvent.click(await screen.findByRole('button', { name: 'Adicionar' }));
  return screen.findByRole('dialog', { name: 'Novo Endereço' });
}

function fillRequiredFields(dialog: HTMLElement) {
  fireEvent.change(within(dialog).getByPlaceholderText('Ex: Rua das Flores'), {
    target: { value: 'Av. Central' },
  });
  fireEvent.change(within(dialog).getByPlaceholderText('123'), { target: { value: '55' } });
  fireEvent.change(within(dialog).getByPlaceholderText('Centro'), {
    target: { value: 'Aldeota' },
  });
  fireEvent.change(within(dialog).getByPlaceholderText('São Paulo'), {
    target: { value: 'Fortaleza' },
  });
  fireEvent.change(within(dialog).getByPlaceholderText('SP'), { target: { value: 'ce' } });
  fireEvent.change(within(dialog).getByPlaceholderText('00000-000'), {
    target: { value: '60110-000' },
  });
}

describe('ClienteEnderecosSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGet.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the empty state when there are no addresses', async () => {
    renderSection();
    expect(await screen.findByText('Nenhum endereço cadastrado')).toBeInTheDocument();
    expect(
      screen.getByText('Clique em "Adicionar" para cadastrar um endereço.'),
    ).toBeInTheDocument();
  });

  it('renders the address list when data is present', async () => {
    mockedGet.mockResolvedValue([endereco()]);
    renderSection();
    expect(await screen.findByText('Rua das Flores, 100')).toBeInTheDocument();
    expect(screen.getByText('Centro · Fortaleza/CE')).toBeInTheDocument();
    expect(screen.getByText('CEP: 60000-000')).toBeInTheDocument();
    expect(screen.getByText('Comercial')).toBeInTheDocument();
  });

  it('rejects submission with a required field missing', async () => {
    renderSection();
    const dialog = await openAddModal();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Adicionar' }));

    await waitFor(() =>
      expect(mockedToast.error).toHaveBeenCalledWith('Preencha todos os campos obrigatórios.'),
    );
    expect(mockedAdd).not.toHaveBeenCalled();
  });

  it('adds a new address, invalidates the query, toasts, and closes the dialog', async () => {
    mockedAdd.mockResolvedValue(endereco({ id: 2 }));
    const { invalidateSpy } = renderSection();

    const dialog = await openAddModal();
    fillRequiredFields(dialog);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Adicionar' }));

    await waitFor(() => expect(mockedAdd).toHaveBeenCalledTimes(1));
    expect(mockedAdd).toHaveBeenCalledWith({
      cliente_id: CLIENTE_ID,
      tipo: 'comercial',
      logradouro: 'Av. Central',
      numero: '55',
      complemento: '',
      bairro: 'Aldeota',
      cidade: 'Fortaleza',
      estado: 'CE',
      cep: '60110-000',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clienteEnderecos', CLIENTE_ID] });
    expect(mockedToast.success).toHaveBeenCalledWith('Endereço adicionado!');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('edits an existing address and invalidates the query', async () => {
    const existing = endereco();
    mockedGet.mockResolvedValue([existing]);
    mockedUpdate.mockResolvedValue({ ...existing, numero: '200' });
    const { invalidateSpy } = renderSection();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Editar Endereço: Rua das Flores, 100' }),
    );
    const numeroInput = await screen.findByDisplayValue('100');
    fireEvent.change(numeroInput, { target: { value: '200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledTimes(1));
    expect(mockedUpdate).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ numero: '200', logradouro: 'Rua das Flores' }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clienteEnderecos', CLIENTE_ID] });
    expect(mockedToast.success).toHaveBeenCalledWith('Endereço atualizado!');
  });

  it('shows a save-error toast and keeps the dialog open when the write fails', async () => {
    mockedAdd.mockRejectedValue(new Error('falhou'));
    renderSection();

    const dialog = await openAddModal();
    fillRequiredFields(dialog);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Adicionar' }));

    await waitFor(() =>
      expect(mockedToast.error).toHaveBeenCalledWith('Erro ao salvar endereço: falhou'),
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('deletes an address only after the confirm dialog is accepted', async () => {
    mockedGet.mockResolvedValue([endereco()]);
    mockedRemove.mockResolvedValue(undefined);
    const { invalidateSpy } = renderSection();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Remover Endereço: Rua das Flores, 100' }),
    );
    expect(mockedRemove).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remover' }));

    await waitFor(() => expect(mockedRemove).toHaveBeenCalledWith(1));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clienteEnderecos', CLIENTE_ID] });
    expect(mockedToast.success).toHaveBeenCalledWith('Endereço removido!');
  });

  it('autofills the address fields when the CEP is found', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            logradouro: 'Rua Nova',
            bairro: 'Bairro Novo',
            localidade: 'Fortaleza',
            uf: 'CE',
          }),
      }),
    );
    renderSection();
    const dialog = await openAddModal();

    fireEvent.change(within(dialog).getByPlaceholderText('00000-000'), {
      target: { value: '60110000' },
    });

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith('https://viacep.com.br/ws/60110000/json/'),
    );
    await waitFor(() => expect(within(dialog).getByDisplayValue('Rua Nova')).toBeInTheDocument());
    expect(within(dialog).getByDisplayValue('Bairro Novo')).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue('Fortaleza')).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue('CE')).toBeInTheDocument();
  });

  it('toasts CEP-not-found and leaves the other fields untouched', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ erro: true }),
      }),
    );
    renderSection();
    const dialog = await openAddModal();

    fireEvent.change(within(dialog).getByPlaceholderText('00000-000'), {
      target: { value: '00000000' },
    });

    await waitFor(() => expect(mockedToast.error).toHaveBeenCalledWith('CEP não encontrado.'));
    expect(within(dialog).getByPlaceholderText('Ex: Rua das Flores')).toHaveValue('');
  });

  it('fails silently and re-enables the field when the CEP lookup errors out', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    renderSection();
    const dialog = await openAddModal();

    fireEvent.change(within(dialog).getByPlaceholderText('00000-000'), {
      target: { value: '60110000' },
    });

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    // No toast, no crash — the user can still fill the form manually.
    await waitFor(() => expect(mockedToast.error).not.toHaveBeenCalled());
    fireEvent.change(within(dialog).getByPlaceholderText('Ex: Rua das Flores'), {
      target: { value: 'Manual' },
    });
    expect(within(dialog).getByDisplayValue('Manual')).toBeInTheDocument();
  });

  it('only queries the clienteEnderecos key', async () => {
    mockedGet.mockResolvedValue([]);
    const { queryClient } = renderSection();
    await screen.findByText('Nenhum endereço cadastrado');
    await waitFor(() =>
      expect(
        queryClient
          .getQueryCache()
          .getAll()
          .map((q) => q.queryKey),
      ).toEqual([['clienteEnderecos', CLIENTE_ID]]),
    );
  });
});

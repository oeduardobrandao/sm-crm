import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () =>
    false;
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
});

const { useAuthMock, store, toastMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
  store: {
    getFinanceiroConfig: vi.fn(),
    getFuncoes: vi.fn(),
    salvarConfig: vi.fn(),
    salvarFuncao: vi.fn(),
    excluirFuncao: vi.fn(),
  },
}));

vi.mock('@/context/AuthContext', () => ({ useAuth: useAuthMock }));
vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('@/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store')>()),
  ...store,
}));

import ConfigSheet from '../ConfigSheet';

const FUNCOES = [
  { id: 1, nome: 'Design', ordem: 1 },
  { id: 2, nome: 'Social media', ordem: 2 },
  { id: 3, nome: 'Edição', ordem: 3 },
];

function renderSheet() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <ConfigSheet open onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );
  return { invalidate, onOpenChange };
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthMock.mockReturnValue({ profile: { conta_id: 'w1' } });
  store.getFinanceiroConfig.mockResolvedValue({
    periodo_dia: 1,
    meta_margem: 55,
    seeded_at: '2026-10-01',
    updated_at: null,
  });
  store.getFuncoes.mockResolvedValue(FUNCOES.map((f) => ({ ...f })));
  store.salvarConfig.mockResolvedValue(undefined);
  store.salvarFuncao.mockResolvedValue(9);
  store.excluirFuncao.mockResolvedValue(undefined);
});

async function metaInput() {
  return screen.findByRole('spinbutton', { name: 'Meta de margem (%)' });
}

describe('ConfigSheet', () => {
  it('loads the current day and meta', async () => {
    renderSheet();

    expect(await metaInput()).toHaveValue(55);
    expect(screen.getByRole('combobox', { name: 'O período começa no dia' })).toHaveTextContent(
      '1',
    );
    expect(screen.getByText('Vale a partir do próximo período.')).toBeVisible();
  });

  it('config_sheet_saves', async () => {
    const user = userEvent.setup();
    const { invalidate } = renderSheet();

    const meta = await metaInput();
    await user.click(screen.getByRole('combobox', { name: 'O período começa no dia' }));
    await user.click(await screen.findByRole('option', { name: '15' }));
    await user.clear(meta);
    await user.type(meta, '60');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(store.salvarConfig).toHaveBeenCalledWith(15, 60));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['financeiro-v2'] }));
    expect(toastMock.success).toHaveBeenCalled();
  });

  it.each(['101', '-1', '55.5', ''])('rejects meta %j inline and does not save', async (bad) => {
    const user = userEvent.setup();
    renderSheet();

    const meta = await metaInput();
    await user.clear(meta);
    if (bad) await user.type(meta, bad);
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByText('Informe um número inteiro de 0 a 100.')).toBeVisible();
    expect(meta).toHaveAttribute('aria-invalid', 'true');
    expect(store.salvarConfig).not.toHaveBeenCalled();
  });

  it('keeps Salvar disabled until something changes', async () => {
    renderSheet();

    await metaInput();

    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();
  });

  it('lists the funções in order and renames on blur', async () => {
    const user = userEvent.setup();
    renderSheet();

    const nome = await screen.findByRole('textbox', { name: 'Nome da função Design' });
    await user.clear(nome);
    await user.type(nome, 'Design gráfico');
    await user.tab();

    await waitFor(() => expect(store.salvarFuncao).toHaveBeenCalledWith(1, 'Design gráfico', 1));
  });

  it('does not save an unchanged or empty name', async () => {
    const user = userEvent.setup();
    renderSheet();

    const nome = await screen.findByRole('textbox', { name: 'Nome da função Design' });
    await user.click(nome);
    await user.tab();
    await user.clear(nome);
    await user.tab();

    expect(store.salvarFuncao).not.toHaveBeenCalled();
    expect(nome).toHaveValue('Design');
  });

  it('moves a função down by swapping the order of the two rows', async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.click(await screen.findByRole('button', { name: 'Descer Design' }));

    await waitFor(() => expect(store.salvarFuncao).toHaveBeenCalledTimes(2));
    expect(store.salvarFuncao).toHaveBeenCalledWith(1, 'Design', 2);
    expect(store.salvarFuncao).toHaveBeenCalledWith(2, 'Social media', 1);
  });

  it('disables moving the first up and the last down', async () => {
    renderSheet();

    expect(await screen.findByRole('button', { name: 'Subir Design' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Descer Edição' })).toBeDisabled();
  });

  it('adds a função at the end', async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.type(await screen.findByRole('textbox', { name: 'Nova função' }), '  Copy ');
    await user.click(screen.getByRole('button', { name: 'Adicionar' }));

    await waitFor(() => expect(store.salvarFuncao).toHaveBeenCalledWith(null, 'Copy', 4));
  });

  it('confirms before deleting a função', async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.click(await screen.findByRole('button', { name: 'Excluir Social media' }));
    const alert = await screen.findByRole('alertdialog', { name: 'Excluir função?' });
    expect(alert).toHaveTextContent('Sem função');
    expect(store.excluirFuncao).not.toHaveBeenCalled();

    await user.click(within(alert).getByRole('button', { name: 'Excluir' }));

    await waitFor(() => expect(store.excluirFuncao).toHaveBeenCalledWith(2));
  });

  it('keeps the função when the delete is cancelled', async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.click(await screen.findByRole('button', { name: 'Excluir Social media' }));
    const alert = await screen.findByRole('alertdialog', { name: 'Excluir função?' });
    await user.click(within(alert).getByRole('button', { name: 'Cancelar' }));

    expect(store.excluirFuncao).not.toHaveBeenCalled();
  });

  it('reports a failed save', async () => {
    const user = userEvent.setup();
    store.salvarConfig.mockRejectedValue(new Error('boom'));
    renderSheet();

    const meta = await metaInput();
    await user.clear(meta);
    await user.type(meta, '60');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Erro ao salvar'));
  });
});

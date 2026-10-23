import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PeriodoFinanceiro } from '@/store/financeiroV2';

beforeAll(() => {
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () =>
    false;
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
});

const { useAuthMock, store, toastMock, entitlementMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn() },
  entitlementMock: vi.fn(),
  store: { getPeriodosEditaveis: vi.fn(), salvarCliente: vi.fn() },
}));

vi.mock('@/context/AuthContext', () => ({ useAuth: useAuthMock }));
vi.mock('sonner', () => ({ toast: toastMock }));
vi.mock('@/lib/entitlement-toast', () => ({ handleEntitlementMutationError: entitlementMock }));
vi.mock('@/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store')>()),
  ...store,
}));

import { ClienteMensalidadeDialog } from '../ClienteMensalidadeDialog';

const EDITAVEIS: PeriodoFinanceiro[] = [
  {
    inicio: '2026-09-01',
    fim: '2026-10-01',
    rotulo: 'set 2026',
    status: 'reaberto',
    transicao: false,
  },
  {
    inicio: '2026-10-01',
    fim: '2026-11-01',
    rotulo: 'out 2026',
    status: 'aberto',
    transicao: false,
  },
  {
    inicio: '2026-11-01',
    fim: '2026-12-01',
    rotulo: 'nov 2026',
    status: 'futuro',
    transicao: false,
  },
];

function renderDialog(
  inicial = { valor_mensal: 2500, dia_pagamento: 10 as number | null, status: 'ativo' as const },
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <ClienteMensalidadeDialog clienteId={9} inicial={inicial} open onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );
  return { invalidate, onOpenChange };
}

/** Real open state, like FinanceiroTab: the dialog is toggled, never remounted. */
function Harness({ inicial }: { inicial: Parameters<typeof renderDialog>[0] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Abrir</button>
      <ClienteMensalidadeDialog
        clienteId={9}
        inicial={inicial}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}

function renderHarness(
  inicial = { valor_mensal: 2500, dia_pagamento: 10 as number | null, status: 'ativo' as const },
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Harness inicial={inicial} />
    </QueryClientProvider>,
  );
}

const valorInput = () => screen.findByRole('spinbutton', { name: 'Valor mensal' });

beforeEach(() => {
  vi.clearAllMocks();
  useAuthMock.mockReturnValue({ profile: { conta_id: 'w1' } });
  store.getPeriodosEditaveis.mockResolvedValue(EDITAVEIS.map((p) => ({ ...p })));
  store.salvarCliente.mockResolvedValue(undefined);
  entitlementMock.mockReturnValue(false);
});

describe('ClienteMensalidadeDialog', () => {
  it('starts from the current values and the open period', async () => {
    renderDialog();

    expect(await valorInput()).toHaveValue(2500);
    expect(screen.getByRole('spinbutton', { name: 'Dia de pagamento' })).toHaveValue(10);
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveTextContent('Ativo');
    expect(screen.getByRole('combobox', { name: 'Vale a partir de' })).toHaveTextContent(
      'out 2026',
    );
    expect(
      screen.queryByText('As atribuições da equipe terminam neste período.'),
    ).not.toBeInTheDocument();
  });

  it('mensalidade_dialog_encerrado_warning', async () => {
    const user = userEvent.setup();
    renderDialog();
    await valorInput();

    await user.click(screen.getByRole('combobox', { name: 'Status' }));
    await user.click(await screen.findByRole('option', { name: 'Encerrado' }));

    expect(screen.getByText('As atribuições da equipe terminam neste período.')).toBeVisible();

    await user.click(screen.getByRole('combobox', { name: 'Status' }));
    await user.click(await screen.findByRole('option', { name: 'Pausado' }));
    expect(
      screen.queryByText('As atribuições da equipe terminam neste período.'),
    ).not.toBeInTheDocument();
  });

  it('mensalidade_submit_payload', async () => {
    const user = userEvent.setup();
    const { invalidate, onOpenChange } = renderDialog();

    const valor = await valorInput();
    await user.clear(valor);
    await user.type(valor, '3000');
    const dia = screen.getByRole('spinbutton', { name: 'Dia de pagamento' });
    await user.clear(dia);
    await user.type(dia, '15');
    await user.click(screen.getByRole('combobox', { name: 'Status' }));
    await user.click(await screen.findByRole('option', { name: 'Pausado' }));
    await user.click(screen.getByRole('combobox', { name: 'Vale a partir de' }));
    await user.click(await screen.findByRole('option', { name: /nov 2026/ }));
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(store.salvarCliente).toHaveBeenCalledTimes(1));
    expect(store.salvarCliente).toHaveBeenCalledWith(9, '2026-11-01', 3000, 15, 'pausado');
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['financeiro-v2'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['clientes'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['cliente', 9] });
    expect(toastMock.success).toHaveBeenCalled();
  });

  it('sends a null payment day when the field is empty', async () => {
    const user = userEvent.setup();
    renderDialog({ valor_mensal: 1800, dia_pagamento: null, status: 'ativo' });

    await valorInput();
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(store.salvarCliente).toHaveBeenCalledTimes(1));
    expect(store.salvarCliente).toHaveBeenCalledWith(9, '2026-10-01', 1800, null, 'ativo');
  });

  it('rejects a negative value and a payment day outside 1..31 without saving', async () => {
    const user = userEvent.setup();
    renderDialog();

    const valor = await valorInput();
    await user.clear(valor);
    await user.type(valor, '-5');
    const dia = screen.getByRole('spinbutton', { name: 'Dia de pagamento' });
    await user.clear(dia);
    await user.type(dia, '32');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByText('Informe um valor igual ou maior que zero.')).toBeVisible();
    expect(screen.getByText('Informe um dia de 1 a 31.')).toBeVisible();
    expect(store.salvarCliente).not.toHaveBeenCalled();
  });

  it('keeps the dialog open and toasts when the save fails', async () => {
    store.salvarCliente.mockRejectedValue(new Error('periodo_fechado'));
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog();

    await valorInput();
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(entitlementMock).toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('starts from the defaults again after cancelling a typed edit and reopening', async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    const valor = await valorInput();
    await user.clear(valor);
    await user.type(valor, '9999');
    // Dirty: Cancelar closes the dialog directly (its own handler, no discard prompt).
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    expect(await valorInput()).toHaveValue(2500);
    expect(store.salvarCliente).not.toHaveBeenCalled();
  });

  it('closes without a discard prompt on a reopen after a successful save', async () => {
    const user = userEvent.setup();
    renderHarness();

    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    const valor = await valorInput();
    await user.clear(valor);
    await user.type(valor, '3000');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(store.salvarCliente).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // Reopen and close with Escape without touching anything: no "descartar" confirm.
    await user.click(screen.getByRole('button', { name: 'Abrir' }));
    await valorInput();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

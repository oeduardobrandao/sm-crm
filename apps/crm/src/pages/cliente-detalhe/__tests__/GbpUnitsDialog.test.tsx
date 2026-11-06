import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { listOptionsMock, linkMock, getGoogleAuthUrlMock } = vi.hoisted(() => ({
  listOptionsMock: vi.fn(),
  linkMock: vi.fn(),
  getGoogleAuthUrlMock: vi.fn(),
}));

vi.mock('../../../services/google', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/google')>();
  return {
    ...actual,
    listGbpLocationOptions: (...a: unknown[]) => listOptionsMock(...a),
    linkGbpLocations: (...a: unknown[]) => linkMock(...a),
    getGoogleAuthUrl: (...a: unknown[]) => getGoogleAuthUrlMock(...a),
  };
});

import { GoogleServiceError } from '../../../services/google';
import { GbpUnitsDialog } from '../GbpUnitsDialog';

function option(over: Record<string, unknown>) {
  return {
    locationName: 'locations/x',
    accountName: 'accounts/1',
    title: 'Unidade',
    addressLine: 'Rua A, 1',
    website: null,
    hasVoiceOfMerchant: true,
    linkedClientId: null,
    linkedClientName: null,
    linkedConnectionId: null,
    eligible: true,
    ...over,
  };
}

function page(options: ReturnType<typeof option>[], truncated = false) {
  return { options, truncated };
}

// Radix Select needs these pointer/scroll APIs, which jsdom lacks.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

const optA = option({
  locationName: 'locations/a',
  title: 'Sorriso Pleno Moema',
  linkedClientId: 7,
  linkedClientName: 'Clínica Sorriso Pleno',
  linkedConnectionId: 'conn-1',
});
const optB = option({
  locationName: 'locations/b',
  title: 'Sorriso Pleno Pinheiros',
  linkedClientId: 7,
  linkedClientName: 'Clínica Sorriso Pleno',
  linkedConnectionId: 'conn-1',
});
const optC = option({ locationName: 'locations/c', title: 'Sorriso Pleno Santo André' });
const optUsed = option({
  locationName: 'locations/d',
  title: 'Instituto Dental Vila Mariana',
  linkedClientId: 99,
  linkedClientName: 'Instituto Dental',
  linkedConnectionId: 'conn-1',
});
const optUnverified = option({
  locationName: 'locations/e',
  title: 'Sorriso Pleno Tatuapé',
  eligible: false,
  hasVoiceOfMerchant: false,
});

const connection = {
  id: 'conn-1',
  email: 'contato@sorrisopleno.com.br',
  status: 'active' as const,
};

function renderDialog(
  over: Partial<{ connections: (typeof connection)[]; onOpenChange: (o: boolean) => void }> = {},
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const onOpenChange = over.onOpenChange ?? vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <GbpUnitsDialog
        clienteId={7}
        clienteNome="Clínica Sorriso Pleno"
        connections={over.connections ?? [connection]}
        initialConnectionId="conn-1"
        open
        onOpenChange={onOpenChange}
      />
    </QueryClientProvider>,
  );
  return { invalidate, onOpenChange };
}

function ReopenHarness() {
  const [open, setOpen] = useState(true);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <button type="button" onClick={() => setOpen(true)}>
        reabrir
      </button>
      <GbpUnitsDialog
        clienteId={7}
        clienteNome="Clínica Sorriso Pleno"
        connections={[connection]}
        initialConnectionId="conn-1"
        open={open}
        onOpenChange={setOpen}
      />
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('GbpUnitsDialog', () => {
  it('shows title, intro and the note once the units load', async () => {
    listOptionsMock.mockResolvedValue(page([optA, optB, optC, optUsed, optUnverified]));
    renderDialog();

    expect(
      await screen.findByText('Quais unidades são da Clínica Sorriso Pleno?'),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(
        'Encontramos 5 perfis na conta contato@sorrisopleno.com.br. Marque os que pertencem a este cliente. Dá para mudar depois em Gerenciar unidades.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Puxamos os últimos 18 meses de cada unidade marcada. Pode levar alguns minutos na primeira vez.',
      ),
    ).toBeInTheDocument();
    expect(listOptionsMock).toHaveBeenCalledWith(7, 'conn-1');
  });

  it('disables_linked_and_unverified', async () => {
    listOptionsMock.mockResolvedValue(page([optA, optC, optUsed, optUnverified]));
    renderDialog();

    const used = await screen.findByRole('checkbox', { name: /Instituto Dental Vila Mariana/ });
    expect(used).toBeDisabled();
    expect(
      screen.getByText(
        'Já vinculada ao cliente Instituto Dental. Uma unidade pertence a um cliente só.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Em uso')).toBeInTheDocument();

    const unverified = screen.getByRole('checkbox', { name: /Sorriso Pleno Tatuapé/ });
    expect(unverified).toBeDisabled();
    expect(
      screen.getByText(
        'Perfil ainda não verificado pelo Google, que não libera métricas para ele.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Não verificado')).toBeInTheDocument();

    expect(screen.getByRole('checkbox', { name: /Sorriso Pleno Moema/ })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: /Sorriso Pleno Santo André/ })).toBeEnabled();
  });

  it('starts with this client units checked and counts them in the button', async () => {
    listOptionsMock.mockResolvedValue(page([optA, optB, optC]));
    renderDialog();

    expect(await screen.findByRole('button', { name: 'Vincular 2 unidades' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Sorriso Pleno Moema/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Sorriso Pleno Santo André/ })).not.toBeChecked();
  });

  it('button_label_counts', async () => {
    listOptionsMock.mockResolvedValue(page([optA, optB, optC]));
    renderDialog();

    await screen.findByRole('button', { name: 'Vincular 2 unidades' });
    await userEvent.click(screen.getByRole('checkbox', { name: /Sorriso Pleno Pinheiros/ }));
    expect(screen.getByRole('button', { name: 'Vincular 1 unidade' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: /Sorriso Pleno Santo André/ }));
    expect(screen.getByRole('button', { name: 'Vincular 2 unidades' })).toBeInTheDocument();
  });

  it('submit_sends_checked_names', async () => {
    listOptionsMock.mockResolvedValue(page([optA, optB, optC]));
    linkMock.mockResolvedValue(2);
    const { invalidate, onOpenChange } = renderDialog();

    await screen.findByRole('button', { name: 'Vincular 2 unidades' });
    await userEvent.click(screen.getByRole('checkbox', { name: /Sorriso Pleno Pinheiros/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Sorriso Pleno Santo André/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Vincular 2 unidades' }));

    await waitFor(() =>
      expect(linkMock).toHaveBeenCalledWith(7, 'conn-1', ['locations/a', 'locations/c']),
    );
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['googleSummary', 7] }),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('asks before closing once the selection changed, not before', async () => {
    listOptionsMock.mockResolvedValue(page([optA, optC]));
    const { onOpenChange } = renderDialog();

    await screen.findByRole('button', { name: 'Vincular 1 unidade' });
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByText('Fechar sem salvar?')).toBeNull();
    expect(onOpenChange).toHaveBeenCalledWith(false);

    onOpenChange.mockClear();
    await userEvent.click(screen.getByRole('checkbox', { name: /Sorriso Pleno Santo André/ }));
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByText('Fechar sem salvar?')).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('not_approved_message', async () => {
    listOptionsMock.mockRejectedValue(new GoogleServiceError('gmn_not_approved'));
    renderDialog();

    expect(
      await screen.findByText(
        'O Google ainda não liberou o acesso ao Google Meu Negócio para o Mesaas.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).toBeNull();
  });

  it('shows the reconnect banner on a reconnect error', async () => {
    listOptionsMock.mockRejectedValue(new GoogleServiceError('reconnect'));
    renderDialog();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveClass('badge-warning');
    expect(within(alert).getByRole('button', { name: 'Reconectar' })).toBeInTheDocument();
  });

  it('maps a save-time rate limit to its message and keeps the dialog open', async () => {
    listOptionsMock.mockResolvedValue(page([optA, optC]));
    linkMock.mockRejectedValue(new GoogleServiceError('rate_limited'));
    const { onOpenChange } = renderDialog();

    await userEvent.click(
      await screen.findByRole('checkbox', { name: /Sorriso Pleno Santo André/ }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Vincular 2 unidades' }));

    expect(
      await screen.findByText('Muitas tentativas. Tente de novo em instantes.'),
    ).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('resets discarded edits when the dialog is reopened', async () => {
    listOptionsMock.mockResolvedValue(page([optA, optC]));
    render(<ReopenHarness />);

    await screen.findByRole('button', { name: 'Vincular 1 unidade' });
    await userEvent.click(screen.getByRole('checkbox', { name: /Sorriso Pleno Santo André/ }));
    expect(screen.getByRole('button', { name: 'Vincular 2 unidades' })).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    await userEvent.click(await screen.findByRole('button', { name: 'Fechar mesmo assim' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await userEvent.click(screen.getByRole('button', { name: 'reabrir' }));
    expect(await screen.findByRole('button', { name: 'Vincular 1 unidade' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Sorriso Pleno Santo André/ })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Sorriso Pleno Moema/ })).toBeChecked();
  });

  it('offers Desvincular todas when every linked unit is unchecked', async () => {
    listOptionsMock.mockResolvedValue(page([optA, optB, optC]));
    linkMock.mockResolvedValue(0);
    renderDialog();

    await screen.findByRole('button', { name: 'Vincular 2 unidades' });
    await userEvent.click(screen.getByRole('checkbox', { name: /Sorriso Pleno Moema/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Sorriso Pleno Pinheiros/ }));
    const button = screen.getByRole('button', { name: 'Desvincular todas' });
    expect(button).toBeEnabled();

    await userEvent.click(button);
    await waitFor(() => expect(linkMock).toHaveBeenCalledWith(7, 'conn-1', []));
  });

  it('disables submit when nothing is linked and nothing is checked', async () => {
    listOptionsMock.mockResolvedValue(page([optC]));
    renderDialog();

    await screen.findByRole('checkbox', { name: /Sorriso Pleno Santo André/ });
    expect(screen.getByRole('button', { name: /^Vincular/ })).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /Sorriso Pleno Santo André/ }));
    expect(screen.getByRole('button', { name: 'Vincular 1 unidade' })).toBeEnabled();
  });

  it('sends only names from the second connection after switching accounts', async () => {
    const second = { id: 'conn-2', email: 'outra@conta.com', status: 'active' as const };
    const optF = option({ locationName: 'locations/f', title: 'Filial Centro' });
    listOptionsMock.mockImplementation((_c: number, conn: string) =>
      Promise.resolve(page(conn === 'conn-2' ? [optF] : [optA, optC])),
    );
    linkMock.mockResolvedValue(1);
    renderDialog({ connections: [connection, second] });

    await screen.findByRole('checkbox', { name: /Sorriso Pleno Moema/ });
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByRole('option', { name: 'outra@conta.com' }));

    await userEvent.click(await screen.findByRole('checkbox', { name: /Filial Centro/ }));
    expect(screen.queryByRole('checkbox', { name: /Sorriso Pleno Moema/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Vincular 1 unidade' }));

    await waitFor(() => expect(linkMock).toHaveBeenCalledWith(7, 'conn-2', ['locations/f']));
  });

  it('refetches the list and shows the message on location_unavailable', async () => {
    listOptionsMock.mockResolvedValue(page([optA, optC]));
    linkMock.mockRejectedValue(new GoogleServiceError('location_unavailable'));
    const { onOpenChange } = renderDialog();

    await userEvent.click(
      await screen.findByRole('checkbox', { name: /Sorriso Pleno Santo André/ }),
    );
    expect(listOptionsMock).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Vincular 2 unidades' }));

    expect(
      await screen.findByText(
        'Uma das unidades marcadas não está mais disponível. A lista foi atualizada, confira a seleção.',
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(listOptionsMock).toHaveBeenCalledTimes(2));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('keeps a linked unit that Google now reports unverified checked and enabled, and lets it be unlinked', async () => {
    const stale = option({
      locationName: 'locations/s',
      title: 'Sorriso Pleno Tatuapé',
      linkedClientId: 7,
      linkedClientName: 'Clínica Sorriso Pleno',
      linkedConnectionId: 'conn-1',
      eligible: false,
      hasVoiceOfMerchant: false,
    });
    listOptionsMock.mockResolvedValue(page([optA, stale, optC]));
    linkMock.mockResolvedValue(2);
    renderDialog();

    const box = await screen.findByRole('checkbox', { name: /Sorriso Pleno Tatuapé/ });
    expect(box).toBeChecked();
    expect(box).toBeEnabled();
    expect(screen.getByText('Não verificado')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Perfil ainda não verificado pelo Google, que não libera métricas para ele.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Em uso')).toBeNull();

    // Left checked, it stays in the save set (R7).
    await userEvent.click(screen.getByRole('checkbox', { name: /Sorriso Pleno Santo André/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Vincular 3 unidades' }));
    await waitFor(() =>
      expect(linkMock).toHaveBeenCalledWith(7, 'conn-1', [
        'locations/a',
        'locations/s',
        'locations/c',
      ]),
    );
  });

  it('removes an unverified linked unit from the save set when it is unchecked', async () => {
    const stale = option({
      locationName: 'locations/s',
      title: 'Sorriso Pleno Tatuapé',
      linkedClientId: 7,
      linkedClientName: 'Clínica Sorriso Pleno',
      linkedConnectionId: 'conn-1',
      eligible: false,
      hasVoiceOfMerchant: false,
    });
    listOptionsMock.mockResolvedValue(page([optA, stale]));
    linkMock.mockResolvedValue(1);
    renderDialog();

    await userEvent.click(await screen.findByRole('checkbox', { name: /Sorriso Pleno Tatuapé/ }));
    expect(screen.getByRole('checkbox', { name: /Sorriso Pleno Tatuapé/ })).not.toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Vincular 1 unidade' }));
    await waitFor(() => expect(linkMock).toHaveBeenCalledWith(7, 'conn-1', ['locations/a']));
  });

  it('locks a unit linked to this client through another Google account and never sends it', async () => {
    const viaOther = option({
      locationName: 'locations/o',
      title: 'Sorriso Pleno Mooca',
      linkedClientId: 7,
      linkedClientName: 'Clínica Sorriso Pleno',
      linkedConnectionId: 'conn-2',
    });
    listOptionsMock.mockResolvedValue(page([optA, viaOther, optC]));
    linkMock.mockResolvedValue(2);
    renderDialog();

    const box = await screen.findByRole('checkbox', { name: /Sorriso Pleno Mooca/ });
    expect(box).toBeChecked();
    expect(box).toBeDisabled();
    expect(
      screen.getByText('Vinculada por outra conta Google. Gerencie pela conta que a vinculou.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Em uso')).toBeNull();
    expect(screen.queryByText('Não verificado')).toBeNull();

    // Only this connection's unit counts; the locked one is outside the save set.
    expect(screen.getByRole('button', { name: 'Vincular 1 unidade' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: /Sorriso Pleno Santo André/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Vincular 2 unidades' }));
    await waitFor(() =>
      expect(linkMock).toHaveBeenCalledWith(7, 'conn-1', ['locations/a', 'locations/c']),
    );
  });

  it('does not offer to unlink when the only linked unit belongs to another account', async () => {
    const viaOther = option({
      locationName: 'locations/o',
      title: 'Sorriso Pleno Mooca',
      linkedClientId: 7,
      linkedConnectionId: 'conn-2',
    });
    listOptionsMock.mockResolvedValue(page([viaOther, optC]));
    renderDialog();

    await screen.findByRole('checkbox', { name: /Sorriso Pleno Mooca/ });
    expect(screen.queryByRole('button', { name: 'Desvincular todas' })).toBeNull();
    expect(screen.getByRole('button', { name: /^Vincular/ })).toBeDisabled();
  });

  it('notes a truncated listing', async () => {
    listOptionsMock.mockResolvedValue(page([optA, optC], true));
    renderDialog();

    expect(
      await screen.findByText(
        'Mostramos só parte das unidades desta conta Google. As unidades já vinculadas a este cliente aparecem sempre.',
      ),
    ).toBeInTheDocument();
  });

  it('shows no truncation note on a complete listing', async () => {
    listOptionsMock.mockResolvedValue(page([optA, optC]));
    renderDialog();

    await screen.findByRole('checkbox', { name: /Sorriso Pleno Moema/ });
    expect(screen.queryByText(/Mostramos só parte das unidades/)).toBeNull();
  });

  it('feature_disabled_message', async () => {
    listOptionsMock.mockRejectedValue(new GoogleServiceError('feature_disabled'));
    renderDialog();

    expect(
      await screen.findByText('O Google Meu Negócio não está disponível no seu plano.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).toBeNull();
  });
});

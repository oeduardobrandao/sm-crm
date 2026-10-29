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
    eligible: true,
    ...over,
  };
}

const optA = option({
  locationName: 'locations/a',
  title: 'Sorriso Pleno Moema',
  linkedClientId: 7,
  linkedClientName: 'Clínica Sorriso Pleno',
});
const optB = option({
  locationName: 'locations/b',
  title: 'Sorriso Pleno Pinheiros',
  linkedClientId: 7,
  linkedClientName: 'Clínica Sorriso Pleno',
});
const optC = option({ locationName: 'locations/c', title: 'Sorriso Pleno Santo André' });
const optUsed = option({
  locationName: 'locations/d',
  title: 'Instituto Dental Vila Mariana',
  linkedClientId: 99,
  linkedClientName: 'Instituto Dental',
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('GbpUnitsDialog', () => {
  it('shows title, intro and the note once the units load', async () => {
    listOptionsMock.mockResolvedValue([optA, optB, optC, optUsed, optUnverified]);
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
    listOptionsMock.mockResolvedValue([optA, optC, optUsed, optUnverified]);
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
    listOptionsMock.mockResolvedValue([optA, optB, optC]);
    renderDialog();

    expect(await screen.findByRole('button', { name: 'Vincular 2 unidades' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Sorriso Pleno Moema/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Sorriso Pleno Santo André/ })).not.toBeChecked();
  });

  it('button_label_counts', async () => {
    listOptionsMock.mockResolvedValue([optA, optB, optC]);
    renderDialog();

    await screen.findByRole('button', { name: 'Vincular 2 unidades' });
    await userEvent.click(screen.getByRole('checkbox', { name: /Sorriso Pleno Pinheiros/ }));
    expect(screen.getByRole('button', { name: 'Vincular 1 unidade' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: /Sorriso Pleno Santo André/ }));
    expect(screen.getByRole('button', { name: 'Vincular 2 unidades' })).toBeInTheDocument();
  });

  it('submit_sends_checked_names', async () => {
    listOptionsMock.mockResolvedValue([optA, optB, optC]);
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
    listOptionsMock.mockResolvedValue([optA, optC]);
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
    listOptionsMock.mockResolvedValue([optA, optC]);
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
});

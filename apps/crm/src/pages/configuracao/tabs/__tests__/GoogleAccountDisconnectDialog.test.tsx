import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import { GoogleServiceError, type GoogleAccount } from '../../../../services/google';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { disconnectGoogleAccountMock } = vi.hoisted(() => ({
  disconnectGoogleAccountMock: vi.fn(),
}));

vi.mock('../../../../services/google', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../services/google')>();
  return {
    ...actual,
    disconnectGoogleAccount: (...a: unknown[]) => disconnectGoogleAccountMock(...a),
  };
});

import { GoogleAccountDisconnectDialog } from '../contas-conectadas/GoogleAccountDisconnectDialog';

const linked: GoogleAccount = {
  id: 'conn-1',
  email: 'agencia@gmail.com',
  displayName: null,
  status: 'active',
  connectedAt: '2026-10-30T14:02:11.000Z',
  youtube: [
    {
      channelId: 'UC1',
      title: 'Canal Sorriso',
      handle: '@sorriso',
      clientId: 7,
      clientName: 'Clínica Sorriso',
      authorizationStatus: 'active',
    },
  ],
  gbp: [
    {
      id: 'loc-1',
      title: 'Loja Centro',
      addressLine: null,
      clientId: 8,
      clientName: 'Padaria Boa',
      status: 'active',
    },
    {
      id: 'loc-2',
      title: 'Loja Norte',
      addressLine: null,
      clientId: 8,
      clientName: null,
      status: 'revoked',
    },
  ],
};

const nothing: GoogleAccount = { ...linked, youtube: [], gbp: [] };

// Seeded so the invalidation set can be read back (getQueryState().isInvalidated).
const SEEDED: unknown[][] = [
  ['googleAccounts'],
  ['googleSummary', 7],
  ['youtube-portfolio'],
  ['gbp-portfolio', 'x'],
  ['gbpLocationOptions', 8, 'conn-1'],
  ['yt-overview', 7, '30d'],
  ['yt-top-shorts', 7],
  ['gbp-units', 8],
  ['gbp-rating-distribution', 8],
  ['tiktok-overview', 7],
  ['clientes'],
];

function renderDialog(account: GoogleAccount = linked) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const key of SEEDED) qc.setQueryData(key, { seeded: true });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const onClose = vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}>
      <GoogleAccountDisconnectDialog account={account} open onClose={onClose} />
    </QueryClientProvider>,
  );
  const invalidated = (key: unknown[]) => qc.getQueryState(key)?.isInvalidated === true;
  return { ...utils, qc, invalidate, invalidated, onClose };
}

async function confirm() {
  const dialog = await screen.findByRole('alertdialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Desconectar conta' }));
  return dialog;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('GoogleAccountDisconnectDialog', () => {
  it('lists every channel and unit it unlinks, the relevant bullets and the note', async () => {
    renderDialog();
    const dialog = await screen.findByRole('alertdialog');
    const d = within(dialog);
    expect(d.getByText('Desconectar agencia@gmail.com?')).toBeInTheDocument();
    expect(d.getByText('Isso desvincula:')).toBeInTheDocument();
    const list = within(d.getByTestId('disconnect-unlink-list'));
    expect(list.getByText('YouTube')).toBeInTheDocument();
    expect(list.getByText('Canal Sorriso (Clínica Sorriso)')).toBeInTheDocument();
    expect(list.getByText('Google Meu Negócio')).toBeInTheDocument();
    expect(list.getByText('Loja Centro (Padaria Boa)')).toBeInTheDocument();
    // No client name: the title alone.
    expect(list.getByText('Loja Norte')).toBeInTheDocument();
    expect(
      d.getByText(
        'Os dados do YouTube são apagados do Mesaas em até 7 dias, inclusive dos relatórios gerados.',
      ),
    ).toBeInTheDocument();
    expect(
      d.getByText(
        'O histórico do Google Meu Negócio fica guardado por 30 dias. Se você vincular a unidade de novo nesse prazo, ele volta.',
      ),
    ).toBeInTheDocument();
    expect(
      d.getByText(
        'Revogamos o acesso do Mesaas na sua conta Google. Na próxima conexão, o Google pede autorização de novo.',
      ),
    ).toBeInTheDocument();
    expect(d.getByTestId('disconnect-other-workspaces-note')).toHaveTextContent(
      'Se essa conta Google também estiver conectada em outro workspace do Mesaas, o acesso continua ativo lá e não é revogado no Google.',
    );
  });

  it('replaces the list with "Nenhum canal ou unidade vinculado." and keeps the note', async () => {
    renderDialog(nothing);
    const d = within(await screen.findByRole('alertdialog'));
    expect(d.getByText('Nenhum canal ou unidade vinculado.')).toBeInTheDocument();
    expect(d.queryByTestId('disconnect-unlink-list')).toBeNull();
    expect(d.queryByText(/Os dados do YouTube/)).toBeNull();
    expect(d.queryByText(/O histórico do Google Meu Negócio/)).toBeNull();
    expect(d.getByText(/Revogamos o acesso do Mesaas/)).toBeInTheDocument();
    expect(d.getByTestId('disconnect-other-workspaces-note')).toBeInTheDocument();
  });

  it('confirms once, toasts and invalidates every Google query, nothing else', async () => {
    disconnectGoogleAccountMock.mockResolvedValue({
      ok: true,
      youtubeChannelsUnlinked: 1,
      gbpLocationsUnlinked: 2,
    });
    const { invalidated, invalidate, onClose } = renderDialog();
    await confirm();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(disconnectGoogleAccountMock).toHaveBeenCalledTimes(1);
    expect(disconnectGoogleAccountMock).toHaveBeenCalledWith('conn-1');
    expect(toast.success).toHaveBeenCalledWith('Conta Google desconectada');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['googleAccounts'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['googleSummary'] });
    for (const key of SEEDED.slice(0, 9)) expect(invalidated(key)).toBe(true);
    expect(invalidated(['tiktok-overview', 7])).toBe(false);
    expect(invalidated(['clientes'])).toBe(false);
  });

  it('stays open and blocks a second request while pending', async () => {
    let resolve!: (v: unknown) => void;
    disconnectGoogleAccountMock.mockReturnValue(new Promise((r) => (resolve = r)));
    const { onClose } = renderDialog();
    const dialog = await confirm();

    const action = within(dialog).getByRole('button', { name: 'Desconectar conta' });
    await waitFor(() => expect(action).toBeDisabled());
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(action);
    expect(disconnectGoogleAccountMock).toHaveBeenCalledTimes(1);

    resolve({ ok: true, youtubeChannelsUnlinked: 0, gbpLocationsUnlinked: 0 });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('treats 404 as already disconnected: closes and refreshes only the account list', async () => {
    disconnectGoogleAccountMock.mockRejectedValue(new GoogleServiceError('not_found'));
    const { invalidated, onClose } = renderDialog();
    await confirm();

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith('Essa conta Google já tinha sido desconectada.');
    expect(toast.error).not.toHaveBeenCalled();
    expect(invalidated(['googleAccounts'])).toBe(true);
    expect(invalidated(['googleSummary', 7])).toBe(false);
    expect(invalidated(['yt-overview', 7, '30d'])).toBe(false);
  });

  it('keeps the dialog open on 409 so the user can retry', async () => {
    disconnectGoogleAccountMock.mockRejectedValueOnce(new GoogleServiceError('conflict'));
    disconnectGoogleAccountMock.mockResolvedValueOnce({
      ok: true,
      youtubeChannelsUnlinked: 1,
      gbpLocationsUnlinked: 2,
    });
    const { invalidated, onClose } = renderDialog();
    const dialog = await confirm();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'A conta mudou enquanto desconectávamos. Tente de novo.',
      ),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(invalidated(['googleAccounts'])).toBe(false);

    const action = within(dialog).getByRole('button', { name: 'Desconectar conta' });
    await waitFor(() => expect(action).toBeEnabled());
    await userEvent.click(action);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(disconnectGoogleAccountMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['forbidden', 'Você não tem permissão para desconectar contas.'],
    ['rate_limited', 'Muitas tentativas. Aguarde um minuto e tente de novo.'],
    ['unknown', 'Não foi possível desconectar a conta. Tente de novo.'],
  ] as const)('toasts the %s error and stays open', async (code, message) => {
    disconnectGoogleAccountMock.mockRejectedValue(new GoogleServiceError(code));
    const { onClose, invalidated } = renderDialog();
    await confirm();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message));
    expect(onClose).not.toHaveBeenCalled();
    expect(invalidated(['googleAccounts'])).toBe(false);
  });

  it('toasts the generic error for a non-service failure', async () => {
    disconnectGoogleAccountMock.mockRejectedValue(new TypeError('Failed to fetch'));
    renderDialog();
    await confirm();
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Não foi possível desconectar a conta. Tente de novo.',
      ),
    );
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { makeCan, fakeMembership } from '@/test/makeCan';
import type { GoogleAccount } from '../../../../services/google';

vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { useAuthMock, listGoogleAccountsMock, disconnectGoogleAccountMock, planFlags } = vi.hoisted(
  () => ({
    useAuthMock: vi.fn(),
    listGoogleAccountsMock: vi.fn(),
    disconnectGoogleAccountMock: vi.fn(),
    planFlags: {
      features: { feature_youtube: true, feature_google_business: true } as Record<
        string,
        boolean
      > | null,
    },
  }),
);

vi.mock('../../../../context/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../context/AuthContext')>();
  return { ...actual, useAuth: useAuthMock };
});

vi.mock('../../../../hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({ features: planFlags.features }),
}));

vi.mock('../../../../services/google', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../services/google')>();
  return {
    ...actual,
    listGoogleAccounts: (...a: unknown[]) => listGoogleAccountsMock(...a),
    disconnectGoogleAccount: (...a: unknown[]) => disconnectGoogleAccountMock(...a),
  };
});

import ContasConectadasTab from '../ContasConectadasTab';

function account(overrides: Partial<GoogleAccount> = {}): GoogleAccount {
  return {
    id: 'conn-1',
    email: 'agencia@gmail.com',
    displayName: 'Agência X',
    status: 'active',
    connectedAt: '2026-10-30T14:02:11.000Z',
    youtube: [],
    gbp: [],
    ...overrides,
  };
}

const channel = (n: number, client = 'Cliente A') => ({
  channelId: `UC${n}`,
  title: `Canal ${n}`,
  handle: `@canal${n}`,
  clientId: n,
  clientName: client,
  authorizationStatus: 'active' as const,
});

const unit = (n: number, client = 'Cliente B') => ({
  id: `loc-${n}`,
  title: `Loja ${n}`,
  addressLine: null,
  clientId: 100 + n,
  clientName: client,
  status: 'active' as const,
});

function setRole(membership: Parameters<typeof makeCan>[0], workspaceRole: string) {
  useAuthMock.mockReturnValue({ can: makeCan(membership), workspaceRole });
}

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/configuracao/contas-conectadas']}>
        <ContasConectadasTab />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  setRole(fakeMembership({ role: 'admin' }), 'admin');
  planFlags.features = { feature_youtube: true, feature_google_business: true };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ContasConectadasTab', () => {
  it('renders one card per account with the date, counts and plurals', async () => {
    listGoogleAccountsMock.mockResolvedValue([
      account({
        youtube: [channel(1), channel(2, 'Cliente C')],
        gbp: [unit(1)],
      }),
      account({
        id: 'conn-2',
        email: 'outra@gmail.com',
        youtube: [channel(3)],
        gbp: [unit(2), unit(3)],
      }),
    ]);
    renderTab();

    const cards = await screen.findAllByTestId('google-account-card');
    expect(cards).toHaveLength(2);
    expect(screen.getByText('Google (YouTube e Google Meu Negócio)')).toBeInTheDocument();

    const first = within(cards[0]);
    expect(first.getByText('agencia@gmail.com')).toBeInTheDocument();
    expect(first.getByText('A')).toBeInTheDocument();
    expect(first.getByText('Conectada em 30/10/2026')).toBeInTheDocument();
    expect(first.getByText('Ativa')).toBeInTheDocument();
    expect(first.getByText('YouTube · 2 canais')).toBeInTheDocument();
    expect(first.getByText('Canal 1 (Cliente A)')).toBeInTheDocument();
    expect(first.getByText('Canal 2 (Cliente C)')).toBeInTheDocument();
    expect(first.getByText('Google Meu Negócio · 1 unidade')).toBeInTheDocument();
    expect(first.getByText('Loja 1 (Cliente B)')).toBeInTheDocument();

    const second = within(cards[1]);
    expect(second.getByText('YouTube · 1 canal')).toBeInTheDocument();
    expect(second.getByText('Google Meu Negócio · 2 unidades')).toBeInTheDocument();
  });

  it('shows the first 3 units, then "+ N unidades" expands the rest', async () => {
    listGoogleAccountsMock.mockResolvedValue([
      account({ gbp: [unit(1), unit(2), unit(3), unit(4), unit(5)] }),
    ]);
    renderTab();

    expect(await screen.findByText('Google Meu Negócio · 5 unidades')).toBeInTheDocument();
    expect(screen.getByText('Loja 3 (Cliente B)')).toBeInTheDocument();
    expect(screen.queryByText('Loja 4 (Cliente B)')).toBeNull();

    const toggle = screen.getByRole('button', { name: '+ 2 unidades' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(screen.getByText('Loja 4 (Cliente B)')).toBeInTheDocument();
    expect(screen.getByText('Loja 5 (Cliente B)')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Mostrar menos' }));
    expect(screen.queryByText('Loja 5 (Cliente B)')).toBeNull();
  });

  it('uses the singular for a single hidden unit', async () => {
    listGoogleAccountsMock.mockResolvedValue([
      account({ gbp: [unit(1), unit(2), unit(3), unit(4)] }),
    ]);
    renderTab();
    expect(await screen.findByRole('button', { name: '+ 1 unidade' })).toBeInTheDocument();
  });

  it('marks a revoked account with "Precisa reconectar"', async () => {
    listGoogleAccountsMock.mockResolvedValue([
      account({
        status: 'revoked',
        youtube: [{ ...channel(1), authorizationStatus: 'revoked' }],
      }),
    ]);
    renderTab();
    const card = await screen.findByTestId('google-account-card');
    expect(within(card).getByText('Precisa reconectar')).toHaveClass('badge-warning');
    expect(within(card).queryByText('Ativa')).toBeNull();
    // A revoked channel is still listed.
    expect(within(card).getByText('Canal 1 (Cliente A)')).toBeInTheDocument();
  });

  it('shows the hint on an account with nothing linked', async () => {
    listGoogleAccountsMock.mockResolvedValue([account()]);
    renderTab();
    expect(
      await screen.findByText(
        'Nada vinculado a esta conta. Desconecte para apagar o acesso dela neste workspace.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^YouTube ·/)).toBeNull();
    expect(screen.queryByText(/^Google Meu Negócio ·/)).toBeNull();
  });

  it('shows the empty state with the connect hint while a Google flag is on', async () => {
    listGoogleAccountsMock.mockResolvedValue([]);
    renderTab();
    expect(
      await screen.findByText(
        'Nenhuma conta Google conectada. Conecte pelo YouTube ou Google Meu Negócio na página de um cliente.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('google-account-card')).toBeNull();
  });

  it('keeps only the first empty-state sentence with both Google flags off', async () => {
    planFlags.features = { feature_youtube: false, feature_google_business: false };
    listGoogleAccountsMock.mockResolvedValue([]);
    renderTab();
    expect(await screen.findByText('Nenhuma conta Google conectada.')).toBeInTheDocument();
    expect(screen.queryByText(/Conecte pelo YouTube/)).toBeNull();
  });

  it('shows the load error and retries', async () => {
    listGoogleAccountsMock.mockRejectedValueOnce(new Error('boom'));
    listGoogleAccountsMock.mockResolvedValueOnce([account()]);
    renderTab();

    const alert = await screen.findByRole('alert');
    expect(
      within(alert).getByText('Não foi possível carregar as contas conectadas.'),
    ).toBeInTheDocument();
    await userEvent.click(within(alert).getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByTestId('google-account-card')).toBeInTheDocument();
    expect(listGoogleAccountsMock).toHaveBeenCalledTimes(2);
  });

  it('offers "Desconectar conta" with configuracoes:editar and opens the confirmation', async () => {
    listGoogleAccountsMock.mockResolvedValue([account({ youtube: [channel(1)] })]);
    renderTab();

    await userEvent.click(await screen.findByRole('button', { name: 'Desconectar conta' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Desconectar agencia@gmail.com?')).toBeInTheDocument();
  });

  it('hides "Desconectar conta" from who can only view the settings', async () => {
    setRole(
      fakeMembership({ role: 'agent', role_id: 'r1', permissions: { configuracoes: 'ver' } }),
      'agent',
    );
    listGoogleAccountsMock.mockResolvedValue([account({ youtube: [channel(1)] })]);
    renderTab();

    expect(await screen.findByTestId('google-account-card')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Desconectar conta' })).toBeNull();
  });

  it('refreshes the list after a disconnect', async () => {
    listGoogleAccountsMock.mockResolvedValueOnce([account()]);
    listGoogleAccountsMock.mockResolvedValueOnce([]);
    disconnectGoogleAccountMock.mockResolvedValue({
      ok: true,
      youtubeChannelsUnlinked: 0,
      gbpLocationsUnlinked: 0,
    });
    renderTab();

    await userEvent.click(await screen.findByRole('button', { name: 'Desconectar conta' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Desconectar conta' }));

    await waitFor(() => expect(disconnectGoogleAccountMock).toHaveBeenCalledWith('conn-1'));
    expect(await screen.findByText(/Nenhuma conta Google conectada/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });
});

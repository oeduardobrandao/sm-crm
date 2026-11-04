import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { makeCan, fakeMembership } from '@/test/makeCan';

// Phone branch (below 768px).
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => false }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/components/layout/PhoneShellHeader', () => ({
  PhoneShellActions: () => <div data-testid="shell-actions" />,
}));

const { useAuthMock, listGoogleAccountsMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  listGoogleAccountsMock: vi.fn(),
}));

vi.mock('../../../../context/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../context/AuthContext')>();
  return { ...actual, useAuth: useAuthMock };
});

vi.mock('../../../../hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({ features: { feature_youtube: true } }),
}));

vi.mock('../../../../services/google', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../services/google')>();
  return { ...actual, listGoogleAccounts: (...a: unknown[]) => listGoogleAccountsMock(...a) };
});

import ContasConectadasTab from '../ContasConectadasTab';

const accounts = [
  {
    id: 'conn-1',
    email: 'agencia@gmail.com',
    displayName: null,
    status: 'active',
    connectedAt: '2026-10-30T14:02:11.000Z',
    youtube: [
      {
        channelId: 'UC1',
        title: 'Canal 1',
        handle: null,
        clientId: 1,
        clientName: 'Cliente A',
        authorizationStatus: 'active',
      },
    ],
    gbp: [],
  },
  {
    id: 'conn-2',
    email: 'zeta@gmail.com',
    displayName: null,
    status: 'revoked',
    connectedAt: '2026-10-31T14:02:11.000Z',
    youtube: [],
    gbp: [],
  },
];

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
  useAuthMock.mockReturnValue({
    can: makeCan(fakeMembership({ role: 'owner' })),
    workspaceRole: 'owner',
  });
  listGoogleAccountsMock.mockResolvedValue(accounts);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ContasConectadasTab on phones', () => {
  it('renders a ConfigPhoneScreen with one stacked card per account', async () => {
    const { container } = renderTab();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Contas conectadas' }),
    ).toBeInTheDocument();
    expect(container.querySelector('.phone-config-screen')).not.toBeNull();
    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: 'Google (YouTube e Google Meu Negócio)',
      }),
    ).toBeInTheDocument();

    const cards = await screen.findAllByTestId('google-account-card');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveClass('connected-account-card');
    expect(within(cards[0]).getByText('YouTube · 1 canal')).toBeInTheDocument();
    expect(within(cards[1]).getByText('Precisa reconectar')).toBeInTheDocument();
  });

  it('puts a full-width "Desconectar conta" at the bottom of each card', async () => {
    renderTab();
    const cards = await screen.findAllByTestId('google-account-card');
    for (const card of cards) {
      const button = within(card).getByRole('button', { name: 'Desconectar conta' });
      expect(button).toHaveClass('w-full');
      expect(button).toHaveClass('connected-account-card__disconnect');
      // Last thing in the card.
      expect(card.lastElementChild?.contains(button)).toBe(true);
    }

    await userEvent.click(within(cards[1]).getByRole('button', { name: 'Desconectar conta' }));
    expect(
      within(await screen.findByRole('alertdialog')).getByText('Desconectar zeta@gmail.com?'),
    ).toBeInTheDocument();
  });

  it('hides the button without configuracoes:editar', async () => {
    useAuthMock.mockReturnValue({
      can: makeCan(
        fakeMembership({ role: 'agent', role_id: 'r1', permissions: { configuracoes: 'ver' } }),
      ),
      workspaceRole: 'agent',
    });
    renderTab();
    expect(await screen.findAllByTestId('google-account-card')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Desconectar conta' })).toBeNull();
  });
});

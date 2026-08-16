import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const {
  mockGetAutomations,
  mockGetClientes,
  mockGetSends,
  mockUpdate,
  mockDelete,
  hasFeatureMock,
  mockUseAuth,
} = vi.hoisted(() => ({
  mockGetAutomations: vi.fn(),
  mockGetClientes: vi.fn(),
  mockGetSends: vi.fn(),
  mockUpdate: vi.fn().mockResolvedValue(undefined),
  mockDelete: vi.fn().mockResolvedValue(undefined),
  hasFeatureMock: vi.fn(() => true),
  mockUseAuth: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Mesmo padrão do ConectarPage.test: t devolve a CHAVE (com vars serializadas),
// então os asserts abaixo verificam chaves do namespace, não strings pt/en.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
    i18n: { language: 'pt' },
  }),
}));

vi.mock('../../../store', async () => {
  const actual = await vi.importActual<typeof import('../../../store')>('../../../store');
  return {
    ...actual,
    getInstagramAutomations: mockGetAutomations,
    getClientes: mockGetClientes,
    getInstagramAutomationSends: mockGetSends,
    updateInstagramAutomation: mockUpdate,
    deleteInstagramAutomation: mockDelete,
  };
});

vi.mock('../../../context/AuthContext', () => ({ useAuth: mockUseAuth }));

// FeatureGate normally reads the live entitlements query (a real fetch); a
// controllable stub lets the "flag off" test drive it directly without
// standing up that whole network chain.
vi.mock('@/components/paywall/FeatureGate', () => ({
  FeatureGate: ({
    flag,
    label,
    children,
  }: {
    flag: string;
    label?: string;
    children: ReactNode;
  }) =>
    hasFeatureMock(flag) ? (
      <>{children}</>
    ) : (
      <p data-testid="feature-gate-locked">{label} não está disponível no seu plano.</p>
    ),
}));

// The dialog has its own client-select / posts-grid / keyword-chip surface --
// out of scope for the list test, which only needs to know it opened.
vi.mock('../AutomationFormDialog', () => ({
  default: ({ open }: { open: boolean }) => (open ? <div data-testid="automation-dialog" /> : null),
}));

import AutomacoesPage from '../AutomacoesPage';

const AUTOMATIONS = [
  {
    id: 'auto-1',
    conta_id: 'w-1',
    client_id: 14,
    name: 'Promo de agosto',
    ig_media_id: null,
    media_permalink: null,
    media_caption: null,
    keywords: ['preco', 'valor'],
    dm_message: 'Segue o link!',
    public_reply: null,
    ativo: true,
    dms_sent_count: 12,
    last_triggered_at: '2026-08-10T12:00:00.000Z',
    created_at: '2026-08-01T09:00:00.000Z',
    updated_at: '2026-08-01T09:00:00.000Z',
  },
];

const CLIENTES = [{ id: 14, nome: 'ACME', sigla: 'AC', cor: '#3ecf8e' }];

const SENDS = [
  {
    id: 'send-1',
    comment_id: 'c-1',
    automation_id: 'auto-1',
    conta_id: 'w-1',
    media_id: 'media-1',
    commenter_id: 'ig-1',
    commenter_username: 'fulano',
    comment_text: 'Qual o preço?',
    comment_created_at: '2026-08-10T11:00:00.000Z',
    status: 'sent' as const,
    skip_reason: null,
    error_code: null,
    dm_status: 'sent' as const,
    public_reply_status: null,
    attempts: 1,
    created_at: '2026-08-10T11:00:05.000Z',
  },
];

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/automacoes']}>
        <AutomacoesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function setAuth(overrides: Record<string, unknown> = {}) {
  mockUseAuth.mockReturnValue({
    role: 'owner',
    profile: { id: 'user-1', conta_id: 'w-1', role: 'owner' },
    ...overrides,
  });
}

describe('AutomacoesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasFeatureMock.mockReturnValue(true);
    mockGetAutomations.mockResolvedValue(AUTOMATIONS);
    mockGetClientes.mockResolvedValue(CLIENTES);
    mockGetSends.mockResolvedValue(SENDS);
    mockUpdate.mockResolvedValue(undefined);
    mockDelete.mockResolvedValue(undefined);
    setAuth();
  });

  it('renders the mocked automation list with client, target, keywords and counters', async () => {
    renderPage();

    expect(await screen.findByText('Promo de agosto')).toBeInTheDocument();
    expect(screen.getByText('ACME')).toBeInTheDocument();
    expect(screen.getByText('allPosts')).toBeInTheDocument();
    expect(screen.getByText('preco')).toBeInTheDocument();
    expect(screen.getByText('valor')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeChecked();
  });

  it('shows the empty state with the FeatureGate upsell when the flag is off and there are no automations', async () => {
    hasFeatureMock.mockReturnValue(false);
    mockGetAutomations.mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText('emptyNone')).toBeInTheDocument();
    expect(screen.getByTestId('feature-gate-locked')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /newAutomation/ })).not.toBeInTheDocument();
  });

  it('hides mutation controls (create button, switch, edit/delete menu) for the agent role', async () => {
    setAuth({ role: 'agent', profile: { id: 'user-1', conta_id: 'w-1', role: 'agent' } });

    renderPage();

    expect(await screen.findByText('Promo de agosto')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /newAutomation/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /rowActions/ })).not.toBeInTheDocument();
    // Read-only status still communicated via a badge instead of the switch
    // (scoped to <tbody>; the column header uses table.active).
    const tbody = document.querySelector('tbody')!;
    expect(within(tbody).getByText('status.active')).toBeInTheDocument();
  });

  it('expands a row to load and show its sends log', async () => {
    renderPage();

    const row = (await screen.findByText('Promo de agosto')).closest('tr')!;
    fireEvent.click(row);

    expect(await screen.findByText('@fulano')).toBeInTheDocument();
    expect(screen.getByText('sendStatus.sent')).toBeInTheDocument();
    await waitFor(() => expect(mockGetSends).toHaveBeenCalledWith('auto-1'));
  });
});

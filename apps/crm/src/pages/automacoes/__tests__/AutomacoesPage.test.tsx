import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';

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
    workflow_post_id: null,
    pending_post_deleted_at: null,
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

const AUTOMATION_PENDING = {
  id: 'auto-pending',
  conta_id: 'w-1',
  client_id: 14,
  name: 'Lançamento de sexta',
  ig_media_id: null,
  media_permalink: null,
  media_caption: 'Chamada para o evento de sexta',
  workflow_post_id: 501,
  pending_post_deleted_at: null,
  keywords: ['evento'],
  dm_message: 'Segue o link!',
  public_reply: null,
  ativo: true,
  dms_sent_count: 0,
  last_triggered_at: null,
  created_at: '2026-08-15T09:00:00.000Z',
  updated_at: '2026-08-15T09:00:00.000Z',
};

const AUTOMATION_TOMBSTONE = {
  id: 'auto-tombstone',
  conta_id: 'w-1',
  client_id: 14,
  name: 'Promo antiga',
  ig_media_id: null,
  media_permalink: null,
  media_caption: 'Promoção de julho',
  workflow_post_id: null,
  pending_post_deleted_at: '2026-08-16T10:00:00.000Z',
  keywords: ['julho'],
  dm_message: 'Segue o link!',
  public_reply: null,
  ativo: false,
  dms_sent_count: 3,
  last_triggered_at: '2026-07-20T12:00:00.000Z',
  created_at: '2026-07-01T09:00:00.000Z',
  updated_at: '2026-08-16T10:00:00.000Z',
};

const AUTOMATION_LINKED_NO_PERMALINK = {
  id: 'auto-linked',
  conta_id: 'w-1',
  client_id: 14,
  name: 'Reels recém-ligado',
  ig_media_id: '17895695668004550',
  media_permalink: null,
  media_caption: 'Bastidores do lançamento',
  workflow_post_id: null,
  pending_post_deleted_at: null,
  keywords: ['bastidores'],
  dm_message: 'Segue o link!',
  public_reply: null,
  ativo: true,
  dms_sent_count: 1,
  last_triggered_at: null,
  created_at: '2026-08-17T09:00:00.000Z',
  updated_at: '2026-08-17T09:00:00.000Z',
};

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

  it('shows the pending target (post title + badge) for an automation still awaiting publication, never "allPosts"', async () => {
    mockGetAutomations.mockResolvedValue([AUTOMATION_PENDING]);

    renderPage();

    const row = (await screen.findByText('Lançamento de sexta')).closest('tr')!;
    expect(within(row).getByText('Chamada para o evento de sexta')).toBeInTheDocument();
    expect(within(row).getByText('pendingBadge')).toBeInTheDocument();
    expect(within(row).queryByText('allPosts')).not.toBeInTheDocument();
  });

  it('shows the deletedPostBadge and an off switch for a tombstoned automation', async () => {
    mockGetAutomations.mockResolvedValue([AUTOMATION_TOMBSTONE]);

    renderPage();

    const row = (await screen.findByText('Promo antiga')).closest('tr')!;
    expect(within(row).getByText('deletedPostBadge')).toBeInTheDocument();
    expect(within(row).getByRole('switch')).not.toBeChecked();
  });

  it('shows the caption without a link for a linked automation with no permalink yet, never "allPosts"', async () => {
    mockGetAutomations.mockResolvedValue([AUTOMATION_LINKED_NO_PERMALINK]);

    renderPage();

    const row = (await screen.findByText('Reels recém-ligado')).closest('tr')!;
    expect(within(row).getByText('Bastidores do lançamento')).toBeInTheDocument();
    expect(within(row).queryByText('allPosts')).not.toBeInTheDocument();
    expect(within(row).queryByRole('link')).not.toBeInTheDocument();
  });

  it('toggling a tombstoned automation shows the reactivateNeedsTarget toast instead of the generic error', async () => {
    mockGetAutomations.mockResolvedValue([AUTOMATION_TOMBSTONE]);
    mockUpdate.mockRejectedValueOnce({
      code: '23514',
      message:
        'new row for relation "instagram_comment_automations" violates check constraint "ica_tombstone_inactive"',
    });

    renderPage();

    const row = (await screen.findByText('Promo antiga')).closest('tr')!;
    fireEvent.click(within(row).getByRole('switch'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('reactivateNeedsTarget'));
  });
});

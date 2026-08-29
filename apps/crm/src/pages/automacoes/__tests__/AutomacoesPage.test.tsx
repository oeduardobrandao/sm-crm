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
  mockHasReadyAccount,
  entitlementsMock,
} = vi.hoisted(() => ({
  mockGetAutomations: vi.fn(),
  mockGetClientes: vi.fn(),
  mockGetSends: vi.fn(),
  mockUpdate: vi.fn().mockResolvedValue(undefined),
  mockDelete: vi.fn().mockResolvedValue(undefined),
  hasFeatureMock: vi.fn(() => true),
  mockUseAuth: vi.fn(),
  mockHasReadyAccount: vi.fn(),
  entitlementsMock: vi.fn(),
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
    hasAutomationReadyAccount: mockHasReadyAccount,
  };
});

vi.mock('../../../context/AuthContext', () => ({ useAuth: mockUseAuth }));

vi.mock('../../../hooks/useEntitlements', () => ({
  useEntitlements: () => entitlementsMock(),
}));

vi.mock('@/components/paywall/UpgradeLockedScreen', () => ({
  UpgradeLockedScreen: ({ children }: { children?: ReactNode }) => (
    <div data-testid="upgrade-locked-screen">{children}</div>
  ),
}));

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
// out of scope for the list test, which only needs to know it opened. Also
// exposes `tour` (as a data attribute) and the `onSaved` path so the tour
// wiring tests below can drive them without the real dialog internals.
vi.mock('../AutomationFormDialog', () => ({
  default: ({
    open,
    onSaved,
    tour,
  }: {
    open: boolean;
    onSaved: () => void;
    tour?: { step: { id: string } };
  }) =>
    open ? (
      <div data-testid="automation-dialog" data-tour-step={tour?.step.id ?? ''}>
        <button onClick={onSaved}>salvar-mock</button>
      </div>
    ) : null,
}));

import AutomacoesPage from '../AutomacoesPage';
import { TOUR_STEPS } from '../tour/tourSteps';
import { tourSeenKey } from '../tour/useAutomationTour';

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
    dm_buttons: [
      { title: 'Agendar', url: 'https://agenda.x' },
      { title: 'Site', url: 'https://site.x' },
    ],
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
    dm_kind: 'buttons_fallback_text' as const,
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
    localStorage.clear();
    hasFeatureMock.mockReturnValue(true);
    mockGetAutomations.mockResolvedValue(AUTOMATIONS);
    mockGetClientes.mockResolvedValue(CLIENTES);
    mockGetSends.mockResolvedValue(SENDS);
    mockUpdate.mockResolvedValue(undefined);
    mockDelete.mockResolvedValue(undefined);
    entitlementsMock.mockReturnValue({ isLoading: false, hasFeature: () => true });
    mockHasReadyAccount.mockResolvedValue(false);
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
    // chip de botões (t serializa vars: chave + JSON)
    expect(screen.getByText('table.buttonsCount:{"count":2}')).toBeInTheDocument();
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
    // dm_kind='buttons_fallback_text' ganha o badge "enviado como texto"
    expect(screen.getByText('sendStatus.buttons_fallback_text')).toBeInTheDocument();
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

  describe('gate de página (flag off)', () => {
    beforeEach(() => {
      entitlementsMock.mockReturnValue({
        isLoading: false,
        hasFeature: (f: string) => f !== 'feature_instagram_automation',
      });
    });

    it('0 automações (sucesso) → paywall com pitch', async () => {
      mockGetAutomations.mockResolvedValue([]);
      renderPage();
      expect(await screen.findByTestId('upgrade-locked-screen')).toBeInTheDocument();
      expect(screen.getByText('locked.pitch')).toBeInTheDocument();
    });

    it('query em erro → estado de erro com retry, NUNCA paywall', async () => {
      mockGetAutomations.mockRejectedValue(new Error('boom'));
      renderPage();
      expect(await screen.findByText('loadError')).toBeInTheDocument();
      expect(screen.queryByTestId('upgrade-locked-screen')).not.toBeInTheDocument();
    });

    it('automações legadas → página normal, sem paywall', async () => {
      mockGetAutomations.mockResolvedValue(AUTOMATIONS);
      renderPage();
      expect(await screen.findByText('title')).toBeInTheDocument();
      expect(screen.queryByTestId('upgrade-locked-screen')).not.toBeInTheDocument();
    });

    it('query ainda pendente → spinner, NUNCA paywall', async () => {
      mockGetAutomations.mockReturnValue(new Promise(() => {}));
      const { container } = renderPage();

      await waitFor(() => {
        expect(container.querySelector('.animate-spin')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('upgrade-locked-screen')).not.toBeInTheDocument();
    });
  });

  describe('checklist', () => {
    it('aparece com passos incompletos e some ao dispensar (persistido por workspace)', async () => {
      mockGetAutomations.mockResolvedValue([]);
      mockHasReadyAccount.mockResolvedValue(true);
      renderPage(); // flag ON (default)
      expect(await screen.findByTestId('automacoes-checklist')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'checklist.dismiss' }));
      expect(screen.queryByTestId('automacoes-checklist')).not.toBeInTheDocument();
      expect(localStorage.getItem('automacoes_checklist_dismissed:w-1')).toBe('1');
    });

    it('não aparece enquanto a query de automações nunca resolve (nenhum dos dois sinais pronto)', async () => {
      mockGetAutomations.mockReturnValue(new Promise(() => {}));
      renderPage();

      // Ponto estável pós-primeira-renderização: título sempre aparece na
      // página normal (flag ON), independente do estado das queries de
      // sinal -- sem isso o assert abaixo passaria trivialmente mesmo que a
      // guarda `isSuccess && isSuccess` não existisse.
      await screen.findByText('title');
      expect(screen.queryByTestId('automacoes-checklist')).not.toBeInTheDocument();
    });

    it('não aparece com automações resolvidas mas o sinal de conta pronta ainda pendente', async () => {
      mockGetAutomations.mockResolvedValue([]);
      mockHasReadyAccount.mockReturnValue(new Promise(() => {}));
      renderPage();

      // Aguarda a query de automações assentar (isSuccess) antes de
      // verificar -- caso genuinamente independente do anterior, onde
      // ambos os sinais ficavam pendentes ao mesmo tempo.
      expect(await screen.findByText('emptyNone')).toBeInTheDocument();
      expect(screen.queryByTestId('automacoes-checklist')).not.toBeInTheDocument();
    });
  });

  describe('tour guiado', () => {
    beforeEach(() => {
      mockGetAutomations.mockResolvedValue([]);
      mockGetClientes.mockResolvedValue([]);
      mockHasReadyAccount.mockResolvedValue(true);
    });

    it('auto-inicia no passo 1 na visita elegível e grava a chave', async () => {
      renderPage();
      expect(await screen.findByText('tour.step1Title')).toBeInTheDocument();
      expect(localStorage.getItem(tourSeenKey('w-1'))).toBe('1');
    });

    it('não auto-inicia com a chave gravada', async () => {
      localStorage.setItem(tourSeenKey('w-1'), '1');
      renderPage();
      // Espera a página assentar (checklist visível) antes do assert negativo.
      expect(await screen.findByTestId('automacoes-checklist')).toBeInTheDocument();
      expect(screen.queryByText('tour.step1Title')).not.toBeInTheDocument();
    });

    it('não auto-inicia com automações existentes', async () => {
      mockGetAutomations.mockResolvedValue(AUTOMATIONS);
      renderPage();
      expect(await screen.findByText('Promo de agosto')).toBeInTheDocument();
      expect(screen.queryByText('tour.step1Title')).not.toBeInTheDocument();
    });

    it('agente não vê o tour', async () => {
      setAuth({ role: 'agent', profile: { id: 'user-1', conta_id: 'w-1', role: 'agent' } });
      renderPage();
      expect(await screen.findByTestId('automacoes-checklist')).toBeInTheDocument();
      expect(screen.queryByText('tour.step1Title')).not.toBeInTheDocument();
    });

    it('CTA do passo 1 abre o dialog e avança para o passo 2', async () => {
      renderPage();
      fireEvent.click(await screen.findByText('tour.step1Cta'));
      const dialog = await screen.findByTestId('automation-dialog');
      expect(dialog).toHaveAttribute('data-tour-step', TOUR_STEPS[1].id);
      expect(screen.queryByText('tour.step1Title')).not.toBeInTheDocument();
    });

    it('salvar com sucesso (onSaved) encerra o tour', async () => {
      renderPage();
      fireEvent.click(await screen.findByText('tour.step1Cta'));
      fireEvent.click(await screen.findByText('salvar-mock'));
      await waitFor(() =>
        expect(screen.queryByTestId('automation-dialog')).not.toBeInTheDocument(),
      );
      // Reabrir pelo botão da página: o tour NÃO volta.
      fireEvent.click(screen.getByRole('button', { name: /newAutomation/ }));
      expect(screen.getByTestId('automation-dialog')).toHaveAttribute('data-tour-step', '');
    });

    it('link da checklist reinicia o tour mesmo com a chave gravada', async () => {
      localStorage.setItem(tourSeenKey('w-1'), '1');
      renderPage();
      fireEvent.click(await screen.findByText('checklist.seeTour'));
      expect(await screen.findByText('tour.step1Title')).toBeInTheDocument();
    });
  });
});

import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeCan, fakeMembership } from '@/test/makeCan';
import { installPointerEvent } from '@/components/mobile/__tests__/pointer';

// No useIsDesktop mock: jsdom's matchMedia reports false, so the page renders its
// phone branch (below 768). The 768-900 card list is AutomacoesPage.test.tsx.

const {
  mockGetAutomations,
  mockGetClientes,
  mockGetSends,
  mockUpdate,
  mockDelete,
  mockUseAuth,
  mockHasReadyAccount,
  entitlementsMock,
  mockGetContactCounts,
  mockCountContacts,
  hasFeatureMock,
} = vi.hoisted(() => ({
  mockGetAutomations: vi.fn(),
  mockGetClientes: vi.fn(),
  mockGetSends: vi.fn(),
  mockUpdate: vi.fn(),
  mockDelete: vi.fn(),
  mockUseAuth: vi.fn(),
  mockHasReadyAccount: vi.fn(),
  entitlementsMock: vi.fn(),
  mockGetContactCounts: vi.fn(),
  mockCountContacts: vi.fn(),
  hasFeatureMock: vi.fn(() => true),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

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
    getContactCounts: mockGetContactCounts,
    countInstagramContacts: mockCountContacts,
  };
});

vi.mock('../contacts/ContactsTab', () => ({
  ContactsTab: () => <div data-testid="contacts-tab" />,
}));
vi.mock('../../../context/AuthContext', () => ({ useAuth: mockUseAuth }));
vi.mock('../../../services/automationMedia', () => ({
  deleteAutomationMedia: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../hooks/useEntitlements', () => ({
  useEntitlements: () => entitlementsMock(),
}));
vi.mock('@/components/paywall/FeatureGate', () => ({
  FeatureGate: ({ flag, children }: { flag: string; children: ReactNode }) =>
    hasFeatureMock(flag) ? <>{children}</> : <p data-testid="feature-gate-locked" />,
}));
// The real shell actions need the KB query and notifications; their suites cover them.
vi.mock('@/components/layout/PhoneShellHeader', () => ({
  PhoneShellActions: () => <div data-testid="shell-actions" />,
}));
vi.mock('../AutomationFormDialog', () => ({
  default: ({
    open,
    editing,
    initialTab,
  }: {
    open: boolean;
    editing: { id: string } | null;
    initialTab?: string;
  }) =>
    open ? (
      <div
        data-testid="automation-dialog"
        data-editing={editing?.id ?? ''}
        data-initial-tab={initialTab ?? ''}
      />
    ) : null,
}));

import AutomacoesPage from '../AutomacoesPage';

const AUTOMATION = {
  id: 'auto-1',
  conta_id: 'w-1',
  client_id: 14,
  name: 'Promo de agosto',
  ig_media_id: null,
  media_permalink: null,
  media_caption: null,
  workflow_post_id: null,
  pending_post_deleted_at: null,
  target_unlinked_at: null,
  keywords: ['preco', 'valor'],
  dm_message: 'Segue o link!',
  dm_buttons: [
    { title: 'Agendar', url: 'https://agenda.x' },
    { title: 'Site', url: 'https://site.x' },
  ],
  dm_media: null,
  public_reply: null,
  public_replies: [],
  ativo: true,
  dms_sent_count: 12,
  last_triggered_at: '2026-08-10T12:00:00.000Z',
  created_at: '2026-08-01T09:00:00.000Z',
  updated_at: '2026-08-01T09:00:00.000Z',
};

const AUTOMATION_UNLINKED = {
  ...AUTOMATION,
  id: 'auto-unlinked',
  name: 'Story de sábado',
  keywords: ['evento'],
  dm_buttons: [],
  media_caption: 'Chamada para o evento',
  workflow_post_id: 4038,
  target_unlinked_at: '2026-08-31T23:55:44.000Z',
  ativo: false,
  dms_sent_count: 0,
  last_triggered_at: null,
};

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
    dm_kind: 'text' as const,
    public_reply_status: null,
    attempts: 1,
    created_at: '2026-08-10T11:00:05.000Z',
  },
];

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname + location.search}</span>;
}

function renderPage(url = '/automacoes') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <AutomacoesPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const rowMain = async (name = 'Promo de agosto') =>
  (await screen.findByText(name)).closest('button.phone-auto-row__main') as HTMLElement;

beforeAll(installPointerEvent);

describe('AutomacoesPage on phones', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    hasFeatureMock.mockReturnValue(true);
    mockGetAutomations.mockResolvedValue([AUTOMATION]);
    mockGetClientes.mockResolvedValue([{ id: 14, nome: 'ACME', sigla: 'AC', cor: '#3ecf8e' }]);
    mockGetSends.mockResolvedValue(SENDS);
    mockUpdate.mockResolvedValue(undefined);
    mockDelete.mockResolvedValue(undefined);
    entitlementsMock.mockReturnValue({ isLoading: false, hasFeature: () => true });
    mockHasReadyAccount.mockResolvedValue(false);
    mockGetContactCounts.mockResolvedValue([]);
    mockCountContacts.mockResolvedValue(0);
    mockUseAuth.mockReturnValue({
      role: 'owner',
      profile: { id: 'user-1', conta_id: 'w-1', role: 'owner' },
      can: makeCan(fakeMembership({ role: 'owner' })),
    });
  });

  it('renders the phone page header (title, active count, gated "+"), never the desktop .header', async () => {
    const { container } = renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'title' })).toHaveClass(
      'phone-large-title__title',
    );
    expect(await screen.findByText('phone.activeCount:{"count":1}')).toBeInTheDocument();
    const plus = screen.getByRole('button', { name: 'newAutomation' });
    expect(plus).toHaveAttribute('data-tour', 'nova-automacao');
    expect(container.querySelector('.header')).toBeNull();
    // The tie-break hint is visible text, not a tooltip.
    expect(screen.getByText('tiebreakHint')).toBeInTheDocument();
  });

  it('opens the form from the "+"', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'newAutomation' }));
    expect(screen.getByTestId('automation-dialog')).toHaveAttribute('data-editing', '');
  });

  it('shows the FeatureGate nudge instead of the "+" when the plan lacks the feature', async () => {
    entitlementsMock.mockReturnValue({ isLoading: false, hasFeature: () => false });
    hasFeatureMock.mockReturnValue(false);
    renderPage();
    expect(await screen.findByText('Promo de agosto')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'newAutomation' })).toBeNull();
    expect(screen.getByTestId('feature-gate-locked')).toBeInTheDocument();
  });

  it('switches Automações / Contatos with a segmented tablist', async () => {
    renderPage();
    const tabs = await screen.findByRole('tablist', { name: 'phone.sectionsAria' });
    fireEvent.click(within(tabs).getByRole('tab', { name: 'contacts.tabContacts' }));
    expect(await screen.findByTestId('contacts-tab')).toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).toContainElement(screen.getByTestId('contacts-tab'));
  });

  it('renders a row with cliente · target, keyword pills, buttons count and counters', async () => {
    renderPage();
    const row = await rowMain();
    expect(within(row).getByText('ACME · allPosts')).toBeInTheDocument();
    expect(within(row).getByText('preco')).toBeInTheDocument();
    expect(within(row).getByText('table.buttonsCount:{"count":2}')).toBeInTheDocument();
    expect(within(row).getByText(/table\.dmsSent: 12 · 10\/08\/2026/)).toBeInTheDocument();
  });

  it('shows the unlinked target state as a visible pill', async () => {
    mockGetAutomations.mockResolvedValue([AUTOMATION_UNLINKED]);
    renderPage();
    const row = await rowMain('Story de sábado');
    expect(within(row).getByText('unlinkedTargetBadge')).toBeInTheDocument();
    expect(within(row).getByText(/neverTriggered/)).toBeInTheDocument();
  });

  it('the switch toggles ativo with the same mutation as desktop', async () => {
    renderPage();
    const toggle = await screen.findByRole('switch', { name: 'switchDeactivate' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(toggle);
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith('auto-1', { ativo: false }));
    // Toggling never opens the detail sheet.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('swipe Excluir asks in an action sheet and deletes on confirm', async () => {
    renderPage();
    await rowMain();
    const swipeDelete = document.querySelector(
      '.phone-swipe-row__action--destructive',
    ) as HTMLElement;
    fireEvent.click(swipeDelete);
    const sheet = await screen.findByRole('dialog', {
      name: 'deleteTitle:{"name":"Promo de agosto"}',
    });
    expect(within(sheet).getByText('deleteDescription')).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'delete' }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('auto-1'));
  });

  it('cancelling the delete sheet deletes nothing', async () => {
    renderPage();
    await rowMain();
    fireEvent.click(document.querySelector('.phone-swipe-row__action--destructive')!);
    const sheet = await screen.findByRole('dialog', {
      name: 'deleteTitle:{"name":"Promo de agosto"}',
    });
    fireEvent.click(within(sheet).getByRole('button', { name: 'cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('swipe Editar opens the form on that automation', async () => {
    renderPage();
    await rowMain();
    fireEvent.click(document.querySelector('.phone-swipe-row__action--neutral')!);
    expect(screen.getByTestId('automation-dialog')).toHaveAttribute('data-editing', 'auto-1');
  });

  it('long-press menu (right-click path) offers Editar, the re-target action and Excluir', async () => {
    mockGetAutomations.mockResolvedValue([AUTOMATION_UNLINKED]);
    renderPage();
    fireEvent.contextMenu(await rowMain('Story de sábado'));
    const menu = await screen.findByRole('menu', {
      name: 'rowActions:{"name":"Story de sábado"}',
    });
    const items = within(menu)
      .getAllByRole('menuitem')
      .map((i) => i.textContent);
    expect(items).toEqual(['edit', 'unlinkedTargetAction', 'delete']);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'unlinkedTargetAction' }));
    const dialog = await screen.findByTestId('automation-dialog');
    expect(dialog).toHaveAttribute('data-editing', 'auto-unlinked');
    expect(dialog).toHaveAttribute('data-initial-tab', 'published');
  });

  it('tapping a row opens the detail sheet with target, keywords, buttons and the sends log', async () => {
    renderPage();
    fireEvent.click(await rowMain());
    const sheet = await screen.findByRole('dialog', { name: 'Promo de agosto' });
    expect(within(sheet).getByText('allPosts')).toBeInTheDocument();
    expect(within(sheet).getByText('valor')).toBeInTheDocument();
    expect(within(sheet).getByText('Agendar')).toBeInTheDocument();
    expect(within(sheet).getByText('https://site.x')).toBeInTheDocument();
    expect(await within(sheet).findByText('@fulano')).toBeInTheDocument();
    expect(within(sheet).getByText('sendStatus.sent')).toBeInTheDocument();
    expect(mockGetSends).toHaveBeenCalledWith('auto-1');
  });

  it('the detail sheet shows the unlinked hint as text and re-targets', async () => {
    mockGetAutomations.mockResolvedValue([AUTOMATION_UNLINKED]);
    renderPage();
    fireEvent.click(await rowMain('Story de sábado'));
    const sheet = await screen.findByRole('dialog', { name: 'Story de sábado' });
    expect(within(sheet).getByText('unlinkedTargetHint')).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'unlinkedTargetAction' }));
    expect(await screen.findByTestId('automation-dialog')).toHaveAttribute(
      'data-initial-tab',
      'published',
    );
  });

  it('hides the re-target action without automacoes:editar', async () => {
    mockGetAutomations.mockResolvedValue([AUTOMATION_UNLINKED]);
    mockUseAuth.mockReturnValue({
      role: 'agent',
      profile: { id: 'user-1', conta_id: 'w-1', role: 'agent' },
      can: () => false,
    });
    renderPage();
    fireEvent.click(await rowMain('Story de sábado'));
    const sheet = await screen.findByRole('dialog', { name: 'Story de sábado' });
    expect(within(sheet).getByText('unlinkedTargetHint')).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'unlinkedTargetAction' })).toBeNull();
  });

  it('detail sheet Editar and Excluir reuse the page handlers', async () => {
    renderPage();
    fireEvent.click(await rowMain());
    let sheet = await screen.findByRole('dialog', { name: 'Promo de agosto' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'edit' }));
    expect(await screen.findByTestId('automation-dialog')).toHaveAttribute(
      'data-editing',
      'auto-1',
    );

    fireEvent.click(await rowMain());
    sheet = await screen.findByRole('dialog', { name: 'Promo de agosto' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'delete' }));
    const confirm = await screen.findByRole('dialog', {
      name: 'deleteTitle:{"name":"Promo de agosto"}',
    });
    fireEvent.click(within(confirm).getByRole('button', { name: 'delete' }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('auto-1'));
  });

  it('"Ver contatos" in the sheet switches to Contatos filtered like the desktop link', async () => {
    mockGetContactCounts.mockResolvedValue([
      {
        automation_id: 'auto-1',
        automation_name: 'Promo de agosto',
        client_id: 14,
        automation_deleted: false,
        reached_count: 3,
        total_count: 4,
      },
    ]);
    renderPage();
    fireEvent.click(await rowMain());
    const sheet = await screen.findByRole('dialog', { name: 'Promo de agosto' });
    fireEvent.click(
      await within(sheet).findByRole('button', { name: 'contacts.viewContacts:{"count":3}' }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/automacoes?aba=contatos&cliente=14&automacao=auto-1',
      ),
    );
    expect(await screen.findByTestId('contacts-tab')).toBeInTheDocument();
  });

  it('filters by cliente through the chip and its picker sheet', async () => {
    mockGetAutomations.mockResolvedValue([AUTOMATION, { ...AUTOMATION_UNLINKED, client_id: 15 }]);
    mockGetClientes.mockResolvedValue([
      { id: 14, nome: 'ACME' },
      { id: 15, nome: 'Beta' },
    ]);
    renderPage();
    await rowMain();
    fireEvent.click(
      screen.getByRole('button', { name: 'phone.clientChip:{"name":"phone.allShort"}' }),
    );
    const picker = await screen.findByRole('dialog', { name: 'filterByClient' });
    fireEvent.click(within(picker).getByRole('button', { name: 'Beta' }));
    await waitFor(() => expect(screen.queryByText('Promo de agosto')).toBeNull());
    expect(screen.getByText('Story de sábado')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'phone.clientChip:{"name":"Beta"}' }),
    ).toBeInTheDocument();
  });
});

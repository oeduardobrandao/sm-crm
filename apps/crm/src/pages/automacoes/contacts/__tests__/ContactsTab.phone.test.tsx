import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// No useIsDesktop mock: jsdom's matchMedia reports false, so the tab renders its phone
// layout (below 768). The desktop table is ContactsTab.test.tsx.

const { mockList, mockCounts, mockClientes, mockExport } = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockCounts: vi.fn(),
  mockClientes: vi.fn(),
  mockExport: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
    i18n: { language: 'pt' },
  }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../contactsCsv', () => ({ exportContactsCsv: mockExport }));
vi.mock('../../../../store', async () => {
  const actual = await vi.importActual<typeof import('../../../../store')>('../../../../store');
  return {
    ...actual,
    listInstagramContacts: mockList,
    getContactCounts: mockCounts,
    getClientes: mockClientes,
  };
});

import { ContactsTab } from '../ContactsTab';

const ROW = {
  id: 'c1',
  client_id: 14,
  commenter_username: 'ana',
  first_interaction_at: '2026-10-01T10:00:00Z',
  last_interaction_at: '2026-10-02T10:00:00Z',
  interactions_count: 2,
  reached: true,
  last_comment_text: 'quero',
  automation_id: 'a1',
  automation_name: 'Promo',
  automation_deleted: false,
  created_at: '2026-10-01T10:00:00Z',
};

function renderTab(url = '/automacoes?aba=contatos') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <ContactsTab />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ContactsTab on phones', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClientes.mockResolvedValue([{ id: 14, nome: 'ACME' }]);
    mockCounts.mockResolvedValue([
      {
        automation_id: 'a1',
        automation_name: 'Promo',
        client_id: 14,
        automation_deleted: false,
        reached_count: 1,
        total_count: 1,
      },
    ]);
    mockList.mockResolvedValue({ rows: [ROW], total: 1 });
  });

  it('lists contacts as grouped rows with the profile link, cliente · automação and paging', async () => {
    renderTab();
    const link = await screen.findByRole('link', { name: '@ana' });
    expect(link).toHaveAttribute('href', 'https://instagram.com/ana');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    const list = screen.getByRole('list', { name: 'contacts.tabContacts' });
    expect(within(list).getByText('ACME · Promo')).toBeInTheDocument();
    expect(within(list).getByText('contacts.col.reached: contacts.yes')).toBeInTheDocument();
    expect(screen.getByText('contacts.showing:{"from":1,"to":1,"total":1}')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'contacts.next' })).toBeDisabled();
    // No desktop table on phones.
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('opens a filters sheet whose period picker shows a single month', async () => {
    renderTab();
    await screen.findByRole('link', { name: '@ana' });
    fireEvent.click(screen.getByRole('button', { name: 'phone.filters' }));
    const sheet = await screen.findByRole('dialog', { name: 'phone.filters' });
    expect(
      within(sheet).getByRole('button', { name: /contacts\.filterClient/ }),
    ).toBeInTheDocument();
    expect(
      within(sheet).getByRole('button', { name: /contacts\.filterAutomation/ }),
    ).toBeInTheDocument();
    expect(within(sheet).getByRole('switch', { name: 'contacts.reachedOnly' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    fireEvent.click(within(sheet).getByRole('button', { name: /contacts\.filterPeriod/ }));
    // numberOfMonths={1}: one month grid, not the desktop's two side by side.
    expect(await screen.findAllByRole('grid')).toHaveLength(1);
  });

  it('applies filters from the sheet to the store query', async () => {
    renderTab();
    await screen.findByRole('link', { name: '@ana' });
    fireEvent.click(screen.getByRole('button', { name: 'phone.filters' }));
    const sheet = await screen.findByRole('dialog', { name: 'phone.filters' });
    fireEvent.click(within(sheet).getByRole('switch', { name: 'contacts.reachedOnly' }));
    await waitFor(() =>
      expect(mockList).toHaveBeenLastCalledWith(expect.objectContaining({ reachedOnly: false }), 1),
    );

    fireEvent.click(within(sheet).getByRole('button', { name: /contacts\.filterClient/ }));
    const picker = await screen.findByRole('dialog', { name: 'contacts.filterClient' });
    fireEvent.click(within(picker).getByRole('button', { name: 'ACME' }));
    await waitFor(() =>
      expect(mockList).toHaveBeenLastCalledWith(expect.objectContaining({ clientId: 14 }), 1),
    );
  });

  it('shows active filters as removable chips', async () => {
    renderTab('/automacoes?aba=contatos&cliente=14&todos=1');
    await screen.findByRole('link', { name: '@ana' });
    expect(screen.getByRole('button', { name: 'phone.filters' })).toBeInTheDocument();
    const chip = screen.getByRole('button', { name: 'contacts.filterClient: ACME' });
    fireEvent.click(chip);
    await waitFor(() =>
      expect(mockList).toHaveBeenLastCalledWith(expect.objectContaining({ clientId: null }), 1),
    );
  });

  it('searches with the toolbar field (debounced, like desktop)', async () => {
    renderTab();
    await screen.findByRole('link', { name: '@ana' });
    fireEvent.change(screen.getByRole('searchbox', { name: 'contacts.searchPlaceholder' }), {
      target: { value: 'ana' },
    });
    await waitFor(() =>
      expect(mockList).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'ana' }), 1),
    );
  });

  it('exports CSV from the "…" action sheet with the active filters', async () => {
    mockExport.mockResolvedValue(1);
    renderTab('/automacoes?aba=contatos&cliente=14');
    await screen.findByRole('link', { name: '@ana' });
    fireEvent.click(screen.getByRole('button', { name: 'phone.moreActions' }));
    const sheet = await screen.findByRole('dialog', { name: 'contacts.tabContacts' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'contacts.export' }));
    await waitFor(() =>
      expect(mockExport).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: 14 }),
        expect.any(Map),
        'ACME',
      ),
    );
  });

  it('shows the empty and error states', async () => {
    mockList.mockResolvedValue({ rows: [], total: 0 });
    mockCounts.mockResolvedValue([]);
    const { unmount } = renderTab();
    expect(await screen.findByText('contacts.emptyNone')).toBeInTheDocument();
    unmount();

    mockList.mockRejectedValue(new Error('boom'));
    renderTab();
    expect(await screen.findByText('contacts.loadError')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'contacts.retry' })).toBeInTheDocument();
  });
});

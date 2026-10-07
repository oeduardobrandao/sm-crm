import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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
vi.mock('../../../../hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));
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
  automation_deleted: true,
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

describe('ContactsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClientes.mockResolvedValue([{ id: 14, nome: 'ACME' }]);
    mockCounts.mockResolvedValue([
      {
        automation_id: 'a1',
        automation_name: 'Promo',
        client_id: 14,
        automation_deleted: true,
        reached_count: 1,
        total_count: 1,
      },
    ]);
  });

  it('lists contacts with link, client, removed automation and paging text', async () => {
    mockList.mockResolvedValue({ rows: [ROW], total: 1 });
    renderTab();
    const link = await screen.findByRole('link', { name: '@ana' });
    expect(link).toHaveAttribute('href', 'https://instagram.com/ana');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText('ACME', { selector: 'td' })).toBeInTheDocument();
    expect(screen.getByText('contacts.removed:{"name":"Promo"}')).toBeInTheDocument();
    expect(screen.getByText('contacts.showing:{"from":1,"to":1,"total":1}')).toBeInTheDocument();
  });

  it('passes URL filters to the store (deep link)', async () => {
    mockList.mockResolvedValue({ rows: [], total: 0 });
    renderTab('/automacoes?aba=contatos&cliente=14&automacao=a1&todos=1');
    await waitFor(() =>
      expect(mockList).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: 14, automationId: 'a1', reachedOnly: false }),
        1,
      ),
    );
  });

  it('shows the none-yet empty state with no contacts at all, filtered state otherwise', async () => {
    mockCounts.mockResolvedValue([]);
    mockList.mockResolvedValue({ rows: [], total: 0 });
    renderTab();
    expect(await screen.findByText('contacts.emptyNone')).toBeInTheDocument();
  });

  it('shows the error state with retry', async () => {
    mockList.mockRejectedValue(new Error('boom'));
    renderTab();
    expect(await screen.findByText('contacts.loadError')).toBeInTheDocument();
  });

  it('exports with the active filters', async () => {
    mockList.mockResolvedValue({ rows: [ROW], total: 1 });
    mockExport.mockResolvedValue(1);
    renderTab('/automacoes?aba=contatos&cliente=14');
    await screen.findByRole('link', { name: '@ana' });
    fireEvent.click(screen.getByRole('button', { name: 'contacts.export' }));
    await waitFor(() =>
      expect(mockExport).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: 14 }),
        expect.any(Map),
        'ACME',
      ),
    );
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { mockList, mockCounts, mockCan, mockExport } = vi.hoisted(() => ({
  mockExport: vi.fn(),
  mockList: vi.fn(),
  mockCounts: vi.fn(),
  mockCan: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
    i18n: { language: 'pt' },
  }),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ can: mockCan }) }));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));
vi.mock('@/store', async () => {
  const actual = await vi.importActual<typeof import('@/store')>('@/store');
  return { ...actual, listInstagramContacts: mockList, getContactCounts: mockCounts };
});

vi.mock('../../../automacoes/contacts/contactsCsv', () => ({ exportContactsCsv: mockExport }));

import { AutomationContactsSection } from '../AutomationContactsSection';

const ROW = {
  id: 'c1',
  client_id: 14,
  commenter_username: 'ana',
  first_interaction_at: '2026-10-01T10:00:00Z',
  last_interaction_at: '2026-10-02T10:00:00Z',
  interactions_count: 1,
  reached: true,
  last_comment_text: null,
  automation_id: 'a1',
  automation_name: 'Promo',
  automation_deleted: false,
  created_at: '2026-10-01T10:00:00Z',
};

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AutomationContactsSection clienteId={14} clienteNome="ACME" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const COUNT_14 = {
  automation_id: 'a1',
  automation_name: 'Promo',
  client_id: 14,
  automation_deleted: false,
  reached_count: 1,
  total_count: 1,
};

describe('AutomationContactsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCan.mockReturnValue(true);
    mockList.mockResolvedValue({ rows: [ROW], total: 1 });
    mockCounts.mockResolvedValue([COUNT_14]);
  });

  it('renders the 10 latest reached contacts with Ver todos', async () => {
    renderSection();
    expect(await screen.findByText('contacts.sectionTitle')).toBeInTheDocument();
    await waitFor(() =>
      expect(mockList).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: 14, reachedOnly: true }),
        1,
        10,
      ),
    );
    expect(await screen.findByRole('link', { name: '@ana' })).toHaveAttribute(
      'href',
      'https://instagram.com/ana',
    );
    expect(screen.getByRole('link', { name: 'contacts.viewAll' })).toHaveAttribute(
      'href',
      '/automacoes?aba=contatos&cliente=14',
    );
  });

  it('is hidden when the client has no contacts', async () => {
    mockCounts.mockResolvedValue([{ ...COUNT_14, automation_id: 'a9', client_id: 99 }]);
    const { container } = renderSection();
    await waitFor(() => expect(mockCounts).toHaveBeenCalled());
    // let the counts query resolve and the component re-render
    await act(async () => {
      await mockCounts.mock.results[0].value;
    });
    expect(container).toBeEmptyDOMElement();
    expect(mockList).not.toHaveBeenCalled();
  });

  it('is hidden without automacoes:ver (including unknown)', async () => {
    mockCan.mockReturnValue('unknown');
    const { container } = renderSection();
    expect(container).toBeEmptyDOMElement();
    expect(mockCounts).not.toHaveBeenCalled();
  });

  it('shows the none-reached copy when contacts exist but none was reached', async () => {
    mockList.mockResolvedValue({ rows: [], total: 0 });
    renderSection();
    expect(await screen.findByText('contacts.emptyNoneReached')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'contacts.viewAll' })).toBeInTheDocument();
  });

  it('shows the load error, not the empty copy, when the list fails', async () => {
    mockList.mockRejectedValue(new Error('boom'));
    renderSection();
    expect(await screen.findByText('contacts.loadError')).toBeInTheDocument();
    expect(screen.queryByText('contacts.emptyNoneReached')).not.toBeInTheDocument();
  });

  it('exports with the client filter and name, disabling the button meanwhile', async () => {
    let finish!: (n: number) => void;
    mockExport.mockReturnValue(new Promise<number>((res) => (finish = res)));
    renderSection();
    const btn = await screen.findByRole('button', { name: 'contacts.export' });
    await waitFor(() => expect(btn).toBeEnabled());
    await userEvent.click(btn);

    expect(mockExport).toHaveBeenCalledTimes(1);
    const [filters, byId, nome] = mockExport.mock.calls[0];
    expect(filters).toEqual(expect.objectContaining({ clientId: 14, reachedOnly: true }));
    expect(byId.get(14)).toBe('ACME');
    expect(nome).toBe('ACME');

    const busy = await screen.findByRole('button', { name: 'contacts.exporting' });
    expect(busy).toBeDisabled();
    await act(async () => finish(1));
    expect(await screen.findByRole('button', { name: 'contacts.export' })).toBeEnabled();
  });
});

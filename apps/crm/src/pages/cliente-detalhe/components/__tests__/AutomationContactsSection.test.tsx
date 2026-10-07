import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { mockList, mockCounts, mockCan } = vi.hoisted(() => ({
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

describe('AutomationContactsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCan.mockReturnValue(true);
    mockList.mockResolvedValue({ rows: [ROW], total: 1 });
  });

  it('renders the 10 latest reached contacts with Ver todos', async () => {
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
    renderSection();
    expect(await screen.findByText('contacts.sectionTitle')).toBeInTheDocument();
    await waitFor(() =>
      expect(mockList).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: 14, reachedOnly: true }),
        1,
        10,
      ),
    );
    expect(screen.getByRole('link', { name: 'contacts.viewAll' })).toHaveAttribute(
      'href',
      '/automacoes?aba=contatos&cliente=14',
    );
  });

  it('is hidden when the client has no contacts', async () => {
    mockCounts.mockResolvedValue([
      {
        automation_id: 'a9',
        automation_name: 'X',
        client_id: 99,
        automation_deleted: false,
        reached_count: 1,
        total_count: 1,
      },
    ]);
    const { container } = renderSection();
    await waitFor(() => expect(mockCounts).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('is hidden without automacoes:ver (including unknown)', async () => {
    mockCan.mockReturnValue('unknown');
    const { container } = renderSection();
    expect(container).toBeEmptyDOMElement();
    expect(mockCounts).not.toHaveBeenCalled();
  });
});

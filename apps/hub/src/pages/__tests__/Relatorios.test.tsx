import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { HubContext } from '../../HubContext';

vi.mock('../../api', () => ({
  fetchReportList: vi.fn(),
  fetchReportPdfUrl: vi.fn(),
}));

import { fetchReportList, type HubReportListItem } from '../../api';
import { RelatoriosPage } from '../Relatorios';

const mockedFetchReportList = vi.mocked(fetchReportList);

const hubValue = {
  bootstrap: {
    workspace: {
      name: 'Mesaas',
      logo_url: 'https://cdn.mesaas.com/logo.png',
      brand_color: '#0f766e',
    },
    cliente_nome: 'Clínica Aurora',
    is_active: true,
    cliente_id: 14,
    feature_mensagens: true,
  },
  token: 'token-publico',
  workspace: 'mesaas',
} as never;

function PathProbe() {
  const location = useLocation();
  return <div data-testid="current-path">{location.pathname}</div>;
}

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderRelatorios() {
  const queryClient = createQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <HubContext.Provider value={hubValue}>
        <MemoryRouter initialEntries={['/mesaas/hub/token-publico/relatorios']}>
          <Routes>
            <Route
              path="/:workspace/hub/:token/relatorios"
              element={
                <>
                  <RelatoriosPage />
                  <PathProbe />
                </>
              }
            />
            <Route path="*" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </HubContext.Provider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.clearAllMocks());

describe('RelatoriosPage', () => {
  it('renders a doc card with title, formatted month and navigates to the doc viewer on "Abrir"', async () => {
    const items: HubReportListItem[] = [
      {
        kind: 'doc',
        id: 'doc-1',
        title: 'Relatório de Julho',
        month: '2026-07',
        generated_at: '2026-08-01T10:00:00.000Z',
      },
    ];
    mockedFetchReportList.mockResolvedValue({ items } as never);

    renderRelatorios();

    expect(await screen.findByText('Relatório de Julho')).toBeInTheDocument();
    expect(screen.getByText('Julho de 2026')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));

    expect(screen.getByTestId('current-path')).toHaveTextContent(
      '/mesaas/hub/token-publico/relatorios/doc/doc-1',
    );
  });

  it('keeps the legacy report card with "Ver online" and "Baixar PDF"', async () => {
    const items: HubReportListItem[] = [
      {
        kind: 'legacy',
        month: '2026-06',
        status: 'ready',
        generated_at: '2026-07-01T10:00:00.000Z',
        has_pdf: true,
        has_html: true,
      },
    ];
    mockedFetchReportList.mockResolvedValue({ items } as never);

    renderRelatorios();

    expect(await screen.findByText('Junho de 2026')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ver online/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Baixar PDF/ })).toBeInTheDocument();
  });

  it('shows the empty state text when the list is empty', async () => {
    mockedFetchReportList.mockResolvedValue({ items: [] } as never);

    renderRelatorios();

    expect(await screen.findByText('Nenhum relatório disponível ainda.')).toBeInTheDocument();
  });
});

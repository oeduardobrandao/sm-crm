import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { HubContext } from '../../HubContext';
import { makeSnapshotFixture } from '@mesaas/report-blocks/fixtures';
import type { ReportLayout } from '@mesaas/report-blocks/types';

vi.mock('../../api', () => ({ fetchReportDoc: vi.fn() }));

import { fetchReportDoc } from '../../api';
import { RelatorioDocPage } from '../RelatorioDocPage';

const mockedFetchReportDoc = vi.mocked(fetchReportDoc);

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

function renderDocPage(docId = 'doc-1') {
  const queryClient = createQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <HubContext.Provider value={hubValue}>
        <MemoryRouter initialEntries={[`/mesaas/hub/token-publico/relatorios/doc/${docId}`]}>
          <Routes>
            <Route
              path="/:workspace/hub/:token/relatorios/doc/:docId"
              element={
                <>
                  <RelatorioDocPage />
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

const layout: ReportLayout = {
  version: 1,
  blocks: [{ id: 'b1', type: 'cover', size: 'full' }],
};

afterEach(() => vi.clearAllMocks());

describe('RelatorioDocPage', () => {
  it('shows a loading spinner while the doc is pending', () => {
    mockedFetchReportDoc.mockImplementation(() => new Promise(() => {}));

    const { container } = renderDocPage();

    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });

  it('renders the title and the block renderer grid in view mode on success', async () => {
    mockedFetchReportDoc.mockResolvedValue({
      doc: {
        id: 'doc-1',
        title: 'Relatório de Julho',
        layout,
        data_snapshot: makeSnapshotFixture(),
        period_start: '2026-07-01',
      },
    } as never);

    const { container } = renderDocPage();

    expect(await screen.findByText('Relatório de Julho')).toBeInTheDocument();
    expect(container.querySelector('.rb-grid.rb-mode-view')).not.toBeNull();
  });

  it('shows an error message when the doc fails to load', async () => {
    mockedFetchReportDoc.mockRejectedValue(new Error('HTTP 404'));

    renderDocPage();

    expect(await screen.findByText('Erro ao carregar o relatório.')).toBeInTheDocument();
  });

  it('navigates back to the reports list', async () => {
    mockedFetchReportDoc.mockResolvedValue({
      doc: {
        id: 'doc-1',
        title: 'Relatório de Julho',
        layout,
        data_snapshot: makeSnapshotFixture(),
        period_start: '2026-07-01',
      },
    } as never);

    renderDocPage();

    await screen.findByText('Relatório de Julho');

    fireEvent.click(screen.getByRole('button', { name: /Relatórios/ }));

    expect(screen.getByTestId('current-path')).toHaveTextContent(
      '/mesaas/hub/token-publico/relatorios',
    );
  });
});

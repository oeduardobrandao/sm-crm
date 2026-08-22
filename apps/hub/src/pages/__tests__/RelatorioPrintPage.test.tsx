import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { makeSnapshotFixture } from '@mesaas/report-blocks/fixtures';
import type { ReportLayout } from '@mesaas/report-blocks/types';

vi.mock('../../api', () => ({ fetchPrintReportDoc: vi.fn() }));

import { fetchPrintReportDoc } from '../../api';
import { RelatorioPrintPage } from '../RelatorioPrintPage';

const mockedFetchPrintReportDoc = vi.mocked(fetchPrintReportDoc);

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPrintPage(docId = 'doc-1', pt = 'tok-1') {
  const queryClient = createQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/relatorios/print/${docId}?pt=${pt}`]}>
        <Routes>
          <Route path="/relatorios/print/:docId" element={<RelatorioPrintPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const layout: ReportLayout = {
  version: 1,
  blocks: [{ id: 'b1', type: 'cover', size: 'full' }],
};

beforeEach(() => {
  delete (window as { __REPORT_READY?: boolean }).__REPORT_READY;
});

afterEach(() => vi.clearAllMocks());

describe('RelatorioPrintPage', () => {
  it('renders the print grid and marks window.__REPORT_READY after data + fonts + images resolve', async () => {
    mockedFetchPrintReportDoc.mockResolvedValue({
      doc: {
        id: 'doc-1',
        title: 'Relatório de Julho',
        layout,
        data_snapshot: makeSnapshotFixture(),
        period_start: '2026-07-01',
      },
    } as never);

    const { container } = renderPrintPage();

    await waitFor(() => {
      expect(container.querySelector('.rb-grid.rb-mode-print')).not.toBeNull();
    });

    await waitFor(() => {
      expect(window.__REPORT_READY).toBe(true);
    });

    expect(mockedFetchPrintReportDoc).toHaveBeenCalledWith('doc-1', 'tok-1');
  });

  it('never sets window.__REPORT_READY and shows the error message when the fetch fails', async () => {
    mockedFetchPrintReportDoc.mockRejectedValue(new Error('HTTP 404'));

    renderPrintPage();

    // retry: 1 on the query means the error surfaces only after react-query's
    // default ~1s backoff delay, so this needs headroom past the 1s default.
    expect(
      await screen.findByText('Não foi possível carregar o relatório.', {}, { timeout: 3000 }),
    ).toBeInTheDocument();

    expect(window.__REPORT_READY).not.toBe(true);
  });
});

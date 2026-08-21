import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { makeSnapshotFixture } from '@mesaas/report-blocks/fixtures';

const { getReportDocMock } = vi.hoisted(() => ({ getReportDocMock: vi.fn() }));
vi.mock('../../../services/reportDocs', () => ({ getReportDoc: getReportDocMock }));

import RelatorioEditorPage from '../RelatorioEditorPage';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/relatorios/doc-1']}>
        <Routes>
          <Route path="/relatorios/:id" element={<RelatorioEditorPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RelatorioEditorPage', () => {
  it('renderiza título, mês e os blocos do documento', async () => {
    getReportDocMock.mockResolvedValue({
      id: 'doc-1', client_id: 42, title: 'Relatório de Julho de 2026',
      period_start: '2026-07-01', period_end: '2026-08-01',
      layout: { version: 1, blocks: [{ id: 'b1', type: 'cover', size: 'full' }] },
      data_snapshot: makeSnapshotFixture(),
      status: 'ready', generation_error: null,
      created_at: '2026-08-20T00:00:00Z', updated_at: '2026-08-20T00:00:00Z',
    });
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Relatório de Julho de 2026' })).toBeInTheDocument();
    expect(screen.getByText('DK Marketing')).toBeInTheDocument(); // capa renderizada
  });

  it('documento inexistente mostra estado de não encontrado', async () => {
    getReportDocMock.mockResolvedValue(null);
    renderPage();
    expect(await screen.findByText('Relatório não encontrado.')).toBeInTheDocument();
  });
});

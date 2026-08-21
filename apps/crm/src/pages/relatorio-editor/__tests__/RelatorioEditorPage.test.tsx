import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSnapshotFixture } from '@mesaas/report-blocks/fixtures';

const { getReportDocMock, updateReportDocMock } = vi.hoisted(() => ({
  getReportDocMock: vi.fn(),
  updateReportDocMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../services/reportDocs', () => ({
  getReportDoc: getReportDocMock,
  updateReportDoc: updateReportDocMock,
}));

import RelatorioEditorPage from '../RelatorioEditorPage';

// A suíte global (test/vitest.setup.ts) roda vi.restoreAllMocks() em todo
// afterEach; para um vi.fn() puro (não vi.spyOn) isso zera o
// mockResolvedValue aplicado no vi.hoisted acima. Rearmar aqui é o mesmo
// padrão de useLayoutAutosave.test.ts:21.
beforeEach(() => {
  updateReportDocMock.mockResolvedValue(undefined);
});

const doc = () => ({
  id: 'doc-1',
  client_id: 42,
  title: 'Relatório de Abril de 2026',
  period_start: '2026-04-01',
  period_end: '2026-05-01',
  layout: {
    version: 1,
    blocks: [
      // Não 'cover': o CoverBlock também renderiza snapshot.period.label como
      // texto, o que colidiria com o mesmo texto no topbar do editor.
      { id: 'a', type: 'divider', size: 'full' },
      { id: 'b', type: 'kpi_reach', size: 'third' },
    ],
  },
  data_snapshot: makeSnapshotFixture(),
  status: 'ready',
  generation_error: null,
  created_at: '2026-08-21T00:00:00Z',
  updated_at: '2026-08-21T00:00:00Z',
});

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

describe('RelatorioEditorPage (editor)', () => {
  it('renderiza topbar de edição: título editável, mês, Cor e Adicionar widget', async () => {
    getReportDocMock.mockResolvedValue(doc());
    renderPage();
    expect(await screen.findByLabelText('Título do relatório')).toHaveValue(
      'Relatório de Abril de 2026',
    );
    expect(screen.getByText('Julho de 2026')).toBeInTheDocument(); // period.label do fixture
    expect(screen.getByRole('button', { name: 'Adicionar widget' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cor' })).toBeInTheDocument();
  });

  it('canvas em modo edição: chrome presente nos blocos', async () => {
    getReportDocMock.mockResolvedValue(doc());
    renderPage();
    await screen.findByLabelText('Título do relatório');
    expect(screen.getAllByLabelText('Excluir bloco')).toHaveLength(2);
  });

  it('excluir um bloco persiste o layout sem ele (autosave)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    getReportDocMock.mockResolvedValue(doc());
    renderPage();
    await screen.findByLabelText('Título do relatório');
    fireEvent.click(screen.getAllByLabelText('Excluir bloco')[1]);
    await waitFor(
      () =>
        expect(updateReportDocMock).toHaveBeenCalledWith('doc-1', {
          layout: expect.objectContaining({
            blocks: [expect.objectContaining({ id: 'a' })],
          }),
        }),
      { timeout: 4000 },
    );
    vi.useRealTimers();
  });

  it('Adicionar widget insere no fim e destaca', async () => {
    getReportDocMock.mockResolvedValue(doc());
    renderPage();
    await screen.findByLabelText('Título do relatório');
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar widget' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Texto livre' }));
    await waitFor(() => {
      const cells = document.querySelectorAll('[data-block-id]');
      expect(cells).toHaveLength(3);
      expect(cells[2].className).toContain('rb-edit-highlight');
    });
  });

  it('documento inexistente mostra estado de não encontrado', async () => {
    getReportDocMock.mockResolvedValue(null);
    renderPage();
    expect(await screen.findByText('Relatório não encontrado.')).toBeInTheDocument();
  });
});

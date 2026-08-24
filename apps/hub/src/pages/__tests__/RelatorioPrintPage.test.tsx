import {
  QueryClient,
  QueryClientProvider,
  focusManager,
  onlineManager,
} from '@tanstack/react-query';
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

afterEach(() => {
  vi.clearAllMocks();
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
});

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

  it('themes the sheet background via @page + body style when the layout carries a theme', async () => {
    const themedLayout: ReportLayout = {
      version: 1,
      theme: 'editorial',
      blocks: [{ id: 'b1', type: 'cover', size: 'full' }],
    };
    mockedFetchPrintReportDoc.mockResolvedValue({
      doc: {
        id: 'doc-1',
        title: 'Relatório de Julho',
        layout: themedLayout,
        data_snapshot: makeSnapshotFixture(),
        period_start: '2026-07-01',
      },
    } as never);

    const { container } = renderPrintPage();

    await waitFor(() => {
      expect(container.querySelector('.rb-grid.rb-mode-print')).not.toBeNull();
    });

    // editorial theme resolves --rb-bg to #faf6ee (theme.ts THEME_DEFS).
    const styleTag = container.querySelector('style');
    expect(styleTag?.textContent).toContain('@page { margin: 10mm; }');
    // O pin global de overflow do style.css do CRM colapsa a impressão em
    // UMA página (caixa de rolagem monolítica); o override é o antídoto.
    expect(styleTag?.textContent).toContain('overflow: visible !important');
    expect(styleTag?.textContent).toContain('background: #faf6ee');
  });

  it('falls back to a white sheet background in legacy (theme-less) docs', async () => {
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

    const styleTag = container.querySelector('style');
    expect(styleTag?.textContent).toContain('background: #ffffff');
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

  it('surfaces the error even in an unfocused/hidden context (Gotenberg headless, background tab)', async () => {
    // Chromium headless e abas em background reportam visibilityState
    // 'hidden'. Sem o override de foco da página, o retryer do TanStack v5
    // pausa ENTRE as tentativas (canContinue exige isFocused) e a query fica
    // 'pending'/'paused' para sempre: página em branco em vez do erro. Este
    // teste reproduz o contexto sem foco; a página deve mesmo assim terminar.
    focusManager.setFocused(false);
    mockedFetchPrintReportDoc.mockRejectedValue(new Error('HTTP 404'));

    renderPrintPage();

    expect(
      await screen.findByText('Não foi possível carregar o relatório.', {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(mockedFetchPrintReportDoc).toHaveBeenCalledTimes(2);
    expect(window.__REPORT_READY).not.toBe(true);
  });

  it('still issues the fetch when the environment reports offline (networkMode always)', async () => {
    // navigator.onLine === false em containers headless pausaria o PRIMEIRO
    // fetch com o networkMode 'online' padrão — zero requests, print pendura.
    onlineManager.setOnline(false);
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
      expect(mockedFetchPrintReportDoc).toHaveBeenCalledWith('doc-1', 'tok-1');
    });
    await waitFor(() => {
      expect(container.querySelector('.rb-grid.rb-mode-print')).not.toBeNull();
    });
  });
});

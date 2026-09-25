import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportLayout } from '@mesaas/report-blocks/types';

const { getReportTemplateMock, updateReportTemplateMock } = vi.hoisted(() => ({
  getReportTemplateMock: vi.fn(),
  updateReportTemplateMock: vi.fn(),
}));
vi.mock('../../../services/reportTemplates', () => ({
  getReportTemplate: getReportTemplateMock,
  updateReportTemplate: updateReportTemplateMock,
}));
// Funções simples, não vi.fn(): o afterEach global (test/vitest.setup.ts)
// roda vi.restoreAllMocks(), que zeraria o mockResolvedValue de um vi.fn()
// puro após o 1º teste e faria a query de workspace resolver undefined nos
// seguintes (achado ao rodar a suíte: warning "Query data cannot be
// undefined" do react-query nos testes 2+).
vi.mock('../../../store', () => ({
  getCurrentWorkspace: async () => ({ id: 'ws-1', name: 'Agência X', logo_url: null }),
  getWorkspaceBranding: async () => ({
    brand_color: '#7c3aed',
    report_splash_url: null,
    send_report_email: false,
    send_client_event_emails: false,
  }),
}));
const { toastMock } = vi.hoisted(() => ({
  toastMock: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: toastMock }));

import ModeloEditorPage from '../ModeloEditorPage';

const layout: ReportLayout = {
  version: 1,
  blocks: [
    { id: 'c', type: 'cover', size: 'full' },
    { id: 'ai', type: 'ai_summary', size: 'full' },
  ],
};

function renderAt(id = 'tpl-1') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/relatorios/modelos/${id}`]}>
        <Routes>
          <Route path="/relatorios/modelos/:id" element={<ModeloEditorPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getReportTemplateMock.mockReset();
  updateReportTemplateMock.mockReset();
  updateReportTemplateMock.mockResolvedValue(undefined);
  getReportTemplateMock.mockResolvedValue({
    id: 'tpl-1',
    name: 'Mensal completo',
    layout,
    is_default: true,
    created_at: '2026-09-01',
  });
});

describe('ModeloEditorPage', () => {
  it('abre o modelo com nome editável, aviso de dados de exemplo e placeholder de IA', async () => {
    renderAt();
    expect(await screen.findByDisplayValue('Mensal completo')).toBeInTheDocument();
    expect(screen.getByText(/Dados de exemplo/)).toBeInTheDocument();
    expect(screen.getByText('Gerado pela IA em cada relatório')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Modelos/ })).toHaveAttribute(
      'href',
      '/configuracao/relatorios',
    );
  });

  it('não mostra ações de relatório', async () => {
    renderAt();
    await screen.findByDisplayValue('Mensal completo');
    expect(screen.queryByRole('button', { name: /Exportar PDF/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Ações do relatório/ })).toBeNull();
    // Regex parcial bateria também no botão "Adicionar widget no fim do
    // relatório" do LayersPanel (mesmo componente do RelatorioEditorPage);
    // nome exato, mesmo padrão de RelatorioEditorPage.test.tsx.
    expect(screen.getByRole('button', { name: 'Adicionar widget' })).toBeInTheDocument();
  });

  it('renomear grava name via updateReportTemplate', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderAt();
      const input = await screen.findByDisplayValue('Mensal completo');
      fireEvent.change(input, { target: { value: 'Resumo' } });
      await act(async () => {
        vi.advanceTimersByTime(500);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(updateReportTemplateMock).toHaveBeenCalledWith('tpl-1', { name: 'Resumo' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('modelo inexistente mostra "Modelo não encontrado."', async () => {
    getReportTemplateMock.mockResolvedValue(null);
    renderAt('nope');
    expect(await screen.findByText('Modelo não encontrado.')).toBeInTheDocument();
  });
});

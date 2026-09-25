import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportLayout } from '@mesaas/report-blocks/types';

const layout: ReportLayout = {
  version: 1,
  blocks: [
    { id: 'c', type: 'cover', size: 'full' },
    { id: 'ai', type: 'ai_summary', size: 'full' },
  ],
};

const { createReportTemplateMock, navigateMock } = vi.hoisted(() => ({
  createReportTemplateMock: vi.fn(),
  navigateMock: vi.fn(),
}));
vi.mock('../../../services/reportTemplates', () => ({
  buildSystemDefaultLayout: () => layout,
  createReportTemplate: createReportTemplateMock,
  SYSTEM_TEMPLATE_NAME: 'Padrão do sistema',
}));
// Funções simples, não vi.fn(): o afterEach global roda vi.restoreAllMocks()
// (mesmo racional de ModeloEditorPage.test.tsx).
vi.mock('../../../store', () => ({
  getCurrentWorkspace: async () => ({ id: 'ws-1', name: 'Agência X', logo_url: null }),
  getWorkspaceBranding: async () => ({
    brand_color: '#7c3aed',
    report_splash_url: null,
    send_report_email: false,
    send_client_event_emails: false,
  }),
}));
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual<typeof import('react-router-dom')>('react-router-dom')),
  useNavigate: () => navigateMock,
}));
const { toastMock } = vi.hoisted(() => ({
  toastMock: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: toastMock }));

import ModeloPadraoPage from '../ModeloPadraoPage';

let qc: QueryClient;
function renderPage() {
  qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/relatorios/modelos/padrao']}>
        <Routes>
          <Route path="/relatorios/modelos/padrao" element={<ModeloPadraoPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  createReportTemplateMock.mockReset();
  navigateMock.mockReset();
});

describe('ModeloPadraoPage', () => {
  it('mostra o padrão do sistema só leitura, com dados de exemplo e texto de IA de exemplo', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Padrão do sistema' })).toBeInTheDocument();
    expect(screen.getByText('Modelo embutido. Somente visualização.')).toBeInTheDocument();
    expect(screen.getByText(/Dados de exemplo/)).toBeInTheDocument();
    expect(screen.getByText('Texto gerado pela IA em cada relatório.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /Adicionar widget/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Modelos/ })).toHaveAttribute(
      'href',
      '/configuracao/relatorios',
    );
  });

  it('Duplicar para editar cria a cópia sem texto de IA e abre o editor', async () => {
    createReportTemplateMock.mockResolvedValue({ id: 'new-1' });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Duplicar para editar/ }));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/relatorios/modelos/new-1'));
    const [name, saved] = createReportTemplateMock.mock.calls[0];
    expect(name).toBe('Padrão do sistema (cópia)');
    expect((saved as ReportLayout).blocks.every((b) => b.text === undefined)).toBe(true);
  });

  it('falha ao duplicar mostra toast genérico', async () => {
    createReportTemplateMock.mockRejectedValue(new Error('boom'));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Duplicar para editar/ }));
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith('Não foi possível criar o modelo.'),
    );
    expect(navigateMock).not.toHaveBeenCalled();
  });
});

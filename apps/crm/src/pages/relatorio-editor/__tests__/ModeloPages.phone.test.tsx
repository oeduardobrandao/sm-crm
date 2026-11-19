// Modelos de relatório no celular (D27, PLAN F4.4): só visualização. jsdom responde
// false a todo matchMedia, então useIsDesktop(768) é false e as páginas renderizam o
// ramo do celular sem mock.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockMatchMediaEnv } from '@/test/mediaQueryMatcher';
import type { ReportLayout } from '@mesaas/report-blocks/types';

const layout: ReportLayout = {
  version: 1,
  blocks: [
    { id: 'c', type: 'cover', size: 'full' },
    { id: 'ai', type: 'ai_summary', size: 'full' },
  ],
};

const { getReportTemplateMock, updateReportTemplateMock, createReportTemplateMock, navigateMock } =
  vi.hoisted(() => ({
    getReportTemplateMock: vi.fn(),
    updateReportTemplateMock: vi.fn(),
    createReportTemplateMock: vi.fn(),
    navigateMock: vi.fn(),
  }));
vi.mock('../../../services/reportTemplates', () => ({
  getReportTemplate: getReportTemplateMock,
  updateReportTemplate: updateReportTemplateMock,
  buildSystemDefaultLayout: () => layout,
  createReportTemplate: createReportTemplateMock,
  SYSTEM_TEMPLATE_NAME: 'Padrão do sistema',
}));
// Funções simples, não vi.fn(): o afterEach global roda vi.restoreAllMocks().
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
  toastMock: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: toastMock }));

import ModeloPadraoPage from '../ModeloPadraoPage';
import ModeloEditorPage from '../ModeloEditorPage';

function renderAt(path: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/relatorios/modelos/padrao" element={<ModeloPadraoPage />} />
          <Route path="/relatorios/modelos/:id" element={<ModeloEditorPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  navigateMock.mockReset();
  createReportTemplateMock.mockReset();
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

describe('ModeloPadraoPage no celular', () => {
  it('mostra a prévia em modo view com nav bar, avisos e o texto de IA de exemplo', () => {
    const { container } = renderAt('/relatorios/modelos/padrao');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Padrão do sistema' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Modelo embutido. Somente visualização.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Voltar para Modelos' })).toBeInTheDocument();
    const notes = screen.getAllByRole('note');
    expect(notes[0]).toHaveTextContent('Edite o layout no computador.');
    expect(notes[1]).toHaveTextContent(/Dados de exemplo/);
    expect(container.querySelector('.rb-grid.rb-mode-view')).not.toBeNull();
    expect(screen.getByText('Texto gerado pela IA em cada relatório.')).toBeInTheDocument();
    expect(container.querySelector('.header')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    // Sem Exportar PDF nos modelos.
    expect(screen.queryByRole('button', { name: /Exportar PDF/ })).toBeNull();
  });

  it('"…" mantém Duplicar para editar, que cria a cópia e abre o modelo', async () => {
    createReportTemplateMock.mockResolvedValue({ id: 'new-1' });
    renderAt('/relatorios/modelos/padrao');
    fireEvent.click(screen.getByRole('button', { name: 'Ações do modelo' }));
    const sheet = screen.getByRole('dialog', { name: 'Ações do modelo' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Duplicar para editar' }));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/relatorios/modelos/new-1'));
    const [name, saved] = createReportTemplateMock.mock.calls[0];
    expect(name).toBe('Padrão do sistema (cópia)');
    // A cópia leva o layout embutido, não o da prévia com texto de IA.
    expect((saved as ReportLayout).blocks.every((b) => b.text === undefined)).toBe(true);
  });
});

describe('ModeloEditorPage no celular', () => {
  it('mostra o modelo só para ver: sem editor, sem campo de nome, sem Adicionar widget', async () => {
    const { container } = renderAt('/relatorios/modelos/tpl-1');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Mensal completo' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Modelo de relatório')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Voltar para Modelos' })).toBeInTheDocument();
    expect(screen.getAllByRole('note')[0]).toHaveTextContent('Edite o layout no computador.');
    expect(container.querySelector('.rb-grid.rb-mode-view')).not.toBeNull();
    // Bloco de IA não some na prévia.
    expect(screen.getByText('Texto gerado pela IA em cada relatório.')).toBeInTheDocument();
    expect(container.querySelector('.rb-editor-header')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Adicionar widget' })).toBeNull();
    expect(screen.queryByLabelText('Excluir bloco')).toBeNull();
    // O modelo não tem ações no "…" nem exportação.
    expect(screen.queryByRole('button', { name: /Ações do/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Exportar PDF/ })).toBeNull();
    expect(updateReportTemplateMock).not.toHaveBeenCalled();
  });

  it('modelo inexistente mostra o aviso com o Voltar da nav bar', async () => {
    getReportTemplateMock.mockResolvedValue(null);
    renderAt('/relatorios/modelos/nope');
    expect(await screen.findByText('Modelo não encontrado.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Voltar para Modelos' })).toBeInTheDocument();
  });
});

// Tablet (phone shell, touch, >=768x600): as páginas de desktop dentro do shell do
// celular. Um iPhone deitado segue com a view do celular.
describe('Modelos no tablet', () => {
  let media: ReturnType<typeof mockMatchMediaEnv> | null = null;
  afterEach(() => {
    media?.restore();
    media = null;
  });
  const tablet = () =>
    mockMatchMediaEnv({ width: 820, height: 1180, hover: 'none', pointer: 'coarse' });

  it('ModeloEditorPage renderiza o editor de desktop, sem o aviso do computador', async () => {
    media = tablet();
    const { container } = renderAt('/relatorios/modelos/tpl-1');
    expect(await screen.findByLabelText('Nome do modelo')).toHaveValue('Mensal completo');
    expect(container.querySelector('.rb-editor-header')).not.toBeNull();
    expect(screen.getAllByRole('button', { name: /Adicionar widget/ }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/no computador/)).toBeNull();
    // Back is the phone view's nav bar (the header's "Modelos" button would repeat it).
    expect(container.querySelector('.phone-nav-bar.rb-editor-nav-bar')).not.toBeNull();
    expect(screen.queryByRole('link', { name: /Modelos/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para Modelos' }));
    expect(navigateMock).toHaveBeenCalledWith('/configuracao/relatorios', { replace: true });
  });

  it('ModeloPadraoPage renderiza a prévia de desktop com Duplicar para editar', () => {
    media = tablet();
    const { container } = renderAt('/relatorios/modelos/padrao');
    expect(screen.getByRole('button', { name: /Duplicar para editar/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ações do modelo' })).toBeNull();
    expect(screen.queryByText(/no computador/)).toBeNull();
    expect(container.querySelector('.phone-nav-bar.rb-editor-nav-bar')).not.toBeNull();
    expect(screen.queryByRole('link', { name: /Modelos/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para Modelos' }));
    expect(navigateMock).toHaveBeenCalledWith('/configuracao/relatorios', { replace: true });
  });

  it('iPhone deitado segue com a view do celular', async () => {
    media = mockMatchMediaEnv({ width: 844, height: 390, hover: 'none', pointer: 'coarse' });
    renderAt('/relatorios/modelos/tpl-1');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Mensal completo' }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('note')[0]).toHaveTextContent('Edite o layout no computador.');
  });
});

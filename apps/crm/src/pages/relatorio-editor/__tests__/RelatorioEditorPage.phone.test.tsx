// Relatório no celular (D27, PLAN F4.4): só leitura e exportação. jsdom responde
// false a todo matchMedia, então useIsDesktop(768) é false e a página renderiza o
// ramo do celular sem mock.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockMatchMediaEnv, type MediaEnv } from '@/test/mediaQueryMatcher';
import { makeSnapshotFixture } from '@mesaas/report-blocks/fixtures';
import type { ReportTemplateRow } from '../../../services/reportTemplates';

const { listReportTemplatesMock } = vi.hoisted(() => ({
  listReportTemplatesMock: vi.fn(),
}));
vi.mock('../../../services/reportTemplates', () => ({
  listReportTemplates: listReportTemplatesMock,
  deleteReportTemplate: vi.fn(),
  setDefaultReportTemplate: vi.fn(),
}));

const { getReportDocMock, updateReportDocMock, exportReportPdfMock, refreshReportDocMock } =
  vi.hoisted(() => ({
    getReportDocMock: vi.fn(),
    updateReportDocMock: vi.fn(),
    exportReportPdfMock: vi.fn(),
    refreshReportDocMock: vi.fn(),
  }));
vi.mock('../../../services/reportDocs', () => ({
  getReportDoc: getReportDocMock,
  updateReportDoc: updateReportDocMock,
  exportReportPdf: exportReportPdfMock,
  refreshReportDoc: refreshReportDocMock,
}));

const { getHubTokenMock, getWorkspaceSlugMock } = vi.hoisted(() => ({
  getHubTokenMock: vi.fn(),
  getWorkspaceSlugMock: vi.fn(),
}));
vi.mock('../../../store/hub', () => ({
  getHubToken: getHubTokenMock,
  getWorkspaceSlug: getWorkspaceSlugMock,
}));

const { toastMock } = vi.hoisted(() => ({
  toastMock: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: toastMock }));
// O editor lê a flag do TikTok; aqui o plano não importa (fail closed).
vi.mock('@/hooks/useWorkspaceLimits', () => ({ useWorkspaceLimits: () => ({ features: null }) }));

import RelatorioEditorPage from '../RelatorioEditorPage';

// O afterEach global roda vi.restoreAllMocks(): rearmar os valores aqui.
beforeEach(() => {
  updateReportDocMock.mockResolvedValue(undefined);
  refreshReportDocMock.mockResolvedValue(undefined);
  getHubTokenMock.mockResolvedValue(null);
  getWorkspaceSlugMock.mockResolvedValue(null);
  toastMock.loading.mockReturnValue('export-toast-id');
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
      { id: 'a', type: 'divider', size: 'full' },
      { id: 'b', type: 'kpi_reach', size: 'third' },
    ],
  },
  data_snapshot: makeSnapshotFixture({
    account: { handle: 'cafeaurora', specialty: '', client_name: 'Café Aurora' },
  }),
  status: 'ready',
  generation_error: null,
  created_at: '2026-08-21T00:00:00Z',
  updated_at: '2026-08-21T00:00:00Z',
});

function LocationText() {
  return <p>destino: {useLocation().pathname}</p>;
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/relatorios/doc-1']}>
        <Routes>
          <Route path="/relatorios/:id" element={<RelatorioEditorPage />} />
          <Route path="/analytics/:id/relatorios" element={<LocationText />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openMenu() {
  fireEvent.click(await screen.findByRole('button', { name: 'Ações do relatório' }));
  return screen.getByRole('dialog', { name: 'Ações do relatório' });
}

describe('RelatorioEditorPage no celular', () => {
  it('mostra nav bar, título, cliente e período, o aviso e o relatório em modo view, sem o editor', async () => {
    getReportDocMock.mockResolvedValue(doc());
    const { container } = renderPage();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Relatório de Abril de 2026' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Voltar' })).toBeInTheDocument();
    expect(container.querySelector('.phone-nav-bar')).not.toBeNull();
    expect(screen.getByText('Café Aurora · Julho de 2026')).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('Edite o layout no computador.');
    // BlockRenderer em modo view, sem o chrome de edição.
    expect(container.querySelector('.rb-grid.rb-mode-view')).not.toBeNull();
    expect(container.querySelectorAll('[data-block-id]')).toHaveLength(2);
    expect(screen.queryByLabelText('Excluir bloco')).toBeNull();
    // Nada do cabeçalho do editor nem de cabeçalho de desktop.
    expect(container.querySelector('.header')).toBeNull();
    expect(container.querySelector('.rb-editor-header')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Adicionar widget' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Desfazer' })).toBeNull();
  });

  it('"…" traz Atualizar dados e Aplicar template; sem link do Hub, sem Ver como cliente', async () => {
    getReportDocMock.mockResolvedValue(doc());
    renderPage();
    await waitFor(() => expect(getHubTokenMock).toHaveBeenCalledWith(42));
    const sheet = await openMenu();
    expect(within(sheet).getByRole('button', { name: 'Atualizar dados' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Aplicar template' })).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Ver como cliente' })).toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'Salvar como template' })).toBeNull();
  });

  it('Atualizar dados pelo "…" chama refreshReportDoc e avisa', async () => {
    getReportDocMock.mockResolvedValue(doc());
    renderPage();
    const sheet = await openMenu();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Atualizar dados' }));
    await waitFor(() => expect(refreshReportDocMock).toHaveBeenCalledWith('doc-1'));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Dados atualizados.'));
  });

  it('Ver como cliente aparece com link ativo e abre o Hub dentro do toque', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    getReportDocMock.mockResolvedValue(doc());
    getHubTokenMock.mockResolvedValue({
      id: 'tok-1',
      token: 'abc123',
      is_active: true,
      expires_at: '2099-01-01T00:00:00Z',
    });
    getWorkspaceSlugMock.mockResolvedValue('acme');
    renderPage();
    const sheet = await openMenu();
    // A query do link resolve depois do doc; o menu aberto ganha o item quando chega.
    const item = await within(sheet).findByRole('button', { name: 'Ver como cliente' });
    fireEvent.click(item);
    // Síncrono no clique (immediate): fora do gesto o iOS bloquearia a aba.
    expect(openSpy).toHaveBeenCalledWith(
      `${window.location.origin}/acme/hub/abc123/relatorios/doc/doc-1`,
      '_blank',
      'noopener',
    );
  });

  it('Aplicar template abre o diálogo e o template aplicado grava pelo autosave', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    getReportDocMock.mockResolvedValue(doc());
    const template: ReportTemplateRow = {
      id: 'tpl-1',
      name: 'Modelo enxuto',
      layout: { version: 1, blocks: [{ id: 'c', type: 'divider', size: 'full' }] },
      is_default: false,
      created_at: '2026-08-01T00:00:00Z',
    };
    listReportTemplatesMock.mockResolvedValue([template]);
    renderPage();
    const sheet = await openMenu();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Aplicar template' }));
    const row = (await screen.findByText('Modelo enxuto')).closest(
      '[data-testid="template-row"]',
    ) as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Aplicar' }));
    await waitFor(
      () =>
        expect(updateReportDocMock).toHaveBeenCalledWith('doc-1', {
          // applyTemplateLayout entrega o modelo seccionado: marcador Geral + o bloco.
          layout: expect.objectContaining({
            blocks: [
              expect.objectContaining({ type: 'section' }),
              expect.objectContaining({ id: 'c' }),
            ],
          }),
        }),
      { timeout: 4000 },
    );
    vi.useRealTimers();
  });

  it('Exportar PDF não abre aba por código: a barra vira um link "Abrir PDF" para tocar', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    getReportDocMock.mockResolvedValue(doc());
    let resolveExport!: (v: { url: string }) => void;
    exportReportPdfMock.mockReturnValue(
      new Promise((resolve) => {
        resolveExport = resolve;
      }),
    );
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Exportar PDF/ }));
    expect(toastMock.loading).toHaveBeenCalledWith('Gerando PDF... isso pode levar até um minuto.');
    expect(await screen.findByRole('button', { name: /Gerando PDF/ })).toBeDisabled();

    resolveExport({ url: 'https://cdn.example.com/doc-1.pdf' });
    const link = await screen.findByRole('link', { name: 'Abrir PDF' });
    expect(link).toHaveAttribute('href', 'https://cdn.example.com/doc-1.pdf');
    expect(link).toHaveAttribute('target', '_blank');
    expect(clickSpy).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    expect(toastMock.success).toHaveBeenCalledWith('PDF gerado. Toque em Abrir PDF.', {
      id: 'export-toast-id',
    });
    expect(screen.getByRole('button', { name: 'Gerar novamente' })).toBeEnabled();
  });

  it('no app iOS, Abrir PDF abre a folha de compartilhamento em vez de sair para o Safari', async () => {
    const shareFiles = vi.fn(async () => ({ completed: true }));
    (window as unknown as { Capacitor: unknown }).Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'ios',
      isPluginAvailable: (name: string) => name === 'MesaasNative',
      PluginHeaders: [{ name: 'MesaasNative', methods: [{ name: 'shareFiles' }] }],
      Plugins: { MesaasNative: { shareFiles } },
    };
    try {
      getReportDocMock.mockResolvedValue(doc());
      exportReportPdfMock.mockResolvedValue({ url: 'https://cdn.example.com/doc-1.pdf' });
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: /Exportar PDF/ }));
      const link = await screen.findByRole('link', { name: 'Abrir PDF' });

      // fireEvent devolve false quando o clique foi cancelado (preventDefault).
      expect(fireEvent.click(link)).toBe(false);
      await waitFor(() =>
        expect(shareFiles).toHaveBeenCalledWith({
          files: [
            {
              url: 'https://cdn.example.com/doc-1.pdf',
              filename: 'Relatório de Abril de 2026.pdf',
            },
          ],
        }),
      );
    } finally {
      delete (window as unknown as { Capacitor?: unknown }).Capacitor;
    }
  });

  it('Exportar PDF com erro mantém a barra em Exportar PDF e mostra o erro', async () => {
    getReportDocMock.mockResolvedValue(doc());
    exportReportPdfMock.mockRejectedValue(new Error('Não foi possível gerar o PDF.'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Exportar PDF/ }));
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith('Não foi possível gerar o PDF.', {
        id: 'export-toast-id',
      }),
    );
    expect(screen.queryByRole('link', { name: 'Abrir PDF' })).toBeNull();
    expect(screen.getByRole('button', { name: /Exportar PDF/ })).toBeEnabled();
  });

  it('documento inexistente mostra o aviso com o Voltar da nav bar', async () => {
    getReportDocMock.mockResolvedValue(null);
    renderPage();
    expect(await screen.findByText('Relatório não encontrado.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Voltar' })).toBeInTheDocument();
  });
});

// Tablet (phone shell, touch, >=768x600): o editor de desktop dentro do shell do
// celular. Um iPhone deitado (844x390) não é tablet e segue com a view do celular.
const touch = (width: number, height: number): MediaEnv => ({
  width,
  height,
  hover: 'none',
  pointer: 'coarse',
});

describe('RelatorioEditorPage no tablet', () => {
  let media: ReturnType<typeof mockMatchMediaEnv> | null = null;
  afterEach(() => {
    media?.restore();
    media = null;
  });

  it.each([
    ['retrato', touch(820, 1180)],
    ['paisagem', touch(1180, 820)],
  ])('em %s renderiza o editor de desktop, sem o aviso do computador', async (_o, env) => {
    media = mockMatchMediaEnv(env);
    getReportDocMock.mockResolvedValue(doc());
    const { container } = renderPage();
    expect(await screen.findByLabelText('Título do relatório')).toHaveValue(
      'Relatório de Abril de 2026',
    );
    expect(container.querySelector('.rb-editor-header')).not.toBeNull();
    expect(screen.getAllByRole('button', { name: /Adicionar widget/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('Excluir bloco').length).toBeGreaterThan(0);
    // The phone view's nav bar comes along: the shell header and the iOS app have no back.
    expect(container.querySelector('.phone-nav-bar.rb-editor-nav-bar')).not.toBeNull();
    expect(screen.queryByText(/no computador/)).toBeNull();
  });

  it('o Voltar da nav bar leva aos relatórios do cliente', async () => {
    media = mockMatchMediaEnv(touch(1180, 820));
    getReportDocMock.mockResolvedValue(doc());
    renderPage();
    await screen.findByLabelText('Título do relatório');
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(await screen.findByText('destino: /analytics/42/relatorios')).toBeInTheDocument();
  });

  it('o teclado do app iOS (web view abaixo de 600px) não troca o editor pela view do celular', async () => {
    media = mockMatchMediaEnv(touch(1180, 820));
    getReportDocMock.mockResolvedValue(doc());
    const { container } = renderPage();
    const titulo = await screen.findByLabelText('Título do relatório');
    act(() => {
      media!.setEnv({ ...touch(1180, 400), screen: { width: 1180, height: 820 } });
    });
    expect(screen.getByLabelText('Título do relatório')).toBe(titulo);
    expect(container.querySelector('.rb-editor-header')).not.toBeNull();
    expect(screen.queryByText(/no computador/)).toBeNull();
  });

  it('iPhone deitado segue com a view do celular', async () => {
    media = mockMatchMediaEnv(touch(844, 390));
    getReportDocMock.mockResolvedValue(doc());
    const { container } = renderPage();
    expect(await screen.findByRole('note')).toHaveTextContent('Edite o layout no computador.');
    expect(container.querySelector('.rb-editor-header')).toBeNull();
  });

  it('Exportar PDF não abre aba por código: aparece um link "Abrir PDF" no cabeçalho', async () => {
    media = mockMatchMediaEnv(touch(1180, 820));
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    getReportDocMock.mockResolvedValue(doc());
    exportReportPdfMock.mockResolvedValue({ url: 'https://cdn.example.com/doc-1.pdf' });
    const { container } = renderPage();
    await screen.findByLabelText('Título do relatório');
    const header = within(container.querySelector<HTMLElement>('.rb-editor-header')!);
    fireEvent.click(header.getByRole('button', { name: /Exportar PDF/ }));
    const link = await header.findByRole('link', { name: /Abrir PDF/ });
    expect(link).toHaveAttribute('href', 'https://cdn.example.com/doc-1.pdf');
    expect(link).toHaveAttribute('target', '_blank');
    expect(clickSpy).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    expect(toastMock.success).toHaveBeenCalledWith('PDF gerado. Toque em Abrir PDF.', {
      id: 'export-toast-id',
    });
  });
});

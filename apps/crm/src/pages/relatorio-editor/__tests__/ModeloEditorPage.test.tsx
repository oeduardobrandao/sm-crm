import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportLayout } from '@mesaas/report-blocks/types';
import { platformSectionBlocks } from '../../../../../../supabase/functions/_shared/report-docs/default-layout.ts';

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
  toastMock: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
    info: vi.fn(),
  }),
}));
vi.mock('@/components/ui/dropdown-menu', () => import('./dropdownMenuMock'));
vi.mock('sonner', () => ({ toast: toastMock }));

// Esta suíte cobre o layout de desktop; o do celular (abaixo de 768px) tem a sua
// própria em *.phone.test.tsx. jsdom responde false a todo matchMedia.
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));

// Objeto mutável, não vi.fn(): o vi.restoreAllMocks() do setup global não o zera.
const limits = vi.hoisted(() => ({
  value: { features: null as Record<string, boolean> | null },
}));
vi.mock('@/hooks/useWorkspaceLimits', () => ({ useWorkspaceLimits: () => limits.value }));

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
  const utils = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/relatorios/modelos/${id}`]}>
        <Routes>
          <Route path="/relatorios/modelos/:id" element={<ModeloEditorPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, qc };
}

beforeEach(() => {
  limits.value = { features: null };
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

// jsdom não tem DragEvent: Event com um dataTransfer de mentira (só types).
function dropOnDocument(types: string[]) {
  const ev = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: { types, dropEffect: 'copy' } });
  document.body.dispatchEvent(ev);
  return ev.defaultPrevented;
}

describe('ModeloEditorPage', () => {
  const region = (name: string) => screen.getByRole('region', { name: `Seção ${name}` });
  const cellIdsIn = (el: HTMLElement) =>
    [...el.querySelectorAll('[data-block-id]')].map((c) => c.getAttribute('data-block-id'));
  const withTikTok: ReportLayout = {
    version: 1,
    blocks: [
      { id: 'g', type: 'section', size: 'full' },
      { id: 'c', type: 'cover', size: 'full' },
      { id: 'tt', type: 'section', size: 'full', config: { platform: 'tiktok' } },
      { id: 'tv', type: 'tiktok_kpi_views', size: 'third' },
    ],
  };

  it('modelo legado abre seccionado: capa e resumo numa seção Geral', async () => {
    renderAt();
    await screen.findByDisplayValue('Mensal completo');
    expect(cellIdsIn(region('Geral'))).toEqual(['c', 'ai']);
    expect(updateReportTemplateMock).not.toHaveBeenCalled();
  });

  // TikTok só existe com feature_tiktok: sem a flag (ou com o plano ainda sem
  // resposta) "Adicionar seção" não oferece TikTok.
  it.each([
    ['sem feature_tiktok', { feature_tiktok: false }],
    ['plano sem resposta', null],
  ])('%s: "Adicionar seção" não oferece TikTok', async (_label, features) => {
    limits.value = { features };
    renderAt();
    await screen.findByDisplayValue('Mensal completo');
    expect(screen.getAllByRole('button', { name: /^Instagram/ }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /^TikTok/ })).not.toBeInTheDocument();
  });

  it('com feature_tiktok: adicionar TikTok no modelo insere os blocos padrão da plataforma', async () => {
    limits.value = { features: { feature_tiktok: true } };
    renderAt();
    await screen.findByDisplayValue('Mensal completo');
    // No modelo as duas plataformas valem (dados de exemplo): nada desabilitado.
    const items = screen.getAllByRole('button', { name: /^TikTok/ });
    for (const el of items) expect(el).toBeEnabled();
    fireEvent.click(items[items.length - 1]);
    const tt = await screen.findByRole('region', { name: 'Seção TikTok' });
    const expected = platformSectionBlocks('tiktok', {
      hasAudience: true,
      hasBestTimes: true,
      hasTags: true,
      hasTikTokBestTimes: true,
    });
    expect(cellIdsIn(tt)).toHaveLength(expected.length);
  });

  it('modelo com seção TikTok sem feature_tiktok: a seção aparece e sai, mas sem "Adicionar widget"', async () => {
    limits.value = { features: { feature_tiktok: false } };
    getReportTemplateMock.mockResolvedValue({
      id: 'tpl-1',
      name: 'Mensal completo',
      layout: withTikTok,
      is_default: true,
      created_at: '2026-09-01',
    });
    renderAt();
    await screen.findByDisplayValue('Mensal completo');
    const tt = region('TikTok');
    expect(cellIdsIn(tt)).toEqual(['tv']);
    expect(within(tt).queryByRole('button', { name: /Adicionar widget/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Adicionar widget em TikTok/ })).toBeNull();
    fireEvent.click(within(tt).getByRole('button', { name: 'Remover seção' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remover' }));
    expect(screen.queryByRole('region', { name: 'Seção TikTok' })).not.toBeInTheDocument();
  });

  it('o drawer da seção TikTok lista os widgets do TikTok', async () => {
    limits.value = { features: { feature_tiktok: true } };
    getReportTemplateMock.mockResolvedValue({
      id: 'tpl-1',
      name: 'Mensal completo',
      layout: withTikTok,
      is_default: true,
      created_at: '2026-09-01',
    });
    renderAt();
    await screen.findByDisplayValue('Mensal completo');
    fireEvent.click(
      within(region('TikTok')).getByRole('button', { name: 'Adicionar widget na seção TikTok' }),
    );
    expect(await screen.findByText('Na seção TikTok')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lista de vídeos' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Alcance' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('arquivo solto fora das áreas não descarrega o editor; arrasto de texto passa', async () => {
    const { unmount } = renderAt();
    await screen.findByDisplayValue('Mensal completo');
    expect(dropOnDocument(['Files'])).toBe(true);
    expect(dropOnDocument(['text/plain', 'text/html'])).toBe(false);
    unmount();
    expect(dropOnDocument(['Files'])).toBe(false);
  });

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
    expect(screen.getByRole('button', { name: 'Desfazer' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Refazer' })).toBeDisabled();
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

  // F5 (revisão final): falha de carregamento (rede, RLS) é um caso diferente
  // de "não existe" e precisa dizer isso na tela.
  it('falha ao carregar mostra "Não foi possível carregar o modelo."', async () => {
    getReportTemplateMock.mockRejectedValue(new Error('boom'));
    renderAt('boom-id');
    expect(await screen.findByText('Não foi possível carregar o modelo.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Voltar para os modelos/ })).toHaveAttribute(
      'href',
      '/configuracao/relatorios',
    );
  });

  // F1 (revisão final): limpar o nome não pode gravar '' no banco (NOT NULL)
  // nem no cache ['report-template', id] com staleTime: Infinity -- senão
  // reabrir o editor mostra o nome vazio mesmo com o registro intacto.
  describe('F1: nome em branco', () => {
    it('limpar o nome e desmontar nunca chama updateReportTemplate com nome vazio, e o cache mantém o nome anterior', async () => {
      const { unmount, qc } = renderAt();
      const input = await screen.findByDisplayValue('Mensal completo');
      fireEvent.change(input, { target: { value: '' } });
      expect((input as HTMLInputElement).value).toBe('');
      unmount();
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      for (const call of updateReportTemplateMock.mock.calls) {
        expect(call[1]?.name).not.toBe('');
      }
      expect(qc.getQueryData<{ name: string }>(['report-template', 'tpl-1'])?.name).toBe(
        'Mensal completo',
      );
    });

    it('blur com o campo em branco restaura o último nome aceito', async () => {
      renderAt();
      const input = await screen.findByDisplayValue('Mensal completo');
      fireEvent.change(input, { target: { value: '' } });
      expect((input as HTMLInputElement).value).toBe('');
      fireEvent.blur(input);
      expect((input as HTMLInputElement).value).toBe('Mensal completo');
    });
  });
});

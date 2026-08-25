import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSnapshotFixture } from '@mesaas/report-blocks/fixtures';
import { validateLayout } from '@mesaas/report-blocks/types';
import { toast } from 'sonner';
import type { ReportTemplateRow } from '../../../services/reportTemplates';
import { setLayoutAccent } from '../layoutOps';

// Mesmo padrão de mock de ApplyTemplateDialog.test.tsx: o dialog real (Radix,
// não mockado aqui) chama listReportTemplates via useQuery.
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
    updateReportDocMock: vi.fn().mockResolvedValue(undefined),
    exportReportPdfMock: vi.fn(),
    refreshReportDocMock: vi.fn().mockResolvedValue(undefined),
  }));
vi.mock('../../../services/reportDocs', () => ({
  getReportDoc: getReportDocMock,
  updateReportDoc: updateReportDocMock,
  exportReportPdf: exportReportPdfMock,
  refreshReportDoc: refreshReportDocMock,
}));

const { getHubTokenMock, getWorkspaceSlugMock } = vi.hoisted(() => ({
  getHubTokenMock: vi.fn().mockResolvedValue(null),
  getWorkspaceSlugMock: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../../store/hub', () => ({
  getHubToken: getHubTokenMock,
  getWorkspaceSlug: getWorkspaceSlugMock,
}));

// toast() (o call bare, usado pelo undo de exclusão via action) e
// toast.success/.error (os já usados no resto da página) precisam do MESMO
// mock: sonner exporta toast como uma função com métodos anexados.
const { toastMock } = vi.hoisted(() => ({
  toastMock: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: toastMock }));

// Mock do DropdownMenu (padrão da casa, ver ClientesPage.test.tsx): o Radix
// real não abre com fireEvent puro no jsdom (precisa de pointer events
// reais, e este repo não tem @testing-library/user-event instalado). Os
// dois dialogs (Salvar/Aplicar template) continuam testados diretamente em
// SaveTemplateDialog.test.tsx e ApplyTemplateDialog.test.tsx; este mock só
// existe para exercitar "Atualizar dados" e "Ver como cliente", que são
// itens de ação inline (sem dialog próprio).
vi.mock('@/components/ui/dropdown-menu', () => {
  function DropdownMenu({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>;
  }
  function DropdownMenuTrigger({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
  }
  function DropdownMenuContent({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>;
  }
  function DropdownMenuItem({
    children,
    onSelect,
    disabled,
  }: {
    children: React.ReactNode;
    onSelect?: () => void;
    disabled?: boolean;
  }) {
    return (
      <button type="button" disabled={disabled} onClick={() => onSelect?.()}>
        {children}
      </button>
    );
  }
  return { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem };
});

import RelatorioEditorPage from '../RelatorioEditorPage';

// A suíte global (test/vitest.setup.ts) roda vi.restoreAllMocks() em todo
// afterEach; para um vi.fn() puro (não vi.spyOn) isso zera o
// mockResolvedValue aplicado no vi.hoisted acima. Rearmar aqui é o mesmo
// padrão de useLayoutAutosave.test.ts:21.
beforeEach(() => {
  updateReportDocMock.mockResolvedValue(undefined);
  refreshReportDocMock.mockResolvedValue(undefined);
  getHubTokenMock.mockResolvedValue(null);
  getWorkspaceSlugMock.mockResolvedValue(null);
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

function renderPage(qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return {
    qc,
    ...render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/relatorios/doc-1']}>
          <Routes>
            <Route path="/relatorios/:id" element={<RelatorioEditorPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

describe('RelatorioEditorPage (editor)', () => {
  it('renderiza topbar de edição: título editável, mês, Aparência e Adicionar widget', async () => {
    getReportDocMock.mockResolvedValue(doc());
    renderPage();
    expect(await screen.findByLabelText('Título do relatório')).toHaveValue(
      'Relatório de Abril de 2026',
    );
    expect(screen.getByText('Julho de 2026')).toBeInTheDocument(); // period.label do fixture
    expect(screen.getByRole('button', { name: 'Adicionar widget' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Aparência/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Exportar PDF/ })).toBeInTheDocument();
    // O DropdownMenu Radix real não abre com fireEvent puro no jsdom (precisa
    // de pointer events reais, e este repo não tem @testing-library/user-event
    // instalado); por isso @/components/ui/dropdown-menu é mockado no topo
    // deste arquivo (padrão da casa, ver ClientesPage.test.tsx) para exercitar
    // "Atualizar dados" e "Ver como cliente" abaixo. Os dois dialogs que o
    // menu também abre continuam testados diretamente em
    // SaveTemplateDialog.test.tsx e ApplyTemplateDialog.test.tsx.
    expect(screen.getByRole('button', { name: 'Ações do relatório' })).toBeInTheDocument();
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

  it('excluir um bloco mostra toast com ação de desfazer; acionar a action restaura o bloco na mesma posição', async () => {
    getReportDocMock.mockResolvedValue(doc());
    renderPage();
    await screen.findByLabelText('Título do relatório');

    // doc().layout.blocks = [a (divider), b (kpi_reach)] — exclui o segundo (b).
    fireEvent.click(screen.getAllByLabelText('Excluir bloco')[1]);
    expect(
      [...document.querySelectorAll('[data-block-id]')].map((el) =>
        el.getAttribute('data-block-id'),
      ),
    ).toEqual(['a']);

    expect(toastMock).toHaveBeenCalledWith(
      'Bloco excluído.',
      expect.objectContaining({
        action: expect.objectContaining({ label: 'Desfazer', onClick: expect.any(Function) }),
      }),
    );
    const lastCall = toastMock.mock.calls.at(-1)!;
    const { onClick } = (lastCall[1] as { action: { onClick: () => void } }).action;

    act(() => onClick());
    await waitFor(() => {
      const ids = [...document.querySelectorAll('[data-block-id]')].map((el) =>
        el.getAttribute('data-block-id'),
      );
      expect(ids).toEqual(['a', 'b']);
    });
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

  // Achado C2, camada 3 — round-trip: o ColorPicker desta página vai com
  // allowAlpha={false}, mas o handler passa qualquer hex recebido por
  // setLayoutAccent (camada 2 de defesa) antes de applyLayout. Prova que o
  // resultado de setLayoutAccent para um accent de 8 dígitos (#rrggbbaa) —
  // o que um swatch "recente" salvo por outra tela do Estúdio poderia colar
  // aqui mesmo com allowAlpha={false} — nunca é o payload que o autosave
  // manda ao PostgREST: ele já sai normalizado e passa no validateLayout
  // estrito (#rrggbb).
  it('setLayoutAccent com hex de 8 dígitos produz layout que passa no validateLayout', () => {
    const withAlpha = setLayoutAccent(doc().layout, '#0f766eff');
    expect(withAlpha.accent).toBe('#0f766e');
    expect(validateLayout(withAlpha).ok).toBe(true);
  });

  it('documento inexistente mostra estado de não encontrado', async () => {
    getReportDocMock.mockResolvedValue(null);
    renderPage();
    expect(await screen.findByText('Relatório não encontrado.')).toBeInTheDocument();
  });

  // Regressão (defeito a): handleInsert arma um setTimeout de 50ms que chamava
  // `elemento.scrollIntoView(...)` direto. jsdom não implementa esse método
  // (fica undefined no protótipo) — o callback atrasado throwava um TypeError
  // fora de qualquer act()/promise que o teste espera. Com timer REAL isso
  // costuma passar batido em execução isolada (o elemento some antes dos
  // 50ms, via cleanup() do RTL entre testes, e o `?.` já existente no
  // querySelector mascara o throw); é só na suíte completa, com o worker do
  // vitest processando outro arquivo bem nessa janela, que o TypeError
  // "vaza" e derruba esse OUTRO arquivo (reproduzido: ExpressPostPage
  // falhando ~3 de 4 execuções da suíte completa, sem nenhuma relação com
  // relatórios). Fake timers tornam o defeito determinístico: o elemento
  // segue montado quando avançamos o relógio, então o callback roda
  // SINCRONAMENTE dentro do advanceTimersByTime, e um `.scrollIntoView`
  // sem o `?.()` no método (não só no querySelector) propaga o throw pra
  // fora da expectativa abaixo.
  it('scroll do insert não lança no jsdom (sem scrollIntoView nativo)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    getReportDocMock.mockResolvedValue(doc());
    renderPage();
    await screen.findByLabelText('Título do relatório');
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar widget' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Texto livre' }));
    expect(() => vi.advanceTimersByTime(60)).not.toThrow();
    vi.useRealTimers();
  });

  // Regressão (defeito b): nem o scrollTimer nem o highlightTimer eram
  // limpos no unmount de EditorBody. Uma vez desmontado, o elemento já não
  // existe (React remove a árvore de imediato), então o `?.` do querySelector
  // por si só evita o TypeError do scroll neste cenário específico — mas o
  // handle do setTimeout continua vivo no event loop até disparar sozinho,
  // e o do highlight chamaria setHighlightId num componente desmontado.
  // clearTimeout deve ser chamado pros dois assim que o componente some, não
  // só na hora de um PRÓXIMO insert. Rastreia os IDs pelo delay exato de
  // CADA um dos dois timers do handleInsert (50ms e 2500ms) em vez de contar
  // todo clearTimeout que rola no unmount (outras libs no card — Radix
  // Sheet, dnd-kit, TipTap — podem limpar as próprias, o que tornaria uma
  // contagem simples frágil e não relacionada ao bug real).
  it('desmontar após inserir limpa o timer de scroll (50ms) e o de highlight (2500ms)', async () => {
    getReportDocMock.mockResolvedValue(doc());
    const { unmount } = renderPage();
    await screen.findByLabelText('Título do relatório');

    const originalSetTimeout = window.setTimeout.bind(window);
    const originalClearTimeout = window.clearTimeout.bind(window);
    const armedByDelay = new Map<number, number>();
    vi.spyOn(window, 'setTimeout').mockImplementation(((cb: TimerHandler, ms?: number) => {
      const id = originalSetTimeout(cb as () => void, ms) as unknown as number;
      armedByDelay.set(id, ms ?? 0);
      return id as unknown as ReturnType<typeof setTimeout>;
    }) as typeof window.setTimeout);
    const clearedIds: unknown[] = [];
    vi.spyOn(window, 'clearTimeout').mockImplementation(((
      id: Parameters<typeof clearTimeout>[0],
    ) => {
      clearedIds.push(id);
      return originalClearTimeout(id);
    }) as typeof window.clearTimeout);

    fireEvent.click(screen.getByRole('button', { name: 'Adicionar widget' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Texto livre' }));

    const ourTimerIds = [...armedByDelay.entries()]
      .filter(([, ms]) => ms === 50 || ms === 2500)
      .map(([id]) => id);
    expect(ourTimerIds).toHaveLength(2); // scroll (50ms) + highlight (2500ms)

    unmount();

    for (const id of ourTimerIds) {
      expect(clearedIds).toContain(id);
    }
  });

  it('Exportar PDF chama exportReportPdf e abre a URL numa nova aba', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    getReportDocMock.mockResolvedValue(doc());
    exportReportPdfMock.mockResolvedValue({ url: 'https://cdn.example.com/doc-1.pdf' });
    renderPage();
    await screen.findByLabelText('Título do relatório');
    fireEvent.click(screen.getByRole('button', { name: /Exportar PDF/ }));
    await waitFor(() => expect(exportReportPdfMock).toHaveBeenCalledWith('doc-1'));
    await waitFor(() =>
      expect(openSpy).toHaveBeenCalledWith(
        'https://cdn.example.com/doc-1.pdf',
        '_blank',
        'noopener',
      ),
    );
  });

  it('Exportar PDF com window.open bloqueado (popup) cai para um <a> clicado programaticamente', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    getReportDocMock.mockResolvedValue(doc());
    exportReportPdfMock.mockResolvedValue({ url: 'https://cdn.example.com/doc-1.pdf' });
    renderPage();
    await screen.findByLabelText('Título do relatório');
    fireEvent.click(screen.getByRole('button', { name: /Exportar PDF/ }));
    await waitFor(() => expect(exportReportPdfMock).toHaveBeenCalledWith('doc-1'));
    await waitFor(() =>
      expect(openSpy).toHaveBeenCalledWith(
        'https://cdn.example.com/doc-1.pdf',
        '_blank',
        'noopener',
      ),
    );
    // window.open volta null (ativação transitória expirada pelo await de
    // 10-60s do Gotenberg em cache-miss) -- o fallback cria um <a> real,
    // clica nele e remove.
    await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
  });

  it('Exportar PDF com erro mostra toast e não abre nada', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    getReportDocMock.mockResolvedValue(doc());
    exportReportPdfMock.mockRejectedValue(
      new Error('Export de PDF não configurado neste ambiente.'),
    );
    renderPage();
    await screen.findByLabelText('Título do relatório');
    fireEvent.click(screen.getByRole('button', { name: /Exportar PDF/ }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Export de PDF não configurado neste ambiente.'),
    );
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('Atualizar dados chama refreshReportDoc, invalida a query do doc e mostra toast', async () => {
    getReportDocMock.mockResolvedValue(doc());
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    renderPage(qc);
    await screen.findByLabelText('Título do relatório');
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar dados' }));
    await waitFor(() => expect(refreshReportDocMock).toHaveBeenCalledWith('doc-1'));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['report-doc', 'doc-1'] }),
    );
    expect(toast.success).toHaveBeenCalledWith('Dados atualizados.');
  });

  it('Atualizar dados com erro mostra toast e não invalida a query', async () => {
    getReportDocMock.mockResolvedValue(doc());
    refreshReportDocMock.mockRejectedValue(new Error('Erro ao atualizar dados (500)'));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    renderPage(qc);
    await screen.findByLabelText('Título do relatório');
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar dados' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Erro ao atualizar dados (500)'));
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['report-doc', 'doc-1'] });
  });

  it('Ver como cliente aparece com token ativo e slug, e abre a URL do Hub numa nova aba', async () => {
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
    await screen.findByLabelText('Título do relatório');
    const item = await screen.findByRole('button', { name: 'Ver como cliente' });
    fireEvent.click(item);
    expect(openSpy).toHaveBeenCalledWith(
      `${window.location.origin}/acme/hub/abc123/relatorios/doc/doc-1`,
      '_blank',
      'noopener',
    );
  });

  it('Ver como cliente NÃO aparece sem token ativo', async () => {
    getReportDocMock.mockResolvedValue(doc());
    getHubTokenMock.mockResolvedValue({
      id: 'tok-1',
      token: 'abc123',
      is_active: false,
      expires_at: '2099-01-01T00:00:00Z',
    });
    getWorkspaceSlugMock.mockResolvedValue('acme');
    renderPage();
    await screen.findByLabelText('Título do relatório');
    await waitFor(() => expect(getHubTokenMock).toHaveBeenCalledWith(42));
    expect(screen.queryByRole('button', { name: 'Ver como cliente' })).not.toBeInTheDocument();
  });

  it('Ver como cliente NÃO aparece sem token nenhum', async () => {
    getReportDocMock.mockResolvedValue(doc());
    // getHubTokenMock/getWorkspaceSlugMock já resolvem null via beforeEach.
    renderPage();
    await screen.findByLabelText('Título do relatório');
    await waitFor(() => expect(getHubTokenMock).toHaveBeenCalledWith(42));
    expect(screen.queryByRole('button', { name: 'Ver como cliente' })).not.toBeInTheDocument();
  });

  it('aplicar template com cover size != full: normaliza antes de aplicar/persistir', async () => {
    // Fix 1 (review final do report-cover-block): applyTemplateLayout troca o
    // layout inteiro pelo do template escolhido -- um template legado salvo
    // antes da regra "cover deve ser full" existir carrega esse defeito para
    // o documento aberto. Mesma proteção que já existe para doc.layout no
    // carregamento inicial (teste "doc com cover salvo..." abaixo), agora no
    // fluxo de aplicar template.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    getReportDocMock.mockResolvedValue(doc());
    const template: ReportTemplateRow = {
      id: 'tpl-1',
      name: 'Modelo com capa antiga',
      layout: { version: 1, blocks: [{ id: 'c', type: 'cover', size: 'third' }] },
      is_default: false,
      created_at: '2026-08-01T00:00:00Z',
    };
    listReportTemplatesMock.mockResolvedValue([template]);
    renderPage();
    await screen.findByLabelText('Título do relatório');
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar template' }));
    const row = (await screen.findByText('Modelo com capa antiga')).closest(
      '[data-testid="template-row"]',
    ) as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Aplicar' }));
    await waitFor(
      () =>
        expect(updateReportDocMock).toHaveBeenCalledWith('doc-1', {
          layout: expect.objectContaining({
            blocks: [expect.objectContaining({ id: 'c', size: 'full' })],
          }),
        }),
      { timeout: 4000 },
    );
    vi.useRealTimers();
  });

  it('doc com cover salvo com size != full: corrige em memória e a próxima edição já persiste corrigido', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    getReportDocMock.mockResolvedValue({
      ...doc(),
      layout: {
        version: 1,
        blocks: [
          { id: 'c', type: 'cover', size: 'third' },
          { id: 'b', type: 'kpi_reach', size: 'third' },
        ],
      },
    });
    renderPage();
    await screen.findByLabelText('Título do relatório');
    fireEvent.click(screen.getAllByLabelText('Excluir bloco')[1]);
    await waitFor(
      () =>
        expect(updateReportDocMock).toHaveBeenCalledWith('doc-1', {
          layout: expect.objectContaining({
            blocks: [expect.objectContaining({ id: 'c', size: 'full' })],
          }),
        }),
      { timeout: 4000 },
    );
    vi.useRealTimers();
  });
});

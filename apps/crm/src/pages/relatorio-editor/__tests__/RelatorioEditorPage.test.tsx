import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSnapshotFixture } from '@mesaas/report-blocks/fixtures';
import { validateLayout } from '@mesaas/report-blocks/types';
import { setLayoutAccent } from '../layoutOps';

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
    // O DropdownMenu Radix não abre com fireEvent puro no jsdom (precisa de
    // pointer events reais, e este repo não tem @testing-library/user-event
    // instalado); os dois dialogs que o menu abre são testados diretamente
    // em SaveTemplateDialog.test.tsx e ApplyTemplateDialog.test.tsx.
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
});

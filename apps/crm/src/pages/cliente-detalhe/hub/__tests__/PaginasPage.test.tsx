import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import nodePath from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Cliente } from '@/store';
import type { HubPageRow } from '@/store/hub';
import type { ClienteDetalheOutletContext } from '../../clienteTabs.model';

// PaginasPage agora usa o editor rich text (PaginaRichTextEditor/pageEditorSchema, Task 9)
// e o conversor de conteúdo (pageContent, Task 8) em vez do par markdown/preview antigo.
// Esta suíte substitui inteiramente a versão pré-Task-11 (dialog + textarea + ReactMarkdown).

vi.mock('@/context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/store/hub');
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

// Mock de dnd-kit: sem isto, useSortable (de @dnd-kit/sortable) precisa de um DndContext
// de verdade por trás, que não existe depois de substituir DndContext por um passthrough.
// Captura `onDragEnd` para disparar reordenações sem simular ponteiro/toque em jsdom --
// mesmo padrão de WorkflowCalendarView.test.tsx e WorkflowDrawer.test.tsx.
const dndHandlers = vi.hoisted(() => ({
  onDragEnd: undefined as ((e: unknown) => void) | undefined,
}));
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children, onDragEnd }: any) => {
    dndHandlers.onDragEnd = onDragEnd;
    return <>{children}</>;
  },
  PointerSensor: class {},
  KeyboardSensor: class {},
  closestCenter: () => null,
  useSensor: () => ({}),
  useSensors: (...sensors: unknown[]) => sensors,
}));
vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: any) => <>{children}</>,
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
  verticalListSortingStrategy: () => null,
  sortableKeyboardCoordinates: () => null,
  // Reimplementação fiel do arrayMove real -- os testes de reordenação precisam da
  // ordem de verdade para conferir o array mandado a reorderHubPages.
  arrayMove: <T,>(arr: T[], from: number, to: number): T[] => {
    const copy = arr.slice();
    const [item] = copy.splice(from, 1);
    copy.splice(to, 0, item);
    return copy;
  },
}));

import { useAuth } from '@/context/AuthContext';
import { makeCan, fakeMembership } from '@/test/makeCan';
import PaginasPage from '../PaginasPage';
import * as hubStore from '@/store/hub';

const mockedUseAuth = vi.mocked(useAuth);

const CLIENTE: Cliente = {
  id: 15,
  nome: 'Aurora Estética',
  sigla: 'AE',
  cor: '#ffbf30',
  plano: 'Plano Ouro',
  email: 'contato@aurora.com.br',
  telefone: '(85) 99999-0000',
  status: 'ativo',
  valor_mensal: 1500,
  conta_id: 'ws-1',
};

const RICHTEXT_DOC = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Conteúdo original' }] }],
};

const PAGE: HubPageRow = {
  id: 'p1',
  conta_id: 'ws-1',
  cliente_id: 15,
  title: 'Página um',
  content: [{ type: 'richtext', doc: RICHTEXT_DOC }],
  display_order: 0,
  created_at: '2026-01-01T00:00:00.000Z',
};

const OUTRA: HubPageRow = {
  id: 'p2',
  conta_id: 'ws-1',
  cliente_id: 15,
  title: 'Outra página',
  content: [{ type: 'richtext', doc: { type: 'doc', content: [] } }],
  display_order: 1,
  created_at: '2026-01-02T00:00:00.000Z',
};

const LEGACY_MARKDOWN: HubPageRow = {
  id: 'p3',
  conta_id: 'ws-1',
  cliente_id: 15,
  title: 'Página markdown',
  content: [{ type: 'markdown', content: '## Título\n\nTexto em markdown legado.' }],
  display_order: 0,
  created_at: '2026-01-01T00:00:00.000Z',
};

const LEGACY_PARAGRAPH: HubPageRow = {
  id: 'p4',
  conta_id: 'ws-1',
  cliente_id: 15,
  title: 'Página parágrafo',
  content: [{ type: 'paragraph', content: 'Texto solto legado' }],
  display_order: 0,
  created_at: '2026-01-01T00:00:00.000Z',
};

/**
 * Tri-state: `HubRoleGate` lê `can('configuracoes', 'editar')`, não mais o
 * `workspaceRole` grosseiro. Derivar via `makeCan`/`fakeMembership` exercita a
 * MESMA tabela-verdade (`derivePermission`) que roda em produção.
 */
function setAuth(workspaceRole: 'owner' | 'admin' | 'agent' | null) {
  mockedUseAuth.mockReturnValue({
    workspaceRole,
    can: makeCan(workspaceRole === null ? null : fakeMembership({ role: workspaceRole })),
  } as never);
}

function OutletContextProvider({ cliente }: { cliente: Cliente }) {
  return (
    <Outlet context={{ clienteId: cliente.id!, cliente } satisfies ClienteDetalheOutletContext} />
  );
}

function renderPaginas({
  page,
  pages,
  cliente = CLIENTE,
}: { page?: HubPageRow; pages?: HubPageRow[]; cliente?: Cliente } = {}) {
  const list = pages ?? (page ? [page] : []);
  // Um novo array a cada chamada -- como o Supabase real faz -- em vez de
  // `mockResolvedValue` (mesma referência sempre): PagesEditor desliga o
  // structural sharing da query bem por causa disso (ver PaginasPage.tsx).
  vi.mocked(hubStore.getHubPages).mockImplementation(async () => list.map((p) => ({ ...p })));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<OutletContextProvider cliente={cliente} />}>
            <Route path="/" element={<PaginasPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// A tela tem DOIS elementos com role implícito "textbox": o <Input> de título e o
// ProseMirror do editor. screen.findByRole('textbox') sozinho é ambíguo aqui (ao
// contrário de PaginaRichTextEditor.test.tsx, isolado, onde só o editor existe) --
// o corpo do editor é o único elemento `[contenteditable="true"]` da tela.
async function findEditor(): Promise<HTMLElement> {
  return waitFor(() => {
    const el = document.body.querySelector('[contenteditable="true"]');
    // O elemento existe assim que o ProseMirror monta, mas hidrata o doc inicial
    // (mesmo um doc vazio normaliza para um <p> vazio) num passo seguinte -- sem
    // childNodes ainda não dá pra confiar no textContent.
    if (!el || el.childNodes.length === 0) throw new Error('editor ainda não montado');
    return el as HTMLElement;
  });
}

async function typeInEditor(text: string) {
  const editor = await findEditor();
  await userEvent.click(editor);
  await userEvent.type(editor, text);
}

function fireBeforeUnload(): Event {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event;
}

function railTitles(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll('.hub-paginas__list-item-title')).map(
    (el) => el.textContent,
  );
}

describe('PaginasPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    setAuth('owner');
    vi.mocked(hubStore.getHubPages).mockResolvedValue([]);
    vi.mocked(hubStore.upsertHubPage).mockResolvedValue(undefined);
    vi.mocked(hubStore.removeHubPage).mockResolvedValue(undefined as never);
    vi.mocked(hubStore.reorderHubPages).mockResolvedValue(undefined);
    dndHandlers.onDragEnd = undefined;
  });

  afterEach(() => {
    cleanup();
  });

  it('does not fire the hub-pages-crm query for an agent', async () => {
    setAuth('agent');
    renderPaginas();

    await screen.findByText('Hub do Cliente');
    expect(hubStore.getHubPages).not.toHaveBeenCalled();
  });

  // Regression guard (revisor externo): uma página já salva como
  // `[{ type: 'richtext', doc }]` não pode ler `content[0].content` (que não existe
  // nesse formato) e mostrar um editor vazio -- tem que usar readPageDoc.
  it('abre uma página já em richtext sem perder o conteúdo', async () => {
    renderPaginas({ page: PAGE });
    const editor = await findEditor();
    expect(editor.textContent).toContain('Conteúdo original');
  });

  it('abre uma página legada em bloco markdown convertendo o texto', async () => {
    renderPaginas({ page: LEGACY_MARKDOWN });
    const editor = await findEditor();
    expect(editor.textContent).toContain('Texto em markdown legado');
    expect(await screen.findByText('Markdown')).toBeInTheDocument();
  });

  it('abre uma página legada em bloco paragraph convertendo o texto', async () => {
    renderPaginas({ page: LEGACY_PARAGRAPH });
    const editor = await findEditor();
    expect(editor.textContent).toContain('Texto solto legado');
  });

  // Regression guard: salvar uma página richtext editada não pode substituir o
  // ProseMirror doc por um bloco `{ type: 'markdown', content }` legado.
  it('salva o richtext editado sem substituir por um bloco markdown', async () => {
    renderPaginas({ page: PAGE });
    await typeInEditor(' extra');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(hubStore.upsertHubPage).toHaveBeenCalled());
    const saved = vi.mocked(hubStore.upsertHubPage).mock.calls[0][0] as any;
    expect(saved.content).toHaveLength(1);
    expect(saved.content[0].type).toBe('richtext');
    expect(saved.content[0].doc.type).toBe('doc');
  });

  it('arma o beforeunload só com alteração real', async () => {
    renderPaginas({ page: PAGE });
    await findEditor();
    expect(fireBeforeUnload().defaultPrevented).toBe(false);

    await typeInEditor('novo texto');
    expect(fireBeforeUnload().defaultPrevented).toBe(true);
  });

  it('pede confirmação ao trocar de página no rail com alteração pendente', async () => {
    renderPaginas({ pages: [PAGE, OUTRA] });
    await screen.findByText('Página um');
    await typeInEditor('x');

    await userEvent.click(screen.getByText('Outra página'));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('troca de página de fato ao confirmar o diálogo', async () => {
    renderPaginas({ pages: [PAGE, OUTRA] });
    await screen.findByText('Página um');
    await typeInEditor('x');
    await userEvent.click(screen.getByText('Outra página'));

    await userEvent.click(screen.getByRole('button', { name: 'Trocar mesmo assim' }));
    await waitFor(() => expect(screen.getByDisplayValue('Outra página')).toBeInTheDocument());
  });

  it('restaura o rascunho ao reabrir a página', async () => {
    const docAlterado = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Rascunho salvo antes' }] }],
    };
    localStorage.setItem('hub-page-draft:p1', JSON.stringify(docAlterado));

    renderPaginas({ page: PAGE });
    expect(await screen.findByText(/alterações não salvas/i)).toBeInTheDocument();
    const editor = await findEditor();
    expect(editor.textContent).toContain('Rascunho salvo antes');
  });

  it('limpa o rascunho depois de salvar', async () => {
    renderPaginas({ page: PAGE });
    await typeInEditor('x');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(localStorage.getItem('hub-page-draft:p1')).toBeNull());
  });

  // Finding 1 (fix round 1): um edit só no título não gravava rascunho nenhum -- o
  // diálogo de troca de página prometia guardar a alteração, mas `saveDraft` só era
  // chamado a partir de `handleEditorChange` (o corpo), nunca do `onChange` do título.
  it('grava o rascunho ao editar só o título', async () => {
    renderPaginas({ page: PAGE });
    await findEditor();

    const titleInput = screen.getByPlaceholderText('Título da página');
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, 'Título novo');

    await waitFor(
      () => {
        const raw = localStorage.getItem('hub-page-draft:p1');
        expect(raw).not.toBeNull();
        const parsed = JSON.parse(raw as string);
        expect(parsed.title).toBe('Título novo');
      },
      { timeout: 2000 },
    );
  });

  // Finding 1 (fix round 1), pior caso: editar título E corpo, trocar de página e
  // voltar não pode devolver um par incoerente (corpo do rascunho + título do
  // servidor) -- os dois têm que restaurar juntos, do mesmo rascunho.
  it('restaura título e corpo juntos ao trocar de página e voltar (par não pode ficar incoerente)', async () => {
    renderPaginas({ pages: [PAGE, OUTRA] });
    await findEditor();

    const titleInput = screen.getByPlaceholderText('Título da página');
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, 'Título editado');
    await typeInEditor(' corpo editado');

    // Espera o debounce gravar o par completo antes de trocar de página --
    // trocar antes disso testaria só o beforeunload/blocker, não o rascunho.
    await waitFor(
      () => {
        const raw = localStorage.getItem('hub-page-draft:p1');
        expect(raw).not.toBeNull();
        const parsed = JSON.parse(raw as string);
        expect(parsed.title).toBe('Título editado');
      },
      { timeout: 2000 },
    );

    await userEvent.click(screen.getByText('Outra página'));
    await userEvent.click(screen.getByRole('button', { name: 'Trocar mesmo assim' }));
    await waitFor(() => expect(screen.getByDisplayValue('Outra página')).toBeInTheDocument());

    // O rail mostra o título do SERVIDOR ('Página um'), não o rascunho local --
    // é assim que se seleciona a página de volta.
    await userEvent.click(screen.getByText('Página um'));

    await waitFor(() => expect(screen.getByDisplayValue('Título editado')).toBeInTheDocument());
    const editor = await findEditor();
    expect(editor.textContent).toContain('corpo editado');
  });

  // Finding 2 (fix round 2): o debounce de 400ms era só cancelado (nunca gravado) ao
  // desmontar -- confirmar a troca de página DENTRO dessa janela perdia o título/corpo
  // mais recentes, contradizendo o diálogo, que promete guardar as alterações no
  // navegador. Confirma a troca logo em seguida de editar, sem esperar o debounce.
  it('não perde o rascunho ao confirmar a troca de página dentro da janela do debounce', async () => {
    renderPaginas({ pages: [PAGE, OUTRA] });
    await findEditor();

    const titleInput = screen.getByPlaceholderText('Título da página');
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, 'Editado na janela');
    await typeInEditor(' corpo na janela');

    // Sem esperar o debounce: confirma a troca imediatamente, testando exatamente a
    // janela em que o timer ainda não gravou nada no localStorage.
    await userEvent.click(screen.getByText('Outra página'));
    await userEvent.click(screen.getByRole('button', { name: 'Trocar mesmo assim' }));
    await waitFor(() => expect(screen.getByDisplayValue('Outra página')).toBeInTheDocument());

    const raw = localStorage.getItem('hub-page-draft:p1');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string).title).toBe('Editado na janela');

    await userEvent.click(screen.getByText('Página um'));
    await waitFor(() => expect(screen.getByDisplayValue('Editado na janela')).toBeInTheDocument());
    const editor = await findEditor();
    expect(editor.textContent).toContain('corpo na janela');
  });

  // Finding 3 (fix round 2): para uma página nova (`page === null`), `usePageDraft(null)`
  // virava no-op -- digitar em "Nova página" e confirmar uma troca perdia tudo. A chave
  // agora é escopada por cliente (`new-<clienteId>`), então o rascunho sobrevive a
  // trocar de página e voltar, igual já acontecia para páginas existentes.
  //
  // Usa `typeIntoNewEditor` em vez de `typeInEditor`/`findEditor`: uma página nova
  // parte de `{ type: 'doc', content: [] }`, e diferente do que o comentário de
  // `findEditor` supõe, o ProseMirror NÃO normaliza um doc vazio pra um `<p>` vazio só
  // por montar (`errorOnInvalidContent` é `false` por padrão) -- o contenteditable fica
  // com 0 childNodes até a primeira tecla, então esperar childNodes > 0 antes de digitar
  // trava para sempre. Clicar e digitar direto no elemento funciona normalmente mesmo
  // partindo de 0 childNodes.
  async function typeIntoNewEditor(text: string) {
    const el = document.body.querySelector('[contenteditable="true"]') as HTMLElement;
    await userEvent.click(el);
    await userEvent.type(el, text);
  }

  it('mantém o rascunho de uma página nova ao trocar de página e voltar', async () => {
    renderPaginas({ pages: [PAGE] });
    await screen.findByText('Página um');

    await userEvent.click(screen.getByRole('button', { name: 'Nova página' }));
    const titleInput = await screen.findByPlaceholderText('Título da página');
    await userEvent.type(titleInput, 'Sobre nós');
    await typeIntoNewEditor('Texto da página nova');

    await waitFor(
      () => {
        const raw = localStorage.getItem(`hub-page-draft:new-${CLIENTE.id}`);
        expect(raw).not.toBeNull();
        expect(JSON.parse(raw as string).title).toBe('Sobre nós');
      },
      { timeout: 2000 },
    );

    await userEvent.click(screen.getByText('Página um'));
    await userEvent.click(screen.getByRole('button', { name: 'Trocar mesmo assim' }));
    await waitFor(() => expect(screen.getByDisplayValue('Página um')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Nova página' }));
    await waitFor(() => expect(screen.getByDisplayValue('Sobre nós')).toBeInTheDocument());
    // O rascunho restaurado já tem conteúdo real (não é mais o doc vazio inicial), então
    // `findEditor` (que espera childNodes > 0) funciona normalmente aqui.
    const editor = await findEditor();
    expect(editor.textContent).toContain('Texto da página nova');
  });

  // Finding 3 (fix round 2), a outra metade: depois que a página nova é criada de
  // verdade, o rascunho "new-<clienteId>" tem que sumir -- senão a PRÓXIMA composição de
  // "Nova página" reabriria com conteúdo de uma criação já concluída.
  it('limpa o rascunho de página nova depois de criar, sem reaparecer numa composição futura', async () => {
    renderPaginas({ pages: [] });
    const titleInput = await screen.findByPlaceholderText('Título da página');
    await userEvent.type(titleInput, 'Primeira página');
    await typeIntoNewEditor('Conteúdo inicial');

    await waitFor(
      () => expect(localStorage.getItem(`hub-page-draft:new-${CLIENTE.id}`)).not.toBeNull(),
      { timeout: 2000 },
    );

    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(hubStore.upsertHubPage).toHaveBeenCalled());

    await waitFor(() =>
      expect(localStorage.getItem(`hub-page-draft:new-${CLIENTE.id}`)).toBeNull(),
    );
  });

  it('não usa useBlocker', async () => {
    // useBlocker desliga a troca silenciosa entre deploys: React Router honra só o
    // último blocker registrado. Ver silent-update.router.test.ts.
    // jsdom shadows the global `URL` with its own implementation, and Node's fs
    // internals reject a non-Node URL instance with 'The URL must be of scheme
    // file' -- fileURLToPath + a plain string path sidesteps that entirely.
    const here = fileURLToPath(import.meta.url);
    const target = nodePath.join(nodePath.dirname(here), '../PaginasPage.tsx');
    const src = await readFile(target, 'utf8');
    expect(src).not.toMatch(/useBlocker/);
  });

  describe('reordenação', () => {
    it('reordena e chama reorderHubPages com a nova ordem, refazendo a busca', async () => {
      renderPaginas({ pages: [PAGE, OUTRA] });
      await screen.findByText('Página um');

      await act(async () => {
        dndHandlers.onDragEnd?.({ active: { id: 'p1' }, over: { id: 'p2' } });
      });

      await waitFor(() =>
        expect(hubStore.reorderHubPages).toHaveBeenCalledWith(CLIENTE.id, ['p2', 'p1']),
      );
      await waitFor(() => expect(hubStore.getHubPages).toHaveBeenCalledTimes(2));
    });

    it('refaz a busca e desfaz a ordem otimista quando reorderHubPages falha', async () => {
      vi.mocked(hubStore.reorderHubPages).mockRejectedValue(new Error('boom'));
      const { container } = renderPaginas({ pages: [PAGE, OUTRA] });
      await screen.findByText('Página um');
      expect(railTitles(container)).toEqual(['Página um', 'Outra página']);

      await act(async () => {
        dndHandlers.onDragEnd?.({ active: { id: 'p1' }, over: { id: 'p2' } });
      });

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Erro ao reordenar páginas.'));
      await waitFor(() => expect(hubStore.getHubPages).toHaveBeenCalledTimes(2));
      // A busca depois da falha devolve a MESMA ordem do servidor (mock inalterado) --
      // nenhuma ordem otimista pode ficar pendurada na tela depois da rejeição.
      await waitFor(() => expect(railTitles(container)).toEqual(['Página um', 'Outra página']));
    });

    // Finding 3 (fix round 1): nada impedia um segundo drag de correr junto com o
    // primeiro `reorderHubPages` ainda pendente. Controla a resolução manualmente
    // pra forçar essa janela: dispara o primeiro drag, espera o handle ficar
    // desabilitado (reordering === true propagado a um novo render), dispara um
    // segundo drag nessa janela, e confirma que ele foi ignorado.
    it('ignora um segundo drag enquanto o primeiro ainda está em voo', async () => {
      let resolveReorder: (() => void) | undefined;
      vi.mocked(hubStore.reorderHubPages).mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveReorder = resolve;
          }),
      );
      renderPaginas({ pages: [PAGE, OUTRA] });
      await screen.findByText('Página um');

      act(() => {
        dndHandlers.onDragEnd?.({ active: { id: 'p1' }, over: { id: 'p2' } });
      });
      await waitFor(() => expect(hubStore.reorderHubPages).toHaveBeenCalledTimes(1));

      // Segundo drag chega enquanto o primeiro `reorderHubPages` ainda não resolveu.
      act(() => {
        dndHandlers.onDragEnd?.({ active: { id: 'p2' }, over: { id: 'p1' } });
      });
      expect(hubStore.reorderHubPages).toHaveBeenCalledTimes(1);

      resolveReorder?.();
      await waitFor(() => expect(hubStore.getHubPages).toHaveBeenCalledTimes(2));
      // Ainda só a UMA chamada -- o segundo drag nunca chegou a chamar reorderHubPages.
      expect(hubStore.reorderHubPages).toHaveBeenCalledTimes(1);
    });
  });
});

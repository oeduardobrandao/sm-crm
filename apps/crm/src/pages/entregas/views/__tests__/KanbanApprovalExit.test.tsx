import React from 'react';
import { act, fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Saída de etapa de aprovação no quadro de Fluxos: avançar um card que está numa
// etapa `aprovacao_cliente` abre o ApprovalExitDialog direto (sem
// ForwardConfirm) e confirma pela RPC atômica advanceWorkflowFromApproval.

// Mesma técnica do KanbanMixedColumnDragEnd.test.tsx: captura o onDragEnd do
// DndContext em vez de simular pointer events em jsdom.
const dndHandlers = vi.hoisted(() => ({
  onDragEnd: undefined as ((e: unknown) => void | Promise<void>) | undefined,
}));

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({
    children,
    onDragEnd,
  }: {
    children: React.ReactNode;
    onDragEnd?: (e: unknown) => void | Promise<void>;
  }) => {
    dndHandlers.onDragEnd = onDragEnd;
    return <>{children}</>;
  },
  DragOverlay: ({ children }: { children?: React.ReactNode }) => <>{children ?? null}</>,
  PointerSensor: class {},
  MouseSensor: class {},
  TouchSensor: class {},
  useSensor: () => ({}),
  useSensors: (...sensors: unknown[]) => sensors,
  useDroppable: () => ({ setNodeRef: () => {}, isOver: false }),
}));

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
  verticalListSortingStrategy: 'vertical',
  arrayMove: <T,>(arr: T[], from: number, to: number): T[] => {
    const copy = arr.slice();
    const [moved] = copy.splice(from, 1);
    copy.splice(to, 0, moved);
    return copy;
  },
}));

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => undefined } },
}));

const store = vi.hoisted(() => ({
  completeEtapa: vi.fn(),
  advanceWorkflowFromApproval: vi.fn(),
  getWorkflowPostStatusCounts: vi.fn(),
  countPendingEditSuggestionsInWorkflow: vi.fn(),
  hasLaterApprovalEtapa: vi.fn(),
  sendPostsToCliente: vi.fn(),
  revertEtapa: vi.fn(),
  updateWorkflowPositions: vi.fn(),
  reorderFluxosBoard: vi.fn(),
  // Fase 4: usePostProcessCommands (chamado incondicionalmente pelo
  // KanbanView) importa estes três do store; nenhum teste deste arquivo
  // exercita um post, mas o módulo precisa resolver os nomes.
  transitionPostProcess: vi.fn(),
  removePostProcess: vi.fn(),
  updateWorkflowPost: vi.fn(),
  CLIENT_CLEARED_STATUSES: ['aprovado_cliente', 'agendado', 'postado', 'falha_publicacao'],
  // Pulled in transitively by WorkflowModals / useEntregasData
  getDeadlineInfo: vi.fn(),
  addWorkflow: vi.fn(),
  addWorkflowEtapa: vi.fn(),
  addWorkflowTemplate: vi.fn(),
  removeWorkflowTemplate: vi.fn(),
  removeWorkflow: vi.fn(),
  updateWorkflow: vi.fn(),
  updateWorkflowEtapa: vi.fn(),
  getPropertyDefinitions: vi.fn(),
  deletePropertyDefinition: vi.fn(),
  getWorkflows: vi.fn(),
  getClientes: vi.fn(),
  getMembros: vi.fn(),
  getWorkflowTemplates: vi.fn(),
  getWorkflowEtapas: vi.fn(),
  getWorkflowPostsCounts: vi.fn(),
  getWorkflowPostStats: vi.fn(),
  getWorkspaceSlug: vi.fn(),
}));

vi.mock('../../../../store', () => store);

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('../../components/PropertyDefinitionPanel', () => ({
  PropertyDefinitionPanel: () => <div>PropertyDefinitionPanel</div>,
}));

// The card itself is not under test here — only the advance handlers it triggers.
vi.mock('../../components/WorkflowCard', () => ({
  WorkflowCard: ({ onForwardClick }: { onForwardClick?: () => void }) => (
    <button onClick={onForwardClick}>forward</button>
  ),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    type = 'button',
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type={type} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div>{children}</div> : null,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogAction: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => <button onClick={onClick}>{children}</button>,
  AlertDialogCancel: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => <button onClick={onClick}>{children}</button>,
}));

import { KanbanView } from '../KanbanView';
import { toast } from 'sonner';
import type { BoardCard } from '../../hooks/useEntregasData';

// Desktop layout: the phone branch (below 768px, what jsdom's matchMedia reports)
// has its own suites.
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));

// usePostProcessCommands usa useQueryClient (fase 4): todo render do
// KanbanView agora precisa de um QueryClientProvider por cima, mesmo em
// testes que só exercitam fluxos.
function render(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const approvalEtapa = {
  id: 11,
  workflow_id: 1,
  ordem: 1,
  nome: 'Aprovação do texto',
  prazo_dias: 2,
  tipo_prazo: 'corridos' as const,
  tipo: 'aprovacao_cliente' as const,
  status: 'ativo' as const,
};
const nextEtapa = {
  id: 12,
  workflow_id: 1,
  ordem: 2,
  nome: 'Design',
  prazo_dias: 2,
  tipo_prazo: 'corridos' as const,
  tipo: 'padrao' as const,
  status: 'pendente' as const,
};

function makeCard(overrides: Record<string, unknown> = {}): BoardCard {
  return {
    workflow: {
      id: 1,
      cliente_id: 1,
      titulo: 'Posts Agosto',
      status: 'ativo',
      etapa_atual: 1,
      recorrente: false,
      template_id: 7,
    },
    etapa: approvalEtapa,
    cliente: undefined,
    membro: undefined,
    deadline: { diasRestantes: 2, horasRestantes: 0, estourado: false, urgente: false },
    totalEtapas: 2,
    etapaIdx: 1,
    allEtapas: [approvalEtapa, nextEtapa],
    ...overrides,
  } as unknown as BoardCard;
}

const card = makeCard();

/** Pendentes 2 (rascunho + aprovado_interno), alteráveis 2 (aprovado_interno +
 *  aprovado_cliente), aprovado interno 1: as quatro opções aparecem. */
const COUNTS = { rascunho: 1, aprovado_interno: 1, aprovado_cliente: 1 };

function renderBoard(overrides: { card?: BoardCard; onRefresh?: () => void } = {}) {
  return render(
    <KanbanView
      cards={[overrides.card ?? card]}
      onCardClick={() => {}}
      onEditClick={() => {}}
      onPostsClick={() => {}}
      onRefresh={overrides.onRefresh ?? (() => {})}
      onRecurring={() => {}}
      membros={[]}
      templates={[{ id: 7, nome: 'Redes', etapas: [] } as never]}
      postsCounts={new Map([[1, 3]])}
      approvedPostsCounts={new Map()}
      clearedClienteCounts={new Map([[1, 1]])}
      revisaoInternaCounts={new Map()}
      awaitingClienteCounts={new Map()}
    />,
  );
}

/** Abre o diálogo pelo botão do card e espera as contagens chegarem (as opções
 *  além de "Manter" só aparecem com elas; numa reabertura elas vêm do cache, e o
 *  primário só habilita quando a busca nova termina). */
async function openExitDialog() {
  fireEvent.click(screen.getByText('forward'));
  await screen.findByRole('radio', { name: /Voltar todos para rascunho/ });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Avançar' })).not.toBeDisabled());
}

describe('KanbanView saída de etapa de aprovação', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.completeEtapa.mockResolvedValue({ workflow: { status: 'ativo' }, etapas: [] });
    store.advanceWorkflowFromApproval.mockResolvedValue({
      workflowStatus: 'ativo',
      etapaAtual: 2,
      postsChanged: 2,
    });
    store.getWorkflowPostStatusCounts.mockResolvedValue(COUNTS);
    store.countPendingEditSuggestionsInWorkflow.mockResolvedValue(0);
    store.hasLaterApprovalEtapa.mockReturnValue(true);
    store.sendPostsToCliente.mockResolvedValue(undefined);
    store.updateWorkflowPositions.mockResolvedValue(undefined);
    store.reorderFluxosBoard.mockResolvedValue(undefined);
  });

  it('avançar um card em etapa de aprovação abre o diálogo de saída sem o ForwardConfirm', async () => {
    renderBoard();
    await openExitDialog();
    expect(screen.getByText('Avançar "Posts Agosto" para Design?')).toBeInTheDocument();
    expect(screen.queryByText('Avançar etapa?')).toBeNull();
    expect(store.getWorkflowPostStatusCounts).toHaveBeenCalledWith(1);
    expect(store.hasLaterApprovalEtapa).toHaveBeenCalledWith([approvalEtapa, nextEtapa], 11);
  });

  it('não busca as contagens enquanto o diálogo está fechado', () => {
    renderBoard();
    expect(store.getWorkflowPostStatusCounts).not.toHaveBeenCalled();
    expect(store.countPendingEditSuggestionsInWorkflow).not.toHaveBeenCalled();
  });

  it('avisa quantos posts do lote têm sugestão do cliente não revisada', async () => {
    store.countPendingEditSuggestionsInWorkflow.mockResolvedValue(2);
    renderBoard();
    await openExitDialog();
    expect(store.countPendingEditSuggestionsInWorkflow).toHaveBeenCalledWith(1);
    expect(
      await screen.findByText('2 posts com sugestão do cliente não revisada.'),
    ).toBeInTheDocument();
  });

  it('sem sugestão pendente no lote, o diálogo não ganha a linha', async () => {
    renderBoard();
    await openExitDialog();
    await waitFor(() => expect(store.countPendingEditSuggestionsInWorkflow).toHaveBeenCalled());
    expect(screen.queryByText(/com sugestão do cliente não revisada/)).toBeNull();
  });

  it('se a contagem das sugestões falha, o diálogo segue sem a linha e confirmável', async () => {
    store.countPendingEditSuggestionsInWorkflow.mockRejectedValue(new Error('offline'));
    renderBoard();
    await openExitDialog();
    expect(screen.queryByText(/com sugestão do cliente não revisada/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('confirmar a recomendada (aprovação adiante) volta para rascunho com as contagens', async () => {
    const onRefresh = vi.fn();
    renderBoard({ onRefresh });
    await openExitDialog();
    expect(screen.getByRole('radio', { name: /Voltar todos para rascunho/ })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Avançar' }));
    await waitFor(() =>
      expect(store.advanceWorkflowFromApproval).toHaveBeenCalledWith({
        workflowId: 1,
        expectedEtapaId: 11,
        choice: 'voltar_rascunho',
        expectedCounts: COUNTS,
      }),
    );
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith('Etapa concluída. Posts voltaram para rascunho.');
    expect(screen.queryByRole('radio', { name: /Voltar todos para rascunho/ })).toBeNull();
    expect(store.completeEtapa).not.toHaveBeenCalled();
  });

  it('"Manter status atuais" avança sem contagens esperadas', async () => {
    renderBoard();
    await openExitDialog();
    fireEvent.click(screen.getByRole('radio', { name: /Manter status atuais/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Avançar' }));
    await waitFor(() =>
      expect(store.advanceWorkflowFromApproval).toHaveBeenCalledWith({
        workflowId: 1,
        expectedEtapaId: 11,
        choice: 'manter',
        expectedCounts: null,
      }),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Etapa concluída. Status dos posts mantidos.'),
    );
  });

  it('"Aprovar todos" avança com aprovar_todos e as contagens', async () => {
    renderBoard();
    await openExitDialog();
    fireEvent.click(screen.getByRole('radio', { name: /Aprovar todos/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Avançar' }));
    await waitFor(() =>
      expect(store.advanceWorkflowFromApproval).toHaveBeenCalledWith({
        workflowId: 1,
        expectedEtapaId: 11,
        choice: 'aprovar_todos',
        expectedCounts: COUNTS,
      }),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Posts aprovados e etapa concluída.'),
    );
  });

  it('"Enviar ao portal" envia os posts e não avança', async () => {
    const onRefresh = vi.fn();
    renderBoard({ onRefresh });
    await openExitDialog();
    fireEvent.click(screen.getByRole('radio', { name: /Enviar ao portal/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Enviar ao portal' }));
    await waitFor(() => expect(store.sendPostsToCliente).toHaveBeenCalledWith(1));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Posts enviados ao portal do cliente!'),
    );
    expect(onRefresh).toHaveBeenCalled();
    expect(store.advanceWorkflowFromApproval).not.toHaveBeenCalled();
  });

  it('posts_changed mantém o diálogo aberto e busca as contagens de novo', async () => {
    store.advanceWorkflowFromApproval.mockRejectedValue({ message: 'posts_changed' });
    const onRefresh = vi.fn();
    renderBoard({ onRefresh });
    await openExitDialog();
    expect(store.getWorkflowPostStatusCounts).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Avançar' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Os posts mudaram enquanto você escolhia. Confira os números e confirme de novo.',
      ),
    );
    await waitFor(() => expect(store.getWorkflowPostStatusCounts).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByRole('radio', { name: /Voltar todos para rascunho/ }),
    ).toBeInTheDocument();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('posts_changed depois de "Aprovar todos" mantém a escolha e reconfirma aprovar_todos', async () => {
    store.advanceWorkflowFromApproval.mockRejectedValueOnce({ message: 'posts_changed' });
    const FRESH = { rascunho: 2, aprovado_interno: 1, aprovado_cliente: 1 };
    // A segunda busca fica pendurada até o teste soltar: é na janela da recarga
    // que as opções colapsavam e a escolha voltava para a recomendada.
    let release: (v: typeof FRESH) => void = () => {};
    store.getWorkflowPostStatusCounts
      .mockResolvedValueOnce(COUNTS)
      .mockImplementationOnce(() => new Promise((r) => (release = r)));
    renderBoard();
    await openExitDialog();
    fireEvent.click(screen.getByRole('radio', { name: /Aprovar todos/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Avançar' }));
    await waitFor(() => expect(store.getWorkflowPostStatusCounts).toHaveBeenCalledTimes(2));
    // Recarregando: o primário fica desabilitado, mas as opções e a escolha ficam.
    expect(screen.getByRole('button', { name: 'Avançar' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /Aprovar todos/ })).toBeChecked();
    await act(async () => release(FRESH));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Avançar' })).not.toBeDisabled());
    expect(screen.getByRole('radio', { name: /Aprovar todos/ })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Avançar' }));
    await waitFor(() => expect(store.advanceWorkflowFromApproval).toHaveBeenCalledTimes(2));
    expect(store.advanceWorkflowFromApproval.mock.calls[1][0]).toEqual({
      workflowId: 1,
      expectedEtapaId: 11,
      choice: 'aprovar_todos',
      expectedCounts: FRESH,
    });
  });

  it.each([
    ['not_approval_etapa', 'Esta etapa não é mais de aprovação. A tela foi atualizada.'],
    ['expected_counts_required', 'Não foi possível conferir os posts. Tente de novo.'],
    ['workflow_not_active', 'Este fluxo não está mais ativo.'],
  ])('%s fecha o diálogo, mostra a cópia e recarrega', async (code, copy) => {
    store.advanceWorkflowFromApproval.mockRejectedValue({ message: code });
    const onRefresh = vi.fn();
    renderBoard({ onRefresh });
    await openExitDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Avançar' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(copy));
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    expect(screen.queryByRole('radio', { name: /Voltar todos para rascunho/ })).toBeNull();
  });

  it('falha ao buscar as contagens mostra o aviso e "Tentar de novo" busca de novo', async () => {
    store.getWorkflowPostStatusCounts.mockRejectedValueOnce(new Error('offline'));
    renderBoard();
    fireEvent.click(screen.getByText('forward'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar os posts.',
    );
    expect(screen.getByRole('button', { name: 'Avançar' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    await screen.findByRole('radio', { name: /Voltar todos para rascunho/ });
    expect(store.getWorkflowPostStatusCounts).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Avançar' })).not.toBeDisabled();
  });

  it('etapa_changed fecha o diálogo e recarrega', async () => {
    store.advanceWorkflowFromApproval.mockRejectedValue({ message: 'etapa_changed' });
    const onRefresh = vi.fn();
    renderBoard({ onRefresh });
    await openExitDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Avançar' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Este fluxo já foi movido por outra pessoa. Recarregue e confira.',
      ),
    );
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    expect(screen.queryByRole('radio', { name: /Voltar todos para rascunho/ })).toBeNull();
  });

  it('outro erro mostra "Erro ao avançar etapa" e fecha', async () => {
    store.advanceWorkflowFromApproval.mockRejectedValue(new Error('boom'));
    renderBoard();
    await openExitDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Avançar' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Erro ao avançar etapa'));
    expect(screen.queryByRole('radio', { name: /Voltar todos para rascunho/ })).toBeNull();
  });

  it('arrastar da coluna de aprovação e cancelar abandona o movimento e o card fica', async () => {
    renderBoard();
    expect(dndHandlers.onDragEnd).toBeDefined();
    await act(async () => {
      await dndHandlers.onDragEnd?.({ active: { id: '1' }, over: { id: 'col:template:7::2' } });
    });
    await screen.findByRole('radio', { name: /Voltar todos para rascunho/ });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() =>
      expect(screen.queryByRole('radio', { name: /Voltar todos para rascunho/ })).toBeNull(),
    );
    expect(store.advanceWorkflowFromApproval).not.toHaveBeenCalled();
    // O card continua na coluna de aprovação.
    const column = screen.getByText('forward').closest('.board-column');
    expect(column).toHaveTextContent('Aprovação do texto');

    // onAbandon limpou a posição capturada pelo drag: um avanço posterior pelo
    // botão não grava a ordem daquela coluna.
    await openExitDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Avançar' }));
    await waitFor(() => expect(store.advanceWorkflowFromApproval).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(store.reorderFluxosBoard).not.toHaveBeenCalled();
    expect(store.updateWorkflowPositions).not.toHaveBeenCalled();
  });

  it('etapa padrão continua com o ForwardConfirm e completeEtapa', async () => {
    const padraoEtapa = { ...approvalEtapa, tipo: 'padrao' as const, nome: 'Copy' };
    const onRefresh = vi.fn();
    renderBoard({
      card: makeCard({ etapa: padraoEtapa, allEtapas: [padraoEtapa, nextEtapa] }),
      onRefresh,
    });
    fireEvent.click(screen.getByText('forward'));
    expect(await screen.findByText('Avançar etapa?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Avançar' }));
    await waitFor(() => expect(store.completeEtapa).toHaveBeenCalledWith(1, 11));
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith('Etapa concluída!');
    expect(store.advanceWorkflowFromApproval).not.toHaveBeenCalled();
    expect(store.getWorkflowPostStatusCounts).not.toHaveBeenCalled();
  });

  it('falha no avanço de etapa padrão mostra a mensagem de erro crua', async () => {
    store.completeEtapa.mockRejectedValue(new Error('db offline'));
    const padraoEtapa = { ...approvalEtapa, tipo: 'padrao' as const, nome: 'Copy' };
    const onRefresh = vi.fn();
    renderBoard({
      card: makeCard({ etapa: padraoEtapa, allEtapas: [padraoEtapa, nextEtapa] }),
      onRefresh,
    });
    fireEvent.click(screen.getByText('forward'));
    await screen.findByText('Avançar etapa?');
    fireEvent.click(screen.getByRole('button', { name: 'Avançar' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('db offline'));
    expect(onRefresh).not.toHaveBeenCalled();
  });
});

// The guided tour selects steps by [data-tour] presence at runtime, so a lost anchor
// degrades the tour silently. A coluna de aprovação é marcada por
// column.tipo === 'aprovacao_cliente', e as colunas são identificadas pela ordem
// da etapa; este teste garante que a âncora do tour vai para a coluna certa.
describe('KanbanView wf-col-aprovacao tour anchor', () => {
  it('tags the aprovacao_cliente column header and no other column', () => {
    const { container } = renderBoard();

    const tagged = container.querySelectorAll('[data-tour="wf-col-aprovacao"]');
    expect(tagged).toHaveLength(1);
    // The fixture board has an approval column ("Aprovação do texto") and a plain
    // one ("Design"); the anchor must land on the approval column's header.
    expect(tagged[0]).toHaveTextContent('Aprovação do texto');
    expect(tagged[0]).not.toHaveTextContent('Design');
    expect(tagged[0]).toHaveClass('board-column-header');

    // Non-vacuity: prove the non-approval column really rendered, so the
    // "no other column" assertion above is not passing on an empty board.
    const headers = container.querySelectorAll('.board-column-header');
    expect(headers).toHaveLength(2);
    const design = [...headers].find((h) => h.textContent?.includes('Design'))!;
    expect(design).toBeInTheDocument();
    expect(design.hasAttribute('data-tour')).toBe(false);
  });
});

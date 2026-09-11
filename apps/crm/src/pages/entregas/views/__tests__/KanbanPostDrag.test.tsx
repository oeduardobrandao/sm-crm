import React from 'react';
import { act, fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mesma técnica de mock de @dnd-kit do KanbanMixedColumnDragEnd.test.tsx
// (view diferente, mesmo dnd-kit): captura o onDragEnd que o DndContext
// recebe em vez de simular pointer/touch events reais em jsdom.
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
  completeEtapaWithRearm: vi.fn(),
  hasLaterApprovalEtapa: vi.fn(),
  approvePostsInternally: vi.fn(),
  sendPostsToCliente: vi.fn(),
  revertEtapa: vi.fn(),
  updateWorkflowPositions: vi.fn(),
  reorderFluxosBoard: vi.fn().mockResolvedValue(undefined),
  transitionPostProcess: vi.fn(),
  removePostProcess: vi.fn(),
  updateWorkflowPost: vi.fn(),
  CLIENT_CLEARED_STATUSES: ['aprovado_cliente', 'agendado', 'postado', 'falha_publicacao'],
  getDeadlineInfo: vi.fn(),
  addWorkflow: vi.fn(),
  addWorkflowEtapa: vi.fn(),
  addWorkflowTemplate: vi.fn(),
  removeWorkflowTemplate: vi.fn(),
  removeWorkflow: vi.fn(),
  updateWorkflow: vi.fn(),
  updateWorkflowEtapa: vi.fn(),
  updateWorkflowTemplate: vi.fn(),
  propagateTemplateToWorkflows: vi.fn(),
  getPropertyDefinitions: vi.fn(),
  deletePropertyDefinition: vi.fn(),
  getWorkflows: vi.fn(),
  getClientes: vi.fn(),
  getMembros: vi.fn(),
  getWorkflowTemplates: vi.fn(),
  getWorkflowEtapas: vi.fn(),
  getWorkflowPostsCounts: vi.fn(),
  getWorkflowApprovedPostsCounts: vi.fn(),
  getWorkflowClearedClientePostsCounts: vi.fn(),
  getWorkflowRevisaoInternaCounts: vi.fn(),
  getWorkflowAwaitingClientePostsCounts: vi.fn(),
  getWorkflowPostResponsaveis: vi.fn(),
  getWorkspaceSlug: vi.fn(),
}));
vi.mock('../../../../store', () => store);
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('../../components/PropertyDefinitionPanel', () => ({
  PropertyDefinitionPanel: () => <div>PropertyDefinitionPanel</div>,
}));
vi.mock('../../components/WorkflowCard', () => ({
  WorkflowCard: ({ card }: { card: { workflow: { titulo: string } } }) => (
    <div data-testid="workflow-card">{card.workflow.titulo}</div>
  ),
}));
// Diferente do mock de KanbanMixedColumnDragEnd.test.tsx: expõe botões reais
// ligados a onForwardClick/onRevertClick, para o teste 3 poder disparar o
// MESMO comando (avancar) por BOTÃO depois de um drag cancelado -- é isso que
// prova o fix da Task 8 (o leak de pendingInsertRef).
vi.mock('../../components/PostProcessCard', () => ({
  PostProcessCard: ({
    entity,
    onForwardClick,
    onRevertClick,
  }: {
    entity: { titulo: string };
    onForwardClick?: () => void;
    onRevertClick?: () => void;
  }) => (
    <div data-testid="post-process-card">
      {entity.titulo}
      <button onClick={onForwardClick}>Avançar etapa</button>
      <button onClick={onRevertClick}>Voltar etapa</button>
    </div>
  ),
}));

import { KanbanView } from '../KanbanView';
import type { PostEntity } from '../../boardEntity';
import { rowKeyFor, columnKey } from '../../boardRows';

// usePostProcessCommands usa useQueryClient (fase 4): todo render do
// KanbanView precisa de um QueryClientProvider por cima.
function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

const baseProps = {
  cards: [],
  onCardClick: () => {},
  onEditClick: () => {},
  onPostsClick: () => {},
  onRefresh: () => {},
  onRecurring: () => {},
  membros: [],
  templates: [{ id: 7, nome: 'Redes', etapas: [] } as never],
  postsCounts: new Map(),
  approvedPostsCounts: new Map(),
  clearedClienteCounts: new Map(),
  revisaoInternaCounts: new Map(),
  awaitingClienteCounts: new Map(),
  postProcessesEnabled: true as const,
};

// Três etapas (0/1/2) para que o post ativo em ordem 1 tenha AO MESMO TEMPO
// uma próxima etapa pendente (2, "Aprovação") e uma etapa anterior (0,
// "Copy") -- alvo válido de drag/comando nos dois sentidos. `tipo: 'padrao'`
// em todas evita a escolha de aprovação do cliente (fora do escopo deste
// arquivo, já coberta em usePostProcessCommands.test.tsx).
const STAGE_STEPS = [
  { ordem: 0, nome: 'Copy', tipo: 'padrao' as const },
  { ordem: 1, nome: 'Design', tipo: 'padrao' as const },
  { ordem: 2, nome: 'Aprovação', tipo: 'padrao' as const },
];

function makePostEntity(): PostEntity {
  return {
    kind: 'post',
    id: 'post:9',
    process: {
      id: 9,
      post_id: 109,
      template_id: 7,
      etapa_atual: 1,
      revisao: 1,
      steps: STAGE_STEPS.map((e) => ({
        ordem: e.ordem,
        nome: e.nome,
        tipo: e.tipo,
        estado: e.ordem === 1 ? 'ativo' : e.ordem < 1 ? 'concluido' : 'pendente',
      })),
      post: { id: 109, titulo: 'Post Individual A', status: 'rascunho', cliente_id: null },
    } as never,
    step: { ordem: 1 } as never,
    templateId: 7,
    steps: STAGE_STEPS,
    etapaOrdem: 1,
    etapaNome: 'Design',
    responsavel: undefined,
    prazoEfetivo: null,
    posicao: 1,
    deadline: { diasRestantes: 0, horasRestantes: 0, estourado: false, urgente: false },
    cliente: undefined,
    titulo: 'Post Individual A',
  };
}

// Variante com uma etapa de aprovação do cliente ATIVA (ordem 1) e o post já
// aprovado_interno -- as duas condições que fazem decideApprovalAdvance abrir
// a escolha (ClientApprovalChoiceDialog) COM "Enviar ao portal do cliente"
// habilitado (sendToPortalDisabledReasonFor exige status === 'aprovado_interno'
// exatamente). Usada só pelo teste de "Enviar ao portal" abaixo -- os demais
// testes deste arquivo usam STAGE_STEPS (tudo 'padrao') de propósito, para
// nunca abrir esta escolha.
const APPROVAL_STAGE_STEPS = [
  { ordem: 0, nome: 'Copy', tipo: 'padrao' as const },
  { ordem: 1, nome: 'Aprovação', tipo: 'aprovacao_cliente' as const },
  { ordem: 2, nome: 'Publicação', tipo: 'padrao' as const },
];

function makeApprovalPostEntity(): PostEntity {
  return {
    kind: 'post',
    id: 'post:9',
    process: {
      id: 9,
      post_id: 109,
      template_id: 7,
      etapa_atual: 1,
      revisao: 1,
      steps: APPROVAL_STAGE_STEPS.map((e) => ({
        ordem: e.ordem,
        nome: e.nome,
        tipo: e.tipo,
        estado: e.ordem === 1 ? 'ativo' : e.ordem < 1 ? 'concluido' : 'pendente',
      })),
      post: {
        id: 109,
        titulo: 'Post Individual A',
        status: 'aprovado_interno',
        cliente_id: null,
      },
    } as never,
    step: { ordem: 1 } as never,
    templateId: 7,
    steps: APPROVAL_STAGE_STEPS,
    etapaOrdem: 1,
    etapaNome: 'Aprovação',
    responsavel: undefined,
    prazoEfetivo: null,
    posicao: 1,
    deadline: { diasRestantes: 0, horasRestantes: 0, estourado: false, urgente: false },
    cliente: undefined,
    titulo: 'Post Individual A',
  };
}

// Ids do droppable de uma coluna VAZIA (nenhum card/post nela ainda): o
// mesmo 'col:<rowKey>::<ordem>' que DroppableColumnBody registra no
// KanbanView real -- calculado com as MESMAS funções (rowKeyFor/columnKey),
// não reimplementado, para nunca divergir do que o componente monta.
const COL_PREFIX = 'col:';
function emptyColumnOverId(entity: PostEntity, ordem: number): string {
  const rowKey = rowKeyFor(entity, true);
  return `${COL_PREFIX}${columnKey(rowKey, ordem)}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  store.reorderFluxosBoard.mockResolvedValue(undefined);
  store.transitionPostProcess.mockResolvedValue({
    ok: true,
    revisao: 2,
    post_status: 'rascunho',
    post_status_changed: false,
    steps: [],
  });
});

describe('KanbanView drag de um post individual (fase 4, Task 8)', () => {
  it('arrastar um post para a próxima etapa PENDENTE dispara commands.avancar (mesmo RPC do botão)', async () => {
    const post = makePostEntity();
    const qc = makeQueryClient();
    rtlRender(
      <QueryClientProvider client={qc}>
        <KanbanView {...baseProps} postEntities={[post]} />
      </QueryClientProvider>,
    );
    expect(dndHandlers.onDragEnd).toBeDefined();

    const overId = emptyColumnOverId(post, 2); // "Aprovação", ordem 2 -- next pending step
    await act(async () => {
      await dndHandlers.onDragEnd?.({ active: { id: 'post:9' }, over: { id: overId } });
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Avançar' }));
    await waitFor(() => expect(store.transitionPostProcess).toHaveBeenCalledTimes(1));
    expect(store.transitionPostProcess.mock.calls[0][0]).toMatchObject({
      processId: 9,
      command: 'avancar',
    });
  });

  it('arrastar um post para a etapa ANTERIOR dispara commands.voltar (mesmo RPC do botão)', async () => {
    const post = makePostEntity();
    const qc = makeQueryClient();
    rtlRender(
      <QueryClientProvider client={qc}>
        <KanbanView {...baseProps} postEntities={[post]} />
      </QueryClientProvider>,
    );
    expect(dndHandlers.onDragEnd).toBeDefined();

    const overId = emptyColumnOverId(post, 0); // "Copy", ordem 0 -- previous step
    await act(async () => {
      await dndHandlers.onDragEnd?.({ active: { id: 'post:9' }, over: { id: overId } });
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Reverter' }));
    await waitFor(() => expect(store.transitionPostProcess).toHaveBeenCalledTimes(1));
    expect(store.transitionPostProcess.mock.calls[0][0]).toMatchObject({
      processId: 9,
      command: 'voltar',
    });
  });

  // Task 8, fix round 1: reproduz o leak achado na revisão. Um drag entre
  // colunas seta pendingInsertRef ANTES de abrir o diálogo de confirmação;
  // cancelar (em vez de confirmar) precisa limpar esse ref -- sem isso, o
  // PRÓXIMO comando do MESMO post disparado por BOTÃO (não-drag, e portanto
  // sem nenhum pendingInsertRef próprio) herda a posição capturada pelo drag
  // já abandonado, e o catch-up effect grava essa ordem obsoleta assim que o
  // refetch reflete a nova etapa.
  it('drag cancelado de um post não deixa o comando por BOTÃO herdar a posição do drag abandonado', async () => {
    const post = makePostEntity();
    const qc = makeQueryClient();
    const { rerender } = rtlRender(
      <QueryClientProvider client={qc}>
        <KanbanView {...baseProps} postEntities={[post]} />
      </QueryClientProvider>,
    );
    expect(dndHandlers.onDragEnd).toBeDefined();

    // 1) Drag para frente: seta pendingInsertRef e abre o ForwardConfirmDialog.
    const overId = emptyColumnOverId(post, 2);
    await act(async () => {
      await dndHandlers.onDragEnd?.({ active: { id: 'post:9' }, over: { id: overId } });
    });
    await screen.findByRole('button', { name: 'Avançar' });

    // 2) Cancelar -- com o fix, onDismiss limpa pendingInsertRef aqui.
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Avançar' })).toBeNull());
    expect(store.transitionPostProcess).not.toHaveBeenCalled();

    // 3) Comando por BOTÃO (não-drag) no MESMO post -- nunca seta
    // pendingInsertRef por si só.
    fireEvent.click(screen.getByRole('button', { name: 'Avançar etapa' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Avançar' }));
    await waitFor(() => expect(store.transitionPostProcess).toHaveBeenCalledTimes(1));
    expect(store.transitionPostProcess.mock.calls[0][0]).toMatchObject({
      processId: 9,
      command: 'avancar',
    });

    // 4) Simula o refetch que reflete a etapa nova -- é o que aciona o
    // catch-up effect que replicaria a posição de um drag abandonado.
    const advancedPost: PostEntity = {
      ...post,
      etapaOrdem: 2,
      etapaNome: 'Aprovação',
      process: { ...post.process, etapa_atual: 2 } as never,
    };
    rerender(
      <QueryClientProvider client={qc}>
        <KanbanView {...baseProps} postEntities={[advancedPost]} />
      </QueryClientProvider>,
    );

    // A posição capturada pelo drag CANCELADO nunca pode ser reproduzida
    // pelo comando disparado por botão -- nem reorderFluxosBoard (coluna
    // mista) nem updateWorkflowPositions (só fluxos) devem ser chamados.
    await waitFor(() => expect(store.transitionPostProcess).toHaveBeenCalledTimes(1));
    expect(store.reorderFluxosBoard).not.toHaveBeenCalled();
    expect(store.updateWorkflowPositions).not.toHaveBeenCalled();
  });

  // Task 8, fix round 2 (re-revisão): o fix round 1 só cobriu Cancelar (e o
  // eco assíncrono do Radix); "Enviar ao portal do cliente" resolve a MESMA
  // escolha de aprovação por um caminho que nunca passava por onDismiss --
  // ele faz um UPDATE direto (sendToPortal), nunca toca pendingInsertRef por
  // si só. Reproduz o MESMO leak do teste anterior, mas terminando a escolha
  // em "Enviar ao portal" em vez de Cancelar.
  it('"Enviar ao portal" de um post arrastado não deixa o próximo comando por BOTÃO herdar a posição do drag', async () => {
    const post = makeApprovalPostEntity();
    const qc = makeQueryClient();
    const { rerender } = rtlRender(
      <QueryClientProvider client={qc}>
        <KanbanView {...baseProps} postEntities={[post]} />
      </QueryClientProvider>,
    );
    expect(dndHandlers.onDragEnd).toBeDefined();

    // 1) Drag para frente ("Aprovação" -> "Publicação"): seta pendingInsertRef
    // e abre o ForwardConfirmDialog do hook.
    const overId = emptyColumnOverId(post, 2);
    await act(async () => {
      await dndHandlers.onDragEnd?.({ active: { id: 'post:9' }, over: { id: overId } });
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Avançar' }));

    // 2) A etapa ativa é de aprovação do cliente e o post ainda não está
    // liberado (aprovado_interno) -- decideThenRun abre a escolha.
    fireEvent.click(await screen.findByRole('button', { name: 'Enviar ao portal do cliente' }));

    // 3) Com o fix, "Enviar ao portal" passa por dismissChoice() (mesmo
    // caminho do Cancelar) ANTES de rodar sendToPortal -- pendingInsertRef já
    // deve estar limpo aqui, e nenhuma transição de etapa roda.
    await waitFor(() =>
      expect(store.updateWorkflowPost).toHaveBeenCalledWith(109, { status: 'enviado_cliente' }),
    );
    expect(store.transitionPostProcess).not.toHaveBeenCalled();

    // 4) Comando por BOTÃO (não-drag) no MESMO post -- nunca seta
    // pendingInsertRef por si só.
    fireEvent.click(screen.getByRole('button', { name: 'Voltar etapa' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reverter' }));
    await waitFor(() => expect(store.transitionPostProcess).toHaveBeenCalledTimes(1));
    expect(store.transitionPostProcess.mock.calls[0][0]).toMatchObject({
      processId: 9,
      command: 'voltar',
    });

    // 5) Simula o refetch que reflete a etapa nova -- é o que aciona o
    // catch-up effect que replicaria a posição de um drag abandonado.
    const revertedPost: PostEntity = {
      ...post,
      etapaOrdem: 0,
      etapaNome: 'Copy',
      process: { ...post.process, etapa_atual: 0 } as never,
    };
    rerender(
      <QueryClientProvider client={qc}>
        <KanbanView {...baseProps} postEntities={[revertedPost]} />
      </QueryClientProvider>,
    );

    // A posição capturada pelo drag encerrado em "Enviar ao portal" nunca
    // pode ser reproduzida pelo comando disparado por botão.
    await waitFor(() => expect(store.transitionPostProcess).toHaveBeenCalledTimes(1));
    expect(store.reorderFluxosBoard).not.toHaveBeenCalled();
    expect(store.updateWorkflowPositions).not.toHaveBeenCalled();
  });
});

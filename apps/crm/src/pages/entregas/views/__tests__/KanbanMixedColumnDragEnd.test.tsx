import React from 'react';
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Mesma técnica do PostsKanbanView.test.tsx (view diferente, mesmo dnd-kit):
// mocka @dnd-kit/core e @dnd-kit/sortable para capturar os handlers que o
// DndContext/SortableContext recebem, em vez de simular pointer/touch events
// reais em jsdom. arrayMove é reimplementado de verdade (não é um stub) porque
// handleDragEnd usa o valor de retorno para montar a ordem persistida.
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
vi.mock('../../components/PostProcessCard', () => ({
  PostProcessCard: ({ entity }: { entity: { titulo: string } }) => (
    <div data-testid="post-process-card">{entity.titulo}</div>
  ),
}));

import { KanbanView } from '../KanbanView';
import type { BoardCard } from '../../hooks/useEntregasData';
import type { PostEntity } from '../../boardEntity';

const ETAPAS = [
  { id: 1, ordem: 0, nome: 'Copy', tipo: 'padrao' as const },
  { id: 2, ordem: 1, nome: 'Design', tipo: 'padrao' as const },
].map((e) => ({
  ...e,
  workflow_id: 1,
  prazo_dias: 1,
  tipo_prazo: 'corridos' as const,
  status: 'pendente' as const,
}));

// Fluxo e post na MESMA coluna (etapa 'Design', ordem 1) da MESMA linha
// (template:7): position/posicao 0 e 1 respectivamente, para que a ordem
// EXIBIDA (modo prazo, desempate por posicao) seja determinística: ['1', 'post:9'].
const workflowCard: BoardCard = {
  workflow: {
    id: 1,
    cliente_id: 1,
    titulo: 'Fluxo A',
    status: 'ativo',
    etapa_atual: 1,
    recorrente: false,
    template_id: 7,
    position: 0,
  },
  etapa: { ...ETAPAS[1], status: 'ativo' },
  cliente: undefined,
  membro: undefined,
  deadline: { diasRestantes: 2, horasRestantes: 0, estourado: false, urgente: false },
  totalEtapas: 2,
  etapaIdx: 1,
  allEtapas: ETAPAS,
} as unknown as BoardCard;

const postProcessCard: PostEntity = {
  kind: 'post',
  id: 'post:9',
  process: { id: 9, post_id: 109, template_id: 7 } as never,
  step: { ordem: 1 } as never,
  templateId: 7,
  steps: ETAPAS.map((e) => ({ ordem: e.ordem, nome: e.nome, tipo: e.tipo })),
  etapaOrdem: 1,
  etapaNome: 'Design',
  responsavel: undefined,
  prazoEfetivo: null,
  posicao: 1,
  deadline: { diasRestantes: 0, horasRestantes: 0, estourado: false, urgente: false },
  cliente: undefined,
  titulo: 'Post Individual A',
};

describe('KanbanView drag-and-drop em coluna mista', () => {
  it('arrastar um fluxo por sobre um post na mesma coluna chama reorderFluxosBoard com os ids e positions certos', async () => {
    render(
      <KanbanView
        cards={[workflowCard]}
        postEntities={[postProcessCard]}
        postProcessesEnabled
        onCardClick={() => {}}
        onEditClick={() => {}}
        onPostsClick={() => {}}
        onRefresh={() => {}}
        onRecurring={() => {}}
        membros={[]}
        templates={[{ id: 7, nome: 'Redes', etapas: [] } as never]}
        postsCounts={new Map()}
        approvedPostsCounts={new Map()}
        clearedClienteCounts={new Map()}
        revisaoInternaCounts={new Map()}
        awaitingClienteCounts={new Map()}
      />,
    );

    expect(dndHandlers.onDragEnd).toBeDefined();

    // Arrasta o fluxo (id '1') para depois do post (id 'post:9'), dentro da
    // MESMA coluna: dispara o branch de reorder same-column de handleDragEnd.
    await act(async () => {
      await dndHandlers.onDragEnd?.({ active: { id: '1' }, over: { id: 'post:9' } });
    });

    expect(store.reorderFluxosBoard).toHaveBeenCalledTimes(1);
    expect(store.reorderFluxosBoard).toHaveBeenCalledWith({
      workflowIds: [1],
      workflowPositions: [1],
      processIds: [9],
      processPositions: [0],
    });
    // Nenhum fallback para o caminho só-de-fluxos: a RPC mista é a única
    // chamada de persistência quando a coluna tem um post.
    expect(store.updateWorkflowPositions).not.toHaveBeenCalled();
  });
});

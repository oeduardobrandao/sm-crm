import React from 'react';
import { fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const store = vi.hoisted(() => ({
  completeEtapa: vi.fn(),
  hasLaterApprovalEtapa: vi.fn(),
  sendPostsToCliente: vi.fn(),
  revertEtapa: vi.fn(),
  updateWorkflowPositions: vi.fn(),
  reorderFluxosBoard: vi.fn(),
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
  getDiscussaoNaoLidas: vi.fn(),
}));
vi.mock('../../../../store', () => store);
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('../../components/PropertyDefinitionPanel', () => ({
  PropertyDefinitionPanel: () => <div>PropertyDefinitionPanel</div>,
}));
vi.mock('../../components/WorkflowCard', () => ({
  WorkflowCard: ({
    card,
    dragHandle,
    onDeleteClick,
    discussaoNaoLidas,
  }: {
    card: { workflow: { titulo: string } };
    dragHandle?: React.ReactNode;
    onDeleteClick?: () => void;
    discussaoNaoLidas?: number;
  }) => (
    <div data-testid="workflow-card" data-discussao={discussaoNaoLidas ?? ''}>
      {card.workflow.titulo}
      {dragHandle && <span data-testid="drag-handle" />}
      {onDeleteClick && (
        <button type="button" onClick={onDeleteClick}>
          Excluir fluxo
        </button>
      )}
    </div>
  ),
}));
vi.mock('../../components/PostProcessCard', () => ({
  PostProcessCard: ({
    entity,
    onClick,
    onForwardClick,
    onRevertClick,
    dragHandle,
    forwardLabel,
    canRevert,
    onRemoveProcessClick,
    onDeleteClick,
    discussaoNaoLidas,
  }: {
    entity: { titulo: string };
    discussaoNaoLidas?: number;
    onClick?: () => void;
    onForwardClick?: () => void;
    onRevertClick?: () => void;
    dragHandle?: React.ReactNode;
    forwardLabel?: string;
    canRevert?: boolean;
    onRemoveProcessClick?: () => void;
    onDeleteClick?: () => void;
  }) => (
    <div data-testid="post-process-card" data-discussao={discussaoNaoLidas ?? ''} onClick={onClick}>
      {entity.titulo}
      {dragHandle && <span data-testid="drag-handle" />}
      {onForwardClick && (
        <button type="button" onClick={onForwardClick}>
          {forwardLabel ?? 'Avançar etapa'}
        </button>
      )}
      {canRevert && onRevertClick && (
        <button type="button" onClick={onRevertClick}>
          Voltar etapa
        </button>
      )}
      {onRemoveProcessClick && (
        <button type="button" onClick={onRemoveProcessClick}>
          Encerrar processo
        </button>
      )}
      {onDeleteClick && (
        <button type="button" onClick={onDeleteClick}>
          Excluir post
        </button>
      )}
    </div>
  ),
}));

import { KanbanView } from '../KanbanView';
import type { BoardCard } from '../../hooks/useEntregasData';
import type { PostEntity } from '../../boardEntity';

// Desktop layout: the phone branch (below 768px, what jsdom's matchMedia reports)
// has its own suites.
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));

// usePostProcessCommands usa useQueryClient (fase 4): todo render do KanbanView
// agora precisa de um QueryClientProvider por cima, mesmo em testes que só
// exercitam fluxos.
function render(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

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

const card = {
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

// process.steps/etapa_atual/post precisam ser realistas (fase 4): o
// SortablePostCard, real dentro do KanbanView (só o PostProcessCard é
// mockado), chama previousStepOf/nextPendingStepOf/canConcluir/forwardLabelFor
// sobre entity.process para montar canRevert/forwardLabel e o targetOf usado
// pelos comandos -- essas funções leem process.steps/etapa_atual/post de
// verdade, um `as never` vazio quebra em runtime.
function postEntity(id: number, ordem: number, titulo: string): PostEntity {
  const steps = ETAPAS.map((e) => ({ ordem: e.ordem, nome: e.nome, tipo: e.tipo }));
  const processSteps = ETAPAS.map((e) => ({
    ordem: e.ordem,
    nome: e.nome,
    tipo: e.tipo,
    estado: e.ordem === ordem ? 'ativo' : e.ordem < ordem ? 'concluido' : 'pendente',
  }));
  return {
    kind: 'post',
    id: `post:${id}`,
    process: {
      id,
      post_id: 100 + id,
      template_id: 7,
      etapa_atual: ordem,
      revisao: 1,
      steps: processSteps,
      post: { id: 100 + id, titulo, status: 'rascunho', cliente_id: null },
    } as never,
    step: { ordem } as never,
    templateId: 7,
    steps,
    etapaOrdem: ordem,
    etapaNome: steps[ordem].nome,
    responsavel: undefined,
    prazoEfetivo: null,
    posicao: 0,
    deadline: { diasRestantes: 0, horasRestantes: 0, estourado: false, urgente: false },
    cliente: undefined,
    titulo,
  };
}

function renderBoard(
  posts: PostEntity[],
  extra: Partial<React.ComponentProps<typeof KanbanView>> = {},
) {
  render(
    <KanbanView
      cards={[card]}
      postEntities={posts}
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
      {...extra}
    />,
  );
}

describe('KanbanView discussion badges', () => {
  beforeEach(() => {
    store.getDiscussaoNaoLidas.mockReset();
  });

  it('asks the RPC ONCE for every visible card: workflow ids for fluxos, post ids for post cards', async () => {
    store.getDiscussaoNaoLidas.mockResolvedValue([]);
    renderBoard([postEntity(9, 1, 'Post A'), postEntity(10, 0, 'Post B')]);
    await waitFor(() => expect(store.getDiscussaoNaoLidas).toHaveBeenCalled());
    expect(store.getDiscussaoNaoLidas).toHaveBeenCalledTimes(1);
    expect(store.getDiscussaoNaoLidas).toHaveBeenCalledWith({
      postIds: [109, 110],
      workflowIds: [1],
    });
  });

  it('hands the flow its summed unread count and each post card its own', async () => {
    store.getDiscussaoNaoLidas.mockResolvedValue([
      { postId: 501, workflowId: 1, total: 4, naoLidas: 2 },
      { postId: 502, workflowId: 1, total: 3, naoLidas: 1 },
      { postId: 109, workflowId: null, total: 5, naoLidas: 4 },
      { postId: 110, workflowId: null, total: 2, naoLidas: 0 },
    ]);
    renderBoard([postEntity(9, 1, 'Post A'), postEntity(10, 0, 'Post B')]);
    await waitFor(() =>
      expect(screen.getByTestId('workflow-card')).toHaveAttribute('data-discussao', '3'),
    );
    const cardOf = (titulo: string) =>
      screen.getByText(titulo).closest('[data-testid="post-process-card"]');
    expect(cardOf('Post A')).toHaveAttribute('data-discussao', '4');
    expect(cardOf('Post B')).toHaveAttribute('data-discussao', '0');
  });

  it('does not call the RPC for an empty board', () => {
    renderBoard([], { cards: [] });
    expect(store.getDiscussaoNaoLidas).not.toHaveBeenCalled();
  });
});

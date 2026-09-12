import React from 'react';
import { fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const store = vi.hoisted(() => ({
  completeEtapa: vi.fn(),
  completeEtapaWithRearm: vi.fn(),
  hasLaterApprovalEtapa: vi.fn(),
  approvePostsInternally: vi.fn(),
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
  WorkflowCard: ({
    card,
    dragHandle,
    onDeleteClick,
  }: {
    card: { workflow: { titulo: string } };
    dragHandle?: React.ReactNode;
    onDeleteClick?: () => void;
  }) => (
    <div data-testid="workflow-card">
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
  }: {
    entity: { titulo: string };
    onClick?: () => void;
    onForwardClick?: () => void;
    onRevertClick?: () => void;
    dragHandle?: React.ReactNode;
    forwardLabel?: string;
    canRevert?: boolean;
    onRemoveProcessClick?: () => void;
    onDeleteClick?: () => void;
  }) => (
    <div data-testid="post-process-card" onClick={onClick}>
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
  onPostClick = vi.fn(),
  extra: Partial<React.ComponentProps<typeof KanbanView>> = {},
) {
  render(
    <KanbanView
      cards={[card]}
      postEntities={posts}
      postProcessesEnabled
      onPostClick={onPostClick}
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
  return onPostClick;
}

describe('KanbanView com posts individuais', () => {
  // Antes da fase 4 os posts não tinham alça (só o fluxo, length 1); a fase 4
  // torna o post individual arrastável, então os dois posts também mostram a
  // alça agora -- 1 fluxo + 2 posts.
  it('renderiza o post na coluna da própria etapa, com alça de arrastar, e divide a contagem por tipo', () => {
    renderBoard([postEntity(9, 1, 'Post Individual A'), postEntity(10, 0, 'Post Individual B')]);
    expect(screen.getByText('Fluxo A')).toBeInTheDocument();
    expect(screen.getAllByTestId('post-process-card')).toHaveLength(2);
    expect(screen.getByText('1 fluxo · 1 post')).toBeInTheDocument(); // coluna Design
    expect(screen.getByText('1')).toBeInTheDocument(); // coluna Copy: só posts
    expect(screen.getAllByTestId('drag-handle')).toHaveLength(3); // fluxo + 2 posts (fase 4)
  });

  it('clicar no card do post chama onPostClick com a entidade', () => {
    const onPostClick = renderBoard([postEntity(9, 1, 'Post Individual A')]);
    fireEvent.click(screen.getByText('Post Individual A'));
    expect(onPostClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'post:9' }));
  });

  it('uma coluna só com posts não mostra "Nenhuma entrega"; um quadro só com posts não mostra o vazio', () => {
    render(
      <KanbanView
        cards={[]}
        postEntities={[postEntity(9, 1, 'Só post')]}
        postProcessesEnabled
        onCardClick={() => {}}
        onEditClick={() => {}}
        onPostsClick={() => {}}
        onRefresh={() => {}}
        onRecurring={() => {}}
        membros={[]}
        templates={[]}
        postsCounts={new Map()}
        approvedPostsCounts={new Map()}
        clearedClienteCounts={new Map()}
        revisaoInternaCounts={new Map()}
        awaitingClienteCounts={new Map()}
      />,
    );
    expect(screen.getByText('Só post')).toBeInTheDocument();
    expect(screen.queryByText(/Nenhum fluxo ou post individual encontrado/)).toBeNull();
  });

  it('post na coluna: botão Avançar abre a confirmação e chama transition_post_process', async () => {
    store.transitionPostProcess.mockResolvedValue({
      ok: true,
      revisao: 2,
      post_status: 'rascunho',
      post_status_changed: false,
      steps: [],
    });
    // ordem 0 (Copy): tem uma próxima etapa pendente (Design), então o rótulo
    // é "Avançar etapa" e não "Concluir processo".
    const entity = postEntity(9, 0, 'Post Individual A');
    renderBoard([entity]);
    fireEvent.click(screen.getByRole('button', { name: 'Avançar etapa' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Avançar' }));
    await waitFor(() =>
      expect(store.transitionPostProcess).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'avancar', processId: entity.process.id }),
      ),
    );
  });

  it('post na coluna tem alça de arrastar', () => {
    renderBoard([postEntity(9, 0, 'Post Individual A')]);
    expect(screen.getAllByTestId('drag-handle').length).toBeGreaterThan(0);
  });

  // Regressão: os itens de kebab dos cards são renderizados só quando o
  // handler existe, então uma prop não ligada deixa o menu vazio (bug real,
  // achado na revisão do redesign dos cards compactos).
  it('kebab do post: "Encerrar processo" passa pelo comando compartilhado e chama remove_post_process', async () => {
    store.removePostProcess.mockResolvedValue({ ok: true, revisao: 2 });
    const entity = postEntity(9, 0, 'Post Individual A');
    renderBoard([entity]);
    fireEvent.click(screen.getByRole('button', { name: 'Encerrar processo' }));
    // Diálogo do usePostProcessCommands, não um segundo diálogo da página.
    expect(await screen.findByText('Remover processo?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remover' }));
    await waitFor(() =>
      expect(store.removePostProcess).toHaveBeenCalledWith(
        entity.process.id,
        entity.process.revisao,
      ),
    );
  });

  it('kebab do post: "Excluir post" chama onDeletePostClick com a entidade', () => {
    const onDeletePostClick = vi.fn();
    const entity = postEntity(9, 0, 'Post Individual A');
    renderBoard([entity], vi.fn(), { onDeletePostClick });
    fireEvent.click(screen.getByRole('button', { name: 'Excluir post' }));
    expect(onDeletePostClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'post:9' }));
  });

  it('kebab do fluxo: "Excluir" chama onDeleteWorkflowClick com o card', () => {
    const onDeleteWorkflowClick = vi.fn();
    renderBoard([], vi.fn(), { onDeleteWorkflowClick });
    fireEvent.click(screen.getByRole('button', { name: 'Excluir fluxo' }));
    expect(onDeleteWorkflowClick).toHaveBeenCalledWith(
      expect.objectContaining({ workflow: expect.objectContaining({ id: 1 }) }),
    );
  });
});

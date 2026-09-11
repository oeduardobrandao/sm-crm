import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  completeEtapa: vi.fn(),
  completeEtapaWithRearm: vi.fn(),
  hasLaterApprovalEtapa: vi.fn(),
  approvePostsInternally: vi.fn(),
  sendPostsToCliente: vi.fn(),
  revertEtapa: vi.fn(),
  updateWorkflowPositions: vi.fn(),
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
  }: {
    card: { workflow: { titulo: string } };
    dragHandle?: React.ReactNode;
  }) => (
    <div data-testid="workflow-card">
      {card.workflow.titulo}
      {dragHandle && <span data-testid="drag-handle" />}
    </div>
  ),
}));
vi.mock('../../components/PostProcessCard', () => ({
  PostProcessCard: ({ entity, onClick }: { entity: { titulo: string }; onClick?: () => void }) => (
    <div data-testid="post-process-card" onClick={onClick}>
      {entity.titulo}
    </div>
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

function postEntity(id: number, ordem: number, titulo: string): PostEntity {
  const steps = ETAPAS.map((e) => ({ ordem: e.ordem, nome: e.nome, tipo: e.tipo }));
  return {
    kind: 'post',
    id: `post:${id}`,
    process: { id, post_id: 100 + id, template_id: 7 } as never,
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

function renderBoard(posts: PostEntity[], onPostClick = vi.fn()) {
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
    />,
  );
  return onPostClick;
}

describe('KanbanView com posts individuais', () => {
  it('renderiza o post na coluna da própria etapa, sem alça, e divide a contagem por tipo', () => {
    renderBoard([postEntity(9, 1, 'Post Individual A'), postEntity(10, 0, 'Post Individual B')]);
    expect(screen.getByText('Fluxo A')).toBeInTheDocument();
    expect(screen.getAllByTestId('post-process-card')).toHaveLength(2);
    expect(screen.getByText('1 fluxo · 1 post')).toBeInTheDocument(); // coluna Design
    expect(screen.getByText('1')).toBeInTheDocument(); // coluna Copy: só posts
    expect(screen.getAllByTestId('drag-handle')).toHaveLength(1); // só o fluxo
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
});

import React from 'react';
import { render, screen } from '@testing-library/react';
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
  WorkflowCard: ({ card }: { card: { workflow: { titulo: string } } }) => (
    <div>{card.workflow.titulo}</div>
  ),
}));

import { KanbanView } from '../KanbanView';
import type { BoardCard } from '../../hooks/useEntregasData';

const ETAPAS = [
  { id: 1, ordem: 0, nome: 'Copy', tipo: 'padrao' as const },
  { id: 2, ordem: 1, nome: 'Aprovação', tipo: 'aprovacao_cliente' as const },
  { id: 3, ordem: 2, nome: 'Design', tipo: 'padrao' as const },
  { id: 4, ordem: 3, nome: 'Aprovação', tipo: 'aprovacao_cliente' as const },
].map((e) => ({ ...e, workflow_id: 1, prazo_dias: 1, tipo_prazo: 'corridos' as const, status: 'pendente' as const }));

function makeCard(wfId: number, titulo: string, ativaOrdem: number): BoardCard {
  const etapa = { ...ETAPAS[ativaOrdem], status: 'ativo' as const };
  return {
    workflow: { id: wfId, cliente_id: 1, titulo, status: 'ativo', etapa_atual: ativaOrdem, recorrente: false, template_id: 7 },
    etapa,
    cliente: undefined,
    membro: undefined,
    deadline: { diasRestantes: 1, horasRestantes: 0, estourado: false, urgente: false },
    totalEtapas: 4,
    etapaIdx: ativaOrdem,
    allEtapas: ETAPAS,
  } as unknown as BoardCard;
}

function boardProps(cards: BoardCard[]) {
  return {
    cards,
    onCardClick: () => {},
    onEditClick: () => {},
    onPostsClick: () => {},
    onRefresh: () => {},
    onRecurring: () => {},
    membros: [],
    templates: [],
    postsCounts: new Map<number, number>(),
    approvedPostsCounts: new Map<number, number>(),
    clearedClienteCounts: new Map<number, number>(),
    revisaoInternaCounts: new Map<number, number>(),
    awaitingClienteCounts: new Map<number, number>(),
  };
}

describe('KanbanView com etapas de mesmo nome', () => {
  it('renderiza duas colunas "Aprovação" e coloca cada card na sua', () => {
    const { container } = render(
      <KanbanView {...boardProps([makeCard(1, 'Primeira aprovação', 1), makeCard(2, 'Segunda aprovação', 3)])} />,
    );
    const titles = [...container.querySelectorAll('.board-column-title')].map((el) => el.textContent);
    expect(titles).toEqual(['Copy', 'Aprovação', 'Design', 'Aprovação']);

    const columns = container.querySelectorAll('.board-column');
    expect(columns[1].textContent).toContain('Primeira aprovação');
    expect(columns[1].textContent).not.toContain('Segunda aprovação');
    expect(columns[3].textContent).toContain('Segunda aprovação');
  });

  it('marca as duas colunas de aprovação para o tour', () => {
    const { container } = render(<KanbanView {...boardProps([makeCard(1, 'A', 0)])} />);
    expect(container.querySelectorAll('[data-tour="wf-col-aprovacao"]')).toHaveLength(2);
  });
});

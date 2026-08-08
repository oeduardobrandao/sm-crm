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

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('../../components/PropertyDefinitionPanel', () => ({
  PropertyDefinitionPanel: () => <div>PropertyDefinitionPanel</div>,
}));

// Render only the title: this suite tests prop→board synchronization.
vi.mock('../../components/WorkflowCard', () => ({
  WorkflowCard: ({ card }: { card: { workflow: { titulo: string } } }) => (
    <div>{card.workflow.titulo}</div>
  ),
}));

import { KanbanView } from '../KanbanView';
import type { BoardCard } from '../../hooks/useEntregasData';

const etapa = {
  id: 11,
  workflow_id: 1,
  ordem: 1,
  nome: 'Produção',
  prazo_dias: 2,
  tipo_prazo: 'corridos' as const,
  tipo: 'padrao' as const,
  status: 'ativo' as const,
};

function makeCard(titulo: string): BoardCard {
  return {
    workflow: {
      id: 1,
      cliente_id: 1,
      titulo,
      status: 'ativo',
      etapa_atual: 1,
      recorrente: false,
    },
    etapa,
    cliente: undefined,
    membro: undefined,
    deadline: { diasRestantes: 2, horasRestantes: 0, estourado: false, urgente: false },
    totalEtapas: 2,
    etapaIdx: 1,
    allEtapas: [etapa],
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

describe('KanbanView prop → board synchronization', () => {
  it('reflects an edited title without a remount (same workflow/etapa ids)', () => {
    const { rerender } = render(<KanbanView {...boardProps([makeCard('Posts Agosto')])} />);
    expect(screen.getByText('Posts Agosto')).toBeInTheDocument();

    rerender(<KanbanView {...boardProps([makeCard('Posts Setembro')])} />);
    expect(screen.getByText('Posts Setembro')).toBeInTheDocument();
    expect(screen.queryByText('Posts Agosto')).not.toBeInTheDocument();
  });

  it('drops a deleted workflow from the board', () => {
    const { rerender } = render(<KanbanView {...boardProps([makeCard('Posts Agosto')])} />);
    expect(screen.getByText('Posts Agosto')).toBeInTheDocument();

    rerender(<KanbanView {...boardProps([])} />);
    expect(screen.queryByText('Posts Agosto')).not.toBeInTheDocument();
  });
});

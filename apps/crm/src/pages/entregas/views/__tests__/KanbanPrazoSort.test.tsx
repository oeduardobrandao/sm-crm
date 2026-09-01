import React from 'react';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('../../components/WorkflowCard', () => ({
  WorkflowCard: ({ card }: { card: { workflow: { titulo: string } } }) => (
    <div className="test-card-title">{card.workflow.titulo}</div>
  ),
}));

import { KanbanView } from '../KanbanView';
import type { BoardCard } from '../../hooks/useEntregasData';

function makeCard(
  id: number,
  titulo: string,
  position: number,
  dataLimite: string | null,
): BoardCard {
  const etapa = {
    id: id * 10,
    workflow_id: id,
    ordem: 1,
    nome: 'Produção',
    prazo_dias: 2,
    tipo_prazo: 'corridos' as const,
    tipo: 'padrao' as const,
    status: 'ativo' as const,
    data_limite: dataLimite,
    iniciado_em: null,
  };
  return {
    workflow: {
      id,
      cliente_id: 1,
      titulo,
      status: 'ativo',
      etapa_atual: 1,
      recorrente: false,
      position,
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
    contaId: 'conta-teste',
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

// Atrasado (2026-01-01) vs futuro (2099-01-01) vs sem prazo, com positions
// invertidas de propósito: o modo padrão 'prazo' deve ignorá-las.
const CARDS = [
  makeCard(1, 'Sem prazo', 0, null),
  makeCard(2, 'Futuro', 1, '2099-01-01'),
  makeCard(3, 'Atrasado', 2, '2026-01-01'),
];

function renderedTitles(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.test-card-title')].map((n) => n.textContent ?? '');
}

describe('KanbanView per-column prazo sort', () => {
  beforeEach(() => localStorage.clear());

  it('default mode orders by shortest deadline first (atrasados > futuro > sem prazo)', () => {
    const { container } = render(<KanbanView {...boardProps(CARDS)} />);
    expect(renderedTitles(container)).toEqual(['Atrasado', 'Futuro', 'Sem prazo']);
  });

  it('a persisted manual pref keeps the position order for that column', () => {
    localStorage.setItem(
      'entregas_fluxos_sorts_conta-teste',
      JSON.stringify({ 'Produção::Produção': 'manual' }),
    );
    const { container } = render(<KanbanView {...boardProps(CARDS)} />);
    expect(renderedTitles(container)).toEqual(['Sem prazo', 'Futuro', 'Atrasado']);
  });

  it('renders the sort menu trigger on the column header', () => {
    const { container } = render(<KanbanView {...boardProps(CARDS)} />);
    expect(container.querySelector('[aria-label="Ordenar coluna Produção"]')).not.toBeNull();
  });
});

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../store', () => ({
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
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { fullColumnOrder } from '../KanbanView';
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

function card(id: number, position: number): BoardCard {
  return {
    workflow: {
      id,
      cliente_id: 1,
      titulo: `WF ${id}`,
      status: 'ativo',
      etapa_atual: 1,
      recorrente: false,
      template_id: 7,
      position,
    },
    etapa: { ...etapa, workflow_id: id },
    cliente: undefined,
    membro: undefined,
    deadline: { diasRestantes: 2, horasRestantes: 0, estourado: false, urgente: false },
    totalEtapas: 2,
    etapaIdx: 1,
    allEtapas: [{ ...etapa, workflow_id: id }],
  } as unknown as BoardCard;
}

describe('fullColumnOrder', () => {
  it('em modo manual devolve a coluna inteira por position, incluindo ocultos', () => {
    const all = [card(1, 0), card(2, 1), card(3, 2)];
    const visible = [all[0], all[2]];
    expect(fullColumnOrder(all, visible, 'template:7', 1, [], 'manual')).toEqual([1, 2, 3]);
  });

  it('sem allCards cai na lista visível', () => {
    const visible = [card(3, 0), card(1, 1)];
    expect(fullColumnOrder(undefined, visible, 'template:7', 1, [], 'manual')).toEqual([3, 1]);
  });
});

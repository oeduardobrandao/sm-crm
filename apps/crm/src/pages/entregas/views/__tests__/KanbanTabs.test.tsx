import React from 'react';
import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
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
  // Fase 4: usePostProcessCommands (chamado incondicionalmente pelo
  // KanbanView) importa estes três do store.
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

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('../../components/PropertyDefinitionPanel', () => ({
  PropertyDefinitionPanel: () => <div>PropertyDefinitionPanel</div>,
}));

// Render only the title: this suite tests the tab strip, not workflow card internals.
vi.mock('../../components/WorkflowCard', () => ({
  WorkflowCard: ({ card }: { card: { workflow: { titulo: string } } }) => (
    <div>{card.workflow.titulo}</div>
  ),
}));

import { KanbanView } from '../KanbanView';
import type { BoardCard } from '../../hooks/useEntregasData';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function QueryWrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
function render(ui: React.ReactElement) {
  return rtlRender(ui, { wrapper: QueryWrapper });
}

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

function makeCard(titulo: string, workflowId: number, templateId: number | null): BoardCard {
  return {
    workflow: {
      id: workflowId,
      cliente_id: 1,
      titulo,
      status: 'ativo',
      etapa_atual: 1,
      recorrente: false,
      template_id: templateId,
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

describe('KanbanView board tab strip', () => {
  it('shows the tab strip with a single board row, and the columns still render', () => {
    const { container } = render(<KanbanView {...boardProps([makeCard('Posts Agosto', 1, 1)])} />);

    expect(container.querySelectorAll('.board-tab:not(.board-tab-add)')).toHaveLength(1);
    expect(container.querySelectorAll('.board-column').length).toBeGreaterThan(0);
  });

  it('renders the "+" tab when onCreateTemplate is provided and calls it once on click', () => {
    const onCreateTemplate = vi.fn();
    render(
      <KanbanView
        {...boardProps([makeCard('Posts Agosto', 1, 1)])}
        onCreateTemplate={onCreateTemplate}
      />,
    );

    const addBtn = screen.getByLabelText('Novo template');
    fireEvent.click(addBtn);
    expect(onCreateTemplate).toHaveBeenCalledTimes(1);
  });

  it('renders the "+" tab as the last child of .board-tabs, after every real template tab', () => {
    const onCreateTemplate = vi.fn();
    const { container } = render(
      <KanbanView
        {...boardProps([makeCard('Posts Agosto', 1, 1), makeCard('Posts Setembro', 2, 2)])}
        onCreateTemplate={onCreateTemplate}
      />,
    );

    const tabStripButtons = [...container.querySelectorAll('.board-tabs > button')];
    expect(tabStripButtons.length).toBe(3);
    expect(tabStripButtons.at(-1)).toHaveClass('board-tab-add');
    expect(
      tabStripButtons.slice(0, -1).every((btn) => !btn.classList.contains('board-tab-add')),
    ).toBe(true);
  });

  it('renders no .board-tab-add element when onCreateTemplate is omitted', () => {
    const { container } = render(<KanbanView {...boardProps([makeCard('Posts Agosto', 1, 1)])} />);

    expect(container.querySelectorAll('.board-tab-add')).toHaveLength(0);
  });

  it('the "+" button does not have role="tab"', () => {
    render(
      <KanbanView {...boardProps([makeCard('Posts Agosto', 1, 1)])} onCreateTemplate={() => {}} />,
    );

    const addBtn = screen.getByLabelText('Novo template');
    expect(addBtn).not.toHaveAttribute('role', 'tab');
  });

  it('disables the "+" button and shows the limit tooltip when createTemplateDisabled is true', () => {
    const onCreateTemplate = vi.fn();
    render(
      <KanbanView
        {...boardProps([makeCard('Posts Agosto', 1, 1)])}
        onCreateTemplate={onCreateTemplate}
        createTemplateDisabled
      />,
    );

    const addBtn = screen.getByLabelText('Novo template');
    expect(addBtn).toBeDisabled();
    expect(addBtn).toHaveAttribute('title', 'Limite do plano atingido');

    fireEvent.click(addBtn);
    expect(onCreateTemplate).not.toHaveBeenCalled();
  });
});

import React from 'react';
import { fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Spec §3, "+ Novo ▾" da coluna: "Fluxo" (comportamento atual) e "Post
// individual" (atrás de postProcessesEnabled + a linha ter template). Same
// flat-dropdown pattern as PostsKanbanView.test.tsx -- Radix's portal/pointer
// machinery isn't implemented in jsdom, so the mock forwards onSelect
// straight to a plain <button onClick>.
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children: React.ReactNode;
    onSelect?: () => void;
  }) => (
    <button type="button" onClick={onSelect}>
      {children}
    </button>
  ),
}));

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
  WorkflowCard: ({ card }: { card: { workflow: { titulo: string } } }) => (
    <div className="test-card-title">{card.workflow.titulo}</div>
  ),
}));

import { KanbanView } from '../KanbanView';
import type { BoardCard } from '../../hooks/useEntregasData';

function render(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const ETAPA = {
  id: 1,
  workflow_id: 1,
  ordem: 0,
  nome: 'Copy',
  tipo: 'padrao' as const,
  prazo_dias: 1,
  tipo_prazo: 'corridos' as const,
  status: 'ativo' as const,
};

// template_id: 7 puts this row's templateId at 7 (boardEntity.toWorkflowEntity
// mirrors card.workflow.template_id) -- without a template, colIdx 0 keeps
// the plain "+ Novo fluxo" button with no dropdown (item 3's other branch).
function cardWithTemplate(templateId: number | null): BoardCard {
  return {
    workflow: {
      id: 1,
      cliente_id: 1,
      titulo: 'Fluxo A',
      status: 'ativo',
      etapa_atual: 0,
      recorrente: false,
      template_id: templateId,
      position: 0,
    },
    etapa: ETAPA,
    cliente: undefined,
    membro: undefined,
    deadline: { diasRestantes: 2, horasRestantes: 0, estourado: false, urgente: false },
    totalEtapas: 1,
    etapaIdx: 0,
    allEtapas: [ETAPA],
  } as unknown as BoardCard;
}

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    cards: [cardWithTemplate(7)],
    onCardClick: () => {},
    onEditClick: () => {},
    onPostsClick: () => {},
    onRefresh: () => {},
    onRecurring: () => {},
    onAddWorkflow: vi.fn(),
    membros: [],
    templates: [{ id: 7, nome: 'Redes', etapas: [] } as never],
    postsCounts: new Map(),
    approvedPostsCounts: new Map(),
    clearedClienteCounts: new Map(),
    revisaoInternaCounts: new Map(),
    awaitingClienteCounts: new Map(),
    ...overrides,
  };
}

describe('KanbanView "+ Novo ▾" da coluna (spec §3)', () => {
  it('sem template na linha: mantém o botão simples "+ Novo fluxo", sem dropdown', () => {
    render(
      <KanbanView
        {...(baseProps({
          cards: [cardWithTemplate(null)],
          onAddWorkflow: vi.fn(),
          postProcessesEnabled: true,
          onAddPostIndividual: vi.fn(),
        }) as never)}
      />,
    );
    expect(screen.getByText('Novo fluxo')).toBeInTheDocument();
    expect(screen.queryByText('Post individual')).not.toBeInTheDocument();
    expect(screen.queryByText('Fluxo')).not.toBeInTheDocument();
  });

  it('com template + postProcessesEnabled: dropdown com "Fluxo" e "Post individual"', () => {
    const onAddWorkflow = vi.fn();
    const onAddPostIndividual = vi.fn();
    render(
      <KanbanView
        {...(baseProps({
          postProcessesEnabled: true,
          onAddWorkflow,
          onAddPostIndividual,
        }) as never)}
      />,
    );

    expect(screen.getByText('Novo ▾')).toBeInTheDocument();
    expect(screen.getByText('Fluxo')).toBeInTheDocument();
    expect(screen.getByText('Post individual')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Fluxo'));
    expect(onAddWorkflow).toHaveBeenCalledWith(7);

    fireEvent.click(screen.getByText('Post individual'));
    expect(onAddPostIndividual).toHaveBeenCalledWith(7);
  });

  it('com template mas sem postProcessesEnabled: mantém o botão simples, sem dropdown', () => {
    render(
      <KanbanView
        {...(baseProps({
          postProcessesEnabled: false,
          onAddPostIndividual: vi.fn(),
        }) as never)}
      />,
    );
    expect(screen.getByText('Novo fluxo')).toBeInTheDocument();
    expect(screen.queryByText('Novo ▾')).not.toBeInTheDocument();
    expect(screen.queryByText('Post individual')).not.toBeInTheDocument();
  });

  it('com template + postProcessesEnabled, mas sem onAddPostIndividual: mantém o botão simples, sem dropdown', () => {
    render(<KanbanView {...(baseProps({ postProcessesEnabled: true }) as never)} />);
    expect(screen.getByText('Novo fluxo')).toBeInTheDocument();
    expect(screen.queryByText('Novo ▾')).not.toBeInTheDocument();
    expect(screen.queryByText('Post individual')).not.toBeInTheDocument();
  });
});

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  completeEtapa: vi.fn(),
  completeEtapaWithRearm: vi.fn(),
  hasLaterApprovalEtapa: vi.fn(),
  approvePostsInternally: vi.fn(),
  sendPostsToCliente: vi.fn(),
  revertEtapa: vi.fn(),
  updateWorkflowPositions: vi.fn(),
  // Pulled in transitively by WorkflowModals / useEntregasData
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

// The card itself is not under test here — only the advance handlers it triggers.
vi.mock('../../components/WorkflowCard', () => ({
  WorkflowCard: ({ onForwardClick }: { onForwardClick?: () => void }) => (
    <button onClick={onForwardClick}>forward</button>
  ),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    type = 'button',
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type={type} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div>{children}</div> : null,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogAction: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => <button onClick={onClick}>{children}</button>,
  AlertDialogCancel: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => <button onClick={onClick}>{children}</button>,
}));

import { KanbanView } from '../KanbanView';
import type { BoardCard } from '../../hooks/useEntregasData';

const approvalEtapa = {
  id: 11,
  workflow_id: 1,
  ordem: 1,
  nome: 'Aprovação do texto',
  prazo_dias: 2,
  tipo_prazo: 'corridos' as const,
  tipo: 'aprovacao_cliente' as const,
  status: 'ativo' as const,
};
const nextEtapa = {
  id: 12,
  workflow_id: 1,
  ordem: 2,
  nome: 'Design',
  prazo_dias: 2,
  tipo_prazo: 'corridos' as const,
  tipo: 'padrao' as const,
  status: 'pendente' as const,
};

const card = {
  workflow: {
    id: 1,
    cliente_id: 1,
    titulo: 'Posts Agosto',
    status: 'ativo',
    etapa_atual: 1,
    recorrente: false,
  },
  etapa: approvalEtapa,
  cliente: undefined,
  membro: undefined,
  deadline: { diasRestantes: 2, horasRestantes: 0, estourado: false, urgente: false },
  totalEtapas: 3,
  etapaIdx: 1,
  allEtapas: [approvalEtapa, nextEtapa],
} as unknown as BoardCard;

function renderBoard(cleared: number, overrides: { onRefresh?: () => void } = {}) {
  return render(
    <KanbanView
      cards={[card]}
      onCardClick={() => {}}
      onEditClick={() => {}}
      onPostsClick={() => {}}
      onRefresh={overrides.onRefresh ?? (() => {})}
      onRecurring={() => {}}
      membros={[]}
      templates={[]}
      postsCounts={new Map([[1, 2]])}
      approvedPostsCounts={new Map()}
      clearedClienteCounts={new Map([[1, cleared]])}
      revisaoInternaCounts={new Map()}
      awaitingClienteCounts={new Map()}
    />,
  );
}

describe('KanbanView approval advance with re-arm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.completeEtapa.mockResolvedValue({ workflow: { status: 'ativo' }, etapas: [] });
    store.completeEtapaWithRearm.mockResolvedValue({
      workflow: { status: 'ativo' },
      etapas: [],
      rearmed: true,
      rearmFailed: false,
    });
    store.hasLaterApprovalEtapa.mockReturnValue(true);
    store.approvePostsInternally.mockResolvedValue(undefined);
    store.sendPostsToCliente.mockResolvedValue(undefined);
  });

  it('silent all-cleared advance uses completeEtapaWithRearm', async () => {
    renderBoard(2); // cleared === total → no approval dialog
    fireEvent.click(screen.getByText('forward'));
    fireEvent.click(await screen.findByText('Avançar'));
    await waitFor(() => expect(store.completeEtapaWithRearm).toHaveBeenCalledWith(1, 11));
    expect(store.completeEtapa).not.toHaveBeenCalled();
  });

  it('announces the re-arm with an info toast', async () => {
    renderBoard(2);
    fireEvent.click(screen.getByText('forward'));
    fireEvent.click(await screen.findByText('Avançar'));
    const { toast } = await import('sonner');
    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith(expect.stringMatching(/voltaram para rascunho/i)),
    );
  });

  it('"Avançar etapa sem alterar posts" uses plain completeEtapa', async () => {
    renderBoard(0); // not cleared → approval dialog
    fireEvent.click(screen.getByText('forward'));
    fireEvent.click(await screen.findByText('Avançar'));
    fireEvent.click(await screen.findByText('Avançar etapa sem alterar posts'));
    await waitFor(() => expect(store.completeEtapa).toHaveBeenCalledWith(1, 11));
    expect(store.completeEtapaWithRearm).not.toHaveBeenCalled();
  });

  it('"Aprovar internamente" approves then advances with re-arm', async () => {
    renderBoard(0);
    fireEvent.click(screen.getByText('forward'));
    fireEvent.click(await screen.findByText('Avançar'));
    fireEvent.click(await screen.findByText('Aprovar internamente'));
    await waitFor(() => expect(store.approvePostsInternally).toHaveBeenCalledWith(1));
    await waitFor(() => expect(store.completeEtapaWithRearm).toHaveBeenCalledWith(1, 11));
    expect(store.completeEtapa).not.toHaveBeenCalled();
  });

  it('shows the re-arm note in the approval dialog when another approval lies ahead', async () => {
    renderBoard(0);
    fireEvent.click(screen.getByText('forward'));
    fireEvent.click(await screen.findByText('Avançar'));
    expect(await screen.findByText(/voltarão para rascunho/i)).toBeInTheDocument();
    expect(store.hasLaterApprovalEtapa).toHaveBeenCalledWith([approvalEtapa, nextEtapa], 11);
  });

  it('hides the re-arm note when no later approval etapa exists', async () => {
    store.hasLaterApprovalEtapa.mockReturnValue(false);
    renderBoard(0);
    fireEvent.click(screen.getByText('forward'));
    fireEvent.click(await screen.findByText('Avançar'));
    expect(await screen.findByText('Aprovar internamente')).toBeInTheDocument();
    expect(screen.queryByText(/voltarão para rascunho/i)).not.toBeInTheDocument();
  });

  it('rearmFailed surfaces the manual-remediation toast and still refreshes', async () => {
    store.completeEtapaWithRearm.mockResolvedValue({
      workflow: { status: 'ativo' },
      etapas: [],
      rearmed: false,
      rearmFailed: true,
    });
    const onRefresh = vi.fn();
    renderBoard(2, { onRefresh });
    fireEvent.click(screen.getByText('forward'));
    fireEvent.click(await screen.findByText('Avançar'));
    const { toast } = await import('sonner');
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/reinicie os status/i)),
    );
    expect(onRefresh).toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });
});

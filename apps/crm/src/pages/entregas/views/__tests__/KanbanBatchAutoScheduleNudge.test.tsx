import React from 'react';
import { fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Task 4 — piece 2 of the auto-schedule nudge spec: the batch summary dialog
// opened right after "Aprovar todos" (saída de etapa de aprovação) in the Fluxos
// board. Follows KanbanApprovalExit.test.tsx's harness (store mock shape, dialog
// stubs) and adds only the batch-nudge-specific plumbing.

const store = vi.hoisted(() => ({
  completeEtapa: vi.fn(),
  advanceWorkflowFromApproval: vi.fn(),
  getWorkflowPostStatusCounts: vi.fn(),
  hasLaterApprovalEtapa: vi.fn(),
  sendPostsToCliente: vi.fn(),
  revertEtapa: vi.fn(),
  updateWorkflowPositions: vi.fn(),
  reorderFluxosBoard: vi.fn(),
  // Fase 4: usePostProcessCommands (chamado incondicionalmente pelo
  // KanbanView) importa estes três do store; nenhum teste deste arquivo
  // exercita um post, mas o módulo precisa resolver os nomes.
  transitionPostProcess: vi.fn(),
  removePostProcess: vi.fn(),
  updateWorkflowPost: vi.fn(),
  CLIENT_CLEARED_STATUSES: ['aprovado_cliente', 'agendado', 'postado', 'falha_publicacao'],
  // Pulled in transitively by WorkflowModals / useEntregasData
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

// Task 4's own dialog: stubbed per the brief so this file only proves whether
// it is opened, and with which workflow id. Task 2's suite (AutoScheduleBatchDialog.test.tsx)
// already covers its internal fetch/count/schedule logic.
vi.mock('../../components/AutoScheduleBatchDialog', () => ({
  AutoScheduleBatchDialog: ({ workflowId }: { workflowId: number | null }) =>
    workflowId ? <div data-testid="batch-nudge">{workflowId}</div> : null,
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
import { toast } from 'sonner';
import type { BoardCard } from '../../hooks/useEntregasData';

// Desktop layout: the phone branch (below 768px, what jsdom's matchMedia reports)
// has its own suites.
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));

// usePostProcessCommands usa useQueryClient (fase 4): todo render do
// KanbanView precisa de um QueryClientProvider por cima.
function render(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

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

function makeCard(overrides: Record<string, unknown> = {}): BoardCard {
  return {
    workflow: {
      id: 1,
      cliente_id: 1,
      titulo: 'Posts Agosto',
      status: 'ativo',
      etapa_atual: 1,
      recorrente: false,
    },
    etapa: approvalEtapa,
    // Ao contrário de KanbanApprovalExit.test.tsx (cliente: undefined), este arquivo
    // exercita o gate auto_publish_on_approval — o cliente precisa existir.
    cliente: { id: 1, nome: 'Aurora', auto_publish_on_approval: true },
    membro: undefined,
    deadline: { diasRestantes: 2, horasRestantes: 0, estourado: false, urgente: false },
    totalEtapas: 3,
    etapaIdx: 1,
    allEtapas: [approvalEtapa, nextEtapa],
    ...overrides,
  } as unknown as BoardCard;
}

function renderBoard(
  cleared: number,
  overrides: {
    card?: BoardCard;
    schedulingEnabled?: boolean;
    tiktokEnabled?: boolean;
    onRefresh?: () => void;
  } = {},
) {
  return render(
    <KanbanView
      cards={[overrides.card ?? makeCard()]}
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
      schedulingEnabled={overrides.schedulingEnabled ?? true}
      tiktokEnabled={overrides.tiktokEnabled ?? true}
    />,
  );
}

const COUNTS = { rascunho: 1, aprovado_interno: 1 };

/** Abre o diálogo de saída de aprovação, escolhe "Aprovar todos" e confirma. */
async function openExitDialogAndApproveAll() {
  fireEvent.click(screen.getByText('forward'));
  fireEvent.click(await screen.findByRole('radio', { name: /Aprovar todos/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Avançar' }));
}

// Regression harness for the post-Task-4-review finding: KanbanView itself
// doesn't own `recurringWfId` (that state lives in EntregasPage, fed back in
// only as a prop, via the real onRecurring -> setRecurringWfId round trip).
// This tiny wrapper plays EntregasPage's part just enough to exercise that
// real feedback loop -- onRecurring here actually updates state and re-renders
// KanbanView with the new `recurringWfId`, instead of a no-op like the plain
// renderBoard() above uses for every other test in this file.
function RecurringAwareHarness({ card }: { card: BoardCard }) {
  const [recurringWfId, setRecurringWfId] = React.useState<number | null>(null);
  return (
    <>
      <KanbanView
        cards={[card]}
        onCardClick={() => {}}
        onEditClick={() => {}}
        onPostsClick={() => {}}
        onRefresh={() => {}}
        onRecurring={setRecurringWfId}
        membros={[]}
        templates={[]}
        postsCounts={new Map([[1, 2]])}
        approvedPostsCounts={new Map()}
        clearedClienteCounts={new Map([[1, 0]])}
        revisaoInternaCounts={new Map()}
        awaitingClienteCounts={new Map()}
        schedulingEnabled
        tiktokEnabled
        recurringWfId={recurringWfId}
      />
      {/* Stand-in for EntregasPage's <RecurringWorkflowDialog>: this test only
          needs to observe THAT the recurring-completion signal reached the
          parent, not the real dialog's markup. The dismiss button mirrors
          what BOTH real exits do -- handleRecurringConfirm (after
          duplicateWorkflow) and the dialog's onCancel both just
          setRecurringWfId(null); which one fires doesn't matter for this
          regression, only that recurringWfId goes back to null afterward. */}
      {recurringWfId != null && (
        <div data-testid="recurring-open">
          {recurringWfId}
          <button onClick={() => setRecurringWfId(null)}>dismiss-recurring</button>
        </div>
      )}
    </>
  );
}

describe('KanbanView batch auto-schedule nudge (spec peça 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.advanceWorkflowFromApproval.mockResolvedValue({
      workflowStatus: 'ativo',
      etapaAtual: 2,
      postsChanged: 2,
    });
    store.getWorkflowPostStatusCounts.mockResolvedValue(COUNTS);
    // Default: no later approval etapa ahead, so the batch dialog's gate is
    // satisfied by default. Individual tests flip this to true.
    store.hasLaterApprovalEtapa.mockReturnValue(false);
    store.sendPostsToCliente.mockResolvedValue(undefined);
  });

  it('opens the batch dialog right after "Aprovar todos" advances', async () => {
    renderBoard(0);
    await openExitDialogAndApproveAll();
    await waitFor(() =>
      expect(store.advanceWorkflowFromApproval).toHaveBeenCalledWith(
        expect.objectContaining({ workflowId: 1, choice: 'aprovar_todos' }),
      ),
    );
    expect(await screen.findByTestId('batch-nudge')).toHaveTextContent('1');
  });

  // The approval and the advance are one atomic RPC now: when it rejects,
  // nothing was approved, so there is nothing to schedule.
  it('never opens the dialog when advanceWorkflowFromApproval rejects', async () => {
    store.advanceWorkflowFromApproval.mockRejectedValue(new Error('db offline'));
    renderBoard(0);
    await openExitDialogAndApproveAll();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Erro ao avançar etapa'));
    expect(screen.queryByTestId('batch-nudge')).toBeNull();
  });

  it('never opens the dialog when a later approval etapa exists', async () => {
    store.hasLaterApprovalEtapa.mockReturnValue(true);
    renderBoard(0);
    await openExitDialogAndApproveAll();
    // The advance still proceeds, but the client approves again later: the
    // batch dialog must not offer to schedule now.
    await waitFor(() => expect(store.advanceWorkflowFromApproval).toHaveBeenCalled());
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Posts aprovados e etapa concluída.'),
    );
    expect(screen.queryByTestId('batch-nudge')).toBeNull();
  });

  it('never opens the dialog for "Manter status atuais"', async () => {
    renderBoard(0);
    fireEvent.click(screen.getByText('forward'));
    // Wait for the counts (options beyond "Manter" only appear with them).
    await screen.findByRole('radio', { name: /Aprovar todos/ });
    fireEvent.click(screen.getByRole('radio', { name: /Manter status atuais/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Avançar' }));
    await waitFor(() =>
      expect(store.advanceWorkflowFromApproval).toHaveBeenCalledWith(
        expect.objectContaining({ choice: 'manter' }),
      ),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(screen.queryByTestId('batch-nudge')).toBeNull();
  });

  it('never opens the dialog when the client does not auto-publish on approval', async () => {
    renderBoard(0, {
      card: makeCard({ cliente: { id: 1, nome: 'Aurora', auto_publish_on_approval: false } }),
    });
    await openExitDialogAndApproveAll();
    await waitFor(() => expect(store.advanceWorkflowFromApproval).toHaveBeenCalled());
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(screen.queryByTestId('batch-nudge')).toBeNull();
  });

  it('never opens the dialog when schedulingEnabled is false', async () => {
    renderBoard(0, { schedulingEnabled: false });
    await openExitDialogAndApproveAll();
    await waitFor(() => expect(store.advanceWorkflowFromApproval).toHaveBeenCalled());
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(screen.queryByTestId('batch-nudge')).toBeNull();
  });

  // Post-review fix (round 1): when the SAME "Aprovar todos" confirm both
  // (a) passes the batch-dialog gates (schedulingEnabled,
  // auto_publish_on_approval, no later approval etapa) AND (b) completes a
  // recorrente workflow's final etapa, the onRecurring branch fires on top of
  // the already-set batchScheduleWfId. Both are AlertDialogs; the
  // recurring-completion one must win, not stack.
  //
  // Fix round 2: winning isn't enough on its own -- round 1 only gated the
  // batch dialog's RENDER (workflowId={recurringWfId == null ? ... : null}),
  // it never cleared batchScheduleWfId itself. So once the user dismisses
  // RecurringWorkflowDialog (recurringWfId -> null again), the gate flips
  // back open and the nudge would resurface for a workflow already dealt
  // with. This test continues past the dismiss to prove that no longer
  // happens: batchScheduleWfId must be cleared for good, not just suppressed
  // while recurringWfId happens to be non-null.
  it('suppresses the batch dialog when the same advance also completes a recorrente workflow cycle, and it stays closed after the recurring dialog is dismissed', async () => {
    store.advanceWorkflowFromApproval.mockResolvedValue({
      workflowStatus: 'concluido',
      etapaAtual: 1,
      postsChanged: 2,
    });
    const recorrenteCard = makeCard({
      workflow: {
        id: 1,
        cliente_id: 1,
        titulo: 'Posts Agosto',
        status: 'ativo',
        etapa_atual: 1,
        recorrente: true,
      },
    });
    render(<RecurringAwareHarness card={recorrenteCard} />);
    await openExitDialogAndApproveAll();
    // The recurring signal actually reached the parent (unchanged behaviour --
    // this fix must not swallow or delay onRecurring).
    await waitFor(() => expect(screen.getByTestId('recurring-open')).toHaveTextContent('1'));
    // Settled state: only the recurring dialog's stand-in is present, never
    // the batch dialog too.
    expect(screen.queryByTestId('batch-nudge')).toBeNull();

    // Dismiss the recurring dialog (confirm or cancel -- both real exits just
    // setRecurringWfId(null); this harness's dismiss button mirrors either).
    fireEvent.click(screen.getByText('dismiss-recurring'));
    await waitFor(() => expect(screen.queryByTestId('recurring-open')).toBeNull());
    // The batch-schedule opportunity for THIS advance is gone for good, not
    // deferred until the recurring dialog closes -- it must not reopen now
    // that recurringWfId is null again.
    expect(screen.queryByTestId('batch-nudge')).toBeNull();
  });
});

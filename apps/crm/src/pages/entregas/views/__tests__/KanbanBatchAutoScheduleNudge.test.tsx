import React from 'react';
import { fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Task 4 — piece 2 of the auto-schedule nudge spec: the batch summary dialog
// opened right after "Aprovar internamente" in the Fluxos board. Follows
// KanbanRearm.test.tsx's harness verbatim (store mock shape, dialog stubs,
// dnd-kit-free render helper) and adds only the batch-nudge-specific plumbing.

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
    // Ao contrário de KanbanRearm.test.tsx (cliente: undefined), este arquivo
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

async function openApprovalChoiceAndApproveInternally() {
  fireEvent.click(screen.getByText('forward'));
  fireEvent.click(await screen.findByText('Avançar'));
  fireEvent.click(await screen.findByText('Aprovar internamente'));
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
          parent, not the real dialog's markup. */}
      {recurringWfId != null && <div data-testid="recurring-open">{recurringWfId}</div>}
    </>
  );
}

describe('KanbanView batch auto-schedule nudge (spec peça 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.completeEtapa.mockResolvedValue({ workflow: { status: 'ativo' }, etapas: [] });
    store.completeEtapaWithRearm.mockResolvedValue({
      workflow: { status: 'ativo' },
      etapas: [],
      rearmed: false,
      rearmFailed: false,
    });
    // Default: no later approval etapa ahead -> willRearm false, so the batch
    // dialog's !willRearm gate is satisfied by default. Individual tests flip
    // this to true for the "never opens when willRearm is true" case.
    store.hasLaterApprovalEtapa.mockReturnValue(false);
    store.approvePostsInternally.mockResolvedValue(undefined);
    store.sendPostsToCliente.mockResolvedValue(undefined);
  });

  it('opens the batch dialog right after approvePostsInternally resolves', async () => {
    renderBoard(0); // cleared !== total -> approval-choice dialog
    await openApprovalChoiceAndApproveInternally();
    await waitFor(() => expect(store.approvePostsInternally).toHaveBeenCalledWith(1));
    expect(await screen.findByTestId('batch-nudge')).toHaveTextContent('1');
  });

  // Decision 4 / the Codex correction: advanceEtapa's completeEtapaForAdvance
  // (without { rearm: false }) calls the store's completeEtapaWithRearm, which
  // swallows its own error and returns void from advanceEtapa's perspective --
  // the batch dialog must not depend on that call succeeding.
  it('still opens the dialog when completeEtapaForAdvance rejects afterwards', async () => {
    store.completeEtapaWithRearm.mockRejectedValue(new Error('db offline'));
    renderBoard(0);
    await openApprovalChoiceAndApproveInternally();
    await waitFor(() => expect(store.approvePostsInternally).toHaveBeenCalledWith(1));
    expect(await screen.findByTestId('batch-nudge')).toHaveTextContent('1');
    // The advance's own error toast still fires -- the batch dialog opening
    // doesn't swallow or race it.
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/db offline/i)),
    );
  });

  it('never opens the dialog when willRearm is true', async () => {
    store.hasLaterApprovalEtapa.mockReturnValue(true);
    renderBoard(0);
    await openApprovalChoiceAndApproveInternally();
    // approvePostsInternally still succeeded -- the advance still proceeds --
    // but the batch dialog must not open (rearm will wipe the approvals back
    // to rascunho for the next cycle).
    await waitFor(() => expect(store.completeEtapaWithRearm).toHaveBeenCalledWith(1, 11));
    expect(screen.queryByTestId('batch-nudge')).toBeNull();
  });

  it('never opens the dialog when the client does not auto-publish on approval', async () => {
    renderBoard(0, {
      card: makeCard({ cliente: { id: 1, nome: 'Aurora', auto_publish_on_approval: false } }),
    });
    await openApprovalChoiceAndApproveInternally();
    await waitFor(() => expect(store.completeEtapaWithRearm).toHaveBeenCalledWith(1, 11));
    expect(screen.queryByTestId('batch-nudge')).toBeNull();
  });

  it('never opens the dialog when schedulingEnabled is false', async () => {
    renderBoard(0, { schedulingEnabled: false });
    await openApprovalChoiceAndApproveInternally();
    await waitFor(() => expect(store.completeEtapaWithRearm).toHaveBeenCalledWith(1, 11));
    expect(screen.queryByTestId('batch-nudge')).toBeNull();
  });

  it('never opens the dialog when approvePostsInternally itself fails', async () => {
    store.approvePostsInternally.mockRejectedValue(new Error('Erro ao aprovar'));
    renderBoard(0);
    await openApprovalChoiceAndApproveInternally();
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/erro ao aprovar/i)),
    );
    expect(screen.queryByTestId('batch-nudge')).toBeNull();
    // Non-vacuity: the advance never even runs when the approval write itself failed.
    expect(store.completeEtapaWithRearm).not.toHaveBeenCalled();
    expect(store.completeEtapa).not.toHaveBeenCalled();
  });

  // Post-review fix: when the SAME handleApproveInternally call both (a)
  // passes the batch-dialog gates (schedulingEnabled, auto_publish_on_approval,
  // !willRearm) AND (b) completes a recorrente workflow's final etapa,
  // advanceEtapa's onRecurring branch fires on top of the already-set
  // batchScheduleWfId. Both are AlertDialogs; the recurring-completion one
  // must win, not stack.
  it('suppresses the batch dialog when the same advance also completes a recorrente workflow cycle', async () => {
    store.completeEtapaWithRearm.mockResolvedValue({
      workflow: { status: 'concluido', recorrente: true },
      etapas: [],
      rearmed: false,
      rearmFailed: false,
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
    await openApprovalChoiceAndApproveInternally();
    // The recurring signal actually reached the parent (unchanged behaviour --
    // this fix must not swallow or delay onRecurring).
    await waitFor(() => expect(screen.getByTestId('recurring-open')).toHaveTextContent('1'));
    // Settled state: only the recurring dialog's stand-in is present, never
    // the batch dialog too.
    expect(screen.queryByTestId('batch-nudge')).toBeNull();
  });
});

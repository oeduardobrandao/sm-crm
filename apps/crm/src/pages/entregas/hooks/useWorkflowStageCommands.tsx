import { useCallback, useState } from 'react';
import type { JSX } from 'react';
import { toast } from 'sonner';
import {
  approvePostsInternally,
  hasLaterApprovalEtapa,
  revertEtapa,
  sendPostsToCliente,
  type WorkflowEtapa,
} from '../../../store';
import { completeEtapaForAdvance, notifyRearmOutcome } from '../advanceEtapa';
import { decideApprovalAdvance } from '../approvalAdvance';
import type { BoardCard } from './useEntregasData';
import { AutoScheduleBatchDialog } from '../components/AutoScheduleBatchDialog';
import {
  ClientApprovalChoiceDialog,
  ForwardConfirmDialog,
  RevertConfirmDialog,
} from '../components/WorkflowModals';

/**
 * Hooks a board passes to keep its optimistic overlays in step with a move. The
 * Fluxos Kanban uses them for `pendingEtapas` / `pendingPositions` and the drop
 * position a cross-column drag captured; list views pass none and simply wait for
 * the refetch.
 */
export interface WorkflowMoveHooks<Ctx> {
  /** Runs synchronously before the RPC with the etapa the card is moving to
   *  (undefined when it is leaving the board from the last etapa). Its return
   *  value comes back to the two calls below. */
  onBeforeMove?: (card: BoardCard, target: WorkflowEtapa | undefined) => Ctx;
  /** The etapa moved. Awaited before `onRefresh`. */
  onMoveSucceeded?: (card: BoardCard, ctx: Ctx | undefined) => Promise<void> | void;
  /** The RPC failed: undo whatever `onBeforeMove` applied. */
  onMoveFailed?: (card: BoardCard, ctx: Ctx | undefined) => void;
  /** The move will not happen (a dialog was dismissed, approval failed, sent to
   *  the portal instead). */
  onAbandon?: () => void;
}

export interface UseWorkflowStageCommandsOptions<Ctx> extends WorkflowMoveHooks<Ctx> {
  onRefresh: () => void;
  onRecurring: (workflowId: number) => void;
  postsCounts: Map<number, number>;
  clearedClienteCounts: Map<number, number>;
  schedulingEnabled?: boolean;
  tiktokEnabled?: boolean;
  /** The page's RecurringWorkflowDialog target: while set, the batch-schedule
   *  dialog stays closed (the recurring one wins). */
  recurringWfId?: number | null;
  /** Fresh copy of a card at confirm time (the board's overlaid list). Falls back
   *  to the card the command was opened with. */
  resolveCard?: (workflowId: number) => BoardCard | undefined;
}

export interface WorkflowStageCommands {
  /** "Concluir etapa e avançar": ForwardConfirm, then the client-approval choice
   *  when the etapa asks for it. */
  forward: (card: BoardCard) => void;
  /** "Voltar etapa": RevertConfirm. */
  revert: (card: BoardCard) => void;
  dialogs: JSX.Element;
}

/**
 * The fluxo stage chain shared by the Kanban board, the phone card menus and the
 * phone list swipe actions: ForwardConfirm -> decideApprovalAdvance ->
 * ClientApprovalChoice -> completeEtapa (with re-arm) / approvePostsInternally /
 * sendPostsToCliente, RevertConfirm -> revertEtapa, the recurring-cycle hand-off
 * and the batch auto-schedule nudge. Extracted from KanbanView as-is: same copy,
 * same toasts, same ordering.
 */
export function useWorkflowStageCommands<Ctx = unknown>(
  opts: UseWorkflowStageCommandsOptions<Ctx>,
): WorkflowStageCommands {
  const {
    onRefresh,
    onRecurring,
    postsCounts,
    clearedClienteCounts,
    schedulingEnabled,
    tiktokEnabled,
    recurringWfId,
    resolveCard,
    onBeforeMove,
    onMoveSucceeded,
    onMoveFailed,
    onAbandon,
  } = opts;
  const [forwardTarget, setForwardTarget] = useState<BoardCard | null>(null);
  const [revertTarget, setRevertTarget] = useState<BoardCard | null>(null);
  const [approvalChoice, setApprovalChoice] = useState<{
    card: BoardCard;
    willRearm: boolean;
  } | null>(null);
  /** Fluxo cujo resumo de agendamento em lote está aberto (peça 2 da spec), com o
   *  booleano do gate de segurança capturado no MOMENTO em que `!willRearm` foi
   *  checado em handleApproveInternally. */
  const [batchSchedule, setBatchSchedule] = useState<{
    workflowId: number;
    isFinalApprovalCycle: boolean;
  } | null>(null);

  // opts.rearm === false keeps the plain completeEtapa (post statuses untouched) -- used by
  // "Avançar etapa sem alterar posts", whose literal contract is to leave posts alone.
  const advanceEtapa = useCallback(
    async (card: BoardCard, successMessage: string, advanceOpts?: { rearm?: boolean }) => {
      const wfId = card.workflow.id!;
      // On the last etapa there is no next column: the card leaves the board when
      // the refetch lands.
      const nextEtapa = card.allEtapas.find((e) => e.ordem === card.etapa.ordem + 1);
      const ctx = onBeforeMove?.(card, nextEtapa);
      try {
        const result = await completeEtapaForAdvance(
          card.workflow.id!,
          card.etapa.id!,
          advanceOpts,
        );
        if (result.workflow.status === 'concluido' && card.workflow.recorrente) {
          // Recurring-completion wins over the batch-schedule nudge: also CLEAR it,
          // so dismissing RecurringWorkflowDialog doesn't bring the nudge back.
          setBatchSchedule((prev) => (prev?.workflowId === wfId ? null : prev));
          onRecurring(card.workflow.id!);
        } else {
          toast.success(successMessage);
        }
        notifyRearmOutcome(result);
        await onMoveSucceeded?.(card, ctx);
        onRefresh();
      } catch (err: unknown) {
        onMoveFailed?.(card, ctx);
        toast.error((err as Error).message || 'Erro ao avançar etapa');
      }
    },
    [onRefresh, onRecurring, onBeforeMove, onMoveSucceeded, onMoveFailed],
  );

  const executeForward = useCallback(
    (card: BoardCard) => {
      const wfId = card.workflow.id!;
      const decision = decideApprovalAdvance({
        tipo: card.etapa.tipo,
        total: postsCounts.get(wfId) ?? 0,
        // "Cleared" (approved / scheduled / posted / publish-failed), not just
        // aprovado_cliente: a workflow whose approved posts are already scheduled
        // must not prompt the approval dialog on advance.
        cleared: clearedClienteCounts.get(wfId) ?? 0,
        temAprovacaoAdiante: hasLaterApprovalEtapa(card.allEtapas, card.etapa.id!),
      });
      if (decision.kind === 'choose') setApprovalChoice({ card, willRearm: decision.willRearm });
      else advanceEtapa(card, 'Etapa concluída!');
    },
    [advanceEtapa, postsCounts, clearedClienteCounts],
  );

  const handleForwardConfirm = () => {
    if (!forwardTarget) return;
    const card = forwardTarget;
    setForwardTarget(null);
    executeForward(card);
  };

  const handleApproveInternally = async () => {
    if (!approvalChoice) return;
    const card = approvalChoice.card;
    const { willRearm } = approvalChoice;
    setApprovalChoice(null);
    try {
      await approvePostsInternally(card.workflow.id!);
    } catch (err: unknown) {
      // The advance never runs, so a captured drop position must not survive to
      // reorder a later, unrelated advance of this workflow.
      onAbandon?.();
      toast.error((err as Error).message || 'Erro ao aprovar internamente');
      return;
    }
    // Aviso de agendamento em lote (spec peça 2), aberto AQUI e não depois de
    // advanceEtapa: advanceEtapa captura o próprio erro e devolve void. O gate
    // !willRearm garante que nenhum rearm vai devolver estes posts para rascunho.
    if (
      !willRearm &&
      schedulingEnabled === true &&
      card.cliente?.auto_publish_on_approval === true
    ) {
      setBatchSchedule({ workflowId: card.workflow.id!, isFinalApprovalCycle: !willRearm });
    }
    await advanceEtapa(card, 'Posts aprovados internamente — etapa concluída!');
  };

  const handleSendToPortal = async () => {
    if (!approvalChoice) return;
    const card = approvalChoice.card;
    setApprovalChoice(null);
    // Send-only: the workflow does not move.
    onAbandon?.();
    try {
      await sendPostsToCliente(card.workflow.id!);
      toast.success('Posts enviados ao portal do cliente!');
      onRefresh();
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erro ao enviar ao portal');
    }
  };

  const handleAdvanceWithoutApproval = () => {
    if (!approvalChoice) return;
    const card = approvalChoice.card;
    setApprovalChoice(null);
    advanceEtapa(card, 'Etapa avançada — status dos posts mantidos.', { rearm: false });
  };

  const handleRevertConfirm = async () => {
    if (!revertTarget) return;
    const wfId = revertTarget.workflow.id!;
    const card = resolveCard ? resolveCard(wfId) : revertTarget;
    const prevEtapa = card?.allEtapas.find((e) => e.ordem === card.etapa.ordem - 1);
    // A card the board no longer lists still reverts, just without an optimistic move.
    const ctx = onBeforeMove?.(card ?? revertTarget, card ? prevEtapa : undefined);
    try {
      await revertEtapa(wfId);
      toast.success('Etapa revertida!');
      await onMoveSucceeded?.(card ?? revertTarget, ctx);
      onRefresh();
    } catch (err: unknown) {
      onMoveFailed?.(card ?? revertTarget, ctx);
      toast.error((err as Error).message || 'Erro ao reverter etapa');
    }
    setRevertTarget(null);
  };

  const dialogs = (
    <>
      <ForwardConfirmDialog
        open={!!forwardTarget}
        entityTitle={forwardTarget?.workflow.titulo || ''}
        nextEtapaName={
          forwardTarget
            ? ([...forwardTarget.allEtapas]
                .sort((a, b) => a.ordem - b.ordem)
                .find((e) => e.ordem > forwardTarget.etapa.ordem)?.nome ?? '')
            : ''
        }
        onConfirm={handleForwardConfirm}
        onCancel={() => {
          onAbandon?.();
          setForwardTarget(null);
        }}
      />
      <RevertConfirmDialog
        open={!!revertTarget}
        entityTitle={revertTarget?.workflow.titulo || ''}
        onConfirm={handleRevertConfirm}
        onCancel={() => {
          onAbandon?.();
          setRevertTarget(null);
        }}
      />
      <ClientApprovalChoiceDialog
        open={!!approvalChoice}
        entityTitle={approvalChoice?.card.workflow.titulo || ''}
        willRearm={approvalChoice?.willRearm ?? false}
        onApproveInternally={handleApproveInternally}
        onSendToPortal={handleSendToPortal}
        onAdvanceWithoutChanges={handleAdvanceWithoutApproval}
        onCancel={() => {
          onAbandon?.();
          setApprovalChoice(null);
        }}
      />
      <AutoScheduleBatchDialog
        // Exclusão mútua com RecurringWorkflowDialog: recurringWfId != null
        // significa que o pai já vai abrir (ou já abriu) o diálogo de conclusão
        // de ciclo para este mesmo avanço -- ele tem precedência.
        workflowId={recurringWfId == null ? (batchSchedule?.workflowId ?? null) : null}
        tiktokFeatureEnabled={tiktokEnabled === true}
        isFinalApprovalCycle={batchSchedule?.isFinalApprovalCycle ?? false}
        onClose={() => setBatchSchedule(null)}
        onScheduled={() => {
          setBatchSchedule(null);
          onRefresh();
        }}
      />
    </>
  );

  return {
    forward: useCallback((card: BoardCard) => setForwardTarget(card), []),
    revert: useCallback((card: BoardCard) => setRevertTarget(card), []),
    dialogs,
  };
}

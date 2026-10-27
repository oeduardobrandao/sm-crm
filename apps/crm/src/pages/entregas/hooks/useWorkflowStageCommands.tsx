import { useCallback, useState } from 'react';
import type { JSX } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { i18n } from '@mesaas/i18n';
import {
  advanceWorkflowFromApproval,
  completeEtapa,
  getWorkflowPostStatusCounts,
  hasLaterApprovalEtapa,
  revertEtapa,
  sendPostsToCliente,
  type PostStatusCounts,
  type WorkflowApprovalExitChoice,
  type WorkflowEtapa,
} from '../../../store';
import type { BoardCard } from './useEntregasData';
import { fluxoExitOptions, type ApprovalExitOption } from '../approvalExit';
import {
  getErrorIdentifier,
  getPostProcessErrorToast,
  isStaleStateError,
} from '../postProcessErrors';
import { ApprovalExitDialog } from '../components/ApprovalExitDialog';
import { AutoScheduleBatchDialog } from '../components/AutoScheduleBatchDialog';
import { ForwardConfirmDialog, RevertConfirmDialog } from '../components/WorkflowModals';

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
  /** Não usados desde o diálogo de saída de aprovação (que busca as contagens
   *  por status na hora); mantidos para não mexer nos chamadores. */
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
  /** "Concluir etapa e avançar": ApprovalExitDialog on an `aprovacao_cliente`
   *  etapa, ForwardConfirm on a `padrao` one. */
  forward: (card: BoardCard) => void;
  /** "Voltar etapa": RevertConfirm. */
  revert: (card: BoardCard) => void;
  dialogs: JSX.Element;
}

/** The etapa after the card's current one by `ordem`, or undefined on the last. */
function nextEtapaOf(card: BoardCard): WorkflowEtapa | undefined {
  return [...card.allEtapas]
    .sort((a, b) => a.ordem - b.ordem)
    .find((e) => e.ordem > card.etapa.ordem);
}

const EXIT_CHOICE: Record<
  Exclude<ApprovalExitOption, 'enviar_portal'>,
  WorkflowApprovalExitChoice
> = {
  manter: 'manter',
  aprovar: 'aprovar_todos',
  voltar_rascunho: 'voltar_rascunho',
};

/** Chaves (namespace entregasPhone) resolvidas na hora do toast. */
const EXIT_SUCCESS: Record<WorkflowApprovalExitChoice, string> = {
  manter: 'workflowStage.exitSuccess.manter',
  aprovar_todos: 'workflowStage.exitSuccess.aprovarTodos',
  voltar_rascunho: 'workflowStage.exitSuccess.voltarRascunho',
};

/**
 * The fluxo stage chain shared by the Kanban board, the phone card menus and the
 * phone list swipe actions. Forward on an `aprovacao_cliente` etapa opens the
 * ApprovalExitDialog (counts fetched on open) and confirms through the atomic
 * `advanceWorkflowFromApproval` RPC, or sends the posts to the portal; forward on
 * a `padrao` etapa is ForwardConfirm -> completeEtapa. RevertConfirm ->
 * revertEtapa, the recurring-cycle hand-off and the batch auto-schedule nudge
 * complete the chain.
 */
export function useWorkflowStageCommands<Ctx = unknown>(
  opts: UseWorkflowStageCommandsOptions<Ctx>,
): WorkflowStageCommands {
  const {
    onRefresh,
    onRecurring,
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
  /** Card whose approval-exit dialog is open. */
  const [approvalTarget, setApprovalTarget] = useState<BoardCard | null>(null);
  const [approvalBusy, setApprovalBusy] = useState(false);
  /** True from a posts_changed until its refetch settles: the stale numbers must
   *  not be confirmable in the render before the query reports `isFetching`. */
  const [countsRefreshing, setCountsRefreshing] = useState(false);
  /** Bumped when the dialog must come back after a choice that did not close it
   *  (posts_changed, retry): the phone sheet hides itself on a pick and only a
   *  remount shows it again. */
  const [approvalSession, setApprovalSession] = useState(0);
  /** Fluxo cujo resumo de agendamento em lote está aberto (peça 2 da spec), com o
   *  booleano do gate de segurança capturado no momento da aprovação. */
  const [batchSchedule, setBatchSchedule] = useState<{
    workflowId: number;
    isFinalApprovalCycle: boolean;
  } | null>(null);

  const approvalWfId = approvalTarget?.workflow.id ?? null;
  const countsQuery = useQuery({
    queryKey: ['workflow-post-status-counts', approvalWfId],
    // Closure on purpose: only touched while the dialog is open.
    queryFn: () => getWorkflowPostStatusCounts(approvalWfId!),
    enabled: approvalWfId != null,
    refetchOnWindowFocus: false,
  });
  // null while (re)fetching, so stale numbers can never be confirmed (the
  // posts_changed refetch included).
  const counts: PostStatusCounts | null =
    approvalWfId != null && !countsQuery.isFetching && !countsRefreshing && countsQuery.data
      ? countsQuery.data
      : null;
  const countsError =
    approvalWfId != null && countsQuery.isError && !countsQuery.isFetching && !countsRefreshing;
  const refetchCounts = countsQuery.refetch;
  const refreshCounts = () => {
    setCountsRefreshing(true);
    setApprovalSession((n) => n + 1);
    void refetchCounts().finally(() => setCountsRefreshing(false));
  };

  const approvalNext = approvalTarget ? nextEtapaOf(approvalTarget) : undefined;
  const temAprovacaoAdiante = approvalTarget
    ? hasLaterApprovalEtapa(approvalTarget.allEtapas, approvalTarget.etapa.id!)
    : false;
  // Options come from the last numbers React Query holds, even mid-refetch, so the
  // list (and the user's pick) does not collapse to "Manter" while `counts` is null.
  const exit = fluxoExitOptions({
    counts: (approvalWfId != null ? countsQuery.data : undefined) ?? {},
    isLastEtapa: approvalNext === undefined,
    temAprovacaoAdiante,
  });

  const handleRecurringOrToast = useCallback(
    (card: BoardCard, concluded: boolean, successMessage: string) => {
      const wfId = card.workflow.id!;
      if (concluded && card.workflow.recorrente) {
        // Recurring-completion wins over the batch-schedule nudge: also CLEAR it,
        // so dismissing RecurringWorkflowDialog doesn't bring the nudge back.
        setBatchSchedule((prev) => (prev?.workflowId === wfId ? null : prev));
        onRecurring(wfId);
      } else {
        toast.success(successMessage);
      }
    },
    [onRecurring],
  );

  /** Plain advance of a `padrao` etapa (post statuses untouched). */
  const advanceEtapa = useCallback(
    async (card: BoardCard) => {
      // On the last etapa there is no next column: the card leaves the board when
      // the refetch lands.
      const ctx = onBeforeMove?.(card, nextEtapaOf(card));
      try {
        const result = await completeEtapa(card.workflow.id!, card.etapa.id!);
        handleRecurringOrToast(
          card,
          result.workflow.status === 'concluido',
          i18n.t('entregasPhone:workflowStage.etapaCompleted'),
        );
        await onMoveSucceeded?.(card, ctx);
        onRefresh();
      } catch (err: unknown) {
        onMoveFailed?.(card, ctx);
        toast.error((err as Error).message || i18n.t('entregasPhone:workflowStage.advanceError'));
      }
    },
    [onRefresh, onBeforeMove, onMoveSucceeded, onMoveFailed, handleRecurringOrToast],
  );

  const handleForwardConfirm = () => {
    if (!forwardTarget) return;
    const card = forwardTarget;
    setForwardTarget(null);
    void advanceEtapa(card);
  };

  const handleSendToPortal = async (card: BoardCard) => {
    setApprovalTarget(null);
    // Send-only: the workflow does not move.
    onAbandon?.();
    try {
      await sendPostsToCliente(card.workflow.id!);
      toast.success(i18n.t('entregasPhone:workflowStage.sentToPortal'));
      onRefresh();
    } catch (err: unknown) {
      toast.error(getPostProcessErrorToast(err, i18n.t('entregasPhone:shared.sendToPortalError')));
    }
  };

  const handleApprovalConfirm = async (option: ApprovalExitOption) => {
    if (!approvalTarget || approvalBusy) return;
    const card = approvalTarget;
    if (option === 'enviar_portal') {
      await handleSendToPortal(card);
      return;
    }
    const choice = EXIT_CHOICE[option];
    const expectedCounts = choice === 'manter' ? null : counts;
    // Captured now: the dialog's derived values follow approvalTarget.
    const laterApproval = temAprovacaoAdiante;
    const wfId = card.workflow.id!;
    setApprovalBusy(true);
    const ctx = onBeforeMove?.(card, nextEtapaOf(card));
    try {
      const result = await advanceWorkflowFromApproval({
        workflowId: wfId,
        expectedEtapaId: card.etapa.id!,
        choice,
        expectedCounts,
      });
      setApprovalTarget(null);
      // Aviso de agendamento em lote (spec peça 2): só depois do RPC atômico (sem
      // sucesso nada foi aprovado) e só sem aprovação adiante, que pediria uma
      // nova aprovação do cliente antes de publicar.
      if (
        choice === 'aprovar_todos' &&
        !laterApproval &&
        schedulingEnabled === true &&
        card.cliente?.auto_publish_on_approval === true
      ) {
        setBatchSchedule({ workflowId: wfId, isFinalApprovalCycle: true });
      }
      handleRecurringOrToast(
        card,
        result.workflowStatus === 'concluido',
        i18n.t(`entregasPhone:${EXIT_SUCCESS[choice]}`),
      );
      await onMoveSucceeded?.(card, ctx);
      onRefresh();
    } catch (err: unknown) {
      onMoveFailed?.(card, ctx);
      const code = getErrorIdentifier(err);
      toast.error(
        getPostProcessErrorToast(err, i18n.t('entregasPhone:workflowStage.advanceError')),
      );
      if (code === 'posts_changed') {
        // Stays open with the fresh numbers; the user confirms again.
        refreshCounts();
      } else {
        setApprovalTarget(null);
        if (isStaleStateError(err)) onRefresh();
      }
    } finally {
      setApprovalBusy(false);
    }
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
      toast.success(i18n.t('entregasPhone:workflowStage.reverted'));
      await onMoveSucceeded?.(card ?? revertTarget, ctx);
      onRefresh();
    } catch (err: unknown) {
      onMoveFailed?.(card ?? revertTarget, ctx);
      toast.error((err as Error).message || i18n.t('entregasPhone:workflowStage.revertError'));
    }
    setRevertTarget(null);
  };

  const dialogs = (
    <>
      <ForwardConfirmDialog
        open={!!forwardTarget}
        entityTitle={forwardTarget?.workflow.titulo || ''}
        nextEtapaName={forwardTarget ? (nextEtapaOf(forwardTarget)?.nome ?? '') : ''}
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
      <ApprovalExitDialog
        open={!!approvalTarget}
        entityKind="fluxo"
        entityTitle={approvalTarget?.workflow.titulo || ''}
        nextEtapaName={approvalNext?.nome ?? null}
        counts={counts}
        options={exit.options}
        recommended={exit.recommended}
        numbers={{
          pendentes: exit.pendentes,
          alteraveisRascunho: exit.alteraveisRascunho,
          aprovadoInterno: exit.aprovadoInterno,
        }}
        busy={approvalBusy}
        countsError={countsError}
        onRetry={refreshCounts}
        // Session only, not the fluxo id: closing must keep the sheet mounted (it
        // closes through `open`), and a new target already resets the sheet.
        sessionKey={approvalSession}
        onConfirm={(option) => void handleApprovalConfirm(option)}
        onCancel={() => {
          // A confirm in flight owns the move hooks; ignore the dismissal.
          if (approvalBusy) return;
          onAbandon?.();
          setApprovalTarget(null);
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
    forward: useCallback((card: BoardCard) => {
      if (card.etapa.tipo === 'aprovacao_cliente') setApprovalTarget(card);
      else setForwardTarget(card);
    }, []),
    revert: useCallback((card: BoardCard) => setRevertTarget(card), []),
    dialogs,
  };
}

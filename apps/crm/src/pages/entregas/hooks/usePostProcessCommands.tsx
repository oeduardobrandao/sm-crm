import { useCallback, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  removePostProcess,
  transitionPostProcess,
  updateWorkflowPost,
  type ApprovalChoice,
  type ProcessCommand,
} from '../../../store';
import {
  decideApprovalAdvance,
  hasLaterPendingApprovalStep,
  isClientCleared,
} from '../approvalAdvance';
import { getPostProcessErrorToast, isStaleStateError } from '../postProcessErrors';
import {
  activeStepOf,
  nextDeadlineFor,
  nextPendingStepOf,
  previousStepOf,
  sendToPortalDisabledReasonFor,
  type ProcessTarget,
} from '../postProcessCommands';
import {
  ClientApprovalChoiceDialog,
  ForwardConfirmDialog,
  RevertConfirmDialog,
} from '../components/WorkflowModals';

export interface UsePostProcessCommandsOptions {
  onRefresh: () => void;
  /** Kanban overlay: called with the target ordem before the RPC, and with null on rollback. */
  onOptimisticStep?: (processId: number, ordem: number | null) => void;
  /** Chamado quando um diálogo de confirmação é DESCARTADO sem rodar o comando
   *  (Cancelar, Esc, clique fora) -- nunca num confirm que já seguiu para
   *  `run`/`decideThenRun`. O Kanban usa isso para limpar `pendingInsertRef`
   *  de um drag entre colunas que abriu este diálogo: sem o callback, um
   *  Cancelar aqui deixa o ref preso, e o próximo comando do MESMO post
   *  disparado por botão (não-drag) herda a posição capturada pelo drag
   *  abandonado quando o catch-up effect casar o `movedId` (bug real, achado
   *  na revisão da Task 8). */
  onDismiss?: () => void;
}

export interface PostProcessCommands {
  avancar: (t: ProcessTarget) => void;
  voltar: (t: ProcessTarget) => void;
  concluir: (t: ProcessTarget) => void;
  reabrir: (t: ProcessTarget) => void;
  remover: (t: ProcessTarget) => void;
  busy: boolean;
  dialogs: JSX.Element;
}

type Pending =
  | { kind: 'forward'; t: ProcessTarget }
  | { kind: 'revert'; t: ProcessTarget }
  | { kind: 'conclude'; t: ProcessTarget }
  | { kind: 'reopen'; t: ProcessTarget }
  | { kind: 'remove'; t: ProcessTarget };

/** Estado separado de `pending` de propósito: Radix fecha o AlertDialog de
 *  origem (forward/conclude) e dispara `onOpenChange(false)` de forma
 *  assíncrona depois do nosso próprio onClick já ter rodado. Se a escolha de
 *  aprovação vivesse dentro do mesmo `pending`, esse fechamento tardio
 *  chamaria `close()` (`setPending(null)`) por cima do `{ kind: 'choice' }`
 *  recém-setado e o ClientApprovalChoiceDialog nunca apareceria -- o mesmo
 *  desenho do KanbanView (`forwardTarget` vs `approvalChoice` como estados
 *  distintos) evita esse race. */
type Choice = { t: ProcessTarget; command: 'avancar' | 'concluir'; willRearm: boolean };

const SUCCESS: Record<ProcessCommand, string> = {
  avancar: 'Etapa avançada.',
  voltar: 'Etapa revertida.',
  concluir: 'Processo concluído. O post mantém status e agendamento.',
  reabrir: 'Processo reaberto na última etapa.',
};

/**
 * Comandos de um processo individual (spec §5.4, §5.5, §6.2) compartilhados
 * pelo cabeçalho do drawer, pelo card do Kanban e por Concluídas. Cada comando
 * abre o diálogo que os fluxos já usam (Forward/Revert/ClientApprovalChoice)
 * ou um AlertDialog de confirmação, e a transição roda numa RPC só, com
 * `revisao` esperada e rollback em falha (spec §9.6).
 */
export function usePostProcessCommands(opts: UsePostProcessCommandsOptions): PostProcessCommands {
  const qc = useQueryClient();
  const [pending, setPending] = useState<Pending | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [busy, setBusy] = useState(false);
  // Um ciclo (abrir -> confirmar OU cancelar) por diálogo. Ver o comentário
  // grande junto de `dismissForward`/`dismissRevert`/`dismissChoice` abaixo:
  // resolvido por `false` sempre que o diálogo ABRE de novo.
  const forwardResolvedRef = useRef(false);
  const revertResolvedRef = useRef(false);
  const choiceResolvedRef = useRef(false);

  const invalidate = useCallback(
    (t: ProcessTarget) => {
      for (const key of [
        ['post-processes'],
        ['post-process', t.post.id],
        ['post-process-events'],
        ['post-process-covers'],
        ['active-posts'],
        ['standalone-post', t.post.id],
        ['post-status-events'],
        ['concluded-workflows'],
        ['concluded-summaries'],
        ['scheduled-posts'],
      ])
        qc.invalidateQueries({ queryKey: key });
      if (t.post.cliente_id != null)
        qc.invalidateQueries({ queryKey: ['clientePosts', t.post.cliente_id] });
      opts.onRefresh();
    },
    [qc, opts],
  );

  const run = useCallback(
    async (t: ProcessTarget, command: ProcessCommand, choice: ApprovalChoice | null) => {
      const active = activeStepOf(t.process);
      const next = command === 'avancar' ? nextPendingStepOf(t.process) : null;
      const needsStatus =
        (command === 'avancar' || command === 'concluir') && active?.tipo === 'aprovacao_cliente';
      const optimisticOrdem =
        command === 'avancar'
          ? (next?.ordem ?? null)
          : command === 'voltar'
            ? (previousStepOf(t.process)?.ordem ?? null)
            : null;
      if (optimisticOrdem != null) opts.onOptimisticStep?.(t.process.id, optimisticOrdem);
      setBusy(true);
      try {
        const result = await transitionPostProcess({
          processId: t.process.id,
          expectedRevisao: t.process.revisao,
          command,
          approvalChoice: choice,
          expectedPostStatus: needsStatus ? t.post.status : null,
          nextDeadline: command === 'avancar' ? nextDeadlineFor(next, new Date()) : null,
        });
        toast.success(SUCCESS[command]);
        if (result.post_status_changed && result.post_status === 'rascunho') {
          toast.info('O post voltou para rascunho para o próximo ciclo de aprovação.');
        }
        invalidate(t);
      } catch (err) {
        opts.onOptimisticStep?.(t.process.id, null);
        toast.error(
          getPostProcessErrorToast(
            err,
            `Erro ao ${
              command === 'avancar'
                ? 'avançar etapa'
                : command === 'voltar'
                  ? 'voltar etapa'
                  : command === 'concluir'
                    ? 'concluir processo'
                    : 'reabrir processo'
            }`,
          ),
        );
        if (isStaleStateError(err)) invalidate(t);
      } finally {
        setBusy(false);
      }
    },
    [invalidate, opts],
  );

  const decideThenRun = useCallback(
    (t: ProcessTarget, command: 'avancar' | 'concluir') => {
      const active = activeStepOf(t.process);
      const decision = decideApprovalAdvance({
        tipo: active?.tipo,
        total: 1,
        cleared: isClientCleared(t.post.status) ? 1 : 0,
        temAprovacaoAdiante:
          command === 'avancar' && active
            ? hasLaterPendingApprovalStep(t.process.steps, active.ordem)
            : false,
      });
      if (decision.kind === 'choose') {
        choiceResolvedRef.current = false;
        setChoice({ t, command, willRearm: decision.willRearm });
      } else void run(t, command, null);
    },
    [run],
  );

  const sendToPortal = useCallback(
    async (t: ProcessTarget) => {
      setBusy(true);
      try {
        await updateWorkflowPost(t.post.id, { status: 'enviado_cliente' });
        toast.success('Post enviado ao portal do cliente.');
        invalidate(t);
      } catch (err) {
        toast.error(getPostProcessErrorToast(err, 'Erro ao enviar ao portal'));
      } finally {
        setBusy(false);
      }
    },
    [invalidate],
  );

  const remove = useCallback(
    async (t: ProcessTarget) => {
      setBusy(true);
      try {
        await removePostProcess(t.process.id, t.process.revisao);
        toast.success('Processo removido. O post continua em Publicações.');
        invalidate(t);
      } catch (err) {
        toast.error(getPostProcessErrorToast(err, 'Erro ao remover processo'));
        if (isStaleStateError(err)) invalidate(t);
      } finally {
        setBusy(false);
      }
    },
    [invalidate],
  );

  const close = () => setPending(null);
  const closeChoice = () => setChoice(null);
  // AlertDialogAction/AlertDialogCancel são primitivas do Radix que fecham o
  // diálogo por conta própria: um clique em QUALQUER uma delas dispara
  // `onOpenChange(false)` -- e portanto `onCancel` -- de forma ASSÍNCRONA,
  // depois do nosso próprio onClick já ter rodado (mesmo comportamento do
  // comentário de `Choice` acima, aplicado aqui ao Cancelar/Confirmar). Sem
  // um guarda por ciclo, um Cancelar real dispara `onDismiss` duas vezes (once
  // pelo onClick, once por esse eco) e um CONFIRMAR bem-sucedido também
  // dispara `onDismiss` (o `close()` do onConfirm já deixa `open` false, e o
  // eco chega igual) -- limpando incorretamente o que o caller guarda para um
  // confirm válido (ex.: `pendingInsertRef` de um drag confirmado). Os refs
  // abaixo resolvem o ciclo uma única vez: o confirm marca resolvido ANTES de
  // fechar (nunca chama onDismiss); um Cancelar real marca resolvido e chama
  // onDismiss; o eco que vier depois de qualquer um dos dois já encontra
  // resolvido e não faz nada.
  const dismissForward = () => {
    if (forwardResolvedRef.current) return;
    forwardResolvedRef.current = true;
    opts.onDismiss?.();
    close();
  };
  const dismissRevert = () => {
    if (revertResolvedRef.current) return;
    revertResolvedRef.current = true;
    opts.onDismiss?.();
    close();
  };
  const dismissChoice = () => {
    if (choiceResolvedRef.current) return;
    choiceResolvedRef.current = true;
    opts.onDismiss?.();
    closeChoice();
  };
  const p = pending;
  const nextName = p && p.kind === 'forward' ? (nextPendingStepOf(p.t.process)?.nome ?? '') : '';

  const dialogs = (
    <>
      <ForwardConfirmDialog
        open={p?.kind === 'forward'}
        entityTitle={p?.t.post.titulo || 'Post sem título'}
        nextEtapaName={nextName}
        onConfirm={() => {
          if (p?.kind === 'forward') {
            const t = p.t;
            forwardResolvedRef.current = true;
            close();
            decideThenRun(t, 'avancar');
          }
        }}
        onCancel={dismissForward}
      />
      <RevertConfirmDialog
        open={p?.kind === 'revert'}
        entityTitle={p?.t.post.titulo || 'Post sem título'}
        onConfirm={() => {
          if (p?.kind === 'revert') {
            const t = p.t;
            revertResolvedRef.current = true;
            close();
            void run(t, 'voltar', null);
          }
        }}
        onCancel={dismissRevert}
      />
      <ClientApprovalChoiceDialog
        open={!!choice}
        entityTitle={choice?.t.post.titulo || 'Post sem título'}
        entityKind="post"
        willRearm={choice?.willRearm ?? false}
        withoutChangesLabel={
          choice?.command === 'concluir'
            ? 'Concluir sem alterar o post'
            : 'Avançar etapa sem alterar o post'
        }
        sendToPortalDisabledReason={
          choice ? sendToPortalDisabledReasonFor(choice.t.post.status) : undefined
        }
        onApproveInternally={() => {
          if (choice) {
            const { t, command } = choice;
            choiceResolvedRef.current = true;
            closeChoice();
            void run(t, command, 'aprovar_interno');
          }
        }}
        onSendToPortal={() => {
          if (choice) {
            const t = choice.t;
            // "Enviar ao portal" não é cancelamento nem avanço de etapa (é
            // um UPDATE direto do status do post, nunca toca em
            // pendingInsertRef) -- mas TAMBÉM resolve o diálogo de escolha, e
            // por isso precisa do MESMO dismissChoice() do Cancelar: o ref
            // "resolvido" ainda está false aqui, então dismissChoice roda por
            // completo, dispara onDismiss (limpando o pendingInsertRef de um
            // drag pendente) uma única vez, e o eco assíncrono do Radix que
            // vem depois já encontra resolvido. Sem isto o mesmo leak da
            // Task 8 (fix round 1) reaparece por este caminho (achado na
            // re-revisão): um drag cross-column seguido de "Enviar ao
            // portal" deixava pendingInsertRef preso.
            dismissChoice();
            void sendToPortal(t);
          }
        }}
        onAdvanceWithoutChanges={() => {
          if (choice) {
            const { t, command } = choice;
            choiceResolvedRef.current = true;
            closeChoice();
            void run(t, command, 'sem_alterar');
          }
        }}
        onCancel={dismissChoice}
      />
      <AlertDialog
        open={p?.kind === 'conclude' || p?.kind === 'reopen' || p?.kind === 'remove'}
        onOpenChange={(o) => !o && close()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {p?.kind === 'conclude'
                ? 'Concluir processo?'
                : p?.kind === 'reopen'
                  ? 'Reabrir processo?'
                  : 'Remover processo?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {p?.kind === 'conclude' &&
                'O processo vai para Concluídas. Status, visibilidade no portal e agendamento do post não mudam.'}
              {p?.kind === 'reopen' &&
                'O processo volta para a última etapa, com o prazo salvo (mesmo vencido). O status do post não muda.'}
              {p?.kind === 'remove' &&
                'O histórico fica guardado, o status e o conteúdo do post não mudam, e o post volta para Sem processo.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={close} disabled={busy}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => {
                if (!p) return;
                const t = p.t;
                const kind = p.kind;
                close();
                if (kind === 'conclude') decideThenRun(t, 'concluir');
                else if (kind === 'reopen') void run(t, 'reabrir', null);
                else if (kind === 'remove') void remove(t);
              }}
            >
              {p?.kind === 'conclude' ? 'Concluir' : p?.kind === 'reopen' ? 'Reabrir' : 'Remover'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  return useMemo(
    () => ({
      avancar: (t: ProcessTarget) => {
        forwardResolvedRef.current = false;
        setPending({ kind: 'forward', t });
      },
      voltar: (t: ProcessTarget) => {
        revertResolvedRef.current = false;
        setPending({ kind: 'revert', t });
      },
      concluir: (t: ProcessTarget) => setPending({ kind: 'conclude', t }),
      reabrir: (t: ProcessTarget) => setPending({ kind: 'reopen', t }),
      remover: (t: ProcessTarget) => setPending({ kind: 'remove', t }),
      busy,
      dialogs,
    }),
    // dialogs closes over `pending`/`choice`/`busy`; recreate when they change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy, pending, choice],
  );
}

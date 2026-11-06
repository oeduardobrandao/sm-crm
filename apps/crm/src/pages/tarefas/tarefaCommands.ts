import { toast } from 'sonner';
import { i18n } from '@mesaas/i18n';
import {
  isSerieDateConflict,
  updateTarefa,
  type TarefaStatus,
  type TarefaWithRelations,
} from '../../store';

/**
 * The single-field writes every Tarefas view makes (drag on the desktop boards and
 * calendar, the list checkbox, the card's assignee dropdown, the phone menus): one
 * place for the RPC, the toasts and the series guard, so a phone menu action and a
 * desktop drop behave the same. The optional `optimistic` pair is
 * `useOptimisticTarefas`' apply/clear: applied before the write, rolled back on error.
 */
export interface OptimisticPatch {
  apply: (id: number, patch: Partial<TarefaWithRelations>) => void;
  clear: (id: number) => void;
}

/** Sets (or clears, with null) the due date. Series occurrences can't lose their date. */
export async function rescheduleTarefa(
  tarefa: TarefaWithRelations,
  date: string | null,
  onRefresh: () => void,
  optimistic?: OptimisticPatch,
): Promise<void> {
  if ((tarefa.data_limite ?? null) === date) return;
  if (date === null && tarefa.serie) {
    toast.error(i18n.t('tasks:commands.serieNeedsDueDate'));
    return;
  }
  optimistic?.apply(tarefa.id!, { data_limite: date });
  try {
    await updateTarefa(tarefa.id!, { data_limite: date });
    toast.success(
      date ? i18n.t('tasks:commands.dueDateUpdated') : i18n.t('tasks:commands.dueDateRemoved'),
    );
    onRefresh();
  } catch (e) {
    optimistic?.clear(tarefa.id!);
    toast.error(
      isSerieDateConflict(e)
        ? i18n.t('tasks:commands.serieDateConflict')
        : i18n.t('tasks:commands.dueDateError'),
    );
  }
}

/** Status change (Kanban drop, detail segmented control, phone menu). concluida_em is
 *  maintained by the DB trigger, never written here. */
export async function setTarefaStatus(
  tarefa: TarefaWithRelations,
  status: TarefaStatus,
  onRefresh: () => void,
  optimistic?: OptimisticPatch,
): Promise<void> {
  if (tarefa.status === status) return;
  optimistic?.apply(tarefa.id!, { status });
  try {
    await updateTarefa(tarefa.id!, { status });
    toast.success(
      status === 'concluida'
        ? i18n.t('tasks:commands.taskCompleted')
        : i18n.t('tasks:commands.statusUpdated'),
    );
    onRefresh();
  } catch {
    optimistic?.clear(tarefa.id!);
    toast.error(i18n.t('tasks:commands.statusError'));
  }
}

/** The list's complete/reopen toggle: reopening goes back to "A fazer". */
export async function toggleTarefaConcluida(
  tarefa: TarefaWithRelations,
  concluida: boolean,
  onRefresh: () => void,
): Promise<void> {
  try {
    await updateTarefa(tarefa.id!, { status: concluida ? 'concluida' : 'pendente' });
    toast.success(
      concluida ? i18n.t('tasks:commands.taskCompleted') : i18n.t('tasks:commands.taskReopened'),
    );
    onRefresh();
  } catch {
    toast.error(i18n.t('tasks:commands.taskError'));
  }
}

/** Reassign (null = Sem responsável). */
export async function assignTarefa(
  tarefa: TarefaWithRelations,
  responsavelId: number | null,
  onRefresh: () => void,
  optimistic?: OptimisticPatch,
): Promise<void> {
  if ((tarefa.responsavel_id ?? null) === responsavelId) return;
  optimistic?.apply(tarefa.id!, { responsavel_id: responsavelId });
  try {
    await updateTarefa(tarefa.id!, { responsavel_id: responsavelId });
    toast.success(i18n.t('tasks:commands.assigneeUpdated'));
    onRefresh();
  } catch {
    optimistic?.clear(tarefa.id!);
    toast.error(i18n.t('tasks:commands.assigneeError'));
  }
}

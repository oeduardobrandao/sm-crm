import { toast } from 'sonner';
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
    toast.error('Tarefas de uma série precisam de prazo.');
    return;
  }
  optimistic?.apply(tarefa.id!, { data_limite: date });
  try {
    await updateTarefa(tarefa.id!, { data_limite: date });
    toast.success(date ? 'Prazo atualizado!' : 'Prazo removido!');
    onRefresh();
  } catch (e) {
    optimistic?.clear(tarefa.id!);
    toast.error(
      isSerieDateConflict(e)
        ? 'Já existe uma ocorrência desta série nesse dia.'
        : 'Erro ao atualizar prazo',
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
    toast.success(status === 'concluida' ? 'Tarefa concluída!' : 'Status atualizado!');
    onRefresh();
  } catch {
    optimistic?.clear(tarefa.id!);
    toast.error('Erro ao atualizar status');
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
    toast.success(concluida ? 'Tarefa concluída!' : 'Tarefa reaberta!');
    onRefresh();
  } catch {
    toast.error('Erro ao atualizar tarefa');
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
    toast.success('Responsável atualizado!');
    onRefresh();
  } catch {
    optimistic?.clear(tarefa.id!);
    toast.error('Erro ao atualizar responsável');
  }
}

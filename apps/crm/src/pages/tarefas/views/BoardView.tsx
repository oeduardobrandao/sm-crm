import { toast } from 'sonner';
import type { Membro, TarefaWithRelations } from '../../../store';
import { isSerieDateConflict, updateTarefa } from '../../../store';
import { buildDropId, groupByBoardColumn, parseDropId } from '../tarefasLogic';
import { useOptimisticTarefas } from '../hooks/useOptimisticTarefas';
import { TarefaBoard, type BoardColumn, type BoardColumnAccent } from './boardShared';

/** Em atraso reads danger-red, Hoje reads blue -- same rgba-tint-over-solid-text
 *  language as the `.deadline-*` badge classes elsewhere in Tarefas. */
const COLUMN_ACCENTS: Partial<Record<string, BoardColumnAccent>> = {
  atrasado: {
    text: 'var(--danger)',
    bg: 'rgba(239, 68, 68, 0.12)',
    border: 'rgba(239, 68, 68, 0.3)',
  },
  hoje: { text: '#3b82f6', bg: 'rgba(59, 130, 246, 0.12)', border: 'rgba(59, 130, 246, 0.3)' },
};

interface BoardViewProps {
  tarefas: TarefaWithRelations[];
  membros: Membro[];
  onTarefaClick: (tarefa: TarefaWithRelations) => void;
  onRefresh: () => void;
  onCreateTask: (date: string | null) => void;
}

/** Date-bucket kanban: Em atraso / Hoje / Amanhã / weekday columns / Mais
 *  tarde / Sem data. Drag a card onto a droppable column to reschedule it;
 *  Em atraso and Mais tarde have no single unambiguous date, so they're
 *  read-only drop targets (see groupByBoardColumn's `droppable` flag). */
export function BoardView({
  tarefas,
  membros,
  onTarefaClick,
  onRefresh,
  onCreateTask,
}: BoardViewProps) {
  const { merged, applyOverride, clearOverride } = useOptimisticTarefas(tarefas);
  const now = new Date();

  const buckets = groupByBoardColumn(merged, now);
  const columns: BoardColumn[] = buckets.map((b) => ({
    dropId: b.droppable ? buildDropId({ kind: 'day', date: b.date }) : b.key,
    title: b.label,
    tarefas: b.tarefas,
    droppable: b.droppable,
    onAddClick: () => onCreateTask(b.date),
    accent: COLUMN_ACCENTS[b.key],
  }));

  const handleDrop = async (tarefa: TarefaWithRelations, dropId: string) => {
    const target = parseDropId(dropId);
    if (!target || target.kind !== 'day') return;
    if (tarefa.data_limite === target.date) return;
    if (target.date === null && tarefa.serie) {
      toast.error('Tarefas de uma série precisam de prazo.');
      return;
    }
    applyOverride(tarefa.id!, { data_limite: target.date });
    try {
      await updateTarefa(tarefa.id!, { data_limite: target.date });
      toast.success(target.date ? 'Prazo atualizado!' : 'Prazo removido!');
      onRefresh();
    } catch (e) {
      clearOverride(tarefa.id!);
      toast.error(
        isSerieDateConflict(e)
          ? 'Já existe uma ocorrência desta série nesse dia.'
          : 'Erro ao atualizar prazo',
      );
    }
  };

  return (
    <TarefaBoard
      columns={columns}
      membros={membros}
      now={now}
      onCardClick={onTarefaClick}
      onDropCard={handleDrop}
      onRefresh={onRefresh}
    />
  );
}

import { toast } from 'sonner';
import type { Membro, TarefaWithRelations } from '../../../store';
import { updateTarefa } from '../../../store';
import { buildDropId, groupByBoardColumn, parseDropId } from '../tarefasLogic';
import { useOptimisticTarefas } from '../hooks/useOptimisticTarefas';
import { TarefaBoard, type BoardColumn } from './boardShared';

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
  }));

  const handleDrop = async (tarefa: TarefaWithRelations, dropId: string) => {
    const target = parseDropId(dropId);
    if (!target || target.kind !== 'day') return;
    if (tarefa.data_limite === target.date) return;
    applyOverride(tarefa.id!, { data_limite: target.date });
    try {
      await updateTarefa(tarefa.id!, { data_limite: target.date });
      toast.success(target.date ? 'Prazo atualizado!' : 'Prazo removido!');
      onRefresh();
    } catch {
      clearOverride(tarefa.id!);
      toast.error('Erro ao atualizar prazo');
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

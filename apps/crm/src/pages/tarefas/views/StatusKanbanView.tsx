import { toast } from 'sonner';
import type { Membro, TarefaWithRelations } from '../../../store';
import { updateTarefa } from '../../../store';
import {
  buildDropId,
  parseDropId,
  sortTarefas,
  STATUS_LABELS,
  STATUS_ORDER,
} from '../tarefasLogic';
import { useOptimisticTarefas } from '../hooks/useOptimisticTarefas';
import { TarefaBoard, type BoardColumn } from './boardShared';

interface StatusKanbanViewProps {
  tarefas: TarefaWithRelations[];
  membros: Membro[];
  onTarefaClick: (tarefa: TarefaWithRelations) => void;
  onRefresh: () => void;
}

/** Three fixed status columns; drag a card to change status. concluida_em is
 * maintained by the DB trigger, never written here. */
export function StatusKanbanView({
  tarefas,
  membros,
  onTarefaClick,
  onRefresh,
}: StatusKanbanViewProps) {
  const { merged, applyOverride, clearOverride } = useOptimisticTarefas(tarefas);
  const now = new Date();

  const columns: BoardColumn[] = STATUS_ORDER.map((status) => ({
    dropId: buildDropId({ kind: 'status', status }),
    title: STATUS_LABELS[status],
    tarefas: merged.filter((t) => t.status === status).sort(sortTarefas),
  }));

  const handleDrop = async (tarefa: TarefaWithRelations, dropId: string) => {
    const target = parseDropId(dropId);
    if (!target || target.kind !== 'status') return;
    if (tarefa.status === target.status) return;
    applyOverride(tarefa.id!, { status: target.status });
    try {
      await updateTarefa(tarefa.id!, { status: target.status });
      toast.success(target.status === 'concluida' ? 'Tarefa concluída!' : 'Status atualizado!');
      onRefresh();
    } catch {
      clearOverride(tarefa.id!);
      toast.error('Erro ao atualizar status');
    }
  };

  return (
    <TarefaBoard
      columns={columns}
      membros={membros}
      now={now}
      onCardClick={onTarefaClick}
      onDropCard={handleDrop}
    />
  );
}

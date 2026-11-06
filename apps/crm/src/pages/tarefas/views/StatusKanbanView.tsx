import { useTranslation } from 'react-i18next';
import type { Membro, TarefaWithRelations } from '../../../store';
import {
  buildDropId,
  parseDropId,
  sortTarefas,
  STATUS_LABELS,
  STATUS_ORDER,
} from '../tarefasLogic';
import { useOptimisticTarefas } from '../hooks/useOptimisticTarefas';
import { setTarefaStatus } from '../tarefaCommands';
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
  const { t: tr } = useTranslation('tasks');
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
    await setTarefaStatus(tarefa, target.status, onRefresh, {
      apply: applyOverride,
      clear: clearOverride,
    });
  };

  return (
    <TarefaBoard
      columns={columns}
      membros={membros}
      now={now}
      onCardClick={onTarefaClick}
      onDropCard={handleDrop}
      onRefresh={onRefresh}
      phoneChipsLabel={tr('views.chipsStatus')}
    />
  );
}

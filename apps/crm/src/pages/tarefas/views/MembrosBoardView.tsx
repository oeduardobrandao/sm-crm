import { toast } from 'sonner';
import type { Membro, TarefaWithRelations } from '../../../store';
import { updateTarefa } from '../../../store';
import { buildDropId, parseDropId, sortTarefas } from '../tarefasLogic';
import { useOptimisticTarefas } from '../hooks/useOptimisticTarefas';
import { TarefaBoard, type BoardColumn } from './boardShared';

interface MembrosBoardViewProps {
  tarefas: TarefaWithRelations[];
  membros: Membro[];
  onTarefaClick: (tarefa: TarefaWithRelations) => void;
  onRefresh: () => void;
  /** Restricts the rendered columns to this membro (plus "Sem responsável")
   *  -- the Minhas tarefas scope. The full `membros` list still reaches
   *  TarefaBoard/TarefaCard so avatar resolution and the reassign dropdown
   *  keep every teammate as an option. */
  onlyMembroId?: number | null;
}

/** One column per team member (plus "Sem responsável"); drag a card to reassign. */
export function MembrosBoardView({
  tarefas,
  membros,
  onTarefaClick,
  onRefresh,
  onlyMembroId = null,
}: MembrosBoardViewProps) {
  const { merged, applyOverride, clearOverride } = useOptimisticTarefas(tarefas);
  const now = new Date();

  const open = merged.filter((t) => t.status !== 'concluida');
  const columnMembros =
    onlyMembroId != null ? membros.filter((m) => m.id === onlyMembroId) : membros;

  const columns: BoardColumn[] = [
    {
      dropId: buildDropId({ kind: 'membro', membroId: null }),
      title: 'Sem responsável',
      tarefas: open.filter((t) => t.responsavel_id == null).sort(sortTarefas),
    },
    ...columnMembros
      .filter((m) => m.id != null)
      .map((m) => ({
        dropId: buildDropId({ kind: 'membro', membroId: m.id! }),
        title: m.nome,
        tarefas: open.filter((t) => t.responsavel_id === m.id).sort(sortTarefas),
        hideAssignee: true,
      })),
  ];

  const handleDrop = async (tarefa: TarefaWithRelations, dropId: string) => {
    const target = parseDropId(dropId);
    if (!target || target.kind !== 'membro') return;
    if (tarefa.responsavel_id === target.membroId) return;
    applyOverride(tarefa.id!, { responsavel_id: target.membroId });
    try {
      await updateTarefa(tarefa.id!, { responsavel_id: target.membroId });
      toast.success('Responsável atualizado!');
      onRefresh();
    } catch {
      clearOverride(tarefa.id!);
      toast.error('Erro ao atualizar responsável');
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

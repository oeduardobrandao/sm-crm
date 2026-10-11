import { useRef } from 'react';
import { toast } from 'sonner';
import { PhoneConfirmSheet } from '@/components/mobile/PhoneConfirmSheet';
import { deleteTarefa, deleteTarefaSerieCompleta, type TarefaWithRelations } from '../../../store';
import { serieEstado } from '../recorrenciaLogic';
import './tarefasPhone.css';

export interface TarefaDeleteConfirmProps {
  tarefa: TarefaWithRelations;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => void;
  /** After a successful delete (the detail screen closes itself here). */
  onDeleted?: () => void;
}

function Choice({ title, desc }: { title: string; desc?: string }) {
  return (
    <span className="phone-tar-choice">
      <span className="phone-tar-choice__title">{title}</span>
      {desc && <span className="phone-tar-choice__desc">{desc}</span>}
    </span>
  );
}

/**
 * The detail sheet's "Excluir" confirmation on phones, as an action sheet with the same
 * copy, the same series scope (Somente esta / Toda a série) and the same writes. Shared
 * by the detail screen, the list's swipe action and every card menu, so no path deletes
 * a series occurrence without offering the scope.
 */
export function TarefaDeleteConfirm({
  tarefa,
  open,
  onOpenChange,
  onRefresh,
  onDeleted,
}: TarefaDeleteConfirmProps) {
  // Ref guard: two taps in the same tick must not both delete.
  const inFlight = useRef(false);
  const serie = tarefa.serie;

  const run = async (kind: 'tarefa' | 'serie') => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      if (kind === 'serie' && serie) {
        await deleteTarefaSerieCompleta(serie.id);
        toast.success('Série excluída!');
      } else {
        await deleteTarefa(tarefa.id!);
        toast.success('Tarefa excluída!');
      }
      onDeleted?.();
      onRefresh();
    } catch {
      toast.error(kind === 'serie' ? 'Erro ao excluir a série' : 'Erro ao excluir tarefa');
    } finally {
      inFlight.current = false;
    }
  };

  const close = () => onOpenChange(false);

  if (serie) {
    const proximaNormal =
      tarefa.status !== 'concluida' &&
      serie.modo === 'ao_concluir' &&
      serieEstado(serie, new Date()) === 'ativa';
    return (
      <PhoneConfirmSheet
        open={open}
        onCancel={close}
        title="Excluir tarefa recorrente?"
        message={`A tarefa "${tarefa.titulo}" faz parte de uma série.`}
        actions={[
          {
            label: (
              <Choice
                title="Somente esta"
                desc={proximaNormal ? 'A próxima ocorrência será criada normalmente.' : undefined}
              />
            ),
            onSelect: () => {
              close();
              void run('tarefa');
            },
          },
          {
            label: (
              <Choice
                title="Toda a série"
                desc="Remove a série e as ocorrências abertas. As concluídas ficam."
              />
            ),
            destructive: true,
            onSelect: () => {
              close();
              void run('serie');
            },
          },
        ]}
      />
    );
  }

  return (
    <PhoneConfirmSheet
      open={open}
      onCancel={close}
      title="Excluir tarefa?"
      message={`A tarefa "${tarefa.titulo}" e suas subtarefas serão excluídas. Essa ação não pode ser desfeita.`}
      actions={[
        {
          label: 'Excluir tarefa',
          destructive: true,
          onSelect: () => {
            close();
            void run('tarefa');
          },
        },
      ]}
    />
  );
}

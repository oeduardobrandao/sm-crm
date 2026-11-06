import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('tasksPhone');
  // Ref guard: two taps in the same tick must not both delete.
  const inFlight = useRef(false);
  const serie = tarefa.serie;

  const run = async (kind: 'tarefa' | 'serie') => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      if (kind === 'serie' && serie) {
        await deleteTarefaSerieCompleta(serie.id);
        toast.success(t('deleteConfirm.seriesDeleted'));
      } else {
        await deleteTarefa(tarefa.id!);
        toast.success(t('deleteConfirm.taskDeleted'));
      }
      onDeleted?.();
      onRefresh();
    } catch {
      toast.error(
        kind === 'serie'
          ? t('deleteConfirm.seriesDeleteError')
          : t('deleteConfirm.taskDeleteError'),
      );
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
        title={t('deleteConfirm.recurringTitle')}
        message={t('deleteConfirm.recurringMessage', { title: tarefa.titulo })}
        actions={[
          {
            label: (
              <Choice
                title={t('deleteConfirm.onlyThis')}
                desc={proximaNormal ? t('deleteConfirm.nextCreatedNormally') : undefined}
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
                title={t('deleteConfirm.wholeSeries')}
                desc={t('deleteConfirm.wholeSeriesDesc')}
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
      title={t('deleteConfirm.title')}
      message={t('deleteConfirm.message', { title: tarefa.titulo })}
      actions={[
        {
          label: t('deleteConfirm.confirm'),
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

import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BottomSheet } from '@/components/mobile/BottomSheet';
import { useSheetActions } from '@/components/mobile/sheetActions';
import type { TarefaWithRelations } from '../../../store';
import './tarefasPhone.css';

export interface PrazoSheetProps {
  tarefa: TarefaWithRelations;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 'YYYY-MM-DD', or null to remove the due date. */
  onSave: (date: string | null) => void;
}

/**
 * Reschedule on phones (D30: the desktop calendar and date board move tasks by drag;
 * here it's a menu action). The native date input gives iOS its own date wheel.
 * Series occurrences can't lose their date, so "Remover prazo" is off for them.
 */
export function PrazoSheet({ tarefa, open, onOpenChange, onSave }: PrazoSheetProps) {
  const { t } = useTranslation('tasksPhone');
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('shared.dueDate')}
      description={t('prazoSheet.description', { title: tarefa.titulo })}
      detents={['fit']}
    >
      <PrazoBody tarefa={tarefa} onSave={onSave} />
    </BottomSheet>
  );
}

function PrazoBody({ tarefa, onSave }: Pick<PrazoSheetProps, 'tarefa' | 'onSave'>) {
  const { t } = useTranslation('tasksPhone');
  const inputId = useId();
  // Mounted with the open sheet, so it starts from the current date every time.
  const [value, setValue] = useState(tarefa.data_limite ?? '');
  const { closeThen } = useSheetActions();
  // The save runs once the sheet's history entry is gone: a new date can move the row
  // that owns this sheet out of view.
  const finish = (date: string | null) => closeThen(() => onSave(date));

  return (
    <div className="phone-tar-prazo">
      <label htmlFor={inputId} className="sr-only">
        {t('shared.dueDate')}
      </label>
      <input id={inputId} type="date" value={value} onChange={(e) => setValue(e.target.value)} />
      {tarefa.serie && <p className="phone-tar-prazo__note">{t('prazoSheet.seriesNote')}</p>}
      <div className="phone-tar-prazo__actions">
        <button
          type="button"
          className="phone-tar-secondary-btn"
          disabled={!!tarefa.serie || !tarefa.data_limite}
          onClick={() => finish(null)}
        >
          {t('prazoSheet.remove')}
        </button>
        <button
          type="button"
          className="phone-tar-ink-btn"
          disabled={!value || value === tarefa.data_limite}
          onClick={() => finish(value)}
        >
          {t('actions.save')}
        </button>
      </div>
    </div>
  );
}

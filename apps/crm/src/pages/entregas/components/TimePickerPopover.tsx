import { useState, useRef, useEffect } from 'react';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { useDateFnsLocale } from '@mesaas/i18n';
import { Clock, X } from 'lucide-react';

interface TimePickerPopoverProps {
  date: Date;
  onConfirm: (datetime: Date) => void;
  onCancel: () => void;
  previousTime?: { hour: number; minute: number };
}

export function TimePickerPopover({
  date,
  onConfirm,
  onCancel,
  previousTime,
}: TimePickerPopoverProps) {
  const { t } = useTranslation('postPanels');
  const dateLocale = useDateFnsLocale();
  const [hour, setHour] = useState(previousTime?.hour ?? 10);
  const [minute, setMinute] = useState(previousTime?.minute ?? 0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onCancel();
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onCancel]);

  const handleConfirm = () => {
    const dt = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute);
    onConfirm(dt);
  };

  const dateLabel = format(date, t('timePicker.dateFormat'), { locale: dateLocale });

  return (
    <div ref={ref} className="time-picker-popover">
      <div className="time-picker-header">
        <Clock className="h-3.5 w-3.5" style={{ color: 'var(--primary-color)' }} />
        <span className="time-picker-date">{dateLabel}</span>
        <button onClick={onCancel} className="time-picker-close" aria-label={t('ui.close')}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="time-picker-selectors">
        <div className="time-picker-field">
          <select
            aria-label={t('timePicker.hour')}
            value={hour}
            onChange={(e) => setHour(parseInt(e.target.value, 10))}
            className="time-picker-select"
          >
            {Array.from({ length: 24 }, (_, i) => (
              <option key={i} value={i}>
                {String(i).padStart(2, '0')}
              </option>
            ))}
          </select>
        </div>
        <span className="time-picker-separator">:</span>
        <div className="time-picker-field">
          <select
            aria-label={t('timePicker.minute')}
            value={minute}
            onChange={(e) => setMinute(parseInt(e.target.value, 10))}
            className="time-picker-select"
          >
            {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
              <option key={m} value={m}>
                {String(m).padStart(2, '0')}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="time-picker-actions">
        <button onClick={onCancel} className="time-picker-cancel">
          {t('actions.cancel')}
        </button>
        <button onClick={handleConfirm} className="time-picker-confirm">
          {t('actions.confirm')}
        </button>
      </div>
    </div>
  );
}

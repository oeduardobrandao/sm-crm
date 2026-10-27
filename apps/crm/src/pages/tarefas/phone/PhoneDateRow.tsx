import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FormRow } from '@/components/mobile/FormRow';
import { parseDateOnly, toDateOnlyString } from '../tarefasLogic';
import './tarefasPhone.css';

export interface PhoneDateRowProps {
  label: string;
  value: Date | undefined;
  onChange: (value: Date | undefined) => void;
  /** Shown as the clear button's target when empty ("Sem prazo", "Nunca"). */
  emptyLabel: string;
  error?: string;
  helper?: string;
  disabled?: boolean;
}

/**
 * A date field row for the phone forms: the native date input (iOS shows its own date
 * wheel) with a clear button, instead of the desktop DatePicker popover.
 */
export function PhoneDateRow({
  label,
  value,
  onChange,
  emptyLabel,
  error,
  helper,
  disabled,
}: PhoneDateRowProps) {
  const { t } = useTranslation('tasksPhone');
  return (
    <FormRow
      label={label}
      error={error}
      helper={helper}
      disabled={disabled}
      accessory={
        value && !disabled ? (
          <button
            type="button"
            className="phone-tar-form__date-clear"
            aria-label={t('dateRow.clear', { label: label.toLowerCase() })}
            onClick={() => onChange(undefined)}
          >
            <X aria-hidden="true" />
          </button>
        ) : undefined
      }
    >
      {(field) => (
        <span className="phone-tar-form__date-wrap" data-empty={value ? undefined : ''}>
          {!value && (
            <span className="phone-tar-form__date-empty" aria-hidden="true">
              {emptyLabel}
            </span>
          )}
          <input
            {...field}
            type="date"
            className="phone-tar-form__date"
            disabled={disabled}
            aria-description={value ? undefined : emptyLabel}
            value={value ? toDateOnlyString(value) : ''}
            onChange={(e) => onChange(e.target.value ? parseDateOnly(e.target.value) : undefined)}
          />
        </span>
      )}
    </FormRow>
  );
}

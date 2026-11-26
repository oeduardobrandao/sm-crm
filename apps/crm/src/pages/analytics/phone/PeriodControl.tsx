import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BottomSheet } from '@/components/mobile/BottomSheet';
import { GroupedList } from '@/components/mobile/GroupedList';
import { FormRow } from '@/components/mobile/FormRow';
import { SegmentedControl } from '@/components/mobile/SegmentedControl';

export interface PeriodPreset {
  value: string;
  label: string;
}

const CUSTOM = '__custom';

export interface PeriodCustom {
  /** Days of the custom window when it is the active one, else null. */
  days: number | null;
  min: number;
  max: number;
  onApply: (days: number) => void;
}

/**
 * The analytics period on phones: presets in a segmented control plus "Personalizado",
 * which opens a sheet with the number of days and an explicit Aplicar (the desktop field
 * only commits on Enter, which a phone keyboard may not even show).
 */
export function PeriodSegmented({
  presets,
  value,
  onChange,
  custom,
  'aria-label': ariaLabelProp,
}: {
  presets: PeriodPreset[];
  /** The active preset's value; ignored while a custom window is active. */
  value: string | null;
  onChange: (value: string) => void;
  custom?: PeriodCustom;
  'aria-label'?: string;
}) {
  const { t } = useTranslation('analyticsPhone');
  const ariaLabel = ariaLabelProp ?? t('period.default');
  const [sheetOpen, setSheetOpen] = useState(false);
  const customActive = custom?.days != null;
  const options = [...presets, ...(custom ? [{ value: CUSTOM, label: t('period.custom') }] : [])];
  const current = customActive ? CUSTOM : (value ?? '');

  return (
    <div className="phone-an-period">
      <SegmentedControl
        aria-label={ariaLabel}
        options={options}
        value={current}
        onChange={(v) => {
          if (v === CUSTOM) setSheetOpen(true);
          else onChange(v);
        }}
      />
      {custom && customActive && (
        <p className="phone-an-period__custom">
          <span>{t('period.last', { days: custom.days })}</span>
          <button type="button" className="phone-text-button" onClick={() => setSheetOpen(true)}>
            {t('period.change')}
          </button>
        </p>
      )}
      {custom && (
        <CustomDaysSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          initial={custom.days}
          min={custom.min}
          max={custom.max}
          onApply={(days) => {
            custom.onApply(days);
            setSheetOpen(false);
          }}
        />
      )}
    </div>
  );
}

function CustomDaysSheet({
  open,
  onOpenChange,
  initial,
  min,
  max,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: number | null;
  min: number;
  max: number;
  onApply: (days: number) => void;
}) {
  const { t } = useTranslation('analyticsPhone');
  const [text, setText] = useState(initial ? String(initial) : '');
  const [error, setError] = useState('');
  const formId = useId();
  useEffect(() => {
    if (open) {
      setText(initial ? String(initial) : '');
      setError('');
    }
  }, [open, initial]);

  const apply = () => {
    const days = parseInt(text, 10);
    if (isNaN(days) || days < min || days > max) {
      setError(t('period.error', { min, max }));
      return;
    }
    onApply(days);
  };

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('period.sheetTitle')}
      detents={['fit']}
      className="phone-an-sheet"
    >
      <form
        id={formId}
        className="phone-an-custom-sheet__body"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <GroupedList aria-label={t('period.sheetTitle')}>
          <FormRow
            label={t('period.lastLabel')}
            helper={error ? undefined : t('period.between', { min, max })}
            error={error || undefined}
            accessory={<span className="phone-an-tone--muted">{t('period.days')}</span>}
            input={{
              type: 'number',
              inputMode: 'numeric',
              min,
              max,
              placeholder: t('period.daysPlaceholder'),
              value: text,
              autoFocus: true,
              'aria-label': t('period.ariaDays'),
              onChange: (e) => {
                setText(e.target.value);
                if (error) setError('');
              },
            }}
          />
        </GroupedList>
        <button type="submit" className="phone-an-primary-button">
          {t('period.apply')}
        </button>
      </form>
    </BottomSheet>
  );
}

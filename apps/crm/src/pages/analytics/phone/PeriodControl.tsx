import { useEffect, useId, useState } from 'react';
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
  'aria-label': ariaLabel = 'Período',
}: {
  presets: PeriodPreset[];
  /** The active preset's value; ignored while a custom window is active. */
  value: string | null;
  onChange: (value: string) => void;
  custom?: PeriodCustom;
  'aria-label'?: string;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const customActive = custom?.days != null;
  const options = [...presets, ...(custom ? [{ value: CUSTOM, label: 'Personalizado' }] : [])];
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
          <span>Últimos {custom.days} dias</span>
          <button type="button" className="phone-text-button" onClick={() => setSheetOpen(true)}>
            Alterar
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
      setError(`Insira um valor entre ${min} e ${max} dias`);
      return;
    }
    onApply(days);
  };

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Período personalizado"
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
        <GroupedList aria-label="Período personalizado">
          <FormRow
            label="Últimos"
            helper={error ? undefined : `Entre ${min} e ${max} dias`}
            error={error || undefined}
            accessory={<span className="phone-an-tone--muted">dias</span>}
            input={{
              type: 'number',
              inputMode: 'numeric',
              min,
              max,
              placeholder: 'Dias',
              value: text,
              autoFocus: true,
              'aria-label': 'Período personalizado em dias',
              onChange: (e) => {
                setText(e.target.value);
                if (error) setError('');
              },
            }}
          />
        </GroupedList>
        <button type="submit" className="phone-an-primary-button">
          Aplicar
        </button>
      </form>
    </BottomSheet>
  );
}

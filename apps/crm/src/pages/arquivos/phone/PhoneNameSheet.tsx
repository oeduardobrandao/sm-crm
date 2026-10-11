import { useEffect, useRef, useState } from 'react';
import { BottomSheet } from '@/components/mobile/BottomSheet';
import { FormRow } from '@/components/mobile/FormRow';
import { GroupedList } from '@/components/mobile/GroupedList';

export interface PhoneNameSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "Nova pasta", "Renomear arquivo". */
  title: string;
  /** Field label ("Nome"). */
  label?: string;
  initialValue?: string;
  placeholder: string;
  /** Header button ("Criar", "Salvar"). */
  confirmLabel: string;
  busyLabel?: string;
  busy?: boolean;
  /** Gets the trimmed name. The sheet stays open while it runs; the caller closes it. */
  onConfirm: (name: string) => void;
}

/**
 * Name a folder or file on phones (Nova pasta, Renomear): a short bottom sheet with one
 * field, Cancelar on the left and the confirm on the right, iOS style. Enter confirms.
 */
export function PhoneNameSheet({
  open,
  onOpenChange,
  title,
  label = 'Nome',
  initialValue = '',
  placeholder,
  confirmLabel,
  busyLabel,
  busy = false,
  onConfirm,
}: PhoneNameSheetProps) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setValue(initialValue);
    // After the sheet's own focus handling, so the keyboard comes up on the field.
    const id = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(id);
    // Only on (re)open: typing must not be reset by a parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const trimmed = value.trim();
  const submit = () => {
    if (!trimmed || busy) return;
    onConfirm(trimmed);
  };

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      detents={['fit']}
      headerLeading={
        <button type="button" className="phone-text-button" onClick={() => onOpenChange(false)}>
          Cancelar
        </button>
      }
      headerTrailing={
        <button
          type="button"
          className="phone-text-button phone-text-button--strong"
          disabled={!trimmed || busy}
          onClick={submit}
        >
          {busy ? (busyLabel ?? confirmLabel) : confirmLabel}
        </button>
      }
    >
      <form
        className="phone-arq-name"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <GroupedList aria-label={title}>
          <FormRow
            label={label}
            layout="stacked"
            input={{
              ref: inputRef,
              value,
              placeholder,
              autoComplete: 'off',
              enterKeyHint: 'done',
              onChange: (e) => setValue(e.target.value),
            }}
          />
        </GroupedList>
      </form>
    </BottomSheet>
  );
}

import type { ReactNode } from 'react';
import { BottomSheet } from '@/components/mobile/BottomSheet';
import {
  CheckList,
  type CheckListOption,
  type CheckListValue,
} from '@/components/mobile/CheckList';
import { useSheetActions } from '@/components/mobile/sheetActions';

export interface ActionPickerSheetProps<T extends CheckListValue> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  options: CheckListOption<T>[];
  value: T | null;
  emptyOption?: { label: ReactNode };
  searchable?: boolean;
  /** Runs once the sheet is closed and its history entry popped. */
  onPick: (value: T | null) => void;
}

function PickerBody<T extends CheckListValue>({
  options,
  value,
  emptyOption,
  searchable,
  onPick,
  label,
}: Pick<
  ActionPickerSheetProps<T>,
  'options' | 'value' | 'emptyOption' | 'searchable' | 'onPick'
> & { label?: string }) {
  const { closeThen } = useSheetActions();
  return (
    <CheckList<T>
      aria-label={label}
      options={options}
      value={value}
      emptyOption={emptyOption}
      searchable={searchable}
      onChange={(next) => closeThen(() => onPick(next))}
    />
  );
}

/**
 * A single-choice picker whose pick is an action (move, reassign), not a form value.
 * Unlike `PickerSheet`, the action runs only after the sheet has closed and popped its
 * history entry (`closeThen`): a move can take the card that owns the sheet out of the
 * visible column, and a sheet unmounted while open would leave a dead Back entry.
 */
export function ActionPickerSheet<T extends CheckListValue>({
  open,
  onOpenChange,
  title,
  description,
  options,
  value,
  emptyOption,
  searchable,
  onPick,
}: ActionPickerSheetProps<T>) {
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      detents={searchable ? ['large'] : ['fit']}
      className="phone-picker-sheet"
    >
      <PickerBody<T>
        label={typeof title === 'string' ? title : undefined}
        options={options}
        value={value}
        emptyOption={emptyOption}
        searchable={searchable}
        onPick={onPick}
      />
    </BottomSheet>
  );
}

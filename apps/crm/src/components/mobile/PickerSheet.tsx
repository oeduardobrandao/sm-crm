import { useState, type ReactNode, type RefObject } from 'react';
import { BottomSheet, type SheetDetent } from './BottomSheet';
import {
  CheckList,
  type CheckListOption,
  type CheckListProps,
  type CheckListValue,
} from './CheckList';
import { Cell } from './GroupedList';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type PickerSheetProps<T extends CheckListValue = CheckListValue> = DistributiveOmit<
  CheckListProps<T>,
  'onPicked'
> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Defaults to `large` with a search field, else to the list's own height. */
  detents?: SheetDetent[];
  returnFocusRef?: RefObject<HTMLElement | null>;
};

/**
 * The phone replacement for Select, DropdownMenu and the native select: a bottom sheet
 * with a checkmark list. Single select closes on the pick; multi select applies each
 * toggle at once and closes with the sheet's X (iOS Settings behaviour).
 */
export function PickerSheet<T extends CheckListValue>(props: PickerSheetProps<T>) {
  const { open, onOpenChange, title, description, detents, returnFocusRef, ...list } = props;
  const resolvedDetents = detents ?? (list.searchable ? ['large'] : ['fit']);
  const listProps = (
    list.multiple ? list : { ...list, onPicked: () => onOpenChange(false) }
  ) as CheckListProps<T>;
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      detents={resolvedDetents}
      returnFocusRef={returnFocusRef}
      className="phone-picker-sheet"
    >
      <CheckList
        {...listProps}
        aria-label={list['aria-label'] ?? (typeof title === 'string' ? title : undefined)}
      />
    </BottomSheet>
  );
}

interface PickerCellCommon<T extends CheckListValue> {
  /** Row label; also the sheet title unless `sheetTitle` is given. */
  label: string;
  options: CheckListOption<T>[];
  /** Shown as the value when nothing is picked and there is no `emptyOption`. */
  placeholder?: ReactNode;
  emptyOption?: { label: ReactNode };
  searchable?: boolean;
  sheetTitle?: ReactNode;
  icon?: ReactNode;
  iconColor?: string;
  subtitle?: ReactNode;
  disabled?: boolean;
  id?: string;
  'data-testid'?: string;
}

export type PickerCellProps<T extends CheckListValue = CheckListValue> = PickerCellCommon<T> &
  (
    | { multiple?: false; value: T | null; onChange: (value: T | null) => void }
    | { multiple: true; value: T[]; onChange: (value: T[]) => void }
  );

/**
 * A `Cell` that shows the current value and opens a `PickerSheet` (use it inside a
 * `GroupedList`). The sheet mounts on the first tap and stays mounted after, so a page
 * with many pickers doesn't pay for closed sheets.
 */
export function PickerCell<T extends CheckListValue>(props: PickerCellProps<T>) {
  const {
    label,
    options,
    placeholder,
    emptyOption,
    searchable,
    sheetTitle,
    icon,
    iconColor,
    subtitle,
    disabled,
    id,
    'data-testid': testId,
  } = props;
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  const labelOf = (value: T) => options.find((o) => o.value === value)?.label;
  let summary: ReactNode;
  if (props.multiple) {
    const picked = options.filter((o) => props.value.includes(o.value));
    if (picked.length === 0) summary = emptyOption?.label ?? placeholder;
    else if (picked.length === 1) summary = picked[0].label;
    else {
      const first = picked[0].label;
      summary =
        typeof first === 'string'
          ? `${first} +${picked.length - 1}`
          : `${picked.length} selecionados`;
    }
  } else {
    summary =
      props.value === null
        ? (emptyOption?.label ?? placeholder)
        : (labelOf(props.value) ?? placeholder);
  }

  const sheetProps = props.multiple
    ? ({ multiple: true, value: props.value, onChange: props.onChange } as const)
    : ({ multiple: false, value: props.value, onChange: props.onChange } as const);

  return (
    <>
      <Cell
        id={id}
        data-testid={testId}
        label={label}
        subtitle={subtitle}
        icon={icon}
        iconColor={iconColor}
        value={summary}
        chevron
        disabled={disabled}
        aria-haspopup="dialog"
        onClick={() => {
          setMounted(true);
          setOpen(true);
        }}
      />
      {mounted && (
        <PickerSheet<T>
          {...sheetProps}
          open={open}
          onOpenChange={setOpen}
          title={sheetTitle ?? label}
          options={options}
          emptyOption={emptyOption}
          searchable={searchable}
        />
      )}
    </>
  );
}

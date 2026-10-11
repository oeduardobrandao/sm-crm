import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { rovingIndex } from './roving';

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Accessible name when `label` isn't plain text. */
  ariaLabel?: string;
  /** tablist only: id of the panel this tab controls. */
  controls?: string;
  /** tablist only: id for the tab itself (so the panel can point back at it). */
  id?: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group. */
  'aria-label': string;
  /**
   * `radiogroup` when the segments pick a value (filters, modes), `tablist` when each
   * one shows a different panel. Both use roving focus and arrow keys; selection
   * follows focus.
   */
  semantics?: 'radiogroup' | 'tablist';
  className?: string;
}

/** iOS segmented control: a grey track with a white thumb on the selected segment. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  semantics = 'radiogroup',
  className,
  'aria-label': ariaLabel,
}: SegmentedControlProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const isTabs = semantics === 'tablist';
  const enabled = options.filter((o) => !o.disabled);
  const selectedIndex = options.findIndex((o) => o.value === value);
  // A value that matches no segment still needs one tab stop.
  const tabStop = selectedIndex >= 0 ? selectedIndex : options.indexOf(enabled[0]);

  const move = (from: number, e: KeyboardEvent) => {
    const enabledIdx = enabled.indexOf(options[from]);
    const next = rovingIndex(e, enabledIdx, enabled.length, 'horizontal');
    if (next === null) return;
    e.preventDefault();
    const target = enabled[next];
    const i = options.indexOf(target);
    refs.current[i]?.focus();
    if (target.value !== value) onChange(target.value);
  };

  return (
    <div
      role={semantics}
      aria-label={ariaLabel}
      className={cn('phone-kit phone-segmented', className)}
    >
      {options.map((option, i) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            id={isTabs ? option.id : undefined}
            role={isTabs ? 'tab' : 'radio'}
            aria-selected={isTabs ? selected : undefined}
            aria-checked={isTabs ? undefined : selected}
            aria-controls={isTabs ? option.controls : undefined}
            aria-label={option.ariaLabel}
            disabled={option.disabled}
            tabIndex={i === tabStop ? 0 : -1}
            data-state={selected ? 'on' : 'off'}
            className="phone-segmented__item"
            onClick={() => {
              if (!selected) onChange(option.value);
            }}
            onKeyDown={(e) => move(i, e)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

import { createContext, useContext, useRef, type ReactNode } from 'react';
import type React from 'react';
import { X } from 'lucide-react';
import { cn } from './cn';
import { rovingIndex } from './roving';

type ChipRowSemantics = 'group' | 'tablist';
const ChipRowContext = createContext<ChipRowSemantics>('group');

export interface ChipRowProps {
  /** Accessible name of the row ("Etapas", "Filtros ativos"). */
  'aria-label': string;
  /**
   * `group`: independent toggle or removable chips (aria-pressed).
   * `tablist`: exactly one selected chip that switches what's below (aria-selected),
   * with arrow-key navigation.
   */
  semantics?: ChipRowSemantics;
  className?: string;
  children: ReactNode;
}

/** One-line horizontally scrolling row of chips (filters, etapas). Scrollbar hidden. */
export function ChipRow({
  semantics = 'group',
  className,
  children,
  'aria-label': ariaLabel,
}: ChipRowProps) {
  const ref = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (semantics !== 'tablist') return;
    const tabs = Array.from(
      ref.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])') ?? [],
    );
    const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) return;
    const next = rovingIndex(e, current, tabs.length, 'horizontal');
    if (next === null) return;
    e.preventDefault();
    tabs[next].focus();
    tabs[next].click();
  };
  return (
    <ChipRowContext.Provider value={semantics}>
      <div
        ref={ref}
        role={semantics}
        aria-label={ariaLabel}
        className={cn('phone-kit phone-chip-row', className)}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </ChipRowContext.Provider>
  );
}

export interface ChipProps {
  label: ReactNode;
  /** Trailing count ("Produção 3"). */
  count?: number;
  selected?: boolean;
  onClick?: () => void;
  /** Makes it a dark removable filter chip; `removeLabel` names the action for screen readers. */
  onRemove?: () => void;
  removeLabel?: string;
  icon?: ReactNode;
  disabled?: boolean;
  /** tablist only: id of the panel the chip controls. */
  controls?: string;
}

export function Chip({
  label,
  count,
  selected = false,
  onClick,
  onRemove,
  removeLabel,
  icon,
  disabled,
  controls,
}: ChipProps) {
  const semantics = useContext(ChipRowContext);
  if (onRemove) {
    return (
      <button
        type="button"
        className="phone-chip phone-chip--removable"
        aria-label={removeLabel}
        disabled={disabled}
        onClick={onRemove}
      >
        {icon && <span aria-hidden="true">{icon}</span>}
        <span>{label}</span>
        <X className="phone-chip__remove" aria-hidden="true" />
      </button>
    );
  }
  const isTab = semantics === 'tablist';
  return (
    <button
      type="button"
      role={isTab ? 'tab' : undefined}
      aria-selected={isTab ? selected : undefined}
      aria-pressed={isTab ? undefined : selected}
      aria-controls={isTab ? controls : undefined}
      tabIndex={isTab && !selected ? -1 : undefined}
      data-state={selected ? 'on' : 'off'}
      disabled={disabled}
      className="phone-chip"
      onClick={onClick}
    >
      {icon && <span aria-hidden="true">{icon}</span>}
      <span>{label}</span>
      {count != null && <span className="phone-chip__count">{count}</span>}
    </button>
  );
}

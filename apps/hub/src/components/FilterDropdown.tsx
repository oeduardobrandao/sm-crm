import { useRef, useState, type KeyboardEvent } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronDown } from 'lucide-react';
import { useHubLook } from '../hooks/useHubLook';
import { FILTER_PILL_CLASS, filterPillStyle } from './filterPill';

export interface FilterDropdownItem {
  key: string;
  label: string;
  /** Shown as `(n)` after the label; `null` for the "all" entry. */
  count: number | null;
}

interface FilterDropdownProps {
  /** Accessible name of the menu. */
  groupLabel: string;
  triggerLabel: string;
  /** Paints the trigger as selected (a non-"all" option is chosen). */
  active: boolean;
  items: FilterDropdownItem[];
  /** Index of the checked item. */
  currentIndex: number;
  onChange: (key: string) => void;
}

/**
 * Postagens filter pill that opens a single-select menu. It renders just the trigger (no
 * wrapper) so the page can put it on the same row as the status chips.
 *
 * The menu portals INTO `.hub-root` (same reason as HubDialog): the hub theme vars and the
 * `data-theme` attribute live there, so a body portal would render unthemed. The filter bar
 * turns `position: fixed` while the page scrolls, which is the other reason not to render
 * the panel inline.
 */
export function FilterDropdown({
  groupLabel,
  triggerLabel,
  active,
  items,
  currentIndex,
  onChange,
}: FilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const look = useHubLook();
  const pauta = look === 'pauta';
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const container =
    typeof document !== 'undefined'
      ? (document.querySelector<HTMLElement>('.hub-root') ?? document.body)
      : undefined;

  const pick = (key: string) => {
    onChange(key);
    setOpen(false);
  };

  // Roving focus: arrows/Home/End move between options; Enter/Space activate the focused
  // button natively (which selects and closes).
  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const focused = itemRefs.current.findIndex((el) => el === document.activeElement);
    let next: number | null = null;
    if (e.key === 'ArrowDown') next = (focused + 1) % items.length;
    else if (e.key === 'ArrowUp') next = (focused - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next === null) return;
    e.preventDefault();
    itemRefs.current[next]?.focus();
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className={FILTER_PILL_CLASS} style={filterPillStyle(active, look)}>
          <span className="min-w-0 truncate">{triggerLabel}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal container={container}>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          aria-label={groupLabel}
          onOpenAutoFocus={(e) => {
            // Land on the current option instead of the panel so arrows work at once.
            e.preventDefault();
            itemRefs.current[currentIndex]?.focus();
          }}
          className={`z-50 flex w-[260px] max-w-[calc(100vw-24px)] flex-col overflow-hidden ${
            pauta ? 'rounded-[var(--hub-r-card)]' : 'rounded-[4px]'
          } border focus:outline-none`}
          style={{
            background: 'var(--hub-card)',
            color: 'var(--hub-txt)',
            borderColor: 'var(--hub-bd2)',
            boxShadow: '0 12px 32px -12px rgba(28, 25, 23, 0.25), 0 2px 6px rgba(28, 25, 23, 0.08)',
          }}
        >
          <div
            role="menu"
            aria-label={groupLabel}
            onKeyDown={onMenuKeyDown}
            className="max-h-[min(320px,60vh)] overflow-y-auto p-1"
          >
            {items.map((item, index) => {
              const checked = index === currentIndex;
              return (
                <button
                  key={item.key}
                  ref={(el) => {
                    itemRefs.current[index] = el;
                  }}
                  type="button"
                  role="menuitemradio"
                  aria-checked={checked}
                  tabIndex={checked ? 0 : -1}
                  onClick={() => pick(item.key)}
                  className={`flex w-full items-center gap-2 ${
                    pauta ? 'rounded-[var(--hub-r-chip)]' : 'rounded-[4px]'
                  } px-2.5 py-2 text-left text-[13px] leading-snug hover:bg-[var(--hub-soft)] focus-visible:bg-[var(--hub-soft)] focus-visible:outline-none`}
                  style={{ color: 'var(--hub-txt)' }}
                >
                  <Check
                    className="h-3.5 w-3.5 shrink-0"
                    aria-hidden="true"
                    style={{ opacity: checked ? 1 : 0, color: 'var(--hub-acc)' }}
                  />
                  <span className="min-w-0 flex-1 truncate" title={item.label}>
                    {item.label}
                  </span>
                  {item.count !== null && (
                    <span className="shrink-0 tabular-nums" style={{ color: 'var(--hub-tx3)' }}>
                      ({item.count})
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

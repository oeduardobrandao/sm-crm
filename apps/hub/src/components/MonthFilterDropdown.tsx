import { useRef, useState, type KeyboardEvent } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ALL_MONTHS, NO_MONTH, formatMonthKey } from '../lib/postView';

export interface MonthFilterOption {
  /** `YYYY-MM`, or `none` for posts without a date. */
  key: string;
  count: number;
}

interface MonthFilterDropdownProps {
  /** Selected month key, `none`, or `all` (no filter). */
  value: string;
  /** One entry per month that has a visible post, already ordered (newest first, `none` last). */
  options: MonthFilterOption[];
  onChange: (value: string) => void;
}

/**
 * Postagens-only publish-month filter: one squared trigger that opens a single-select menu.
 * It renders just the trigger (no wrapper) so the page can put it on the same row as the
 * status chips. Rendered only when there is more than one option to choose between.
 *
 * The menu portals INTO `.hub-root` (same reason as HubDialog): the hub theme vars and the
 * `data-theme` attribute live there, so a body portal would render unthemed. The page root
 * carries `.hub-fade-up`, whose transform would trap a `position: fixed` panel, which is the
 * other reason not to render the panel inline.
 */
export function MonthFilterDropdown({ value, options, onChange }: MonthFilterDropdownProps) {
  const { t, i18n } = useTranslation('hubPosts');
  const [open, setOpen] = useState(false);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  if (options.length <= 1) return null;

  const lang = i18n.language === 'en' ? 'en-US' : 'pt-BR';
  const container =
    typeof document !== 'undefined'
      ? (document.querySelector<HTMLElement>('.hub-root') ?? document.body)
      : undefined;
  const groupLabel = t('postagens.monthFilter.label', 'Filtrar por mês');
  const allLabel = t('postagens.monthFilter.all', 'Todos os meses');
  const labelOf = (key: string) =>
    key === NO_MONTH ? t('postagens.monthFilter.none', 'Sem data') : formatMonthKey(key, lang);

  // A value with no matching option (the page prunes it in an effect) reads as "all".
  const selectedOption = options.find((o) => o.key === value);
  const active = selectedOption !== undefined;
  const triggerLabel = selectedOption
    ? labelOf(selectedOption.key)
    : t('postagens.monthFilter.trigger', 'Todos os meses');

  const items = [
    { key: ALL_MONTHS, label: allLabel, count: null as number | null },
    ...options.map((o) => ({ key: o.key, label: labelOf(o.key), count: o.count })),
  ];
  const currentIndex = Math.max(
    0,
    items.findIndex((i) => i.key === (active ? value : ALL_MONTHS)),
  );

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
        <button
          type="button"
          className="inline-flex max-w-full items-center gap-1.5 rounded-[4px] border px-3 py-1 text-[12px] font-semibold transition-colors"
          style={
            active
              ? {
                  background: 'var(--hub-acc)',
                  color: 'var(--hub-acc-fg)',
                  borderColor: 'var(--hub-acc)',
                }
              : { color: 'var(--hub-tx2)', borderColor: 'var(--hub-bd)' }
          }
        >
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
          className="z-50 flex w-[260px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-[4px] border focus:outline-none"
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
                  className="flex w-full items-center gap-2 rounded-[4px] px-2.5 py-2 text-left text-[13px] leading-snug hover:bg-[var(--hub-soft)] focus-visible:bg-[var(--hub-soft)] focus-visible:outline-none"
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

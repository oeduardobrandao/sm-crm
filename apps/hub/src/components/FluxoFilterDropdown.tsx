import * as Popover from '@radix-ui/react-popover';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export type FluxoKey = 'avulso' | `wf-${number}`;

export interface FluxoFilterOption {
  key: FluxoKey;
  label: string;
  count: number;
}

interface FluxoFilterDropdownProps {
  /** Selected fluxo keys. Empty means "no filter": every fluxo is shown. */
  value: FluxoKey[];
  options: FluxoFilterOption[];
  onChange: (value: FluxoKey[]) => void;
}

/**
 * Postagens-only fluxo filter: one pill that opens a multi-select menu. Rendered only
 * when there is more than one fluxo (incl. avulsas).
 *
 * The menu portals INTO `.hub-root` (same reason as HubDialog): the hub theme vars and
 * the `data-theme` attribute live there, so a body portal would render unthemed. The
 * page root carries `.hub-fade-up`, whose transform would trap a `position: fixed` panel,
 * which is the other reason not to render the panel inline.
 */
export function FluxoFilterDropdown({ value, options, onChange }: FluxoFilterDropdownProps) {
  const { t } = useTranslation('hubPosts');
  if (options.length <= 1) return null;

  const container =
    typeof document !== 'undefined'
      ? (document.querySelector<HTMLElement>('.hub-root') ?? document.body)
      : undefined;
  const groupLabel = t('postagens.filter.fluxoLabel', 'Filtrar por fluxo');
  const selected = new Set<FluxoKey>(value);
  // Only count keys that still exist; the page prunes vanished ones in an effect.
  const selectedOptions = options.filter((o) => selected.has(o.key));
  const active = selectedOptions.length > 0;
  const triggerLabel =
    selectedOptions.length === 0
      ? t('postagens.fluxoFilter.trigger', 'Fluxos')
      : selectedOptions.length === 1
        ? selectedOptions[0].label
        : t('postagens.fluxoFilter.selected', '{{count}} fluxos', {
            count: selectedOptions.length,
          });

  // Always emitted in option order so the result does not depend on click order.
  const toggle = (key: FluxoKey) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(options.filter((o) => next.has(o.key)).map((o) => o.key));
  };

  return (
    <div className="mb-3">
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors"
            style={
              active
                ? {
                    background: 'var(--hub-txt)',
                    color: 'var(--hub-card)',
                    borderColor: 'var(--hub-txt)',
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
            className="z-50 flex w-[320px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-[var(--hub-r-ctl)] border focus:outline-none"
            style={{
              background: 'var(--hub-card)',
              color: 'var(--hub-txt)',
              borderColor: 'var(--hub-bd2)',
              boxShadow:
                '0 12px 32px -12px rgba(28, 25, 23, 0.25), 0 2px 6px rgba(28, 25, 23, 0.08)',
            }}
          >
            <div
              role="group"
              aria-label={groupLabel}
              className="max-h-[min(320px,60vh)] overflow-y-auto p-1.5"
            >
              {options.map((opt) => (
                <label
                  key={opt.key}
                  className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 text-[13px] leading-snug"
                  style={{ color: 'var(--hub-txt)' }}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(opt.key)}
                    onChange={() => toggle(opt.key)}
                    className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer"
                    style={{ accentColor: 'var(--hub-acc)' }}
                  />
                  <span className="min-w-0 flex-1 break-words line-clamp-2" title={opt.label}>
                    {opt.label}
                  </span>
                  <span className="shrink-0 tabular-nums" style={{ color: 'var(--hub-tx3)' }}>
                    ({opt.count})
                  </span>
                </label>
              ))}
            </div>
            <div className="border-t px-2 py-1.5" style={{ borderColor: 'var(--hub-bd)' }}>
              <button
                type="button"
                disabled={!active}
                onClick={() => onChange([])}
                className="rounded-md px-2 py-1 text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                style={{ color: 'var(--hub-tx2)' }}
              >
                {t('postagens.fluxoFilter.clear', 'Limpar')}
              </button>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  BOUNCE_ALERT,
  formatRate,
  type CategoryRow,
  type Counts,
  type Rates,
} from './email-metrics-view';

function Figures({ counts, rates, muted }: { counts: Counts; rates: Rates; muted?: boolean }) {
  const alert = !muted && rates.bounce !== null && rates.bounce > BOUNCE_ALERT;
  return (
    <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">
      {counts.sent.toLocaleString('pt-BR')} {'·'}{' '}
      <span
        data-alert={alert ? 'true' : undefined}
        className={cn(alert && 'font-semibold text-destructive')}
      >
        {formatRate(rates.bounce)}
      </span>
    </span>
  );
}

/** Phone variant of the "Por tipo" table: label left, "enviados · bounce" right. */
export function EmailsPhoneList({
  categories,
  excluded,
}: {
  categories: CategoryRow[];
  excluded: CategoryRow[];
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (c: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });

  return (
    <ul>
      {categories.map((cat) => {
        const isOpen = open.has(cat.category);
        return (
          <li key={cat.category} className="border-t border-border/60">
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => toggle(cat.category)}
              className="flex w-full items-center justify-between gap-3 px-[18px] py-3 text-left text-sm"
            >
              <span className="flex min-w-0 items-center gap-1.5 font-medium">
                <ChevronRight
                  size={14}
                  aria-hidden="true"
                  className={cn('shrink-0 transition-transform', isOpen && 'rotate-90')}
                />
                <span className="truncate">{cat.label}</span>
              </span>
              <Figures counts={cat.counts} rates={cat.rates} />
            </button>
            {isOpen ? (
              <ul className="bg-muted/30">
                {cat.types.map((t) => (
                  <li
                    key={t.type}
                    className="flex items-center justify-between gap-3 py-2.5 pl-10 pr-[18px] text-sm"
                  >
                    <span className="min-w-0 truncate text-muted-foreground">{t.label}</span>
                    <Figures counts={t.counts} rates={t.rates} />
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
      {excluded.map((cat) => (
        <li
          key={cat.category}
          className="flex items-center justify-between gap-3 border-t border-border/60 px-[18px] py-3 text-sm text-muted-foreground"
        >
          <span className="min-w-0 truncate">{cat.label} (fora do total)</span>
          <Figures counts={cat.counts} rates={cat.rates} muted />
        </li>
      ))}
    </ul>
  );
}

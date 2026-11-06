import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { getDateFnsLocale, i18n, useDateFnsLocale } from '@mesaas/i18n';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { BottomSheet } from '@/components/mobile/BottomSheet';
import { PhoneIconButton } from '@/components/mobile/LargeTitleHeader';

function parse(value: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  return match ? { year: Number(match[1]), month: Number(match[2]) - 1 } : null;
}

/**
 * "Outubro de 2026", or "Todos os meses" for the empty filter (MonthPicker's label). Resolved
 * in the UI language at call time.
 */
export function monthLabel(value: string): string {
  const parsed = parse(value);
  if (!parsed) return i18n.t('finance:monthSheet.allMonths');
  const raw = format(
    new Date(parsed.year, parsed.month, 1),
    i18n.t('common:dateFormat.monthYear'),
    { locale: getDateFnsLocale() },
  );
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/**
 * The desktop MonthPicker popover as a bottom sheet: year stepper, twelve months and
 * "Todos os meses" (the picker's clear). Picking closes the sheet.
 */
export function MonthSheet({
  open,
  onOpenChange,
  value,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation('finance');
  const dateLocale = useDateFnsLocale();
  const months = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) =>
        format(new Date(2000, i, 1), 'MMM', { locale: dateLocale }).replace('.', ''),
      ),
    [dateLocale],
  );
  const parsed = parse(value);
  const [year, setYear] = useState(parsed?.year ?? new Date().getFullYear());
  useEffect(() => {
    if (open) setYear(parse(value)?.year ?? new Date().getFullYear());
  }, [open, value]);

  const pick = (next: string) => {
    onChange(next);
    onOpenChange(false);
  };

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('shared.month')}
      detents={['fit']}
    >
      <div className="phone-fin-month">
        <div className="phone-fin-month__year">
          <PhoneIconButton label={t('ui.previousYear')} onClick={() => setYear((y) => y - 1)}>
            <ChevronLeft aria-hidden="true" />
          </PhoneIconButton>
          <span aria-live="polite">{year}</span>
          <PhoneIconButton label={t('ui.nextYear')} onClick={() => setYear((y) => y + 1)}>
            <ChevronRight aria-hidden="true" />
          </PhoneIconButton>
        </div>
        <div
          className="phone-fin-month__grid"
          role="group"
          aria-label={t('monthSheet.monthsOf', { year })}
        >
          {months.map((name, i) => {
            const selected = parsed?.year === year && parsed.month === i;
            return (
              <button
                key={name}
                type="button"
                className="phone-fin-month__item"
                aria-pressed={selected}
                aria-label={monthLabel(`${year}-${String(i + 1).padStart(2, '0')}`)}
                onClick={() => pick(`${year}-${String(i + 1).padStart(2, '0')}`)}
              >
                {name}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="phone-fin-month__all"
          aria-pressed={!parsed}
          onClick={() => pick('')}
        >
          {t('monthSheet.allMonths')}
        </button>
      </div>
    </BottomSheet>
  );
}

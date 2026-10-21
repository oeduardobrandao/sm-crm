import * as React from 'react';
import { format, type Locale } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { useDateFnsLocale } from '@mesaas/i18n';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export interface MonthPickerProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  clearable?: boolean;
  id?: string;
}

function shortMonthNames(locale: Locale): string[] {
  return Array.from({ length: 12 }, (_, i) =>
    format(new Date(2000, i, 1), 'MMM', { locale }).replace('.', ''),
  );
}

function parseValue(value: string): { year: number; month: number } | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) - 1 };
}

function formatIso(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

export function MonthPicker({
  value,
  onChange,
  placeholder,
  className,
  disabled,
  clearable = true,
  id,
}: MonthPickerProps) {
  const { t } = useTranslation();
  const dateLocale = useDateFnsLocale();
  const parsed = parseValue(value);
  const [open, setOpen] = React.useState(false);
  const [year, setYear] = React.useState(parsed?.year ?? new Date().getFullYear());

  React.useEffect(() => {
    if (open && parsed) setYear(parsed.year);
  }, [open, parsed]);

  const rawLabel = parsed
    ? format(new Date(parsed.year, parsed.month, 1), t('dateFormat.monthYear'), {
        locale: dateLocale,
      })
    : null;
  // Sentence case only: "Agosto de 2026", never "Agosto De 2026".
  const label = rawLabel ? rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1) : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            'h-9 justify-start text-left font-normal',
            !parsed && 'text-muted-foreground',
            className,
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {label ?? <span>{placeholder ?? t('ui.selectMonth')}</span>}
          {clearable && parsed && (
            <span
              role="button"
              tabIndex={0}
              aria-label={t('ui.clear')}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onChange('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  onChange('');
                }
              }}
              className="ml-auto -mr-1 rounded p-0.5 hover:bg-accent"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="start">
        <div className="flex items-center justify-between mb-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setYear((y) => y - 1)}
            aria-label={t('ui.previousYear')}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="text-sm font-medium">{year}</div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setYear((y) => y + 1)}
            aria-label={t('ui.nextYear')}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {shortMonthNames(dateLocale).map((name, i) => {
            const selected = parsed?.year === year && parsed.month === i;
            return (
              <Button
                key={i}
                type="button"
                variant={selected ? 'default' : 'ghost'}
                size="sm"
                className="h-9 capitalize"
                onClick={() => {
                  onChange(formatIso(year, i));
                  setOpen(false);
                }}
              >
                {name}
              </Button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

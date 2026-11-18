import * as React from 'react';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { useDateFnsLocale } from '@mesaas/i18n';
import { Calendar as CalendarIcon, X } from 'lucide-react';
import type { Matcher } from 'react-day-picker';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export interface DatePickerProps {
  value?: Date;
  onChange?: (date: Date | undefined) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  clearable?: boolean;
  /** Display format string passed to date-fns `format` */
  displayFormat?: string;
  /** Days that can't be picked, passed to the calendar's `disabled` */
  disabledDays?: Matcher | Matcher[];
  /** Accessible name for the trigger, when no visible label is tied to it */
  'aria-label'?: string;
}

export function DatePicker({
  value,
  onChange,
  placeholder,
  className,
  disabled,
  clearable = true,
  displayFormat = 'dd/MM/yyyy',
  disabledDays,
  'aria-label': ariaLabel,
}: DatePickerProps) {
  const { t } = useTranslation();
  const dateLocale = useDateFnsLocale();
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          aria-label={ariaLabel}
          className={cn(
            'h-9 justify-start text-left font-normal',
            !value && 'text-muted-foreground',
            className,
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {value ? (
            format(value, displayFormat, { locale: dateLocale })
          ) : (
            <span>{placeholder ?? t('ui.selectDate')}</span>
          )}
          {clearable && value && (
            <span
              role="button"
              tabIndex={0}
              aria-label={t('ui.clear')}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onChange?.(undefined);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  onChange?.(undefined);
                }
              }}
              className="ml-auto -mr-1 rounded p-0.5 hover:bg-accent"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start" style={{ zIndex: 9999 }}>
        <Calendar
          mode="single"
          locale={dateLocale}
          selected={value}
          onSelect={(date) => {
            onChange?.(date);
            if (date) setOpen(false);
          }}
          disabled={disabledDays}
          defaultMonth={value}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}

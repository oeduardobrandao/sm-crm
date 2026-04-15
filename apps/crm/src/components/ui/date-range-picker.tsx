import * as React from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Calendar as CalendarIcon, X } from 'lucide-react';
import type { DateRange } from 'react-day-picker';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export interface DateRangePickerProps {
  value?: DateRange;
  onChange?: (range: DateRange | undefined) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  clearable?: boolean;
  numberOfMonths?: number;
}

export function DateRangePicker({
  value,
  onChange,
  placeholder = 'Selecionar período',
  className,
  disabled,
  clearable = true,
  numberOfMonths = 2,
}: DateRangePickerProps) {
  const label = React.useMemo(() => {
    if (!value?.from) return null;
    const fromLabel = format(value.from, 'dd/MM/yyyy', { locale: ptBR });
    if (!value.to) return fromLabel;
    return `${fromLabel} – ${format(value.to, 'dd/MM/yyyy', { locale: ptBR })}`;
  }, [value]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            'h-9 justify-start text-left font-normal',
            !value?.from && 'text-muted-foreground',
            className,
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {label ?? <span>{placeholder}</span>}
          {clearable && value?.from && (
            <span
              role="button"
              tabIndex={0}
              aria-label="Limpar"
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
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          locale={ptBR}
          selected={value}
          onSelect={onChange}
          numberOfMonths={numberOfMonths}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}

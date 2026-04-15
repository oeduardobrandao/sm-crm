import * as React from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
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
}

const MONTHS = Array.from({ length: 12 }, (_, i) =>
  format(new Date(2000, i, 1), 'MMM', { locale: ptBR }).replace('.', ''),
);

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
  placeholder = 'Selecionar mês',
  className,
  disabled,
  clearable = true,
}: MonthPickerProps) {
  const parsed = parseValue(value);
  const [open, setOpen] = React.useState(false);
  const [year, setYear] = React.useState(parsed?.year ?? new Date().getFullYear());

  React.useEffect(() => {
    if (open && parsed) setYear(parsed.year);
  }, [open, parsed]);

  const label = parsed
    ? format(new Date(parsed.year, parsed.month, 1), "MMMM 'de' yyyy", { locale: ptBR })
    : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            'h-9 justify-start text-left font-normal capitalize',
            !parsed && 'text-muted-foreground',
            className,
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {label ?? <span>{placeholder}</span>}
          {clearable && parsed && (
            <span
              role="button"
              tabIndex={0}
              aria-label="Limpar"
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
            aria-label="Ano anterior"
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
            aria-label="Próximo ano"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {MONTHS.map((name, i) => {
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

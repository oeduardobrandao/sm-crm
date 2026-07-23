import * as React from 'react';
import { format, setHours, setMinutes, startOfDay, addMinutes, isBefore, isToday } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Calendar as CalendarIcon, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Calendar, type CalendarProps } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const MIN_SCHEDULE_MINUTES = 15;

export interface DateTimePickerProps {
  value?: Date;
  onChange?: (date: Date | undefined) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  clearable?: boolean;
  futureOnly?: boolean;
  /**
   * Day key (`yyyy-MM-dd`, local time) → dots to render beneath the day number and that
   * day's tooltip. Deliberately domain-agnostic: this component knows nothing about posts.
   */
  dayMarkers?: Map<string, { colors: string[]; label: string }>;
  /**
   * Optional key for the dot colours, rendered as a compact row under the calendar. Only the
   * entries whose colour actually appears in `dayMarkers` are shown, so the guide stays small
   * and never explains a colour the user can't see. Ignored when `dayMarkers` is empty.
   */
  dayMarkerLegend?: { color: string; label: string }[];
}

function roundUpToNext5(date: Date): { h: number; m: number } {
  let h = date.getHours();
  let m = Math.ceil(date.getMinutes() / 5) * 5;
  if (m >= 60) {
    m = 0;
    h += 1;
  }
  if (h >= 24) {
    h = 0;
    m = 0;
  }
  return { h, m };
}

export function DateTimePicker({
  value,
  onChange,
  placeholder = 'Selecionar data e hora',
  className,
  disabled,
  clearable = true,
  futureOnly = false,
  dayMarkers,
  dayMarkerLegend,
}: DateTimePickerProps) {
  const [open, setOpen] = React.useState(false);

  const now = React.useMemo(() => new Date(), [open]);
  const minDateTime = futureOnly ? addMinutes(now, MIN_SCHEDULE_MINUTES) : undefined;
  const calendarDisabled = futureOnly ? { before: startOfDay(now) } : undefined;

  const hours = value ? value.getHours() : 10;
  const minutes = value ? value.getMinutes() : 0;

  const clampToMin = React.useCallback(
    (date: Date): Date => {
      if (!minDateTime || !isBefore(date, minDateTime)) return date;
      const { h, m } = roundUpToNext5(minDateTime);
      return setMinutes(setHours(date, h), m);
    },
    [minDateTime],
  );

  const handleDateSelect = (date: Date | undefined) => {
    if (!date) {
      onChange?.(undefined);
      return;
    }
    const withTime = setMinutes(setHours(date, hours), minutes);
    onChange?.(clampToMin(withTime));
  };

  const handleTimeChange = (h: number, m: number) => {
    if (!value) return;
    const updated = setMinutes(setHours(new Date(value), h), m);
    onChange?.(clampToMin(updated));
  };

  const selectedIsToday = value ? isToday(value) : false;
  const earliestTime =
    selectedIsToday && minDateTime ? roundUpToNext5(minDateTime) : { h: 0, m: 0 };

  // Only key the colours actually present in this marker set, so the guide never explains a
  // tipo the user isn't looking at.
  const visibleLegend = React.useMemo(() => {
    if (!dayMarkerLegend?.length || !dayMarkers?.size) return [];
    const present = new Set<string>();
    for (const marker of dayMarkers.values()) for (const c of marker.colors) present.add(c);
    return dayMarkerLegend.filter((entry) => present.has(entry.color));
  }, [dayMarkerLegend, dayMarkers]);

  const dayButton = React.useMemo(() => {
    if (!dayMarkers || dayMarkers.size === 0) return undefined;
    // Spread react-day-picker's own props onto the button: `Calendar` styles days entirely
    // through classNames.day_button, and selection/disabled state arrives the same way.
    // Rendering custom markup without forwarding silently loses all of it.
    return function DayButtonWithDots({
      day,
      modifiers,
      ...buttonProps
    }: React.ComponentProps<NonNullable<NonNullable<CalendarProps['components']>['DayButton']>>) {
      const key = `${day.date.getFullYear()}-${String(day.date.getMonth() + 1).padStart(2, '0')}-${String(day.date.getDate()).padStart(2, '0')}`;
      const marker = dayMarkers.get(key);
      // react-day-picker's own DayButton is the ONLY place that moves DOM focus (it never
      // touches the DOM itself — useFocus.moveFocus() only updates internal state). Replacing
      // the button without replicating this ref+effect leaves internal focus and visible DOM
      // focus out of sync, breaking arrow-key navigation and Enter-to-select.
      const ref = React.useRef<HTMLButtonElement>(null);
      React.useEffect(() => {
        if (modifiers.focused) ref.current?.focus();
      }, [modifiers.focused]);
      return (
        <button
          ref={ref}
          {...buttonProps}
          title={marker?.label}
          className={cn(buttonProps.className, 'relative')}
        >
          {day.date.getDate()}
          {marker && (
            <span className="dtp-day-dots">
              {marker.colors.map((color, i) => (
                <span
                  key={i}
                  data-testid="day-dot"
                  className="dtp-day-dot"
                  style={{ background: color }}
                />
              ))}
            </span>
          )}
        </button>
      );
    };
  }, [dayMarkers]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            'h-auto justify-start text-left font-normal',
            !value && 'text-muted-foreground',
            className,
          )}
          style={{
            padding: '0.4rem 0.6rem',
            borderRadius: 6,
            fontSize: '0.82rem',
            background: 'var(--card-bg)',
          }}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {value ? (
            format(value, "dd MMM yyyy '·' HH:mm", { locale: ptBR })
          ) : (
            <span>{placeholder}</span>
          )}
          {clearable && value && (
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
      <PopoverContent className="w-auto p-0" align="start" style={{ zIndex: 9999 }}>
        <Calendar
          mode="single"
          locale={ptBR}
          selected={value}
          onSelect={handleDateSelect}
          disabled={calendarDisabled}
          initialFocus
          components={dayButton ? { DayButton: dayButton } : undefined}
        />
        <div className="border-t px-3 py-2 flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-medium">Horário:</span>
          <select
            className="h-9 rounded-md border bg-background px-2 text-base md:text-sm"
            value={hours}
            onChange={(e) => handleTimeChange(parseInt(e.target.value, 10), minutes)}
          >
            {Array.from({ length: 24 }, (_, i) => (
              <option key={i} value={i} disabled={i < earliestTime.h}>
                {String(i).padStart(2, '0')}
              </option>
            ))}
          </select>
          <span className="text-sm text-muted-foreground">:</span>
          <select
            className="h-9 rounded-md border bg-background px-2 text-base md:text-sm"
            value={minutes}
            onChange={(e) => handleTimeChange(hours, parseInt(e.target.value, 10))}
          >
            {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
              <option key={m} value={m} disabled={hours === earliestTime.h && m < earliestTime.m}>
                {String(m).padStart(2, '0')}
              </option>
            ))}
          </select>
        </div>
        {visibleLegend.length > 0 && (
          <div className="border-t px-3 py-1.5">
            <div className="dtp-legend">
              {visibleLegend.map((entry) => (
                <span key={entry.label} className="dtp-legend-item">
                  <span className="dtp-legend-dash" style={{ background: entry.color }} />
                  {entry.label}
                </span>
              ))}
            </div>
          </div>
        )}
        {futureOnly && (
          <div className="border-t px-3 py-1.5">
            <p className="text-[11px] text-muted-foreground">
              Mínimo {MIN_SCHEDULE_MINUTES} min no futuro
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

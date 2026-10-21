import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { addMinutes, format, isBefore } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';
import { getBestPostingTimes } from '../../../services/analytics';
import {
  hasEnoughData,
  SUGGESTION_MIN_LEAD_MINUTES,
  suggestTimes,
  type TimeSuggestion,
} from '../bestTimeSuggestion';

interface SuggestTimeButtonProps {
  clientId: number;
  value: Date | undefined;
  onPick: (date: Date) => void;
  disabled?: boolean;
}

function formatPct(value: number): string {
  return value.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}

function SuggestionRow({
  suggestion,
  onSelect,
}: {
  suggestion: TimeSuggestion;
  onSelect: (date: Date) => void;
}) {
  const { date, slot } = suggestion;
  const day = format(date, 'EEEE, dd/MM', { locale: ptBR });
  return (
    <button type="button" className="suggest-time-row" onClick={() => onSelect(date)}>
      <span className="suggest-time-row__when">
        {day.charAt(0).toUpperCase() + day.slice(1)} às {format(date, 'HH')}h
      </span>
      <span className="suggest-time-row__why">
        {formatPct(slot.value)}% de engajamento médio ·{' '}
        {slot.postCount === 1 ? '1 post' : `${slot.postCount} posts`}
      </span>
    </button>
  );
}

/**
 * "Sugerir horário" next to the scheduler: turns the Analytics best-times heatmap into one-click
 * dates. Renders nothing when the plan lacks Melhores Horários or the account has too little
 * history, so the scheduler looks exactly as before for those clients.
 */
export function SuggestTimeButton({ clientId, value, onPick, disabled }: SuggestTimeButtonProps) {
  const { features } = useWorkspaceLimits();
  const [open, setOpen] = useState(false);
  const enabled = !!features?.feature_best_times;

  // Same key as the Analytics page, so either screen warms the other's cache.
  const { data: res } = useQuery({
    queryKey: ['analytics-times', clientId],
    queryFn: () => getBestPostingTimes(clientId).catch(() => null),
    enabled,
    staleTime: 30 * 60 * 1000,
  });
  const data = res?.data;

  // Bumped when a row turns out stale, to recompute from the current time.
  const [refreshTick, setRefreshTick] = useState(0);

  // Recomputed on open so "next occurrence" is measured from the moment the list is shown.
  const suggestions = useMemo(
    () => (open && hasEnoughData(data) ? suggestTimes(data, value, new Date()) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshTick only forces a recompute
    [open, data, value, refreshTick],
  );

  if (!enabled || !hasEnoughData(data)) return null;

  const pick = (date: Date) => {
    // The list can sit open past a slot; this path skips the picker's own 15-min clamp.
    if (isBefore(date, addMinutes(new Date(), SUGGESTION_MIN_LEAD_MINUTES))) {
      toast.info('Esse horário já passou. A lista foi atualizada.');
      setRefreshTick((n) => n + 1);
      return;
    }
    onPick(date);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="suggest-time-trigger" disabled={disabled}>
          <Sparkles className="h-3 w-3" /> Sugerir horário
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end" style={{ zIndex: 9999 }}>
        {suggestions?.sameDay && (
          <div className="suggest-time-group">
            <div className="suggest-time-group__label">Melhor horário neste dia</div>
            <SuggestionRow suggestion={suggestions.sameDay} onSelect={pick} />
          </div>
        )}
        <div className="suggest-time-group">
          <div className="suggest-time-group__label">Próximos melhores horários</div>
          {suggestions?.upcoming.map((s) => (
            <SuggestionRow key={s.date.getTime()} suggestion={s} onSelect={pick} />
          ))}
        </div>
        <p className="suggest-time-foot">
          Baseado em {data.totalPosts} posts do Instagram nos últimos 90 dias.
        </p>
      </PopoverContent>
    </Popover>
  );
}

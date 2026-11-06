import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { addMinutes, format, isBefore } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { getIntlLocale, useDateFnsLocale } from '@mesaas/i18n';
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
  return value.toLocaleString(getIntlLocale(), { maximumFractionDigits: 1 });
}

function SuggestionRow({
  suggestion,
  onSelect,
}: {
  suggestion: TimeSuggestion;
  onSelect: (date: Date) => void;
}) {
  const { t } = useTranslation('postPanels');
  const dateLocale = useDateFnsLocale();
  const { date, slot } = suggestion;
  const day = format(date, t('suggestTime.dayFormat'), { locale: dateLocale });
  return (
    <button type="button" className="suggest-time-row" onClick={() => onSelect(date)}>
      <span className="suggest-time-row__when">
        {t('suggestTime.when', {
          day: day.charAt(0).toUpperCase() + day.slice(1),
          hour: format(date, 'HH'),
        })}
      </span>
      <span className="suggest-time-row__why">
        {t('suggestTime.why', { pct: formatPct(slot.value), count: slot.postCount })}
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
  const { t } = useTranslation('postPanels');
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
      toast.info(t('suggestTime.slotPassed'));
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
          <Sparkles className="h-3 w-3" /> {t('suggestTime.trigger')}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end" style={{ zIndex: 9999 }}>
        {suggestions?.sameDay && (
          <div className="suggest-time-group">
            <div className="suggest-time-group__label">{t('suggestTime.bestThisDay')}</div>
            <SuggestionRow suggestion={suggestions.sameDay} onSelect={pick} />
          </div>
        )}
        <div className="suggest-time-group">
          <div className="suggest-time-group__label">{t('suggestTime.upcoming')}</div>
          {suggestions?.upcoming.map((s) => (
            <SuggestionRow key={s.date.getTime()} suggestion={s} onSelect={pick} />
          ))}
        </div>
        <p className="suggest-time-foot">{t('suggestTime.basedOn', { total: data.totalPosts })}</p>
      </PopoverContent>
    </Popover>
  );
}

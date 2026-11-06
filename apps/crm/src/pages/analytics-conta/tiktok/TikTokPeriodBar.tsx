import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import type { AnalyticsRange } from '../../../services/tiktokAnalytics';
import { lastMonthRange } from './tiktokTabFormat';

const PRESETS = [7, 30, 90] as const;
const MAX_CUSTOM_DAYS = 730;

/** 7 / 30 / 90 dias, Último mês and a custom day count (1-730); one period for the whole tab. */
export function TikTokPeriodBar({
  range,
  onChange,
}: {
  range: AnalyticsRange;
  onChange: (range: AnalyticsRange) => void;
}) {
  const { t } = useTranslation('analyticsTiktok');
  const isMonth = !('days' in range);
  return (
    <div className="flex flex-wrap items-center gap-3 animate-up">
      <div className="page-tabs page-tabs--inline" role="tablist">
        {PRESETS.map((d) => {
          const active = 'days' in range && range.days === d;
          return (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={active}
              className={`page-tab${active ? ' active' : ''}`}
              onClick={() => onChange({ days: d })}
            >
              {t('overview.periodDays', { count: d })}
            </button>
          );
        })}
        <button
          type="button"
          role="tab"
          aria-selected={isMonth}
          className={`page-tab${isMonth ? ' active' : ''}`}
          onClick={() => onChange(lastMonthRange())}
        >
          {t('overview.lastMonth')}
        </button>
      </div>
      <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
        {t('clientTab.periodOr')}
      </span>
      <Input
        type="number"
        min={1}
        max={MAX_CUSTOM_DAYS}
        placeholder={t('clientTab.customDaysPlaceholder')}
        aria-label={t('clientTab.customDaysAria')}
        className="!rounded-full !text-xs h-9 w-[110px] mb-0"
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          const val = parseInt((e.target as HTMLInputElement).value, 10);
          if (isNaN(val) || val < 1 || val > MAX_CUSTOM_DAYS) {
            toast.error(t('clientTab.customDaysInvalid'));
            return;
          }
          onChange({ days: val });
        }}
      />
    </div>
  );
}

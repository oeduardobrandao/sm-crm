import { useTranslation } from 'react-i18next';
import {
  CalendarCheck,
  Eye,
  Globe,
  HelpCircle,
  MessageCircle,
  MessageSquarePlus,
  Navigation,
  Phone,
  Star,
  type LucideIcon,
} from 'lucide-react';
import { StatCard, type StatDelta, type StatTone } from '@/components/StatCard';
import { StatCardGrid } from '@/components/StatCardGrid';
import { HelpTooltip } from '@/components/help/HelpTooltip';
import { makeDelta } from '../../../services/analytics';
import type { GbpKpiEntry, GbpKpiId } from '../../../services/gbpAnalytics';
import { formatGbpCount, formatRating, formatRatingDelta } from './gbpTabFormat';

/** Board 4 order and tones. */
const KPI_ORDER: { id: GbpKpiId; icon: LucideIcon; tone: StatTone }[] = [
  { id: 'profile_views', icon: Eye, tone: 'violet' },
  { id: 'calls', icon: Phone, tone: 'blue' },
  { id: 'directions', icon: Navigation, tone: 'amber' },
  { id: 'website_clicks', icon: Globe, tone: 'green' },
  { id: 'messages', icon: MessageCircle, tone: 'violet' },
  { id: 'bookings', icon: CalendarCheck, tone: 'slate' },
  { id: 'avg_rating', icon: Star, tone: 'amber' },
  { id: 'new_reviews', icon: MessageSquarePlus, tone: 'pink' },
];

export function GbpKpiGrid({
  kpis,
  windowDays,
  totalReviews,
}: {
  kpis: Record<GbpKpiId, GbpKpiEntry>;
  /** Length of the resolved window: the comparison is the same number of days before it. */
  windowDays: number;
  /** All reviews of the selected units (Google's count), for the rating card's sub line. */
  totalReviews: number | null;
}) {
  const { t } = useTranslation('analyticsGoogle');
  const caption = t('kpi.vsPrevious', { count: windowDays });

  return (
    <StatCardGrid className="animate-up" maxCols={4} phoneLayout="grid">
      {KPI_ORDER.map(({ id, icon, tone }) => {
        const entry = kpis[id];
        if (!entry) return null;
        const { value, prev } = entry;
        const label = t(`kpi.${id}.label`);
        const compared = value !== null && prev !== null;

        if (id === 'avg_rating') {
          // StatCard rounds a non-percent delta to a whole number, which would turn "+0,1" into
          // 0: the rating change is written out instead.
          return (
            <StatCard
              key={id}
              label={label}
              icon={icon}
              tone={tone}
              value={value === null ? t('states.noData') : formatRating(value)}
              sub={
                totalReviews === null
                  ? t('kpi.avg_rating.subNoTotal')
                  : t('kpi.avg_rating.sub', {
                      count: totalReviews,
                      formattedCount: totalReviews.toLocaleString('pt-BR'),
                    })
              }
              footNote={
                compared ? (
                  <span>
                    {t('kpi.ratingDelta', {
                      count: windowDays,
                      delta: formatRatingDelta(value - prev),
                    })}
                  </span>
                ) : undefined
              }
            />
          );
        }

        let delta: StatDelta | undefined;
        if (compared) {
          const { direction, deltaPercent, delta: diff } = makeDelta(value, prev);
          // New reviews are a small count: board 4 shows the difference ("+5"), not a percent.
          delta = {
            direction,
            percent: id === 'new_reviews' ? diff : deltaPercent,
            caption,
          };
        }

        const subText = t(`kpi.${id}.sub`);
        const sub =
          id === 'profile_views' ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {subText}
              <HelpTooltip content={t('kpi.profile_views.tooltip')}>
                <button
                  type="button"
                  aria-label={t('kpi.profile_views.tooltip')}
                  className="inline-flex items-center justify-center rounded-full w-5 h-5 text-stone-400 hover:text-stone-600 transition-colors"
                >
                  <HelpCircle className="h-4 w-4" aria-hidden="true" />
                </button>
              </HelpTooltip>
            </span>
          ) : (
            subText
          );

        return (
          <StatCard
            key={id}
            label={label}
            icon={icon}
            tone={tone}
            value={value === null ? t('states.noData') : formatGbpCount(value)}
            delta={delta}
            unit={id === 'new_reviews' ? '' : '%'}
            sub={sub}
            // With a delta the card shows its caption instead of `sub`: keep the line below.
            footNote={delta ? <span>{sub}</span> : undefined}
          />
        );
      })}
    </StatCardGrid>
  );
}

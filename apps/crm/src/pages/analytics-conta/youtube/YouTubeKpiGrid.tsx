import { useTranslation } from 'react-i18next';
import {
  Clock,
  Eye,
  Heart,
  Play,
  Share2,
  Timer,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { StatCard, type StatDelta, type StatTone } from '@/components/StatCard';
import { StatCardGrid } from '@/components/StatCardGrid';
import { makeDelta } from '../../../services/analytics';
import type { YtDailyPoint, YtKpiEntry, YtKpiId } from '../../../services/youtubeAnalytics';
import {
  formatCompact,
  formatCount,
  formatDuration,
  formatHours,
  formatSigned,
} from './youtubeTabFormat';

type CardId = Exclude<YtKpiId, 'comments'>;

/** Mockup 3 order; comments live in the shares card's sub line. */
const KPI_ORDER: { id: CardId; icon: LucideIcon; tone: StatTone }[] = [
  { id: 'subscribers', icon: Users, tone: 'blue' },
  { id: 'net_subscribers', icon: UserPlus, tone: 'green' },
  { id: 'views', icon: Play, tone: 'violet' },
  { id: 'engaged_views', icon: Eye, tone: 'violet' },
  { id: 'watch_minutes', icon: Clock, tone: 'amber' },
  { id: 'avg_view_duration_s', icon: Timer, tone: 'amber' },
  { id: 'likes', icon: Heart, tone: 'pink' },
  { id: 'shares', icon: Share2, tone: 'blue' },
];

/**
 * Gained and lost subscribers of the window: the server's own breakdown on the net entry, else
 * summed from the daily series (null when neither has it).
 */
function subscriberFlow(entry: YtKpiEntry | undefined, daily: YtDailyPoint[] | undefined) {
  if (typeof entry?.gained === 'number' && typeof entry?.lost === 'number') {
    return { gained: entry.gained, lost: entry.lost };
  }
  if (!daily || daily.length === 0) return null;
  let gained = 0;
  let lost = 0;
  for (const d of daily) {
    if (d.subscribersGained === null || d.subscribersLost === null) return null;
    gained += d.subscribersGained;
    lost += d.subscribersLost;
  }
  return { gained, lost };
}

export function YouTubeKpiGrid({
  kpis,
  windowDays,
  daily,
}: {
  kpis: Record<YtKpiId, YtKpiEntry>;
  /** Length of the window, for "vs. N dias anteriores". */
  windowDays: number;
  daily?: YtDailyPoint[];
}) {
  const { t } = useTranslation('analyticsYoutube');
  const flow = subscriberFlow(kpis.net_subscribers, daily);

  const format = (id: CardId, v: number): string => {
    switch (id) {
      case 'net_subscribers':
        return formatSigned(v);
      case 'watch_minutes':
        return t('kpi.hours', { value: formatHours(v) });
      case 'avg_view_duration_s':
        return formatDuration(v);
      default:
        return formatCompact(v);
    }
  };

  const subOf = (id: CardId): string => {
    if (id === 'net_subscribers') {
      return flow
        ? t('kpi.net_subscribers.sub', {
            gained: formatCount(flow.gained),
            lost: formatCount(flow.lost),
          })
        : t('kpi.net_subscribers.subFallback');
    }
    if (id === 'shares') {
      const comments = kpis.comments?.value;
      return comments === null || comments === undefined
        ? t('kpi.shares.subFallback')
        : t('kpi.shares.sub', { value: formatCount(comments) });
    }
    return t(`kpi.${id}.sub`);
  };

  return (
    <StatCardGrid className="animate-up" maxCols={4} phoneLayout="grid">
      {KPI_ORDER.map(({ id, icon, tone }) => {
        const entry = kpis[id] ?? { value: null, prev: null };
        const { value, prev } = entry;
        let delta: StatDelta | undefined;
        if (value !== null && prev !== null) {
          const { direction, deltaPercent } = makeDelta(value, prev);
          delta = {
            direction,
            percent: deltaPercent,
            caption: t('kpi.vsPrevious', { count: windowDays }),
          };
        }
        return (
          <StatCard
            key={id}
            label={t(`kpi.${id}.label`)}
            icon={icon}
            tone={tone}
            value={value === null ? t('kpi.noData') : format(id, value)}
            delta={delta}
            sub={subOf(id)}
            footNote={delta ? <span>{subOf(id)}</span> : undefined}
          />
        );
      })}
    </StatCardGrid>
  );
}

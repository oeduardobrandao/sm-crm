import { useTranslation } from 'react-i18next';
import {
  Film,
  Heart,
  HelpCircle,
  MessageCircle,
  Play,
  Share2,
  ThumbsUp,
  UserPlus,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { StatCard, type StatDelta, type StatTone } from '@/components/StatCard';
import { StatCardGrid } from '@/components/StatCardGrid';
import { HelpTooltip } from '@/components/help/HelpTooltip';
import { makeDelta } from '../../../services/analytics';
import type { KpiEntry, TikTokKpiId } from '../../../services/tiktokAnalytics';
import { formatKpi } from './tiktokTabFormat';

/** Spec §A3 order; the lifetime likes come last. */
const KPI_ORDER: { id: TikTokKpiId; icon: LucideIcon; tone: StatTone }[] = [
  { id: 'followers_total', icon: Users, tone: 'blue' },
  { id: 'followers_gained', icon: UserPlus, tone: 'green' },
  { id: 'views', icon: Play, tone: 'violet' },
  { id: 'engagement_rate', icon: Zap, tone: 'pink' },
  { id: 'likes', icon: Heart, tone: 'pink' },
  { id: 'comments', icon: MessageCircle, tone: 'amber' },
  { id: 'shares', icon: Share2, tone: 'blue' },
  { id: 'posts_count', icon: Film, tone: 'slate' },
  { id: 'likes_total', icon: ThumbsUp, tone: 'slate' },
];

/** KPIs compared with the previous window; the summed counts never are (their prev is null). */
const COMPARED = new Set<TikTokKpiId>([
  'followers_total',
  'followers_gained',
  'engagement_rate',
  'posts_count',
]);

/** Summed lifetime counts of the window's videos: why they carry no comparison. */
const COUNTS_TOOLTIP = new Set<TikTokKpiId>(['likes', 'comments', 'shares']);

export function TikTokKpiGrid({
  kpis,
  period,
}: {
  kpis: Record<TikTokKpiId, KpiEntry>;
  period: string;
}) {
  const { t } = useTranslation('analyticsTiktok');

  return (
    <StatCardGrid className="animate-up" maxCols={4} phoneLayout="grid">
      {KPI_ORDER.map(({ id, icon, tone }) => {
        const entry = kpis[id];
        if (!entry) return null;
        const label = t(`kpi.${id}.label`);
        const { value, prev } = entry;

        let delta: StatDelta | undefined;
        if (value !== null && prev !== null && COMPARED.has(id)) {
          const { direction, deltaPercent } = makeDelta(value, prev);
          delta = { direction, percent: deltaPercent, caption: t('clientTab.vsPrevious') };
        }

        const tooltip =
          id === 'views'
            ? t('kpi.views.tooltip')
            : COUNTS_TOOLTIP.has(id)
              ? t('kpi.countsTooltip')
              : null;
        const subText =
          value !== null && COMPARED.has(id) && prev === null
            ? t('states.noComparison')
            : t(`kpi.${id}.sub`);
        const sub = tooltip ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {subText}
            <HelpTooltip content={tooltip}>
              <button
                type="button"
                aria-label={tooltip}
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
            value={value === null ? t('states.noData') : formatKpi(entry, value)}
            delta={delta}
            sub={sub}
            footNote={
              <>
                {delta && prev !== null && (
                  <span>{t('clientTab.previous', { value: formatKpi(entry, prev) })}</span>
                )}
                <span className="kpi-period-chip">{period}</span>
              </>
            }
          />
        );
      })}
    </StatCardGrid>
  );
}

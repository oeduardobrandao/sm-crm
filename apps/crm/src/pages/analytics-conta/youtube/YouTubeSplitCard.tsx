import { useTranslation } from 'react-i18next';
import type { YtOverview, YtSplitEntry } from '../../../services/youtubeAnalytics';
import { YouTubeCardFrame } from './YouTubeCardFrame';
import { formatCount, formatHours, LONG_COLOR, sharePct, SHORTS_COLOR } from './youtubeTabFormat';

type Metric = 'views' | 'minutes' | 'likes';
const METRICS: Metric[] = ['views', 'minutes', 'likes'];

/**
 * "Shorts x vídeos longos": each metric's Shorts share as a two-segment bar. A channel with no
 * Shorts reads 0% and "Shorts 0", never "sem dados".
 */
export function YouTubeSplitCard({
  split,
  lagThrough,
  phone,
}: {
  split: YtOverview['split'];
  lagThrough: string | null;
  phone?: boolean;
}) {
  const { t } = useTranslation('analyticsYoutube');
  const value = (metric: Metric, n: number) =>
    metric === 'minutes' ? t('kpi.hours', { value: formatHours(n) }) : formatCount(n);
  const viewsPct = sharePct(split.views.shorts, split.views.shorts + split.views.long);

  return (
    <YouTubeCardFrame
      phone={phone}
      title={t('split.title')}
      sub={t('split.sub', { pct: viewsPct })}
      lagThrough={lagThrough}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {METRICS.map((metric) => {
          const entry: YtSplitEntry = split[metric] ?? { shorts: 0, long: 0 };
          const total = entry.shorts + entry.long;
          const pct = sharePct(entry.shorts, total);
          const label = t(`split.${metric}`);
          return (
            <div key={metric}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                }}
              >
                <span>{label}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
              </div>
              <div
                className="an-split"
                role="img"
                aria-label={t('split.barAria', { metric: label, pct })}
                style={{ background: total > 0 ? undefined : 'var(--an-hairline)' }}
              >
                {total > 0 && (
                  <>
                    <div style={{ flex: entry.shorts, background: SHORTS_COLOR }} />
                    <div style={{ flex: entry.long, background: LONG_COLOR }} />
                  </>
                )}
              </div>
              <div className="an-split-labels">
                <span>{t('split.shorts', { value: value(metric, entry.shorts) })}</span>
                <span>{t('split.long', { value: value(metric, entry.long) })}</span>
              </div>
            </div>
          );
        })}
      </div>
    </YouTubeCardFrame>
  );
}

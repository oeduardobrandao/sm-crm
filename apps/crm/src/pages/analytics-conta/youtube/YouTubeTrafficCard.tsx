import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { YtTrafficRow } from '../../../services/youtubeAnalytics';
import { EmptyLine, YouTubeCardFrame, type CardLoadState } from './YouTubeCardFrame';
import { sharePct } from './youtubeTabFormat';

/** The sources the card names; every other `insightTrafficSourceType` is "Outras origens". */
const NAMED_SOURCES = ['SHORTS', 'YT_SEARCH', 'RELATED_VIDEO', 'EXT_URL', 'YT_CHANNEL'] as const;
type NamedSource = (typeof NAMED_SOURCES)[number];
const isNamed = (s: string): s is NamedSource => (NAMED_SOURCES as readonly string[]).includes(s);

export interface TrafficBar {
  key: NamedSource | 'other';
  views: number;
  pct: number;
}

/** Named sources by views, most first, then the rest summed as "other" (when any). */
export function trafficBars(rows: YtTrafficRow[]): TrafficBar[] {
  const named = new Map<NamedSource, number>();
  let other = 0;
  for (const r of rows) {
    if (isNamed(r.sourceType)) named.set(r.sourceType, (named.get(r.sourceType) ?? 0) + r.views);
    else other += r.views;
  }
  const total = [...named.values()].reduce((a, b) => a + b, other);
  const bars: TrafficBar[] = [...named.entries()]
    .filter(([, views]) => views > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key, views]) => ({ key, views, pct: sharePct(views, total) }));
  if (other > 0) bars.push({ key: 'other', views: other, pct: sharePct(other, total) });
  return bars;
}

/** "De onde vêm as visualizações": traffic sources as horizontal bars. */
export function YouTubeTrafficCard({
  rows,
  lagThrough,
  state,
  phone,
}: {
  rows: YtTrafficRow[];
  lagThrough: string | null;
  state: CardLoadState;
  phone?: boolean;
}) {
  const { t } = useTranslation('analyticsYoutube');
  const bars = useMemo(() => trafficBars(rows), [rows]);
  const max = Math.max(1, ...bars.map((b) => b.pct));

  return (
    <YouTubeCardFrame
      phone={phone}
      title={t('traffic.title')}
      sub={t('traffic.sub')}
      lagThrough={lagThrough}
      state={state}
    >
      {bars.length === 0 ? (
        <EmptyLine>{t('traffic.empty')}</EmptyLine>
      ) : (
        <div>
          {bars.map((b) => (
            <div key={b.key} className="an-city-row" data-testid="yt-traffic-row">
              <span className="an-city-name">{t(`traffic.source.${b.key}`)}</span>
              <span className="an-city-bar" aria-hidden="true">
                <i style={{ width: `${(b.pct / max) * 100}%` }} />
              </span>
              <span className="an-city-val">{b.pct}%</span>
            </div>
          ))}
        </div>
      )}
    </YouTubeCardFrame>
  );
}

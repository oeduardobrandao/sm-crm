import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Chart, registerables } from 'chart.js';
import type { YouTubeContentType, YtDailyPoint } from '../../../services/youtubeAnalytics';
import { YouTubeCardFrame, EmptyLine, type CardLoadState } from './YouTubeCardFrame';
import {
  formatCount,
  formatShortDate,
  LONG_COLOR,
  LONG_COLOR_HEX,
  SHORTS_COLOR,
} from './youtubeTabFormat';

Chart.register(...registerables);

/** Stacked only for "Tudo" with both per-type series present; otherwise one views series. */
export const isStacked = (daily: YtDailyPoint[], type: YouTubeContentType): boolean =>
  type === 'all' &&
  daily.length > 0 &&
  daily.every((d) => typeof d.shortsViews === 'number' && typeof d.longViews === 'number');

/** "Visualizações por dia": stacked Shorts (red) over long videos (blue). */
export function YouTubeDailyViewsChart({
  daily,
  type,
  windowDays,
  lagThrough,
  state,
  splitUnavailable,
  phone,
}: {
  daily: YtDailyPoint[];
  type: YouTubeContentType;
  windowDays: number;
  /** contentTypeThrough when it lags: the Shorts x long split stops there. */
  lagThrough: string | null;
  state: CardLoadState;
  /** The channel has data but no content-type split yet: one total series and a note. */
  splitUnavailable?: boolean;
  phone?: boolean;
}) {
  const { t, i18n } = useTranslation('analyticsYoutube');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stacked = !splitUnavailable && isStacked(daily, type);
  const hasViews = daily.some((d) => d.views > 0);

  useEffect(() => {
    if (!canvasRef.current || !hasViews) return;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#e0e0e0' : '#333';
    const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
    const datasets = stacked
      ? [
          {
            label: t('contentType.long'),
            data: daily.map((d) => d.longViews ?? 0),
            backgroundColor: LONG_COLOR_HEX,
            borderRadius: 2,
            stack: 'views',
          },
          {
            label: t('contentType.shorts'),
            data: daily.map((d) => d.shortsViews ?? 0),
            backgroundColor: SHORTS_COLOR,
            borderRadius: 2,
            stack: 'views',
          },
        ]
      : [
          {
            label: t('daily.views'),
            data: daily.map((d) => d.views),
            backgroundColor: type === 'shorts' ? SHORTS_COLOR : LONG_COLOR_HEX,
            borderRadius: 2,
          },
        ];
    const chart = new Chart(canvasRef.current, {
      type: 'bar',
      data: { labels: daily.map((d) => formatShortDate(d.date, i18n.language)), datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: isDark ? '#1a1e26' : '#fff',
            titleColor: isDark ? '#fff' : '#12151a',
            bodyColor: isDark ? '#94a3b8' : '#4a5468',
            borderColor: isDark ? '#1e2430' : 'rgba(0,0,0,0.1)',
            borderWidth: 1,
            padding: 10,
            callbacks: {
              label: (ctx) => ` ${ctx.dataset.label}: ${formatCount(ctx.parsed.y)}`,
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            grid: { display: false },
            ticks: { color: textColor, font: { size: 10 }, maxTicksLimit: phone ? 4 : 6 },
          },
          y: {
            stacked: true,
            beginAtZero: true,
            grid: { color: gridColor },
            ticks: {
              color: textColor,
              font: { size: 10 },
              precision: 0,
              callback: (v) => formatCount(Number(v)),
            },
          },
        },
      },
    });
    return () => chart.destroy();
  }, [daily, stacked, type, hasViews, phone, t, i18n.language]);

  const legend = stacked ? (
    <span
      style={{ display: 'inline-flex', gap: '0.75rem', fontSize: '0.75rem' }}
      className="an-split-labels"
    >
      <span>
        <span className="an-dot" style={{ background: SHORTS_COLOR }} />
        {t('contentType.shorts')}
      </span>
      <span>
        <span className="an-dot" style={{ background: LONG_COLOR }} />
        {t('contentType.long')}
      </span>
    </span>
  ) : null;

  return (
    <YouTubeCardFrame
      phone={phone}
      title={t('daily.title')}
      sub={
        stacked ? t('daily.subSplit', { count: windowDays }) : t('daily.sub', { count: windowDays })
      }
      // Every type's series ends at contentTypeThrough when it lags (the split for "Tudo",
      // the whole series for Shorts and long videos, which can hold fewer points than the window).
      lagThrough={splitUnavailable ? null : lagThrough}
      legend={legend}
      state={state}
    >
      {splitUnavailable && type === 'all' && (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '0 0 0.75rem' }}>
          {t('split.unavailable')}
        </p>
      )}
      {splitUnavailable && type !== 'all' ? (
        // Shorts or long videos alone need the split: the server sends no points at all.
        <EmptyLine>{t('split.unavailable')}</EmptyLine>
      ) : hasViews ? (
        <div style={{ position: 'relative', height: phone ? 200 : 260 }}>
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={stacked ? t('daily.ariaSplit') : t('daily.aria')}
          />
        </div>
      ) : (
        <EmptyLine>{t('daily.empty')}</EmptyLine>
      )}
    </YouTubeCardFrame>
  );
}

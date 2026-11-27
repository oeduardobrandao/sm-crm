import type { BlockProps } from '../BlockRenderer';
import { fmtCount } from '../format';
import { fmtDayShort } from './gbp/format';
import { useReportLang, reportText } from '../i18n';

const W = 640;
const H = 180;
const PAD = 12;

// follower_history.date é TEXT YYYY-MM-DD; fmtDayShort usa split, o que evita o pisão de
// timezone do Date.parse (um new Date('2026-07-01') em UTC-3 imprimiria 30/06).

export function FollowerChartBlock({ snapshot }: BlockProps) {
  const lang = useReportLang();
  const title = reportText(lang).followers.title;
  const points = snapshot.follower_trend;
  if (points.length === 0) return null;
  const fmtDay = (date: string) => fmtDayShort(date, lang);

  const counts = points.map((p) => p.count);
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  const span = Math.max(max - min, 1);
  const x = (i: number) =>
    points.length === 1 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (points.length - 1);
  const y = (c: number) => H - PAD - ((c - min) / span) * (H - 2 * PAD);
  const coords = points.map((p, i) => `${x(i).toFixed(1)},${y(p.count).toFixed(1)}`).join(' ');

  return (
    <div className="rb-card rb-card--pad">
      <p
        className="rb-card-title"
        style={{ margin: '0 0 0.5rem', fontSize: '0.85rem', fontWeight: 600 }}
      >
        {title}
      </p>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto' }}
        role="img"
        aria-label={title}
      >
        <polyline
          points={coords}
          fill="none"
          stroke="var(--rb-accent-line, var(--rb-accent))"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '0.75rem',
          opacity: 0.7,
        }}
      >
        <span>{fmtCount(points[0].count, lang)}</span>
        <span>{fmtCount(points[points.length - 1].count, lang)}</span>
      </div>
      <div
        className="rb-chart-dates"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '0.68rem',
          opacity: 0.55,
          marginTop: '0.1rem',
        }}
      >
        <span>{fmtDay(points[0].date)}</span>
        {points.length > 1 ? <span>{fmtDay(points[points.length - 1].date)}</span> : null}
      </div>
    </div>
  );
}

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { YtDemographicRow } from '../../../services/youtubeAnalytics';
import { EmptyLine, YouTubeCardFrame, type CardLoadState } from './YouTubeCardFrame';
import { sharePct } from './youtubeTabFormat';

/** Display buckets, youngest first; YouTube's 55-64 and 65- merge into "55+" (mockup 3). */
const AGE_BUCKETS = ['13-17', '18-24', '25-34', '35-44', '45-54', '55+'] as const;

function bucketOf(ageGroup: string): string | null {
  const range = ageGroup.replace(/^age/, '');
  if (range === '55-64' || range === '65-') return '55+';
  return (AGE_BUCKETS as readonly string[]).includes(range) ? range : null;
}

export interface AudienceRow {
  age: string;
  female: number;
  male: number;
  /** Every viewer of the bucket, a gender other than female/male included. */
  total: number;
}

/** Rows per age bucket and the overall women/men split (of viewers with either gender). */
export function audienceRows(rows: YtDemographicRow[]) {
  const byAge = new Map<string, AudienceRow>();
  for (const r of rows) {
    const age = bucketOf(r.ageGroup);
    if (!age) continue;
    const row = byAge.get(age) ?? { age, female: 0, male: 0, total: 0 };
    if (r.gender === 'female') row.female += r.viewerPct;
    else if (r.gender === 'male') row.male += r.viewerPct;
    row.total += r.viewerPct;
    byAge.set(age, row);
  }
  const list = AGE_BUCKETS.map((a) => byAge.get(a)).filter(
    (r): r is AudienceRow => !!r && r.total > 0,
  );
  const female = list.reduce((s, r) => s + r.female, 0);
  const male = list.reduce((s, r) => s + r.male, 0);
  const women = sharePct(female, female + male);
  return { rows: list, women, men: female + male > 0 ? 100 - women : 0 };
}

/** "Público": age buckets as two-tone bars (women / men), the API's last-28-days snapshot. */
export function YouTubeAudienceCard({
  rows,
  state,
  phone,
}: {
  rows: YtDemographicRow[];
  state: CardLoadState;
  phone?: boolean;
}) {
  const { t } = useTranslation('analyticsYoutube');
  const audience = useMemo(() => audienceRows(rows), [rows]);
  const max = Math.max(1, ...audience.rows.map((r) => r.total));

  return (
    <YouTubeCardFrame
      phone={phone}
      title={t('audience.title')}
      sub={t('audience.sub')}
      state={state}
    >
      {audience.rows.length === 0 ? (
        <EmptyLine>{t('audience.empty')}</EmptyLine>
      ) : (
        <div>
          {audience.rows.map((r) => (
            <div
              key={r.age}
              className="an-city-row"
              role="group"
              aria-label={t('audience.rowAria', {
                age: r.age,
                total: Math.round(r.total),
                women: Math.round(r.female),
                men: Math.round(r.male),
              })}
            >
              <span className="an-city-name">{r.age}</span>
              <span
                className="an-city-bar"
                aria-hidden="true"
                style={{ display: 'flex', background: 'var(--an-hairline)' }}
              >
                <span style={{ display: 'flex', width: `${(r.total / max) * 100}%` }}>
                  <span style={{ flex: r.female, background: 'var(--an-female)' }} />
                  <span style={{ flex: r.male, background: 'var(--an-male)' }} />
                </span>
              </span>
              <span className="an-city-val">{Math.round(r.total)}%</span>
            </div>
          ))}
          <div className="an-split-labels" style={{ justifyContent: 'flex-start', gap: '1rem' }}>
            <span>
              <span className="an-dot" style={{ background: 'var(--an-female)' }} />
              {t('audience.women', { pct: audience.women })}
            </span>
            <span>
              <span className="an-dot" style={{ background: 'var(--an-male)' }} />
              {t('audience.men', { pct: audience.men })}
            </span>
          </div>
        </div>
      )}
    </YouTubeCardFrame>
  );
}

import type { BlockProps } from '../../BlockRenderer';
import { fmtCount } from '../../format';
import { GbpCardHeader } from './GbpCardHeader';
import { fmtDayMonth, fmtRating, googleWithData } from './format';
import { useReportLang, reportText } from '../../i18n';

const STAR_KEYS = ['5', '4', '3', '2', '1'] as const;

/** Estrelas cheias pela nota arredondada (como a aba GMN), o resto apagado. */
export function GbpStars({ rating, className }: { rating: number; className?: string }) {
  const stars = reportText(useReportLang()).gbp.rating.stars;
  const n = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <span
      role="img"
      aria-label={stars(n)}
      className={`rb-gbp-stars${className ? ` ${className}` : ''}`}
    >
      {'★'.repeat(n)}
      <span className="rb-gbp-stars-off">{'★'.repeat(5 - n)}</span>
    </span>
  );
}

/** Avaliações: nota média, total, novas no período e distribuição 5 a 1. */
export function GbpRatingBlock({ snapshot }: BlockProps) {
  const lang = useReportLang();
  const text = reportText(lang).gbp.rating;
  const google = googleWithData(snapshot);
  const avg = google?.kpis.avg_rating?.value ?? null;
  if (!google || avg === null) return null;

  const total = google.unit_rows.reduce((sum, u) => sum + (u.reviews ?? 0), 0);
  const fresh = google.kpis.new_reviews?.value ?? null;
  const countLine = [
    total > 0 ? text.reviews(fmtCount(total, lang), total) : null,
    fresh !== null ? text.inPeriod(fmtCount(fresh, lang)) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const dist = google.rating_distribution;
  const max = dist ? Math.max(...STAR_KEYS.map((k) => dist.counts[k]), 1) : 1;

  return (
    <div className="rb-gbp-card rb-card rb-card--pad">
      <GbpCardHeader
        title={text.title}
        stamp={google.window ? text.stamp(fmtDayMonth(google.window.end, lang)) : null}
      />
      <div className="rb-gbp-rating">
        <div className="rb-gbp-rating-summary">
          <p className="rb-gbp-rating-value">{fmtRating(avg, lang)}</p>
          <GbpStars rating={avg} />
          {countLine ? <p className="rb-gbp-sub">{countLine}</p> : null}
        </div>
        {dist ? (
          <div className="rb-gbp-dist">
            {STAR_KEYS.map((k) => (
              <div key={k} className="rb-gbp-dist-row">
                <span className="rb-gbp-dist-label">{`${k} ★`}</span>
                <div className="rb-gbp-track">
                  <div
                    className="rb-gbp-fill"
                    style={{ width: `${(dist.counts[k] / max) * 100}%` }}
                  />
                </div>
                <span className="rb-gbp-num rb-gbp-dist-count">
                  {fmtCount(dist.counts[k], lang)}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {dist?.partial ? <p className="rb-gbp-foot">{text.partial}</p> : null}
    </div>
  );
}

import type { BlockProps } from '../../BlockRenderer';
import { fmtCount } from '../../format';
import { GbpCardHeader } from './GbpCardHeader';
import { fmtDayMonth, fmtRating, googleWithData, plural } from './format';

const STAR_KEYS = ['5', '4', '3', '2', '1'] as const;

/** Estrelas cheias pela nota arredondada (como a aba GMN), o resto apagado. */
export function GbpStars({ rating, className }: { rating: number; className?: string }) {
  const n = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <span
      role="img"
      aria-label={`${n} de 5 estrelas`}
      className={`rb-gbp-stars${className ? ` ${className}` : ''}`}
    >
      {'★'.repeat(n)}
      <span className="rb-gbp-stars-off">{'★'.repeat(5 - n)}</span>
    </span>
  );
}

/** Avaliações: nota média, total, novas no período e distribuição 5 a 1. */
export function GbpRatingBlock({ snapshot }: BlockProps) {
  const google = googleWithData(snapshot);
  const avg = google?.kpis.avg_rating?.value ?? null;
  if (!google || avg === null) return null;

  const total = google.unit_rows.reduce((sum, u) => sum + (u.reviews ?? 0), 0);
  const fresh = google.kpis.new_reviews?.value ?? null;
  const countLine = [
    total > 0 ? `${fmtCount(total)} ${plural(total, 'avaliação', 'avaliações')}` : null,
    fresh !== null ? `+${fmtCount(fresh)} no período` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const dist = google.rating_distribution;
  const max = dist ? Math.max(...STAR_KEYS.map((k) => dist.counts[k]), 1) : 1;

  return (
    <div className="rb-gbp-card rb-card rb-card--pad">
      <GbpCardHeader
        title="Avaliações"
        stamp={google.window ? `Situação em ${fmtDayMonth(google.window.end)}` : null}
      />
      <div className="rb-gbp-rating">
        <div className="rb-gbp-rating-summary">
          <p className="rb-gbp-rating-value">{fmtRating(avg)}</p>
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
                <span className="rb-gbp-num rb-gbp-dist-count">{fmtCount(dist.counts[k])}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {dist?.partial ? (
        <p className="rb-gbp-foot">Distribuição das últimas 200 avaliações por unidade.</p>
      ) : null}
    </div>
  );
}
